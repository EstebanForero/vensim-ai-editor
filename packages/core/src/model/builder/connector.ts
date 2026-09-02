import { ModelError } from "../errors.js";
import { nextId } from "../ids.js";
import type { Connector, Model, Polarity, Position } from "../types.js";
import { resolveVariableRef } from "./helpers.js";

export interface AddConnectorInput {
  /** id or name of the source variable. */
  from: string;
  /** id or name of the target variable. */
  to: string;
  /** Whether an increase in `from` tends to increase ("+", default) or decrease ("-") `to`. */
  polarity?: Polarity;
}

/** Adds a causal relation (a.k.a. connector) between two variables. Also how a pure
 * causal-loop diagram is built: relations with no stocks/flows at all. */
export function addConnector(model: Model, input: AddConnectorInput): Connector {
  const from = resolveVariableRef(model, input.from);
  const to = resolveVariableRef(model, input.to);
  const dup = model.connectors.find((c) => c.from === from.id && c.to === to.id);
  if (dup) {
    if (input.polarity) dup.polarity = input.polarity;
    return dup;
  }
  const connector: Connector = {
    kind: "connector",
    id: nextId("conn"),
    from: from.id,
    to: to.id,
    polarity: input.polarity ?? "+",
    bend: null,
  };
  model.connectors.push(connector);
  return connector;
}

export function setConnectorPolarity(model: Model, connectorId: string, polarity: Polarity): Connector {
  const c = model.connectors.find((x) => x.id === connectorId);
  if (!c) throw new ModelError(`No relation found with id "${connectorId}".`);
  c.polarity = polarity;
  return c;
}

/** Sets (or, with `null`, clears back to auto-curve) the manual curve-handle position for a relation. */
export function setConnectorBend(model: Model, connectorId: string, bend: Position | null): Connector {
  const c = model.connectors.find((x) => x.id === connectorId);
  if (!c) throw new ModelError(`No relation found with id "${connectorId}".`);
  c.bend = bend;
  return c;
}
