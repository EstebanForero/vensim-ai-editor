import { describe, expect, test } from "bun:test";
import { checkUnits, parseUnits } from "../src/model/units.js";
import { addAuxiliary, addStock } from "../src/model/builder/index.js";
import { createEmptyModel } from "../src/model/types.js";

describe("parseUnits", () => {
  test("simple atom", () => {
    expect(parseUnits("bicicletas")).toEqual({ bicicletas: 1 });
  });

  test("quotient", () => {
    expect(parseUnits("bicicletas/día")).toEqual({ bicicletas: 1, día: -1 });
  });

  test("product", () => {
    expect(parseUnits("dollars*year")).toEqual({ dollars: 1, year: 1 });
  });

  test("exponent", () => {
    expect(parseUnits("meter^2")).toEqual({ meter: 2 });
  });

  test("dimensionless words", () => {
    expect(parseUnits("Dmnl")).toEqual({});
    expect(parseUnits("1")).toEqual({});
  });

  test("an empty units string is unknown, not a claim of dimensionless", () => {
    expect(parseUnits("")).toBe("unknown");
  });

  test("strips a trailing [min,max] range suffix", () => {
    expect(parseUnits("Year [0,?]")).toEqual({ year: 1 });
  });

  test("cancels out to dimensionless", () => {
    expect(parseUnits("year/year")).toEqual({});
  });

  test("unparseable syntax comes back unknown, not a wrong guess", () => {
    expect(parseUnits("(people+widgets)/year")).toBe("unknown");
  });
});

