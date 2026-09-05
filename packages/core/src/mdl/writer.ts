// Serializes a Model back to Vensim .mdl text.
//
// Produces a valid equations section (round-trips through parseMdl) plus a best-effort
// sketch section using Vensim's `10,` (variable box), `1,` (arrow), and `12,` (freestanding
// comment/annotation, not tied to any equation) sketch record shapes so the file opens with a
// laid-out diagram. This is not a byte-exact replica of Vensim's own writer (see project
// plan) — the goal is a file Vensim can open and simulate, and that this editor round-trips
// losslessly. The `12,` comment-record shape in particular is a best-effort reconstruction
// (Vensim's own "Comment" sketch tool produces this kind of freestanding text box) rather
// than a verified byte-exact match — if a real Vensim install renders it oddly, the fix is
// local to `commentRecord` below.

import { detectLoops, type Loop } from "../loops/index.js";
import { allVariables, findVariable, type Connector, type Model, type Position, type Variable } from "../model/types.js";

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

/** Deterministic +1/-1 from a string, used to alternate which side a relation's curve bends
 * toward so crossing arrows fan out instead of all bowing the same way. */
function hashSign(s: string): 1 | -1 {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h % 2 === 0 ? 1 : -1;
}

/** A midpoint offset perpendicular to the straight line from `from` to `to`, turning the
 * Vensim arrow's polyline into a visible curve (matching this editor's own bezier-curved
 * relation edges on the canvas) instead of a straight line running through other shapes. */
function curveWaypoint(from: Position, to: Position, seed: string): Position {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const bend = Math.min(60, len * 0.25) * hashSign(seed);
  return { x: mx + px * bend, y: my + py * bend };
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
    out += connectorArrowRecord(model, c, arrowId, idIndex);
  }

  let commentId = arrowId;
  for (const loop of detectLoops(model)) {
    commentId += 1;
    out += loopBadgeRecord(commentId, loop);
  }
  for (const comment of model.comments) {
    commentId += 1;
    out += commentRecord(commentId, comment.text, comment.pos, comment.size);
  }
  graphPadNames(model).forEach((name, slot) => {
    commentId += 1;
    out += graphPadRecord(commentId, name, model, slot);
  });

  out += "///---\\\\\\\n";
  return out;
}

/** Variables to draw a Vensim "graph pad" trend box for on export. Explicit `pinnedGraphs`
 * (round-tripped from a file that already had them) win; otherwise default to every stock —
 * the levels are what a human Vensim user overwhelmingly charts, and it's what real Vensim
 * exports of small models (see example-compatibility/) tend to carry. */
function graphPadNames(model: Model): string[] {
  return model.pinnedGraphs.length > 0 ? model.pinnedGraphs : model.stocks.map((s) => s.name);
}

function connectorArrowRecord(model: Model, c: Connector, arrowId: number, idIndex: Map<string, number>): string {
  const fromPos = findVariable(model, c.from)?.pos;
  const toPos = findVariable(model, c.to)?.pos;
  const bend = c.bend ?? (fromPos && toPos ? curveWaypoint(fromPos, toPos, c.id) : { x: 0, y: 0 });
  // Trailing field before the polarity is Vensim's own link-polarity code in real files
  // (unverified exact mapping here — see file header); the polarity sign is instead written
  // out explicitly as a `+`/`-` comment box below so it's visible regardless.
  return `1,${arrowId},${idIndex.get(c.from)},${idIndex.get(c.to)},0,0,0,0,0,64,0,-1--1--1,,1|(${Math.round(bend.x)},${Math.round(bend.y)})|\n`;
}

/** A Reinforcing/Balancing loop-polarity badge, in the same shape real Vensim itself writes
 * for a manually-placed loop indicator (a small circled "R"/"B" — see
 * example-compatibility/flow-diagram.mdl's `12,18,0,...`/`12,19,0,...` records): a plain
 * bare-letter text box, sized like Vensim's own (27x27), with its bold/framed style flags
 * (`4,7`) rather than a generic comment's. The on-canvas indicator (see LoopNode) additionally
 * shows a rotation glyph for direction, but that's a UI nicety, not exported — Vensim's own
 * loop badges just say "R" or "B". Shape code `0` (a plain text box, not a built-in icon like
 * the `48` cloud) is what makes Vensim render this as text at all instead of a random glyph. */
function loopBadgeRecord(id: number, loop: Loop): string {
  return `12,${id},0,${Math.round(loop.centroid.x)},${Math.round(loop.centroid.y)},27,27,4,7,0,0,-1,0,0,0,0,0,0,0,0,0\n${loop.polarity}\n`;
}

/** A freestanding text annotation (Vensim's own "Comment" sketch tool produces this — see
 * file header for the confidence caveat), not tied to any variable's equation, so it's safe
 * to place text here that doesn't correspond to a declared model variable. Shape code `0`
 * marks a plain text box — Vensim reserves nonzero codes (e.g. `48`) for built-in icons like
 * the flow-cloud glyph, which have no text line to read at all, so using one here would make
 * real Vensim render a cloud icon instead of this comment's text. */
function commentRecord(id: number, text: string, pos: Position, size?: { width: number; height: number }): string {
  const w = size?.width ?? Math.max(24, text.length * 8);
  const h = size?.height ?? 16;
  return `12,${id},0,${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(w)},${Math.round(h)},0,3,0,0,-1,0,0,0,3,0,0,0,0,0,0\n${text}\n`;
}

/** A Vensim "graph pad" — the trend-chart widget Vensim's sketch editor draws when a variable
 * is dropped onto the diagram as a chart, e.g. `Poblacion,Graph` in
 * example-compatibility/flow-diagram.mdl. Placed in a column to the right of the main diagram
 * so it doesn't overlap the causal graph; `slot` staggers multiple pads vertically. */
function graphPadRecord(id: number, variableName: string, model: Model, slot: number): string {
  const maxRight = Math.max(300, ...allVariables(model).map((v) => v.pos.x + v.size.width));
  const x = maxRight + 200;
  const y = 150 + slot * 260;
  return `12,${id},0,${Math.round(x)},${Math.round(y)},300,200,0,15,0,0,2,0,0,0,0,0,0,0,0,0\n${variableName},Graph\n`;
}

function shapeTypeFor(v: Variable): number {
  if (v.kind === "stock") return 3;
  if (v.kind === "flow") return 40;
  return 8;
}
