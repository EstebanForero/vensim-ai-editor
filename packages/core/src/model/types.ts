// Core Vensim-shaped system-dynamics model schema.
// This is the single source of truth mutated by both the UI and the AI tools.

export type ElementKind = "stock" | "flow" | "auxiliary" | "connector";

/**
 * Names that already mean something in a Vensim model and so can never be a variable's own name.
 *
 * `Time` is Vensim's built-in clock — the one a rate can be written against (`5 + 0.15 * Time`),
 * and the one STEP/PULSE read. It is NOT a variable, and defining one is not a harmless shadow:
 * this editor's simulator seeds the clock into the same environment every variable is evaluated
 * in, so a variable named `Time` replaces it, and from then on every equation that reads the
 * clock gets that variable's value instead. The symptom is silent and total — a model whose
 * demand should grow over time produces a flat line, with no error, no validation issue, and no
 * units complaint.
 *
 * The four control parameters are reserved for a different reason: a variable of that name would
 * be written alongside the control record for the same name, and on re-import the file's own
 * `.Control` section wins, so the variable you drew simply disappears.
 *
 * Matched case-insensitively, matching how Vensim itself resolves names.
 */
export const RESERVED_NAMES: readonly string[] = ["Time", "FINAL TIME", "INITIAL TIME", "TIME STEP", "SAVEPER"];

export function isReservedName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return RESERVED_NAMES.some((r) => r.toLowerCase() === lower);
}

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

/**
 * A computed variable that isn't a stock or flow. Vensim has no separate "Constant" element
 * kind on the diagram — a constant is just an Auxiliary whose equation happens to have no
 * dependencies (a literal, or an expression of only literals). See
 * `isConstantAuxiliary` in `./derived.ts` to check that, rather than storing it as a flag
 * that could drift out of sync with the equation.
 */
export interface Auxiliary extends BaseVariable {
  kind: "auxiliary";
  equation: string;
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
  /** Names of variables with a Vensim "graph pad" sketch widget pinned to them (that `<name>,
   * Graph` sketch box Vensim's own diagram editor draws when you drop a chart onto the sketch).
   * Purely a view concern — has no effect on simulation — but preserved and (for stocks, by
   * default) generated so exported files carry the same kind of at-a-glance trend view a human
   * Vensim user would normally add by hand. */
  pinnedGraphs: string[];
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
    pinnedGraphs: [],
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
