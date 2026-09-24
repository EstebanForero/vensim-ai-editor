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
  const model = createEmptyModel("Limits to Growth — Population and Carrying Capacity (Límites al crecimiento — Población y capacidad de carga)");
  const pop = addStock(model, {
    name: "Population",
    initialEquation: "100",
    units: "People",
    comment: "Grows while births outpace deaths; levels off as crowding raises the death rate.",
    pos: { x: 380, y: 200 },
  });
  addFlow(model, { name: "Births", equation: "Population * Birth rate", to: pop.id, units: "People/Year", pos: { x: 200, y: 200 } });
  addFlow(model, { name: "Deaths", equation: "Population * Death rate", from: pop.id, units: "People/Year", pos: { x: 560, y: 200 } });
  addConstant(model, { name: "Birth rate", value: 0.1, units: "1/Year", pos: { x: 200, y: 320 } });
  addConstant(model, { name: "Base death rate", value: 0.02, units: "1/Year", pos: { x: 560, y: 400 } });
  addConstant(model, { name: "Carrying capacity", value: 4000, units: "People", comment: "Where births and deaths balance — what the population levels off at.", pos: { x: 680, y: 480 } });
  // Written this way so the constant above means what its name says: mortality climbs from its
  // base to the birth rate as the population approaches the capacity, and the two meet there.
  addAuxiliary(model, {
    name: "Death rate",
    equation: "Base death rate + (Birth rate - Base death rate) * Population / Carrying capacity",
    units: "1/Year",
    comment: "Rises with the population's own size — the constraint the R loop runs into.",
    pos: { x: 560, y: 320 },
  });
  addConnector(model, { from: "Population", to: "Births" });
  addConnector(model, { from: "Birth rate", to: "Births" });
  addConnector(model, { from: "Population", to: "Death rate" });
  addConnector(model, { from: "Base death rate", to: "Death rate" });
  addConnector(model, { from: "Carrying capacity", to: "Death rate" });
  addConnector(model, { from: "Birth rate", to: "Death rate" });
  addConnector(model, { from: "Death rate", to: "Deaths" });
  model.simSpec = { ...YEARS, stopTime: 100 };
  return model;
}

