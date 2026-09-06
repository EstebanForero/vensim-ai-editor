export type LoopPolarity = "R" | "B";
export type LoopDirection = "clockwise" | "counterclockwise";

export interface Loop {
  id: string;
  /** Variable ids around the cycle, in traversal order (not repeating the start at the end). */
  nodeIds: string[];
  /** R (Reinforcing) if the loop has an even number of "-" relations, B (Balancing) if odd. */
  polarity: LoopPolarity;
  /** Visual rotation of the loop, computed from node diagram positions (screen/canvas coordinates, y-down). */
  direction: LoopDirection;
  /** Centroid of the loop's node positions — where to place the R/B badge. */
  centroid: { x: number; y: number };
  /** 1-based ordinal *within this polarity* (R1, R2, B1, B2, ...), assigned in the same stable
   * order `detectLoops` already returns loops in — so `${polarity}${number}` is a per-model
   * loop label that stays consistent across the canvas badge, exported annotations, and the
   * `list_loops`/`annotate_loops` AI tools, the same way Vensim modelers number loops by hand. */
  number: number;
}

export interface DetectLoopsOptions {
  /** Longest cycle (in nodes) to search for. Larger values cost more to compute. Default 8. */
  maxLength?: number;
  /** Stop searching once this many cycles have been found. Default 60. */
  maxCycles?: number;
  /** How many loops to return, shortest first. Default 24. */
  limit?: number;
}
