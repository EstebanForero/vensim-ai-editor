// A small, runnable model for each archetype — what the report offers to open.
//
// These are deliberately tiny: a handful of variables that behave like the archetype when run, so
// the pattern is something you can watch rather than only read. They are also the archetype's own
// acceptance test: packages/core/test/archetypes.test.ts asserts that each one is detected as the
// archetype it is filed under, so an example and its detector can't drift apart without the suite
// saying so.
//
// They live in core rather than beside the web app's sample models because they're model data
// with no UI in them, and because that self-consistency test belongs next to the detector.

import { addAuxiliary, addConstant, addConnector, addFlow, addStock } from "../model/builder/index.js";
import { createEmptyModel, type Model } from "../model/types.js";
import type { ArchetypeId } from "./types.js";

const YEARS = { startTime: 0, stopTime: 60, dt: 0.125, integrationMethod: "rk4", timeUnits: "Year" } as const;

/** Growth that runs into a limit: births compound, but crowding raises the death rate until the
 * two balance and the population levels off. */
function limitsToGrowth(): Model {
  const model = createEmptyModel("Limits to Growth — Population and Carrying Capacity");
  const pop = addStock(model, {
    name: "Population",
    initialEquation: "100",
    units: "People",
    comment: "Grows while births outpace deaths; levels off as crowding raises the death rate.",
    pos: { x: 380, y: 200 },
  });
  addFlow(model, { name: "Births", equation: "Population * Birth Rate", to: pop.id, units: "People/Year", pos: { x: 200, y: 200 } });
  addFlow(model, { name: "Deaths", equation: "Population * Death Rate", from: pop.id, units: "People/Year", pos: { x: 560, y: 200 } });
  addConstant(model, { name: "Birth Rate", value: 0.1, units: "1/Year", pos: { x: 200, y: 320 } });
  addConstant(model, { name: "Base Death Rate", value: 0.02, units: "1/Year", pos: { x: 560, y: 400 } });
  addConstant(model, { name: "Capacity", value: 1000, units: "People", pos: { x: 680, y: 480 } });
  addAuxiliary(model, {
    name: "Death Rate",
    equation: "Base Death Rate * (1 + Population / Capacity)",
    units: "1/Year",
    comment: "Rises with the population's own size — this is the constraint the R loop runs into.",
    pos: { x: 560, y: 320 },
  });
  addConnector(model, { from: "Population", to: "Births" });
  addConnector(model, { from: "Birth Rate", to: "Births" });
  addConnector(model, { from: "Population", to: "Death Rate" });
  addConnector(model, { from: "Base Death Rate", to: "Death Rate" });
  addConnector(model, { from: "Capacity", to: "Death Rate" });
  addConnector(model, { from: "Death Rate", to: "Deaths" });
  model.simSpec = { ...YEARS };
  return model;
}

/** Two farms drawing on one aquifer. Each draw looks reasonable on its own; together they drain
 * it, and neither equation contains the other's. */
function tragedyOfTheCommons(): Model {
  const model = createEmptyModel("Tragedy of the Commons — Two Farms, One Aquifer");
  const water = addStock(model, {
    name: "Agua disponible",
    initialEquation: "1000",
    units: "m3",
    comment: "The shared resource. Neither farmer's equation mentions the other, but both drain this.",
    pos: { x: 340, y: 200 },
  });
  addFlow(model, { name: "Extraccion A", equation: "Agua disponible * Tasa de extraccion A", from: water.id, units: "m3/Month", pos: { x: 160, y: 200 } });
  addFlow(model, { name: "Extraccion B", equation: "Agua disponible * Tasa de extraccion B", from: water.id, units: "m3/Month", pos: { x: 520, y: 200 } });
  addConstant(model, { name: "Tasa de extraccion A", value: 0.08, units: "1/Month", pos: { x: 160, y: 320 } });
  addConstant(model, { name: "Tasa de extraccion B", value: 0.06, units: "1/Month", pos: { x: 520, y: 320 } });
  addConnector(model, { from: "Agua disponible", to: "Extraccion A" });
  addConnector(model, { from: "Tasa de extraccion A", to: "Extraccion A" });
  addConnector(model, { from: "Agua disponible", to: "Extraccion B" });
  addConnector(model, { from: "Tasa de extraccion B", to: "Extraccion B" });
  model.simSpec = { ...YEARS, stopTime: 48, timeUnits: "Month" };
  return model;
}

