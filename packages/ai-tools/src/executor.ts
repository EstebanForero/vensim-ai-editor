import {
  addAuxiliary,
  addConnector,
  addConstant,
  addFlow,
  addStock,
  allVariables,
  deleteElement,
  findVariable,
  findVariableByName,
  ModelError,
  moveElement,
  renameVariable,
  setEquation,
  simulate,
  type Model,
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
    auxiliaries: model.auxiliaries.map((a) => ({ id: a.id, name: a.name, equation: a.equation, isConstant: a.isConstant, units: a.units })),
    connectors: model.connectors.map((c) => ({ id: c.id, from: c.from, to: c.to })),
  };
}

function downsample(arr: number[], maxPoints: number): number[] {
  if (arr.length <= maxPoints) return arr;
  const stride = Math.ceil(arr.length / maxPoints);
  return arr.filter((_, i) => i % stride === 0);
}

/**
 * Executes one Anthropic tool_use call against a live model, mutating it in place. This is
 * the single code path AI edits go through — identical to what the UI's inspector panel calls.
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
      case "add_connector": {
        const c = addConnector(model, { from: str(input.from), to: str(input.to) });
        return { ok: true, result: { id: c.id } };
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
function posFrom(input: Record<string, unknown>): { x: number; y: number } | undefined {
  if (typeof input.x === "number" && typeof input.y === "number") return { x: input.x, y: input.y };
  return undefined;
}
