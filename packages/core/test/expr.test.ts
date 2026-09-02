import { describe, expect, test } from "bun:test";
import { evaluate, exprToString, parseExpr } from "../src/mdl/expr/index.js";

describe("expr", () => {
  test("arithmetic precedence", () => {
    const e = parseExpr("2 + 3 * 4 - 1");
    expect(evaluate(e, {})).toBe(13);
  });

  test("parens and power", () => {
    const e = parseExpr("(2 + 3) ^ 2");
    expect(evaluate(e, {})).toBe(25);
  });

  test("variables and quoted names", () => {
    const e = parseExpr(`Population*"Birth Rate"`);
    expect(evaluate(e, { Population: 100, "Birth Rate": 0.02 })).toBeCloseTo(2);
  });

  test("IF THEN ELSE and comparisons", () => {
    const e = parseExpr("IF THEN ELSE(X > 10, 1, 0)");
    expect(evaluate(e, { X: 20 })).toBe(1);
    expect(evaluate(e, { X: 5 })).toBe(0);
  });

  test("functions MIN/MAX/ABS", () => {
    expect(evaluate(parseExpr("MIN(3, 5)"), {})).toBe(3);
    expect(evaluate(parseExpr("MAX(3, 5)"), {})).toBe(5);
    expect(evaluate(parseExpr("ABS(-4)"), {})).toBe(4);
  });

  test("round-trips through printer", () => {
    const src = "Population * Deaths - 5";
    const e = parseExpr(src);
    expect(exprToString(e)).toBe(src);
  });

  test("multi-word variable names via knownNames", () => {
    const e = parseExpr("Population * Birth Rate - Deaths", ["Population", "Birth Rate", "Deaths"]);
    expect(evaluate(e, { Population: 100, "Birth Rate": 0.02, Deaths: 1 })).toBeCloseTo(1);
  });
});