/** An arms race. Each side builds because it feels behind, and building puts the other side
 * further behind — so a small early lead widens instead of settling. */
function escalation(): Model {
  const model = createEmptyModel("Escalation — Arms Race");
  const a = addStock(model, { name: "Misiles A", initialEquation: "120", units: "Missiles", comment: "Starts slightly ahead — and the lead grows.", pos: { x: 200, y: 120 } });
  const b = addStock(model, { name: "Misiles B", initialEquation: "100", units: "Missiles", pos: { x: 560, y: 120 } });
  // MAX(0, ...) because a stockpile can stop growing but never un-build: without it the side
  // that falls behind gets a negative production rate and a negative arsenal.
  addFlow(model, { name: "Produccion A", equation: "MAX(0, Misiles A - Misiles B + Umbral) * Tasa de produccion", to: a.id, units: "Missiles/Year", pos: { x: 380, y: 60 } });
  addFlow(model, { name: "Produccion B", equation: "MAX(0, Misiles B - Misiles A + Umbral) * Tasa de produccion", to: b.id, units: "Missiles/Year", pos: { x: 380, y: 320 } });
  addConstant(model, { name: "Umbral", value: 50, units: "Missiles", comment: "Each side arms even at parity.", pos: { x: 380, y: 420 } });
  addConstant(model, { name: "Tasa de produccion", value: 0.05, units: "1/Year", pos: { x: 250, y: 420 } });
  addConnector(model, { from: "Misiles A", to: "Produccion A" });
  addConnector(model, { from: "Misiles A", to: "Produccion B", polarity: "-" });
  addConnector(model, { from: "Misiles B", to: "Produccion B" });
  addConnector(model, { from: "Misiles B", to: "Produccion A", polarity: "-" });
  addConnector(model, { from: "Umbral", to: "Produccion A" });
  addConnector(model, { from: "Umbral", to: "Produccion B" });
  addConnector(model, { from: "Tasa de produccion", to: "Produccion A" });
  addConnector(model, { from: "Tasa de produccion", to: "Produccion B" });
  model.simSpec = { ...YEARS, stopTime: 40 };
  return model;
}

/** Two activities sharing one pool of resources, where each one's success feeds the pool it draws
 * on. The one with better access takes more of it, so its lead widens. */
function successToTheSuccessful(): Model {
  const model = createEmptyModel("Success to the Successful — Two Activities, One Budget");
  const a = addStock(model, { name: "Actividad A", initialEquation: "12", units: "Projects", pos: { x: 160, y: 200 } });
  const b = addStock(model, { name: "Actividad B", initialEquation: "10", units: "Projects", pos: { x: 560, y: 200 } });
  addFlow(model, { name: "Recursos para A", equation: "Reparto * Acceso A", to: a.id, units: "Projects/Year", pos: { x: 160, y: 80 } });
  addFlow(model, { name: "Recursos para B", equation: "Reparto * Acceso B", to: b.id, units: "Projects/Year", pos: { x: 560, y: 80 } });
  addAuxiliary(model, {
    name: "Reparto",
    equation: "Exito A + Exito B",
    units: "Projects",
    comment: "The shared pool. Both loops pass through it — that is what makes this one system.",
    pos: { x: 360, y: 200 },
  });
  addAuxiliary(model, { name: "Exito A", equation: "Actividad A", units: "Projects", pos: { x: 160, y: 320 } });
  addAuxiliary(model, { name: "Exito B", equation: "Actividad B", units: "Projects", pos: { x: 560, y: 320 } });
  // A draws half again as much of the pool as B — the asymmetry the archetype turns on, and the
  // only place in the model where it is stated.
  addConstant(model, { name: "Acceso A", value: 0.06, units: "1/Year", comment: "A's rate of draw on the pool.", pos: { x: 60, y: 420 } });
  addConstant(model, { name: "Acceso B", value: 0.04, units: "1/Year", pos: { x: 660, y: 420 } });
  for (const [stock, success, flow, access] of [
    ["Actividad A", "Exito A", "Recursos para A", "Acceso A"],
    ["Actividad B", "Exito B", "Recursos para B", "Acceso B"],
  ] as const) {
    addConnector(model, { from: "Reparto", to: flow });
    addConnector(model, { from: access, to: flow });
    addConnector(model, { from: stock, to: success });
    addConnector(model, { from: success, to: "Reparto" });
  }
  model.simSpec = { ...YEARS, stopTime: 40 };
  return model;
}

