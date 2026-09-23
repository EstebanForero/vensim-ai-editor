// Minimal expression language covering the arithmetic/function subset of Vensim equations
// needed for v1: + - * / ^ ( ), comparisons, AND/OR/NOT, numeric literals, quoted/bare
// variable names, and a small function table (MIN, MAX, ABS, EXP, LN, SQRT, IF THEN ELSE,
// ZIDZ, STEP, PULSE). Anything else parses as an opaque function call so it round-trips
// even though it won't evaluate.

/** One (input, output) pair of a lookup/graphical-function table. */
export interface LookupPoint {
  x: number;
  y: number;
}

/**
 * A Vensim lookup (a.k.a. graphical function / table function): a piecewise-linear map from an
 * input to an output, written in an equation as a bracketed axis range followed by a list of
 * points — `([(0,0)-(10,1)],(0,0),(5,0.2),(10,1))` — and used elsewhere as a call, `Name(x)`.
 *
 * `xMin`/`xMax`/`yMin`/`yMax` are the axis LIMITS Vensim shows in the graph editor (the
 * `[(xmin,ymin)-(xmax,ymax)]` box). They are a display range, not a clamp: values outside them
 * still come from the curve, which holds its first/last point's y beyond the data.
 */
export interface LookupTable {
  points: LookupPoint[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Sorts a table's points by input and drops any repeated input, keeping the last one given —
 * Vensim requires strictly increasing x, and a UI row-edit (or a hand-typed equation) can easily
 * produce a temporarily-unsorted or duplicated pair. Also widens the axis limits to contain every
 * point, so the `[(xmin,ymin)-(xmax,ymax)]` box can never exclude data the curve actually has.
 */
export function normalizeLookupTable(table: LookupTable): LookupTable {
  const byX = new Map<number, number>();
  for (const p of table.points) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) byX.set(p.x, p.y);
  }
  const points = [...byX.entries()].map(([x, y]) => ({ x, y })).sort((a, b) => a.x - b.x);

  if (points.length === 0) return { points: [], xMin: table.xMin, xMax: table.xMax, yMin: table.yMin, yMax: table.yMax };

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [first, last] = [points[0]!, points[points.length - 1]!];
  return {
    points,
    xMin: Math.min(table.xMin, first.x),
    xMax: Math.max(table.xMax, last.x),
    yMin: Math.min(table.yMin, ...ys),
    yMax: Math.max(table.yMax, ...ys),
  };
}

export type Expr =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "unary"; op: "-" | "+" | "NOT"; arg: Expr }
  | { type: "binary"; op: string; left: Expr; right: Expr }
  | { type: "call"; name: string; args: Expr[] }
  | { type: "lookup"; table: LookupTable };

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
    case "lookup":
      // A table literal is all numbers — it can't reference a variable. (A call TO a lookup is a
      // "call" node, handled above; the lookup's own name is deliberately not collected here, the
      // same way a function name isn't — see model/lookup.ts's collectLookupRefs for the one
      // place that needs the call-name side of this.)
      break;
  }
  return out;
}
