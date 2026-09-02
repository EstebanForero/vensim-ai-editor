import { describe, expect, test } from "bun:test";
import { addAuxiliary, addConnector, addFlow, addStock, deleteElement, renameVariable, setEquation } from "../src/model/builder/index.js";
import { createEmptyModel } from "../src/model/types.js";
import { validateModel } from "../src/model/validate.js";

describe("builder", () => {
  test("builds a simple population model", () => {
    const model = createEmptyModel("Population");
    const pop = addStock(model, { name: "Population", initialEquation: "100" });
    const births = addFlow(model, { name: "Births", equation: "Population*Birth Rate", to: pop.id });
    addFlow(model, { name: "Deaths", equation: "Population*Death Rate", from: pop.id });
    addAuxiliary(model, { name: "Birth Rate", equation: "0.02", isConstant: true });
    addAuxiliary(model, { name: "Death Rate", equation: "0.01", isConstant: true });
    addConnector(model, { from: "Birth Rate", to: births.id });

    expect(model.stocks[0]!.inflows).toEqual([births.id]);
    expect(validateModel(model)).toEqual([]);
  });

  test("rejects duplicate names", () => {
    const model = createEmptyModel();
    addStock(model, { name: "X" });
    expect(() => addStock(model, { name: "X" })).toThrow();
  });

  test("flow must connect to at least one stock", () => {
    const model = createEmptyModel();
    expect(() => addFlow(model, { name: "F" })).toThrow();
  });

  test("rename propagates into equations", () => {
    const model = createEmptyModel();
    const stock = addStock(model, { name: "Water", initialEquation: "10" });
    addFlow(model, { name: "Inflow", equation: "5", to: stock.id });
    addAuxiliary(model, { name: "Derived", equation: "Water * 2" });

    renameVariable(model, stock.id, "Volume");
    const derived = model.auxiliaries.find((a) => a.name === "Derived")!;
    expect(derived.equation).toBe("Volume * 2");
  });

  test("setEquation rejects setting equation on a stock", () => {
    const model = createEmptyModel();
    const stock = addStock(model, { name: "S" });
    expect(() => setEquation(model, stock.id, "1")).toThrow();
  });

  test("deleteElement cleans up references", () => {
    const model = createEmptyModel();
    const stock = addStock(model, { name: "S" });
    const flow = addFlow(model, { name: "F", to: stock.id });
    deleteElement(model, flow.id);
    expect(model.stocks[0]!.inflows).toEqual([]);
    expect(model.flows).toEqual([]);
  });
});
