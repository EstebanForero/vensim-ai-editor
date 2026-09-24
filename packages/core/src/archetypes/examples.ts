// A small, runnable model for each archetype — what the report offers to open.
//
// These are deliberately tiny: the textbook base case for each pattern and nothing else, so the
// archetype is something you can watch rather than only read. Each one is checked twice over, from
// both directions: `archetypes.test.ts` asserts that the structural detector reads it as the
// archetype it is filed under, and that its *run* has the shape the archetype is drawn with (see
// curve.ts, and the `curve` field on each row in registry.ts). An example and its detector can't
// drift apart, and an example can't stop behaving like its archetype, without the suite saying so.
//
// They live in core rather than beside the web app's sample models because they're model data
// with no UI in them, and because those checks belong next to the detector.

import { addAuxiliary, addConstant, addConnector, addFlow, addStock } from "../model/builder/index.js";
import { createEmptyModel, type Model } from "../model/types.js";
import type { ArchetypeId } from "./types.js";

const YEARS = { startTime: 0, stopTime: 60, dt: 0.125, integrationMethod: "rk4", timeUnits: "Year" } as const;

/** Births compound; crowding raises the death rate towards the birth rate; the population levels
 * off at the carrying capacity instead of continuing. */
function limitsToGrowth(): Model {
  const model = createEmptyModel("Limits to Growth — Population and Carrying Capacity");
  const pop = addStock(model, {
    name: "Poblacion",
    initialEquation: "100",
    units: "People",
    comment: "Grows while births outpace deaths; levels off as crowding raises the death rate.",
    pos: { x: 380, y: 200 },
  });
  addFlow(model, { name: "Nacimientos", equation: "Poblacion * Tasa de natalidad", to: pop.id, units: "People/Year", pos: { x: 200, y: 200 } });
  addFlow(model, { name: "Muertes", equation: "Poblacion * Tasa de mortalidad", from: pop.id, units: "People/Year", pos: { x: 560, y: 200 } });
  addConstant(model, { name: "Tasa de natalidad", value: 0.1, units: "1/Year", pos: { x: 200, y: 320 } });
  addConstant(model, { name: "Tasa base de mortalidad", value: 0.02, units: "1/Year", pos: { x: 560, y: 400 } });
  addConstant(model, { name: "Capacidad de carga", value: 4000, units: "People", comment: "Where births and deaths balance — what the population levels off at.", pos: { x: 680, y: 480 } });
  // Written this way so the constant above means what its name says: mortality climbs from its
  // base to the birth rate as the population approaches the capacity, and the two meet there.
  addAuxiliary(model, {
    name: "Tasa de mortalidad",
    equation: "Tasa base de mortalidad + (Tasa de natalidad - Tasa base de mortalidad) * Poblacion / Capacidad de carga",
    units: "1/Year",
    comment: "Rises with the population's own size — the constraint the R loop runs into.",
    pos: { x: 560, y: 320 },
  });
  addConnector(model, { from: "Poblacion", to: "Nacimientos" });
  addConnector(model, { from: "Tasa de natalidad", to: "Nacimientos" });
  addConnector(model, { from: "Poblacion", to: "Tasa de mortalidad" });
  addConnector(model, { from: "Tasa base de mortalidad", to: "Tasa de mortalidad" });
  addConnector(model, { from: "Capacidad de carga", to: "Tasa de mortalidad" });
  addConnector(model, { from: "Tasa de natalidad", to: "Tasa de mortalidad" });
  addConnector(model, { from: "Tasa de mortalidad", to: "Muertes" });
  model.simSpec = { ...YEARS, stopTime: 100 };
  return model;
}

