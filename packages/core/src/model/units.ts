// A structural units checker — the same idea as Vensim's own Units Check (Ctrl+U): for every
// variable with an equation, compute the physical dimension its RHS works out to (by walking the
// parsed equation and multiplying/dividing/matching the *declared* units of whatever variables it
// references) and compare that against the variable's own declared `units` field. Unlike the
// `.mdl`-compatibility fixes elsewhere in this codebase, this doesn't need to match real Vensim's
// exact internal behavior byte-for-byte — it's a new analysis feature native to this editor, so
// its correctness is whatever this file's own tests say it is, not something that needs a live
// Vensim round-trip to confirm.
//
// A unit string ("bicicletas/día", "1/Year", "Dmnl", "people*year/widget^2", ...) is normalized
// into a `UnitDim`: a map from atomic unit name to its exponent (so "people/year" becomes
// `{people: 1, year: -1}`), or the literal `"unknown"` when the string can't be parsed at all
// (an unrecognized syntax, or empty declared units on a variable actually being referenced) — an
// `"unknown"` dimension is never flagged against anything, since there's nothing to check it
// against. This deliberately favors silence over a false positive: only a *confident* structural
// mismatch is reported.

import type { Expr } from "../mdl/expr/ast.js";
import { collectVarNames } from "../mdl/expr/ast.js";
import { tryParseExpr } from "../mdl/expr/parser.js";
import { allVariables, type Model, type Variable } from "./types.js";

export type UnitDim = Record<string, number> | "unknown";

const DIMENSIONLESS: Record<string, number> = {};

function isDimensionless(d: UnitDim): d is Record<string, number> {
  return d !== "unknown" && Object.keys(d).length === 0;
}

// Deliberately does NOT include "" — an empty units field means "not declared, unknown," a
// materially different claim from "explicitly dimensionless." Treating them the same would make
// every variable with no declared units silently participate in checks as if it had confirmed
// zero dimension, poisoning any equation that references it into a false-positive mismatch.
const DIMENSIONLESS_WORDS = new Set(["1", "dmnl", "dimensionless", "fraction", "unitless", "**undefined**"]);

/** Strips a trailing `[min,max]` / `[min,max,increment]` range suffix — Vensim's own convention
 * for appending a variable's expected data range directly onto the units string (see e.g.
 * example-compatibility/flow-diagram.mdl's `~ Year [0,?]`) — that's a range annotation, not part
 * of the unit's actual dimension. */
export function stripRangeSuffix(s: string): string {
  return s.replace(/\[[^\]]*\]\s*$/, "").trim();
}

/** Parses one unit atom with an optional `^n` exponent (e.g. "year^2", "widget^-1"). */
function parseAtom(token: string): { name: string; exponent: number } | null {
  // \p{L} rather than A-Za-z so non-English unit words (día, año, ...) parse — this editor's
  // own equations are routinely written in whatever language the model's author used.
  const m = /^([\p{L}_][\p{L}0-9_ ]*?)(?:\^(-?\d+(?:\.\d+)?))?$/u.exec(token.trim());
  if (!m) return null;
  const name = m[1]!.trim().toLowerCase();
  if (!name) return null;
  return { name, exponent: m[2] !== undefined ? Number(m[2]) : 1 };
}

/** Parses a Vensim-style compound unit string ("people/year", "dollars*year/widget", ...) into
 * an exponent map. Only `*`, `/`, and `^` are supported (no parentheses) — real Vensim units are
 * essentially always a flat product/quotient of atoms, and anything with unexpected syntax
 * (parens, stray punctuation) comes back `"unknown"` rather than a wrong guess. */
