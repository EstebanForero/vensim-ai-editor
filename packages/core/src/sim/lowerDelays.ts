// Vensim's delay/smoothing builtins are rewritten into ordinary stocks and flows before the
// model is simulated, rather than evaluated as functions.
//
// The reason is RK4. `computeEnv` is a pure function of (stock values, time) and is called FOUR
// times per timestep under RK4, each with trial stock values at a half step. A delay that
// advanced its own internal level whenever it was called would advance roughly four times per
// step, feeding on half-physical inputs — wrong in a way that looks plausible. Threading a second
// class of integrated state through `compile`, `computeEnv`, `stockDerivatives` and both
// integration paths buys the same answer with far more places to get it wrong.
//
// So each exponential call site becomes what the engine already integrates correctly. There are
// two of those, and they match only while the delay time is constant:
//
//   SMOOTH / SMOOTHI / SMOOTH3 / SMOOTH3I / SMOOTH N — an information delay. The stock IS the
//   output. `SMOOTH(Input, D)` is
//
//     stock `Delay of X`       initial = Input   (or the explicit initial)
//     flow  `Delay of X Rate`  = (Input − stock) / D
//     the call site replaced by a reference to that stock
//
//   DELAY1 / DELAY1I / DELAY3 / DELAY3I / DELAY N — a material delay. The stock is the quantity
//   in the pipeline, and the output is that quantity divided by the delay time. With a constant
//   delay time the two are the same ODE. When the delay time shrinks, a material delay dumps the
//   pipeline (the output jumps up) so the integral of the output still matches the integral of
//   the input; an information delay never leaves the range of its input.
//
// Higher-order calls expand to N stages in series, each a lag of the total time divided by N —
// three lags of D/3 is a third-order delay of D, not three delays of D. Every stage starts at
// the same initial value, which is the steady state the chain would settle at.
//
// DELAY N and SMOOTH N are the same cascades, with two Vensim differences. The signature is
// (input, delay time, initial value, order) — all four required — and the call has to be the
// whole equation. The output is constant for one TIME STEP, and the delay time it uses is the
// value from the previous step, so those levels take a single Euler step per TIME STEP even
// when the rest of the model is integrated with RK4. If a literal delay time is not longer
// than order × TIME STEP, the order is lowered until it is, which is what Vensim does (it
// warns; the run continues).
//
// DELAY FIXED is not a differential equation. It holds its input for a fixed time and then
// releases it unchanged, and the call has to be the whole equation. Vensim reads the delay
// time once, at the initial time, rounds it to a whole number of TIME STEPs (and never shorter
// than one), and holds the output constant between steps no matter the integration method. The
// stock created here has no flow, so RK4 leaves it alone during a step; `simulate` shifts it
// once per step from the history in `fixedDelays`.
//
// This returns a COPY. The model being edited is never touched, so the synthetic stocks never
// reach the canvas, the .mdl writer, validation, or the units check — all of which run on the
// original. `simulate` takes its output series from the original model too, so delay state stays
// out of the charts.

import { ModelError } from "../model/errors.js";
import type { Expr } from "../mdl/expr/ast.js";
import { tryParseExpr } from "../mdl/expr/parser.js";
import { exprToString } from "../mdl/expr/printer.js";
import { addFlow, addStock } from "../model/builder/index.js";
import { allVariables, isReservedName, type Model } from "../model/types.js";

/** Exponential delays with a fixed order. `DELAY N` and `SMOOTH N` take the order from an
 * argument, and `DELAY FIXED` is a shift register, so none of those are listed here. */
const LAGS: Record<string, { stages: number; kind: "material" | "information"; initialRequired: boolean }> = {
  DELAY1: { stages: 1, kind: "material", initialRequired: false },
  DELAY1I: { stages: 1, kind: "material", initialRequired: true },
  DELAY3: { stages: 3, kind: "material", initialRequired: false },
  DELAY3I: { stages: 3, kind: "material", initialRequired: true },
  SMOOTH: { stages: 1, kind: "information", initialRequired: false },
  SMOOTHI: { stages: 1, kind: "information", initialRequired: true },
  SMOOTH3: { stages: 3, kind: "information", initialRequired: false },
  SMOOTH3I: { stages: 3, kind: "information", initialRequired: true },
};

/** What the lexer squashes Vensim's spaced names into (see expr/lexer.ts). */
const DELAY_N = "DELAY_N";
const SMOOTH_N = "SMOOTH_N";
const DELAY_FIXED = "DELAY_FIXED";

/**
 * Is this call one of the delay family this codebase understands?
 *
 * Deliberately separate from the decoder that validates arguments: this one answers only "is it
 * a delay at all", and is used both to decide whether an equation needs rewriting and — by the
 * archetype detectors, which care that a path is slow rather than by how much — to read a delay
 * out of an equation without simulating it.
 */