/**
 * Two farms drawing on one aquifer.
 *
 * The whole test of this archetype is that the *second* farm is what causes the depletion, so the
 * aquifer has to be able to sustain one. It refills on its own, fastest when it is half full —
 * `Recharge rate * Aquifer capacity / 4` = 15,000 m3/Month, the most it can yield forever. Farm A takes
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
  const model = createEmptyModel("Tragedy of the Commons — Two Farms, One Aquifer (Tragedia de los comunes — Dos fincas, un acuífero)");
  const water = addStock(model, {
    name: "Water available",
    initialEquation: "250000",
    units: "m3",
    comment: "The shared aquifer. It refills on its own — but only so fast.",
    pos: { x: 340, y: 200 },
  });
  addFlow(model, {
    name: "Recharge",
    equation: "Recharge rate * Water available * (1 - Water available / Aquifer capacity)",
    to: water.id,
    units: "m3/Month",
    comment: "Regrowth, fastest at half full and zero at empty or full. Its peak is the most this aquifer can yield forever.",
    pos: { x: 340, y: 60 },
  });
  addFlow(model, {
    name: "Use A",
    equation: "Water available * Use rate A",
    from: water.id,
    units: "m3/Month",
    comment: "Farm A takes a quarter of what is there. Nothing in this equation mentions Farm B.",
    pos: { x: 150, y: 200 },
  });
  addFlow(model, {
    name: "Use B",
    equation: "Water available * Use rate B",
    from: water.id,
    units: "m3/Month",
    comment: "The same quarter as A, once the farm is running — and just as reasonable read on its own.",
    pos: { x: 530, y: 200 },
  });
  addAuxiliary(model, {
    name: "Use rate B",
    equation: "Use rate A * MIN(1, MAX(0, Time - B start delay) / B ramp time)",
    units: "1/Month",
    comment: "B's share of the aquifer: none until it is drilled, then built up to A's.",
    pos: { x: 700, y: 320 },
  });
  addConstant(model, { name: "Aquifer capacity", value: 1000000, units: "m3", pos: { x: 520, y: 60 } });
  addConstant(model, { name: "Recharge rate", value: 0.06, units: "1/Month", comment: "Peak recharge is Recharge rate * Aquifer capacity / 4 — 15,000 m3/Month, the sustainable yield.", pos: { x: 700, y: 60 } });
  addConstant(model, { name: "Use rate A", value: 0.04, units: "1/Month", comment: "Under the 0.06 regrowth rate, so this farm alone is sustainable.", pos: { x: 150, y: 320 } });
  addConstant(model, { name: "B start delay", value: 120, units: "Month", comment: "Farm B is drilled ten years in. Until then the aquifer is feeding one farm, and it is fine.", pos: { x: 880, y: 300 } });
  addConstant(model, { name: "B ramp time", value: 40, units: "Month", comment: "How long farm B takes to reach full demand once it starts.", pos: { x: 880, y: 360 } });
  addConnector(model, { from: "Water available", to: "Recharge" });
  addConnector(model, { from: "Recharge rate", to: "Recharge" });
  addConnector(model, { from: "Aquifer capacity", to: "Recharge" });
  addConnector(model, { from: "Water available", to: "Use A" });
  addConnector(model, { from: "Use rate A", to: "Use A" });
  addConnector(model, { from: "Water available", to: "Use B" });
  addConnector(model, { from: "Use rate B", to: "Use B" });
  addConnector(model, { from: "Use rate A", to: "Use rate B" });
  addConnector(model, { from: "B start delay", to: "Use rate B" });
  addConnector(model, { from: "B ramp time", to: "Use rate B" });
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
  const model = createEmptyModel("Escalation — Arms Race (Escalada — Carrera armamentista)");
  const a = addStock(model, { name: "Missiles A", initialEquation: "120", units: "Missiles", comment: "Starts ahead, and answers faster — so the lead widens.", pos: { x: 200, y: 120 } });
  const b = addStock(model, { name: "Missiles B", initialEquation: "100", units: "Missiles", pos: { x: 560, y: 120 } });
  addFlow(model, {
    name: "Production A",
    equation: "Missiles B * Response rate A",
    to: a.id,
    units: "Missiles/Year",
    comment: "A builds in response to B's arsenal. Take B away and A never builds another missile.",
    pos: { x: 380, y: 60 },
  });
  addFlow(model, {
    name: "Production B",
    equation: "Missiles A * Response rate B",
    to: b.id,
    units: "Missiles/Year",
    comment: "The same shape as A's. Neither equation contains a stopping condition, because escalation doesn't have one.",
    pos: { x: 380, y: 320 },
  });
  addConstant(model, { name: "Response rate A", value: 0.09, units: "1/Year", comment: "A answers more than twice as hard as B does.", pos: { x: 220, y: 420 } });
  addConstant(model, { name: "Response rate B", value: 0.04, units: "1/Year", pos: { x: 540, y: 420 } });
  addConnector(model, { from: "Missiles B", to: "Production A" });
  addConnector(model, { from: "Response rate A", to: "Production A" });
  addConnector(model, { from: "Missiles A", to: "Production B" });
  addConnector(model, { from: "Response rate B", to: "Production B" });
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
 * into a rout, and a track record is the most ordinary form of them there is — `Success scale`
 * is the size below which an activity has no results to point at and so attracts nothing at all.
 */
