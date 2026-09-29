import { describe, expect, test } from "bun:test";
import { ARCHETYPES, detectArchetypes } from "../src/archetypes/registry.js";
import { buildArchetypeExample } from "../src/archetypes/examples.js";
import { generateQuestions, gradeAnswer, plantFault, SITUATIONS, situationsFor, type DrillQuestion } from "../src/drills/index.js";
import { detectLoops } from "../src/loops/detect.js";
import { addFlow, addStock } from "../src/model/builder/index.js";
import { createEmptyModel } from "../src/model/types.js";
import { simulate } from "../src/sim/engine.js";

/**
 * The drills exist so that a mark is a comparison rather than a judgement, and nearly every test
 * here is some version of that claim breaking: a generator whose accepted spellings disagree with
 * its own answer, a question whose answer the analyser it names would not give, a planted fault
 * that changes nothing.
 */

/** Every kind of model a sitting can start from, including the empty one. */
function fixtures() {
  return [
    buildArchetypeExample("tragedy-of-the-commons"),
    buildArchetypeExample("limits-to-growth"),
    buildArchetypeExample("eroding-goals"),
    createEmptyModel("Empty"),
  ];
}

const question = (over: Partial<DrillQuestion> & Pick<DrillQuestion, "kind" | "answer">): DrillQuestion => ({
  id: "q",
  skill: "equations",
  prompt: "?",
  source: "test",
  explanation: "-",
  ...over,
});

describe("marking", () => {
  // The invariant everything else rests on. If a generator lists an accepted spelling its own
  // `answer` does not match — or marks its canonical answer wrong — the drill silently marks right
  // answers wrong, which is worse than having no drill at all.
  test("every generated question marks its own answer, and each of its accepted spellings, correct", () => {
    for (const model of fixtures()) {
      const bad: string[] = [];
      for (const q of generateQuestions(model)) {
        if (!gradeAnswer(q, q.answer).correct) bad.push(q.id);
        for (const alt of q.accept ?? []) if (!gradeAnswer(q, alt).correct) bad.push(`${q.id} (accept: ${alt})`);
      }
      expect(bad).toEqual([]);
    }
  });

  test("a wrong answer is not accepted", () => {
    const q = question({ kind: "choice", answer: "Reinforcing", accept: ["R"], options: ["Reinforcing", "Balancing"] });
    expect(gradeAnswer(q, "Balancing").correct).toBe(false);
  });

  test("case, surrounding space and one trailing full stop are not the answer", () => {
    const q = question({ kind: "short", answer: "Reinforcing" });
    expect(gradeAnswer(q, "  reinforcing. ").correct).toBe(true);
    // But nothing more forgiving than that: a different word is a different answer.
    expect(gradeAnswer(q, "reinforcin").correct).toBe(false);
  });

  test("a quoted name is the same answer as the bare one", () => {
    const q = question({ kind: "short", answer: "Interest Earned" });
    expect(gradeAnswer(q, '"Interest Earned"').correct).toBe(true);
  });

  test("a set-shaped answer is the same answer in any order, and a different set is not", () => {
    const q = question({ kind: "short", unordered: true, answer: "Demand, Price" });
    expect(gradeAnswer(q, "price, demand").correct).toBe(true);
    expect(gradeAnswer(q, "Price\nDemand").correct).toBe(true);
    expect(gradeAnswer(q, "Price").correct).toBe(false);
    expect(gradeAnswer(q, "Price, Demand, Supply").correct).toBe(false);
  });

  test("a numeric answer is accepted inside its tolerance and refused outside it", () => {
    const q = question({ kind: "numeric", answer: "100", tolerance: 2 });
    expect(gradeAnswer(q, "98").correct).toBe(true);
    expect(gradeAnswer(q, "102").correct).toBe(true);
    expect(gradeAnswer(q, "102.5").correct).toBe(false);
    // An empty box must not read as a confident guess at zero, which is what `Number("")` is.
    expect(gradeAnswer(question({ kind: "numeric", answer: "0" }), "").correct).toBe(false);
  });

  test("every question says which analyser its answer came from, and why it is the answer", () => {
    for (const model of fixtures()) {
      for (const q of generateQuestions(model)) {
        expect({ id: q.id, source: q.source.length > 0, explanation: q.explanation.length > 0 }).toEqual({
          id: q.id,
          source: true,
          explanation: true,
        });
      }
    }
  });
});

