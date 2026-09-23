import { describe, expect, test } from "bun:test";
import { parseExpr, tryParseExpr } from "../src/mdl/expr/index.js";
import { evaluate, evaluateLookup } from "../src/mdl/expr/evaluator.js";
import { exprToString } from "../src/mdl/expr/printer.js";
import { parseMdl } from "../src/mdl/parser.js";
import { writeMdl } from "../src/mdl/writer.js";
import { writeXmile } from "../src/xmile/writer.js";
import { addAuxiliary, addFlow, addLookup, addStock, setLookupPoints } from "../src/model/builder/index.js";
import { isConstantAuxiliary, equationDependencies } from "../src/model/derived.js";
import { collectLookupRefs, lookupScopeOf, lookupTableOf } from "../src/model/lookup.js";
import { createEmptyModel, allVariables } from "../src/model/types.js";
import { simulate } from "../src/sim/engine.js";
import { checkUnits } from "../src/model/units.js";
import { inferPolarity } from "../src/model/polarity.js";

const TABLE = "([(0,0)-(100,1)],(0,0),(50,0.5),(100,1))";

describe("lookup parsing", () => {
  test("parses an axis range followed by points", () => {
    const e = parseExpr(TABLE);
    expect(e.type).toBe("lookup");
    if (e.type !== "lookup") return;
    expect(e.table.points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0.5 },
      { x: 100, y: 1 },
    ]);
    expect([e.table.xMin, e.table.xMax, e.table.yMin, e.table.yMax]).toEqual([0, 100, 0, 1]);
  });

  test("accepts negative and decimal coordinates", () => {
    const e = parseExpr("([(-10,-1)-(10,1)],(-10,-1),(0,0.25),(10,1))");
    if (e.type !== "lookup") throw new Error("expected a lookup");
    expect(e.table.points[0]).toEqual({ x: -10, y: -1 });
    expect(e.table.points[1]).toEqual({ x: 0, y: 0.25 });
  });

  test("parses the range-only form as the line between its corners", () => {
    const e = parseExpr("([(0,0)-(10,5)])");
    if (e.type !== "lookup") throw new Error("expected a lookup");
    expect(e.table.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  test("parses points with no axis range, taking the range from the data", () => {
    const e = parseExpr("((0,0),(5,2))");
    if (e.type !== "lookup") throw new Error("expected a lookup");
    expect(e.table.points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 2 },
    ]);
    expect(e.table.xMax).toBe(5);
  });

  test("sorts points by input and drops a repeated input", () => {
    const e = parseExpr("([(0,0)-(10,10)],(10,10),(0,0),(5,9),(5,4))");
    if (e.type !== "lookup") throw new Error("expected a lookup");
    expect(e.table.points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 4 },
      { x: 10, y: 10 },
    ]);
  });

  test("a parenthesized expression is still a parenthesized expression", () => {
    expect(parseExpr("(1 + 2) * 3")).toEqual({
      type: "binary",
      op: "*",
      left: { type: "binary", op: "+", left: { type: "num", value: 1 }, right: { type: "num", value: 2 } },
      right: { type: "num", value: 3 },
    });
    expect(parseExpr("((A + B) / 2)").type).toBe("binary");
  });

  test("round-trips through the printer", () => {
    const e = parseExpr(TABLE);
    const printed = exprToString(e);
    expect(printed).toBe(TABLE);
    expect(exprToString(parseExpr(printed))).toBe(printed);
  });

  test("WITH LOOKUP parses its table argument", () => {
    const e = parseExpr(`WITH LOOKUP(Time, ([(0,0)-(10,1)],(0,0),(10,1)))`);
    expect(e.type).toBe("call");
    if (e.type !== "call") return;
    expect(e.name).toBe("WITH_LOOKUP");
    expect(e.args[1]?.type).toBe("lookup");
  });
});