function successToTheSuccessful(): Model {
  const model = createEmptyModel("Success to the Successful — Two Activities, One Budget (Éxito para el exitoso — Dos actividades, un presupuesto)");
  const a = addStock(model, { name: "Activity A", initialEquation: "12", units: "Projects", comment: "Ahead from the start — by two projects.", pos: { x: 160, y: 200 } });
  const b = addStock(model, { name: "Activity B", initialEquation: "10", units: "Projects", pos: { x: 560, y: 200 } });
  addFlow(model, { name: "Resources for A", equation: "Budget * Track record A / (Track record A + Track record B)", to: a.id, units: "Projects/Year", pos: { x: 160, y: 80 } });
  addFlow(model, { name: "Resources for B", equation: "Budget * Track record B / (Track record A + Track record B)", to: b.id, units: "Projects/Year", pos: { x: 560, y: 80 } });
  addFlow(model, { name: "Closures A", equation: "Activity A * Closure rate", from: a.id, units: "Projects/Year", pos: { x: 60, y: 200 } });
  addFlow(model, { name: "Closures B", equation: "Activity B * Closure rate", from: b.id, units: "Projects/Year", pos: { x: 660, y: 200 } });
  addAuxiliary(model, { name: "Track record A", equation: "MAX(0, Activity A - Success scale)", units: "Projects", comment: "What A has to show for itself. The scale is subtracted, not a target.", pos: { x: 160, y: 320 } });
  addAuxiliary(model, { name: "Track record B", equation: "MAX(0, Activity B - Success scale)", units: "Projects", pos: { x: 560, y: 320 } });
  addConstant(model, { name: "Budget", value: 3, units: "Projects/Year", comment: "The budget. Fixed, and the only thing the two activities compete for.", pos: { x: 360, y: 200 } });
  addConstant(model, { name: "Success scale", value: 8, units: "Projects", comment: "Below this size an activity attracts nothing — the increasing return the archetype turns on.", pos: { x: 360, y: 480 } });
  addConstant(model, { name: "Closure rate", value: 0.08, units: "1/Year", comment: "Projects finish and leave — what lets the starved activity actually shrink.", pos: { x: 360, y: 100 } });
  for (const [stock, success, flow, close] of [
    ["Activity A", "Track record A", "Resources for A", "Closures A"],
    ["Activity B", "Track record B", "Resources for B", "Closures B"],
  ] as const) {
    addConnector(model, { from: "Budget", to: flow });
    addConnector(model, { from: success, to: flow });
    addConnector(model, { from: stock, to: success });
    addConnector(model, { from: "Success scale", to: success });
    addConnector(model, { from: stock, to: close });
    addConnector(model, { from: "Closure rate", to: close });
  }
  // Each side's share divides by the other's success too. Both can't be zero at once: A starts
  // above the scale and only grows, so the divisor stays positive for the whole run.
  addConnector(model, { from: "Track record B", to: "Resources for A" });
  addConnector(model, { from: "Track record A", to: "Resources for B" });
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
  const model = createEmptyModel("Fixes that Fail — Relief and Rebound (Soluciones que fallan — Alivio y rebote)");
  const problem = addStock(model, { name: "Problem", initialEquation: "100", units: "Cases", comment: "Falls while the remedy is applied, then comes back.", pos: { x: 360, y: 200 } });
  const damage = addStock(model, { name: "Accumulated damage", initialEquation: "0", units: "Cases/Month", comment: "The accumulated side effect. It is what makes the rebound possible.", pos: { x: 120, y: 400 } });
  addFlow(model, { name: "New cases", equation: "Problem * New case rate + Accumulated damage", to: problem.id, units: "Cases/Month", pos: { x: 180, y: 200 } });
  addFlow(model, { name: "Relief", equation: "Remedy", from: problem.id, units: "Cases/Month", pos: { x: 540, y: 200 } });
  addFlow(model, { name: "Side effect", equation: "Remedy * Side effect rate", to: damage.id, units: "Cases/Month/Month", pos: { x: 120, y: 280 } });
  // The remedy is its own node, as it is in the textbook figure: it is the one quantity that feeds
  // both arrows out of the fix — the relief that helps and the side effect that doesn't. Inlining
  // it into the two flows reads no worse but collapses the two loops onto a single shared node.
  addAuxiliary(model, { name: "Remedy", equation: "Problem * Intensity", units: "Cases/Month", comment: "The fix, applied in proportion to the problem — so it grows with it.", pos: { x: 600, y: 80 } });
  addConstant(model, { name: "Intensity", value: 0.3, units: "1/Month", pos: { x: 720, y: 20 } });
  addConstant(model, { name: "New case rate", value: 0.1, units: "1/Month", pos: { x: 40, y: 120 } });
  // Small on purpose: at 0.3 the accumulated damage overwhelms the relief within a couple of
  // months and the model explodes. At 0.05 the problem dips, then recovers past where it started.
  addConstant(model, { name: "Side effect rate", value: 0.05, units: "1/Month", pos: { x: 20, y: 280 } });
  addConnector(model, { from: "Problem", to: "New cases" });
  addConnector(model, { from: "New case rate", to: "New cases" });
  addConnector(model, { from: "Accumulated damage", to: "New cases" });
  addConnector(model, { from: "Remedy", to: "Relief" });
  addConnector(model, { from: "Problem", to: "Remedy" });
  addConnector(model, { from: "Intensity", to: "Remedy" });
  addConnector(model, { from: "Remedy", to: "Side effect" });
  addConnector(model, { from: "Side effect rate", to: "Side effect" });
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
  const model = createEmptyModel("Shifting the Burden — Relief vs Rebuilding (Desplazamiento de la carga — Alivio vs reconstrucción)");
  const problem = addStock(model, { name: "Problem", initialEquation: "200", units: "Cases", comment: "Held down by whichever solution is doing the work.", pos: { x: 380, y: 200 } });
  const capacity = addStock(model, {
    name: "Capacity",
    initialEquation: "50",
    units: "Cases/Month",
    comment: "How fast the fundamental solution can work — and what the relief quietly erodes.",
    pos: { x: 760, y: 380 },
  });
  addConstant(model, { name: "Cases arriving", value: 25, units: "Cases/Month", comment: "The backlog grows by this much every month, whatever else happens.", pos: { x: 40, y: 120 } });
  addFlow(model, { name: "New cases", equation: "Cases arriving", to: problem.id, units: "Cases/Month", pos: { x: 180, y: 200 } });
  addFlow(model, { name: "Quick relief", equation: "Problem * Relief intensity", from: problem.id, units: "Cases/Month", comment: "The quick fix: immediate, and it gets used precisely because it works.", pos: { x: 560, y: 120 } });
  // The MIN is not decoration. `Cure throughput` is delayed by months, so while the problem is
  // collapsing the cure is still working at the rate the problem *used* to justify — and without a
  // floor that unlagged throughput runs the stock through zero and out the other side. "No more
  // than what is there" is the same guard the aquifer uses.
  addFlow(model, {
    name: "Fundamental solution",
    equation: "MIN(Cure throughput, Problem / Treatment time)",
    from: problem.id,
    units: "Cases/Month",
    comment: "The cure, capped at the cases that actually exist.",
    pos: { x: 560, y: 300 },
  });
  addAuxiliary(model, {
    name: "Cure throughput",
    // On its own node rather than inlined, so the delay sits on a variable the loop visibly passes
    // through: this equation is what the report reads to tell the two paths apart.
    equation: "DELAY1(MIN(Problem * Coverage rate, Capacity), Delay)",
    units: "Cases/Month",
    comment: "The fundamental solution — months to have any effect. That delay is why the quick fix is so tempting.",
    pos: { x: 760, y: 240 },
  });
  // Flows, not connectors: a variable only accumulates what a *flow* carries.
  addFlow(model, { name: "Capacity building", equation: "Development rate", to: capacity.id, units: "Cases/Month/Month", comment: "Capacity is built steadily — unless the relief is eating it faster.", pos: { x: 960, y: 440 } });
  addFlow(model, {
    name: "Erosion",
    equation: "MIN(Capacity / Erosion time, Quick relief * Erosion rate)",
    from: capacity.id,
    units: "Cases/Month/Month",
    comment: "The side effect: the quicker the relief, the faster the durable capacity is used up.",
    pos: { x: 600, y: 440 },
  });
  addConstant(model, { name: "Relief intensity", value: 0.2, units: "1/Month", comment: "Enough to outpace the inflow at first — which is exactly why it gets used.", pos: { x: 460, y: 30 } });
  addConstant(model, { name: "Coverage rate", value: 0.3, units: "1/Month", comment: "What the cure could cover per case, once there is capacity to cover it with.", pos: { x: 760, y: 140 } });
  addConstant(model, { name: "Treatment time", value: 1, units: "Month", comment: "The fastest the cure could work through the whole backlog — there is no treating cases that aren't there.", pos: { x: 380, y: 380 } });
  addConstant(model, { name: "Delay", value: 8, units: "Month", comment: "How long the cure takes to have any effect.", pos: { x: 900, y: 200 } });
  addConstant(model, { name: "Development rate", value: 2, units: "Cases/Month/Month", comment: "Capacity built per month, with nothing eroding it.", pos: { x: 1040, y: 520 } });
  addConstant(model, { name: "Erosion rate", value: 0.4, units: "1/Month", comment: "How much capacity the relief destroys per case it handles. High enough that it never catches up.", pos: { x: 440, y: 540 } });
  addConstant(model, { name: "Erosion time", value: 1, units: "Month", comment: "The fastest the capacity could be consumed — no eroding capacity that isn't there.", pos: { x: 440, y: 620 } });
  addConnector(model, { from: "Cases arriving", to: "New cases" });
  addConnector(model, { from: "Problem", to: "Quick relief" });
  addConnector(model, { from: "Relief intensity", to: "Quick relief" });
  addConnector(model, { from: "Problem", to: "Cure throughput" });
  addConnector(model, { from: "Capacity", to: "Cure throughput" });
  addConnector(model, { from: "Coverage rate", to: "Cure throughput" });
  addConnector(model, { from: "Delay", to: "Cure throughput" });
  addConnector(model, { from: "Cure throughput", to: "Fundamental solution" });
  addConnector(model, { from: "Problem", to: "Fundamental solution" });
  addConnector(model, { from: "Treatment time", to: "Fundamental solution" });
  addConnector(model, { from: "Development rate", to: "Capacity building" });
  addConnector(model, { from: "Quick relief", to: "Erosion" });
  addConnector(model, { from: "Erosion rate", to: "Erosion" });
  addConnector(model, { from: "Capacity", to: "Erosion" });
  addConnector(model, { from: "Erosion time", to: "Erosion" });
  model.simSpec = { ...YEARS, stopTime: 120, timeUnits: "Month" };
  return model;
}

