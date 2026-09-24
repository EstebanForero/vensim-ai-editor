// Infers a causal relation's polarity (+/-) directly from the target variable's equation,
// instead of requiring the AI or a user to state it by hand. The rule is the standard system-
// dynamics one: relation `from -> to` is "+" if increasing `from` (holding every other input
// fixed) increases `to`, "-" if it decreases `to` — i.e. the sign of the partial derivative
// d(to)/d(from). Rather than actually differentiating, this walks the parsed equation once and
// propagates two signs per subexpression: its own assumed VALUE sign, and the sign of its
// derivative with respect to the target name, using the ordinary product/quotient/chain rules
// structurally (never evaluating anything numerically — a stock/flow model's equations aren't
// evaluable at "some point" in a way that would generalize anyway).
//
// Every OTHER variable (and the target itself) is assumed to hold a positive value — the normal
// case for stock-and-flow quantities (rates, populations, inventories, times are practically
// always modeled as non-negative). This is a simplifying assumption, not a proof: a relation
// that's only "+" because some input happens to be negative will be inferred backward. Anywhere
// the sign genuinely can't be pinned down structurally (e.g. an addition of a positive and a
// negative contribution, or a function this analysis doesn't special-case), the result is
// `null` — "don't know," which callers should treat as "leave it to the caller's own default,"
// never silently guess.

import { isFunctionRegistered } from "../mdl/expr/functions.js";
import type { Expr, LookupTable } from "../mdl/expr/ast.js";
import { tryParseExpr } from "../mdl/expr/parser.js";
import type { Polarity } from "./types.js";

type Sign = "pos" | "neg" | "zero" | "unknown";

interface SignPair {
  /** This subexpression's own assumed sign (under the "every free variable is positive"
   * assumption above) — used as the "other factor" in product/quotient-rule combinations. */
  value: Sign;
  /** The sign of this subexpression's partial derivative with respect to the target variable. */
  deriv: Sign;
}

function negate(s: Sign): Sign {
  if (s === "pos") return "neg";
  if (s === "neg") return "pos";
  return s;
}

/** Sign of a sum of two signed quantities — "pos"/"neg" only combine cleanly with "zero" (no
 * contribution) or an identical sign; two opposite non-zero signs could cancel to anything, so
 * that's `unknown` rather than a guess. */
function addSign(a: Sign, b: Sign): Sign {
  if (a === "zero") return b;
  if (b === "zero") return a;
  if (a === "unknown" || b === "unknown") return "unknown";
  return a === b ? a : "unknown";
}

function mulSign(a: Sign, b: Sign): Sign {
  if (a === "zero" || b === "zero") return "zero";
  if (a === "unknown" || b === "unknown") return "unknown";
  return a === b ? "pos" : "neg";
}

/** MIN/MAX/IF-THEN-ELSE branches: the result follows whichever branch is actually selected, so
 * this is only decidable when every branch's derivative agrees (or contributes nothing). */
function agreeingSign(signs: Sign[]): Sign {
  return signs.reduce(addSign, "zero");
}

/** The sign of a monotonic lookup's slope, or null when it isn't monotonic — a curve that both
 * rises and falls can't be signed without knowing where on it the model is operating, but a
 * strictly increasing one is "+" everywhere and a strictly decreasing one is "-" everywhere.
 * Flat stretches (repeated y) are allowed; they contribute nothing either way. */
function lookupSlopeSign(table: LookupTable): Sign | null {
  const ys = table.points.map((p) => p.y);
  let up = false;
  let down = false;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i]! > ys[i - 1]!) up = true;
    else if (ys[i]! < ys[i - 1]!) down = true;
  }
  if (up && down) return null;
  if (up) return "pos";
  if (down) return "neg";
  return "zero";
}

type LookupScopeParam = Map<string, LookupTable> | undefined;

