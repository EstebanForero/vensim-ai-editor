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

import type { Expr } from "../mdl/expr/ast.js";
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

function analyze(e: Expr, target: string): SignPair {
  switch (e.type) {
    case "num":
      return { value: e.value > 0 ? "pos" : e.value < 0 ? "neg" : "zero", deriv: "zero" };

    case "var":
      return e.name === target ? { value: "pos", deriv: "pos" } : { value: "pos", deriv: "zero" };

    case "unary": {
      const a = analyze(e.arg, target);
      if (e.op === "-") return { value: negate(a.value), deriv: negate(a.deriv) };
      if (e.op === "+") return a;
      // NOT: a boolean flip — not meaningfully signed, and anything depending on a NOT'd
      // expression that itself depends on the target can't be trusted either.
      return { value: "unknown", deriv: a.deriv === "zero" ? "zero" : "unknown" };
    }

    case "binary": {
      const l = analyze(e.left, target);
      const r = analyze(e.right, target);
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
        case "/":
          // Quotient rule: d(l/r) = (l'*r - l*r') / r^2 — the denominator r^2 is always
          // positive (away from r=0), so only the numerator's sign matters.
          return {
            value: mulSign(l.value, r.value),
            deriv: addSign(mulSign(l.deriv, r.value), negate(mulSign(l.value, r.deriv))),
          };
        case "^":
          return powerSign(l, e.right);
        default:
          // Comparisons, AND, OR: boolean-valued, not on a signed numeric scale.
          return { value: "unknown", deriv: l.deriv === "zero" && r.deriv === "zero" ? "zero" : "unknown" };
      }
    }

    case "call":
      return analyzeCall(e.name.toUpperCase(), e.args, target);
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

function analyzeCall(name: string, args: Expr[], target: string): SignPair {
  const parts = args.map((a) => analyze(a, target));
  const anyDeriv = () => (parts.some((p) => p.deriv !== "zero") ? "unknown" : "zero");

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
 * Infers the polarity of a causal relation `source -> ` (into whatever variable `equation`
 * belongs to), or `null` if it can't be determined structurally — e.g. `source` doesn't appear
 * in the equation at all, appears more than once with conflicting effect, or only inside a
 * construct this analysis doesn't have a sign rule for (comparisons, most trig/lookup/delay
 * functions, ...). `null` means "don't know," not "positive" — callers should fall back to their
 * own default (this editor's convention is "+") rather than treat `null` as any particular sign.
 */
export function inferPolarity(equation: string, sourceVarName: string, knownNames: string[]): Polarity | null {
  const expr = tryParseExpr(equation, knownNames);
  if (!expr) return null;
  const { deriv } = analyze(expr, sourceVarName);
  if (deriv === "pos") return "+";
  if (deriv === "neg") return "-";
  return null;
}