/**
 * A quality standard, a performance level, and a gap that can be closed from either end.
 *
 * The standard is not a constant here, and that is the entire archetype: `Quality standard -
 * Performance` is an ordinary goal-seeking gap, but because *both* terms are levels the loop that
 * closes it can travel through either one. It travels through both — the performance improves at
 * `Gap / Time to improve` while the standard is written down at `Gap / Time to erode` — and they
 * meet at 76, twenty-four points below where the standard started.
 *
 * Where they meet is set by the two time constants and nothing else: the gap closes at
 * `1/Ti + 1/Te`, and each end moves in proportion to its own share of that. Making the goal easy
 * to revise is therefore not a small thing — it takes a predictable slice of every gap the system
 * ever closes, forever. At Time to erode = 36 against Time to improve = 24, the standard gives up
 * 40% of the distance, every time.
 *
 * Note what is *not* here: no reinforcing loop, nothing that runs away, nothing that fails. Both
 * loops balance, the system converges smoothly, and the final state is a perfectly stable one.
 * That is the difficulty of this pattern — there is no event to notice.
 */
function erodingGoals(): Model {
  const model = createEmptyModel("Eroding Goals — A Standard Written Down (Erosión de metas — Un estándar que se rebaja)");
  const standard = addStock(model, {
    name: "Quality standard",
    initialEquation: "100",
    units: "Points",
    comment: "What the work is held to. A level, not a constant — which is the whole problem.",
    pos: { x: 160, y: 240 },
  });
  const performance = addStock(model, {
    name: "Performance",
    initialEquation: "40",
    units: "Points",
    comment: "What the work actually delivers, and what the standard is quietly measured against.",
    pos: { x: 620, y: 240 },
  });
  addAuxiliary(model, {
    name: "Gap",
    equation: "Quality standard - Performance",
    units: "Points",
    comment: "The distance between them. Both ends of it can move.",
    pos: { x: 390, y: 360 },
  });
  addFlow(model, {
    name: "Improvement",
    equation: "Gap / Time to improve",
    to: performance.id,
    units: "Points/Year",
    comment: "The fundamental path: close the gap by getting better.",
    pos: { x: 620, y: 120 },
  });
  addFlow(model, {
    name: "Standard erosion",
    equation: "Gap / Time to erode",
    from: standard.id,
    units: "Points/Year",
    comment: "The other path: close the same gap by lowering what counts as good enough. Easier, faster, and always available.",
    pos: { x: 160, y: 120 },
  });
  addConstant(model, { name: "Time to improve", value: 24, units: "Year", comment: "Getting better takes a while — which is what makes the other path tempting.", pos: { x: 700, y: 460 } });
  addConstant(model, { name: "Time to erode", value: 36, units: "Year", comment: "Slower than improving, so this looks like the careful option. It still takes 40% of every gap the system closes.", pos: { x: 120, y: 460 } });
  addConnector(model, { from: "Quality standard", to: "Gap" });
  addConnector(model, { from: "Performance", to: "Gap" });
  addConnector(model, { from: "Gap", to: "Improvement" });
  addConnector(model, { from: "Time to improve", to: "Improvement" });
  addConnector(model, { from: "Gap", to: "Standard erosion" });
  addConnector(model, { from: "Time to erode", to: "Standard erosion" });
  model.simSpec = { ...YEARS, stopTime: 100 };
  return model;
}

const BUILDERS: Record<ArchetypeId, () => Model> = {
  "limits-to-growth": limitsToGrowth,
  "tragedy-of-the-commons": tragedyOfTheCommons,
  escalation,
  "success-to-the-successful": successToTheSuccessful,
  "fixes-that-fail": fixesThatFail,
  "shifting-the-burden": shiftingTheBurden,
  "eroding-goals": erodingGoals,
};

/** A fresh copy of this archetype's example model, ready to load into the editor. */
export function buildArchetypeExample(id: ArchetypeId): Model {
  return BUILDERS[id]();
}
