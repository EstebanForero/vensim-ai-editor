// Parses Vensim .mdl text (native text format) into a Model.
//
// Scope (see project plan): full arithmetic/INTEG equation section, control variables
// (FINAL TIME / INITIAL TIME / TIME STEP / SAVEPER), and a best-effort read of the sketch
// section's `10,` (variable box) records for x/y layout and `1,` (arrow) records for causal
// connectors. Subscripts, macros, lookups, and DELAY/SMOOTH-family builtins are not modeled;
// their raw equation text is preserved in `unsupportedRaw` rather than dropped or crashed on.

import { addAuxiliary, addComment, addConnector, addFlow, addStock } from "../model/builder/index.js";
import { createEmptyModel, findVariableByName, type Model } from "../model/types.js";
import { exprToString, tryParseExpr, type Expr } from "./expr/index.js";
import { splitTopLevelCommas } from "./util.js";

const SKETCH_MARKER = /\\\\\\---\/\/\/\s*Sketch information/i;
const CONTROL_NAMES = new Set(["FINAL TIME", "INITIAL TIME", "TIME STEP", "SAVEPER"]);

interface RawRecord {
  name: string;
  equation: string;
  units: string;
  comment: string;
}

function stripHeader(text: string): string {
  return text.replace(/^﻿/, "").replace(/^\{UTF-8\}\s*/i, "");
}

function splitSections(text: string): { equations: string; sketch: string } {
  const match = SKETCH_MARKER.exec(text);
  if (!match) return { equations: text, sketch: "" };
  return { equations: text.slice(0, match.index), sketch: text.slice(match.index) };
}

function parseRecords(equationsText: string): RawRecord[] {
  const records: RawRecord[] = [];
  // Records are pipe-terminated. Split on '|' at top level (equations here never contain
  // literal '|' in this v1 subset).
  const chunks = equationsText.split("|");
  for (const rawChunk of chunks) {
    const chunk = rawChunk.trim();
    if (!chunk) continue;
    if (chunk.startsWith("*")) continue; // section/group header, e.g. ********\n.Control\n********
    const parts = chunk.split("~");
    const lhs = (parts[0] ?? "").trim();
    if (!lhs || lhs.startsWith("*")) continue;
    const eqIdx = lhs.indexOf("=");
    if (eqIdx === -1) continue; // not a variable definition (e.g. stray control text)
    const name = lhs.slice(0, eqIdx).trim();
    const equation = lhs.slice(eqIdx + 1).trim();
    const units = (parts[1] ?? "").trim();
    const comment = (parts[2] ?? "").trim();
    records.push({ name, equation, units, comment });
  }
  return records;
}

interface FlatTerm {
  sign: 1 | -1;
  expr: Expr;
}

function flattenAdditive(e: Expr, sign: 1 | -1, out: FlatTerm[]): void {
  if (e.type === "binary" && (e.op === "+" || e.op === "-")) {
    flattenAdditive(e.left, sign, out);
    flattenAdditive(e.right, e.op === "-" ? (sign === 1 ? -1 : 1) : sign, out);
    return;
  }
  if (e.type === "unary" && e.op === "-") {
    flattenAdditive(e.arg, sign === 1 ? -1 : 1, out);
    return;
  }
  if (e.type === "unary" && e.op === "+") {
    flattenAdditive(e.arg, sign, out);
    return;
  }
  out.push({ sign, expr: e });
}

function parseIntegCall(equation: string): { flowExpr: string; initial: string } | null {
  const m = /^INTEG\s*\(([\s\S]*)\)\s*$/i.exec(equation.trim());
  if (!m) return null;
  const args = splitTopLevelCommas(m[1]!);
  if (args.length < 2) return null;
  return { flowExpr: args[0]!, initial: args.slice(1).join(",") };
}

