import { ModelError } from "../model/errors.js";
import type { Model } from "../model/types.js";
import { layeredLayout } from "./layered.js";
import { structuredLayout } from "./structured.js";
import type { AutoLayoutOptions, LayoutAlgorithmId } from "./types.js";

export type { AutoLayoutOptions, LayoutAlgorithmId, LayoutDirection } from "./types.js";
export { outerAttachment, pipeRelationBend, pipeRelationSide } from "./pipeRelation.js";
export type { DiagramSide } from "./pipeRelation.js";

export interface LayoutAlgorithm {
  id: LayoutAlgorithmId;
  /** Short name for the toolbar and the tool schema. */
  label: string;
  /** What this algorithm optimizes for, in one sentence. */
  summary: string;
  arrange(model: Model, options: AutoLayoutOptions): void;
}

/**
 * The layouts a caller can ask for. `structured` is first because it is the default:
 * the stock-and-flow chain stays on one line. `layered` is the original dagre ranking.
 */
export const LAYOUT_ALGORITHMS: readonly LayoutAlgorithm[] = [
  {
    id: "structured",
    label: "Structured",
    summary: "Stocks and flows stay on one line, and the variables that feed a rate sit beside that rate.",
    arrange: structuredLayout,
  },
  {
    id: "layered",
    label: "Layered",
    summary: "One rank layout for every stock, flow, and variable, from the original dagre arrangement.",
    arrange: layeredLayout,
  },
];

const BY_ID = new Map(LAYOUT_ALGORITHMS.map((algorithm) => [algorithm.id, algorithm]));

/**
 * Re-position every stock, flow, and auxiliary. `options.algorithm` picks the layout;
 * omitting it runs `structured`. Loop annotations are put back on their loops, and
 * hand-written comments move to a column beside the diagram. Relation bends are replaced:
 * structured bows them off the stock-and-flow line, layered clears them.
 */
export function autoLayout(model: Model, options: AutoLayoutOptions = {}): void {
  const id = options.algorithm ?? "structured";
  const algorithm = BY_ID.get(id);
  if (!algorithm) {
    throw new ModelError(`Unknown layout "${id}". Use ${LAYOUT_ALGORITHMS.map((item) => item.id).join(" or ")}.`);
  }
  algorithm.arrange(model, options);
}