function analyze(e: Expr, target: string, lookups?: LookupScopeParam): SignPair {
  switch (e.type) {
    case "num":
      return { value: e.value > 0 ? "pos" : e.value < 0 ? "neg" : "zero", deriv: "zero" };

    case "var":
      return e.name === target ? { value: "pos", deriv: "pos" } : { value: "pos", deriv: "zero" };

    case "lookup":
      // A table literal used as a value contributes no dependence; its own y-values are numbers.
      return { value: "unknown", deriv: "zero" };

    case "unary": {
      const a = analyze(e.arg, target, lookups);
      if (e.op === "-") return { value: negate(a.value), deriv: negate(a.deriv) };
      if (e.op === "+") return a;
      // NOT: a boolean flip — not meaningfully signed, and anything depending on a NOT'd
      // expression that itself depends on the target can't be trusted either.
      return { value: "unknown", deriv: a.deriv === "zero" ? "zero" : "unknown" };
    }

    case "binary": {
      const l = analyze(e.left, target, lookups);
      const r = analyze(e.right, target, lookups);
      switch (e.op) {
        case "+":
          return { value: addSign(l.value, r.value), deriv: addSign(l.deriv, r.deriv) };
        case "-":
          return { value: addSign(l.value, negate(r.value)), deriv: addSign(l.deriv, negate(r.deriv)) };
        case "*":
          // Product rule: d(l*r) = l'*r + l*r'.
          return {
            value: mulSign(l.value, r.value),
            deriv: addSign(mulSign(l.deriv, r.value), mulSign(l.value, r.deriv)),
          };
        case "/": {
          // Quotient rule: d(l/r) = (l'*r - l*r') / r^2 — the denominator r^2 is always
          // positive (away from r=0), so only the numerator's sign matters.
          const value = mulSign(l.value, r.value);
          const deriv = addSign(mulSign(l.deriv, r.value), negate(mulSign(l.value, r.deriv)));
          if (deriv !== "unknown") return { value, deriv };
          // The rule above combines the numerator's *whole* value with the denominator's slope,
          // and that loses the cancellation in forms like `x / (x + y)` — the shape of every
          // "share of" equation, and of Success to the Successful. There l'*r and l*r' are both
          // positive, so it reports ambiguity, while the difference is a*c: positive. Cancelling
          // l*r' against the part of l'*r that carries r's own slope needs both sides to be
          // linear in the target, which is all this second pass claims.
          //
          // With l = a*x + b and r = c*x + d (a, b, c, d all independent of x), the numerator is
          // exactly a*d - b*c, so the signs of those two products settle it. It is only reached
          // when the rule above gave up, so it can sharpen a verdict but never overrule one.
          const ls = linearIn(e.left, target, lookups);
          const rs = linearIn(e.right, target, lookups);
          if (ls && rs && ls.coef !== "zero" && rs.coef !== "zero") {
            return { value, deriv: addSign(mulSign(ls.coef, rs.const), negate(mulSign(ls.const, rs.coef))) };
          }
          return { value, deriv };
        }
        case "^":
          return powerSign(l, e.right);
        default:
          // Comparisons, AND, OR: boolean-valued, not on a signed numeric scale.
          return { value: "unknown", deriv: l.deriv === "zero" && r.deriv === "zero" ? "zero" : "unknown" };
      }
    }

    case "call":
      return analyzeCall(e.name, e.args, target, lookups);
  }
}

/** `base ^ exponent`: only decidable when the exponent is a plain positive or negative numeric
 * literal not itself depending on the target (Vensim equations essentially never raise something
 * to a target-dependent power) — a positive exponent preserves the base's derivative sign
 * (d/dx[base^n] = n*base^(n-1)*base', and base^(n-1) > 0 under the positive-base assumption), a
 * negative one flips it (the whole quantity is decreasing in the base). */
function powerSign(base: SignPair, exponentExpr: Expr): SignPair {
  // A negative literal exponent parses as a unary minus wrapping a positive number, not a
  // negative "num" node, so that shape needs unwrapping to read the exponent's actual sign.
  const literal =
    exponentExpr.type === "num"
      ? exponentExpr.value
      : exponentExpr.type === "unary" && exponentExpr.op === "-" && exponentExpr.arg.type === "num"
        ? -exponentExpr.arg.value
        : null;
  if (literal !== null) {
    if (literal > 0) return { value: "pos", deriv: base.deriv };
    if (literal < 0) return { value: "pos", deriv: negate(base.deriv) };
  }
  return { value: "pos", deriv: base.deriv === "zero" ? "zero" : "unknown" };
}

