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
// So each call site becomes what the engine already integrates correctly:
//
//   DELAY1(Input, D)  →  stock `Delay of X`       initial = Input
//                         flow  `Delay of X Rate` = (Input − `Delay of X`) / D  → into it
//                         the call site replaced by a reference to that stock
//
// DELAY3/SMOOTH3/DELAY N expand to N stages in series, each a first-order lag of the total time
// divided by N — three lags of D/3 is a third-order delay of D, not three delays of D. Every
// stage is initialized to the input expression, which is the steady state the chain would settle
// at and is what Vensim's own DELAY1/DELAY3 do.
//
// This returns a COPY. The model being edited is never touched, so the synthetic stocks never
// reach the canvas, the .mdl writer, validation, or the units check — all of which run on the
// original. `simulate` takes its output series from the original model too, so delay state stays
// out of the charts.

import { ModelError } from "../model/errors.js";
import type { Expr } from "../mdl/expr/ast.js";
import { tryParseExpr } from "../mdl/expr/parser.js";
import { exprToString, quoteRefIfNeeded } from "../mdl/expr/printer.js";
import { addFlow, addStock } from "../model/builder/index.js";
import { allVariables, isReservedName, type Model } from "../model/types.js";

/** Vensim's delay and smoothing family, mapped to the number of first-order lags each expands
 * to. `DELAY N` takes its order from a third argument instead, so it isn't listed here. */
const FIXED_STAGES: Record<string, number> = {
  DELAY1: 1,
  SMOOTH: 1,
  DELAY3: 3,
  SMOOTH3: 3,
};

/** What the lexer squashes Vensim's spaced `DELAY N` into (see expr/lexer.ts's
 * MULTI_WORD_FUNCTIONS), and therefore the name a parsed call node carries. */
const ORDER_FROM_ARGUMENT = "DELAY_N";

/**
 * Is this call one of the delay family this codebase understands?
 *
 * Deliberately separate from `stagesOf`, which validates the order argument: this one answers
 * only "is it a delay at all", and is used both to decide whether an equation needs rewriting and
 * — by the archetype detectors, which care that a path is slow rather than by how much — to read
 * a delay out of an equation without simulating it.
 */
export function isDelayFunction(name: string): boolean {
  const upper = name.toUpperCase();
  return FIXED_STAGES[upper] !== undefined || upper === ORDER_FROM_ARGUMENT;
}

/** How many first-order lags a call expands to, or null if it isn't a delay. Throws for a
 * `DELAY N` whose order isn't a literal whole number — Vensim requires a constant there too, and
 * a delay whose size can't be read is one this can't lower without guessing. */
function stagesOf(call: { name: string; args: Expr[] }): number | null {
  const upper = call.name.toUpperCase();
  const fixed = FIXED_STAGES[upper];
  if (fixed !== undefined) return fixed;
  if (upper !== ORDER_FROM_ARGUMENT) return null;
  const order = call.args[2];
  if (!order) return 1; // Vensim's default order for `DELAY N(x, d)`
  if (order.type !== "num" || !Number.isInteger(order.value) || order.value < 1) {
    throw new ModelError(`DELAY N needs a literal whole-number order as its third argument.`);
  }
  return order.value;
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

interface Lowering {
  model: Model;
  name: (owner: string, stage: number, stages: number, suffix?: string) => string;
  delayStockIds: Set<string>;
}

export interface LoweredModel {
  model: Model;
  /**
   * Ids of the stocks this pass generated to hold delay state.
   *
   * They are initialized differently from a model's own stocks: a delay's output starts at its
   * input's value *at the initial time*, and that input is usually an expression over
   * auxiliaries and flows — which don't exist until the model's own initial state is known. So
   * `simulate` settles the real stocks first and then evaluates these against the resulting
   * environment, rather than alongside them.
   */
  delayStockIds: ReadonlySet<string>;
}

/**
 * Builds the stage chain for one delay call and returns the name of its final stage — the value
 * the call evaluates to. `args` are already lowered, so a delay nested inside this one's input
 * already refers to its own state.
 */
function buildStages(ctx: Lowering, owner: string, args: Expr[], stages: number): string {
  const input = args[0];
  const delayTime = args[1];
  if (!input || !delayTime) {
    throw new ModelError(`A delay on "${owner}" needs both an input and a delay time.`);
  }
  const inputExpr = exprToString(input);
  // A constant delay time is by far the common case, and `exprToString` may respell it (4 as 4,
  // but `2 + 3` stays `2 + 3`), so this is built from the expression rather than from a number.
  const tau = stages === 1 ? exprToString(delayTime) : `(${exprToString(delayTime)} / ${stages})`;

  let previous = inputExpr;
  let last = "";
  for (let stage = 1; stage <= stages; stage++) {
    const name = ctx.name(owner, stage, stages);
    const stock = addStock(ctx.model, {
      name,
      initialEquation: inputExpr,
      comment:
        `Simulator-generated state for the delay on "${owner}" — not part of the model as drawn. ` +
        `Holds the value the delay is currently passing through.`,
    });
    ctx.delayStockIds.add(stock.id);
    addFlow(ctx.model, {
      name: ctx.name(owner, stage, stages, " Rate"),
      equation: `(${previous} - ${quoteRefIfNeeded(name)}) / ${tau}`,
      to: stock.id,
    });
    previous = quoteRefIfNeeded(name);
    last = name;
  }
  return last;
}

/** Rewrites every delay call in `e` into a reference to a newly created stock. Post-order: a
 * delay nested in another delay's input is lowered first, so the outer chain is built from the
 * inner one's output rather than from an expression that no longer evaluates. */
function lowerExpr(e: Expr, ctx: Lowering, owner: string): Expr {
  switch (e.type) {
    case "call": {
      const args = e.args.map((a) => lowerExpr(a, ctx, owner));
      const stages = stagesOf({ name: e.name, args: e.args });
      if (stages === null) return { ...e, args };
      return { type: "var", name: buildStages(ctx, owner, args, stages) };
    }
    case "unary":
      return { ...e, arg: lowerExpr(e.arg, ctx, owner) };
    case "binary":
      return { ...e, left: lowerExpr(e.left, ctx, owner), right: lowerExpr(e.right, ctx, owner) };
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
  const ctx: Lowering = { model: lowered, name: makeNamer(lowered), delayStockIds };

  const rewrite = (owner: string, get: () => string, set: (value: string) => void): void => {
    const parsed = tryParseExpr(get(), knownNames);
    if (!parsed || !containsDelay(parsed)) return;
    set(exprToString(lowerExpr(parsed, ctx, owner)));
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

  return { model: lowered, delayStockIds };
}
