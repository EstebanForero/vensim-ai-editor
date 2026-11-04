import {
  addAuxiliary,
  addComment,
  addConnector,
  addConstant,
  addFlow,
  addLookup,
  addStock,
  allVariables,
  annotateLoops,
  autoLayout,
  checkUnits,
  clearModel,
  deleteElement,
  detectLoops,
  findVariable,
  findVariableByName,
  isConstantAuxiliary,
  lookupTableOf,
  ModelError,
  moveComment,
  moveElement,
  refreshInferredPolarities,
  renameVariable,
  setCommentText,
  setConnectorPolarity,
  setEquation,
  setLookupPoints,
  setSimSpec,
  customGraphs,
  deleteCustomGraph,
  setCustomGraph,
  simulate,
  type CustomGraph,
  type GraphVariable,
  type IntegrationMethod,
  type LineStyle,
  type Model,
  type Polarity,
} from "@vensim-ai/core";

export interface ToolExecutionResult {
  ok: boolean;
  /** JSON-serializable payload described back to the model as the tool_result content. */
  result?: unknown;
  error?: string;
}

function resolveVar(model: Model, idOrName: string) {
  return findVariable(model, idOrName) ?? findVariableByName(model, idOrName);
}

function summarizeModel(model: Model) {
  return {
    name: model.name,
    simSpec: model.simSpec,
    stocks: model.stocks.map((s) => ({ id: s.id, name: s.name, initialEquation: s.initialEquation, units: s.units, inflows: s.inflows, outflows: s.outflows })),
    flows: model.flows.map((f) => ({ id: f.id, name: f.name, equation: f.equation, units: f.units, from: f.from, to: f.to })),
    auxiliaries: model.auxiliaries.map((a) => ({
      id: a.id,
      name: a.name,
      equation: a.equation,
      isConstant: isConstantAuxiliary(a, model),
      units: a.units,
      // A lookup's equation text is the raw tuple list, which is readable but not convenient to
      // reason about numerically — the parsed curve is included alongside it for that.
      ...(lookupTableOf(a, model) ? { lookup: lookupTableOf(a, model) } : {}),
    })),
    relations: model.connectors.map((c) => ({ id: c.id, from: c.from, to: c.to, polarity: c.polarity })),
    comments: model.comments.map((c) => ({ id: c.id, text: c.text })),
    customGraphs: customGraphs(model).map((g) => ({
      name: g.name,
      title: g.title,
      xAxis: g.xAxis ?? "",
      yMin: g.yMin,
      yMax: g.yMax,
      dots: g.dots === true,
      scales: g.scales.map((scale) =>
        scale.variables.map((v) => ({
          name: v.name,
          label: v.label,
          lineStyle: v.lineStyle ?? "SOLID",
          lineWidth: v.lineWidth,
          color: v.lineColor ? `${v.lineColor.r}-${v.lineColor.g}-${v.lineColor.b}` : undefined,
        })),
      ),
    })),
  };
}

function namesForLoop(model: Model, nodeIds: string[]): string[] {
  return nodeIds.map((id) => findVariable(model, id)?.name ?? id);
}

function downsample(arr: number[], maxPoints: number): number[] {
  if (arr.length <= maxPoints) return arr;
  const stride = Math.ceil(arr.length / maxPoints);
  return arr.filter((_, i) => i % stride === 0);
}

/**
 * Executes one tool call (from any OpenAI-compatible tool-calling API) against a live model,
 * mutating it in place. This is the single code path AI edits go through — identical to what
 * the UI's inspector panel calls.
 */