describe("the questions a model produces", () => {
  test("the loop questions agree with detectLoops", () => {
    const model = buildArchetypeExample("tragedy-of-the-commons");
    const loops = detectLoops(model);
    const questions = generateQuestions(model, { skills: ["loops"] });

    expect(questions.find((q) => q.id === "loops:count")!.answer).toBe(String(loops.length));
    for (const loop of loops) {
      const label = `${loop.polarity}${loop.number}`;
      const polarity = questions.find((q) => q.id === `loops:polarity:${label}`)!;
      const direction = questions.find((q) => q.id === `loops:direction:${label}`)!;
      expect(polarity.answer).toBe(loop.polarity === "R" ? "Reinforcing" : "Balancing");
      expect(direction.answer).toBe(loop.direction === "clockwise" ? "Clockwise" : "Counter-clockwise");
    }
  });

  test("a model with no loops gets no loop questions rather than an empty one", () => {
    expect(generateQuestions(createEmptyModel("Empty"), { skills: ["loops"] })).toEqual([]);
  });

  // Asked only where it has one right answer. `detectArchetypes` reports candidates by design, and
  // most real models match several — asking anyway would mark a correct reading wrong.
  test("the question about a model's archetype is asked only when the structure is unambiguous", () => {
    for (const model of fixtures()) {
      const matched = [...new Set(detectArchetypes(model).map((m) => m.archetype))];
      const q = generateQuestions(model, { skills: ["archetypes"] }).find((x) => x.id === "archetypes:model");
      if (matched.length === 1) {
        // The answer is the label the analyser itself reports, not one written here.
        expect({ id: model.name, answer: q?.answer, source: q?.source }).toEqual({
          id: model.name,
          answer: ARCHETYPES.find((a) => a.id === matched[0])!.label,
          source: "detectArchetypes",
        });
      } else {
        expect({ id: model.name, asked: q !== undefined }).toEqual({ id: model.name, asked: false });
      }
    }
  });

  test("a model that matches exactly one archetype does produce that question", () => {
    // The escalation example is one of the three whose structure is unambiguous — without this the
    // rule above would pass by never asking anything at all.
    const matched = [...new Set(detectArchetypes(buildArchetypeExample("escalation")).map((m) => m.archetype))];
    expect(matched).toEqual(["escalation"]);
    const q = generateQuestions(buildArchetypeExample("escalation"), { skills: ["archetypes"] }).find(
      (x) => x.id === "archetypes:model",
    );
    expect(q?.answer).toBe("Escalation");
  });

  test("a sitting mixes the skills instead of blocking them", () => {
    const model = buildArchetypeExample("limits-to-growth");
    const skills = generateQuestions(model, { skills: ["loops", "archetypes"] })
      .slice(0, 4)
      .map((q) => q.skill);
    expect(new Set(skills).size).toBeGreaterThan(1);
  });

  test("a different seed starts the sitting somewhere else", () => {
    const model = buildArchetypeExample("tragedy-of-the-commons");
    const a = generateQuestions(model, { skills: ["loops"], seed: 0 }).map((q) => q.id);
    const b = generateQuestions(model, { skills: ["loops"], seed: 1 }).map((q) => q.id);
    expect(a).not.toEqual(b);
    // …and the same seed twice is the same sitting, so nothing downstream has to be order-stable
    // by luck.
    expect(generateQuestions(model, { skills: ["loops"], seed: 1 }).map((q) => q.id)).toEqual(b);
  });
});