/** A fix that works, and a side effect that undoes it — so the problem comes down, then climbs
 * back, and more of the fix is applied.
 *
 * The side effect has to *accumulate* for the rebound to happen at all: with both the relief and
 * the side effect proportional to the problem itself, the model is linear and can only decay or
 * grow, never turn around. So the consequence feeds a stock, and that stock drives the problem
 * back up — which is the shape the archetype actually describes. */
function fixesThatFail(): Model {
  const model = createEmptyModel("Fixes that Fail — Relief and Rebound");
  const problem = addStock(model, { name: "Problema", initialEquation: "100", units: "Cases", comment: "Falls while the remedy is applied, then comes back.", pos: { x: 360, y: 200 } });
  const damage = addStock(model, { name: "Danio acumulado", initialEquation: "0", units: "Cases/Month", comment: "The accumulated side effect. It is what makes the rebound possible.", pos: { x: 120, y: 400 } });
  addFlow(model, { name: "Aparicion", equation: "Problema * Tasa base + Danio acumulado", to: problem.id, units: "Cases/Month", pos: { x: 180, y: 200 } });
  addFlow(model, { name: "Alivio", equation: "Remedio", from: problem.id, units: "Cases/Month", pos: { x: 540, y: 200 } });
  addFlow(model, { name: "Efecto secundario", equation: "Remedio * Tasa de efecto", to: damage.id, units: "Cases/Month/Month", pos: { x: 120, y: 280 } });
  addAuxiliary(model, { name: "Remedio", equation: "Problema * Intensidad", units: "Cases/Month", comment: "The fix, applied in proportion to the problem — so it grows with it.", pos: { x: 600, y: 80 } });
  addConstant(model, { name: "Intensidad", value: 0.3, units: "1/Month", pos: { x: 720, y: 20 } });
  addConstant(model, { name: "Tasa base", value: 0.1, units: "1/Month", pos: { x: 40, y: 120 } });
  // Small on purpose: at 0.3 the accumulated damage overwhelms the relief within a couple of
  // months and the model explodes. At 0.05 the problem dips to about a third, then recovers past
  // where it started — which is the story the archetype tells.
  addConstant(model, { name: "Tasa de efecto", value: 0.05, units: "1/Month", pos: { x: 20, y: 280 } });
  addConnector(model, { from: "Problema", to: "Aparicion" });
  addConnector(model, { from: "Tasa base", to: "Aparicion" });
  addConnector(model, { from: "Danio acumulado", to: "Aparicion" });
  addConnector(model, { from: "Problema", to: "Remedio" });
  addConnector(model, { from: "Intensidad", to: "Remedio" });
  addConnector(model, { from: "Remedio", to: "Alivio" });
  addConnector(model, { from: "Remedio", to: "Efecto secundario" });
  addConnector(model, { from: "Tasa de efecto", to: "Efecto secundario" });
  model.simSpec = { ...YEARS, stopTime: 60, timeUnits: "Month" };
  return model;
}

/** A problem with two solutions: one that relieves it now, and one that would fix it for good but
 * takes years — while the quick relief erodes the capacity the slow one depends on. */