export function isDelayFunction(name: string): boolean {
  const upper = name.toUpperCase();
  return LAGS[upper] !== undefined || upper === DELAY_N || upper === SMOOTH_N || upper === DELAY_FIXED;
}

/** A positive whole-number order, or a throw. Vensim requires a constant here too, and a delay
 * whose size can't be read is one this can't lower without guessing. */
function literalOrder(order: Expr | undefined, fn: string): number {
  if (!order || order.type !== "num" || !Number.isInteger(order.value) || order.value < 1) {
    throw new ModelError(`${fn} needs a literal whole-number order.`);
  }
  return order.value;
}

interface LagCall {
  kind: "material" | "information";
  stages: number;
  /** Null means "start from the input", which is what the forms without an I do. */
  initial: Expr | null;
  /**
   * DELAY N and SMOOTH N. Vensim holds their output constant for a whole TIME STEP and reads
   * the delay time from the previous step, so RK4 must not move them between steps.
   */
  discrete: boolean;
}

/** Vensim's spelling of a lexer-squashed name, for errors a modeler will read. */
function vensimName(upper: string): string {
  if (upper === DELAY_N) return "DELAY N";
  if (upper === SMOOTH_N) return "SMOOTH N";
  if (upper === DELAY_FIXED) return "DELAY FIXED";
  return upper;
}

/**
 * Vensim requires `delay time > order × TIME STEP` and, when a literal delay time is too short,
 * lowers the order until the inequality holds (it warns; the model still runs). Order 1 is the
 * floor. A delay time that isn't a literal is checked later, once its initial value is known.
 */
function orderVensimAllows(requested: number, delayTime: Expr, dt: number): number {
  if (delayTime.type !== "num" || !(delayTime.value > 0) || !(dt > 0)) return requested;
  let order = requested;
  while (order > 1 && !(delayTime.value > order * dt)) order -= 1;
  return order;
}

/**
 * How to expand one call, or null if it isn't a delay. `args` are the already-lowered argument
 * expressions. Throws when a required argument is missing or an order isn't a literal.
 */
function decodeLag(name: string, args: Expr[], dt: number): LagCall | null {
  const upper = name.toUpperCase();
  const fixed = LAGS[upper];
  if (fixed) {
    const takes = fixed.initialRequired ? 3 : 2;
    if (fixed.initialRequired && !args[2]) {
      throw new ModelError(`${upper} needs an input, a delay time, and an initial value.`);
    }
    if (args.length > takes) {
      const instead = fixed.initialRequired ? "" : ` For an explicit initial value, use ${upper}I.`;
      throw new ModelError(`${upper} takes ${takes} arguments.${instead}`);
    }
    return { kind: fixed.kind, stages: fixed.stages, initial: args[2] ?? null, discrete: false };
  }
  if (upper === DELAY_N || upper === SMOOTH_N) {
    const label = vensimName(upper);
    // Vensim's signature, the only one: (input, delay time, initial value, order).
    if (!args[2] || !args[3] || args.length > 4) {
      throw new ModelError(`${label}(input, delay time, initial value, order) needs those four arguments.`);
    }
    const requested = literalOrder(args[3], label);
    return {
      kind: upper === DELAY_N ? "material" : "information",
      stages: orderVensimAllows(requested, args[1]!, dt),
      initial: args[2],
      discrete: true,
    };
  }
  return null;
}

function containsDelay(e: Expr): boolean {
  switch (e.type) {
    case "call":
      return isDelayFunction(e.name) || e.args.some(containsDelay);
    case "unary":
      return containsDelay(e.arg);
    case "binary":
      return containsDelay(e.left) || containsDelay(e.right);
    default:
      return false;
  }
}

/** Hands out variable names for delay state, one per stage (plus one per stage's flow), never
 * colliding with anything already in the model or with a reserved Vensim name. Names are matched
 * case-insensitively, the way Vensim resolves them. */
