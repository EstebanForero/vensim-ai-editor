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

// Vensim wraps a long equation across multiple lines by ending each wrapped line with a
// trailing `\` immediately before the newline (confirmed against xmutil's own MDLGenerator —
// see MDLGenerator.cpp's WarnIfLineTooLong — and observed directly in its output for this
// project's own bicycle-shop model). Joining these BEFORE tokenizing means a real multi-line
// equation parses as one expression instead of silently truncating at the first line (which
// both drops the rest of the equation's text AND, worse, can make an otherwise-valid equation
// fail to parse at all if the split lands mid-expression). Only applied to the equations
// section — the sketch section uses backslash in its own unrelated marker syntax
// (`\\\---///`), which this must never touch.
function joinLineContinuations(equationsText: string): string {
  return equationsText.replace(/\\\r?\n[ \t]*/g, " ");
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
  const records = parseRecords(joinLineContinuations(equations));

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

  // A flow that connects two real stocks appears in *both* stocks' net-flow expressions — as
  // "-Flow" (an outflow term) in its source stock, and "+Flow" (an inflow term) in its sink
  // stock. Collecting both sides here before calling addFlow even once is what makes that a
  // single flow with both ends set, instead of processing each stock's term independently and
  // creating the flow (with only one end) the first time, then — since its name is already
  // "claimed" — misreading the second stock's term as an unrelated inline expression and
  // materializing a bogus second anonymous flow for it.
  const flowSides = new Map<string, { from: string | null; to: string | null }>();
  const anonTerms: { stockName: string; sign: 1 | -1; expr: Expr }[] = [];

  for (const s of stockRecords) {
    const parsed = tryParseExpr(s.flowExpr, knownNames);
    const terms: FlatTerm[] = [];
    if (parsed) flattenAdditive(parsed, 1, terms);
    else if (s.flowExpr.trim()) {
      model.unsupportedRaw.push(`${s.name}: INTEG net-flow expression could not be parsed: ${s.flowExpr}`);
    }

    for (const term of terms) {
      if (term.expr.type === "var" && plainByName.has(term.expr.name)) {
        const sides = flowSides.get(term.expr.name) ?? { from: null, to: null };
        if (term.sign === -1) sides.from = s.name;
        else sides.to = s.name;
        flowSides.set(term.expr.name, sides);
      } else {
        // Inline expression term (not a bare reference to a known variable) — always unique to
        // this one stock (an inline expression can't also be some other stock's term), so it's
        // safe to materialize as an anonymous flow right away.
        anonTerms.push({ stockName: s.name, sign: term.sign, expr: term.expr });
      }
    }
  }

  for (const [flowName, sides] of flowSides) {
    const flowRec = plainByName.get(flowName)!;
    consumedAsFlow.add(flowName);
    addFlow(model, { name: flowRec.name, equation: flowRec.equation, units: flowRec.units, comment: flowRec.comment, from: sides.from, to: sides.to });
  }
  for (const { stockName, sign, expr } of anonTerms) {
    anonFlowCounter += 1;
    addFlow(model, {
      name: `${stockName} Flow ${anonFlowCounter}`,
      equation: exprToString(expr),
      from: sign === -1 ? stockName : null,
      to: sign === 1 ? stockName : null,
    });
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
      // Per Vensim's own published sketch-format reference: x,y is the shape's *center*
      // (not top-left, unlike this editor's own Position convention), and w,h are the
      // *half*-width/half-height — the full box is 2w x 2h. Both matter: treating w,h as full
      // dimensions (as this editor did before) computes the wrong top-left offset (half of what
      // it should be) AND stores a box half the size Vensim actually drew, compounding into a
      // visibly wrong, warped layout rather than a clean, uniform shift.
      const hasHalfSize = !Number.isNaN(w) && !Number.isNaN(h) && w > 0 && h > 0;
      const halfWidth = hasHalfSize ? w : variable.size.width / 2;
      const halfHeight = hasHalfSize ? h : variable.size.height / 2;
      variable.pos = { x: x - halfWidth, y: y - halfHeight };
      if (hasHalfSize) variable.size = { width: w * 2, height: h * 2 };
    }
  }

  // `11,` records are a flow's valve icon — a separate shape id from its `10,` name label, so
  // causal arrows Vensim draws *into the valve* (the normal way to show "this variable affects
  // this flow") can't be resolved to the flow's name without this pass.
  //
  // Primary match: Vensim's own sketch editor allocates a flow's valve id and its name-label
  // id consecutively (id, then id+1) at the moment the flow is drawn — confirmed against
  // example-compatibility/flow-diagram.mdl (valve 5 -> label 6, valve 10 -> label 11), and true
  // of this editor's own writer too (see writeSketch). This is exact, unlike proximity, so it's
  // tried first. Fallback: nearest not-yet-claimed flow by position, for sketches that don't
  // follow that convention (hand-edited files, or a different authoring tool) — this can
  // misfire in a dense diagram where several flows sit within the search radius of each other,
  // which the id-adjacency check above almost always avoids needing.
  const claimedFlowIds = new Set<string>();
  for (const line of lines) {
    if (!line.startsWith("11,")) continue;
    const fields = splitTopLevelCommas(line);
    const id = fields[1];
    const x = Number(fields[3]);
    const y = Number(fields[4]);
    if (!id || Number.isNaN(x) || Number.isNaN(y)) continue;

    const adjacentName = idToName.get(String(Number(id) + 1));
    const adjacentFlow = adjacentName ? model.flows.find((f) => f.name === adjacentName && !claimedFlowIds.has(f.id)) : undefined;
    if (adjacentFlow) {
      idToName.set(id, adjacentFlow.name);
      claimedFlowIds.add(adjacentFlow.id);
      continue;
    }

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
    // w,h here are half-width/half-height too — see the `10,` handling above.
    const hasHalfSize = !Number.isNaN(w) && !Number.isNaN(h) && w > 0 && h > 0;
    const halfWidth = hasHalfSize ? w : 80;
    const halfHeight = hasHalfSize ? h : 30;
    addComment(model, {
      text,
      pos: { x: (Number.isNaN(x) ? 0 : x) - halfWidth, y: (Number.isNaN(y) ? 0 : y) - halfHeight },
      size: hasHalfSize ? { width: w * 2, height: h * 2 } : undefined,
    });
  }
}
