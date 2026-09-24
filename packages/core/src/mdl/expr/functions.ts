// The equation language's function table, as an open registry rather than a fixed switch
// statement — adding support for another Vensim function (or a project-specific one) is
// `registerFunction(...)`, not a change to the evaluator itself. `evaluate()` in evaluator.ts
// has no per-function special cases; every call, including time-aware ones like STEP/PULSE,
// goes through `getFunction`.
//
// This is a code-level extension point for embedders, not a runtime/user-facing one: it is
// never wired to AI tool input or any other untrusted string, since a function's `impl` is an
// arbitrary JS closure — only call registerFunction with implementations you wrote yourself.

import type { EvalEnv } from "./evaluator.js";

export type VensimFunctionImpl = (args: number[], env: EvalEnv) => number;

export interface VensimFunctionEntry {
  name: string;
  impl: VensimFunctionImpl;
  description: string;
}

const registry = new Map<string, VensimFunctionEntry>();

/** Registers (or replaces) a function usable in equations. `name` is matched case-insensitively. */
export function registerFunction(name: string, impl: VensimFunctionImpl, description = ""): void {
  registry.set(name.toUpperCase(), { name: name.toUpperCase(), impl, description });
}

export function getFunction(name: string): VensimFunctionImpl | undefined {
  return registry.get(name.toUpperCase())?.impl;
}

export function isFunctionRegistered(name: string): boolean {
  return registry.has(name.toUpperCase());
}

/** Lists all registered functions — useful for building equation-editor autocomplete. */
export function listFunctions(): VensimFunctionEntry[] {
  return [...registry.values()];
}

function arg(args: number[], i: number): number {
  return args[i] ?? 0;
}

registerFunction("MIN", (a) => Math.min(...a), "MIN(a, b, ...): the smallest of two or more values.");
registerFunction("MAX", (a) => Math.max(...a), "MAX(a, b, ...): the largest of two or more values.");
registerFunction("ABS", (a) => Math.abs(arg(a, 0)), "ABS(x): absolute value.");
registerFunction("EXP", (a) => Math.exp(arg(a, 0)), "EXP(x): e raised to the power x.");
registerFunction("LN", (a) => Math.log(arg(a, 0)), "LN(x): natural logarithm.");
registerFunction("LOG", (a) => Math.log10(arg(a, 0)), "LOG(x): base-10 logarithm.");
registerFunction("SQRT", (a) => Math.sqrt(arg(a, 0)), "SQRT(x): square root.");
registerFunction("INTEGER", (a) => Math.trunc(arg(a, 0)), "INTEGER(x): truncates toward zero.");
registerFunction("POWER", (a) => Math.pow(arg(a, 0), arg(a, 1)), "POWER(x, y): x raised to the power y.");
registerFunction("MODULO", (a) => arg(a, 0) % arg(a, 1), "MODULO(x, y): remainder of x / y.");
registerFunction("SIN", (a) => Math.sin(arg(a, 0)), "SIN(x): sine, x in radians.");
registerFunction("COS", (a) => Math.cos(arg(a, 0)), "COS(x): cosine, x in radians.");
registerFunction("TAN", (a) => Math.tan(arg(a, 0)), "TAN(x): tangent, x in radians.");
registerFunction("ARCSIN", (a) => Math.asin(arg(a, 0)), "ARCSIN(x): inverse sine, in radians.");
registerFunction("ARCCOS", (a) => Math.acos(arg(a, 0)), "ARCCOS(x): inverse cosine, in radians.");
registerFunction("ARCTAN", (a) => Math.atan(arg(a, 0)), "ARCTAN(x): inverse tangent, in radians.");

registerFunction(
  "ZIDZ",
  (a) => (arg(a, 1) === 0 ? 0 : arg(a, 0) / arg(a, 1)),
  "ZIDZ(a, b): a / b, or 0 if b is zero (Zero If Divide by Zero).",
);
registerFunction(
  "XIDZ",
  (a) => (arg(a, 1) === 0 ? arg(a, 2) : arg(a, 0) / arg(a, 1)),
  "XIDZ(a, b, x): a / b, or x if b is zero (X If Divide by Zero).",
);
registerFunction(
  "IF_THEN_ELSE",
  (a) => (arg(a, 0) !== 0 ? arg(a, 1) : arg(a, 2)),
  'IF THEN ELSE(cond, then, else): `then` if cond is non-zero, else `else`.',
);
registerFunction(
  "STEP",
  (a, env) => (( env["Time"] ?? 0) >= arg(a, 1) ? arg(a, 0) : 0),
  "STEP(height, time): 0 before `time`, `height` from `time` onward.",
);
registerFunction(
  "PULSE",
  (a, env) => {
    const time = env["Time"] ?? 0;
    const start = arg(a, 0);
    const duration = arg(a, 1);
    return time >= start && time < start + duration ? 1 : 0;
  },
  "PULSE(start, duration): 1 during [start, start + duration), else 0.",
);

/**
 * The delay/smoothing family is implemented by *rewriting*, not by evaluation: `lowerDelays`
 * expands each call into stocks and flows before the simulator runs, because a delay carries
 * state across timesteps and this evaluator is a pure function of the current one (see
 * sim/lowerDelays.ts). A call reaching the evaluator therefore means that expansion was
 * bypassed — so the impl refuses loudly rather than returning a number nobody computed.
 *
 * The names still belong in the registry. `polarity.ts` and `units.ts` both check
 * `isFunctionRegistered` before applying their own per-function rules, so an unregistered
 * DELAY1 would leave every loop through it unsigned and its units unchecked; and the equation
 * editor's autocomplete is built from `listFunctions`.
 */
function expandedBeforeSimulation(name: string): VensimFunctionImpl {
  return () => {
    throw new Error(`${name} is expanded into stocks and flows before the model runs, so it can't be evaluated here.`);
  };
}

registerFunction("DELAY1", expandedBeforeSimulation("DELAY1"), "DELAY1(input, delay time): input delayed by one first-order lag.");
registerFunction("DELAY3", expandedBeforeSimulation("DELAY3"), "DELAY3(input, delay time): input delayed by three lags in series.");
registerFunction("DELAY_N", expandedBeforeSimulation("DELAY N"), "DELAY N(input, delay time, order): input delayed by `order` lags in series.");
registerFunction("SMOOTH", expandedBeforeSimulation("SMOOTH"), "SMOOTH(input, smooth time): input smoothed by one first-order lag.");
registerFunction("SMOOTH3", expandedBeforeSimulation("SMOOTH3"), "SMOOTH3(input, smooth time): input smoothed by three lags in series.");
