import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { addAuxiliary, addConnector, addFlow, addStock } from "../src/model/builder/index.js";
import { detectLoops } from "../src/loops/index.js";
import { createEmptyModel } from "../src/model/types.js";
import { parseMdl } from "../src/mdl/parser.js";
import { writeMdl } from "../src/mdl/writer.js";
import { simulate } from "../src/sim/engine.js";

const SAMPLE_MDL = `{UTF-8}
Population= INTEG (
	Births-Deaths,
		100) ~~|

Births= Population*Birth Rate ~~|

Deaths= Population*Death Rate ~~|

Birth Rate= 0.02 ~~|

Death Rate= 0.01 ~~|

********************************************************
	.Control
********************************************************~
		Simulation Control Parameters
	|

FINAL TIME  = 100
	~	Month
	~	The final time for the simulation.
	|

INITIAL TIME  = 0
	~	Month
	~	The initial time for the simulation.
	|

SAVEPER  =
        TIME STEP
	~	Month [0,?]
	~	The frequency with which output is stored.
	|

TIME STEP  = 0.25
	~	Month [0,?]
	~	The time step for the simulation.
	|

\\\\\\---/// Sketch information - do not modify anything except names
V300  Do not put anything below this section - it will be ignored
*View 1
$192-192-192,0,Times New Roman|12||0-0-0|0-0-0|0-0-255|-1--1--1|-1--1--1|96,96,100,0
10,1,Population,300,200,40,20,3,3,0,0,0,0,0,0
10,2,Births,150,200,30,15,40,3,0,0,-1,0,0,0
10,3,Deaths,450,200,30,15,40,3,0,0,-1,0,0,0
10,6,Birth Rate,150,280,30,15,8,3,0,0,-1,0,0,0
1,7,6,2,1,0,0,0,0,64,0,-1--1--1,,1|(150,240)|
10,8,Death Rate,450,280,30,15,8,3,0,0,-1,0,0,0
1,9,8,3,1,0,0,0,0,64,0,-1--1--1,,1|(450,240)|
///---\\\\\\
`;

