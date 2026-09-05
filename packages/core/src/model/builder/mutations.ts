import { ModelError } from "../errors.js";
import { findVariable, type Model, type Position, type SimSpec, type Variable } from "../types.js";
import { assertUniqueName, renameReferencesInEquations, resolveVariableRef } from "./helpers.js";

/** Merges any subset of sim-spec fields (start/stop/dt/integration method/time units). */
export function setSimSpec(model: Model, patch: Partial<SimSpec>): SimSpec {
  Object.assign(model.simSpec, patch);
  return model.simSpec;
}

export function setEquation(
  model: Model,
  id: string,
  equation: string,
  which: "equation" | "initial" = "equation",
): Variable {
  const v = resolveVariableRef(model, id);
  if (which === "initial") {
    if (v.kind !== "stock") throw new ModelError(`"${v.name}" is not a stock; it has no initial equation.`);
    v.initialEquation = equation;
  } else {
    if (v.kind === "stock") throw new ModelError(`"${v.name}" is a stock; set its inflows/outflows instead of an equation.`);
    v.equation = equation;
  }
  return v;
}

export function renameVariable(model: Model, id: string, newName: string): Variable {
  const v = resolveVariableRef(model, id);
  assertUniqueName(model, newName, v.id);
  const oldName = v.name;
  v.name = newName;
  renameReferencesInEquations(model, oldName, newName);
  return v;
}

export function moveElement(model: Model, id: string, pos: Position): void {
  const v = resolveVariableRef(model, id);
  v.pos = pos;
}

export function deleteElement(model: Model, id: string): void {
  const commentIdx = model.comments.findIndex((c) => c.id === id);
  if (commentIdx !== -1) {
    model.comments.splice(commentIdx, 1);
    return;
  }

  const v = findVariable(model, id) ?? model.connectors.find((c) => c.id === id);
  if (!v) throw new ModelError(`No element found with id "${id}".`);

  model.connectors = model.connectors.filter((c) => c.id !== id && c.from !== id && c.to !== id);

  if (v.kind === "stock") {
    for (const flowId of [...v.inflows, ...v.outflows]) {
      const flow = model.flows.find((f) => f.id === flowId);
      if (flow) {
        if (flow.from === v.id) flow.from = null;
        if (flow.to === v.id) flow.to = null;
      }
    }
    model.stocks = model.stocks.filter((s) => s.id !== id);
  } else if (v.kind === "flow") {
    for (const s of model.stocks) {
      s.inflows = s.inflows.filter((f) => f !== id);
      s.outflows = s.outflows.filter((f) => f !== id);
    }
    model.flows = model.flows.filter((f) => f.id !== id);
  } else if (v.kind === "auxiliary") {
    model.auxiliaries = model.auxiliaries.filter((a) => a.id !== id);
  } else {
    model.connectors = model.connectors.filter((c) => c.id !== id);
  }
}
