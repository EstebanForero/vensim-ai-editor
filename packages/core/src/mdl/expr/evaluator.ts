import type { Expr } from "./ast.js";
import { getFunction } from "./functions.js";

export type EvalEnv = Record<string, number>;

export function evaluate(e: Expr, env: EvalEnv): number {
  switch (e.type) {
    case "num":
      return e.value;
    case "var": {
      const v = env[e.name];
      if (v === undefined) throw new Error(`Unknown variable "${e.name}" during evaluation.`);
      return v;
    }
    case "unary": {
      const v = evaluate(e.arg, env);
      if (e.op === "-") return -v;
      if (e.op === "+") return v;
      return v === 0 ? 1 : 0;
    }
    case "binary": {
      const l = evaluate(e.left, env);
      const r = evaluate(e.right, env);
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
      const fn = getFunction(e.name);
      if (!fn) throw new Error(`Unsupported function "${e.name}" in equation.`);
      return fn(
        e.args.map((a) => evaluate(a, env)),
        env,
      );
    }
  }
}
