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
  // Not the carrying capacity, whatever the name suggests: this is the size at which crowding
  // *doubles* the death rate. Births and deaths balance at 4000 — four times this.
  addConstant(model, { name: "Crowding Scale", value: 1000, units: "People", pos: { x: 680, y: 480 } });
  addAuxiliary(model, {
    name: "Death Rate",
    equation: "Base Death Rate * (1 + Population / Crowding Scale)",
    units: "1/Year",
    comment: "Rises with the population's own size — the constraint the R loop runs into. Births and deaths balance at 4000.",
    pos: { x: 560, y: 320 },
  });
  addConnector(model, { from: "Population", to: "Births" });
  addConnector(model, { from: "Birth Rate", to: "Births" });
  addConnector(model, { from: "Population", to: "Death Rate" });
  addConnector(model, { from: "Base Death Rate", to: "Death Rate" });
  addConnector(model, { from: "Crowding Scale", to: "Death Rate" });
  addConnector(model, { from: "Death Rate", to: "Deaths" });
  // Long enough to watch it flatten: the population passes 3900 and stops moving.
  model.simSpec = { ...YEARS, stopTime: 100 };
  return model;
}

/** Two farms drawing on one aquifer.
 *
 * The whole test of this archetype is that the *second* farm is what causes the depletion. So the
 * aquifer has to be able to sustain one: it refills on its own, at a rate that peaks when it is
 * half full — 100,000 m3/Month here. Each farm needs 60,000. Either one alone is therefore fine
 * forever; the two together ask for 120,000 against a yield of 100,000, and that twenty per cent
 * is the whole story.
 *
 * It also has to *look* like the archetype. The curve the pattern is drawn with has three phases
 * — abundant and stable, then overuse and a peak, then collapse — and a stock that is over-drawn
 * from the first day just falls away from its starting value, which is a different and much less
 * interesting picture. So farm B is drilled part-way in rather than arriving at full tilt: farm A
 * is alone and sustainable for the first three and a half years, and B builds up to full demand
 * over the five after that. That gives +17% to a peak at 35% of the run, a gradual decline, then
 * a collapse to nothing — the textbook shape, arising from the mechanism rather than drawn on.
 *
 * The previous version failed that test twice over. It had no recharge at all and drew a
 * *proportional* share of whatever was left, so one farm alone ran the aquifer down to 21 m3 —
 * the tragedy happened either way, and the second farm changed nothing. A proportional draw also
 * cannot collapse a resource: the smaller it gets, the less is taken, so it always finds an
 * equilibrium rather than an end. Both are fixed here — regrowth gives the stock a yield that can
 * be exceeded, and demand gives the farms a claim that does not shrink as the water disappears.
 * (Its aquifer also held 1,000 m3, which is a swimming pool; the harvest numbers here are the
 * same ratios at a size you don't have to apologise for.) */
