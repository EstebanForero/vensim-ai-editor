// Core Vensim-shaped system-dynamics model schema.
// This is the single source of truth mutated by both the UI and the AI tools.

export type ElementKind = "stock" | "flow" | "auxiliary" | "connector";

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Shared fields for named, drawable model elements (stocks, flows, auxiliaries). */
export interface BaseVariable {
  id: string;
  name: string;
  units: string;
  comment: string;
  pos: Position;
  size: Size;
}

/** A Level in Vensim terms — integrates its net inflow over time. */
export interface Stock extends BaseVariable {
  kind: "stock";
  /** Equation for the initial value, e.g. "100" or "InitialPopulation". */
  initialEquation: string;
  /** ids of Flow elements that add to this stock. */
  inflows: string[];
  /** ids of Flow elements that subtract from this stock. */
  outflows: string[];
}

/** A Rate in Vensim terms — connects two stocks (or a cloud source/sink) and moves material between them. */
export interface Flow extends BaseVariable {
  kind: "flow";
  equation: string;
  /** Stock id this flow drains, or null if it originates from a cloud (external source). */
  from: string | null;
  /** Stock id this flow fills, or null if it drains to a cloud (external sink). */
  to: string | null;
}

/** An Auxiliary or Constant — any variable that isn't a stock or flow. Constants are auxiliaries with a literal/param equation. */
export interface Auxiliary extends BaseVariable {
  kind: "auxiliary";
  equation: string;
  isConstant: boolean;
}

export type Polarity = "+" | "-";

/**
 * A causal relation (Vensim's thin information-link arrow), distinct from a flow pipe. Also
 * the building block of a pure causal-loop diagram, where variables are connected only by
 * signed relations with no stocks/flows at all. `polarity` records whether an increase in
 * `from` tends to increase ("+") or decrease ("-") `to` — used by loop detection to classify
 * a cycle as Reinforcing or Balancing.
 */
export interface Connector {
  id: string;
  kind: "connector";
  from: string;
  to: string;
  polarity: Polarity;
  /** Manual curve control point (absolute diagram coordinates), or null to auto-curve based
   * on the current from/to positions. Set by dragging the relation's curve handle on the canvas. */
  bend: Position | null;
}

/** A freestanding text annotation, not tied to any variable's equation — Vensim's own
 * "Comment" sketch tool. */
export interface Comment {
  id: string;
  kind: "comment";
  text: string;
  pos: Position;
  size: Size;
}

export type Variable = Stock | Flow | Auxiliary;
export type ModelElement = Variable | Connector | Comment;

export type IntegrationMethod = "euler" | "rk4";

export interface SimSpec {
  startTime: number;
  stopTime: number;
  dt: number;
  integrationMethod: IntegrationMethod;
  timeUnits: string;
}

export interface Model {
  name: string;
  stocks: Stock[];
  flows: Flow[];
  auxiliaries: Auxiliary[];
  connectors: Connector[];
  comments: Comment[];
  simSpec: SimSpec;
  /** Raw equation text for constructs the .mdl codec doesn't model yet (macros, subscripted vars, etc.), preserved verbatim on write. */
  unsupportedRaw: string[];
}

export function createEmptyModel(name = "New Model"): Model {
  return {
    name,
    stocks: [],
    flows: [],
    auxiliaries: [],
    connectors: [],
    comments: [],
    simSpec: {
      startTime: 0,
      stopTime: 100,
      dt: 0.25,
      integrationMethod: "euler",
      timeUnits: "Time",
    },
    unsupportedRaw: [],
  };
}

export function allVariables(model: Model): Variable[] {
  return [...model.stocks, ...model.flows, ...model.auxiliaries];
}

export function findVariable(model: Model, id: string): Variable | undefined {
  return allVariables(model).find((v) => v.id === id);
}

export function findVariableByName(model: Model, name: string): Variable | undefined {
  const lower = name.toLowerCase();
  return allVariables(model).find((v) => v.name.toLowerCase() === lower);
}
