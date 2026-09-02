// Serializes a Model back to Vensim .mdl text.
//
// Produces a valid equations section (round-trips through parseMdl) plus a best-effort
// sketch section using Vensim's `10,` (variable box) and `1,` (arrow) record shapes so the
// file opens with a laid-out diagram. This is not a byte-exact replica of Vensim's own writer
// (see project plan) — the goal is a file Vensim can open and simulate, and that this editor
// round-trips losslessly.

import { allVariables, type Model, type Variable } from "../model/types.js";

function quoteNameIfNeeded(name: string): string {
  return name;
}

function variableRecord(name: string, equation: string, units: string, comment: string): string {
  return `${quoteNameIfNeeded(name)}= ${equation}\n\t~\t${units}\n\t~\t${comment}\n\t|\n\n`;
}

export function writeMdl(model: Model): string {
  let out = "{UTF-8}\n";

  for (const stock of model.stocks) {
    const inflowTerms = stock.inflows
      .map((id) => model.flows.find((f) => f.id === id)?.name)
      .filter((n): n is string => !!n);
    const outflowTerms = stock.outflows
      .map((id) => model.flows.find((f) => f.id === id)?.name)
      .filter((n): n is string => !!n);
    const parts = [...inflowTerms.map((n) => `+${n}`), ...outflowTerms.map((n) => `-${n}`)];
    const netExpr = parts.length ? parts.join(" ").replace(/^\+/, "") : "0";
    out += `${quoteNameIfNeeded(stock.name)}= INTEG (\n\t${netExpr},\n\t\t${stock.initialEquation})\n\t~\t${stock.units}\n\t~\t${stock.comment}\n\t|\n\n`;
  }

  for (const flow of model.flows) {
    out += variableRecord(flow.name, flow.equation, flow.units, flow.comment);
  }

  for (const aux of model.auxiliaries) {
    out += variableRecord(aux.name, aux.equation, aux.units, aux.comment);
  }

  out += "********************************************************\n\t.Control\n";
  out += "********************************************************~\n\t\tSimulation Control Parameters\n\t|\n\n";
  out += variableRecord("FINAL TIME", String(model.simSpec.stopTime), model.simSpec.timeUnits, "The final time for the simulation.");
  out += variableRecord("INITIAL TIME", String(model.simSpec.startTime), model.simSpec.timeUnits, "The initial time for the simulation.");
  out += variableRecord("SAVEPER", "TIME STEP", model.simSpec.timeUnits, "The frequency with which output is stored.");
  out += variableRecord("TIME STEP", String(model.simSpec.dt), model.simSpec.timeUnits, "The time step for the simulation.");

  out += writeSketch(model);
  return out;
}

function writeSketch(model: Model): string {
  const vars = allVariables(model);
  const idIndex = new Map<string, number>();
  let counter = 0;
  for (const v of vars) {
    counter += 1;
    idIndex.set(v.id, counter);
  }

  let out = "\\\\\\---/// Sketch information - do not modify anything except names\n";
  out += "V300  Do not put anything below this section - it will be ignored\n";
  out += "*View 1\n";
  out += "$192-192-192,0,Times New Roman|12||0-0-0|0-0-0|0-0-255|-1--1--1|-1--1--1|96,96,100,0\n";

  for (const v of vars) {
    const shapeType = shapeTypeFor(v);
    out += `10,${idIndex.get(v.id)},${v.name},${Math.round(v.pos.x)},${Math.round(v.pos.y)},${Math.round(v.size.width)},${Math.round(v.size.height)},${shapeType},3,0,0,0,0,0,0\n`;
  }

  let arrowId = counter;
  for (const flow of model.flows) {
    if (flow.from) {
      arrowId += 1;
      out += `1,${arrowId},${idIndex.get(flow.id)},${idIndex.get(flow.from)},1,0,0,0,0,0,0,-1--1--1,,1|(0,0)|\n`;
    }
    if (flow.to) {
      arrowId += 1;
      out += `1,${arrowId},${idIndex.get(flow.id)},${idIndex.get(flow.to)},1,0,0,0,0,0,0,-1--1--1,,1|(0,0)|\n`;
    }
  }
  for (const c of model.connectors) {
    arrowId += 1;
    out += `1,${arrowId},${idIndex.get(c.from)},${idIndex.get(c.to)},0,0,0,0,0,64,0,-1--1--1,,1|(0,0)|\n`;
  }

  out += "///---\\\\\\\n";
  return out;
}

function shapeTypeFor(v: Variable): number {
  if (v.kind === "stock") return 3;
  if (v.kind === "flow") return 40;
  return 8;
}
