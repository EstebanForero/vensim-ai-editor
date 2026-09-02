import { describe, expect, test } from "bun:test";
import { addAuxiliary, addFlow, addStock } from "../src/model/builder/index.js";
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

    const pop = model.stocks[0]!;
    expect(pop.pos).toEqual({ x: 300, y: 200 });
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
    addAuxiliary(model, { name: "Target", equation: "200", isConstant: true });

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
});