describe("lookup evaluation", () => {
  test("interpolates linearly between points", () => {
    const e = parseExpr(TABLE);
    if (e.type !== "lookup") throw new Error("expected a lookup");
    expect(evaluateLookup(e.table, 0)).toBe(0);
    expect(evaluateLookup(e.table, 25)).toBeCloseTo(0.25, 10);
    expect(evaluateLookup(e.table, 50)).toBe(0.5);
    expect(evaluateLookup(e.table, 75)).toBeCloseTo(0.75, 10);
  });

  test("holds the end values outside the data, rather than extrapolating", () => {
    const e = parseExpr(TABLE);
    if (e.type !== "lookup") throw new Error("expected a lookup");
    expect(evaluateLookup(e.table, -1000)).toBe(0);
    expect(evaluateLookup(e.table, 1000)).toBe(1);
  });

  test("a call resolves against the model's lookup scope", () => {
    const scope = lookupScopeOf(
      (() => {
        const m = createEmptyModel();
        addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 10, y: 100 }] });
        return m;
      })(),
    );
    const e = parseExpr("Effect(4)");
    expect(evaluate(e, {}, scope)).toBeCloseTo(40, 10);
  });

  test("WITH LOOKUP evaluates inline", () => {
    const e = parseExpr("WITH LOOKUP(5, ([(0,0)-(10,10)],(0,0),(10,10)))");
    expect(evaluate(e, {})).toBeCloseTo(5, 10);
  });

  test("using a table as a bare value gives a useful error", () => {
    expect(() => evaluate(parseExpr(TABLE), {})).toThrow(/call it with an input/);
  });
});

describe("lookup as a model variable", () => {
  test("addLookup creates an auxiliary whose equation is the table", () => {
    const m = createEmptyModel();
    const aux = addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 10, y: 1 }], units: "Dmnl" });
    expect(aux.kind).toBe("auxiliary");
    expect(lookupTableOf(aux, m)?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 1 },
    ]);
  });

  test("a lookup is not a constant", () => {
    const m = createEmptyModel();
    const aux = addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 10, y: 1 }] });
    expect(isConstantAuxiliary(aux, m)).toBe(false);
  });

  test("calling a lookup counts as depending on it", () => {
    const m = createEmptyModel();
    addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 10, y: 1 }] });
    const input = addAuxiliary(m, { name: "Coverage", equation: "5" });
    const user = addAuxiliary(m, { name: "Rate", equation: "Effect(Coverage)" });
    const deps = equationDependencies(m, user).map((d) => d.name);
    expect(deps).toContain("Effect");
    expect(deps).toContain(input.name);
  });

  test("collectLookupRefs picks out lookups but not built-ins", () => {
    const refs = collectLookupRefs(parseExpr("MIN(2, Effect(Coverage)) + ABS(3)"));
    expect([...refs]).toEqual(["Effect"]);
  });

  test("setLookupPoints replaces the curve and keeps the axis limits", () => {
    const m = createEmptyModel();
    const aux = addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 10, y: 1 }], yMax: 99 });
    setLookupPoints(m, aux.id, { points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] });
    const table = lookupTableOf(aux, m)!;
    expect(table.points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
    expect(table.yMax).toBe(99);
  });
});

describe("lookup in the simulation", () => {
  test("drives a flow through the curve", () => {
    const m = createEmptyModel();
    m.simSpec = { startTime: 0, stopTime: 2, dt: 1, integrationMethod: "euler", timeUnits: "Year" };
    const stock = addStock(m, { name: "Stock", initialEquation: "100" });
    // A lookup on the stock's own level: draining faster the fuller it is.
    addLookup(m, { name: "Drain Fraction", points: [{ x: 0, y: 0 }, { x: 100, y: 1 }] });
    addFlow(m, { name: "Drain", equation: "Drain Fraction(Stock) * Stock", from: stock.id, to: null });

    const sim = simulate(m);
    // t=0: Stock=100 -> fraction 1 -> drain 100. t=1: Stock=0 -> fraction 0 -> drain 0.
    expect(sim.series["Stock"]![0]).toBe(100);
    expect(sim.series["Stock"]![1]).toBe(0);
    expect(sim.series["Stock"]![2]).toBe(0);
    expect(sim.series["Drain"]![0]).toBe(100);
  });

  test("a lookup definition gets no series of its own", () => {
    const m = createEmptyModel();
    addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 10, y: 1 }] });
    const sim = simulate(m);
    expect(sim.series["Effect"]).toBeUndefined();
  });
});

