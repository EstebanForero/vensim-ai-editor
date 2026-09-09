import { ModelError } from "../errors.js";
import { allVariables, findVariable, type Model, type Position, type SimSpec, type Variable } from "../types.js";
import { inferConnectorPolarity } from "./connector.js";
import { assertUniqueName, renameReferencesInEquations, resolveVariableRef, stripDiacritics } from "./helpers.js";

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
  const safeEquation = stripDiacritics(equation);
  if (which === "initial") {
    if (v.kind !== "stock") throw new ModelError(`"${v.name}" is not a stock; it has no initial equation.`);
    v.initialEquation = safeEquation;
  } else {
    if (v.kind === "stock") throw new ModelError(`"${v.name}" is a stock; set its inflows/outflows instead of an equation.`);
    v.equation = safeEquation;
    // The equation just changed, so any relation feeding INTO this variable may have a
    // different — or now-determinable — polarity. Only touches connectors whose sign the new
    // equation actually pins down structurally; anything ambiguous keeps whatever polarity was
    // already set (a manual override survives an unrelated equation tweak elsewhere).
    const vars = allVariables(model);
    for (const c of model.connectors) {
      if (c.to !== v.id) continue;
      const from = vars.find((x) => x.id === c.from);
      if (!from) continue;
      const inferred = inferConnectorPolarity(model, from, v);
      if (inferred) c.polarity = inferred;
    }
  }
  return v;
}

export function setVariableUnits(model: Model, id: string, units: string): Variable {
  const v = resolveVariableRef(model, id);
  v.units = stripDiacritics(units);
  return v;
}

export function setVariableComment(model: Model, id: string, comment: string): Variable {
  const v = resolveVariableRef(model, id);
  v.comment = stripDiacritics(comment);
  return v;
}

export function renameVariable(model: Model, id: string, newName: string): Variable {
  const v = resolveVariableRef(model, id);
  const safeName = stripDiacritics(newName);
  assertUniqueName(model, safeName, v.id);
  const oldName = v.name;
  v.name = safeName;
  renameReferencesInEquations(model, oldName, safeName);
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
    const orphanedFlowIds: string[] = [];
    for (const flowId of [...v.inflows, ...v.outflows]) {
      const flow = model.flows.find((f) => f.id === flowId);
      if (flow) {
        if (flow.from === v.id) flow.from = null;
        if (flow.to === v.id) flow.to = null;
        if (!flow.from && !flow.to) orphanedFlowIds.push(flow.id);
      }
    }
    model.stocks = model.stocks.filter((s) => s.id !== id);
    // addFlow refuses to create a flow with neither a from nor a to stock — deleting this
    // stock must not silently leave that invariant broken (a flow floating with both ends
    // open reads, to any XMILE reader, as two separate unconnected cloud endpoints).
    for (const flowId of orphanedFlowIds) deleteElement(model, flowId);
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
