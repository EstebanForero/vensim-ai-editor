import type { Expr, LookupTable } from "./ast.js";
import { getFunction } from "./functions.js";

export type EvalEnv = Record<string, number>;

/** Every lookup table a model defines, keyed by the variable name it's called by — resolved
 * separately from `EvalEnv` because a lookup isn't a per-timestep number, it's a function: the
 * thing that's in scope for `Name(x)` is the table, not a value computed from it. */
export type LookupScope = Map<string, LookupTable>;

/**
 * Evaluates a lookup at `x`: linear interpolation between the two bracketing points, holding the
 * first/last point's output beyond either end of the data. That hold-at-the-ends behavior is
 * Vensim's own default for the "continuous" lookup type — the curve does not extrapolate.
 */
export function evaluateLookup(table: LookupTable, x: number): number {
  const points = table.points;
  if (points.length === 0) return 0;
  const first = points[0]!;
  if (x <= first.x) return first.y;
  const last = points[points.length - 1]!;
  if (x >= last.x) return last.y;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (x <= b.x) {
      const span = b.x - a.x;
      if (span === 0) return b.y;
      return a.y + ((x - a.x) / span) * (b.y - a.y);
    }
  }
  return last.y;
}

export function evaluate(e: Expr, env: EvalEnv, lookups?: LookupScope): number {
  switch (e.type) {
    case "num":
      return e.value;
    case "var": {
      const v = env[e.name];
      if (v === undefined) throw new Error(`Unknown variable "${e.name}" during evaluation.`);
      return v;
    }
    case "lookup":
      // A table is a function, not a value. Reaching here means it was referenced bare (e.g.
      // `Output = Effect` instead of `Output = Effect(Input)`), which has no numeric meaning —
      // saying so is far more useful than silently returning 0.
      throw new Error("A lookup table can't be used as a number — call it with an input, e.g. Name(x).");
    case "unary": {
      const v = evaluate(e.arg, env, lookups);
      if (e.op === "-") return -v;
      if (e.op === "+") return v;
      return v === 0 ? 1 : 0;
    }
    case "binary": {
      const l = evaluate(e.left, env, lookups);
      const r = evaluate(e.right, env, lookups);
      switch (e.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
        case "^":
          return Math.pow(l, r);
        case "=":
          return l === r ? 1 : 0;
        case "<>":
          return l !== r ? 1 : 0;
        case "<":
          return l < r ? 1 : 0;
        case ">":
          return l > r ? 1 : 0;
        case "<=":
          return l <= r ? 1 : 0;
        case ">=":
          return l >= r ? 1 : 0;
        case "AND":
          return l !== 0 && r !== 0 ? 1 : 0;
        case "OR":
          return l !== 0 || r !== 0 ? 1 : 0;
        default:
          throw new Error(`Unknown operator "${e.op}"`);
      }
    }
    case "call": {
      // Vensim's inline form: `WITH LOOKUP(input, ([(x,y)-(x,y)],(x,y),...))`. Handled before the
      // generic dispatch below because its second argument is a TABLE, not a number — evaluating
      // the arguments the usual way would just throw on the table literal.
      if (e.name.toUpperCase() === "WITH_LOOKUP") {
        const input = evaluate(e.args[0]!, env, lookups);
        const tableExpr = e.args[1];
        if (tableExpr?.type !== "lookup") throw new Error("WITH LOOKUP's second argument must be a lookup table literal.");
        return evaluateLookup(tableExpr.table, input);
      }
      // A model-defined lookup takes precedence over the built-in function registry, so a
      // variable may legitimately be named the same as a built-in (the user's own definition is
      // what their equation means).
      const table = lookups?.get(e.name);
      if (table) return evaluateLookup(table, evaluate(e.args[0] ?? { type: "num", value: 0 }, env, lookups));

      const fn = getFunction(e.name);
      if (!fn) throw new Error(`Unsupported function "${e.name}" in equation.`);
      return fn(
        e.args.map((a) => evaluate(a, env, lookups)),
        env,
      );
    }
  }
}
