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

  // Regression: the printer used to concatenate `left op right` with no parentheses at all,
  // so `(a - b) / c` printed as `a - b / c` — which re-parses as `a - (b / c)`, a different
  // formula. Re-exporting a model could silently change what it computes once re-opened
  // elsewhere (this is exactly what broke a "Pedido de bicicletas" equation on export).
  test("printer re-inserts parentheses needed to preserve grouping", () => {
    const cases: [string, number][] = [
      ["(a - b) / c", (10 - 4) / 2],
      ["a - b / c", 10 - 4 / 2],
      ["a - (b - c)", 10 - (4 - 2)],
      ["a / (b / c)", 10 / (4 / 2)],
      ["(a + b) * (c - d)", (10 + 4) * (2 - 1)],
    ];
    const env = { a: 10, b: 4, c: 2, d: 1 };
    for (const [src, expected] of cases) {
      const printed = exprToString(parseExpr(src, ["a", "b", "c", "d"]));
      const reparsed = parseExpr(printed, ["a", "b", "c", "d"]);
      expect(evaluate(reparsed, env)).toBeCloseTo(expected);
    }
  });

  test("preserves the exact grouping from the bicycle-shop exercise's order equation", () => {
    const names = ["Inventario deseado", "Inventario de bicicletas", "Tiempo de ajuste de inventario"];
    const src = "MAX(0, (Inventario deseado - Inventario de bicicletas) / Tiempo de ajuste de inventario)";
    const printed = exprToString(parseExpr(src, names));
    expect(printed).toContain("(\"Inventario deseado\" - \"Inventario de bicicletas\") / \"Tiempo de ajuste de inventario\"");
    const env = { "Inventario deseado": 100, "Inventario de bicicletas": 60, "Tiempo de ajuste de inventario": 10 };
    expect(evaluate(parseExpr(printed, names), env)).toBeCloseTo(4); // (100-60)/10, not 100-60/10=94
  });
});
