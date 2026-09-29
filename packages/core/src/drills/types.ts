// What a drill is.
//
// The Study tab's modes all *answer*. Ask "which archetype?" and the agent names it; ask "find the
// loops" and it lists them. Reading an expert's recognition is not practice at recognition, and the
// mode with the biggest gap had nothing to work from at all — it answered a question about the
// model on the canvas, so on an empty canvas it had nothing, and it never showed a situation to
// recognise in the first place.
//
// The app already knows the answers. `detectLoops`, `detectArchetypes`, `checkUnits` and
// `simulate` are ground truth, and `verifyArchetypeExample` guarantees the archetype examples
// really behave like their own archetype. A drill is the other half: a question whose answer is
// known by construction and marked by the app rather than judged, so the loop can be
// ask → answer → mark → explain → next with nothing in it that can mark its own work.

import type { ArchetypeId } from "../archetypes/types.js";

/** What a drill practises. */
export type DrillSkill = "loops" | "equations" | "archetypes";

/**
 * How an answer is given, and therefore how it is marked.
 *
 * `choice` and `numeric` are what make exact marking possible at all — the app decides
 * right or wrong and nothing else gets a vote. `short` is free text marked against a list of
 * accepted spellings, which is still exact, just more forgiving about how it was typed.
 */
export type DrillKind = "choice" | "numeric" | "short";

export interface DrillQuestion {
  id: string;
  skill: DrillSkill;
  /** The question, phrased the way an exam would put it. */
  prompt: string;
  kind: DrillKind;
  /**
   * The situation to read, when the question is about recognising a pattern rather than about the
   * model on the canvas. This is the part the "Which archetype?" mode never had: recognition needs
   * something to recognise.
   */
  situation?: string;
  /** The choices, for `choice`. Rendered in this order so a mark is reproducible. */
  options?: string[];
  /** The canonical answer. */
  answer: string;
  /**
   * Other spellings counted correct. A generator that listed one here without also accepting its
   * own `answer` would silently mark right answers wrong, which is why the test submits both.
   */
  accept?: string[];
  /** Absolute tolerance, for `numeric`. */
  tolerance?: number;
  /**
   * For a `short` answer that is a set of things — a loop's members, a variable's dependencies —
   * where the order carries no meaning and any ordering is the same answer. Compared as a set
   * rather than as a string.
   */
  unordered?: boolean;
  /** Why that is the answer, in the terms the analyser used. Shown after marking. */
  explanation: string;
  /**
   * Which analyser produced the answer — `detectLoops`, `detectArchetypes`, `checkUnits`,
   * `simulate`, `fileIO`… Nothing in this folder invents one. Without this a wrong mark would be
   * a string somebody typed that nobody can trace back to anything.
   */
  source: string;
  /** The archetype this question is about, when there is one. */
  archetype?: ArchetypeId;
}

export interface Verdict {
  correct: boolean;
  /** What the app expected, so a wrong answer can show it. */
  expected: string;
  /** What was given, as typed. */
  given: string;
}
