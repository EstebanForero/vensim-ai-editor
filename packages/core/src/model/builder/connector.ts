import { ModelError } from "../errors.js";
import { nextId } from "../ids.js";
import { lookupScopeOf } from "../lookup.js";
import { inferPolarity } from "../polarity.js";
import { allVariables, type Connector, type Model, type Polarity, type Position, type Variable } from "../types.js";
import { resolveVariableRef } from "./helpers.js";

export interface AddConnectorInput {
  /** id or name of the source variable. */
  from: string;
  /** id or name of the target variable. */
  to: string;
  /** Whether an increase in `from` tends to increase ("+") or decrease ("-") `to`. Omit to
   * infer it automatically from `to`'s own equation (see inferConnectorPolarity) — falls back
   * to "+" only when the equation doesn't pin the sign down structurally. */
  polarity?: Polarity;
}

/** Structurally infers whether increasing `source` (holding every other input fixed) increases
 * or decreases `target`'s own equation — see model/polarity.ts for the actual sign analysis.
 * Returns `null` when `target` has no equation to analyze (a stock; its behavior comes from its
 * inflows/outflows, not a direct formula a connector would feed into) or when the sign can't be
 * pinned down structurally, in which case callers should keep whatever polarity was already
 * there rather than treat `null` as a particular sign. */
export function inferConnectorPolarity(model: Model, source: Variable, target: Variable): Polarity | null {
  if (!("equation" in target) || !target.equation) return null;
  const knownNames = allVariables(model).map((v) => v.name);
  // The model's lookups go along for the ride: `Rate = Effect(Inventory)` is signable when
  // `Effect` is a monotonic curve, and without the tables this would fall through to "unknown"
  // and lose the polarity (and any loop classification that depends on it).
  return inferPolarity(target.equation, source.name, knownNames, lookupScopeOf(model));
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
  const polarity = input.polarity ?? inferConnectorPolarity(model, from, to) ?? "+";
  const connector: Connector = {
    kind: "connector",
    id: nextId("conn"),
    from: from.id,
    to: to.id,
    polarity,
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

/** Re-infers polarity for every connector whose target's equation currently determines it
 * structurally, leaving anything ambiguous (or targeting a stock) exactly as it was — useful
 * after an equation edit so relations drawn before the equation existed/changed stay accurate.
 * Returns the connectors that were actually changed. */
export function refreshInferredPolarities(model: Model): Connector[] {
  const changed: Connector[] = [];
  for (const c of model.connectors) {
    const vars = allVariables(model);
    const from = vars.find((v) => v.id === c.from);
    const to = vars.find((v) => v.id === c.to);
    if (!from || !to) continue;
    const inferred = inferConnectorPolarity(model, from, to);
    if (inferred && inferred !== c.polarity) {
      c.polarity = inferred;
      changed.push(c);
    }
  }
  return changed;
}

/** Sets (or, with `null`, clears back to auto-curve) the manual curve-handle position for a relation. */
export function setConnectorBend(model: Model, connectorId: string, bend: Position | null): Connector {
  const c = model.connectors.find((x) => x.id === connectorId);
  if (!c) throw new ModelError(`No relation found with id "${connectorId}".`);
  c.bend = bend;
  return c;
}
