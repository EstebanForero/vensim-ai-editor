// Vensim custom graphs, as stored in a model (or a standalone .vgd file).
//
// The text format is the Graph tool keyword language: one `:GRAPH` and at least one `:VAR`,
// with `:SCALE` grouping the following variables onto one y-axis. Line appearance is either a
// width or one of DOT, DASH, DASHDOT, DASHDOTDOT — Vensim rejects a line that sets both.
// See https://vensim.com/documentation/24000.html.

import { ModelError } from "./errors.js";
import type { Model } from "./types.js";

/** Vensim's `:LINE-STYLE` values. A solid line is the absence of a style, not a fifth keyword. */
export const LINE_STYLES = ["DOT", "DASH", "DASHDOT", "DASHDOTDOT"] as const;
export type LineStyle = (typeof LINE_STYLES)[number];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** One plotted variable. Several of these under one scale share a y-axis. */
export interface GraphVariable {
  /** Name as Vensim writes it, including a subscript such as `wrk_speed[ASSY]`. */
  name: string;
  /** Text after `|`. The chart uses the name when this is absent. */
  label?: string;
  lineStyle?: LineStyle;
  /** Ignored when `lineStyle` is set: Vensim draws a styled line at width 1. */
  lineWidth?: number;
  /** `:LINE-COLOR r-g-b`, each channel 0–255. Absent means the viewer's standard colors. */
  lineColor?: Rgb;
  yMin?: number;
  yMax?: number;
  units?: string;
  /** Raw `:SHAPE` value, only meaningful with the graph's `:DOTS`. Example: `CIRCLE,3`. */
  shape?: string;
  /** Raw `:DATASET` / `:RUN` value. Empty string means the keyword was present with no name.
   * This editor simulates one run, so the field is kept for the file and not interpreted. */
  dataset?: string;
  /** Keyword lines on this variable that this editor does not draw, kept so a round-trip
   * does not drop them (`:CONFIDENCE`, `:SENS-LINES`, …). Each entry is the full line. */
  extra: string[];
}

/** Variables drawn on one y-axis. `shared` is Vensim's `:SCALE` — without it, each variable
 * would be its own scale. */
export interface GraphScale {
  shared: boolean;
  variables: GraphVariable[];
}

export interface CustomGraph {
  name: string;
  title?: string;
  /** Blank means the current time base (Time). Any other name is an X-Y plot against that variable. */
  xAxis?: string;
  xLabel?: string;
  xMin?: number;
  xMax?: number;
  xDiv?: number;
  yMin?: number;
  yMax?: number;
  yDiv?: number;
  yLabel?: string;
  /** `:DOTS` — plot points, do not connect them. */
  dots?: boolean;
  cumulative?: boolean;
  stack?: number;
  stackFill?: boolean;
  wip?: boolean;
  /** `:NO-LEGEND n`. Any number suppresses the legend; the number is Vensim's, kept as written. */
  noLegend?: number;
  width?: number;
  height?: number;
  scales: GraphScale[];
  /** Graph-level keyword lines this editor does not draw (`:SOFT-BOUNDS`, `:LANDSCAPE`, …). */
  extra: string[];
}

/** A custom-output section that is not a graph (a `:REPORT`, `:TABLE`, or `:BAR-GRAPH`).
 * Kept verbatim so saving the model does not strip output this editor does not edit. */
export interface RawCustomSection {
  kind: "raw";
  text: string;
}

export interface GraphCustomSection {
  kind: "graph";
  graph: CustomGraph;
}

export type CustomOutputItem = GraphCustomSection | RawCustomSection;

export function customGraphs(model: Model): CustomGraph[] {
  return model.customOutput.filter((item): item is GraphCustomSection => item.kind === "graph").map((item) => item.graph);
}

export function findCustomGraph(model: Model, name: string): CustomGraph | undefined {
  const lower = name.toLowerCase();
  return customGraphs(model).find((g) => g.name.toLowerCase() === lower);
}

function cleanVar(v: GraphVariable): GraphVariable {
  if (v.lineStyle && v.lineWidth !== undefined) {
    throw new ModelError(
      `Vensim cannot combine a line style (${v.lineStyle}) with a line width on "${v.name}". Use one or the other.`,
    );
  }
  return {
    ...v,
    extra: v.extra ?? [],
  };
}

/** Insert or replace a custom graph by name (case-insensitive). A graph needs a name and at
 * least one variable, which is Vensim's own minimum for a complete definition. */
export function setCustomGraph(model: Model, graph: CustomGraph): CustomGraph {
  const name = graph.name.trim();
  if (!name) throw new ModelError("A custom graph needs a name.");
  const scales = graph.scales.map((scale) => ({
    shared: scale.shared,
    variables: scale.variables.map(cleanVar),
  }));
  if (scales.every((s) => s.variables.length === 0)) {
    throw new ModelError(`Custom graph "${name}" needs at least one variable (:VAR).`);
  }
  const stored: CustomGraph = { ...graph, name, scales, extra: graph.extra ?? [] };
  const lower = name.toLowerCase();
  const index = model.customOutput.findIndex((item) => item.kind === "graph" && item.graph.name.toLowerCase() === lower);
  if (index === -1) model.customOutput.push({ kind: "graph", graph: stored });
  else model.customOutput[index] = { kind: "graph", graph: stored };
  return stored;
}

export function deleteCustomGraph(model: Model, name: string): void {
  const lower = name.toLowerCase();
  const index = model.customOutput.findIndex((item) => item.kind === "graph" && item.graph.name.toLowerCase() === lower);
  if (index === -1) throw new ModelError(`No custom graph named "${name}".`);
  model.customOutput.splice(index, 1);
}
