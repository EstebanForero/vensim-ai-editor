import { ModelError } from "../model/errors.js";
import { lookupScopeOf } from "../model/lookup.js";
import { allVariables, type Model } from "../model/types.js";
import { collectVarNames, evaluate, tryParseExpr, type EvalEnv, type Expr, type LookupTable } from "../mdl/expr/index.js";
import { lowerDelays } from "./lowerDelays.js";
import { topoSort } from "./topo.js";

export interface SimResult {
  time: number[];
  series: Record<string, number[]>;
}

interface CompiledVar {
  id: string;
  name: string;
  expr: Expr;
}

interface Compiled {
  nameToId: Map<string, string>;
  auxAndFlowOrder: CompiledVar[];
  stockInit: CompiledVar[];
  lookups: Map<string, LookupTable>;
  /** Names of variables that ARE lookup definitions. They're callable functions, not values, so
   * they're left out of the per-step evaluation order and out of `series` entirely. */
  lookupNames: Set<string>;
}

function compile(model: Model): Compiled {
  const nameToId = new Map<string, string>();
  for (const v of allVariables(model)) nameToId.set(v.name, v.id);
  const knownNames = [...nameToId.keys()];
  const lookups = lookupScopeOf(model);

  const auxVars: CompiledVar[] = model.auxiliaries
    .filter((a) => !lookups.has(a.name))
    .map((a) => ({
      id: a.id,
      name: a.name,
      expr: parseOrThrow(a.name, a.equation, knownNames),
    }));
  const flowVars: CompiledVar[] = model.flows.map((f) => ({
    id: f.id,
    name: f.name,
    expr: parseOrThrow(f.name, f.equation, knownNames),
  }));
  const combined = [...auxVars, ...flowVars];
  const idToDeps = new Map<string, string[]>();
  for (const v of combined) {
    const names = [...collectVarNames(v.expr)];
    idToDeps.set(
      v.id,
      names.map((n) => nameToId.get(n)).filter((x): x is string => !!x),
    );
  }
  const order = topoSort(combined.map((v) => ({ id: v.id, dependsOn: idToDeps.get(v.id) ?? [] })));
  const byId = new Map(combined.map((v) => [v.id, v]));
  const auxAndFlowOrder = order.map((id) => byId.get(id)).filter((x): x is CompiledVar => !!x);

  const stockInit: CompiledVar[] = model.stocks.map((s) => ({
    id: s.id,
    name: s.name,
    expr: parseOrThrow(s.name, s.initialEquation, knownNames),
  }));

  return { nameToId, auxAndFlowOrder, stockInit, lookups, lookupNames: new Set(lookups.keys()) };
}

function parseOrThrow(varName: string, eq: string, knownNames: string[]): Expr {
  const parsed = tryParseExpr(eq, knownNames);
  if (!parsed) throw new ModelError(`Could not parse equation for "${varName}": ${eq}`);
  return parsed;
}

/** Evaluates all auxiliaries/flows given current stock values and time, returning the full
 * name->value environment they were computed against. */
function computeEnv(model: Model, compiled: Compiled, stockValues: Map<string, number>, time: number): EvalEnv {
  const env: EvalEnv = Object.create(null);
  env["Time"] = time;
  for (const s of model.stocks) env[s.name] = stockValues.get(s.id) ?? 0;

  for (const v of compiled.auxAndFlowOrder) {
    env[v.name] = evaluate(v.expr, env, compiled.lookups);
  }
  // The clock wins, whatever the model contains. A variable named `Time` can't be created
  // through the builder (it's in RESERVED_NAMES), but one can still arrive in an imported .mdl —
  // and if it did, the loop above would have overwritten the clock and every equation reading it
  // would silently get the wrong value for the rest of the run. Re-asserting it here means the
  // worst case is a variable that's ignored (and flagged by validateModel) rather than a model
  // that quietly computes the wrong answer.
  env["Time"] = time;
  return env;
}

function stockDerivatives(model: Model, compiled: Compiled, stockValues: Map<string, number>, time: number): Map<string, number> {
  const env = computeEnv(model, compiled, stockValues, time);
  const derivs = new Map<string, number>();
  for (const s of model.stocks) {
    let d = 0;
    for (const fid of s.inflows) {
      const flow = model.flows.find((f) => f.id === fid);
      if (flow) d += env[flow.name] ?? 0;
    }
    for (const fid of s.outflows) {
      const flow = model.flows.find((f) => f.id === fid);
      if (flow) d -= env[flow.name] ?? 0;
    }
    derivs.set(s.id, d);
  }
  return derivs;
}

