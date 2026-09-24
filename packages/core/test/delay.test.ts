import { describe, expect, test } from "bun:test";
import { ARCHETYPES, buildArchetypeExample, detectArchetypes } from "../src/archetypes/index.js";
import { parseMdl } from "../src/mdl/parser.js";
import { writeMdl } from "../src/mdl/writer.js";
import { addAuxiliary, addConstant, addFlow, addStock } from "../src/model/builder/index.js";
import { createEmptyModel, findVariableByName, type Model } from "../src/model/types.js";
import { simulate, type SimResult } from "../src/sim/engine.js";
import { lowerDelays } from "../src/sim/lowerDelays.js";
import { inferPolarity } from "../src/model/polarity.js";
import { checkUnits } from "../src/model/units.js";

/** Index of the sample nearest a time — `startTime + step * dt` is floating point, so an exact
 * match isn't guaranteed and shouldn't be depended on. */
function at(result: SimResult, t: number): number {
  let best = 0;
  for (let i = 1; i < result.time.length; i++) {
    if (Math.abs(result.time[i]! - t) < Math.abs(result.time[best]! - t)) best = i;
  }
  return best;
}

function build(equation: string, input: string, opts: { stopTime?: number; dt?: number; method?: "euler" | "rk4" } = {}): Model {
  const model = createEmptyModel();
  addAuxiliary(model, { name: "In", equation: input });
  addAuxiliary(model, { name: "Out", equation });
  model.simSpec = {
    startTime: 0,
    stopTime: opts.stopTime ?? 30,
    dt: opts.dt ?? 0.01,
    integrationMethod: opts.method ?? "rk4",
    timeUnits: "Month",
  };
  return model;
}

/** A step of height 1 at t=5 — the shape a modeler actually draws, but discontinuous, so it is
 * used only for qualitative properties. */
const stepped = (equation: string, opts = {}) => build(equation, "STEP(1, 5)", opts);
/** `Time` itself — a smooth input with an exact closed form, used wherever precision matters. */
const ramped = (equation: string, opts = {}) => build(equation, "Time", opts);

describe("DELAY1 / SMOOTH (first-order lag)", () => {
  // Out' = (t − Out)/D with Out(0) = 0 solves to Out(t) = t − D + D·e^(−t/D).
  test("matches the analytic first-order response to a ramp", () => {
    const D = 2;
    const model = ramped("DELAY1(In, 2)");
    const result = simulate(model);
    const out = result.series["Out"]!;
    const exact = (t: number) => t - D + D * Math.exp(-t / D);

    expect(out[at(result, 0)]).toBeCloseTo(exact(0), 9);
    expect(out[at(result, 4)]).toBeCloseTo(exact(4), 9);
    expect(out[at(result, 10)]).toBeCloseTo(exact(10), 9);
    expect(out[at(result, 25)]).toBeCloseTo(exact(25), 7);
  });

  // The property that makes a delay a delay: it settles a *constant* amount behind its input,
  // and that amount is the delay time. (The residual D·e^(−t/D) is not negligible for a large D
  // at a finite time, so this reads against the closed form rather than the asymptote.)
  test("settles exactly `delay time` behind a ramp", () => {
    for (const D of [1, 2, 5]) {
      const result = simulate(ramped(`DELAY1(In, ${D})`));
      expect(result.series["Out"]![at(result, 30)]).toBeCloseTo(30 - D + D * Math.exp(-30 / D), 9);
    }
  });

  test("SMOOTH is the same lag under another name", () => {
    const viaDelay = simulate(ramped("DELAY1(In, 2)"));
    const viaSmooth = simulate(ramped("SMOOTH(In, 2)"));
    expect(viaSmooth.series["Out"]![at(viaSmooth, 10)]).toBeCloseTo(viaDelay.series["Out"]![at(viaDelay, 10)]!, 12);
  });

  test("Euler converges on the same answer as RK4", () => {
    const euler = simulate(ramped("DELAY1(In, 2)", { method: "euler", dt: 0.0005 }));
    const rk4 = simulate(ramped("DELAY1(In, 2)"));
    expect(euler.series["Out"]![at(euler, 10)]).toBeCloseTo(rk4.series["Out"]![at(rk4, 10)]!, 4);
  });

  test("a step starts at the input's initial value and approaches the new one", () => {
    const result = simulate(stepped("DELAY1(In, 2)"));
    const out = result.series["Out"]!;
    expect(out[at(result, 0)]).toBeCloseTo(0, 9); // In(0) is 0, so the lag starts at 0
    expect(out[at(result, 4)]).toBeCloseTo(0, 6); // nothing has come through before the step
    // At the step itself a trace has already arrived: RK4's last stage evaluates one step ahead,
    // so it sees the new input value in the step before the switch. A discontinuity costs RK4 its
    // order locally — which is why the precise assertions above all use a smooth input.
    expect(out[at(result, 5)]).toBeLessThan(0.01);
    expect(out[at(result, 30)]).toBeGreaterThan(0.999);
    expect(out[at(result, 30)]).toBeLessThan(1); // approaches, never arrives
  });

  test("a bigger delay time lags further", () => {
    const fast = simulate(stepped("DELAY1(In, 1)"));
    const slow = simulate(stepped("DELAY1(In, 5)"));
    expect(slow.series["Out"]![at(slow, 7)]!).toBeLessThan(fast.series["Out"]![at(fast, 7)]!);
  });
});

