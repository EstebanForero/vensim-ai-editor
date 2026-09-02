import { describe, expect, test } from "bun:test";
import { isConstantAuxiliary } from "../src/model/derived.js";
import { addAuxiliary, addConnector } from "../src/model/builder/index.js";
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
