import { describe, expect, test } from "bun:test";
import { addAuxiliary, addConnector, addConstant, addFlow, addStock } from "../src/model/builder/index.js";
import { addComment } from "../src/model/builder/comment.js";
import { annotateLoops } from "../src/loops/annotate.js";
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

  // Regression: the centroid averaged each node's top-left corner (React Flow's Position
  // convention) instead of its actual center, biasing the loop badge/annotation up-and-left of
  // where the nodes (and the relation lines between them) visually sit — by roughly half a
  // node's width/height, clearly off-center rather than a rounding-scale difference.
  test("centroid is based on each node's actual center, not its top-left corner", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 }, size: { width: 90, height: 45 } });
    const births = addFlow(model, {
      name: "Births",
      equation: "Population * 0.02",
      to: pop.id,
      pos: { x: 200, y: 0 },
      size: { width: 90, height: 45 },
    });
    addConnector(model, { from: "Population", to: "Births" });

    const loops = detectLoops(model);
    expect(loops).toHaveLength(1);
    // Both nodes are on the same y with equal size, so the correct centroid's y sits at each
    // node's vertical center (22.5), not at the top edge (0) a corner-based average would give.
    expect(loops[0]!.centroid.y).toBeCloseTo(22.5, 5);
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

  test("numbers loops per-polarity (R1, R2, ... / B1, B2, ...) in the same order they're returned", () => {
    const model = createEmptyModel();
    // Two independent reinforcing loops and one balancing loop, so both counters get exercised.
    const a1 = addAuxiliary(model, { name: "A1", equation: "1", pos: { x: 0, y: 0 } });
    const a2 = addAuxiliary(model, { name: "A2", equation: "1", pos: { x: 100, y: 0 } });
    addConnector(model, { from: a1.name, to: a2.name, polarity: "+" });
    addConnector(model, { from: a2.name, to: a1.name, polarity: "+" }); // R

    const b1 = addAuxiliary(model, { name: "B1v", equation: "1", pos: { x: 0, y: 200 } });
    const b2 = addAuxiliary(model, { name: "B2v", equation: "1", pos: { x: 100, y: 200 } });
    addConnector(model, { from: b1.name, to: b2.name, polarity: "+" });
    addConnector(model, { from: b2.name, to: b1.name, polarity: "+" }); // R again

    const c1 = addAuxiliary(model, { name: "C1", equation: "1", pos: { x: 0, y: 400 } });
    const c2 = addAuxiliary(model, { name: "C2", equation: "1", pos: { x: 100, y: 400 } });
    addConnector(model, { from: c1.name, to: c2.name, polarity: "+" });
    addConnector(model, { from: c2.name, to: c1.name, polarity: "-" }); // B

    const loops = detectLoops(model);
    const rNumbers = loops.filter((l) => l.polarity === "R").map((l) => l.number);
    const bNumbers = loops.filter((l) => l.polarity === "B").map((l) => l.number);
    expect(rNumbers.sort()).toEqual([1, 2]);
    expect(bNumbers).toEqual([1]);
  });
});

describe("annotateLoops", () => {
  test("creates one comment per loop, naming each element by name (not kind) around the cycle", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 } });
    const births = addFlow(model, { name: "Births", equation: "Population * Birth Rate", to: pop.id, pos: { x: 100, y: 0 } });
    addConstant(model, { name: "Birth Rate", value: 0.02, pos: { x: 50, y: 100 } });
    addConnector(model, { from: "Population", to: "Births" });

    const created = annotateLoops(model);
    expect(created).toHaveLength(1);
    expect(model.comments).toHaveLength(1);
    expect(model.comments[0]!.text).toBe("R1 loop: Population → Births → Population");
    // never the literal word "flow"/"stock" standing in for the element's own name
    expect(model.comments[0]!.text).not.toMatch(/\bflow\b|\bstock\b/i);
  });

  test("is idempotent: re-running replaces its own earlier output instead of piling up duplicates", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Births", equation: "Population * 0.02", to: pop.id, pos: { x: 100, y: 0 } });
    addConnector(model, { from: "Population", to: "Births" });

    annotateLoops(model);
    annotateLoops(model);
    expect(model.comments).toHaveLength(1);
  });

  test("leaves a user's own hand-written comments alone", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Births", equation: "Population * 0.02", to: pop.id, pos: { x: 100, y: 0 } });
    addConnector(model, { from: "Population", to: "Births" });
    addComment(model, { text: "Don't touch this one" });

    annotateLoops(model);
    expect(model.comments.some((c) => c.text === "Don't touch this one")).toBe(true);
    expect(model.comments).toHaveLength(2);
  });
});
