export type LayoutDirection = "LR" | "TB";

/** `structured` keeps the stock-and-flow chain readable. `layered` is the original dagre ranking. */
export type LayoutAlgorithmId = "structured" | "layered";

export interface AutoLayoutOptions {
  /** "LR" (left-to-right, the default) or "TB" (top-to-bottom). */
  direction?: LayoutDirection;
  /** Gap between nodes that sit beside each other. */
  nodeSep?: number;
  /** Gap between a stock and the next stock along a flow. */
  rankSep?: number;
  /** Which layout to run. Defaults to `structured`. */
  algorithm?: LayoutAlgorithmId;
}