describe("mdl codec", () => {
  test("parses a classic population model", () => {
    const model = parseMdl(SAMPLE_MDL);
    expect(model.stocks.map((s) => s.name)).toEqual(["Population"]);
    expect(model.flows.map((f) => f.name).sort()).toEqual(["Births", "Deaths"]);
    expect(model.auxiliaries.map((a) => a.name).sort()).toEqual(["Birth Rate", "Death Rate"]);
    expect(model.simSpec.stopTime).toBe(100);
    expect(model.simSpec.dt).toBe(0.25);

    // Sketch coordinates are the shape's *center* in real Vensim files (300,200 with a 40x20
    // box here) — this editor's own Position convention is top-left, so this must convert.
    const pop = model.stocks[0]!;
    expect(pop.pos).toEqual({ x: 280, y: 190 });
    expect(model.connectors.length).toBeGreaterThan(0);
  });

  test("parsed model simulates sensibly", () => {
    const model = parseMdl(SAMPLE_MDL);
    model.simSpec.integrationMethod = "rk4";
    const result = simulate(model);
    const last = result.series["Population"]!.at(-1)!;
    // net growth rate 1%/month over 100 months
    expect(last).toBeGreaterThan(100);
    expect(last).toBeCloseTo(100 * Math.exp(0.01 * 100), 0);
  });

  test("round-trips a hand-built model through write -> parse", () => {
    const model = createEmptyModel("RoundTrip");
    const stock = addStock(model, { name: "Inventory", initialEquation: "50", units: "Widgets" });
    addFlow(model, { name: "Production", equation: "10", to: stock.id, units: "Widgets/Month" });
    addFlow(model, { name: "Shipping", equation: "Inventory*0.1", from: stock.id, units: "Widgets/Month" });
    addAuxiliary(model, { name: "Target", equation: "200" });

    const mdlText = writeMdl(model);
    const reparsed = parseMdl(mdlText);

    expect(reparsed.stocks.map((s) => s.name).sort()).toEqual(["Inventory"]);
    expect(reparsed.flows.map((f) => f.name).sort()).toEqual(["Production", "Shipping"]);
    expect(reparsed.auxiliaries.map((a) => a.name).sort()).toEqual(["Target"]);

    const again = parseMdl(writeMdl(reparsed));
    expect(again.stocks.length).toBe(reparsed.stocks.length);
    expect(again.flows.length).toBe(reparsed.flows.length);
    expect(again.auxiliaries.length).toBe(reparsed.auxiliaries.length);
  });

  test("writes R/B loop comment annotations and curved relation arrows for native Vensim", () => {
    const model = createEmptyModel("LoopExport");
    const stock = addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 } });
    const births = addFlow(model, { name: "Births", equation: "Population * Birth Rate", to: stock.id, pos: { x: 150, y: 100 } });
    addAuxiliary(model, { name: "Birth Rate", equation: "0.02", pos: { x: 0, y: 200 } });
    addConnector(model, { from: "Population", to: births.id });
    addConnector(model, { from: "Birth Rate", to: births.id });

    const mdlText = writeMdl(model);

    // Loop badge shows up as a freestanding `12,` text record (shape code 0 — a plain text
    // box, not a built-in icon like Vensim's own cloud glyph) with a bare "R"/"B", matching
    // native Vensim's own loop-indicator convention (see example-compatibility/flow-diagram.mdl).
    expect(mdlText).toMatch(/^12,\d+,0,-?\d+,-?\d+,27,27,4,7,/m);
    expect(mdlText).toMatch(/^R$/m);

    // Connector arrows carry field codes matching a real causal/info-link arrow (see
    // example-compatibility/flow-diagram.mdl) and a non-origin bend waypoint.
    const connectorLines = mdlText.split("\n").filter((l) => l.startsWith("1,") && l.includes(",1,0,43,0,0,192,0,"));
    expect(connectorLines.length).toBeGreaterThan(0);
    for (const line of connectorLines) expect(line).not.toContain("|(0,0)|");

    // The file must still parse cleanly — comments/curve points don't confuse the codec.
    const reparsed = parseMdl(mdlText);
    expect(reparsed.stocks).toHaveLength(1);
    expect(reparsed.connectors.length).toBeGreaterThan(0);
  });

  test("reads a real Vensim export (example-compatibility/flow-diagram.mdl) faithfully", () => {
    // A hand-exported-from-Vensim rabbit-population model — the reference for this editor's
    // compatibility with files it did not itself write. In particular, its causal arrows are
    // drawn *into a flow's valve icon* (a separate sketch shape from the flow's name label),
    // which is the normal way Vensim draws "this variable affects this flow" and must resolve
    // to the flow's name for loop detection to see the model's real feedback structure.
    const fixturePath = join(import.meta.dir, "..", "..", "..", "example-compatibility", "flow-diagram.mdl");
    const model = parseMdl(readFileSync(fixturePath, "utf-8"));

    expect(model.stocks.map((s) => s.name)).toEqual(["Poblacion"]);
    expect(model.flows.map((f) => f.name).sort()).toEqual(["muertes", "nacimientos"]);
    expect(model.auxiliaries.map((a) => a.name).sort()).toEqual(["tasa mortalidad", "tasa nacimientos"]);

    // Every causal arrow into a flow's valve must resolve to that flow, not get dropped.
    const connectorPairs = model.connectors
      .map((c) => {
        const from = [...model.stocks, ...model.flows, ...model.auxiliaries].find((v) => v.id === c.from)?.name;
        const to = [...model.stocks, ...model.flows, ...model.auxiliaries].find((v) => v.id === c.to)?.name;
        return `${from}->${to}`;
      })
      .sort();
    expect(connectorPairs).toEqual(["Poblacion->muertes", "Poblacion->nacimientos", "tasa mortalidad->muertes", "tasa nacimientos->nacimientos"]);

    // Flow-pipe geometry arrows (valve <-> stock/cloud) must NOT become spurious connectors.
    expect(model.connectors).toHaveLength(4);

    const loops = detectLoops(model);
    expect(loops.map((l) => l.polarity).sort()).toEqual(["B", "R"]);

    const sim = simulate(model);
    expect(sim.series["Poblacion"]?.at(-1)).toBeGreaterThan(0);

    // Round-trips: re-exporting and re-parsing keeps the same causal structure and simulates
    // the same way (the loop badges/graph pad this editor adds on export must not confuse it).
    const reExported = parseMdl(writeMdl(model));
    expect(reExported.connectors).toHaveLength(4);
    expect(detectLoops(reExported).map((l) => l.polarity).sort()).toEqual(["B", "R"]);
    expect(simulate(reExported).series["Poblacion"]?.at(-1)).toBeCloseTo(sim.series["Poblacion"]!.at(-1)!, 6);
  });
});
