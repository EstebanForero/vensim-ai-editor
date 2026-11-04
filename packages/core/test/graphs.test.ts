import { describe, expect, test } from "bun:test";
import { parseCustomOutput, writeCustomOutput } from "../src/mdl/customOutput.js";
import { parseMdl } from "../src/mdl/parser.js";
import { writeMdl } from "../src/mdl/writer.js";
import { deleteCustomGraph, setCustomGraph } from "../src/model/graphs.js";
import { createEmptyModel } from "../src/model/types.js";

const GET_DATA = `
:GRAPH GET_DATA_AT_TIME
:TITLE GET DATA AT TIME
:SCALE
:VAR sales data
:DATASET
:LINE-WIDTH 2
:VAR sales data AT TIME
:DATASET
:LINE-WIDTH 3
:VAR init sales data AT TIME
:DATASET
:LINE-STYLE DASH
:VAR sales data with TIME SHIFT
:DATASET
:LINE-WIDTH 1

:GRAPH GET_DATA_AT_TIME_-_dots
:TITLE GET DATA AT TIME - dots
:DOTS
:SCALE
:VAR sales data
:DATASET
:VAR sales data AT TIME
:DATASET
`;

describe("custom graph text", () => {
  test("reads a Vensim sample graph: one scale, widths, and a dashed series", () => {
    const items = parseCustomOutput(GET_DATA);
    expect(items).toHaveLength(2);
    const graph = items[0]!.kind === "graph" ? items[0].graph : undefined;
    expect(graph?.name).toBe("GET_DATA_AT_TIME");
    expect(graph?.title).toBe("GET DATA AT TIME");
    expect(graph?.scales).toHaveLength(1);
    expect(graph?.scales[0]!.shared).toBe(true);
    const vars = graph!.scales[0]!.variables;
    expect(vars.map((v) => [v.name, v.lineStyle ?? null, v.lineWidth ?? null])).toEqual([
      ["sales data", null, 2],
      ["sales data AT TIME", null, 3],
      ["init sales data AT TIME", "DASH", null],
      ["sales data with TIME SHIFT", null, 1],
    ]);
    expect(vars.every((v) => v.dataset === "")).toBe(true);
    const dots = items[1]!.kind === "graph" ? items[1].graph : undefined;
    expect(dots?.dots).toBe(true);
    expect(dots?.scales[0]!.variables.map((v) => v.lineStyle)).toEqual([undefined, undefined]);
  });

  test("round-trips styles, colors, separate scales, an X-Y axis, and a preserved report", () => {
    const text = [
      ":GRAPH Birth_&_Death_Rates",
      ":TITLE Birth & Death Rates",
      ":X-MIN 1900",
      ":X-MAX 2100",
      ":SCALE",
      ":VAR birth rate",
      ":LINE-WIDTH 3",
      ":VAR death rate",
      ":LINE-COLOR 20-40-180",
      ":LINE-WIDTH 3",
      ":SCALE",
      ":VAR pollution ratio",
      ":LINE-STYLE DASH",
      ":VAR material standard of living",
      ":LINE-STYLE DOT",
      ":Y-MIN 0",
      ":Y-MAX 2",
      "",
      ":GRAPH Population_-_Food",
      ":TITLE Population - Food",
      ":X-AXIS food ratio",
      ":SCALE",
      ":VAR births food multiplier|births",
      ":LINE-STYLE DASHDOT",
      ":VAR deaths food multiplier",
      ":LINE-STYLE DASHDOTDOT",
      "",
      ":REPORT HEADCOUNT",
      ":VAR direct_labor",
      ":END-OF-REPORT",
    ].join("\n");

    const again = writeCustomOutput(parseCustomOutput(text));
    const items = parseCustomOutput(again);
    expect(items.map((item) => (item.kind === "graph" ? item.graph.name : "report"))).toEqual([
      "Birth_&_Death_Rates",
      "Population_-_Food",
      "report",
    ]);
    const birth = items[0]!.kind === "graph" ? items[0].graph : undefined!;
    expect(birth.xMin).toBe(1900);
    expect(birth.xMax).toBe(2100);
    expect(birth.scales).toHaveLength(2);
    expect(birth.scales[1]!.variables.map((v) => v.lineStyle)).toEqual(["DASH", "DOT"]);
    expect(birth.scales[1]!.variables[1]!.yMin).toBe(0);
    expect(birth.scales[1]!.variables[1]!.yMax).toBe(2);
    expect(birth.scales[0]!.variables[1]!.lineColor).toEqual({ r: 20, g: 40, b: 180 });
    const food = items[1]!.kind === "graph" ? items[1].graph : undefined!;
    expect(food.xAxis).toBe("food ratio");
    expect(food.scales[0]!.variables.map((v) => [v.name, v.label, v.lineStyle])).toEqual([
      ["births food multiplier", "births", "DASHDOT"],
      ["deaths food multiplier", undefined, "DASHDOTDOT"],
    ]);
    const report = items[2]!.kind === "raw" ? items[2].text : "";
    expect(report).toContain(":REPORT HEADCOUNT");
    expect(report).toContain(":END-OF-REPORT");
  });

  test("keeps a quoted name that itself contains a comma on one variable", () => {
    const [item] = parseCustomOutput(':GRAPH Q\n:VAR "QUANTUM(x,1)"|level\n');
    const graph = item!.kind === "graph" ? item.graph : undefined;
    expect(graph?.scales[0]!.variables).toEqual([
      expect.objectContaining({ name: "QUANTUM(x,1)", label: "level" }),
    ]);
  });

  test("variables with no :SCALE are separate scales", () => {
    const [item] = parseCustomOutput(":GRAPH world\n:VAR Capital\n:VAR Population\n");
    const graph = item!.kind === "graph" ? item.graph : undefined;
    expect(graph?.scales.map((s) => s.variables.map((v) => v.name))).toEqual([["Capital"], ["Population"]]);
    expect(graph?.scales.every((s) => !s.shared)).toBe(true);
  });
});