/**
 * Two farms drawing on one aquifer.
 *
 * The whole test of this archetype is that the *second* farm is what causes the depletion, so the
 * aquifer has to be able to sustain one. It refills on its own, fastest when it is half full —
 * `Tasa de recarga * Capacidad / 4` = 15,000 m3/Month, the most it can yield forever. Farm A takes
 * four per cent of whatever is in it, which is under the regrowth rate, so A alone climbs towards
 * 333,000 m3 and settles. Farm B takes the same four per cent on top; together they take more than
 * the aquifer regrows, and it drains.
 *
 * This is the standard harvest model — catch is proportional to stock and effort — and it is the
 * smallest thing that has the archetype's shape. The wrinkle is that B is drilled ten years in
 * rather than being there from the start, because the curve the pattern is drawn with has three
 * phases: abundant and stable, then overuse and a peak, then collapse. A stock that is over-drawn
 * from the first day just falls away from its starting value, which is a different and much less
 * interesting picture. Use has to *grow*, which is what "more people use the common resource"
 * means, and phase one is the ten years where the aquifer is climbing towards what one farm alone
 * would leave it at.
 */
function tragedyOfTheCommons(): Model {
  const model = createEmptyModel("Tragedy of the Commons — Two Farms, One Aquifer");
  const water = addStock(model, {
    name: "Agua disponible",
    initialEquation: "250000",
    units: "m3",
    comment: "The shared aquifer. It refills on its own — but only so fast.",
    pos: { x: 340, y: 200 },
  });
  addFlow(model, {
    name: "Recarga",
    equation: "Tasa de recarga * Agua disponible * (1 - Agua disponible / Capacidad del acuifero)",
    to: water.id,
    units: "m3/Month",
    comment: "Regrowth, fastest at half full and zero at empty or full. Its peak is the most this aquifer can yield forever.",
    pos: { x: 340, y: 60 },
  });
  addFlow(model, {
    name: "Extraccion A",
    equation: "Agua disponible * Tasa de extraccion A",
    from: water.id,
    units: "m3/Month",
    comment: "Farm A takes a quarter of what is there. Nothing in this equation mentions Farm B.",
    pos: { x: 150, y: 200 },
  });
  addFlow(model, {
    name: "Extraccion B",
    equation: "Agua disponible * Tasa de extraccion B",
    from: water.id,
    units: "m3/Month",
    comment: "The same quarter as A, once the farm is running — and just as reasonable read on its own.",
    pos: { x: 530, y: 200 },
  });
  addAuxiliary(model, {
    name: "Tasa de extraccion B",
    equation: "Tasa de extraccion A * MIN(1, MAX(0, Time - Retraso de B) / Tiempo de llegada)",
    units: "1/Month",
    comment: "B's share of the aquifer: none until it is drilled, then built up to A's.",
    pos: { x: 700, y: 320 },
  });
  addConstant(model, { name: "Capacidad del acuifero", value: 1000000, units: "m3", pos: { x: 520, y: 60 } });
  addConstant(model, { name: "Tasa de recarga", value: 0.06, units: "1/Month", comment: "Peak recharge is Tasa * Capacidad / 4 — 15,000 m3/Month, the sustainable yield.", pos: { x: 700, y: 60 } });
  addConstant(model, { name: "Tasa de extraccion A", value: 0.04, units: "1/Month", comment: "Under the 0.06 regrowth rate, so this farm alone is sustainable.", pos: { x: 150, y: 320 } });
  addConstant(model, { name: "Retraso de B", value: 120, units: "Month", comment: "Farm B is drilled ten years in. Until then the aquifer is feeding one farm, and it is fine.", pos: { x: 880, y: 300 } });
  addConstant(model, { name: "Tiempo de llegada", value: 40, units: "Month", comment: "How long farm B takes to reach full demand once it starts.", pos: { x: 880, y: 360 } });
  addConnector(model, { from: "Agua disponible", to: "Recarga" });
  addConnector(model, { from: "Tasa de recarga", to: "Recarga" });
  addConnector(model, { from: "Capacidad del acuifero", to: "Recarga" });
  addConnector(model, { from: "Agua disponible", to: "Extraccion A" });
  addConnector(model, { from: "Tasa de extraccion A", to: "Extraccion A" });
  addConnector(model, { from: "Agua disponible", to: "Extraccion B" });
  addConnector(model, { from: "Tasa de extraccion B", to: "Extraccion B" });
  addConnector(model, { from: "Tasa de extraccion A", to: "Tasa de extraccion B" });
  addConnector(model, { from: "Retraso de B", to: "Tasa de extraccion B" });
  addConnector(model, { from: "Tiempo de llegada", to: "Tasa de extraccion B" });
  model.simSpec = { ...YEARS, stopTime: 400, timeUnits: "Month" };
  return model;
}