export function parseUnits(raw: string): UnitDim {
  const s = stripRangeSuffix(raw);
  if (s === "") return "unknown";
  if (DIMENSIONLESS_WORDS.has(s.toLowerCase())) return { ...DIMENSIONLESS };
  if (/[()]/.test(s)) return "unknown";

  // Split into tokens, keeping track of the * or / immediately before each one (the first token
  // is implicitly multiplied).
  const tokens = s.split(/([*/])/).map((t) => t.trim());
  if (tokens.some((t) => t === "")) return "unknown";

  const dim: Record<string, number> = {};
  let sign = 1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "*") {
      sign = 1;
      continue;
    }
    if (t === "/") {
      sign = -1;
      continue;
    }
    const atom = parseAtom(t);
    if (!atom) return "unknown";
    dim[atom.name] = (dim[atom.name] ?? 0) + sign * atom.exponent;
    if (dim[atom.name] === 0) delete dim[atom.name];
  }
  return dim;
}

function mulDim(a: UnitDim, b: UnitDim, powerB = 1): UnitDim {
  if (a === "unknown" || b === "unknown") return "unknown";
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + v * powerB;
    if (out[k] === 0) delete out[k];
  }
  return out;
}

function sameDim(a: UnitDim, b: UnitDim): boolean {
  if (a === "unknown" || b === "unknown") return true; // nothing confident to compare
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

function formatDim(d: UnitDim): string {
  if (d === "unknown") return "unknown";
  const entries = Object.entries(d);
  if (entries.length === 0) return "Dmnl";
  const numerator = entries.filter(([, v]) => v > 0).map(([k, v]) => (v === 1 ? k : `${k}^${v}`));
  const denominator = entries.filter(([, v]) => v < 0).map(([k, v]) => (v === -1 ? k : `${k}^${-v}`));
  const top = numerator.join("*") || "1";
  return denominator.length === 0 ? top : `${top}/${denominator.join("/")}`;
}

export interface UnitMismatch {
  /** Where in the equation this specific mismatch was found — the whole equation for a
   * top-level declared-vs-computed check, or a nested description (e.g. "MIN(...) arguments",
   * "A + B") for an internal inconsistency the equation has regardless of the variable's own
   * declared units. */
  context: string;
  left: UnitDim;
  right: UnitDim;
}

interface DimResult {
  dim: UnitDim;
  mismatches: UnitMismatch[];
  /** True only for a bare numeric literal (or a unary +/- of one) — real Vensim lets an
   * inline, untyped constant blend into any expression without complaint (e.g. `Cost + 5` where
   * Cost is in dollars raises no error in Vensim itself), unlike a variable or a sub-expression
   * that genuinely computes to Dmnl (e.g. a ratio that cancels out), which SHOULD still be
   * flagged if summed with something dimensioned. Both look identical as a plain `{}` dimension,
   * so this flag is what lets `combine` tell them apart — without it, every equation with an
   * inline constant term (extremely common: `MAX(0, X)`, `Rate * 0.5`, ...) would false-positive
   * as a unit mismatch the moment that constant is added/subtracted against a real variable. */
  literal: boolean;
}

function combine(dims: DimResult[], context: string): DimResult {
  const mismatches = dims.flatMap((d) => d.mismatches);
  // A bare literal is never required to match anything — it's Vensim's own convention for an
  // untyped inline constant, not a claim about its dimension. Only non-literal, resolved
  // dimensions need to agree with each other.
  const known = dims.filter((d) => !d.literal && d.dim !== "unknown").map((d) => d.dim as Record<string, number>);
  if (known.length > 1) {
    for (let i = 1; i < known.length; i++) {
      if (!sameDim(known[0]!, known[i]!)) {
        mismatches.push({ context, left: known[0]!, right: known[i]! });
        break;
      }
    }
  }
  const dim = dims.some((d) => d.dim === "unknown") ? "unknown" : (known[0] ?? DIMENSIONLESS);
  return { dim, mismatches, literal: dims.every((d) => d.literal) };
}

function analyzeDim(e: Expr, unitsByName: Map<string, UnitDim>): DimResult {
  switch (e.type) {
    case "num":
      return { dim: { ...DIMENSIONLESS }, mismatches: [], literal: true };

    case "var": {
      const dim = unitsByName.get(e.name) ?? "unknown";
      return { dim, mismatches: [], literal: false };
    }

    case "unary": {
      const a = analyzeDim(e.arg, unitsByName);
      return e.op === "NOT" ? { dim: { ...DIMENSIONLESS }, mismatches: a.mismatches, literal: false } : a;
    }

    case "binary": {
      const l = analyzeDim(e.left, unitsByName);
      const r = analyzeDim(e.right, unitsByName);
      switch (e.op) {
        case "+":
        case "-":
          return combine([l, r], `${e.op === "+" ? "sum" : "difference"} of mismatched units`);
        case "*":
          return { dim: mulDim(l.dim, r.dim), mismatches: [...l.mismatches, ...r.mismatches], literal: l.literal && r.literal };
        case "/":
          return { dim: mulDim(l.dim, r.dim, -1), mismatches: [...l.mismatches, ...r.mismatches], literal: l.literal && r.literal };
        case "^": {
          const exp = literalExponent(e.right);
          if (exp === null || l.dim === "unknown") {
            return { dim: "unknown", mismatches: [...l.mismatches, ...r.mismatches], literal: false };
          }
          const out: Record<string, number> = {};
          for (const [k, v] of Object.entries(l.dim)) out[k] = v * exp;
          return { dim: out, mismatches: [...l.mismatches, ...r.mismatches], literal: l.literal };
        }
        default:
          // Comparisons/AND/OR: boolean-valued, dimensionless result. Still surface internal
          // mismatches from the operands even though the comparison itself isn't checked.
          return { dim: { ...DIMENSIONLESS }, mismatches: [...l.mismatches, ...r.mismatches], literal: false };
      }
    }

    case "call":
      return analyzeCallDim(e.name, e.args, unitsByName);

    case "lookup":
      // A table literal is a curve, and its output units are the OWNING variable's declared
      // units — not something derivable from the literal itself (all of whose numbers are
      // untyped). Reporting "unknown" keeps `check` from inventing a mismatch against the
      // variable's own declared units; the meaningful check for a lookup is at its call sites,
      // which analyzeCallDim handles.
      return { dim: "unknown", mismatches: [], literal: false };
  }
}

function literalExponent(e: Expr): number | null {
  if (e.type === "num") return e.value;
  if (e.type === "unary" && e.op === "-" && e.arg.type === "num") return -e.arg.value;
  return null;
}

/** `rawName` is the call's name exactly as written (variable names are matched case-sensitively),
 * upper-cased only for the built-in dispatch below. */
function analyzeCallDim(rawName: string, args: Expr[], unitsByName: Map<string, UnitDim>): DimResult {
  const name = rawName.toUpperCase();
  const parts = args.map((a) => analyzeDim(a, unitsByName));
  const allMismatches = () => parts.flatMap((p) => p.mismatches);

  switch (name) {
    case "MIN":
    case "MAX":
      return combine(parts, `${name}(...) arguments must share the same units`);

    case "IF_THEN_ELSE":
      // The condition (args[0]) isn't dimensionally comparable to the branches — only the two
      // branches need to match each other.
      return combine(parts.slice(1), "IF THEN ELSE branches must share the same units");

    case "ABS":
    case "INTEGER":
      return parts[0] ?? { dim: "unknown", mismatches: [], literal: false };

    case "SQRT": {
      const a = parts[0];
      if (!a || a.dim === "unknown") return { dim: "unknown", mismatches: allMismatches(), literal: false };
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(a.dim)) out[k] = v / 2;
      return { dim: out, mismatches: a.mismatches, literal: a.literal };
    }

    // Transcendental functions are only dimensionally valid on a dimensionless argument — real
    // Vensim's own units checker flags this too.
    case "EXP":
    case "LN":
    case "LOG":
    case "SIN":
    case "COS":
    case "TAN":
    case "ARCSIN":
    case "ARCCOS":
    case "ARCTAN": {
      const a = parts[0];
      const mismatches = allMismatches();
      if (a && a.dim !== "unknown" && !isDimensionless(a.dim)) {
        mismatches.push({ context: `${name}(...) argument must be dimensionless`, left: a.dim, right: DIMENSIONLESS });
      }
      return { dim: { ...DIMENSIONLESS }, mismatches, literal: false };
    }

    case "ZIDZ":
    case "XIDZ": {
      const a = parts[0] ?? { dim: "unknown" as UnitDim, mismatches: [], literal: false };
      const b = parts[1] ?? { dim: "unknown" as UnitDim, mismatches: [], literal: false };
      return { dim: mulDim(a.dim, b.dim, -1), mismatches: [...a.mismatches, ...b.mismatches], literal: a.literal && b.literal };
    }

    case "POWER": {
      const base = parts[0];
      const exp = args[1] ? literalExponent(args[1]) : null;
      if (!base || exp === null || base.dim === "unknown") return { dim: "unknown", mismatches: allMismatches(), literal: false };
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(base.dim)) out[k] = v * exp;
      return { dim: out, mismatches: base.mismatches, literal: base.literal };
    }

    case "STEP":
      // STEP(height, time): result takes on `height`'s units.
      return { dim: parts[0]?.dim ?? "unknown", mismatches: allMismatches(), literal: parts[0]?.literal ?? false };

    case "PULSE":
      // PULSE(start, duration): a 0/1 dimensionless switch.
      return { dim: { ...DIMENSIONLESS }, mismatches: allMismatches(), literal: false };

    default: {
      // Not a built-in. If the name is a model variable that declares units, this is a call to a
      // lookup table, and the result carries the units the lookup itself declares — in Vensim a
      // lookup's `~units` line describes what it RETURNS, not what it takes. Without this, every
      // equation using a lookup computes as "unknown" and the declared-vs-computed check below
      // silently skips it — which is exactly where an output-units slip is easiest to make and
      // hardest to notice.
      const asLookup = unitsByName.get(rawName);
      if (asLookup !== undefined && asLookup !== "unknown") {
        return { dim: asLookup, mismatches: allMismatches(), literal: false };
      }
      // An unrecognized function's unit contract isn't known — don't guess.
      return { dim: "unknown", mismatches: allMismatches(), literal: false };
    }
  }
}