export function executeTool(model: Model, toolName: string, input: Record<string, unknown>): ToolExecutionResult {
  try {
    switch (toolName) {
      case "add_stock": {
        const s = addStock(model, {
          name: str(input.name),
          initialEquation: optStr(input.initial_equation),
          units: optStr(input.units),
          comment: optStr(input.comment),
          pos: posFrom(input),
        });
        return { ok: true, result: { id: s.id, name: s.name } };
      }
      case "add_flow": {
        const f = addFlow(model, {
          name: str(input.name),
          equation: optStr(input.equation),
          from: optStr(input.from) ?? null,
          to: optStr(input.to) ?? null,
          units: optStr(input.units),
          comment: optStr(input.comment),
          pos: posFrom(input),
        });
        return { ok: true, result: { id: f.id, name: f.name, from: f.from, to: f.to } };
      }
      case "add_auxiliary": {
        const a = addAuxiliary(model, {
          name: str(input.name),
          equation: str(input.equation),
          units: optStr(input.units),
          comment: optStr(input.comment),
          pos: posFrom(input),
        });
        return { ok: true, result: { id: a.id, name: a.name } };
      }
      case "set_lookup": {
        const points = lookupPoints(input.points);
        const name = str(input.name);
        const existing = resolveVar(model, name);
        if (existing) {
          // An existing variable keeps its identity (id, position, units, comment) and just gets
          // a new curve — so a lookup the user already placed and wired up isn't duplicated or
          // disconnected by re-specifying it.
          const aux = setLookupPoints(model, existing.id, {
            points,
            xMin: optNum(input.x_min),
            xMax: optNum(input.x_max),
            yMin: optNum(input.y_min),
            yMax: optNum(input.y_max),
          });
          return { ok: true, result: { id: aux.id, name: aux.name, updated: true } };
        }
        const aux = addLookup(model, {
          name,
          points,
          xMin: optNum(input.x_min),
          xMax: optNum(input.x_max),
          yMin: optNum(input.y_min),
          yMax: optNum(input.y_max),
          units: optStr(input.units),
          comment: optStr(input.comment),
          pos: posFrom(input),
        });
        return { ok: true, result: { id: aux.id, name: aux.name, equation: aux.equation } };
      }
      case "add_constant": {
        const a = addConstant(model, {
          name: str(input.name),
          value: num(input.value),
          units: optStr(input.units),
          comment: optStr(input.comment),
          pos: posFrom(input),
        });
        return { ok: true, result: { id: a.id, name: a.name } };
      }
      case "add_relation": {
        const c = addConnector(model, { from: str(input.from), to: str(input.to), polarity: optPolarity(input.polarity) });
        return { ok: true, result: { id: c.id, polarity: c.polarity } };
      }
      case "set_relation_polarity": {
        const c = setConnectorPolarity(model, str(input.id), polarity(input.polarity));
        return { ok: true, result: { id: c.id, polarity: c.polarity } };
      }
      case "refresh_relation_polarities": {
        const changed = refreshInferredPolarities(model);
        return { ok: true, result: { changed: changed.map((c) => ({ id: c.id, polarity: c.polarity })) } };
      }
      case "set_equation": {
        const which = input.which === "initial" ? "initial" : "equation";
        const v = setEquation(model, str(input.id_or_name), str(input.equation), which);
        return { ok: true, result: { id: v.id, name: v.name } };
      }
      case "rename_variable": {
        const v = renameVariable(model, str(input.id_or_name), str(input.new_name));
        return { ok: true, result: { id: v.id, name: v.name } };
      }
      case "move_element": {
        moveElement(model, str(input.id_or_name), { x: num(input.x), y: num(input.y) });
        return { ok: true, result: { moved: true } };
      }
      case "delete_element": {
        const v = resolveVar(model, str(input.id_or_name));
        const id = v?.id ?? str(input.id_or_name);
        deleteElement(model, id);
        return { ok: true, result: { deleted: id } };
      }
      case "clear_model": {
        const counts = {
          stocks: model.stocks.length,
          flows: model.flows.length,
          auxiliaries: model.auxiliaries.length,
          connectors: model.connectors.length,
          comments: model.comments.length,
        };
        clearModel(model);
        return { ok: true, result: { cleared: counts } };
      }
      case "add_comment": {
        const c = addComment(model, { text: str(input.text), pos: posFrom(input) });
        return { ok: true, result: { id: c.id, text: c.text } };
      }
      case "set_comment_text": {
        const c = setCommentText(model, str(input.id), str(input.text));
        return { ok: true, result: { id: c.id, text: c.text } };
      }
      case "move_comment": {
        moveComment(model, str(input.id), { x: num(input.x), y: num(input.y) });
        return { ok: true, result: { moved: true } };
      }
      case "set_sim_spec": {
        const spec = setSimSpec(model, {
          ...(typeof input.start_time === "number" ? { startTime: input.start_time } : {}),
          ...(typeof input.stop_time === "number" ? { stopTime: input.stop_time } : {}),
          ...(typeof input.dt === "number" ? { dt: input.dt } : {}),
          ...(typeof input.integration_method === "string" ? { integrationMethod: input.integration_method as IntegrationMethod } : {}),
          ...(typeof input.time_units === "string" ? { timeUnits: input.time_units } : {}),
        });
        return { ok: true, result: spec };
      }
      case "auto_layout": {
        const direction = input.direction === "TB" ? "TB" : "LR";
        const algorithm = input.algorithm === undefined ? "structured" : input.algorithm === "layered" || input.algorithm === "structured" ? input.algorithm : undefined;
        if (!algorithm) throw new ModelError(`Unknown layout "${String(input.algorithm)}". Use structured or layered.`);
        autoLayout(model, { direction, algorithm });
        return { ok: true, result: { laidOut: true, direction, algorithm } };
      }
      case "set_custom_graph": {
        const graph = setCustomGraph(model, graphFromTool(input));
        return {
          ok: true,
          result: {
            name: graph.name,
            variables: graph.scales.flatMap((s) => s.variables.map((v) => v.name)),
          },
        };
      }
      case "delete_custom_graph": {
        deleteCustomGraph(model, str(input.name));
        return { ok: true, result: { deleted: str(input.name) } };
      }
      case "list_model": {
        return { ok: true, result: summarizeModel(model) };
      }
      case "run_simulation": {
        const sim = simulate(model);
        const finalValues: Record<string, number> = {};
        for (const v of allVariables(model)) {
          finalValues[v.name] = sim.series[v.name]?.at(-1) ?? NaN;
        }
        const series: Record<string, number[]> = {};
        for (const [name, values] of Object.entries(sim.series)) series[name] = downsample(values, 50);
        return { ok: true, result: { time: downsample(sim.time, 50), finalValues, series } };
      }
      case "check_units": {
        const issues = checkUnits(model);
        return { ok: true, result: { issues } };
      }
      case "list_loops": {
        const loops = detectLoops(model).map((loop) => ({
          label: `${loop.polarity}${loop.number}`,
          polarity: loop.polarity,
          direction: loop.direction,
          variables: namesForLoop(model, loop.nodeIds),
        }));
        return { ok: true, result: { loops } };
      }
      case "annotate_loops": {
        const created = annotateLoops(model);
        return { ok: true, result: { annotated: created.length } };
      }
      default:
        return { ok: false, error: `Unknown tool "${toolName}".` };
    }
  } catch (err) {
    const message = err instanceof ModelError ? err.message : err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function str(v: unknown): string {
  if (typeof v !== "string") throw new ModelError(`Expected a string argument, got ${JSON.stringify(v)}.`);
  return v;
}
function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number {
  if (typeof v !== "number") throw new ModelError(`Expected a numeric argument, got ${JSON.stringify(v)}.`);
  return v;
}
const LINE_STYLES = new Set(["DOT", "DASH", "DASHDOT", "DASHDOTDOT"]);

function graphFromTool(input: Record<string, unknown>): CustomGraph {
  if (!Array.isArray(input.variables) || input.variables.length === 0) {
    throw new ModelError("A custom graph needs at least one variable.");
  }
  // Omitted `scale` is its own y-scale (a composite: every line stays visible). An explicit
  // number groups those variables onto one :SCALE, in the order they were given.
  const scales: { shared: boolean; variables: GraphVariable[] }[] = [];
  const explicit = new Map<number, { shared: boolean; variables: GraphVariable[] }>();
  input.variables.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") throw new ModelError(`Variable ${index + 1} is not an object.`);
    const v = raw as Record<string, unknown>;
    const name = str(v.name);
    const styleRaw = typeof v.line_style === "string" ? v.line_style.toUpperCase() : undefined;
    const lineStyle: LineStyle | undefined =
      styleRaw && styleRaw !== "SOLID" ? (styleRaw as LineStyle) : undefined;
    if (lineStyle && !LINE_STYLES.has(lineStyle)) {
      throw new ModelError(`"${name}" has unknown line_style "${styleRaw}". Use SOLID, DOT, DASH, DASHDOT, or DASHDOTDOT.`);
    }
    const lineWidth = v.line_width === undefined ? undefined : num(v.line_width);
    if (lineStyle && lineWidth !== undefined) {
      throw new ModelError(`Vensim cannot combine a line style (${lineStyle}) with a line width on "${name}".`);
    }
    const scale = v.scale === undefined ? undefined : num(v.scale);
    if (scale !== undefined && (!Number.isInteger(scale) || scale < 0)) {
      throw new ModelError(`"${name}" has scale ${scale}. Scale is a whole number starting at 0.`);
    }
    const variable: GraphVariable = {
      name,
      label: optStr(v.label),
      lineStyle,
      lineWidth,
      lineColor: v.color === undefined ? undefined : parseRgb(str(v.color), name),
      yMin: optNum(v.y_min),
      yMax: optNum(v.y_max),
      extra: [],
    };
    if (scale === undefined) {
      scales.push({ shared: false, variables: [variable] });
      return;
    }
    const group = explicit.get(scale);
    if (group) group.variables.push(variable);
    else {
      const created = { shared: true, variables: [variable] };
      explicit.set(scale, created);
      scales.push(created);
    }
  });
  return {
    name: str(input.name),
    title: optStr(input.title),
    xAxis: optStr(input.x_axis),
    xLabel: optStr(input.x_label),
    yLabel: optStr(input.y_label),
    xMin: optNum(input.x_min),
    xMax: optNum(input.x_max),
    yMin: optNum(input.y_min),
    yMax: optNum(input.y_max),
    dots: input.dots === true,
    cumulative: input.cumulative === true,
    scales,
    extra: [],
  };
}