describe("DELAY3 / SMOOTH3 / DELAY N (higher-order)", () => {
  test("matches the analytic third-order response to a ramp", () => {
    // Three lags of D/3 in series: step response 1 − e^(−t/τ)(1 + t/τ + (t/τ)²/2) with τ = D/3,
    // so the ramp response is t − D + e^(−t/τ)(D + 2t + t²/(2τ)) ... exercised here through its
    // steady state, which is the part that identifies the order.
    const result = simulate(ramped("DELAY3(In, 3)"));
    expect(result.series["Out"]![at(result, 30)]).toBeCloseTo(27, 7);
  });

  // The whole point of a higher-order lag: it starts slower than a first-order one of the same
  // total delay, then catches up and settles at the same lag.
  test("a third-order delay starts more slowly, then settles identically", () => {
    const first = simulate(stepped("DELAY1(In, 3)"));
    const third = simulate(stepped("DELAY3(In, 3)"));
    expect(third.series["Out"]![at(third, 6)]!).toBeLessThan(first.series["Out"]![at(first, 6)]!);
    expect(third.series["Out"]![at(third, 6)]).toBeCloseTo(0.0803, 3);
    expect(third.series["Out"]![at(third, 30)]).toBeCloseTo(first.series["Out"]![at(first, 30)]!, 3);
  });

  test("DELAY N takes its order from the third argument", () => {
    const third = simulate(ramped("DELAY3(In, 3)"));
    const viaN = simulate(ramped("DELAY N(In, 3, 3)"));
    expect(viaN.series["Out"]![at(viaN, 10)]).toBeCloseTo(third.series["Out"]![at(third, 10)]!, 12);

    // With no order argument it defaults to first order.
    const defaulted = simulate(ramped("DELAY N(In, 2)"));
    const first = simulate(ramped("DELAY1(In, 2)"));
    expect(defaulted.series["Out"]![at(defaulted, 10)]).toBeCloseTo(first.series["Out"]![at(first, 10)]!, 12);

    // Any order settles the same total delay behind its input.
    const fourth = simulate(ramped("DELAY N(In, 6, 4)"));
    expect(fourth.series["Out"]![at(fourth, 30)]).toBeCloseTo(24, 3);
  });

  test("a non-literal order is refused rather than guessed at", () => {
    const model = ramped("DELAY N(In, 3, Order)");
    addConstant(model, { name: "Order", value: 3 });
    expect(() => simulate(model)).toThrow(/literal whole-number order/);
  });

  // The guard that keeps `DELAY N` from rewriting variables whose names start with those words.
  test("a variable named with the words 'Delay N...' is not mistaken for the function", () => {
    const model = createEmptyModel();
    addConstant(model, { name: "Delay Needed", value: 4 });
    addAuxiliary(model, { name: "Out", equation: "Delay Needed * 2" });
    model.simSpec = { startTime: 0, stopTime: 1, dt: 0.5, integrationMethod: "euler", timeUnits: "Year" };
    expect(simulate(model).series["Out"]![0]).toBeCloseTo(8, 9);
  });
});

