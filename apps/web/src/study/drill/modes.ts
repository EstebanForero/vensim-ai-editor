// The drill table: what you can *practise*, as opposed to what you can ask.
//
// A mode (modes.ts, one level up) is a job for the agent — a system prompt and a tool list. A drill
// is a different shape entirely: a question whose answer the app already knows, and a marker that
// compares rather than judges. Forcing the two into one type would mean a discriminated union and a
// rewrite of the mode table's pinned assertions for no gain, so they are two tables: the panel
// renders one under "Ask" and the other under "Practise".
//
// Every drill here is read-only with respect to the model. Nothing in the drills can change what is
// on the canvas, which is what keeps the tab additive — the editor's own behaviour is not reachable
// from it.

import type { DrillSkill } from "@vensim-ai/core";

export interface Drill {
  id: string;
  /** Short name for the picker. */
  label: string;
  /** One line saying what it drills, shown with the label. */
  blurb: string;
  /** Which skills a sitting draws from. */
  skills: DrillSkill[];
  /** How many questions in a sitting. */
  count: number;
  /** Shown before the first question — in particular when there is nothing to ask about yet. */
  hint: string;
  /**
   * True when every question is about the model on the canvas, so an empty canvas means no
   * questions at all rather than fewer. That is what the panel offers to fix — by having the agent
   * build something to practise on, which is the one thing a learner cannot reasonably do for
   * themselves before they have learned it.
   */
  needsModel: boolean;
  /** True when the agent can be asked for a fresh *situation* to identify. Only the archetype
   * questions work that way: the app picks the archetype, so the answer stays exact. */
  canAskForSituation: boolean;
}

export const DRILLS: Drill[] = [
  {
    id: "identify-archetype",
    label: "Identify the archetype",
    blurb: "Read a situation and name the pattern.",
    skills: ["archetypes"],
    count: 6,
    hint: "You will get a short situation to read. Work out which archetype it is — no model needed, so this one works on an empty canvas.",
    needsModel: false,
    canAskForSituation: true,
  },
  {
    id: "read-the-loops",
    label: "Read the loops",
    blurb: "How many, which way, and what is in each one.",
    skills: ["loops"],
    count: 6,
    hint: "Questions about the feedback loops in the model on the canvas.",
    needsModel: true,
    canAskForSituation: false,
  },
  {
    id: "numbers-and-units",
    label: "Numbers and units",
    blurb: "What depends on what, what it runs to, and what is dimensionally wrong.",
    skills: ["equations"],
    count: 6,
    hint: "Questions about the model's equations and its run.",
    needsModel: true,
    canAskForSituation: false,
  },
  {
    id: "mixed-practice",
    label: "Mixed practice",
    blurb: "All of it, interleaved.",
    skills: ["loops", "equations", "archetypes"],
    count: 8,
    hint: "Questions from all three skills in turn. Interleaving them is deliberate — recognising which kind of question you are being asked is part of the skill.",
    needsModel: false,
    canAskForSituation: true,
  },
];

export const DEFAULT_DRILL = DRILLS[0]!;

export function findDrill(id: string): Drill {
  return DRILLS.find((d) => d.id === id) ?? DEFAULT_DRILL;
}