/** An arms race. Each side builds *because* the other has missiles — so neither can stop, and the
 * race has no resting point.
 *
 * The giveaway that this is the right way round is the counterfactual: take the rival's arsenal
 * away and the race simply doesn't start. A version that built in proportion to how far *ahead*
 * each side was had the opposite property — switching the loser's production off made the winner
 * grow faster, which is capitulation, not escalation. */
function escalation(): Model {
  const model = createEmptyModel("Escalation — Arms Race");
  const a = addStock(model, { name: "Misiles A", initialEquation: "120", units: "Missiles", comment: "Starts ahead, and answers faster — so the lead widens.", pos: { x: 200, y: 120 } });
  const b = addStock(model, { name: "Misiles B", initialEquation: "100", units: "Missiles", pos: { x: 560, y: 120 } });
  addFlow(model, {
    name: "Produccion A",
    equation: "Misiles B * Tasa de respuesta A",
    to: a.id,
    units: "Missiles/Year",
    comment: "A builds in response to B's arsenal. Take B away and A never builds another missile.",
    pos: { x: 380, y: 60 },
  });
  addFlow(model, {
    name: "Produccion B",
    equation: "Misiles A * Tasa de respuesta B",
    to: b.id,
    units: "Missiles/Year",
    comment: "The same shape as A's. Neither equation contains a stopping condition, because escalation doesn't have one.",
    pos: { x: 380, y: 320 },
  });
  addConstant(model, { name: "Tasa de respuesta A", value: 0.09, units: "1/Year", comment: "A answers more than twice as hard as B does.", pos: { x: 220, y: 420 } });
  addConstant(model, { name: "Tasa de respuesta B", value: 0.04, units: "1/Year", pos: { x: 540, y: 420 } });
  addConnector(model, { from: "Misiles B", to: "Produccion A" });
  addConnector(model, { from: "Tasa de respuesta A", to: "Produccion A" });
  addConnector(model, { from: "Misiles A", to: "Produccion B" });
  addConnector(model, { from: "Tasa de respuesta B", to: "Produccion B" });
  model.simSpec = { ...YEARS, stopTime: 40 };
  return model;
}

/**
 * Two activities competing for one fixed budget, allocated by track record. The one that is
 * already ahead attracts more of it, so a small early lead becomes total dominance.
 *
 * The budget is *fixed* — that is the archetype's limited resource, and what one activity attracts
 * is what the other doesn't. Allocating it by success is the reinforcing loop. But allocation by
 * success alone is *linear*: both activities then grow at the same rate and the ratio between them
 * never moves, however long you run it. Increasing returns are what turn a two-project head start
 * into a rout, and a track record is the most ordinary form of them there is — `Escala de exito`
 * is the size below which an activity has no results to point at and so attracts nothing at all.
 */