export function parseMdl(text: string): Model {
  const model = createEmptyModel();
  const { equations, sketch } = splitSections(stripHeader(text));
  const records = parseRecords(equations);

  const stockRecords: { name: string; flowExpr: string; initial: string; units: string; comment: string }[] = [];
  const plainRecords: RawRecord[] = [];

  for (const r of records) {
    if (CONTROL_NAMES.has(r.name.toUpperCase())) {
      applyControl(model, r.name.toUpperCase(), r.equation);
      continue;
    }
    const integ = parseIntegCall(r.equation);
    if (integ) {
      stockRecords.push({ name: r.name, ...integ, units: r.units, comment: r.comment });
    } else {
      plainRecords.push(r);
    }
  }

  // First pass: create the stocks themselves so flow terms can be resolved against them.
  for (const s of stockRecords) {
    addStock(model, { name: s.name, initialEquation: s.initial || "0", units: s.units, comment: s.comment });
  }

  const plainByName = new Map(plainRecords.map((r) => [r.name, r]));
  const consumedAsFlow = new Set<string>();
  let anonFlowCounter = 0;
  const knownNames = [...stockRecords.map((s) => s.name), ...plainRecords.map((r) => r.name)];

  for (const s of stockRecords) {
    const parsed = tryParseExpr(s.flowExpr, knownNames);
    const terms: FlatTerm[] = [];
    if (parsed) flattenAdditive(parsed, 1, terms);
    else if (s.flowExpr.trim()) {
      model.unsupportedRaw.push(`${s.name}: INTEG net-flow expression could not be parsed: ${s.flowExpr}`);
    }

    for (const term of terms) {
      if (term.expr.type === "var" && plainByName.has(term.expr.name) && !consumedAsFlow.has(term.expr.name)) {
        const flowRec = plainByName.get(term.expr.name)!;
        consumedAsFlow.add(term.expr.name);
        addFlow(model, {
          name: flowRec.name,
          equation: flowRec.equation,
          units: flowRec.units,
          comment: flowRec.comment,
          from: term.sign === -1 ? s.name : null,
          to: term.sign === 1 ? s.name : null,
        });
      } else {
        // Inline expression term (not a bare reference to a known variable) — materialize as
        // an anonymous flow so the stock's derivative still evaluates correctly.
        anonFlowCounter += 1;
        addFlow(model, {
          name: `${s.name} Flow ${anonFlowCounter}`,
          equation: exprToString(term.expr),
          from: term.sign === -1 ? s.name : null,
          to: term.sign === 1 ? s.name : null,
        });
      }
    }
  }

  for (const r of plainRecords) {
    if (consumedAsFlow.has(r.name)) continue;
    addAuxiliary(model, {
      name: r.name,
      equation: r.equation,
      units: r.units,
      comment: r.comment,
    });
  }

  applySketch(model, sketch);
  return model;
}

function applyControl(model: Model, name: string, equation: string): void {
  const num = Number(equation.trim());
  switch (name) {
    case "FINAL TIME":
      if (!Number.isNaN(num)) model.simSpec.stopTime = num;
      break;
    case "INITIAL TIME":
      if (!Number.isNaN(num)) model.simSpec.startTime = num;
      break;
    case "TIME STEP":
      if (!Number.isNaN(num)) model.simSpec.dt = num;
      break;
    case "SAVEPER":
      break; // driven by dt in this editor
  }
}

/** True if this arrow is just the flow-pipe segment from a flow's valve out to the stock/cloud
 * it's geometrically attached to (i.e. it's pipe geometry, not a causal-relation arrow) —
 * comparing against the equation-derived from/to a flow already has is more robust than trying
 * to reverse-engineer Vensim's line-style codes for "this is a heavy flow pipe, not a thin info
 * arrow", which aren't confirmed byte-exact here (see file header).
 *
 * Direction matters: Vensim always draws the pipe *from* the valve outward, to whichever of
 * the flow's stock/cloud ends it's attached to, regardless of whether that end is the flow's
 * inflow or outflow side — so both are checked. But a genuine causal arrow *into* that same
 * valve (e.g. the stock's own level affecting its outflow rate) runs the opposite direction
 * between the very same two shapes, so only `fromName` being the flow counts as pipe geometry;
 * the reverse direction is always a real causal link, never pipe geometry. */
function isFlowPipeArrow(model: Model, fromName: string, toName: string): boolean {
  const fromVar = findVariableByName(model, fromName);
  const toVar = findVariableByName(model, toName);
  if (fromVar?.kind !== "flow" || !toVar) return false;
  return fromVar.from === toVar.id || fromVar.to === toVar.id;
}

/** R/B loop-polarity badges this editor itself writes (see `loopLabel` in writer.ts) are
 * regenerated live by auto-detection on every load — re-importing them as plain Comments would
 * duplicate them (once as a real Comment, once again from detection) and they'd go stale the
 * moment the model changes. Recognize and skip them on import; anything else freeform is a
 * genuine user Comment (or came from real Vensim, which has no equivalent auto-generated text
 * to worry about colliding with). */
function isAutoLoopBadge(text: string): boolean {
  return /^[RB]( [↻↺])?$/.test(text.trim());
}

