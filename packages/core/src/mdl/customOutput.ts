// Read and write the custom-output block Vensim stores in a .mdl after the sketch closer
// (`///---\\\`) and before its settings marker. The text is the same keyword language as a
// standalone .vgd file. Confirmed against Vensim's own sample models: every `:GRAPH` sits in
// that span, and the settings block always begins with the bytes `:L\x7f<%^E!@`.

import type { CustomGraph, CustomOutputItem, GraphScale, GraphVariable, LineStyle, Rgb } from "../model/graphs.js";
import { LINE_STYLES } from "../model/graphs.js";

/** Vensim appends this immediately after the custom-output text. Everything from here to EOF
 * is control-panel state (time base, loaded run, unit synonyms), not the graph definitions. */
export const VENSIM_SETTINGS_MARKER = ":L\u007f<%^E!@";

const TOP_LEVEL = new Set(["GRAPH", "TABLE", "REPORT", "BAR-GRAPH"]);

const KEYWORD_LINE = /^\s*:([A-Za-z0-9-]+)(?:[ \t=]+(.*))?$/;

export interface SplitCustomBlock {
  /** Sketch text up to and including the closer line. */
  sketch: string;
  items: CustomOutputItem[];
  /** From the settings marker through EOF, unchanged. Empty when the file has none. */
  fileTail: string;
}

/**
 * Split whatever follows the sketch marker into the sketch the diagram parser should see,
 * the custom graphs/reports, and the settings tail. A file with no closer leaves the sketch
 * untouched.
 */
export function splitCustomBlock(sketch: string): SplitCustomBlock {
  const closerAt = sketch.lastIndexOf("///---\\\\\\");
  if (closerAt === -1) return { sketch, items: [], fileTail: "" };
  const closerEnd = closerAt + "///---\\\\\\".length;
  const after = sketch.slice(closerEnd).replace(/^\r?\n/, "");
  const markerAt = after.indexOf(VENSIM_SETTINGS_MARKER);
  const customText = markerAt === -1 ? after : after.slice(0, markerAt);
  // The writer emits CRLF for the whole file, including this tail. Store it with `\n` so a
  // parse → write → parse does not see the line endings flip on the second read.
  const fileTail = (markerAt === -1 ? "" : after.slice(markerAt)).replace(/\r\n/g, "\n");
  return {
    sketch: sketch.slice(0, closerEnd),
    items: parseCustomOutput(customText),
    fileTail,
  };
}

export function parseCustomOutput(text: string): CustomOutputItem[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const items: CustomOutputItem[] = [];
  let graph: CustomGraph | null = null;
  let scale: GraphScale | null = null;
  let varGroup: GraphVariable[] = [];
  let raw: string[] | null = null;

  const finishGraph = () => {
    if (!graph) return;
    items.push({ kind: "graph", graph });
    graph = null;
    scale = null;
    varGroup = [];
  };
  const finishRaw = () => {
    if (!raw) return;
    const body = raw.join("\n").replace(/\s+$/, "");
    if (body) items.push({ kind: "raw", text: body });
    raw = null;
  };

  for (const line of lines) {
    const match = KEYWORD_LINE.exec(line);
    const keyword = match?.[1]?.toUpperCase();
    if (keyword && TOP_LEVEL.has(keyword)) {
      finishGraph();
      finishRaw();
      if (keyword === "GRAPH") {
        graph = emptyGraph((match?.[2] ?? "").trim() || "GRAPH");
        continue;
      }
      raw = [line.trimEnd()];
      continue;
    }
    if (raw) {
      raw.push(line.trimEnd());
      continue;
    }
    if (!graph || !match || !keyword) {
      // Blank lines and stray text between sections are separators, not content.
      continue;
    }
    const value = (match[2] ?? "").trim();
    if (keyword === "SCALE") {
      scale = { shared: true, variables: [] };
      graph.scales.push(scale);
      varGroup = [];
      continue;
    }
    if (keyword === "VAR") {
      if (!scale || !scale.shared) {
        scale = { shared: false, variables: [] };
        graph.scales.push(scale);
      }
      varGroup = parseVarList(value).map((v) => ({ ...v, extra: [] }));
      if (varGroup.length === 0) varGroup = [{ name: value || "?", extra: [] }];
      scale.variables.push(...varGroup);
      continue;
    }
    // :Y-MIN and :Y-MAX before the first :VAR are the graph's axis. After a :VAR they override
    // that variable. Every other graph keyword stays on the graph wherever it sits — Vensim
    // does not care about order inside a level.
    if ((keyword === "Y-MIN" || keyword === "Y-MAX") && varGroup.length > 0) {
      applyVariableKeyword(keyword, value, line.trimEnd(), varGroup);
      continue;
    }
    if (applyGraphKeyword(graph, keyword, value)) continue;
    if (applyVariableKeyword(keyword, value, line.trimEnd(), varGroup)) continue;
    if (varGroup.length > 0) {
      for (const v of varGroup) v.extra.push(line.trimEnd());
    } else {
      graph.extra.push(line.trimEnd());
    }
  }
  finishGraph();
  finishRaw();
  return items;
}

