import { nextId } from "../ids.js";
import type { Connector, Model } from "../types.js";
import { resolveVariableRef } from "./helpers.js";

export interface AddConnectorInput {
  /** id or name of the source variable. */
  from: string;
  /** id or name of the target variable. */
  to: string;
}

export function addConnector(model: Model, input: AddConnectorInput): Connector {
  const from = resolveVariableRef(model, input.from);
  const to = resolveVariableRef(model, input.to);
  const dup = model.connectors.find((c) => c.from === from.id && c.to === to.id);
  if (dup) return dup;
  const connector: Connector = { kind: "connector", id: nextId("conn"), from: from.id, to: to.id };
  model.connectors.push(connector);
  return connector;
}
