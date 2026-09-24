import { describe, expect, test } from "bun:test";
import { equationCausalEdges, isConstantAuxiliary } from "../src/model/derived.js";
import { addAuxiliary, addConstant, addConnector, addFlow, addStock } from "../src/model/builder/index.js";
import { createEmptyModel } from "../src/model/types.js";

describe("isConstantAuxiliary", () => {
  test("a bare numeric literal is a constant", () => {
    const model = createEmptyModel();
    const a = addAuxiliary(model, { name: "Birth Rate", equation: "0.02" });
    expect(isConstantAuxiliary(a, model)).toBe(true);
  });

  test("an expression referencing another variable is not a constant", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Base", equation: "10" });
    const derived = addAuxiliary(model, { name: "Doubled", equation: "Base * 2" });
    addConnector(model, { from: "Base", to: derived.id });
    expect(isConstantAuxiliary(derived, model)).toBe(false);
  });

  test("an expression of only literals/functions is still a constant", () => {
    const model = createEmptyModel();
    const a = addAuxiliary(model, { name: "Combo", equation: "MIN(3, 5) + 1" });
    expect(isConstantAuxiliary(a, model)).toBe(true);
  });

  test("stays correct even without an explicit connector, since it reads the equation, not the diagram", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Base", equation: "10" });
    const derived = addAuxiliary(model, { name: "Doubled", equation: "Base * 2" });
    // no addConnector call here — should still be detected as non-constant
    expect(isConstantAuxiliary(derived, model)).toBe(false);
  });
});

describe("equationCausalEdges", () => {
  const pairs = (model: ReturnType<typeof createEmptyModel>) =>
    equationCausalEdges(model)
      .map((e) => `${e.from.name}->${e.to.name}${e.polarity}`)
      .sort();

  test("reads each equation as signed edges into it", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Population", initialEquation: "100" });
    addFlow(model, { name: "Births", equation: "Population * Birth Rate", to: "Population" });
    addConstant(model, { name: "Birth Rate", value: 0.02 });
    addFlow(model, { name: "Deaths", equation: "Population / Lifespan", from: "Population" });
    addConstant(model, { name: "Lifespan", value: 70 });

    // The sign is the equation's own, per input: more people means more deaths, but a *longer*
    // lifespan means fewer, so `Lifespan -> Deaths` is "-" while `Population -> Deaths` is "+".
    // (The minus that makes the death loop balancing is the flow's *direction* — an outflow lowers
    // the stock — which is a separate edge, added by loops/graph.ts rather than here.)
    expect(pairs(model)).toEqual([
      "Birth Rate->Births+",
      "Lifespan->Deaths-",
      "Population->Births+",
      "Population->Deaths+",
    ]);
  });

  // A stock's equation is its initial value: it fixes t0 and nothing after it, so it is not a
  // causal link the way a rate equation is. Reading it as one would invent feedback — here, a
  // loop between the capacity and the level it merely happened to start at.
  test("a stock's initial equation contributes no edge", () => {
    const model = createEmptyModel();
    addConstant(model, { name: "Capacity", value: 1000 });
    addStock(model, { name: "Population", initialEquation: "Capacity * 0.1" });
    expect(equationCausalEdges(model)).toEqual([]);
  });

  // Undecidable signs are dropped rather than defaulted to "+": a loop's polarity is the product
  // of its edges' signs, so a guess doesn't just add an edge, it mislabels every loop through it.
  test("drops an edge whose sign the equation doesn't determine", () => {
    const model = createEmptyModel();
    // A hump: rises to a peak then falls, so raising the input doesn't move the output one way.
    addAuxiliary(model, { name: "Effect", equation: "(\n[(0,0)-(10,2)],\n(0,0),(5,2),(10,0))" });
    addAuxiliary(model, { name: "A", equation: "Effect(B)" });
    addAuxiliary(model, { name: "B", equation: "A" });

    expect(pairs(model)).toEqual(["A->B+"]);
  });

  test("a monotonic lookup is signed through, not dropped", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Effect", equation: "(\n[(0,0)-(10,10)],\n(0,0),(10,10))" });
    addAuxiliary(model, { name: "A", equation: "Effect(B)" });
    addAuxiliary(model, { name: "B", equation: "1" });

    expect(pairs(model)).toEqual(["B->A+"]);
  });

  // The arrows are the canvas's copy of the same fact, so they change nothing here — this is the
  // "same answer however the model arrived" property loops/graph.ts relies on.
  test("is a property of the equations, not of what was drawn", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Population", initialEquation: "100" });
    addFlow(model, { name: "Births", equation: "Population * 0.02", to: "Population" });
    const before = pairs(model);
    addConnector(model, { from: "Population", to: "Births" });
    expect(pairs(model)).toEqual(before);
  });
});