function tragedyOfTheCommons(): Model {
  const model = createEmptyModel("Tragedy of the Commons — Two Farms, One Aquifer");
  const water = addStock(model, {
    name: "Agua disponible",
    initialEquation: "700000",
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
  // "What the farm needs, up to what is actually there." The MIN is what lets demand exceed
  // supply without the stock going negative — and, unlike a proportional draw, it does not weaken
  // as the aquifer empties.
  addFlow(model, {
    name: "Extraccion A",
    equation: "MIN(Demanda A, Agua disponible / Tiempo de bombeo)",
    from: water.id,
    units: "m3/Month",
    comment: "Farm A pumps what it needs. Nothing in this equation mentions Farm B.",
    pos: { x: 150, y: 200 },
  });
  addFlow(model, {
    name: "Extraccion B",
    equation: "MIN(Demanda B, Agua disponible / Tiempo de bombeo) * Puesta en marcha B",
    from: water.id,
    units: "m3/Month",
    comment: "Identical in shape to A's — and just as reasonable read on its own.",
    pos: { x: 530, y: 200 },
  });
  // The second farm does not arrive at full tilt: it is drilled and its irrigation is built up
  // over three years. That ramp is what produces the shape the archetype is drawn with — a
  // resource that is fine, then stretched, then gone — rather than a stock that was always
  // over-drawn and simply falls from the first day.
  addAuxiliary(model, {
    name: "Puesta en marcha B",
    equation: "MIN(MAX(0, Time - Retraso de B), Tiempo de llegada) / Tiempo de llegada",
    units: "Dmnl",
    comment: "Farm B's share of its eventual demand: nothing until it is drilled, then built up to full.",
    pos: { x: 700, y: 320 },
  });
  addConstant(model, { name: "Retraso de B", value: 42, units: "Month", comment: "Farm B is drilled this far into the run. Until then the aquifer is only feeding one farm, and it is fine.", pos: { x: 860, y: 300 } });
  addConstant(model, { name: "Tiempo de llegada", value: 60, units: "Month", comment: "How long farm B takes to reach full demand once it starts.", pos: { x: 880, y: 380 } });
  addConstant(model, { name: "Capacidad del acuifero", value: 1000000, units: "m3", pos: { x: 520, y: 60 } });
  addConstant(model, { name: "Tasa de recarga", value: 0.4, units: "1/Month", comment: "Peak recharge is Tasa * Capacidad / 4 — 100,000 m3/Month, the sustainable yield.", pos: { x: 700, y: 60 } });
  addConstant(model, { name: "Demanda A", value: 60000, units: "m3/Month", comment: "Under the 100,000 m3/Month yield, so this farm alone is sustainable.", pos: { x: 150, y: 320 } });
  addConstant(model, { name: "Demanda B", value: 60000, units: "m3/Month", comment: "The same size. Two draws of 60,000 make 120,000 against a yield of 100,000.", pos: { x: 530, y: 320 } });
  addConstant(model, { name: "Tiempo de bombeo", value: 1, units: "Month", comment: "The fastest the pumps could empty the aquifer between them — there is no extracting water that isn't there.", pos: { x: 340, y: 360 } });
  addConnector(model, { from: "Agua disponible", to: "Recarga" });
  addConnector(model, { from: "Tasa de recarga", to: "Recarga" });
  addConnector(model, { from: "Capacidad del acuifero", to: "Recarga" });
  addConnector(model, { from: "Agua disponible", to: "Extraccion A" });
  addConnector(model, { from: "Demanda A", to: "Extraccion A" });
  addConnector(model, { from: "Tiempo de bombeo", to: "Extraccion A" });
  addConnector(model, { from: "Agua disponible", to: "Extraccion B" });
  addConnector(model, { from: "Demanda B", to: "Extraccion B" });
  addConnector(model, { from: "Puesta en marcha B", to: "Extraccion B" });
  addConnector(model, { from: "Retraso de B", to: "Puesta en marcha B" });
  addConnector(model, { from: "Tiempo de llegada", to: "Puesta en marcha B" });
  addConnector(model, { from: "Tiempo de bombeo", to: "Extraccion B" });
  model.simSpec = { ...YEARS, stopTime: 120, timeUnits: "Month" };
  return model;
}

/** An arms race. Each side builds *because* the other has missiles — so neither can stop, and the
 * race has no resting point.
 *
 * A previous version had each side build in proportion to how far *behind* it was. That reads like
 * escalation but is its opposite: once one side pulled ahead, the other's building rate fell to
 * zero and it stopped rearming altogether. It modelled capitulation — and the giveaway was that
 * switching the loser's production off made the winner grow *faster*. Here each side responds to
 * the other's arsenal, so zeroing one side stops the other dead: no enemy, no arms race. */
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

/** Two activities competing for one fixed budget, allocated by track record. The one that is
 * already ahead attracts more of it, so a small early lead becomes total dominance.
 *
 * The budget is *fixed*, and that is doing real work: the archetype is about a limited resource
 * being divided, so what one activity attracts is what the other doesn't. A previous version had
 * the pool grow with the two activities' own success, which meant the winner's gains cost the
 * loser nothing — and, measurably, the feedback did nothing at all: given equal access the two
 * ended at 1337.6 and 1335.6, still in lockstep. All the divergence came from a difference in
 * access rates, which is an assumption about merit, not the archetype.
 *
 * What makes the lead compound here is the threshold. Allocating by success alone is *linear* —
 * both grow at the same rate and the ratio never moves, however long you run it. Increasing
 * returns are what turn a 20% head start into a rout, and a track record is the most ordinary
 * form of them there is: below a certain size, an activity has no results to point at and
 * attracts nothing at all. */
function successToTheSuccessful(): Model {
  const model = createEmptyModel("Success to the Successful — Two Activities, One Budget");
  const a = addStock(model, { name: "Actividad A", initialEquation: "12", units: "Projects", comment: "Ahead from the start — by two projects.", pos: { x: 160, y: 200 } });
  const b = addStock(model, { name: "Actividad B", initialEquation: "10", units: "Projects", pos: { x: 560, y: 200 } });
  addFlow(model, { name: "Recursos para A", equation: "Reparto * Acceso A", to: a.id, units: "Projects/Year", pos: { x: 160, y: 80 } });
  addFlow(model, { name: "Recursos para B", equation: "Reparto * Acceso B", to: b.id, units: "Projects/Year", pos: { x: 560, y: 80 } });
  addFlow(model, { name: "Cierre A", equation: "Actividad A * Tasa de cierre", from: a.id, units: "Projects/Year", pos: { x: 60, y: 200 } });
  addFlow(model, { name: "Cierre B", equation: "Actividad B * Tasa de cierre", from: b.id, units: "Projects/Year", pos: { x: 660, y: 200 } });
  addAuxiliary(model, { name: "Exito A", equation: "MAX(0, Actividad A - Escala de exito)", units: "Projects", comment: "What A has to show for itself. The scale is subtracted, not a target.", pos: { x: 160, y: 320 } });
  addAuxiliary(model, { name: "Exito B", equation: "MAX(0, Actividad B - Escala de exito)", units: "Projects", pos: { x: 560, y: 320 } });
  addAuxiliary(model, { name: "Acceso A", equation: "Exito A / (Exito A + Exito B)", units: "Dmnl", comment: "A's share of the budget — and it rises with A's own success. That is the reinforcing loop.", pos: { x: 60, y: 420 } });
  addAuxiliary(model, { name: "Acceso B", equation: "Exito B / (Exito A + Exito B)", units: "Dmnl", pos: { x: 660, y: 420 } });
  // The budget has a hard ceiling — `Presupuesto` — which is the point: what one activity
  // attracts is what the other doesn't. It is released in step with the pipeline of credible
  // projects, and `Escala de asignacion` is small enough that it reaches its ceiling almost at
  // once, so the amount actually divided barely moves as the two activities grow.
  //
  // Provenance, since the shape looks fussier than the idea: the report finds this archetype by
  // looking for an allocation node sitting *inside* both reinforcing loops. A bare constant has no
  // incoming edges, so it can't be in a cycle and the pattern goes unreported. The ceiling is what
  // keeps the pool from inflating with success — which, as the counterfactual test shows, is what
  // would silently turn the feedback back off.
  addAuxiliary(model, {
    name: "Reparto",
    equation: "Presupuesto * (Exito A + Exito B) / (Exito A + Exito B + Escala de asignacion)",
    units: "Projects/Year",
    comment: "The divided budget. Never exceeds Presupuesto, and is essentially there from the start.",
    pos: { x: 360, y: 200 },
  });
  addConstant(model, { name: "Presupuesto", value: 4, units: "Projects/Year", comment: "The ceiling. Fixed.", pos: { x: 360, y: 40 } });
  addConstant(model, { name: "Escala de asignacion", value: 1, units: "Projects", comment: "How quickly the budget reaches its ceiling. Small: it is essentially all released from the start.", pos: { x: 360, y: 560 } });
  addConstant(model, { name: "Escala de exito", value: 8, units: "Projects", comment: "The size at which an activity starts attracting anything. Below it, its share is zero.", pos: { x: 360, y: 480 } });
  addConstant(model, { name: "Tasa de cierre", value: 0.08, units: "1/Year", comment: "Projects finish and leave — which is what lets the starved activity actually shrink.", pos: { x: 360, y: 100 } });
  for (const [stock, success, flow, access, close] of [
    ["Actividad A", "Exito A", "Recursos para A", "Acceso A", "Cierre A"],
    ["Actividad B", "Exito B", "Recursos para B", "Acceso B", "Cierre B"],
  ] as const) {
    addConnector(model, { from: "Reparto", to: flow });
    addConnector(model, { from: access, to: flow });
    addConnector(model, { from: stock, to: success });
    addConnector(model, { from: "Escala de exito", to: success });
    addConnector(model, { from: success, to: access });
    addConnector(model, { from: stock, to: close });
    addConnector(model, { from: "Tasa de cierre", to: close });
  }
  // Each side's share needs the other's success to divide by.
  addConnector(model, { from: "Exito B", to: "Acceso A" });
  addConnector(model, { from: "Exito A", to: "Acceso B" });
  addConnector(model, { from: "Presupuesto", to: "Reparto" });
  addConnector(model, { from: "Escala de asignacion", to: "Reparto" });
  // Both sides' success reaches the budget — without these the pool is drawn but never fed, and
  // no cycle passes through it.
  addConnector(model, { from: "Exito A", to: "Reparto" });
  addConnector(model, { from: "Exito B", to: "Reparto" });
  model.simSpec = { ...YEARS, stopTime: 60 };
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

/** A problem with two solutions: one that relieves it now, and one that would solve it but takes
 * months to have any effect — while the effort the relief consumes is effort not spent building
 * the capacity the slow solution runs on.
 *
 * The test of this archetype is what the *quick fix* costs. A previous version failed it badly:
 * its fundamental solution covered 2% of the problem against a 25% appearance rate, so the cure
 * could never have worked at any capacity — and with the relief removed the problem didn't
 * return, it exploded to 677,485. The model was saying the quick fix was the only thing keeping
 * the problem down, which is the opposite of the archetype.
 *
 * Here the relief buys a real, visible improvement — the problem falls from 200 to about 30 while
 * the cure is still ramping up — and it is paid for out of the same effort budget. Left alone the
 * cure builds the capacity to finish the job; used, it starves, and the gain goes back: with the
 * relief the problem drifts back up to 123 with the capacity at nothing, where without it the
 * problem comes down steadily to 83 with the capacity at 40. The relief looks better for a year
 * and worse forever after.
 *
 * That rebound is the archetype, not Fixes that Fail wearing its coat: the problem never returns
 * past where it started, because nothing is feeding it — it settles at the level the relief alone
 * can hold. What distinguishes this pattern is the second line. The capacity is destroyed, and the
 * shape that shows it is the *capacity* curve, which is why it starts at 50 rather than at
 * nothing. (It has to be small enough that the cure can't out-run the relief: a capacity large
 * enough to finish the job pulls the problem down until the relief weakens, the effort budget
 * frees up, and the capacity rebuilds itself. The trap only holds while the cure is unbuilt, which
 * is the whole point.) */
function shiftingTheBurden(): Model {
  const model = createEmptyModel("Shifting the Burden — Relief vs Rebuilding");
  const problem = addStock(model, { name: "Problema", initialEquation: "200", units: "Cases", comment: "Held down by whichever solution is doing the work.", pos: { x: 380, y: 200 } });
  const capacity = addStock(model, {
    name: "Capacidad",
    initialEquation: "50",
    units: "Cases/Month",
    comment: "How fast the fundamental solution can work — and what the relief quietly starves.",
    pos: { x: 760, y: 380 },
  });
  addFlow(model, { name: "Aparicion", equation: "Casos nuevos", to: problem.id, units: "Cases/Month", comment: "New cases arrive at a steady rate, whether or not anything is being done about them.", pos: { x: 180, y: 200 } });
  addFlow(model, { name: "Alivio rapido", equation: "Problema * Intensidad del paliativo", from: problem.id, units: "Cases/Month", comment: "The quick fix: immediate, proportional to the problem, and hungry for effort.", pos: { x: 560, y: 120 } });
  // The MIN is not decoration. `Movimiento` is delayed by eight months, so while the problem is
  // collapsing the cure is still working at the rate the problem *used* to justify — and without
  // a floor that unlagged throughput runs the stock straight through zero and out the other side.
  // "No more than what is there" is the same guard the aquifer uses.
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
    // Written on its own node rather than inlined, so the delay sits on a variable the loop
    // visibly passes through: this equation is what the report reads to tell the two paths apart.
    // MIN because the fundamental solution can only work as fast as its capacity allows.
    equation: "DELAY1(MIN(Problema * Tasa de cobertura, Capacidad), 8)",
    units: "Cases/Month",
    comment: "The fundamental solution — months to have any effect. That delay is why the quick fix is so tempting.",
    pos: { x: 760, y: 240 },
  });
  // Flows, not connectors: a variable only accumulates what a *flow* carries, so wiring these as
  // relations would leave the capacity sitting at its initial value for the whole run.
  addFlow(model, {
    name: "Desarrollo",
    equation: "MAX(0, Tasa de desarrollo - Alivio rapido * Tasa de erosion)",
    to: capacity.id,
    units: "Cases/Month/Month",
    comment: "Capacity is built with the effort the relief leaves over — which, while the relief is running, is none of it.",
    pos: { x: 960, y: 440 },
  });
  addFlow(model, {
    name: "Deterioro",
    equation: "Capacidad * Tasa de deterioro",
    from: capacity.id,
    units: "Cases/Month/Month",
    comment: "Capacity you stop maintaining, you lose. This is what actually drives it down.",
    pos: { x: 600, y: 440 },
  });
  addConstant(model, { name: "Casos nuevos", value: 25, units: "Cases/Month", comment: "The backlog grows by this much every month, whatever else happens.", pos: { x: 40, y: 120 } });
  addConstant(model, {
    name: "Intensidad del paliativo",
    value: 0.2,
    units: "1/Month",
    comment: "Enough to outpace the inflow at first — which is exactly why it gets used.",
    pos: { x: 460, y: 30 },
  });
  addConstant(model, { name: "Tasa de cobertura", value: 0.3, units: "1/Month", comment: "What the cure could cover per case, once there is capacity to cover it with.", pos: { x: 760, y: 140 } });
  addConstant(model, { name: "Tasa de desarrollo", value: 2, units: "Cases/Month/Month", comment: "Capacity built per month, with the full effort budget behind it.", pos: { x: 1040, y: 520 } });
  addConstant(model, { name: "Tasa de erosion", value: 0.4, units: "1/Month", comment: "How much of that budget the relief takes for itself, per case it handles. High enough that the relief consumes all of it at any level the problem settles at.", pos: { x: 440, y: 540 } });
  addConstant(model, { name: "Tiempo de tratamiento", value: 1, units: "Month", comment: "The fastest the cure could work through the whole backlog — there is no treating cases that aren't there.", pos: { x: 380, y: 380 } });
  addConstant(model, { name: "Tasa de deterioro", value: 0.05, units: "1/Month", pos: { x: 460, y: 620 } });
  addConnector(model, { from: "Casos nuevos", to: "Aparicion" });
  addConnector(model, { from: "Problema", to: "Alivio rapido" });
  addConnector(model, { from: "Intensidad del paliativo", to: "Alivio rapido" });
  addConnector(model, { from: "Problema", to: "Movimiento" });
  addConnector(model, { from: "Capacidad", to: "Movimiento" });
  addConnector(model, { from: "Tasa de cobertura", to: "Movimiento" });
  addConnector(model, { from: "Movimiento", to: "Solucion fundamental" });
  addConnector(model, { from: "Problema", to: "Solucion fundamental" });
  addConnector(model, { from: "Tiempo de tratamiento", to: "Solucion fundamental" });
  addConnector(model, { from: "Tasa de desarrollo", to: "Desarrollo" });
  addConnector(model, { from: "Alivio rapido", to: "Desarrollo", polarity: "-" });
  addConnector(model, { from: "Tasa de erosion", to: "Desarrollo", polarity: "-" });
  addConnector(model, { from: "Capacidad", to: "Deterioro" });
  addConnector(model, { from: "Tasa de deterioro", to: "Deterioro" });
  // Ten years, not four: the cure-only path takes that long to build the capacity and then bring
  // the problem down, and stopping earlier would show it at its worst and call that the ending.
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
