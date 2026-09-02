import { describe, expect, test } from "bun:test";
import { addAuxiliary, addFlow, addStock } from "../src/model/builder/index.js";
import { createEmptyModel } from "../src/model/types.js";
import { simulate } from "../src/sim/engine.js";

describe("simulate", () => {
  test("exponential growth matches analytic solution", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100" });
    addFlow(model, { name: "Births", equation: "Population * Growth Rate", to: pop.id });
    addAuxiliary(model, { name: "Growth Rate", equation: "0.1", isConstant: true });
    model.simSpec = { startTime: 0, stopTime: 10, dt: 0.01, integrationMethod: "rk4", timeUnits: "Year" };

    const result = simulate(model);
    const last = result.series["Population"]!.at(-1)!;
    const analytic = 100 * Math.exp(0.1 * 10);
    expect(last).toBeCloseTo(analytic, 1);
  });

  test("euler is less accurate than rk4 for the same dt on a nonlinear system", () => {
    function run(method: "euler" | "rk4") {
      const model = createEmptyModel();
      const pop = addStock(model, { name: "P", initialEquation: "100" });
      addFlow(model, { name: "Growth", equation: "P * 0.5", to: pop.id });
      model.simSpec = { startTime: 0, stopTime: 5, dt: 0.5, integrationMethod: method, timeUnits: "Year" };
      return simulate(model).series["P"]!.at(-1)!;
    }
    const analytic = 100 * Math.exp(0.5 * 5);
    const eulerErr = Math.abs(run("euler") - analytic);
    const rk4Err = Math.abs(run("rk4") - analytic);
    expect(rk4Err).toBeLessThan(eulerErr);
  });

  test("two stocks with a shared flow conserve mass", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A", initialEquation: "100" });
    const b = addStock(model, { name: "B", initialEquation: "0" });
    addFlow(model, { name: "Transfer", equation: "10", from: a.id, to: b.id });
    model.simSpec = { startTime: 0, stopTime: 5, dt: 0.5, integrationMethod: "euler", timeUnits: "Year" };

    const result = simulate(model);
    const total = result.series["A"]!.map((v, i) => v + result.series["B"]![i]!);
    for (const t of total) expect(t).toBeCloseTo(100, 6);
  });
});
