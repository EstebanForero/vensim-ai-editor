// Turning a model into questions.
//
// Every answer here comes out of an analyser that already exists — `detectLoops`,
// `detectArchetypes`, `checkUnits`, `equationDependencies`, `simulate` — and every question records
// which one in its `source`. That is the whole reason a drill can be marked rather than judged, and
// it is also why nothing in this file may invent an answer: a question whose explanation is a
// sentence somebody wrote here would be unmarkable and un-auditable the moment the analyser
// changed.
//
// The pools are interleaved rather than run in blocks. Blocking by skill feels better and retains
// worse — reading four loop questions in a row after four loop questions is recognition of the
// exercise, not of the structure — so the default `skills` mixes all three.
//
// A model with nothing to ask about produces nothing, and that is a real answer rather than a
// failure: an empty model has no loops, no dependencies and no run. The archetype situations are
// the one pool that does not depend on the model at all, which is what makes the drill usable from
// a cold start.

import { ARCHETYPES, detectArchetypes } from "../archetypes/registry.js";
import type { ArchetypeId } from "../archetypes/types.js";
import { detectLoops } from "../loops/detect.js";
import type { Loop } from "../loops/types.js";
import { equationDependencies } from "../model/derived.js";
import { allVariables, findVariable, type Model, type Variable } from "../model/types.js";
import { checkUnits } from "../model/units.js";
import { simulate } from "../sim/engine.js";
import { isStudyArchetype, SITUATIONS, STUDY_ARCHETYPES, studyArchetype } from "./situations.js";
import type { DrillQuestion, DrillSkill } from "./types.js";

export interface GenerateOptions {
  /** Which skills to draw from. Default all three. */
  skills?: DrillSkill[];
  /**
   * Rotation offset, so a second sitting on the same model is not the same questions in the same
   * order. Deterministic for a given seed — a test can pin what it gets, and a session can vary it.
   */
  seed?: number;
  /** Most questions to produce, after interleaving. Default: everything. */
  count?: number;
}

export function generateQuestions(model: Model, options: GenerateOptions = {}): DrillQuestion[] {
  const skills = options.skills ?? (["loops", "equations", "archetypes"] as DrillSkill[]);
  const pools: DrillQuestion[][] = [];
  if (skills.includes("loops")) pools.push(loopQuestions(model));
  if (skills.includes("equations")) pools.push(equationQuestions(model));
  if (skills.includes("archetypes")) pools.push(archetypeQuestions(model));

  const rotated = pools.filter((p) => p.length > 0).map((p) => rotate(p, options.seed ?? 0));
  const all = interleave(rotated);
  return options.count === undefined ? all : all.slice(0, options.count);
}

/** Move the first `n` questions to the back. Deliberately not a shuffle: an order that changes
 * between two calls with the same seed would make every test that pins one flaky. */
function rotate(questions: DrillQuestion[], n: number): DrillQuestion[] {
  if (questions.length === 0) return questions;
  const k = ((n % questions.length) + questions.length) % questions.length;
  return [...questions.slice(k), ...questions.slice(0, k)];
}