describe("custom graphs in a model file", () => {
  test("reads the block after the sketch and writes it back ahead of the settings tail", () => {
    const mdl = [
      "{UTF-8}",
      "Stock= INTEG (",
      "\t0,",
      "\t\t1)",
      "\t~\t",
      "\t~\t",
      "\t|",
      "",
      "\\\\\\---/// Sketch information - do not modify anything except names",
      "V300",
      "*View 1",
      "///---\\\\\\",
      ":GRAPH SPEED",
      ":TITLE Work Speed",
      ":X-AXIS Time",
      ":SCALE",
      ":VAR Stock|Level",
      ":LINE-STYLE DOT",
      ":L\u007f<%^E!@",
      "4:Time",
      "",
    ].join("\n");
    const model = parseMdl(mdl);
    expect(model.stocks.map((s) => s.name)).toEqual(["Stock"]);
    expect(model.customOutput).toHaveLength(1);
    const graph = model.customOutput[0]!.kind === "graph" ? model.customOutput[0].graph : undefined;
    expect(graph?.name).toBe("SPEED");
    expect(graph?.scales[0]!.variables[0]).toMatchObject({ name: "Stock", label: "Level", lineStyle: "DOT" });
    expect(model.vensimFileTail.startsWith(":L\u007f<%^E!@")).toBe(true);
    expect(model.vensimFileTail).toContain("4:Time");

    const written = writeMdl(model);
    const again = parseMdl(written);
    expect(again.customOutput).toEqual(model.customOutput);
    expect(again.vensimFileTail).toBe(model.vensimFileTail);
    expect(written.indexOf(":GRAPH SPEED")).toBeGreaterThan(written.indexOf("///---\\\\\\"));
    expect(written.indexOf(":L\u007f<%^E!@")).toBeGreaterThan(written.indexOf(":LINE-STYLE DOT"));
  });

  test("set and delete round-trip through the file", () => {
    const model = createEmptyModel();
    setCustomGraph(model, {
      name: "People",
      title: "People and births",
      scales: [
        {
          shared: true,
          variables: [
            { name: "Population", lineStyle: "DASH", extra: [] },
            { name: "Births", extra: [] },
          ],
        },
      ],
      extra: [],
    });
    const back = parseMdl(writeMdl(model));
    const graph = back.customOutput[0]!.kind === "graph" ? back.customOutput[0].graph : undefined;
    expect(graph?.title).toBe("People and births");
    expect(graph?.scales[0]!.variables.map((v) => v.lineStyle ?? "SOLID")).toEqual(["DASH", "SOLID"]);
    deleteCustomGraph(back, "people");
    expect(back.customOutput).toHaveLength(0);
    expect(writeMdl(back).includes(":GRAPH")).toBe(false);
  });

  test("refuses a styled line that also sets a width", () => {
    const model = createEmptyModel();
    expect(() =>
      setCustomGraph(model, {
        name: "G",
        scales: [{ shared: true, variables: [{ name: "A", lineStyle: "DOT", lineWidth: 3, extra: [] }] }],
        extra: [],
      }),
    ).toThrow(/cannot combine/);
  });
});
