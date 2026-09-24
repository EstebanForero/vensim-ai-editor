import { describe, expect, test } from "bun:test";
import { inferPolarity } from "../src/model/polarity.js";
import { addAuxiliary, addConnector, addFlow, addStock } from "../src/model/builder/index.js";
import { createEmptyModel } from "../src/model/types.js";

const NAMES = ["R", "P", "T", "A", "B"];

describe("inferPolarity", () => {
  test("R = P / T: P is +, T is -", () => {
    expect(inferPolarity("P / T", "P", NAMES)).toBe("+");
    expect(inferPolarity("P / T", "T", NAMES)).toBe("-");
  });

  // The quotient rule takes the numerator's whole value against the denominator's slope, and that
  // loses the cancellation in a "share of" equation: both terms look positive, so it reports
  // ambiguity where the difference is decidable. This is the equation Success to the Successful
  // is built from, and the reason its model reads correctly with no relations drawn.
  test("a share of a total rises with its own part and falls with the rest", () => {
    expect(inferPolarity("A / (A + B)", "A", NAMES)).toBe("+");
    expect(inferPolarity("A / (A + B)", "B", NAMES)).toBe("-");
    expect(inferPolarity("Reparto * A / (A + B)", "A", NAMES)).toBe("+");
    expect(inferPolarity("Reparto * A / (A + B)", "B", NAMES)).toBe("-");
  });

  test("the cancellation is claimed only where the target really cancels", () => {
    // The algebra these two rest on is l = a*x + b, r = c*x + d, giving l'*r - l*r' = a*d - b*c:
    // signed by the two products, which is all this reader has. Both cases below come out right
    // anyway — a ratio whose target cancels to nothing is no relation at all, and one where the
    // terms oppose each other is decided by their signs alone.
    expect(inferPolarity("A / (A * B)", "A", NAMES)).toBeNull();
    expect(inferPolarity("(A + B) / (A - B)", "A", NAMES)).toBe("-");
  });

  test("a target inside a nonlinear term is not treated as linear", () => {
    // B is squared in the denominator, so this is not a*c - b*d and the numerator's terms can't
    // be separated by sign alone.
    expect(inferPolarity("A / (A + B * B)", "B", NAMES)).toBe("-"); // decided by the plain rule
    expect(inferPolarity("A * A / (A + B)", "B", NAMES)).toBe("-"); // numerator not linear in B
    // A squared against A: the plain rule gives up and the linear pass must not claim it.
    expect(inferPolarity("A * A / (A + B)", "A", NAMES)).toBeNull();
  });

  test("R = P * T: both +", () => {
    expect(inferPolarity("P * T", "P", NAMES)).toBe("+");
    expect(inferPolarity("P * T", "T", NAMES)).toBe("+");
  });

  test("R = A - B: A is +, B is -", () => {
    expect(inferPolarity("A - B", "A", NAMES)).toBe("+");
    expect(inferPolarity("A - B", "B", NAMES)).toBe("-");
  });

  test("R = -A: negative", () => {
    expect(inferPolarity("-A", "A", NAMES)).toBe("-");
  });

  test("unrelated variable: null (not present in the equation)", () => {
    expect(inferPolarity("P / T", "A", NAMES)).toBeNull();
  });

  test("a difference of two terms that each depend on the same source is ambiguous", () => {
    // d(A - A)/dA structurally combines a "+" and a "-" contribution — genuinely ambiguous
    // without evaluating, so this must NOT silently guess either sign.
    expect(inferPolarity("A - A", "A", NAMES)).toBeNull();
  });

  test("MIN/MAX: decidable only when every argument agrees", () => {
    expect(inferPolarity("MIN(A, B)", "A", NAMES)).toBe("+");
    expect(inferPolarity("MAX(A, B)", "A", NAMES)).toBe("+");
    // A appears increasing in one branch and (via -A) decreasing in a hypothetical other —
    // here it's the same var on both a plain and negated position, so ambiguous.
    expect(inferPolarity("MIN(A, -A)", "A", NAMES)).toBeNull();
  });

  test("IF THEN ELSE: the condition's own dependence doesn't affect the result's sign", () => {
    expect(inferPolarity("IF_THEN_ELSE(A > B, A, A)", "A", NAMES)).toBe("+");
  });

  test("power with a positive integer exponent preserves sign; negative exponent flips it", () => {
    expect(inferPolarity("A^2", "A", NAMES)).toBe("+");
    expect(inferPolarity("A^-1", "A", NAMES)).toBe("-");
  });

  test("monotonic functions (EXP, LN, SQRT) pass the inner sign through", () => {
    expect(inferPolarity("EXP(A)", "A", NAMES)).toBe("+");
    expect(inferPolarity("SQRT(A)", "A", NAMES)).toBe("+");
    expect(inferPolarity("LN(A)", "A", NAMES)).toBe("+");
  });

  test("a function with no structural sign rule (e.g. SIN) is unknown, not a guess", () => {
    expect(inferPolarity("SIN(A)", "A", NAMES)).toBeNull();
  });

  test("addConnector infers polarity from the target's equation when polarity is omitted", () => {
    const model = createEmptyModel();
    const stock = addStock(model, { name: "R", initialEquation: "0" });
    addFlow(model, { name: "Inflow", equation: "P / T", to: stock.id });
    const p = addAuxiliary(model, { name: "P", equation: "5" });
    const t = addAuxiliary(model, { name: "T", equation: "2" });

    const cp = addConnector(model, { from: p.id, to: "Inflow" });
    const ct = addConnector(model, { from: t.id, to: "Inflow" });

    expect(cp.polarity).toBe("+");
    expect(ct.polarity).toBe("-");
  });

  test("an explicit polarity always wins over inference", () => {
    const model = createEmptyModel();
    const stock = addStock(model, { name: "R", initialEquation: "0" });
    addFlow(model, { name: "Inflow", equation: "P / T", to: stock.id });
    const p = addAuxiliary(model, { name: "P", equation: "5" });

    const c = addConnector(model, { from: p.id, to: "Inflow", polarity: "-" });
    expect(c.polarity).toBe("-");
  });
});