describe("delay state and the rest of the model", () => {
  test("the delay's internal stocks stay out of the output series", () => {
    const result = simulate(stepped("DELAY3(In, 3)"));
    expect(Object.keys(result.series).sort()).toEqual(["In", "Out"]);
    expect(Object.keys(result.series).some((n) => n.startsWith("Delay of"))).toBe(false);
  });

  test("lowering never touches the model the caller holds", () => {
    const model = stepped("DELAY1(In, 2)");
    const before = {
      stocks: model.stocks.length,
      auxiliaries: model.auxiliaries.length,
      out: model.auxiliaries.find((a) => a.name === "Out")!.equation,
    };

    simulate(model);
    lowerDelays(model);

    expect(model.stocks).toHaveLength(before.stocks);
    expect(model.auxiliaries).toHaveLength(before.auxiliaries);
    expect(model.auxiliaries.find((a) => a.name === "Out")!.equation).toBe(before.out);
    expect(findVariableByName(model, "Delay of Out")).toBeUndefined();
  });

  test("a model with no delays simulates unchanged, and lowering adds nothing", () => {
    const model = createEmptyModel();
    const s = addStock(model, { name: "Stock", initialEquation: "10" });
    addFlow(model, { name: "Growth", equation: "Stock * 0.1", to: s.id });
    model.simSpec = { startTime: 0, stopTime: 50, dt: 0.01, integrationMethod: "rk4", timeUnits: "Year" };

    const { model: lowered, delayStockIds } = lowerDelays(model);
    expect(delayStockIds.size).toBe(0);
    expect(lowered.stocks).toHaveLength(1);

    const result = simulate(model);
    expect(result.series["Stock"]!.at(-1)!).toBeCloseTo(10 * Math.exp(0.1 * 50), 3);
  });

  // The delay's initial value is its input at t0, and that input is normally an expression over
  // stocks and auxiliaries — which don't exist until the model's own initial state is known.
  test("initializes to the input's value at t0, even when that reads a stock", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100" });
    addFlow(model, { name: "Births", equation: "Population * 0.02", to: pop.id });
    addConstant(model, { name: "Share", value: 0.25 });
    addAuxiliary(model, { name: "Extract", equation: "Population * Share" });
    addAuxiliary(model, { name: "Out", equation: "DELAY1(Extract, 3)" });
    model.simSpec = { startTime: 0, stopTime: 10, dt: 0.01, integrationMethod: "rk4", timeUnits: "Year" };

    const result = simulate(model);
    expect(result.series["Out"]![at(result, 0)]).toBeCloseTo(25, 9); // 100 * 0.25
    expect(result.series["Extract"]![at(result, 0)]).toBeCloseTo(25, 9);
  });

  // A stock whose initial equation reads another stock — previously impossible, since every
  // initial was evaluated against an environment holding only the clock.
  test("stock initial values are evaluated in dependency order", () => {
    const model = createEmptyModel();
    const base = addStock(model, { name: "Base", initialEquation: "40" });
    const derived = addStock(model, { name: "Derived", initialEquation: "Base * 2" });
    addFlow(model, { name: "Into Base", equation: "1", to: base.id });
    addFlow(model, { name: "Into Derived", equation: "1", to: derived.id });
    model.simSpec = { startTime: 0, stopTime: 1, dt: 0.5, integrationMethod: "euler", timeUnits: "Year" };

    const result = simulate(model);
    expect(result.series["Derived"]![0]).toBeCloseTo(80, 9);
  });

  // Lowering replaces the call with a reference to a stock, and a stock is integrated rather
  // than solved — so the algebraic cycle really is broken, which is the correct reading: a delay
  // *is* state. (Registering a stateful function instead would have thrown here.)
  test("a delay breaks an algebraic self-cycle, because a delay is state", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "A", equation: "DELAY1(A, 5)" });
    model.simSpec = { startTime: 0, stopTime: 10, dt: 0.1, integrationMethod: "euler", timeUnits: "Year" };
    expect(simulate(model).series["A"]!.every((v) => v === 0)).toBe(true);
  });

  test("two delays in one equation get independent state", () => {
    const withBoth = simulate(stepped("DELAY1(In, 2) + DELAY1(In, 8)"));
    const fast = simulate(stepped("DELAY1(In, 2)"));
    const slow = simulate(stepped("DELAY1(In, 8)"));
    const sum = fast.series["Out"]![at(fast, 10)]! + slow.series["Out"]![at(slow, 10)]!;
    expect(withBoth.series["Out"]![at(withBoth, 10)]).toBeCloseTo(sum, 6);
  });

  test("a delay inside a delay's input is lowered innermost-first", () => {
    const nested = simulate(ramped("DELAY1(DELAY1(In, 2), 3)"));
    // Two lags in series settle 2 + 3 behind a ramp.
    expect(nested.series["Out"]![at(nested, 30)]).toBeCloseTo(25, 3);
  });
});