export interface UnitIssue {
  variableId: string;
  variableName: string;
  message: string;
}

// Vensim's own time-unit keyword is a fixed, English-only set (see the AI tool's set_sim_spec
// schema, packages/ai-tools/src/tools.ts) — but a variable's own declared units string is free
// text, and this editor's own accent-stripping doesn't translate words, only strip diacritics,
// so a rate declared "recursos/mes" alongside a model time unit of "Month" stays "mes" forever
// even though both mean the same thing. Real Vensim's own Units Check flags this: it compares a
// unit's time-denominator word against the model's actual declared time unit, as plain text, and
// "mes" ≠ "Month" to that comparison. This mirrors that specific check — distinct from (and
// unrelated to) the general dimensional-consistency check above, since "mes" and "Month" denote
// the very same dimension, just spelled differently. Only Spanish equivalents are covered here,
// since that's the demonstrated real-world case; extending to another language is a matter of
// adding more entries below, not changing the mechanism.
const TIME_UNIT_ALIASES: Record<string, string> = {
  second: "second", seconds: "second", segundo: "second", segundos: "second",
  minute: "minute", minutes: "minute", minuto: "minute", minutos: "minute",
  hour: "hour", hours: "hour", hora: "hour", horas: "hour",
  day: "day", days: "day", dia: "day", dias: "day", día: "day", días: "day",
  week: "week", weeks: "week", semana: "week", semanas: "week",
  month: "month", months: "month", mes: "month", meses: "month",
  quarter: "quarter", quarters: "quarter", trimestre: "quarter", trimestres: "quarter",
  year: "year", years: "year", ano: "year", anos: "year", año: "year", años: "year",
};

