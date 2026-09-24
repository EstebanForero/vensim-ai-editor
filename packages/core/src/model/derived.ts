// Queries computed from a Model's existing data, rather than stored fields — kept separate
// from types.ts (the schema) so derived facts can't drift out of sync with what they're
// derived from. isConstantAuxiliary is the first of these: whether an Auxiliary "is a
// constant" is never stored, only computed from its equation on demand.

import { collectVarNames, tryParseExpr } from "../mdl/expr/index.js";
import { collectLookupRefs, lookupScopeOf } from "./lookup.js";
import { inferPolarity } from "./polarity.js";
import { allVariables, findVariable, type Auxiliary, type Model, type Polarity, type Variable } from "./types.js";

/**
 * An Auxiliary behaves as a constant when its equation references no other variable — a bare
 * number, or an expression built only from literals/functions of literals. This mirrors
 * Vensim, which doesn't have a distinct "Constant" diagram element either: whether something
 * reads as a constant falls out of its equation, not a separate kind you have to pick when
 * creating it.
 */
export function isConstantAuxiliary(aux: Auxiliary, model?: Model): boolean {
  const knownNames = model ? allVariables(model).map((v) => v.name) : [];
  const parsed = tryParseExpr(aux.equation, knownNames);
  if (!parsed) return false;
  // A lookup table also references no variables (it's all numbers), but it is emphatically not a
  // constant — it's a function other equations call, and nothing about it is a fixed value.
  if (parsed.type === "lookup") return false;
  return collectVarNames(parsed).size === 0;
}

function ownEquation(variable: Variable): string {
  return variable.kind === "stock" ? variable.initialEquation : variable.equation;
}

/** Every variable this one's equation (or initial value, for a stock) directly references —
 * "what does this depend on". A lookup called as `Effect(x)` counts as a dependency of the
 * caller on `Effect` as well as on `x`: `collectVarNames` only walks a call's arguments, so the
 * callee's own name is folded in here. */
export function equationDependencies(model: Model, variable: Variable): Variable[] {
  const knownNames = allVariables(model)
    .map((v) => v.name)
    .filter((n) => n !== variable.name);
  const parsed = tryParseExpr(ownEquation(variable), knownNames);
  if (!parsed) return [];
  const names = collectVarNames(parsed);
  for (const ref of collectLookupRefs(parsed)) names.add(ref);
  return allVariables(model).filter((v) => names.has(v.name));
}

/** Every variable whose equation directly references this one — "what depends on this". Only
 * equations are consulted here (not causal-relation arrows, which the inspector reports
 * separately) since a relation can exist for annotation purposes without necessarily being the
 * thing making a value flow. */
export function equationDependents(model: Model, variable: Variable): Variable[] {
  return allVariables(model).filter((v) => v.id !== variable.id && equationDependencies(model, v).some((d) => d.id === variable.id));
}

export interface CausalEdge {
  from: Variable;
  to: Variable;
  /** Whether raising `from` raises ("+") or lowers ("-") `to`. */
  polarity: Polarity;
}

/**
 * The causal structure the *equations* state: for every variable, the variables its own equation
 * reads, each as a signed edge into it.
 *
 * This is the counterpart to `model.connectors`, which is the structure someone *drew*. The two
 * normally agree — drawing a relation here infers its sign from the target's equation, and
 * `setEquation` refreshes those signs when the equation changes — so on a fully drawn model this
 * adds nothing. They part company when nothing was drawn: a model typed straight from its
 * equations, or a `.mdl` whose sketch is empty or partial, carries no relations at all, and every
 * consumer of the drawn graph then reports that it has no feedback structure, however plainly it
 * has some. `loops/graph.ts` reads both, for exactly that reason.
 *
 * Two deliberate omissions:
 *
 * - **Stocks contribute nothing.** A stock's equation is its *initial value*, which fixes t0 and
 *   nothing after it; the things that drive a stock are its flows, which already carry their own
 *   edges. Treating an initial value as a causal link would invent feedback where a level merely
 *   starts somewhere.
 * - **An edge whose sign the equation doesn't determine is left out, not defaulted.** A loop's
 *   polarity is the product of its edges' signs, so an invented "+" turns a balancing loop into a
 *   reinforcing one and every archetype reading built on it goes with it. A missing edge loses one
 *   loop; a wrong sign mislabels every loop through it. The cost is that a model read from its
 *   equations alone can find fewer loops than the same model fully drawn — but only loops whose
 *   own sign was undetermined, which the archetype detectors (all of them polarity-based, bar the
 *   commons') could not have classified anyway. See model/polarity.ts for when a sign is
 *   genuinely undecidable.
 */
export function equationCausalEdges(model: Model): CausalEdge[] {
  const knownNames = allVariables(model).map((v) => v.name);
  const lookups = lookupScopeOf(model);
  const edges: CausalEdge[] = [];
  for (const to of allVariables(model)) {
    if (to.kind === "stock") continue;
    for (const from of equationDependencies(model, to)) {
      const polarity = inferPolarity(to.equation, from.name, knownNames, lookups);
      if (polarity) edges.push({ from, to, polarity });
    }
  }
  return edges;
}

export interface VariableRelationships {
  /** Variables this one's equation references, plus variables a relation arrow points from. */
  dependsOn: Variable[];
  /** Variables whose equation references this one, plus variables a relation arrow points to. */
  usedBy: Variable[];
  isConstant: boolean;
}

/** The "smart inspector" view of a variable: what it depends on and what depends on it, from
 * both its equation and any explicit causal-relation arrows, deduplicated. */
export function variableRelationships(model: Model, variableId: string): VariableRelationships {
  const variable = findVariable(model, variableId);
  if (!variable) return { dependsOn: [], usedBy: [], isConstant: false };

  const dependsOn = new Map<string, Variable>();
  const usedBy = new Map<string, Variable>();
  for (const v of equationDependencies(model, variable)) dependsOn.set(v.id, v);
  for (const v of equationDependents(model, variable)) usedBy.set(v.id, v);
  for (const c of model.connectors) {
    if (c.to === variable.id) {
      const v = findVariable(model, c.from);
      if (v) dependsOn.set(v.id, v);
    }
    if (c.from === variable.id) {
      const v = findVariable(model, c.to);
      if (v) usedBy.set(v.id, v);
    }
  }

  return {
    dependsOn: [...dependsOn.values()],
    usedBy: [...usedBy.values()],
    isConstant: variable.kind === "auxiliary" ? isConstantAuxiliary(variable, model) : false,
  };
}
