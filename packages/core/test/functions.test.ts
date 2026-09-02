import { describe, expect, test } from "bun:test";
import { evaluate, parseExpr } from "../src/mdl/expr/index.js";
import { getFunction, isFunctionRegistered, listFunctions, registerFunction } from "../src/mdl/expr/functions.js";

describe("function registry", () => {
  test("built-in Vensim functions beyond the original small set", () => {
    expect(evaluate(parseExpr("POWER(2, 5)"), {})).toBe(32);
    expect(evaluate(parseExpr("MODULO(7, 3)"), {})).toBe(1);
    expect(evaluate(parseExpr("SIN(0)"), {})).toBe(0);
    expect(evaluate(parseExpr("COS(0)"), {})).toBe(1);
    expect(evaluate(parseExpr("ARCTAN(1)"), {})).toBeCloseTo(Math.PI / 4);
  });

  test("STEP and PULSE are time-aware via the same registry path as any other function", () => {
    const step = parseExpr("STEP(5, 10)");
    expect(evaluate(step, { Time: 5 })).toBe(0);
    expect(evaluate(step, { Time: 10 })).toBe(5);
    expect(evaluate(step, { Time: 20 })).toBe(5);

    const pulse = parseExpr("PULSE(10, 2)");
    expect(evaluate(pulse, { Time: 9 })).toBe(0);
    expect(evaluate(pulse, { Time: 10 })).toBe(1);
    expect(evaluate(pulse, { Time: 11.9 })).toBe(1);
    expect(evaluate(pulse, { Time: 12 })).toBe(0);
  });

  test("registerFunction adds a new callable equation function with no evaluator changes", () => {
    registerFunction("DOUBLE_TEST_FN", (args) => (args[0] ?? 0) * 2, "Doubles its argument.");
    expect(evaluate(parseExpr("DOUBLE_TEST_FN(21)"), {})).toBe(42);
    expect(isFunctionRegistered("double_test_fn")).toBe(true); // case-insensitive
    expect(getFunction("DOUBLE_TEST_FN")).toBeDefined();
  });

  test("registerFunction can see the evaluation environment (e.g. Time)", () => {
    registerFunction("TIME_TEST_FN", (_args, env) => (env["Time"] ?? -1) + 100);
    expect(evaluate(parseExpr("TIME_TEST_FN()"), { Time: 3 })).toBe(103);
  });

  test("unregistered function names still fail clearly", () => {
    expect(() => evaluate(parseExpr("NOT_A_REAL_FUNCTION(1)"), {})).toThrow(/Unsupported function/);
  });

  test("listFunctions reports at least the built-ins", () => {
    const names = listFunctions().map((f) => f.name);
    expect(names).toContain("MIN");
    expect(names).toContain("STEP");
    expect(names).toContain("POWER");
  });
});
