import type { Expr } from "./ast.js";

export function needsQuotes(name: string): boolean {
  return /[^A-Za-z0-9_]/.test(name) || /^\d/.test(name);
}

/** Quotes a variable name only when Vensim would otherwise misparse a bare reference to it
 * (spaces, accents, a leading digit, ...) — used anywhere a name is referenced *inside* an
 * expression, never on the left-hand side of its own `Name = eqn` definition line (that
 * position is unambiguous up to the `=`, and real Vensim files leave it bare even for
 * multi-word names — see example-compatibility/app-generated-samplcopye.mdl's own
 * `Rate Constant= 0.1`). */
export function quoteRefIfNeeded(name: string): string {
  return needsQuotes(name) ? `"${name}"` : name;
}

// Mirrors parser.ts's precedence chain exactly (lowest to highest):
// OR -> AND -> NOT -> comparison -> additive -> multiplicative -> power -> unary(-/+) -> primary.
// Printing without this would silently corrupt any equation whose grouping doesn't match plain
// left-to-right precedence — e.g. `(a - b) / c` printed as `a - b / c` re-parses as `a - b/c`,
// a different formula. (This is exactly the bug that made an exported equation compute a
// different result once re-opened in Vensim: the parens the user typed were being dropped.)
const NOT_PRECEDENCE = 3;
const UNARY_PRECEDENCE = 8;
const BINARY_PRECEDENCE: Record<string, number> = {
  OR: 1,
  AND: 2,
  "=": 4,
  "<>": 4,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "^": 7,
};

/** Atomic forms (numbers, names, calls) are self-delimited and never need wrapping parens
 * around themselves as a whole — treat them as binding infinitely tightly. */
function exprPrecedence(e: Expr): number {
  switch (e.type) {
    case "num":
    case "var":
    case "call":
      return Infinity;
    case "unary":
      return e.op === "NOT" ? NOT_PRECEDENCE : UNARY_PRECEDENCE;
    case "binary":
      return BINARY_PRECEDENCE[e.op] ?? 0;
  }
}

/** Prints `child` for a position that requires at least `minPrec` to omit parens — `strict`
 * additionally forces parens when the child's precedence is exactly equal (needed on the side
 * where reusing the same operator without parens would silently regroup the expression, e.g.
 * the right side of a left-associative `-`/`/`). */
function wrap(child: Expr, minPrec: number, strict: boolean): string {
  const childPrec = exprPrecedence(child);
  const needsParens = strict ? childPrec <= minPrec : childPrec < minPrec;
  const s = print(child);
  return needsParens ? `(${s})` : s;
}

function print(e: Expr): string {
  switch (e.type) {
    case "num":
      return String(e.value);
    case "var":
      return needsQuotes(e.name) ? `"${e.name}"` : e.name;
    case "unary": {
      const prec = e.op === "NOT" ? NOT_PRECEDENCE : UNARY_PRECEDENCE;
      // strict: a bare nested unary of the same kind (e.g. `- -a`) is parenthesized for
      // readability/unambiguous re-lexing rather than relying on `--a` tokenizing the way we'd
      // want.
      const argStr = wrap(e.arg, prec, true);
      return e.op === "NOT" ? `NOT ${argStr}` : `${e.op}${argStr}`;
    }
    case "call": {
      const name = e.name.toUpperCase() === "IF_THEN_ELSE" ? "IF THEN ELSE" : e.name;
      return `${name}(${e.args.map(print).join(", ")})`;
    }
    case "binary": {
      const prec = BINARY_PRECEDENCE[e.op] ?? 0;
      // `^` is parsed right-associative (parser.ts's parsePower recurses on the exponent), so
      // its right side may reuse `^` without parens; every other binary op here is parsed
      // left-associative, so it's the *left* side that may reuse the same operator freely.
      const rightAssoc = e.op === "^";
      const leftStr = wrap(e.left, prec, rightAssoc);
      const rightStr = wrap(e.right, prec, !rightAssoc);
      return `${leftStr} ${e.op} ${rightStr}`;
    }
  }
}

export function exprToString(e: Expr): string {
  return print(e);
}