/** Checks every declared units string in the model for a time-unit word that doesn't literally
 * match `model.simSpec.timeUnits` — including a same-concept translation ("mes" for a "Month"
 * model), which the dimensional check above can't catch since it only compares atom text, and
 * "mes"/"Month" denote the same dimension by construction (both mean "1 model time step's
 * unit"), not a mismatched one. */
function checkTimeUnitSpelling(model: Model): UnitIssue[] {
  const declaredTimeUnit = model.simSpec.timeUnits.trim();
  const canonical = TIME_UNIT_ALIASES[declaredTimeUnit.toLowerCase()];
  if (!canonical) return []; // an unrecognized time unit — nothing confident to compare against

  const issues: UnitIssue[] = [];
  for (const v of allVariables(model)) {
    const dim = parseUnits(v.units);
    if (dim === "unknown") continue;
    for (const atom of Object.keys(dim)) {
      const atomCanonical = TIME_UNIT_ALIASES[atom];
      if (!atomCanonical) continue; // not a recognized time-unit word at all — leave it alone
      if (atom === declaredTimeUnit.toLowerCase()) continue; // exact match, nothing to flag
      issues.push({
        variableId: v.id,
        variableName: v.name,
        message: `Units use "${atom}" as a time unit, but the model's time unit is "${declaredTimeUnit}" — Vensim requires the exact same word everywhere a time unit appears.`,
      });
    }
  }
  return issues;
}