/** One from each pool in turn, so a sitting mixes skills rather than blocking them. */
function interleave(pools: DrillQuestion[][]): DrillQuestion[] {
  const out: DrillQuestion[] = [];
  const longest = Math.max(0, ...pools.map((p) => p.length));
  for (let i = 0; i < longest; i++) {
    for (const pool of pools) {
      const q = pool[i];
      if (q) out.push(q);
    }
  }
  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function ownEquation(variable: Variable): string {
  return variable.kind === "stock" ? variable.initialEquation : variable.equation;
}

// ---------------------------------------------------------------------------------------------
// Loops

function loopQuestions(model: Model): DrillQuestion[] {
  const loops = detectLoops(model);
  if (loops.length === 0) return [];

  const label = (loop: Loop) => `${loop.polarity}${loop.number}`;
  const namesOf = (ids: string[]) => ids.map((id) => findVariable(model, id)?.name).filter((n): n is string => !!n);
  const out: DrillQuestion[] = [];

  out.push({
    id: "loops:count",
    skill: "loops",
    prompt: "How many feedback loops does this model have?",
    kind: "numeric",
    answer: String(loops.length),
    source: "detectLoops",
    explanation: `${loops.length} feedback loop${loops.length === 1 ? "" : "s"}: ${loops.map(label).join(", ")}.`,
  });

  for (const loop of loops) {
    const id = label(loop);
    const reinforcing = loop.polarity === "R";

    out.push({
      id: `loops:polarity:${id}`,
      skill: "loops",
      prompt: `Is ${id} reinforcing or balancing?`,
      kind: "choice",
      options: ["Reinforcing", "Balancing"],
      answer: reinforcing ? "Reinforcing" : "Balancing",
      accept: [loop.polarity],
      source: "detectLoops",
      explanation: `${id} has an ${reinforcing ? "even" : "odd"} number of negative links around it, so it ${
        reinforcing ? "compounds its own change — reinforcing" : "counteracts its own change — balancing"
      }.`,
    });

    const clockwise = loop.direction === "clockwise";
    out.push({
      id: `loops:direction:${id}`,
      skill: "loops",
      prompt: `Looking at the canvas, does ${id} run clockwise or counter-clockwise?`,
      kind: "choice",
      options: ["Clockwise", "Counter-clockwise"],
      answer: clockwise ? "Clockwise" : "Counter-clockwise",
      accept: [loop.direction],
      source: "detectLoops",
      explanation: `Computed from the drawn positions with the shoelace formula, ${id} runs ${loop.direction}.`,
    });

    const members = namesOf(loop.nodeIds);
    if (members.length >= 2) {
      out.push({
        id: `loops:members:${id}`,
        skill: "loops",
        prompt: `Which variables are in ${id}? Name them, separated by commas.`,
        kind: "short",
        unordered: true,
        answer: members.join(", "),
        source: "detectLoops",
        explanation: `${id} runs ${members.join(" → ")}.`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Equations

function equationQuestions(model: Model): DrillQuestion[] {
  return [...unitQuestions(model), ...dependencyQuestions(model), ...runQuestions(model)];
}

function unitQuestions(model: Model): DrillQuestion[] {
  const issues = checkUnits(model);
  if (issues.length === 0) return [];
  const names = [...new Set(issues.map((i) => i.variableName))];
  return [
    {
      id: "equations:units",
      skill: "equations",
      prompt:
        names.length === 1
          ? "One variable in this model has a units problem. Which one?"
          : "Name one variable in this model with a units problem.",
      kind: "short",
      answer: names[0]!,
      // Every flagged variable is a right answer — the question asks for one of them, and which
      // one is not the skill being practised.
      accept: names.slice(1),
      source: "checkUnits",
      explanation: issues.map((i) => `${i.variableName} — ${i.message}`).join("\n"),
    },
  ];
}

function dependencyQuestions(model: Model): DrillQuestion[] {
  const out: DrillQuestion[] = [];
  for (const variable of allVariables(model)) {
    if (out.length >= 4) break;
    const deps = equationDependencies(model, variable);
    if (deps.length === 0) continue;
    const names = deps.map((d) => d.name);
    out.push({
      id: `equations:depends:${variable.name}`,
      skill: "equations",
      prompt: `What does ${variable.name} depend on? Name them, separated by commas.`,
      kind: "short",
      unordered: true,
      answer: names.join(", "),
      source: "equationDependencies",
      explanation: `${variable.name} = ${ownEquation(variable)}, which reads ${names.join(", ")}.`,
    });
  }
  return out;
}

function runQuestions(model: Model): DrillQuestion[] {
  let sim;
  try {
    sim = simulate(model);
  } catch {
    // A model that will not run has no questions about its run. Not an error: it is exactly the
    // state a learner is most likely to be in, and the units and dependency questions still apply.
    return [];
  }
  const last = sim.time[sim.time.length - 1];
  if (last === undefined) return [];

  const out: DrillQuestion[] = [];
  for (const stock of model.stocks.slice(0, 3)) {
    const series = sim.series[stock.name];
    if (!series || series.length === 0) continue;

    const final = series[series.length - 1]!;
    if (Number.isFinite(final)) {
      // 2% of the value, or a small absolute floor when the value is near zero — a fixed absolute
      // tolerance would either be impossible on a large number or trivially loose on a small one.
      const tolerance = Math.max(Math.abs(final) * 0.02, 0.05);
      out.push({
        id: `equations:final:${stock.name}`,
        skill: "equations",
        prompt: `The model runs to t = ${round3(last)}. What does ${stock.name} reach by then? (Within 2%.)`,
        kind: "numeric",
        answer: String(round3(final)),
        tolerance,
        source: "simulate",
        explanation: `Running it gives ${stock.name} = ${round3(final)} at t = ${round3(last)}.`,
      });
    }

    let min = Infinity;
    for (const v of series) if (v < min) min = v;
    const goesNegative = min < 0;
    out.push({
      id: `equations:negative:${stock.name}`,
      skill: "equations",
      prompt: `Does ${stock.name} ever go negative during the run?`,
      kind: "choice",
      options: ["Yes", "No"],
      answer: goesNegative ? "Yes" : "No",
      accept: [goesNegative ? "y" : "n"],
      source: "simulate",
      explanation: `Over the run ${stock.name} moves from ${round3(series[0]!)} to ${round3(final)}, with a low of ${round3(min)}${
        goesNegative
          ? " — below zero, and nothing in the model prevents it: a stock that means a physical quantity usually needs a MIN, a MAX, or a rate that cannot drive it there."
          : " — never below zero."
      }`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Archetypes

/** The registry's label for an archetype — the one the Archetypes dialog shows, so a drill and a
 * report never use two names for the same thing. */
function labelOf(id: ArchetypeId): string | undefined {
  return ARCHETYPES.find((a) => a.id === id)?.label;
}

/** What the study material covers, as option labels, in the study table's own order. */
function studyLabels(): string[] {
  return STUDY_ARCHETYPES.map((a) => labelOf(a.id)).filter((l): l is string => !!l);
}

/** What it means, then how to spot it. The second half is what a wrong answer actually needs: the
 * meaning says what the pattern does, the tell says which of four similar-looking stories it is. */
function explanationFor(id: ArchetypeId): string {
  return [ARCHETYPES.find((a) => a.id === id)?.meaning, studyArchetype(id)?.tell].filter(Boolean).join("\n\n");
}

/**
 * The subtler half of giving the answer away: describing the *structure* rather than the story.
 * Someone told which loop reinforces has been handed the answer just as surely as someone told the
 * archetype's name, and both turn a recognition question into a vocabulary one. (The archetype's
 * name itself is checked separately, since it depends on which archetype was asked for.)
 *
 * Tuned to catch phrases that can only be about structure, because the failure is not symmetric.
 * Being too strict costs a fallback to a curated situation, which is fine; being too loose ships a
 * question that answers itself. So "reinforcing" — which has no other meaning in this material — is
 * caught bare, while "balancing" is caught only when it is actually naming a loop: "balance the
 * budget" is a sentence about a budget, and treating it as a tell made the agent's situations fail
 * on ordinary English. Nothing else catches `balancing force`, deliberately.
 */
const GIVEAWAY = /\breinforc|\bbalanc\w*\s+(loop|feedback)|\bfeedback loop|\bR\d\b|\bB\d\b|\barchetype\b/i;

/**
 * A situation question built from text somebody else wrote — the AI, in practice.
 *
 * Whoever commissions a situation picks the archetype, so the answer is known by construction and
 * the marking stays exact; only the prose is out of the app's hands. That is the one thing that can
 * still be wrong, so it is checked here rather than trusted: a situation that names its archetype,
 * or says which loop reinforces, is rejected and a curated one used in its place.
 *
 * Also null for an archetype outside the study set — the drills only ask about the four.
 */
export function situationQuestion(id: string, archetype: ArchetypeId, text: string): DrillQuestion | null {
  const body = text.trim();
  const answer = labelOf(archetype);
  if (!body || !answer || !isStudyArchetype(archetype)) return null;
  // Naming the archetype is the obvious way to give it away; describing its loops is the other.
  if (body.toLowerCase().includes(answer.toLowerCase()) || GIVEAWAY.test(body)) return null;
  return {
    id,
    skill: "archetypes",
    prompt: "Which archetype is this?",
    situation: body,
    kind: "choice",
    options: studyLabels(),
    answer,
    archetype,
    source: "ARCHETYPES",
    explanation: explanationFor(archetype),
  };
}

/**
 * The two routes to recognising a pattern: from the story, and from the structure.
 *
 * The situations need no model at all, which makes this the one skill that works on a cold start —
 * and it is the half the "Which archetype?" mode never had, because that mode's subject was the
 * model on the canvas and an empty canvas left it with nothing to say.
 */
function archetypeQuestions(model: Model): DrillQuestion[] {
  const out: DrillQuestion[] = [];

  for (const situation of SITUATIONS) {
    const q = situationQuestion(`archetypes:situation:${situation.id}`, situation.archetype, situation.text);
    if (q) out.push(q);
  }

  // From the model on the canvas — but only when its structure is unambiguous, and only for an
  // archetype the study material covers.
  //
  // `detectArchetypes` deliberately reports *candidates* rather than a verdict, and most models
  // match more than one (the commons example also matches Limits to Growth; Shifting the Burden
  // matches four). On those, "which archetype is this?" has several right answers, and marking one
  // of them would teach a reader to distrust a detector behaving exactly as designed.
  const matches = detectArchetypes(model);
  const matched = [...new Set(matches.map((m) => m.archetype))];
  const only = matched.length === 1 ? matched[0] : undefined;
  if (only && isStudyArchetype(only)) {
    const match = matches.find((m) => m.archetype === only)!;
    out.push({
      id: "archetypes:model",
      skill: "archetypes",
      prompt: "The model on the canvas matches one of these archetypes. Which one?",
      kind: "choice",
      options: studyLabels(),
      answer: match.label,
      archetype: only,
      source: "detectArchetypes",
      explanation: `${match.label} (${match.confidence}) — ${match.summary}`,
    });
  }

  return out;
}
