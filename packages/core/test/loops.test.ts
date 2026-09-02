import { describe, expect, test } from "bun:test";
import { addAuxiliary, addConnector, addConstant, addFlow, addStock } from "../src/model/builder/index.js";
import { detectLoops } from "../src/loops/detect.js";
import { createEmptyModel } from "../src/model/types.js";

describe("detectLoops", () => {
  test("finds a reinforcing loop (population growth)", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 } });
    const births = addFlow(model, { name: "Births", equation: "Population * Birth Rate", to: pop.id, pos: { x: 100, y: 0 } });
    addConstant(model, { name: "Birth Rate", value: 0.02, pos: { x: 50, y: 100 } });
    addConnector(model, { from: "Population", to: "Births" }); // default "+"

    const loops = detectLoops(model);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.polarity).toBe("R");
    expect(loops[0]!.nodeIds.sort()).toEqual([pop.id, births.id].sort());
  });

  test("finds a balancing loop when an outflow closes the cycle", () => {
    const model = createEmptyModel();
    const stock = addStock(model, { name: "Inventory", initialEquation: "50", pos: { x: 0, y: 0 } });
    const outflow = addFlow(model, { name: "Shipments", equation: "Inventory * 0.1", from: stock.id, pos: { x: 100, y: 0 } });
    addConnector(model, { from: "Inventory", to: "Shipments", polarity: "+" });

    const loops = detectLoops(model);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.polarity).toBe("B"); // Inventory ->(+) Shipments ->(-) Inventory: one negative link
    expect(loops[0]!.nodeIds.sort()).toEqual([stock.id, outflow.id].sort());
  });

  test("a negative relation flips loop polarity", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "A", equation: "B", pos: { x: 0, y: 0 } });
    addAuxiliary(model, { name: "B", equation: "A", pos: { x: 100, y: 0 } });
    addConnector(model, { from: "A", to: "B", polarity: "-" });
    addConnector(model, { from: "B", to: "A", polarity: "+" });

    const loops = detectLoops(model);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.polarity).toBe("B");
  });

  test("no loops in an acyclic model", () => {
    const model = createEmptyModel();
    const stock = addStock(model, { name: "S", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "F", to: stock.id, pos: { x: 100, y: 0 } });
    expect(detectLoops(model)).toEqual([]);
  });

  test("direction reflects the shape of the loop on screen", () => {
    const model = createEmptyModel();
    // Triangle laid out counterclockwise in screen (y-down) coordinates.
    const a = addAuxiliary(model, { name: "A", equation: "1", pos: { x: 0, y: 0 } });
    const b = addAuxiliary(model, { name: "B", equation: "1", pos: { x: 100, y: 0 } });
    const c = addAuxiliary(model, { name: "C", equation: "1", pos: { x: 50, y: 100 } });
    addConnector(model, { from: a.name, to: b.name });
    addConnector(model, { from: b.name, to: c.name });
    addConnector(model, { from: c.name, to: a.name });

    const loops = detectLoops(model);
    expect(loops).toHaveLength(1);
    expect(["clockwise", "counterclockwise"]).toContain(loops[0]!.direction);
  });
});
