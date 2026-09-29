// A situation, for a question that asks which pattern it is.
//
// Recognition needs something to recognise. The "Which archetype?" mode had nothing: it answered a
// question about *the model on the canvas*, so it had no situation to show and nothing to say on an
// empty canvas. These are the missing half — a short scenario in plain prose, and the archetype it
// is an instance of.
//
// Each is written to turn on the one structural feature that separates its archetype from its
// nearest neighbour, because that is the thing being practised and the thing a reader gets wrong:
//
//   - Limits to Growth vs Escalation — does the constraint tighten as it grows, or is the other
//     side reacting?
//   - Shifting the Burden vs Fixes that Fail — is the second loop *slow* (the deeper solution
//     going unattended), or is it the fix's own side effect coming back?
//   - Eroding Goals vs Shifting the Burden — is the thing being given up a *standard* that can be
//     written down, or a capacity that has to be rebuilt?
//   - Tragedy of the Commons vs Success to the Successful — do the users draw the shared resource
//     *down*, or split one allocation between them?
//
// None names its archetype, its loops, or the words "reinforcing"/"balancing": the question is
// about the pattern, not the vocabulary. Each is also deliberately winnable from the situation
// alone, since the drill has no model to show.

import type { ArchetypeId } from "../archetypes/types.js";

export interface Situation {
  /** Stable, so a question built from it keeps its id across sessions. */
  id: string;
  archetype: ArchetypeId;
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
    id: "limits-bakery",
    archetype: "limits-to-growth",
    text:
      "A popular bakery's sales grow steadily, so it keeps adding ovens. There is still only one baker " +
      "who knows the recipes, and the queue at the counter now grows faster than the ovens can be filled.",
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
    id: "escalation-prices",
    archetype: "escalation",
    text:
      "Two rival firms keep cutting prices to take share. Each cut is answered within the week, and " +
      "neither ends up with more share than it started with — only thinner margins on both sides.",
  },
  {
    id: "escalation-arms",
    archetype: "escalation",
    text:
      "Two neighbours each install a taller fence for privacy. Each one's fence makes the other feel " +
      "overlooked, so the other adds another metre, and both gardens end up in permanent shade.",
  },
  {
    id: "success-marketing",
    archetype: "success-to-the-successful",
    text:
      "A company splits its marketing budget between two products according to which sold better last " +
      "quarter. One product is now funded out of existence while the other starves for lack of " +
      "attention, and nobody can say which one was the better idea.",
  },
  {
    id: "success-technicians",
    archetype: "success-to-the-successful",
    text:
      "Two research groups share one pool of technician time, allocated by last year's publication " +
      "count. The group that published more last year gets the technicians this year, so it publishes " +
      "more again.",
  },
  {
    id: "fixes-review",
    archetype: "fixes-that-fail",
    text:
      "A team under deadline pressure starts skipping code review to ship faster, and it does ship " +
      "faster. The defects that slip through come back as urgent fixes, which eat exactly the time " +
      "review would have taken — and the deadline pressure is now worse.",
  },
  {
    id: "fixes-road",
    archetype: "fixes-that-fail",
    text:
      "A city widens the ring road to clear congestion, and journey times improve. More people drive " +
      "because the journey is easier, and within three years the traffic is worse than it was before " +
      "the road was widened.",
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

/** Every situation for one archetype — used by the tests to check each archetype has one. */
export function situationsFor(archetype: ArchetypeId): Situation[] {
  return SITUATIONS.filter((s) => s.archetype === archetype);
}