export function simulate(original: Model): SimResult {
  // Delay/smoothing builtins become ordinary stocks and flows first, so the integrator below
  // needs no notion of them at all — see lowerDelays.ts for why that beats evaluating them. The
  // series are collected from the ORIGINAL model, which is what keeps the generated delay state
  // out of the charts.
  const { model, delayStockIds } = lowerDelays(original);
  const compiled = compile(model);
  const { startTime, stopTime, dt, integrationMethod } = model.simSpec;
  if (dt <= 0) throw new ModelError("Time step (dt) must be positive.");
  const steps = Math.round((stopTime - startTime) / dt);

  const time: number[] = [];
  const series: Record<string, number[]> = Object.create(null);
  // A lookup definition gets no series: it has no value at a timestep, it's a curve. Including
  // one would put a meaningless flat line (always 0) on every chart and in run_simulation's
  // output for a variable that isn't really a variable.
  const seriesVars = allVariables(original).filter((v) => !compiled.lookupNames.has(v.name));
  for (const v of seriesVars) series[v.name] = [];

  let stockValues = new Map<string, number>();
  const initEnv: EvalEnv = Object.create(null);
  initEnv["Time"] = startTime;

  // The model's own stocks, in dependency order: an initial equation may reference another stock
  // (`Inventory = INTEG(..., Capacity)`), and evaluating those in declaration order would read a
  // stock that hasn't been set yet. Dependencies on anything that isn't a stock initial — a
  // constant, Time — are ignored by topoSort, and are available in `initEnv` regardless.
  const ownInit = compiled.stockInit.filter((s) => !delayStockIds.has(s.id));
  const orderedInit = topoSort(
    ownInit.map((s) => ({
      id: s.id,
      dependsOn: [...collectVarNames(s.expr)].map((n) => compiled.nameToId.get(n)).filter((x): x is string => !!x),
    })),
  );
  const initById = new Map(ownInit.map((s) => [s.id, s]));
  for (const id of orderedInit) {
    const s = initById.get(id);
    if (!s) continue;
    const value = evaluate(s.expr, initEnv, compiled.lookups);
    stockValues.set(s.id, value);
    initEnv[s.name] = value;
  }

  // Delay state settles at whatever its input produces at the initial time, and that input is
  // normally an expression over auxiliaries and flows — which only exist once the initial state
  // above is known. So these are evaluated against the model's fully-computed t0 environment
  // rather than alongside it.
  if (delayStockIds.size > 0) {
    const t0 = computeEnv(model, compiled, stockValues, startTime);
    for (const s of compiled.stockInit) {
      if (delayStockIds.has(s.id)) stockValues.set(s.id, evaluate(s.expr, t0, compiled.lookups));
    }
  }

  for (let step = 0; step <= steps; step++) {
    const t = startTime + step * dt;
    const env = computeEnv(model, compiled, stockValues, t);
    time.push(t);
    for (const v of seriesVars) {
      series[v.name]!.push(env[v.name] ?? 0);
    }

    if (step === steps) break;

    if (integrationMethod === "rk4") {
      const k1 = stockDerivatives(model, compiled, stockValues, t);
      const s2 = addScaled(stockValues, k1, dt / 2);
      const k2 = stockDerivatives(model, compiled, s2, t + dt / 2);
      const s3 = addScaled(stockValues, k2, dt / 2);
      const k3 = stockDerivatives(model, compiled, s3, t + dt / 2);
      const s4 = addScaled(stockValues, k3, dt);
      const k4 = stockDerivatives(model, compiled, s4, t + dt);
      const next = new Map<string, number>();
      for (const s of model.stocks) {
        const v0 = stockValues.get(s.id) ?? 0;
        const sum = (k1.get(s.id) ?? 0) + 2 * (k2.get(s.id) ?? 0) + 2 * (k3.get(s.id) ?? 0) + (k4.get(s.id) ?? 0);
        next.set(s.id, v0 + (dt / 6) * sum);
      }
      stockValues = next;
    } else {
      const d = stockDerivatives(model, compiled, stockValues, t);
      stockValues = addScaled(stockValues, d, dt);
    }
  }

  return { time, series };
}

function addScaled(base: Map<string, number>, delta: Map<string, number>, scale: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of base) out.set(k, v + (delta.get(k) ?? 0) * scale);
  return out;
}