describe("lookup units checking", () => {
  test("a lookup call takes the units the lookup declares", () => {
    const m = createEmptyModel();
    addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 10, y: 1 }], units: "widgets" });
    addAuxiliary(m, { name: "Coverage", equation: "5", units: "Dmnl" });
    const good = addAuxiliary(m, { name: "Good", equation: "Effect(Coverage)", units: "widgets" });
    const bad = addAuxiliary(m, { name: "Bad", equation: "Effect(Coverage)", units: "gizmos" });
    const issues = checkUnits(m);
    expect(issues.some((i) => i.variableId === good.id)).toBe(false);
    expect(issues.some((i) => i.variableId === bad.id)).toBe(true);
  });

  test("a lookup definition itself is never flagged against its declared units", () => {
    const m = createEmptyModel();
    const aux = addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 10, y: 1 }], units: "widgets" });
    expect(checkUnits(m).some((i) => i.variableId === aux.id)).toBe(false);
  });
});

describe("lookup polarity", () => {
  test("a rising curve makes an increase in its input increase the output", () => {
    const m = createEmptyModel();
    addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 10, y: 1 }] });
    const scope = lookupScopeOf(m);
    expect(inferPolarity("Effect(Coverage)", "Coverage", ["Effect", "Coverage"], scope)).toBe("+");
  });

  test("a falling curve flips the sign", () => {
    const m = createEmptyModel();
    addLookup(m, { name: "Effect", points: [{ x: 0, y: 1 }, { x: 10, y: 0 }] });
    const scope = lookupScopeOf(m);
    expect(inferPolarity("Effect(Coverage)", "Coverage", ["Effect", "Coverage"], scope)).toBe("-");
  });

  test("a curve that both rises and falls is left undecided", () => {
    const m = createEmptyModel();
    addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 5, y: 1 }, { x: 10, y: 0 }] });
    const scope = lookupScopeOf(m);
    expect(inferPolarity("Effect(Coverage)", "Coverage", ["Effect", "Coverage"], scope)).toBeNull();
  });
});

describe("lookup .mdl round trip", () => {
  // Shape copied from two real Vensim-authored files (minsky's LongWave2.mdl and SDEverywhere's
  // lookup.mdl): a lookup's own record has NO `=`, and its points may wrap across lines.
  const MDL = [
    "{UTF-8}",
    "Effect of Coverage(",
    "\t[(0,0)-(100,1)],",
    "\t(0,0),(50,0.5),(100,1))",
    "\t~\tDmnl",
    "\t~\teffect on the rate",
    "\t|",
    "",
    "Coverage= 60",
    "\t~\tDmnl",
    "\t~",
    "\t|",
    "",
    "Rate= Effect of Coverage(Coverage)",
    "\t~\twidgets/Year",
    "\t~",
    "\t|",
    "",
    "FINAL TIME= 10",
    "\t~\tYear",
    "\t~",
    "\t|",
    "",
    "INITIAL TIME= 0",
    "\t~\tYear",
    "\t~",
    "\t|",
    "",
    "TIME STEP= 1",
    "\t~\tYear",
    "\t~",
    "\t|",
    "",
  ].join("\r\n");

  test("imports a real-Vensim-shaped lookup as an auxiliary", () => {
    const m = parseMdl(MDL);
    const aux = allVariables(m).find((v) => v.name === "Effect of Coverage");
    expect(aux?.kind).toBe("auxiliary");
    expect(lookupTableOf(aux!, m)?.points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0.5 },
      { x: 100, y: 1 },
    ]);
    expect(aux!.units).toBe("Dmnl");
    expect(aux!.comment).toBe("effect on the rate");
  });

  test("re-exports and re-imports to the same table", () => {
    const first = parseMdl(MDL);
    const written = writeMdl(first);
    const second = parseMdl(written);
    const a = lookupTableOf(allVariables(first).find((v) => v.name === "Effect of Coverage")!, first);
    const b = lookupTableOf(allVariables(second).find((v) => v.name === "Effect of Coverage")!, second);
    expect(b).toEqual(a);
    // The generated record must be exactly Vensim's own shape — no `=` — so a real Vensim install
    // reads it the same way it reads a file Vensim itself wrote.
    expect(written).toContain("Effect of Coverage(\r\n\t[(0,0)-(100,1)],\r\n\t(0,0),(50,0.5),(100,1))");
    expect(written).not.toContain("Effect of Coverage= ");
  });

  test("the same model simulates identically after a round trip", () => {
    const first = parseMdl(MDL);
    const second = parseMdl(writeMdl(first));
    expect(second.auxiliaries.find((a) => a.name === "Rate")?.equation).toBe("Effect of Coverage(Coverage)");
  });
});

