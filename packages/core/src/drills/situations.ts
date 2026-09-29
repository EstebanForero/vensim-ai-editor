// What the study materials cover, and the situations they are recognised from.
//
// Four archetypes, not the seven the detector knows. These are the ones the course this tab
// accompanies teaches, and a drill that offered the other three as options would spend a learner's
// attention on vocabulary they are not being examined on. The detector keeps all seven — the
// Archetypes dialog reports against the full set, and that is a different question from which ones
// you are being asked to recognise.
//
// Recognition needs something to recognise, which is the gap this file fills: the "Which
// archetype?" mode answered a question about *the model on the canvas*, so it had no situation to
// show and nothing at all to say on an empty canvas.
//
// Each archetype carries its `tell` — the one structural feature that separates it from its nearest
// neighbour, which is the thing being practised and the thing a reader gets wrong:
//
//   - Limits to Growth vs Escalation — does the constraint tighten as it grows, or is the other
//     side reacting?
//   - Shifting the Burden vs Fixes that Fail — is the second loop *slow* (the deeper solution going
//     unattended), or is it the quick fix's own side effect coming back?
//   - Eroding Goals vs Shifting the Burden — is what is being given up a *standard* that can be
//     written down, or a capacity that has to be rebuilt?
//   - Tragedy of the Commons vs Success to the Successful — do the users draw the shared resource
//     *down*, or split one allocation between them?
//
// The situations are written to turn on that feature and nothing else. None names its archetype,
// none uses the words "reinforcing"/"balancing", and a test enforces both — a situation that gives
// itself away is a vocabulary test wearing a recognition test's clothes.

import type { ArchetypeId } from "../archetypes/types.js";

export interface StudyArchetype {
  id: ArchetypeId;
  /** How to spot it: the discriminating feature, shown after a wrong answer. */
  tell: string;
}

/**
 * The archetypes the study tab teaches, in the order the options are offered. Declaration order is
 * the only ordering — a separate list to keep in step is what a previous module got wrong.
 */
export const STUDY_ARCHETYPES = [
  {
    id: "limits-to-growth",
    tell:
      "Effort keeps going in and the result stops improving. The signature is a reinforcing loop whose own success tightens a constraint — a capacity, a resource, a scarce expert — until a balancing loop takes over and the growth levels off.",
  },
  {
    id: "shifting-the-burden",
    tell:
      "Two ways out of the same problem, and the quick one is the one being used. The signature is a fast fix that relieves the symptom while a slower, more fundamental path goes unattended — and the quick fix erodes the very capacity the slow one needs.",
  },
  {
    id: "tragedy-of-the-commons",
    tell:
      "Many actors, one shared resource, and every actor's own draw is individually reasonable. The signature is several reinforcing loops each benefiting one user, all drawing on a single stock that runs down — so no one actor is the cause.",
  },
  {
    id: "eroding-goals",
    tell:
      "The target is itself a level, so the gap between it and the result can be closed from either end. The signature is a standard that gets written down rather than met: nothing fails, and the goal ends up where the results already were.",
  },
] as const satisfies readonly StudyArchetype[];

export type StudyArchetypeId = (typeof STUDY_ARCHETYPES)[number]["id"];

export function isStudyArchetype(id: string): id is StudyArchetypeId {
  return STUDY_ARCHETYPES.some((a) => a.id === id);
}

export function studyArchetype(id: ArchetypeId): StudyArchetype | undefined {
  return STUDY_ARCHETYPES.find((a) => a.id === id);
}

export interface Situation {
  /** Stable, so a question built from it keeps its id across sessions. */
  id: string;
  archetype: StudyArchetypeId;
  text: string;
}

export const SITUATIONS: readonly Situation[] = [
  {
    id: "limits-hiring",
    archetype: "limits-to-growth",
    text:
      "A startup's customer base doubles every few months, and it can hire engineers just as fast — " +
      "until every new engineer needs onboarding from the same handful of senior people, who now " +
      "spend their whole week onboarding. Growth slows to a crawl even though demand has not.",
  },
  {
    id: "limits-service",
    archetype: "limits-to-growth",
    text:
      "A service desk adds staff as tickets rise, and for a while the queue falls. Then every new " +
      "person needs mentoring from the same two people who are also handling escalations, and the " +
      "queue stops responding to hiring at all.",
  },
  {
    id: "burden-contractor",
    archetype: "shifting-the-burden",
    text:
      "A department's recurring backlog is cleared every sprint by bringing in a contractor. The " +
      "contractor is expensive, so the tooling that would stop the backlog recurring never gets " +
      "funded — and the backlog is now a permanent line in the budget.",
  },
  {
    id: "burden-painkiller",
    archetype: "shifting-the-burden",
    text:
      "Someone with a chronic knee problem takes a painkiller whenever it aches. The pain recedes, so " +
      "the physiotherapy that would actually fix the knee keeps being postponed, and the knee gets " +
      "weaker — so the painkiller is needed more often.",
  },
  {
    id: "commons-fishery",
    archetype: "tragedy-of-the-commons",
    text:
      "Three fishing crews share one bay. Each adds a boat whenever the catch looks good, and each " +
      "reasons that one more boat out of three is barely worth worrying about. The bay is fished out.",
  },
  {
    id: "commons-platform",
    archetype: "tragedy-of-the-commons",
    text:
      "Every product team draws on one platform team for infrastructure work. Each request is small " +
      "and each is individually reasonable, so nobody refuses one — and the platform team's backlog " +
      "has not shrunk in two years.",
  },
  {
    id: "goals-response-time",
    archetype: "eroding-goals",
    text:
      "A support team's target is a four-hour first response. As volumes rise the target is revised to " +
      "eight hours, then twenty-four — each revision is easier to agree than hiring, and nobody has " +
      "done anything wrong.",
  },
  {
    id: "goals-attendance",
    archetype: "eroding-goals",
    text:
      "A school's target is 90% attendance. Attendance slips to 85%, and rather than tackle the causes " +
      "the target is quietly restated as 85% to match — and next year the same thing happens from 85%.",
  },
];

/** Every situation for one archetype — used by the tests to check each has one, and by nothing
 * else: the questions are built from the whole list. */
export function situationsFor(archetype: ArchetypeId): Situation[] {
  return SITUATIONS.filter((s) => s.archetype === archetype);
}

/**
 * One archetype to be asked about, avoiding `avoid` where there is a choice — so asking for a fresh
 * situation twice running does not serve the same pattern twice, which is the one thing a second
 * request was certainly not asking for.
 *
 * `random` is a parameter so the choice is testable; nothing else in here is.
 */
export function pickStudyArchetype(random: () => number = Math.random, avoid?: ArchetypeId): StudyArchetypeId {
  const candidates = STUDY_ARCHETYPES.filter((a) => a.id !== avoid);
  const pool = candidates.length > 0 ? candidates : STUDY_ARCHETYPES;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!.id;
}