function applySketch(model: Model, sketch: string): void {
  if (!sketch) return;
  const idToName = new Map<string, string>();
  const lines = sketch.split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith("10,")) continue;
    const fields = splitTopLevelCommas(line);
    // 10,<id>,<name>,<x>,<y>,<width>,<height>,...
    const id = fields[1];
    const name = fields[2];
    const x = Number(fields[3]);
    const y = Number(fields[4]);
    const w = Number(fields[5]);
    const h = Number(fields[6]);
    if (!id || !name) continue;
    idToName.set(id, name);
    const variable = findVariableByName(model, name);
    if (variable && !Number.isNaN(x) && !Number.isNaN(y)) {
      const hasSize = !Number.isNaN(w) && !Number.isNaN(h) && w > 0 && h > 0;
      const size = hasSize ? { width: w, height: h } : variable.size;
      // Vensim's sketch shapes are positioned by their *center*, not top-left, unlike this
      // editor's own Position convention (top-left, matching React Flow) — converting here is
      // what keeps an opened real-Vensim diagram's relative layout intact instead of every
      // shape drifting by half its own box size (a different amount per shape, since stocks/
      // flows/auxiliaries default to different sizes, which is why a skipped conversion here
      // visibly warps the whole diagram rather than just shifting it uniformly).
      variable.pos = { x: x - size.width / 2, y: y - size.height / 2 };
      if (hasSize) variable.size = size;
    }
  }

  // `11,` records are a flow's valve icon — a separate shape id from its `10,` name label, so
  // causal arrows Vensim draws *into the valve* (the normal way to show "this variable affects
  // this flow") can't be resolved to the flow's name without this pass. Vensim places the name
  // label right next to its valve, so match each valve to its nearest not-yet-claimed flow.
  const claimedFlowIds = new Set<string>();
  for (const line of lines) {
    if (!line.startsWith("11,")) continue;
    const fields = splitTopLevelCommas(line);
    const id = fields[1];
    const x = Number(fields[3]);
    const y = Number(fields[4]);
    if (!id || Number.isNaN(x) || Number.isNaN(y)) continue;
    let nearest: { id: string; name: string; dist: number } | null = null;
    for (const flow of model.flows) {
      if (claimedFlowIds.has(flow.id)) continue;
      // flow.pos is top-left (already converted above); compare in the same center-based space
      // the valve's own x,y are given in.
      const flowCenterX = flow.pos.x + flow.size.width / 2;
      const flowCenterY = flow.pos.y + flow.size.height / 2;
      const dist = Math.hypot(flowCenterX - x, flowCenterY - y);
      if (!nearest || dist < nearest.dist) nearest = { id: flow.id, name: flow.name, dist };
    }
    if (nearest && nearest.dist < 200) {
      idToName.set(id, nearest.name);
      claimedFlowIds.add(nearest.id);
    }
  }

  for (const line of lines) {
    if (!line.startsWith("1,")) continue;
    const fields = splitTopLevelCommas(line);
    // 1,<id>,<fromShapeId>,<toShapeId>,...
    const fromId = fields[2];
    const toId = fields[3];
    if (!fromId || !toId) continue;
    const fromName = idToName.get(fromId);
    const toName = idToName.get(toId);
    if (!fromName || !toName) continue;
    if (isFlowPipeArrow(model, fromName, toName)) continue;
    try {
      addConnector(model, { from: fromName, to: toName });
    } catch {
      // Best-effort: sketch arrows that don't correspond to two known variables (e.g. dangling
      // geometry) are silently skipped.
    }
  }

  // `12,<id>,<shapeCode>,x,y,w,h,...` is a freestanding text box when shapeCode is 0, followed
  // by its literal text on the next line; a nonzero shapeCode (e.g. 48 = cloud) is a built-in
  // icon with no text line to read, so it's left alone (it's redrawn implicitly wherever this
  // editor renders a flow's cloud endpoint).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("12,")) continue;
    const fields = splitTopLevelCommas(line);
    const shapeCode = fields[2];
    const x = Number(fields[3]);
    const y = Number(fields[4]);
    const w = Number(fields[5]);
    const h = Number(fields[6]);
    if (shapeCode !== "0") continue;
    const text = lines[i + 1]?.trim();
    if (!text || isAutoLoopBadge(text)) continue;
    const graphMatch = /^(.+),Graph$/.exec(text);
    if (graphMatch && findVariableByName(model, graphMatch[1]!)) {
      model.pinnedGraphs.push(graphMatch[1]!);
      continue;
    }
    const hasSize = !Number.isNaN(w) && !Number.isNaN(h) && w > 0 && h > 0;
    const size = hasSize ? { width: w, height: h } : { width: 160, height: 60 };
    addComment(model, {
      text,
      // Same center -> top-left conversion as `10,`/`11,` shapes above.
      pos: { x: (Number.isNaN(x) ? 0 : x) - size.width / 2, y: (Number.isNaN(y) ? 0 : y) - size.height / 2 },
      size: hasSize ? size : undefined,
    });
  }
}
