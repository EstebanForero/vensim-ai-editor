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
//
// A flow's valve<->name-label pairing (what makes Vensim treat them as one named Rate, rather
// than orphaning the label into a disconnected gray box on re-save) is not documented anywhere
// as an explicit field — Vensim's own docs only confirm attachment exists as a concept
// ("attachment determines where the variable attached to the valve is placed... below, above,
// left, right"), not how it's encoded in plain text. What's actually confirmed, empirically,
// against three independently real-Vensim-drawn flows (this editor's two example-compatibility
// reference files, plus a flow drawn fresh by hand in a live Vensim session specifically to
// test this): the label sits exactly 34px below the valve's center, and its box is 46x26 half-
// size (92x52 full — the same default size as a stock). Matching those two numbers exactly
// (rather than a formula that lands merely close) is what this editor now does; if a valve
// still gets orphaned on a real Vensim open+resave after this, the fix is local to the
// `valveCenter` calculation and the Flow builder's default size, both flagged below.

import { detectLoops, type Loop } from "../loops/index.js";
import { allVariables, findVariable, type Connector, type Flow, type Model, type Position, type Variable } from "../model/types.js";

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

  // Every real Vensim-saved .mdl this editor has as a reference (flow-diagram.mdl,
  // aitraining.mdl) uses CRLF line endings throughout, and so does Vensim's own xmutil
  // converter's output — this writer emitted plain LF. A positional/line-oriented reader that
  // scans specifically for "\r\n" (rather than treating "\n" alone as a line terminator) would
  // either fail to find a line boundary at all or leave a stray "\r" glued onto the last field
  // of every line, corrupting exactly the kind of trailing numeric fields this format leans on.
  return out.replace(/\n/g, "\r\n");
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

/** Vensim's `10,`/`11,`/`12,` sketch shapes are positioned by their *center*, not top-left —
 * unlike this editor's own Position convention (top-left, matching React Flow). Every emitted
 * shape must convert through this, or a real Vensim install draws it shifted by half its own
 * box size — a different amount per shape, since stocks/flows/auxiliaries default to different
 * sizes, which visibly warps the whole diagram's relative layout rather than just shifting it. */
function center(pos: Position, size: { width: number; height: number }): Position {
  return { x: pos.x + size.width / 2, y: pos.y + size.height / 2 };
}

/** Per Vensim's own published sketch-format reference, a shape's `w,h` fields are its
 * *half*-width/half-height, not the full box — the full box is 2w x 2h. Emitting our model's
 * full size directly (as this editor did before) drew every box at half its intended size in
 * real Vensim, on top of the separate center-vs-top-left position bug. Shapes whose `w,h`
 * literals are copied verbatim from example-compatibility/flow-diagram.mdl (the valve, cloud,
 * loop badge, and graph pad below) are already correct real-Vensim half-values and don't go
 * through this — only sizes computed from this editor's own (full-size) model data need it. */
function halfSize(size: { width: number; height: number }): { width: number; height: number } {
  return { width: size.width / 2, height: size.height / 2 };
}

/** The trailing fields every `10,`/`12,` (variable/comment) record carries after `sh,bits` —
 * confirmed identical across every such record in both example-compatibility files
 * (flow-diagram.mdl and aitraining.mdl), real Vensim exports from two different sessions. This
 * editor's own writer previously emitted only 6 trailing fields where Vensim always writes 12
 * — a genuinely truncated record, not just cosmetically different from Vensim's own, which is
 * exactly the kind of malformed line that can make a positional format misrender or misparse
 * everything after it. */
const VARIABLE_RECORD_TAIL = "0,0,-1,0,0,0,0,0,0,0,0,0";