export function writeCustomOutput(items: CustomOutputItem[]): string {
  if (items.length === 0) return "";
  return `${items.map(writeItem).join("\n\n")}\n`;
}

function writeItem(item: CustomOutputItem): string {
  return item.kind === "raw" ? item.text.replace(/\s+$/, "") : writeGraph(item.graph);
}

function writeGraph(graph: CustomGraph): string {
  const lines: string[] = [`:GRAPH ${graph.name}`];
  const push = (keyword: string, value: string | number | undefined) => {
    if (value === undefined || value === "") return;
    lines.push(`:${keyword} ${value}`);
  };
  push("TITLE", graph.title);
  push("X-AXIS", graph.xAxis);
  push("X-LABEL", graph.xLabel);
  push("X-MIN", graph.xMin);
  push("X-MAX", graph.xMax);
  push("X-DIV", graph.xDiv);
  push("Y-MIN", graph.yMin);
  push("Y-MAX", graph.yMax);
  push("Y-DIV", graph.yDiv);
  push("Y-LABEL", graph.yLabel);
  if (graph.dots) lines.push(":DOTS");
  if (graph.cumulative) lines.push(":CUMULATIVE");
  push("STACK", graph.stack);
  if (graph.stackFill) lines.push(":STACK-FILL");
  if (graph.wip) lines.push(":WIP");
  push("NO-LEGEND", graph.noLegend);
  push("WIDTH", graph.width);
  push("HEIGHT", graph.height);
  for (const extra of graph.extra) lines.push(extra);
  for (const scale of graph.scales) {
    if (scale.shared) lines.push(":SCALE");
    // Variables that came from one `:VAR` line share every following keyword. Writing one
    // `:VAR` per variable is the same graph: Vensim reads hierarchy from the keywords, and a
    // keyword after `:VAR` applies to that variable.
    for (const variable of scale.variables) {
      const label = variable.label !== undefined ? `|${variable.label}` : "";
      lines.push(`:VAR ${quoteVarName(variable.name)}${label}`);
      if (variable.lineStyle) lines.push(`:LINE-STYLE ${variable.lineStyle}`);
      else if (variable.lineWidth !== undefined) lines.push(`:LINE-WIDTH ${variable.lineWidth}`);
      if (variable.lineColor) {
        const { r, g, b } = variable.lineColor;
        lines.push(`:LINE-COLOR ${r}-${g}-${b}`);
      }
      pushVar(lines, "Y-MIN", variable.yMin);
      pushVar(lines, "Y-MAX", variable.yMax);
      pushVar(lines, "UNITS", variable.units);
      pushVar(lines, "SHAPE", variable.shape);
      if (variable.dataset !== undefined) lines.push(variable.dataset === "" ? ":DATASET " : `:DATASET ${variable.dataset}`);
      for (const extra of variable.extra) lines.push(extra);
    }
  }
  return lines.join("\n");
}

function pushVar(lines: string[], keyword: string, value: string | number | undefined) {
  if (value === undefined || value === "") return;
  lines.push(`:${keyword} ${value}`);
}

function emptyGraph(name: string): CustomGraph {
  return { name, scales: [], extra: [] };
}