describe("the situations", () => {
  test("every archetype has one, so no archetype can be practised only by name", () => {
    const missing = ARCHETYPES.filter((a) => situationsFor(a.id).length === 0).map((a) => a.id);
    expect(missing).toEqual([]);
  });

  test("ids are unique", () => {
    const ids = SITUATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The whole value of a situation is that it describes the pattern rather than naming it. A
  // situation containing its own archetype's name, or the words that give away the loop's polarity,
  // is a vocabulary test wearing a recognition test's clothes.
  test("none of them gives away which archetype it is", () => {
    for (const situation of SITUATIONS) {
      const label = ARCHETYPES.find((a) => a.id === situation.archetype)!.label.toLowerCase();
      const text = situation.text.toLowerCase();
      expect({ id: situation.id, names: text.includes(label), polarities: /reinforc|balanc/.test(text) }).toEqual({
        id: situation.id,
        names: false,
        polarities: false,
      });
    }
  });

  // The one pool that does not need a model — which is what makes the drill usable on a cold start,
  // and is the gap that made "Which archetype?" useless on an empty canvas.
  test("an empty model still has a full sitting of situations to work through", () => {
    const questions = generateQuestions(createEmptyModel("Empty"));
    expect(questions.length).toBe(SITUATIONS.length);
    expect(questions.every((q) => q.kind === "choice" && q.situation && q.archetype)).toBe(true);
  });
});

describe("planting a fault", () => {
  test("changes exactly one flow, still runs, and actually changes the behaviour", () => {
    const base = buildArchetypeExample("limits-to-growth");
    const planted = plantFault(base, { seed: 0 });
    expect(planted).not.toBeNull();
    const { model, question: q } = planted!;

    // Nothing but the one flow's wiring moved.
    expect(model.stocks.map((s) => s.name)).toEqual(base.stocks.map((s) => s.name));
    expect(model.auxiliaries.map((a) => a.name)).toEqual(base.auxiliaries.map((a) => a.name));
    const rewired = model.flows.filter((f, i) => f.from !== base.flows[i]!.from || f.to !== base.flows[i]!.to);
    expect(rewired.map((f) => f.name)).toEqual([q.answer]);

    // A fault that leaves the run identical is not findable, and must never be handed over.
    const before = simulate(base);
    const after = simulate(model);
    expect(after.series).not.toEqual(before.series);
  });

  test("names the variable the fault is in, and says what changed", () => {
    const planted = plantFault(buildArchetypeExample("tragedy-of-the-commons"), { seed: 0 })!;
    expect(planted.question.source).toBe("plantFault");
    expect(planted.question.explanation).toContain(planted.question.answer);
    expect(planted.variableId).toBeTruthy();
  });

  test("every fault it will plant produces a model that still runs", () => {
    const base = buildArchetypeExample("limits-to-growth");
    // The candidates are tried in rotation; walk all of them and none may produce a broken model.
    const kinds = new Set<string>();
    for (let seed = 0; seed < 12; seed++) {
      const planted = plantFault(base, { seed });
      if (!planted) continue;
      kinds.add(planted.kind);
      expect(() => simulate(planted.model)).not.toThrow();
      expect(planted.question.answer).toBeTruthy();
    }
    expect(kinds.size).toBeGreaterThan(0);
  });

  test("a model with no flows admits no fault", () => {
    const model = createEmptyModel("Only a stock");
    addStock(model, { name: "Alone", initialEquation: "10" });
    expect(plantFault(model)).toBeNull();
  });

  test("a model that does not run has no fault planted in it", () => {
    const model = createEmptyModel("Broken");
    const stock = addStock(model, { name: "Balance", initialEquation: "10" });
    addFlow(model, { name: "Rate", equation: "Nowhere * 2", from: stock.id, to: null });
    expect(plantFault(model)).toBeNull();
  });
});
