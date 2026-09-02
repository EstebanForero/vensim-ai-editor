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

/** A causal information link (Vensim's thin arrow), distinct from a flow pipe. */
export interface Connector {
  id: string;
  kind: "connector";
  from: string;
  to: string;
}

export type Variable = Stock | Flow | Auxiliary;
export type ModelElement = Variable | Connector;

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