function analyzeCall(rawName: string, args: Expr[], target: string, lookups?: LookupScopeParam): SignPair {
  const name = rawName.toUpperCase();
  const parts = args.map((a) => analyze(a, target, lookups));
  const anyDeriv = () => (parts.some((p) => p.deriv !== "zero") ? "unknown" : "zero");

  // A call to a model-defined lookup, which the built-in switch below knows nothing about. Even
  // though a curve's slope at an arbitrary point is unknowable, a MONOTONIC one has the same
  // sign everywhere, and that's the common case for the "effect of X on Y" curves lookups are
  // normally used for — so a relation into a lookup's argument can still be signed correctly
  // (and, from there, a feedback loop through it classified R vs B).
  const table = lookups?.get(rawName);
  if (table) {
    const slope = lookupSlopeSign(table);
    const argDeriv = parts[0]?.deriv ?? "zero";
    if (slope === null) return { value: "unknown", deriv: argDeriv === "zero" ? "zero" : "unknown" };
    if (slope === "zero") return { value: "unknown", deriv: "zero" };
    return { value: "unknown", deriv: slope === "pos" ? argDeriv : negate(argDeriv) };
  }
  // An unrecognized call name that isn't a lookup either — fall through to the built-in switch,
  // whose default already handles "don't know".
  if (!isFunctionRegistered(rawName)) return { value: "unknown", deriv: anyDeriv() };

  switch (name) {
    case "MIN":
    case "MAX":
      // Whichever argument wins, the result's sensitivity to the target is whatever that
      // argument's was — only safe to claim when every argument agrees.
      return { value: "pos", deriv: agreeingSign(parts.map((p) => p.deriv)) };

    case "IF_THEN_ELSE": {
      // The condition (args[0]) only selects a branch — it doesn't scale the result — so its
      // own dependence on the target is irrelevant to the OUTPUT's sign, only which of the two
      // branches (args[1], args[2]) ends up mattering.
      const branches = parts.slice(1);
      return { value: "pos", deriv: agreeingSign(branches.map((p) => p.deriv)) };
    }

    case "ABS": {
      const a = parts[0];
      if (!a) return { value: "pos", deriv: "zero" };
      if (a.value === "pos") return { value: "pos", deriv: a.deriv };
      if (a.value === "neg") return { value: "pos", deriv: negate(a.deriv) };
      return { value: "pos", deriv: a.deriv === "zero" ? "zero" : "unknown" };
    }

    // Strictly increasing over the assumed-positive domain: sign passes straight through.
    case "EXP":
    case "LN":
    case "LOG":
    case "SQRT":
    case "ARCTAN":
      return { value: "pos", deriv: parts[0]?.deriv ?? "zero" };

    // A delay or smoothing is a monotone lag with unit steady-state gain: raising the input
    // raises what comes out, only later. So the input's sign passes straight through and the
    // delay time (args[1]) contributes nothing — it changes *when*, never *which way*. Without
    // this, every feedback loop running through a delay is left unclassified, which is exactly
    // the loop an archetype like Shifting the Burden is built out of. (Lowered to stocks before
    // simulating — see sim/lowerDelays.ts — but this analysis reads the model as written.)
    case "DELAY1":
    case "DELAY3":
    case "DELAY_N":
    case "SMOOTH":
    case "SMOOTH3":
      return { value: "pos", deriv: parts[0]?.deriv ?? "zero" };

    case "ZIDZ":
    case "XIDZ": {
      // Behaves like args[0]/args[1] whenever the divisor isn't zero — reuse the quotient rule.
      const a = parts[0] ?? { value: "pos" as Sign, deriv: "zero" as Sign };
      const b = parts[1] ?? { value: "pos" as Sign, deriv: "zero" as Sign };
      return { value: mulSign(a.value, b.value), deriv: addSign(mulSign(a.deriv, b.value), negate(mulSign(a.value, b.deriv))) };
    }

    case "POWER":
      return args[1] ? powerSign(parts[0] ?? { value: "pos", deriv: "zero" }, args[1]) : { value: "pos", deriv: "zero" };

    // Non-monotonic or genuinely unpredictable-sign built-ins (trig, rounding, delays, noise,
    // lookups, ...) and anything else not specifically handled above: only claim independence
    // when the target genuinely doesn't appear in any argument at all.
    default:
      return { value: "unknown", deriv: anyDeriv() };
  }
}

