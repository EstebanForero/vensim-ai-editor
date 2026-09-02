import type { Expr } from "./ast.js";

export type EvalEnv = Record<string, number>;

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  MIN: (a) => Math.min(...a),
  MAX: (a) => Math.max(...a),
  ABS: (a) => Math.abs(a[0]!),
  EXP: (a) => Math.exp(a[0]!),
  LN: (a) => Math.log(a[0]!),
  LOG: (a) => Math.log10(a[0]!),
  SQRT: (a) => Math.sqrt(a[0]!),
  INTEGER: (a) => Math.trunc(a[0]!),
  ZIDZ: (a) => (a[1] === 0 ? 0 : a[0]! / a[1]!),
  XIDZ: (a) => (a[1] === 0 ? a[2]! : a[0]! / a[1]!),
  IF_THEN_ELSE: (a) => (a[0] !== 0 ? a[1]! : a[2]!),
  STEP: (a) => (a.length > 1 ? a[1]! : 0), // height, [time] — resolved specially with Time in env
};

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
      if (e.name === "STEP") {
        const height = evaluate(e.args[0]!, env);
        const stepTime = evaluate(e.args[1]!, env);
        const time = env["Time"] ?? 0;
        return time >= stepTime ? height : 0;
      }
      if (e.name === "PULSE") {
        const start = evaluate(e.args[0]!, env);
        const duration = evaluate(e.args[1]!, env);
        const time = env["Time"] ?? 0;
        return time >= start && time < start + duration ? 1 : 0;
      }
      const fn = FUNCTIONS[e.name.toUpperCase()];
      if (!fn) throw new Error(`Unsupported function "${e.name}" in equation.`);
      return fn(e.args.map((a) => evaluate(a, env)));
    }
  }
}