describe("checkUnits", () => {
  test("R = P / T with correctly-declared units: no issues", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "P", equation: "5", units: "widgets" });
    addAuxiliary(model, { name: "T", equation: "2", units: "day" });
    addAuxiliary(model, { name: "R", equation: "P / T", units: "widgets/day" });

    expect(checkUnits(model)).toEqual([]);
  });

  test("declared units don't match what the equation computes", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "P", equation: "5", units: "widgets" });
    addAuxiliary(model, { name: "T", equation: "2", units: "day" });
    addAuxiliary(model, { name: "R", equation: "P / T", units: "widgets" }); // missing /day

    const issues = checkUnits(model);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.variableName).toBe("R");
    expect(issues[0]!.message).toContain("widgets/day");
  });

  test("adding two differently-unit'd terms is flagged even without a declared-units mismatch", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "A", equation: "5", units: "widgets" });
    addAuxiliary(model, { name: "B", equation: "2", units: "day" });
    addAuxiliary(model, { name: "C", equation: "A + B", units: "widgets" });

    const issues = checkUnits(model);
    expect(issues.some((i) => i.variableName === "C" && i.message.includes("sum of mismatched units"))).toBe(true);
  });

  test("a bare numeric-literal equation is never flagged against its declared units", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Target", equation: "100", units: "widgets" });
    expect(checkUnits(model)).toEqual([]);
  });

  // Regression: real Vensim lets an inline, untyped numeric constant blend into any expression
  // without complaint (e.g. `Cost + 5` where Cost is in dollars raises no error in Vensim
  // itself) — extremely common in practice (MAX(0, X), Rate * 0.5, X + 1, ...). The checker
  // previously treated every bare number as strictly dimensionless with no way to tell that
  // apart from a variable or sub-expression that genuinely computes to Dmnl, so any equation
  // combining a real variable with an inline constant via +/- (or MIN/MAX/IF THEN ELSE) false-
  // positived as a unit mismatch purely because of the literal, unrelated to the equation's
  // actual correctness.
  test("an inline numeric literal added to a dimensioned variable is not flagged", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Cost", equation: "10", units: "dollars" });
    addAuxiliary(model, { name: "Total", equation: "Cost + 5", units: "dollars" });
    addAuxiliary(model, { name: "Adjusted", equation: "MAX(0, Cost)", units: "dollars" });
    addAuxiliary(model, { name: "Scaled", equation: "Cost * 0.5", units: "dollars" });

    expect(checkUnits(model)).toEqual([]);
  });

  test("but two REAL dimensioned variables that don't match are still flagged, literal or not", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "A", equation: "5", units: "widgets" });
    addAuxiliary(model, { name: "B", equation: "2", units: "day" });
    // A ratio that cancels to Dmnl is NOT a literal — it's a real computed dimensionless
    // quantity, and adding it to something dimensioned is still a genuine mismatch.
    addAuxiliary(model, { name: "Ratio", equation: "A / A", units: "Dmnl" });
    addAuxiliary(model, { name: "Bad", equation: "Ratio + B", units: "day" });

    const issues = checkUnits(model);
    expect(issues.some((i) => i.variableName === "Bad" && i.message.includes("sum of mismatched units"))).toBe(true);
  });

  test("a variable with no declared units is never flagged, and doesn't poison downstream checks", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Mystery", equation: "5" }); // no units
    addAuxiliary(model, { name: "R", equation: "Mystery * 2", units: "widgets" });
    expect(checkUnits(model)).toEqual([]);
  });

  test("MIN/MAX arguments must share units", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "A", equation: "5", units: "widgets" });
    addAuxiliary(model, { name: "B", equation: "2", units: "day" });
    addAuxiliary(model, { name: "R", equation: "MIN(A, B)" });

    const issues = checkUnits(model);
    expect(issues.some((i) => i.message.includes("MIN(...) arguments"))).toBe(true);
  });

  test("EXP/LN require a dimensionless argument", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "A", equation: "5", units: "widgets" });
    addAuxiliary(model, { name: "R", equation: "EXP(A)" });

    const issues = checkUnits(model);
    expect(issues.some((i) => i.message.includes("EXP(...) argument must be dimensionless"))).toBe(true);
  });

  test("a stock's initial equation is checked against its own declared units", () => {
    const model = createEmptyModel();
    const p = addAuxiliary(model, { name: "P", equation: "5", units: "widgets" });
    addStock(model, { name: "S", initialEquation: "P", units: "day" });

    const issues = checkUnits(model);
    expect(issues.some((i) => i.variableName === "S")).toBe(true);
    void p;
  });

  // Regression: reported directly from a real Vensim session — a model whose flows/auxiliaries
  // declared units like "recursos/mes" alongside a model time unit of "Month" showed unit errors
  // in real Vensim that this checker completely missed. The dimensional check alone can't catch
  // this: "mes" and "Month" denote the exact same dimension (both ARE the model's time unit),
  // just spelled differently — real Vensim's own Units Check compares that spelling literally,
  // and flags exactly this.
  test("flags a units string using a translated time-unit word instead of the model's own spelling", () => {
    const model = createEmptyModel();
    model.simSpec.timeUnits = "Month";
    addAuxiliary(model, { name: "Asignacion mensual", equation: "250", units: "recursos/mes" });

    const issues = checkUnits(model);
    expect(issues.some((i) => i.message.includes('"mes"') && i.message.includes('"Month"'))).toBe(true);
  });

  test("does not flag a units string that already uses the model's own time-unit spelling", () => {
    const model = createEmptyModel();
    model.simSpec.timeUnits = "Month";
    addAuxiliary(model, { name: "Monthly Budget", equation: "250", units: "resources/Month" });

    expect(checkUnits(model)).toEqual([]);
  });

  test("an unrecognized time-unit word (not English or a known translation) is left alone", () => {
    const model = createEmptyModel();
    model.simSpec.timeUnits = "Month";
    addAuxiliary(model, { name: "A", equation: "1", units: "widgets/fortnight" });

    expect(checkUnits(model)).toEqual([]);
  });
});

describe("Time is a built-in, not a variable", () => {
  // Vensim's own Units Check flags `5 + 0.15 * Time` declared in m3/Month: 0.15 is dimensionless
  // and Time is in months, so the right-hand side comes out in months. This check used to say
  // NOTHING about it, because Time wasn't in the units map — every equation mentioning the clock
  // was unresolvable, and unresolvable equations are skipped. That silence is what let the AI,
  // which is told to run check_units and fix what it reports, ship the equation.
  test("a coefficient applied to Time without units is flagged", () => {
    const m = createEmptyModel("demand");
    m.simSpec = { startTime: 0, stopTime: 80, dt: 0.25, integrationMethod: "euler", timeUnits: "Month" };
    const a = addAuxiliary(m, { name: "Demanda A", equation: "5 + 0.15 * Time", units: "m3/Month" });
    const issues = checkUnits(m);
    expect(issues.some((i) => i.variableId === a.id)).toBe(true);
  });

  test("Time used with a correctly-unit'd coefficient is not flagged", () => {
    const m = createEmptyModel("demand");
    m.simSpec = { startTime: 0, stopTime: 80, dt: 0.25, integrationMethod: "euler", timeUnits: "Month" };
    // Both terms in m3/Month: the literal is untyped and blends, the scaled Time works out.
    const a = addAuxiliary(m, { name: "Ramp", equation: "0.15 * Time * 1", units: "Month" });
    expect(checkUnits(m).some((i) => i.variableId === a.id)).toBe(false);
  });
});