describe("delays through the .mdl codec", () => {
  // Vensim has no delay record of its own — a delay is ordinary equation text — so the only
  // thing that has to survive a save and reload is the equation itself, verbatim. Checked
  // against every example rather than a fixture, since the examples are what a user actually
  // opens and saves.
  for (const id of ARCHETYPES.map((a) => a.id)) {
    test(`${id}: survives write-then-parse with its equations intact`, () => {
      const model = buildArchetypeExample(id);
      const reparsed = parseMdl(writeMdl(model));
      const equations = (m: Model) =>
        [...m.stocks.map((s) => [s.name, s.initialEquation] as const), ...m.flows.map((f) => [f.name, f.equation] as const), ...m.auxiliaries.map((a) => [a.name, a.equation] as const)]
          .sort(([a], [b]) => a.localeCompare(b));
      expect(equations(reparsed)).toEqual(equations(model));
    });
  }

  test("a written delay is still a delay when it comes back", () => {
    const reparsed = parseMdl(writeMdl(buildArchetypeExample("shifting-the-burden")));
    const movement = reparsed.auxiliaries.find((a) => a.name === "Cure throughput")!;
    expect(movement.equation).toBe("DELAY1(MIN(Problem * Coverage rate, Capacity), Delay)");
    expect(detectArchetypes(reparsed).some((m) => m.archetype === "shifting-the-burden")).toBe(true);
  });
});

describe("delays in the rest of the analysis", () => {
  test("a delay is monotone in its input, so a relation through it has a sign", () => {
    const NAMES = ["Pressure", "R", "T", "A", "B"];
    expect(inferPolarity("DELAY1(Pressure, 4)", "Pressure", NAMES)).toBe("+");
    expect(inferPolarity("SMOOTH(T, 3)", "T", NAMES)).toBe("+");
    expect(inferPolarity("DELAY3(Pressure, 4)", "Pressure", NAMES)).toBe("+");
    // The delay time is not a sign-carrying input.
    expect(inferPolarity("DELAY1(Pressure, R)", "R", NAMES)).toBeNull();
    // A negation inside still flips it.
    expect(inferPolarity("DELAY1(-Pressure, 4)", "Pressure", NAMES)).toBe("-");
  });

  test("a delay's result carries its input's units, not the delay time's", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Out", equation: "DELAY1(In, 4)", units: "m3/Month" });
    addAuxiliary(model, { name: "In", equation: "1", units: "m3/Month" });
    const outId = model.auxiliaries[0]!.id;
    expect(checkUnits(model).filter((i) => i.variableId === outId)).toEqual([]);

    // And a genuine mismatch is still caught through the delay.
    model.auxiliaries[0]!.units = "People";
    const issues = checkUnits(model).filter((i) => i.variableId === outId);
    expect(issues.length).toBeGreaterThan(0);
    // The check reports units in its own casing, so compare case-insensitively.
    expect(issues.map((i) => i.message).join(" ").toLowerCase()).toContain("m3/month");
  });
});