function shiftingTheBurden(): Model {
  const model = createEmptyModel("Shifting the Burden — Relief vs Rebuilding");
  const problem = addStock(model, { name: "Problema", initialEquation: "100", units: "Cases", comment: "Held down by whichever solution is doing the work.", pos: { x: 380, y: 200 } });
  const capacity = addStock(model, {
    name: "Capacidad",
    initialEquation: "50",
    units: "Cases/Month",
    comment: "How fast the fundamental solution can work — and what the relief quietly erodes.",
    pos: { x: 700, y: 380 },
  });
  addFlow(model, { name: "Aparicion", equation: "Problema * Tasa de aparicion", to: problem.id, units: "Cases/Month", pos: { x: 200, y: 200 } });
  addFlow(model, { name: "Alivio rapido", equation: "Problema * Intensidad del paliativo", from: problem.id, units: "Cases/Month", pos: { x: 560, y: 120 } });
  addFlow(model, { name: "Solucion fundamental", equation: "Movimiento", from: problem.id, units: "Cases/Month", pos: { x: 560, y: 300 } });
  addAuxiliary(model, {
    name: "Movimiento",
    // Written on its own node rather than inlined, so the delay sits on a variable the loop
    // visibly passes through: this equation is what the report reads to tell the two paths apart.
    // MIN because the fundamental solution can only work as fast as its capacity allows.
    equation: "DELAY1(MIN(Problema * Tasa de cobertura, Capacidad), 8)",
    units: "Cases/Month",
    comment: "The fundamental solution — it takes months to have any effect. That delay is the whole difference between the two paths.",
    pos: { x: 700, y: 240 },
  });
  // Flows, not connectors: a variable only accumulates what a *flow* carries, so wiring these as
  // relations would leave the capacity sitting at its initial value for the whole run.
  addFlow(model, { name: "Desarrollo", equation: "Tasa de desarrollo", to: capacity.id, units: "Cases/Month/Month", comment: "Capacity is rebuilt at a steady rate — unless the relief is eating it.", pos: { x: 880, y: 440 } });
  addFlow(model, {
    name: "Erosion",
    equation: "Alivio rapido * Tasa de erosion",
    from: capacity.id,
    units: "Cases/Month/Month",
    comment: "The side effect: the quicker the relief, the faster the durable capacity is used up.",
    pos: { x: 560, y: 440 },
  });
  addConstant(model, { name: "Tasa de aparicion", value: 0.25, units: "1/Month", pos: { x: 60, y: 120 } });
  addConstant(model, {
    name: "Intensidad del paliativo",
    value: 0.28,
    units: "1/Month",
    comment: "Just enough to outpace the problem — which is why the relief, not the cure, does the work.",
    pos: { x: 460, y: 30 },
  });
  addConstant(model, { name: "Tasa de cobertura", value: 0.02, units: "1/Month", pos: { x: 700, y: 140 } });
  addConstant(model, { name: "Tasa de desarrollo", value: 0.6, units: "Cases/Month/Month", pos: { x: 960, y: 500 } });
  addConstant(model, { name: "Tasa de erosion", value: 0.05, units: "1/Month", pos: { x: 460, y: 540 } });
  addConnector(model, { from: "Problema", to: "Aparicion" });
  addConnector(model, { from: "Tasa de aparicion", to: "Aparicion" });
  addConnector(model, { from: "Problema", to: "Alivio rapido" });
  addConnector(model, { from: "Intensidad del paliativo", to: "Alivio rapido" });
  addConnector(model, { from: "Problema", to: "Movimiento" });
  addConnector(model, { from: "Capacidad", to: "Movimiento" });
  addConnector(model, { from: "Tasa de cobertura", to: "Movimiento" });
  addConnector(model, { from: "Movimiento", to: "Solucion fundamental" });
  addConnector(model, { from: "Tasa de desarrollo", to: "Desarrollo" });
  addConnector(model, { from: "Alivio rapido", to: "Erosion" });
  addConnector(model, { from: "Tasa de erosion", to: "Erosion" });
  model.simSpec = { ...YEARS, stopTime: 36, timeUnits: "Month" };
  return model;
}

const BUILDERS: Record<ArchetypeId, () => Model> = {
  "limits-to-growth": limitsToGrowth,
  "tragedy-of-the-commons": tragedyOfTheCommons,
  escalation,
  "success-to-the-successful": successToTheSuccessful,
  "fixes-that-fail": fixesThatFail,
  "shifting-the-burden": shiftingTheBurden,
};

/** A fresh copy of this archetype's example model, ready to load into the editor. */
export function buildArchetypeExample(id: ArchetypeId): Model {
  return BUILDERS[id]();
}
