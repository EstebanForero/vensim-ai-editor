import { describe, expect, test } from "bun:test";
import { parseMdl } from "../src/mdl/parser.js";
import { writeMdl } from "../src/mdl/writer.js";
import { addConnector, addStock } from "../src/model/builder/index.js";
import { setCustomGraph } from "../src/model/graphs.js";
import { parseNativeModel, writeNativeModel } from "../src/model/native.js";
import { createEmptyModel } from "../src/model/types.js";

describe("native model file", () => {
  test("keeps positions, a dragged curve, RK4, ids, and a custom graph", () => {
    const model = createEmptyModel("Kept");
    const stock = addStock(model, { name: "Population", initialEquation: "10", pos: { x: 12.5, y: 40.25 }, units: "People" });
    stock.size = { width: 90, height: 48 };
    const link = addConnector(model, { from: "Population", to: "Population", polarity: "-" });
    link.bend = { x: 3.5, y: 9.25 };
    model.simSpec.integrationMethod = "rk4";
    model.simSpec.dt = 0.125;
    setCustomGraph(model, {
      name: "People",
      title: "People",
      scales: [
        {
          shared: true,
          variables: [
            { name: "Population", lineStyle: "DASH", extra: [] },
            { name: "Population", lineStyle: "DOT", label: "again", extra: [] },
          ],
        },
      ],
      extra: [],
    });

    const back = parseNativeModel(writeNativeModel(model));
    expect(back).toEqual(model);

    const viaMdl = parseMdl(writeMdl(model));
    expect(viaMdl.stocks[0]?.pos).not.toEqual(stock.pos);
    expect(viaMdl.connectors[0]?.bend).toBeNull();
    expect(viaMdl.simSpec.integrationMethod).toBe("euler");
  });

  test("rejects a .mdl and a newer version", () => {
    expect(() => parseNativeModel("{UTF-8}\n")).toThrow(/not a Vensim AI model/);
    const model = createEmptyModel();
    const doc = JSON.parse(writeNativeModel(model)) as { version: number };
    doc.version = 2;
    expect(() => parseNativeModel(JSON.stringify(doc))).toThrow(/version 2/);
  });
});
