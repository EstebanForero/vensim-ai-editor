// Lookup tables (Vensim's "graphical functions"): a piecewise-linear input→output curve.
//
// Following this codebase's own rule for constants (see derived.ts's isConstantAuxiliary): a
// lookup is NOT a distinct element kind or a stored field — it's an ordinary Auxiliary whose
// EQUATION happens to be a table literal, exactly as a human would type it into Vensim's own
// equation editor:
//
//     Effect of Inventory on Shipments(
//         [(0,0)-(100,1)],
//         (0,0),(10,0.2),(30,0.6),(100,1))
//         ~   Dmnl
//
// so the table and the equation text can never disagree about what the curve is. Everything here
// is the read side of that (parse it back out) plus the write side (generate it); the editor UI
// and the AI tool both go through this one module rather than formatting tables themselves.
//
// Other variables use it as a function of their own input: `Shipment Rate = Effect of Inventory
// on Shipments(Inventory Coverage)`. That call form is why the model stores a lookup as a
// *variable* rather than inlining the curve at each call site — one curve, callable anywhere,
// matching how Vensim treats it.

import { normalizeLookupTable, tryParseExpr, type Expr, type LookupPoint, type LookupTable } from "../mdl/expr/index.js";
import { isFunctionRegistered } from "../mdl/expr/functions.js";
import { allVariables, type Auxiliary, type Model, type Variable } from "./types.js";

export type { LookupPoint, LookupTable };

/** The variable's own equation text — a stock's initial value isn't a lookup, but callers pass
 * whatever variable they have, so this keeps the two call sites from each needing the branch. */
function ownEquation(v: Variable): string {
  return v.kind === "stock" ? v.initialEquation : v.equation;
}

/** The lookup table a variable defines, or null if its equation isn't a lookup at all. */
export function lookupTableOf(v: Variable, model?: Model): LookupTable | null {
  const knownNames = model ? allVariables(model).map((x) => x.name) : [];
  const parsed = tryParseExpr(ownEquation(v), knownNames);
  return parsed?.type === "lookup" ? parsed.table : null;
}

export function isLookupVariable(v: Variable, model?: Model): boolean {
  return lookupTableOf(v, model) !== null;
}

/** The name a lookup table is callable by, given a point list — `lookupTableOf`'s inverse-ish
 * helper for the writer, which needs the same table it just read back out. */
export function lookupCallForm(name: string, arg: string): string {
  const needsQuotes = /[^A-Za-z0-9_]/.test(name) || /^\d/.test(name);
  return `${needsQuotes ? `"${name}"` : name}(${arg})`;
}

/** Formats a lookup as the equation text a variable should carry. Deliberately multi-line in
 * Vensim's own layout (range on its own line, points below), so a `.mdl` this editor writes
 * looks like one Vensim itself wrote. */
export function lookupEquation(table: LookupTable): string {
  const t = normalizeLookupTable(table);
  const points = t.points.map((p) => `(${n(p.x)},${n(p.y)})`).join(",");
  return `(\n\t[(${n(t.xMin)},${n(t.yMin)})-(${n(t.xMax)},${n(t.yMax)})],\n\t${points})`;
}

function n(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(12)));
}

/** Builds a table from bare (input, output) pairs, defaulting the axis limits to the data's own
 * bounds — what a UI or an AI tool has on hand before anyone has thought about axis ranges. */
export function tableFromPoints(points: LookupPoint[], axis?: Partial<Omit<LookupTable, "points">>): LookupTable {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return normalizeLookupTable({
    points,
    xMin: axis?.xMin ?? (xs.length ? Math.min(...xs) : 0),
    xMax: axis?.xMax ?? (xs.length ? Math.max(...xs) : 1),
    yMin: axis?.yMin ?? (ys.length ? Math.min(...ys) : 0),
    yMax: axis?.yMax ?? (ys.length ? Math.max(...ys) : 1),
  });
}

/**
 * The names of model-defined lookups called by an expression, e.g. `Effect(Inventory)` → {
 * "Effect" }. Anything that resolves to a registered built-in (MIN, IF THEN ELSE, ...) is
 * excluded, so this returns real lookup references only — used to make a lookup show up as a
 * dependency in the inspector, and to find the call sites the XMILE writer has to rewrite (XMILE
 * has no equivalent of a named, separately-callable table; it attaches the curve to the calling
 * variable instead, so each call site needs its own copy of it).
 */
export function collectLookupRefs(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.type) {
    case "call":
      if (e.name.toUpperCase() !== "WITH_LOOKUP" && !isFunctionRegistered(e.name)) out.add(e.name);
      for (const a of e.args) collectLookupRefs(a, out);
      break;
    case "unary":
      collectLookupRefs(e.arg, out);
      break;
    case "binary":
      collectLookupRefs(e.left, out);
      collectLookupRefs(e.right, out);
      break;
    case "num":
    case "var":
    case "lookup":
      break;
  }
  return out;
}

/**
 * Every lookup defined by `model`, keyed by the name other equations call it by — the scope the
 * simulator evaluates `Name(x)` against. Auxiliaries only: a stock's initial value or a flow's
 * rate could contain a table literal, but a table *definition* has to be a variable of its own
 * for anything to be able to call it.
 */
export function lookupScopeOf(model: Model): Map<string, LookupTable> {
  const scope = new Map<string, LookupTable>();
  for (const aux of model.auxiliaries) {
    const table = lookupTableOf(aux, model);
    if (table) scope.set(aux.name, table);
  }
  return scope;
}

/** The auxiliary defining each lookup, by name — the writer needs the defining variable to place
 * it in a sketch, not just its curve. */
export function lookupVariables(model: Model): Auxiliary[] {
  return model.auxiliaries.filter((a) => lookupTableOf(a, model) !== null);
}