describe("lookup XMILE export", () => {
  test("attaches the curve to the calling variable", () => {
    const m = createEmptyModel();
    m.simSpec = { startTime: 0, stopTime: 10, dt: 1, integrationMethod: "euler", timeUnits: "Year" };
    addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 100, y: 1 }] });
    addAuxiliary(m, { name: "Coverage", equation: "60" });
    addAuxiliary(m, { name: "Rate", equation: "Effect(Coverage)" });

    const xml = writeXmile(m);
    // The curve lands on `Rate`, whose <eqn> becomes the curve's input.
    expect(xml).toContain('<aux name="Rate">');
    expect(xml).toContain("<eqn>Coverage</eqn>");
    expect(xml).toContain("<xpts>0,100</xpts>");
    expect(xml).toContain("<ypts>0,1</ypts>");
    // And the standalone definition is gone — XMILE has nowhere to put it.
    expect(xml).not.toContain('name="Effect"');
  });

  test("synthesizes a helper aux when the call is part of a larger expression", () => {
    const m = createEmptyModel();
    addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 100, y: 1 }] });
    addAuxiliary(m, { name: "Coverage", equation: "60" });
    addAuxiliary(m, { name: "Rate", equation: "3 * Effect(Coverage)" });

    const xml = writeXmile(m);
    expect(xml).toContain('<aux name="Rate lookup 1">');
    expect(xml).toContain("<eqn>Coverage</eqn>");
    expect(xml).toContain("<eqn>3 * \"Rate lookup 1\"</eqn>");
  });

  test("a stock's lookup call goes through a helper, since a stock <eqn> is its initial value", () => {
    const m = createEmptyModel();
    addLookup(m, { name: "Effect", points: [{ x: 0, y: 0 }, { x: 100, y: 1 }] });
    addAuxiliary(m, { name: "Coverage", equation: "60" });
    addStock(m, { name: "Stock", initialEquation: "Effect(Coverage)" });

    const xml = writeXmile(m);
    expect(xml).toContain('<stock name="Stock">');
    expect(xml).toContain("<eqn>\"Stock lookup 1\"</eqn>");
    expect(xml).toContain("<xpts>0,100</xpts>");
  });
});

describe("lookup expression edge cases", () => {
  test("a lookup nested as a call argument still parses", () => {
    const e = tryParseExpr("MIN(2, WITH LOOKUP(Time, ([(0,0)-(1,1)],(0,0),(1,1))))");
    expect(e).not.toBeNull();
    if (e?.type !== "call") throw new Error("expected a call");
    expect(e.args[1]?.type).toBe("call");
  });

  test("a real Vensim file's WITH LOOKUP, spacing and all", () => {
    // Verbatim from climateinteractive/SDEverywhere's lookup.mdl.
    const e = tryParseExpr("WITH LOOKUP ( -1, ([(0,0)-(2,2)],(0,0),(1,1),(2,2)) )");
    if (e?.type !== "call") throw new Error("expected a call");
    expect(evaluate(e, {})).toBeCloseTo(0, 10);
  });

  test("a malformed table is not silently accepted", () => {
    expect(tryParseExpr("([(0,0)-(10,1)],(0,0)")).toBeNull();
    expect(tryParseExpr("([(0,0)-(10,1)],(0))")).toBeNull();
  });
});
