// What a study mode *is*: a job to give the agent, and the rules for doing it.
//
// A mode is data, not code. Each one is a system prompt, a choice of which tools the turn may use,
// and a sentence or two about what the user is expected to bring — so adding one is a row in this
// table, and every mode gets the same panel, the same transcript and the same connection for free.
// The panel itself has no idea what any particular mode does.
//
// The tool policy is the part that carries real weight, and it is enforced rather than requested:
// a turn is only *offered* the tools in `tools`, so a mode that judges an answer cannot rewrite
// the model on its way to judging it, whatever it decides to do. Asking a model not to edit
// something is a hope; not giving it the tool is a guarantee.

import { NEUTRAL_TOOLS, type NeutralTool } from "@vensim-ai/agent";

/**
 * Every tool that *changes* the model, by name. Everything else is read-only by construction —
 * `list_model`, `run_simulation`, `check_units`, `list_loops`, `run_python` all look and report.
 *
 * Declared as the mutating set rather than the safe one because the failure modes are not
 * symmetric: a new read-only tool accidentally missing from a whitelist is a small loss, while a
 * new tool that edits the model accidentally landing in a "judge this model" mode's tool list is
 * the one thing this file exists to prevent. The test alongside asserts that every tool the agent
 * has appears in exactly one of these two sets, so a tool added to `@vensim-ai/tools` cannot slip
 * in unclassified.
 */
export const MUTATING_TOOL_NAMES = new Set([
  "add_stock",
  "add_flow",
  "add_auxiliary",
  "add_constant",
  "set_lookup",
  "set_equation",
  "rename_variable",
  "move_element",
  "delete_element",
  "clear_model",
  "add_relation",
  "set_relation_polarity",
  "refresh_relation_polarities",
  "add_comment",
  "set_comment_text",
  "move_comment",
  "set_sim_spec",
  "auto_layout",
  "annotate_loops",
]);

/** Reading a model: look at it, run it, measure it, and say things about it. Nothing here can
 * change it, which is what makes these safe to point at the model the user is working on. */
export const READ_ONLY_TOOLS: NeutralTool[] = NEUTRAL_TOOLS.filter((t) => !MUTATING_TOOL_NAMES.has(t.name));

/** Reading and writing both — for the modes whose whole point is to produce a model. */
export const EDITING_TOOLS: NeutralTool[] = NEUTRAL_TOOLS;

/** Where a mode's subject comes from. */
export type ModeInput =
  /** The user pastes a situation, a scenario, an exercise, a set of requirements. */
  | "context"
  /** The model on the canvas is the subject. */
  | "model"
  /** Both: a pasted situation, judged against — or turned into — the model on the canvas. */
  | "context+model"
  /** Nothing: the agent is asked to produce the exercise itself. */
  | "none";

export interface StudyMode {
  id: string;
  /** Short name for the picker. */
  label: string;
  /** One line saying what it does, shown with the label. */
  blurb: string;
  input: ModeInput;
  /** Whether a turn may change the model. Kept beside `tools` so the two can't disagree — a test
   * asserts they don't. */
  writes: boolean;
  tools: NeutralTool[];
  /** Placeholder for the context box, in this mode's own voice. */
  placeholder?: string;
  /** Appended to the shared preamble. This is the mode. */
  system: string;
  /** Shown before the first turn, so the panel is never a blank box with no idea what to ask. */
  starters: string[];
}

/**
 * The shared preamble every mode's system prompt is built on. The editing agent's prompt is about
 * *changing* a model; these are about teaching with one, so they share only what is true of both:
 * what the tools are, that the model on the canvas is the real one, and that a claim about
 * behaviour should be checked by running it rather than asserted.
 */
const PREAMBLE = `You are helping someone learn system dynamics, working alongside a Vensim-style
stock-and-flow editor. The model on the canvas is a real model you can read with list_model, run
with run_simulation, and measure with run_python — do that rather than reasoning about what the
equations would do if you ran them.

Keep equations in Vensim syntax ("Population * Birth rate", "IF THEN ELSE(x > 10, 1, 0)"). Time is
the built-in clock and is already available in any equation. A stock accumulates through flows;
an auxiliary is a computed variable; a relation is a signed causal arrow, and its polarity is what
makes a loop reinforcing or balancing.

Be concrete and brief. When you are checking something, say what you checked and what it showed,
the way you would show your working — a claim about a model's behaviour that you did not simulate
is a guess, and should be labelled as one.`;

/**
 * A mode's system prompt: the shared preamble, the mode's own instructions, and — for a mode that
 * cannot edit — a line saying so.
 *
 * The last part is generated rather than written into each mode's text, because it has to be true
 * of every read-only mode and the tool list is what makes it true. A model that knows it cannot
 * change anything reports what it found; one that doesn't spends the turn offering to.
 */
export function systemPromptFor(mode: StudyMode): string {
  const cannotEdit = mode.writes
    ? ""
    : `

This turn you have no tools that change the model — you can read it, run it and measure it, and
that is all. Report what you find and what you would change; the user makes the changes. Do not
promise to fix anything, and do not describe an edit as if you had made it.`;
  return `${PREAMBLE}\n\n${mode.system}${cannotEdit}`;
}