function successToTheSuccessful(): Model {
  const model = createEmptyModel("Success to the Successful — Two Activities, One Budget");
  const a = addStock(model, { name: "Actividad A", initialEquation: "12", units: "Projects", comment: "Ahead from the start — by two projects.", pos: { x: 160, y: 200 } });
  const b = addStock(model, { name: "Actividad B", initialEquation: "10", units: "Projects", pos: { x: 560, y: 200 } });
  addFlow(model, { name: "Recursos para A", equation: "Reparto * Exito A / (Exito A + Exito B)", to: a.id, units: "Projects/Year", pos: { x: 160, y: 80 } });
  addFlow(model, { name: "Recursos para B", equation: "Reparto * Exito B / (Exito A + Exito B)", to: b.id, units: "Projects/Year", pos: { x: 560, y: 80 } });
  addFlow(model, { name: "Cierre A", equation: "Actividad A * Tasa de cierre", from: a.id, units: "Projects/Year", pos: { x: 60, y: 200 } });
  addFlow(model, { name: "Cierre B", equation: "Actividad B * Tasa de cierre", from: b.id, units: "Projects/Year", pos: { x: 660, y: 200 } });
  addAuxiliary(model, { name: "Exito A", equation: "MAX(0, Actividad A - Escala de exito)", units: "Projects", comment: "What A has to show for itself. The scale is subtracted, not a target.", pos: { x: 160, y: 320 } });
  addAuxiliary(model, { name: "Exito B", equation: "MAX(0, Actividad B - Escala de exito)", units: "Projects", pos: { x: 560, y: 320 } });
  addConstant(model, { name: "Reparto", value: 3, units: "Projects/Year", comment: "The budget. Fixed, and the only thing the two activities compete for.", pos: { x: 360, y: 200 } });
  addConstant(model, { name: "Escala de exito", value: 8, units: "Projects", comment: "Below this size an activity attracts nothing — the increasing return the archetype turns on.", pos: { x: 360, y: 480 } });
  addConstant(model, { name: "Tasa de cierre", value: 0.08, units: "1/Year", comment: "Projects finish and leave — what lets the starved activity actually shrink.", pos: { x: 360, y: 100 } });
  for (const [stock, success, flow, close] of [
    ["Actividad A", "Exito A", "Recursos para A", "Cierre A"],
    ["Actividad B", "Exito B", "Recursos para B", "Cierre B"],
  ] as const) {
    addConnector(model, { from: "Reparto", to: flow });
    addConnector(model, { from: success, to: flow });
    addConnector(model, { from: stock, to: success });
    addConnector(model, { from: "Escala de exito", to: success });
    addConnector(model, { from: stock, to: close });
    addConnector(model, { from: "Tasa de cierre", to: close });
  }
  // Each side's share divides by the other's success too. Both can't be zero at once: A starts
  // above the scale and only grows, so the divisor stays positive for the whole run.
  addConnector(model, { from: "Exito B", to: "Recursos para A" });
  addConnector(model, { from: "Exito A", to: "Recursos para B" });
  model.simSpec = { ...YEARS, stopTime: 60 };
  return model;
}

/**
 * A fix that works, and a side effect that undoes it — so the problem comes down, then climbs back
 * past where it started.
 *
 * The side effect has to *accumulate* for the rebound to happen at all: with both the relief and
 * the side effect proportional to the problem itself, the model is linear and can only decay or
 * grow, never turn around. So the consequence feeds a stock, and that stock drives the problem
 * back up — which is the shape the archetype actually describes.
 */