function writeSketch(model: Model): string {
  const vars = allVariables(model);

  // Vensim pairs a flow's valve with its own name-label PURELY by uid adjacency — "Vensim draws
  // a flow as an attached valve immediately followed by the flow's own variable record, and
  // consumers resolve the pair by that adjacency alone" (confirmed straight from Vensim's own
  // xmutil converter source, src/Mdl/MDLGenerator.cpp's SuppressedSketchSlots comment: rule 2
  // treats `elements[valve_uid + 1]` as the paired flow, unconditionally). This editor's writer
  // previously assigned every variable (stocks, flows, auxiliaries) a single id up front in one
  // pass, THEN appended each flow's valve id afterward in a separate, later-starting counter —
  // so a flow's own label id and its valve's id were never actually consecutive integers. That
  // silently broke the one thing Vensim uses to recognize the pairing at all, which is the root
  // cause behind this exact writer's original valve/label "orphaning on resave" saga (see the
  // file header). Every id below is now assigned in ONE pass, in variable order, where a flow
  // consumes two CONSECUTIVE ids (valve, then its own label) instead of one id assigned far
  // apart from the other.
  const idIndex = new Map<string, number>();
  const valveIdByFlow = new Map<string, number>();
  let nextId = 0;
  for (const v of vars) {
    nextId += 1;
    if (v.kind === "flow") {
      valveIdByFlow.set(v.id, nextId);
      nextId += 1;
    }
    idIndex.set(v.id, nextId);
  }

  let out = "\\\\\\---/// Sketch information - do not modify anything except names\n";
  out += "V300  Do not put anything below this section - it will be ignored\n";
  out += "*View 1\n";
  out += "$192-192-192,0,Times New Roman|12||0-0-0|0-0-0|0-0-255|-1--1--1|-1--1--1|96,96,100,0\n";

  for (const v of vars) {
    if (v.kind === "flow") continue; // flows get a name label + separate valve icon below
    const shapeType = shapeTypeFor(v);
    const c = center(v.pos, v.size);
    const half = halfSize(v.size);
    out += `10,${idIndex.get(v.id)},${v.name},${Math.round(c.x)},${Math.round(c.y)},${Math.round(half.width)},${Math.round(half.height)},${shapeType},3,${VARIABLE_RECORD_TAIL}\n`;
  }

  for (const flow of model.flows) {
    const valveId = valveIdByFlow.get(flow.id)!;
    const labelCenter = center(flow.pos, flow.size);
    // Vensim draws a flow as a small valve icon with its name label just below it — matching
    // that gap (rather than stacking them exactly on top of each other) is also what lets this
    // editor's own parser re-associate a causal arrow drawn into the valve back to this flow's
    // name on the next import (nearest-valve-to-flow matching, see applySketch).
    // 34px is not an approximation — it's the exact vertical gap Vensim's own "Insert Rate"
    // tool places between a valve and its name label (confirmed identical across three
    // independent real-Vensim-drawn flows: example-compatibility/flow-diagram.mdl,
    // aitraining.mdl, and appgenfix.mdl's freshly hand-drawn conn1/conn2/conn3). This editor
    // previously computed the gap from the flow's own box height instead, landing at 35px for
    // its old default size — visually indistinguishable, but see the file header's
    // compatibility notes on why Vensim only recognizes a valve and its label as one named Rate
    // in the exact configuration its own tool produces, not merely a visually-close one.
    const valveCenter = { x: labelCenter.x, y: labelCenter.y - 34 };
    out += `11,${valveId},0,${Math.round(valveCenter.x)},${Math.round(valveCenter.y)},6,8,34,3,0,0,1,0,0,0,0,0,0,0,0,0\n`;
    const flowHalf = halfSize(flow.size);
    out += `10,${idIndex.get(flow.id)},${flow.name},${Math.round(labelCenter.x)},${Math.round(labelCenter.y)},${Math.round(flowHalf.width)},${Math.round(flowHalf.height)},40,3,${VARIABLE_RECORD_TAIL}\n`;

    // The "source" side (where material is drawn from — a cloud for an inflow, the upstream
    // stock for an outflow) and the "sink" side (where it goes — the downstream stock for an
    // inflow, a cloud for an outflow) get different arrow-style codes (100 vs 4) in real Vensim
    // exports (see example-compatibility/flow-diagram.mdl) — seemingly which end shows an
    // arrowhead, since flow pipes only draw one. Both are just "the pipe", not causal relations
    // — see isFlowPipeArrow in the parser for how a re-import tells the two apart.
    const sides: { stockId: string | null; styleCode: 100 | 4 }[] = [
      { stockId: flow.from, styleCode: 100 },
      { stockId: flow.to, styleCode: 4 },
    ];
    for (const side of sides) {
      let endpointCenter: Position;
      let endpointIdx: number;
      if (side.stockId) {
        const stock = findVariable(model, side.stockId);
        if (!stock) continue;
        endpointCenter = center(stock.pos, stock.size);
        endpointIdx = idIndex.get(stock.id)!;
      } else {
        nextId += 1;
        const cloudId = nextId;
        endpointCenter = cloudPosition(model, flow, valveCenter, side.styleCode === 100);
        out += `12,${cloudId},48,${Math.round(endpointCenter.x)},${Math.round(endpointCenter.y)},10,8,0,3,0,0,-1,0,0,0,0,0,0,0,0,0\n`;
        endpointIdx = cloudId;
      }
      nextId += 1;
      const mid = { x: (valveCenter.x + endpointCenter.x) / 2, y: (valveCenter.y + endpointCenter.y) / 2 };
      out += `1,${nextId},${valveId},${endpointIdx},${side.styleCode},0,0,22,0,192,0,-1--1--1,,1|(${Math.round(mid.x)},${Math.round(mid.y)})|\n`;
    }
  }

  let arrowId = nextId;
  for (const c of model.connectors) {
    arrowId += 1;
    out += connectorArrowRecord(model, c, arrowId, idIndex, valveIdByFlow);
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

/** Where to draw a flow's cloud endpoint (a source/sink that isn't a real stock) — placed
 * further out along the line away from whichever stock is on the flow's *other* end, so the
 * pipe reads as a straight run through valve then out to the cloud rather than doubling back
 * across the diagram. With no stock on either end at all (a cloud-to-cloud flow), falls back to
 * a fixed offset to the source/sink side respectively. */
function cloudPosition(model: Model, flow: Flow, valveCenter: Position, isSourceSide: boolean): Position {
  const otherStockId = isSourceSide ? flow.to : flow.from;
  const otherStock = otherStockId ? findVariable(model, otherStockId) : undefined;
  if (otherStock) {
    const otherCenter = center(otherStock.pos, otherStock.size);
    const dx = valveCenter.x - otherCenter.x;
    const dy = valveCenter.y - otherCenter.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: valveCenter.x + (dx / len) * 100, y: valveCenter.y + (dy / len) * 100 };
  }
  return { x: valveCenter.x + (isSourceSide ? -100 : 100), y: valveCenter.y };
}

/** Variables to draw a Vensim "graph pad" trend box for on export — only ever `pinnedGraphs`
 * round-tripped from a file that already had them. Earlier this defaulted to one per stock
 * when a model had none, which just clutters a diagram built or edited in this app with empty
 * chart placeholders it never asked for (there's no run data behind them until Vensim
 * simulates). A human Vensim user adds these deliberately; this editor should only ever
 * preserve ones that were already there, never invent new ones. */
function graphPadNames(model: Model): string[] {
  return model.pinnedGraphs;
}

function connectorArrowRecord(
  model: Model,
  c: Connector,
  arrowId: number,
  idIndex: Map<string, number>,
  valveIdByFlow: Map<string, number>,
): string {
  const fromVar = findVariable(model, c.from);
  const toVar = findVariable(model, c.to);
  const fromCenter = fromVar && center(fromVar.pos, fromVar.size);
  const toCenter = toVar && center(toVar.pos, toVar.size);
  const bend = c.bend ?? (fromCenter && toCenter ? curveWaypoint(fromCenter, toCenter, c.id) : { x: 0, y: 0 });
  // Field codes (shape=1, thick=0, ..., dtype=192) match a real causal/info-link arrow (see
  // example-compatibility/flow-diagram.mdl's `1,12,1,5,1,0,43,0,0,192,...` records). The "43"
  // there is specifically the `pol` field — per Vensim's own sketch-format reference, this is
  // the *ASCII code* of the polarity character drawn on the arrow (43 = '+', 45 = '-'), not a
  // generic style flag, so it must actually track this connector's polarity rather than always
  // showing '+' regardless of what the connector's polarity really is.
  const pol = c.polarity === "-" ? 45 : 43;
  // A relation into/out of a Flow must target that flow's *valve* shape id, not its name-label
  // — confirmed against every real-Vensim causal arrow into a flow across both reference files
  // (e.g. flow-diagram.mdl's `1,12,1,5,...` targets the valve id 5, never the label id 6).
  // Pointing at the label instead (this editor's earlier behavior) still referenced a real
  // shape, but not the one Vensim itself always uses, and cost this relation when a user tried
  // to edit it in a real Vensim session (see the writer.ts file header's compatibility notes).
  const fromId = (fromVar?.kind === "flow" ? valveIdByFlow.get(fromVar.id) : undefined) ?? idIndex.get(c.from);
  const toId = (toVar?.kind === "flow" ? valveIdByFlow.get(toVar.id) : undefined) ?? idIndex.get(c.to);
  return `1,${arrowId},${fromId},${toId},1,0,${pol},0,0,192,0,-1--1--1,,1|(${Math.round(bend.x)},${Math.round(bend.y)})|\n`;
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
  return `12,${id},0,${Math.round(loop.centroid.x)},${Math.round(loop.centroid.y)},27,27,4,7,0,0,-1,0,0,0,0,0,0,0,0,0\n${loop.polarity}${loop.number}\n`;
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
  const c = center(pos, { width: w, height: h });
  const half = halfSize({ width: w, height: h });
  return `12,${id},0,${Math.round(c.x)},${Math.round(c.y)},${Math.round(half.width)},${Math.round(half.height)},0,3,${VARIABLE_RECORD_TAIL}\n${text}\n`;
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