/**
 * The target's coefficient and everything independent of it: `a*target + b`, as two signs. `null`
 * when the expression isn't that shape at all — the target times itself, raised to a power, put
 * through a lookup or a trend function, or used where this analysis has no rule.
 *
 * Sign-only and structural, like the rest of this file: `a` and `b` are taken to be positive
 * unless shown otherwise, and nothing is ever evaluated. That's what makes this usable for the
 * cancellation in `analyze`'s quotient case, which needs to know that the part of `l'*r` carrying
 * `r`'s own slope is the same quantity as `l*r'` — true when both sides are linear in the target,
 * and false the moment the target is squared, looked up, or wrapped in a nonlinear function.
 */
function linearIn(e: Expr, target: string, lookups?: LookupScopeParam): { coef: Sign; const: Sign } | null {
  switch (e.type) {
    case "num":
      return { coef: "zero", const: e.value > 0 ? "pos" : e.value < 0 ? "neg" : "zero" };

    case "var":
      return e.name === target ? { coef: "pos", const: "zero" } : { coef: "zero", const: "pos" };

    case "lookup":
      // A table literal used as a value: no dependence on anything, but not a known number.
      return { coef: "zero", const: "unknown" };

    case "unary": {
      const a = linearIn(e.arg, target, lookups);
      if (!a) return null;
      if (e.op === "-") return { coef: negate(a.coef), const: negate(a.const) };
      if (e.op === "+") return a;
      return null; // NOT: boolean-valued.
    }

    case "binary": {
      const l = linearIn(e.left, target, lookups);
      const r = linearIn(e.right, target, lookups);
      if (!l || !r) return null;
      switch (e.op) {
        case "+":
          return { coef: addSign(l.coef, r.coef), const: addSign(l.const, r.const) };
        case "-":
          return { coef: addSign(l.coef, negate(r.coef)), const: addSign(l.const, negate(r.const)) };
        case "*":
          // Linear only when one side doesn't involve the target at all; that side's own sign
          // then scales both parts of the other.
          if (l.coef === "zero") return { coef: mulSign(l.const, r.coef), const: mulSign(l.const, r.const) };
          if (r.coef === "zero") return { coef: mulSign(r.const, l.coef), const: mulSign(r.const, l.const) };
          return null;
        case "/":
          if (r.coef === "zero") return { coef: mulSign(l.coef, r.const), const: mulSign(l.const, r.const) };
          return null;
        default:
          return null; // "^" and the comparisons: not linear in the target.
      }
    }

    case "call": {
      // Linear only when no argument involves the target, which makes the call a constant here.
      // A monotone lookup of the target, or a DELAY of it, is monotone in the target and not
      // *linear* in it — so none of those qualify.
      if (e.args.some((a) => linearIn(a, target, lookups)?.coef !== "zero")) return null;
      return { coef: "zero", const: analyzeCall(e.name, e.args, target, lookups).value };
    }
  }
}

/**
 * Infers the polarity of a causal relation `source -> ` (into whatever variable `equation`
 * belongs to), or `null` if it can't be determined structurally — e.g. `source` doesn't appear
 * in the equation at all, appears more than once with conflicting effect, or only inside a
 * construct this analysis doesn't have a sign rule for (comparisons, most trig/lookup/delay
 * functions, ...). `null` means "don't know," not "positive" — callers should fall back to their
 * own default (this editor's convention is "+") rather than treat `null` as any particular sign.
 */
export function inferPolarity(
  equation: string,
  sourceVarName: string,
  knownNames: string[],
  lookups?: Map<string, LookupTable>,
): Polarity | null {
  const expr = tryParseExpr(equation, knownNames);
  if (!expr) return null;
  const { deriv } = analyze(expr, sourceVarName, lookups);
  if (deriv === "pos") return "+";
  if (deriv === "neg") return "-";
  return null;
}