function fixesThatFail(): Model {
  const model = createEmptyModel("Fixes that Fail — Relief and Rebound");
  const problem = addStock(model, { name: "Problema", initialEquation: "100", units: "Cases", comment: "Falls while the remedy is applied, then comes back.", pos: { x: 360, y: 200 } });
  const damage = addStock(model, { name: "Danio acumulado", initialEquation: "0", units: "Cases/Month", comment: "The accumulated side effect. It is what makes the rebound possible.", pos: { x: 120, y: 400 } });
  addFlow(model, { name: "Aparicion", equation: "Problema * Tasa de aparicion + Danio acumulado", to: problem.id, units: "Cases/Month", pos: { x: 180, y: 200 } });
  addFlow(model, { name: "Alivio", equation: "Remedio", from: problem.id, units: "Cases/Month", pos: { x: 540, y: 200 } });
  addFlow(model, { name: "Efecto secundario", equation: "Remedio * Tasa de efecto", to: damage.id, units: "Cases/Month/Month", pos: { x: 120, y: 280 } });
  // The remedy is its own node, as it is in the textbook figure: it is the one quantity that feeds
  // both arrows out of the fix — the relief that helps and the side effect that doesn't. Inlining
  // it into the two flows reads no worse but collapses the two loops onto a single shared node.
  addAuxiliary(model, { name: "Remedio", equation: "Problema * Intensidad", units: "Cases/Month", comment: "The fix, applied in proportion to the problem — so it grows with it.", pos: { x: 600, y: 80 } });
  addConstant(model, { name: "Intensidad", value: 0.3, units: "1/Month", pos: { x: 720, y: 20 } });
  addConstant(model, { name: "Tasa de aparicion", value: 0.1, units: "1/Month", pos: { x: 40, y: 120 } });
  // Small on purpose: at 0.3 the accumulated damage overwhelms the relief within a couple of
  // months and the model explodes. At 0.05 the problem dips, then recovers past where it started.
  addConstant(model, { name: "Tasa de efecto", value: 0.05, units: "1/Month", pos: { x: 20, y: 280 } });
  addConnector(model, { from: "Problema", to: "Aparicion" });
  addConnector(model, { from: "Tasa de aparicion", to: "Aparicion" });
  addConnector(model, { from: "Danio acumulado", to: "Aparicion" });
  addConnector(model, { from: "Remedio", to: "Alivio" });
  addConnector(model, { from: "Problema", to: "Remedio" });
  addConnector(model, { from: "Intensidad", to: "Remedio" });
  addConnector(model, { from: "Remedio", to: "Efecto secundario" });
  addConnector(model, { from: "Tasa de efecto", to: "Efecto secundario" });
  model.simSpec = { ...YEARS, stopTime: 60, timeUnits: "Month" };
  return model;
}

/**
 * A problem with two solutions: one that relieves it now, and one that would solve it but takes
 * months to have any effect — while the quick relief erodes the capacity the slow one runs on.
 *
 * The test of this archetype is what the *quick fix* costs. The relief buys a real, visible
 * improvement — the problem falls from 200 to about 30 while the cure is still ramping up — and
 * it is paid for out of the same problem: the same relief that holds the symptom down is what
 * grinds the capacity away. With the relief the problem drifts back up to where the relief alone
 * can hold it, with the capacity at nothing; without it the problem comes down steadily to 83
 * with the capacity at 40. The relief looks better for a year and worse forever after.
 *
 * That rebound is the archetype, not Fixes that Fail wearing its coat: the problem never returns
 * past where it started, because nothing is feeding it. What distinguishes this pattern is the
 * second line — the capacity — and it is why the capacity starts at 50 rather than at nothing.
 */
