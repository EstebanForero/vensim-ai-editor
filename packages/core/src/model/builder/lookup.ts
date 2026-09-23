import { normalizeLookupTable, type LookupPoint, type LookupTable } from "../../mdl/expr/index.js";
import { lookupEquation, lookupTableOf, tableFromPoints } from "../lookup.js";
import { ModelError } from "../errors.js";
import type { Auxiliary, Model, Position, Size } from "../types.js";
import { addAuxiliary } from "./auxiliary.js";
import { resolveVariableRef } from "./helpers.js";

/** Roomier than a plain auxiliary's box: a lookup is drawn on the canvas with its curve inside
 * it (see the web app's LookupNode), and this size is what auto-layout spaces against and what
 * the exported sketch declares — so it has to match what actually gets rendered, or laid-out
 * diagrams overlap. */
const DEFAULT_LOOKUP_SIZE: Size = { width: 150, height: 68 };

export interface AddLookupInput {
  name: string;
  /** (input, output) pairs, at least one. */
  points: LookupPoint[];
  /** Axis limits shown in the graph editor. Default to the data's own bounds. */
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** The curve's OUTPUT units — in Vensim a lookup's `~units` line describes what it returns,
   * not what it takes. */
  units?: string;
  comment?: string;
  pos?: Position;
  size?: Size;
}

/** Creates a new lookup variable — an auxiliary whose equation is the generated table. */
export function addLookup(model: Model, input: AddLookupInput): Auxiliary {
  if (input.points.length === 0) throw new ModelError("A lookup table needs at least one point.");
  const table = tableFromPoints(input.points, input);
  return addAuxiliary(model, {
    name: input.name,
    equation: lookupEquation(table),
    units: input.units,
    comment: input.comment,
    pos: input.pos,
    size: input.size ?? DEFAULT_LOOKUP_SIZE,
  });
}

/** Replaces an existing variable's curve, converting it into a lookup if it wasn't one. Applied
 * through `setEquation`'s equivalent path so the variable's name, units, comment and position all
 * stay as they are — this changes what a variable computes, not what it is. */
export function setLookupTable(model: Model, idOrName: string, table: LookupTable): Auxiliary {
  const v = resolveVariableRef(model, idOrName);
  if (v.kind !== "auxiliary") {
    throw new ModelError(`"${v.name}" is a ${v.kind}; only an auxiliary can be a lookup table.`);
  }
  v.equation = lookupEquation(normalizeLookupTable(table));
  return v;
}

export interface SetLookupPointsInput {
  /** (input, output) pairs — replaces the whole curve. */
  points: LookupPoint[];
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
}

/** Point-list form of setLookupTable, for callers (the AI tool) that have pairs rather than a
 * table object. Keeps an existing lookup's axis limits unless new ones are given, so re-sending
 * just the points doesn't silently reset a deliberately-set graph range. */
export function setLookupPoints(model: Model, idOrName: string, input: SetLookupPointsInput): Auxiliary {
  const v = resolveVariableRef(model, idOrName);
  if (input.points.length === 0) throw new ModelError("A lookup table needs at least one point.");
  const existing = lookupTableOf(v, model);
  return setLookupTable(model, v.id, tableFromPoints(input.points, {
    xMin: input.xMin ?? existing?.xMin,
    xMax: input.xMax ?? existing?.xMax,
    yMin: input.yMin ?? existing?.yMin,
    yMax: input.yMax ?? existing?.yMax,
  }));
}