/** Graph-level keywords. Returns false when the keyword is not one of them. */
function applyGraphKeyword(graph: CustomGraph, keyword: string, value: string): boolean {
  switch (keyword) {
    case "TITLE":
      graph.title = value;
      return true;
    case "X-AXIS":
      graph.xAxis = value;
      return true;
    case "X-LABEL":
      graph.xLabel = value;
      return true;
    case "X-MIN":
      graph.xMin = numberOrUndefined(value);
      return true;
    case "X-MAX":
      graph.xMax = numberOrUndefined(value);
      return true;
    case "X-DIV":
      graph.xDiv = numberOrUndefined(value);
      return true;
    case "Y-MIN":
      graph.yMin = numberOrUndefined(value);
      return true;
    case "Y-MAX":
      graph.yMax = numberOrUndefined(value);
      return true;
    case "Y-DIV":
      graph.yDiv = numberOrUndefined(value);
      return true;
    case "Y-LABEL":
      graph.yLabel = value;
      return true;
    case "DOTS":
      graph.dots = true;
      return true;
    case "CUMULATIVE":
      graph.cumulative = true;
      return true;
    case "STACK":
      graph.stack = numberOrUndefined(value);
      return true;
    case "STACK-FILL":
      graph.stackFill = true;
      return true;
    case "WIP":
      graph.wip = true;
      return true;
    case "NO-LEGEND":
      graph.noLegend = numberOrUndefined(value);
      return true;
    case "WIDTH":
      graph.width = numberOrUndefined(value);
      return true;
    case "HEIGHT":
      graph.height = numberOrUndefined(value);
      return true;
    default:
      return false;
  }
}

/** Keywords that attach to the variable(s) opened by the latest `:VAR`. `:Y-MIN` / `:Y-MAX`
 * before any `:VAR` are graph-level and handled above; after a `:VAR` they override it. */
function applyVariableKeyword(keyword: string, value: string, rawLine: string, group: GraphVariable[]): boolean {
  if (group.length === 0) return false;
  const apply = (patch: (v: GraphVariable) => void) => {
    for (const v of group) patch(v);
  };
  switch (keyword) {
    case "LINE-STYLE": {
      const style = value.toUpperCase();
      if (!isLineStyle(style)) {
        apply((v) => v.extra.push(rawLine));
        return true;
      }
      apply((v) => {
        v.lineStyle = style;
      });
      return true;
    }
    case "LINE-WIDTH":
      apply((v) => {
        v.lineWidth = numberOrUndefined(value);
      });
      return true;
    case "LINE-COLOR":
      apply((v) => {
        const color = parseColor(value);
        if (color) v.lineColor = color;
        else v.extra.push(rawLine);
      });
      return true;
    case "Y-MIN":
      apply((v) => {
        v.yMin = numberOrUndefined(value);
      });
      return true;
    case "Y-MAX":
      apply((v) => {
        v.yMax = numberOrUndefined(value);
      });
      return true;
    case "UNITS":
      apply((v) => {
        v.units = value;
      });
      return true;
    case "SHAPE":
      apply((v) => {
        v.shape = value;
      });
      return true;
    case "DATASET":
    case "RUN":
      apply((v) => {
        v.dataset = value;
      });
      return true;
    default:
      return false;
  }
}

function isLineStyle(value: string): value is LineStyle {
  return (LINE_STYLES as readonly string[]).includes(value);
}

function parseColor(value: string): Rgb | undefined {
  const match = /^(\d{1,3})-(\d{1,3})-(\d{1,3})$/.exec(value.trim());
  if (!match) return undefined;
  const channels = [match[1], match[2], match[3]].map((n) => Number(n));
  if (channels.some((n) => n > 255)) return undefined;
  return { r: channels[0]!, g: channels[1]!, b: channels[2]! };
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** `:VAR name1|label1,name2|label2`. Commas inside quotes or parentheses stay in the name
 * (`:VAR "QUANTUM(x,1)"` is one variable). */
function parseVarList(value: string): { name: string; label?: string }[] {
  const items: { name: string; label?: string }[] = [];
  for (const piece of splitTopLevel(value)) {
    const bar = unquotedBar(piece);
    const namePart = (bar === -1 ? piece : piece.slice(0, bar)).trim();
    const labelPart = bar === -1 ? undefined : piece.slice(bar + 1).trim();
    const name = unquote(namePart);
    if (!name) continue;
    items.push(labelPart !== undefined && labelPart !== "" ? { name, label: labelPart } : { name });
  }
  return items;
}

function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  let depth = 0;
  for (const ch of value) {
    if (ch === '"') quote = !quote;
    else if (!quote && ch === "(") depth += 1;
    else if (!quote && ch === ")" && depth > 0) depth -= 1;
    if (ch === "," && !quote && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function unquotedBar(piece: string): number {
  let quote = false;
  for (let i = 0; i < piece.length; i++) {
    const ch = piece[i];
    if (ch === '"') quote = !quote;
    else if (ch === "|" && !quote) return i;
  }
  return -1;
}

function unquote(name: string): string {
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) return name.slice(1, -1);
  return name;
}

function quoteVarName(name: string): string {
  if (/[",]/.test(name)) return `"${name.replaceAll('"', '""')}"`;
  return name;
}