function shiftingTheBurden(): Model {
  const model = createEmptyModel("Shifting the Burden — Relief vs Rebuilding");
  const problem = addStock(model, { name: "Problema", initialEquation: "200", units: "Cases", comment: "Held down by whichever solution is doing the work.", pos: { x: 380, y: 200 } });
  const capacity = addStock(model, {
    name: "Capacidad",
    initialEquation: "50",
    units: "Cases/Month",
    comment: "How fast the fundamental solution can work — and what the relief quietly erodes.",
    pos: { x: 760, y: 380 },
  });
  addConstant(model, { name: "Casos nuevos", value: 25, units: "Cases/Month", comment: "The backlog grows by this much every month, whatever else happens.", pos: { x: 40, y: 120 } });
  addFlow(model, { name: "Aparicion", equation: "Casos nuevos", to: problem.id, units: "Cases/Month", pos: { x: 180, y: 200 } });
  addFlow(model, { name: "Alivio rapido", equation: "Problema * Intensidad del paliativo", from: problem.id, units: "Cases/Month", comment: "The quick fix: immediate, and it gets used precisely because it works.", pos: { x: 560, y: 120 } });
  // The MIN is not decoration. `Movimiento` is delayed by months, so while the problem is
  // collapsing the cure is still working at the rate the problem *used* to justify — and without a
  // floor that unlagged throughput runs the stock through zero and out the other side. "No more
  // than what is there" is the same guard the aquifer uses.
  addFlow(model, {
    name: "Solucion fundamental",
    equation: "MIN(Movimiento, Problema / Tiempo de tratamiento)",
    from: problem.id,
    units: "Cases/Month",
    comment: "The cure, capped at the cases that actually exist.",
    pos: { x: 560, y: 300 },
  });
  addAuxiliary(model, {
    name: "Movimiento",
    // On its own node rather than inlined, so the delay sits on a variable the loop visibly passes
    // through: this equation is what the report reads to tell the two paths apart.
    equation: "DELAY1(MIN(Problema * Tasa de cobertura, Capacidad), Retraso)",
    units: "Cases/Month",
    comment: "The fundamental solution — months to have any effect. That delay is why the quick fix is so tempting.",
    pos: { x: 760, y: 240 },
  });
  // Flows, not connectors: a variable only accumulates what a *flow* carries.
  addFlow(model, { name: "Desarrollo", equation: "Tasa de desarrollo", to: capacity.id, units: "Cases/Month/Month", comment: "Capacity is built steadily — unless the relief is eating it faster.", pos: { x: 960, y: 440 } });
  addFlow(model, {
    name: "Erosion",
    equation: "MIN(Capacidad / Tiempo de erosion, Alivio rapido * Tasa de erosion)",
    from: capacity.id,
    units: "Cases/Month/Month",
    comment: "The side effect: the quicker the relief, the faster the durable capacity is used up.",
    pos: { x: 600, y: 440 },
  });
  addConstant(model, { name: "Intensidad del paliativo", value: 0.2, units: "1/Month", comment: "Enough to outpace the inflow at first — which is exactly why it gets used.", pos: { x: 460, y: 30 } });
  addConstant(model, { name: "Tasa de cobertura", value: 0.3, units: "1/Month", comment: "What the cure could cover per case, once there is capacity to cover it with.", pos: { x: 760, y: 140 } });
  addConstant(model, { name: "Tiempo de tratamiento", value: 1, units: "Month", comment: "The fastest the cure could work through the whole backlog — there is no treating cases that aren't there.", pos: { x: 380, y: 380 } });
  addConstant(model, { name: "Retraso", value: 8, units: "Month", comment: "How long the cure takes to have any effect.", pos: { x: 900, y: 200 } });
  addConstant(model, { name: "Tasa de desarrollo", value: 2, units: "Cases/Month/Month", comment: "Capacity built per month, with nothing eroding it.", pos: { x: 1040, y: 520 } });
  addConstant(model, { name: "Tasa de erosion", value: 0.4, units: "1/Month", comment: "How much capacity the relief destroys per case it handles. High enough that it never catches up.", pos: { x: 440, y: 540 } });
  addConstant(model, { name: "Tiempo de erosion", value: 1, units: "Month", comment: "The fastest the capacity could be consumed — no eroding capacity that isn't there.", pos: { x: 440, y: 620 } });
  addConnector(model, { from: "Casos nuevos", to: "Aparicion" });
  addConnector(model, { from: "Problema", to: "Alivio rapido" });
  addConnector(model, { from: "Intensidad del paliativo", to: "Alivio rapido" });
  addConnector(model, { from: "Problema", to: "Movimiento" });
  addConnector(model, { from: "Capacidad", to: "Movimiento" });
  addConnector(model, { from: "Tasa de cobertura", to: "Movimiento" });
  addConnector(model, { from: "Retraso", to: "Movimiento" });
  addConnector(model, { from: "Movimiento", to: "Solucion fundamental" });
  addConnector(model, { from: "Problema", to: "Solucion fundamental" });
  addConnector(model, { from: "Tiempo de tratamiento", to: "Solucion fundamental" });
  addConnector(model, { from: "Tasa de desarrollo", to: "Desarrollo" });
  addConnector(model, { from: "Alivio rapido", to: "Erosion" });
  addConnector(model, { from: "Tasa de erosion", to: "Erosion" });
  addConnector(model, { from: "Capacidad", to: "Erosion" });
  addConnector(model, { from: "Tiempo de erosion", to: "Erosion" });
  model.simSpec = { ...YEARS, stopTime: 120, timeUnits: "Month" };
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
