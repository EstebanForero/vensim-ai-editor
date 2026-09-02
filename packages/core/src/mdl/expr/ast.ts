// Minimal expression language covering the arithmetic/function subset of Vensim equations
// needed for v1: + - * / ^ ( ), comparisons, AND/OR/NOT, numeric literals, quoted/bare
// variable names, and a small function table (MIN, MAX, ABS, EXP, LN, SQRT, IF THEN ELSE,
// ZIDZ, STEP, PULSE). Anything else parses as an opaque function call so it round-trips
// even though it won't evaluate.

export type Expr =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "unary"; op: "-" | "+" | "NOT"; arg: Expr }
  | { type: "binary"; op: string; left: Expr; right: Expr }
  | { type: "call"; name: string; args: Expr[] };

export function collectVarNames(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.type) {
    case "var":
      out.add(e.name);
      break;
    case "unary":
      collectVarNames(e.arg, out);
      break;
    case "binary":
      collectVarNames(e.left, out);
      collectVarNames(e.right, out);
      break;
    case "call":
      for (const a of e.args) collectVarNames(a, out);
      break;
  }
  return out;
}