/**
 * Runs a Vensim-Ctrl+U-style structural units check over every stock/flow/auxiliary with an
 * equation, plus a model-wide time-unit spelling pass. Reports three kinds of issue: an internal
 * inconsistency within an equation itself (e.g. adding two differently-unit'd terms, or MIN/MAX
 * arguments that don't match), a mismatch between an equation's own computed units and the
 * variable's declared `units` field, and any declared units using a time-unit word that doesn't
 * literally match the model's own `simSpec.timeUnits` — including a same-concept translation
 * ("mes" for a "Month" model), which real Vensim's own Units Check also flags as a mismatch even
 * though both denote the same dimension. A variable with no declared units, an unparseable units
 * string, or an equation this analysis can't fully resolve (an unrecognized function, non-literal
 * exponent, ...) is never flagged — only confident structural mismatches are reported.
 */
export function checkUnits(model: Model): UnitIssue[] {
  const vars = allVariables(model);
  const unitsByName = new Map<string, UnitDim>();
  for (const v of vars) unitsByName.set(v.name, parseUnits(v.units));

  const issues: UnitIssue[] = [];
  const check = (v: Variable, equation: string) => {
    const expr = tryParseExpr(equation, vars.map((x) => x.name));
    if (!expr) return;
    const { dim, mismatches } = analyzeDim(expr, unitsByName);
    for (const m of mismatches) {
      issues.push({
        variableId: v.id,
        variableName: v.name,
        message: `${m.context}: ${formatDim(m.left)} vs ${formatDim(m.right)}`,
      });
    }
    // Skip the declared-vs-computed check for a pure-literal equation (e.g. a constant "100")
    // — there's no way to state units inline for a bare number, and that's expected: the
    // variable's own `units` field is the only source of truth for it.
    if (collectVarNames(expr).size === 0) return;
    const declared = unitsByName.get(v.name) ?? "unknown";
    if (dim !== "unknown" && declared !== "unknown" && !sameDim(dim, declared)) {
      issues.push({
        variableId: v.id,
        variableName: v.name,
        message: `Equation computes ${formatDim(dim)}, but declared units are ${formatDim(declared)}`,
      });
    }
  };

  for (const s of model.stocks) check(s, s.initialEquation);
  for (const f of model.flows) check(f, f.equation);
  for (const a of model.auxiliaries) check(a, a.equation);

  issues.push(...checkTimeUnitSpelling(model));

  return issues;
}