function makeNamer(model: Model): (owner: string, stage: number, stages: number, suffix?: string) => string {
  const taken = new Set(allVariables(model).map((v) => v.name.toLowerCase()));
  return (owner, stage, stages, suffix = "") => {
    const label = stages === 1 ? `Delay of ${owner}` : `Delay of ${owner} ${stage}`;
    const base = `${label}${suffix}`;
    let candidate = base;
    for (let n = 2; taken.has(candidate.toLowerCase()) || isReservedName(candidate); n++) {
      candidate = `${base} ${n}`;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  };
}

/** One DELAY FIXED call, already lowered. `simulate` samples `input` once per TIME STEP and
 * shifts `stockId`, which has no flow of its own. */
export interface FixedDelaySpec {
  stockId: string;
  input: Expr;
  /** Read once, at the initial time. Later changes are ignored, matching Vensim. */
  delayTime: Expr;
  initial: Expr;
}

/** The delay time DELAY N / SMOOTH N divide by. `simulate` copies the live value in at the end
 * of each TIME STEP, so the following step sees this step's value — Vensim's "previous time step". */
export interface HeldDelayTime {
  stockId: string;
  delayTime: Expr;
}

/** A non-literal delay time whose order was not reduced at lowering time. Checked once the
 * initial value can actually be evaluated. */
export interface OrderCheck {
  fn: string;
  order: number;
  delayTime: Expr;
}

interface Lowering {
  model: Model;
  name: (owner: string, stage: number, stages: number, suffix?: string) => string;
  delayStockIds: Set<string>;
  /** Pipeline or smooth levels of DELAY N / SMOOTH N. Advanced one Euler step per TIME STEP. */
  discreteStockIds: Set<string>;
  fixedDelays: FixedDelaySpec[];
  heldDelayTimes: HeldDelayTime[];
  orderChecks: OrderCheck[];
}

export interface LoweredModel {
  model: Model;
  /**
   * Ids of the stocks this pass generated to hold delay state.
   *
   * They are initialized differently from a model's own stocks: a delay's output starts at its
   * input's value *at the initial time* (or at an explicit initial), and that input is usually
   * an expression over auxiliaries and flows — which don't exist until the model's own initial
   * state is known. So `simulate` settles the real stocks first and then evaluates these against
   * the resulting environment, rather than alongside them.
   */
  delayStockIds: ReadonlySet<string>;
  /** Stocks RK4 must not touch between TIME STEPs. Empty when the model has no DELAY N or SMOOTH N. */
  discreteStockIds: ReadonlySet<string>;
  /** DELAY FIXED calls, in the order they were lowered. Empty when the model has none. */
  fixedDelays: readonly FixedDelaySpec[];
  heldDelayTimes: readonly HeldDelayTime[];
  orderChecks: readonly OrderCheck[];
}

function ref(name: string): Expr {
  return { type: "var", name };
}

function bin(op: "-" | "/" | "*", left: Expr, right: Expr): Expr {
  return { type: "binary", op, left, right };
}

/**
 * Builds the stage chain for one exponential delay and returns the expression the call evaluates
 * to. `input` and `delayTime` are already lowered, so a delay nested inside either is already a
 * reference to its own state.
 */
function buildStages(ctx: Lowering, owner: string, input: Expr, delayTime: Expr, lag: LagCall): Expr {
  let time = delayTime;
  if (lag.discrete) {
    // One held copy of the delay time for every stage. No flow: it stays put during a step,
    // and simulate overwrites it at the step boundary.
    const heldName = ctx.name(owner, 1, 1, " time");
    const held = addStock(ctx.model, {
      name: heldName,
      initialEquation: exprToString(delayTime),
      comment:
        `Simulator-generated state for the delay on "${owner}" — not part of the model as drawn. ` +
        `The delay time as of the previous time step.`,
    });
    ctx.delayStockIds.add(held.id);
    ctx.heldDelayTimes.push({ stockId: held.id, delayTime });
    if (delayTime.type !== "num") {
      ctx.orderChecks.push({
        fn: lag.kind === "material" ? "DELAY N" : "SMOOTH N",
        order: lag.stages,
        delayTime,
      });
    }
    time = ref(heldName);
  }
  const tau: Expr = lag.stages === 1 ? time : bin("/", time, { type: "num", value: lag.stages });
  const start = lag.initial ?? input;
  // A material stage stores the pipeline, which at steady state is output × delay time. An
  // information stage stores the output itself.
  const level0 = lag.kind === "material" ? bin("*", start, tau) : start;

  let incoming = input;
  let output: Expr = incoming;
  for (let stage = 1; stage <= lag.stages; stage++) {
    const name = ctx.name(owner, stage, lag.stages);
    const stock = addStock(ctx.model, {
      name,
      initialEquation: exprToString(level0),
      comment:
        `Simulator-generated state for the delay on "${owner}" — not part of the model as drawn. ` +
        (lag.kind === "material"
          ? `Holds the quantity still inside the delay.`
          : `Holds the value the delay is currently passing through.`),
    });
    ctx.delayStockIds.add(stock.id);
    if (lag.discrete) ctx.discreteStockIds.add(stock.id);
    const quoted = ref(name);
    const net =
      lag.kind === "material"
        ? bin("-", incoming, bin("/", quoted, tau))
        : bin("/", bin("-", incoming, quoted), tau);
    addFlow(ctx.model, {
      name: ctx.name(owner, stage, lag.stages, " Rate"),
      equation: exprToString(net),
      to: stock.id,
    });
    incoming = lag.kind === "material" ? bin("/", quoted, tau) : quoted;
    output = incoming;
  }
  return output;
}

/** A shift register with no flow, so the integrator can't move it between TIME STEPs. */
function buildFixed(ctx: Lowering, owner: string, args: Expr[]): Expr {
  const input = args[0];
  const delayTime = args[1];
  const initial = args[2];
  if (!input || !delayTime || !initial) {
    throw new ModelError(`DELAY FIXED on "${owner}" needs an input, a delay time, and an initial value.`);
  }
  const name = ctx.name(owner, 1, 1);
  const stock = addStock(ctx.model, {
    name,
    initialEquation: exprToString(initial),
    comment:
      `Simulator-generated state for DELAY FIXED on "${owner}" — not part of the model as drawn. ` +
      `Holds the value released after the delay time.`,
  });
  ctx.delayStockIds.add(stock.id);
  ctx.fixedDelays.push({ stockId: stock.id, input, delayTime, initial });
  return ref(name);
}

/** Rewrites every delay call in `e` into a reference to newly created state. Post-order: a
 * delay nested in another delay's input is lowered first, so the outer chain is built from the
 * inner one's output rather than from an expression that no longer evaluates. */
function lowerExpr(e: Expr, ctx: Lowering, owner: string, atRoot: boolean): Expr {
  switch (e.type) {
    case "call": {
      const upper = e.name.toUpperCase();
      // Vensim: DELAY N, SMOOTH N and DELAY FIXED must be the whole right-hand side. The
      // variable is a level. Anything around the call is rejected there, so it is rejected here.
      if (!atRoot && (upper === DELAY_N || upper === SMOOTH_N || upper === DELAY_FIXED)) {
        throw new ModelError(
          `${vensimName(upper)} must be the entire equation of "${owner}". Vensim treats that variable as a level.`,
        );
      }
      const args = e.args.map((a) => lowerExpr(a, ctx, owner, false));
      if (upper === DELAY_FIXED) return buildFixed(ctx, owner, args);
      const lag = decodeLag(e.name, args, ctx.model.simSpec.dt);
      if (!lag) return { ...e, args };
      if (!args[0] || !args[1]) {
        throw new ModelError(`A delay on "${owner}" needs both an input and a delay time.`);
      }
      return buildStages(ctx, owner, args[0], args[1], lag);
    }
    case "unary":
      return { ...e, arg: lowerExpr(e.arg, ctx, owner, false) };
    case "binary":
      return { ...e, left: lowerExpr(e.left, ctx, owner, false), right: lowerExpr(e.right, ctx, owner, false) };
    default:
      return e;
  }
}

/**
 * Returns a copy of `model` with every delay/smoothing call replaced by stocks and flows the
 * ordinary integrator drives. A model with no delays comes back an unchanged copy.
 *
 * An equation that doesn't parse is left exactly as it was, so `simulate` reports it the way it
 * always has rather than this pass masking the failure. An equation with no delay is left
 * byte-identical too — rewriting it would only risk respelling a formula nobody asked about.
 */
export function lowerDelays(model: Model): LoweredModel {
  // Read from the caller's model, and used only to quote multi-word variable names while
  // parsing — the rewriting itself happens on the clone.
  const knownNames = allVariables(model).map((v) => v.name);
  const lowered = structuredClone(model);
  const delayStockIds = new Set<string>();
  const discreteStockIds = new Set<string>();
  const fixedDelays: FixedDelaySpec[] = [];
  const heldDelayTimes: HeldDelayTime[] = [];
  const orderChecks: OrderCheck[] = [];
  const ctx: Lowering = {
    model: lowered,
    name: makeNamer(lowered),
    delayStockIds,
    discreteStockIds,
    fixedDelays,
    heldDelayTimes,
    orderChecks,
  };

  const rewrite = (owner: string, get: () => string, set: (value: string) => void): void => {
    const parsed = tryParseExpr(get(), knownNames);
    if (!parsed || !containsDelay(parsed)) return;
    set(exprToString(lowerExpr(parsed, ctx, owner, true)));
  };

  // Only the variables that were here to begin with: rewriting pushes new stocks and flows onto
  // the very lists being walked, and those are already in their final form. Iterating by a
  // length captured up front says that directly, where snapshotting the array would leave the
  // reason implicit.
  const walk = <T extends { name: string }>(items: T[], get: (x: T) => string, set: (x: T, value: string) => void) => {
    for (let i = 0, n = items.length; i < n; i++) {
      const item = items[i]!;
      rewrite(item.name, () => get(item), (v) => set(item, v));
    }
  };

  walk(lowered.stocks, (s) => s.initialEquation, (s, v) => (s.initialEquation = v));
  walk(lowered.flows, (f) => f.equation, (f, v) => (f.equation = v));
  walk(lowered.auxiliaries, (a) => a.equation, (a, v) => (a.equation = v));

  return { model: lowered, delayStockIds, discreteStockIds, fixedDelays, heldDelayTimes, orderChecks };
}
