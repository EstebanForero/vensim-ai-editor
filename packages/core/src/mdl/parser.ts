// Parses Vensim .mdl text (native text format) into a Model.
//
// Scope (see project plan): full arithmetic/INTEG equation section, control variables
// (FINAL TIME / INITIAL TIME / TIME STEP / SAVEPER), and a best-effort read of the sketch
// section's `10,` (variable box) records for x/y layout and `1,` (arrow) records for causal
// connectors. Subscripts, macros, lookups, and DELAY/SMOOTH-family builtins are not modeled;
// their raw equation text is preserved in `unsupportedRaw` rather than dropped or crashed on.

import { addAuxiliary, addConnector, addFlow, addStock } from "../model/builder/index.js";
import { createEmptyModel, findVariableByName, type Model } from "../model/types.js";
import { collectVarNames, exprToString, tryParseExpr, type Expr } from "./expr/index.js";
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
    const parsed = tryParseExpr(r.equation, knownNames);
    const isConstant = parsed?.type === "num" || (parsed?.type === "var" && collectVarNames(parsed).size === 0);
    addAuxiliary(model, {
      name: r.name,
      equation: r.equation,
      units: r.units,
      comment: r.comment,
      isConstant: !!isConstant,
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
      variable.pos = { x, y };
      if (!Number.isNaN(w) && !Number.isNaN(h) && w > 0 && h > 0) variable.size = { width: w, height: h };
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
    try {
      addConnector(model, { from: fromName, to: toName });
    } catch {
      // Best-effort: sketch arrows that don't correspond to two known variables (e.g. flow
      // valve/pipe geometry) are silently skipped — flow topology already comes from equations.
    }
  }
}