function parseRgb(text: string, name: string): { r: number; g: number; b: number } {
  const match = /^(\d{1,3})-(\d{1,3})-(\d{1,3})$/.exec(text.trim());
  if (!match) throw new ModelError(`"${name}" color must be Vensim's r-g-b form, like "220-40-40".`);
  const [r, g, b] = [match[1], match[2], match[3]].map((n) => Number(n));
  if (r! > 255 || g! > 255 || b! > 255) throw new ModelError(`"${name}" color channels must be from 0 to 255.`);
  return { r: r!, g: g!, b: b! };
}

function posFrom(input: Record<string, unknown>): { x: number; y: number } | undefined {
  if (typeof input.x === "number" && typeof input.y === "number") return { x: input.x, y: input.y };
  return undefined;
}
function optNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Accepts a lookup's points as `[x, y]` pairs (the documented shape, mirroring Vensim's own
 * `(x,y),(x,y)` notation) OR as `{x, y}` objects, since a model that reaches for the latter is
 * expressing the same thing unambiguously — rejecting it would just cost a retry. */
function lookupPoints(v: unknown): { x: number; y: number }[] {
  if (!Array.isArray(v)) throw new ModelError("`points` must be an array of [input, output] pairs.");
  const points = v.map((p, i) => {
    if (Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number") {
      return { x: p[0], y: p[1] };
    }
    if (p && typeof p === "object" && "x" in p && "y" in p) {
      const o = p as { x: unknown; y: unknown };
      if (typeof o.x === "number" && typeof o.y === "number") return { x: o.x, y: o.y };
    }
    throw new ModelError(`Lookup point ${i} must be a [input, output] pair of numbers.`);
  });
  if (points.length === 0) throw new ModelError("`points` needs at least one [input, output] pair.");
  return points;
}
function polarity(v: unknown): Polarity {
  if (v !== "+" && v !== "-") throw new ModelError(`Expected polarity "+" or "-", got ${JSON.stringify(v)}.`);
  return v;
}
function optPolarity(v: unknown): Polarity | undefined {
  return v === "+" || v === "-" ? v : undefined;
}