export const MODES: StudyMode[] = [
  {
    id: "build-from-context",
    label: "Build a model",
    blurb: "Describe a situation; get it as stocks, flows and loops.",
    input: "context",
    writes: true,
    tools: EDITING_TOOLS,
    placeholder: "e.g. A clinic where patients queue for a single doctor. Arrivals rise in winter…",
    starters: ["Build the model for this, then run it and tell me what it settles at."],
    system: `Your job this turn is to build a model from a written description, using the tools.
Work out what accumulates and what drives it, add the stocks, flows and auxiliaries, connect the
relations so the feedback structure is visible, then run it and report what it does. If the
description is ambiguous, choose the reading that makes the model work and say which reading you
took — a stated assumption is useful, a question back is not.`,
  },
  {
    id: "equations-from-context",
    label: "Write the equations",
    blurb: "Describe how parts relate; get the equations.",
    input: "context",
    writes: true,
    tools: EDITING_TOOLS,
    placeholder: "e.g. Demand falls as price rises, and restocking takes two weeks…",
    starters: ["Add these relationships to the model as equations."],
    system: `Your job this turn is to turn described relationships into equations. Use set_equation
for variables that already exist and add the ones that don't, keeping names in the vocabulary of
the description. Give every rate the units its own words imply, and check them afterwards. Where
the description implies a delay or a nonlinearity (a capacity, a saturation, a threshold), write
it as one rather than smoothing it into a straight line.`,
  },
  {
    id: "is-it-right",
    label: "Is the model right?",
    blurb: "Check the model against a description of what it should be.",
    input: "context+model",
    writes: false,
    tools: READ_ONLY_TOOLS,
    placeholder: "e.g. The model should show the backlog shrinking once capacity exceeds arrivals…",
    starters: ["Does the model on the canvas match this description? Say what doesn't."],
    system: `Your job this turn is to judge the model on the canvas against the user's description
of what it should be. Read the model, run it, and check the described behaviour against what
actually happens — the result of a run, not the shape of the equations. For each part of the
description: hold, does not hold, or is not represented at all. Be specific about which variable
and which number is wrong, and do not fix anything: this mode cannot edit the model, and the user
is the one who should decide what to change.`,
  },
  {
    id: "find-errors",
    label: "Find the mistakes",
    blurb: "Hunt down wrong equations, signs and units.",
    input: "model",
    writes: false,
    tools: READ_ONLY_TOOLS,
    placeholder: "Optional: what should it be doing? e.g. the population should level off, not collapse",
    starters: ["Look through this model and find anything that is wrong."],
    system: `Your job this turn is to find what is wrong with the model on the canvas. Work through
the equations the way a marker would: signs that point the wrong way, flows that drain something
they shouldn't, rates with the wrong units or the wrong denominator, accumulations that can go
negative, a MIN or MAX that is guarding the wrong thing, a loop whose polarity is not what its
name claims. Check units, then run it, then measure the behaviour — an equation can be perfectly
well-formed and still wrong, and only the run shows that. Report each finding with the variable it
is in, what is wrong, and how you know; rank them by how much they matter. Do not repair anything
— this mode cannot edit the model.`,
  },
  {
    id: "name-the-archetype",
    label: "Which archetype?",
    blurb: "Recognize the pattern from its structure or its story.",
    input: "context+model",
    writes: false,
    tools: READ_ONLY_TOOLS,
    placeholder: "e.g. Two teams competing for the same budget, where the bigger team keeps getting more of it…",
    starters: ["What archetype is this? Explain why, and what it implies."],
    system: `Your job this turn is to say which system-dynamics archetype the situation or the
model on the canvas is an instance of — Limits to Growth, Tragedy of the Commons, Escalation,
Success to the Successful, Fixes that Fail, Shifting the Burden, Eroding Goals — or that it is not
one of them, which is a real answer and should be given when it is true.

Name the loops that make it that archetype and say which of them is the one doing the damage. An
archetype is a claim about *structure*, so say what would have to be true of the model for the
pattern to be there, and check it against what list_model and list_loops actually report. If more
than one reading fits, say so and say what would tell them apart. Where the model is missing part
of the structure its name implies, that gap is the interesting part — point at it.`,
  },
  {
    id: "find-the-loops",
    label: "Find the loops",
    blurb: "Identify the feedback loops and what each one does.",
    input: "model",
    writes: false,
    tools: READ_ONLY_TOOLS,
    placeholder: "Optional: which loops do you think drive the behaviour?",
    starters: ["List the feedback loops in this model and explain each one."],
    system: `Your job this turn is to explain the feedback structure of the model on the canvas.
For each loop: its variables in order, whether it is reinforcing or balancing, and what it does to
the model's behaviour — which is a question about the run, so run it and point at what changes.
Separate the loops that explain the behaviour from the ones that merely exist: a model usually has
more loops than it has interesting ones, and saying which is which is the useful part. If the
relations are missing so that a loop the equations imply is not drawn, say so — the diagram and
the equations can disagree, and that is worth knowing.`,
  },
  {
    id: "make-an-exercise",
    label: "Give me an exercise",
    blurb: "Generate something to practise on — optionally with the answer.",
    input: "context",
    writes: true,
    tools: EDITING_TOOLS,
    placeholder: "e.g. something on delays, or a commons, at the level of a first course",
    starters: ["Give me an exercise on this, with a model to work on."],
    system: `Your job this turn is to set the user an exercise they can actually do in this editor,
and to build whatever it needs on the canvas.

Pick one thing to practise — reading a loop, finding a sign error, choosing what accumulates,
predicting what a run will do — and make the exercise turn on that. Then build the model it needs:
either a model with the fault they are looking for already in it, or a starting structure they are
to complete. Do not include the answer, and do not name the fault you planted: say what the model
is *for* and what they should work out, then stop. If they ask for the answer afterwards, give it,
with the reasoning.

For an exercise whose point is a fault, the fault has to be real and findable — a sign that makes
a loop balance when it should reinforce, a rate that cannot be sustained, a stock that runs
negative — not a missing unit label. Run the model and confirm the behaviour it produces is
actually wrong in the way you intend before you hand it over.`,
  },
];

export const DEFAULT_MODE = MODES[0]!;

export function findMode(id: string): StudyMode {
  return MODES.find((m) => m.id === id) ?? DEFAULT_MODE;
}
