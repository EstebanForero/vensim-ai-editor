import { describe, expect, test } from "bun:test";
import { ARCHETYPES, buildArchetypeExample, detectArchetypes } from "../src/archetypes/index.js";
import type { ArchetypeId } from "../src/archetypes/types.js";
import { addAuxiliary, addConnector, addConstant, addFlow, addStock } from "../src/model/builder/index.js";
import { detectLoops } from "../src/loops/detect.js";
import { simulate } from "../src/sim/engine.js";
import { createEmptyModel, findVariableByName, type Model } from "../src/model/types.js";

/** The example with one variable's equation swapped out — the counterfactual an archetype's claim
 * is tested against. Stocks carry the value in `initialEquation`, everything else in `equation`. */
function without(model: Model, name: string, equation: string): Model {
  const copy = structuredClone(model);
  const v = findVariableByName(copy, name) as { equation?: string; initialEquation?: string } | undefined;
  if (!v) throw new Error(`no variable named ${name}`);
  if (v.initialEquation !== undefined) v.initialEquation = equation;
  else v.equation = equation;
  return copy;
}

/** The last value of a series, which is what nearly every claim about these examples is about. */
function endOf(model: Model, name: string): number {
  return simulate(model).series[name]!.at(-1)!;
}

/** Everything an archetype match reports about *why* it matched — the labels and names — with
 * the free-text summary left out, so these assertions stay about structure. */
function shape(matches: ReturnType<typeof detectArchetypes>) {
  return matches.map((m) => ({ archetype: m.archetype, confidence: m.confidence, loops: m.loopLabels, nodes: m.nodeNames }));
}

function matchesOf(matches: ReturnType<typeof detectArchetypes>, archetype: ArchetypeId) {
  return matches.filter((m) => m.archetype === archetype);
}

describe("detectArchetypes", () => {
  test("Limits to Growth: a reinforcing and a balancing loop on one stock", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Births", equation: "Population * 0.02", to: "Population", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Deaths", equation: "Population * 0.01", from: "Population", pos: { x: 100, y: 100 } });
    addConnector(model, { from: "Population", to: "Births" }); // "+"
    addConnector(model, { from: "Population", to: "Deaths" }); // "+"

    const matches = detectArchetypes(model);
    expect(shape(matches)).toEqual([
      { archetype: "limits-to-growth", confidence: "likely", loops: ["R1", "B1"], nodes: ["Population"] },
    ]);
    expect(matches[0]!.summary).toBe("R1 (reinforcing) and B1 (balancing) both act on the stock `Population`.");
  });

  // The loops share the stock *and* an intermediate variable, which is just as often one loop's
  // return path as a real constraint — reported, but not at the same confidence.
  test("Limits to Growth: downgraded when the loops share more than the stock", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Store", initialEquation: "10", pos: { x: 0, y: 0 } });
    addAuxiliary(model, { name: "Shared", equation: "Store", pos: { x: 50, y: 0 } });
    addFlow(model, { name: "In", equation: "Shared", to: "Store", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Out", equation: "Shared", from: "Store", pos: { x: 100, y: 50 } });
    addConnector(model, { from: "Store", to: "Shared" });
    addConnector(model, { from: "Shared", to: "In" });
    addConnector(model, { from: "Shared", to: "Out" });

    const [match] = matchesOf(detectArchetypes(model), "limits-to-growth");
    expect(match!.confidence).toBe("possible");
    expect(match!.nodeNames).toEqual(["Store"]);
  });

  test("Tragedy of the Commons: one stock drawn down by two flows in different loops", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Water", initialEquation: "1000", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Use A", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Use B", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 100 } });
    addConnector(model, { from: "Water", to: "Use A" });
    addConnector(model, { from: "Water", to: "Use B" });

    const matches = detectArchetypes(model);
    expect(shape(matches)).toEqual([
      {
        archetype: "tragedy-of-the-commons",
        confidence: "likely",
        loops: ["B1", "B2"],
        nodes: ["Water", "Use A", "Use B"],
      },
    ]);
    expect(matches[0]!.summary).toContain("`Water` is drawn down by 2 separate flows");
  });

  // A single loop that happens to drain one stock through two pipes is one actor emptying two
  // pipes, not competing users — the commons signature is *independent* drawdown paths.
  test("Tragedy of the Commons: not reported when one loop carries both outflows", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Water", initialEquation: "1000", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "P1", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "P2", equation: "Water * 0.1", from: "Water", pos: { x: 200, y: 0 } });
    addConnector(model, { from: "Water", to: "P1" });
    addConnector(model, { from: "P1", to: "P2" });

    // Confirm the premise: P1 has a loop of its own, P2 only ever appears alongside P1.
    const loops = detectLoops(model);
    expect(loops).toHaveLength(2);
    const [p1, p2] = model.flows;
    expect(loops.filter((l) => l.nodeIds.includes(p1!.id) && !l.nodeIds.includes(p2!.id))).toHaveLength(1);
    expect(loops.filter((l) => l.nodeIds.includes(p2!.id) && !l.nodeIds.includes(p1!.id))).toHaveLength(0);

    expect(matchesOf(detectArchetypes(model), "tragedy-of-the-commons")).toEqual([]);
  });

  test("Escalation: one reinforcing loop through two sides that feed each other", () => {
    const model = createEmptyModel();
    addStock(model, { name: "My Arms", initialEquation: "100", pos: { x: 0, y: 0 } });
    addStock(model, { name: "Their Arms", initialEquation: "100", pos: { x: 0, y: 100 } });
    addFlow(model, { name: "My Production", equation: "Their Arms * 0.1", to: "My Arms", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Their Production", equation: "My Arms * 0.1", to: "Their Arms", pos: { x: 100, y: 100 } });
    addConnector(model, { from: "Their Arms", to: "My Production" });
    addConnector(model, { from: "My Arms", to: "Their Production" });

    const matches = matchesOf(detectArchetypes(model), "escalation");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.confidence).toBe("likely");
    for (const label of matches[0]!.loopLabels) expect(detectLoops(model).map((l) => `${l.polarity}${l.number}`)).toContain(label);
    expect(matches[0]!.nodeNames.sort()).toEqual(["My Arms", "My Production", "Their Arms", "Their Production"]);
    expect(matches[0]!.summary).toContain("`My Arms`");
    expect(matches[0]!.summary).toContain("`Their Arms`");
  });

  // The shape the detector used to ask for, and the reason it was wrong: two reinforcing loops
  // each suppressing the other is a spiral one side wins, not a race neither can leave. This was
  // a passing escalation test until the example it was written against turned out to model
  // capitulation — the loser's production fell to zero, and switching it off made the winner
  // grow faster. Success to the Successful produces this shape too, which is the giveaway.
  test("Escalation: a dominance spiral is not a race", () => {
    const model = createEmptyModel();
    addStock(model, { name: "My Arms", initialEquation: "120", pos: { x: 0, y: 0 } });
    addStock(model, { name: "Their Arms", initialEquation: "100", pos: { x: 0, y: 100 } });
    addFlow(model, { name: "My Production", equation: "MAX(0, My Arms - Their Arms + 50) * Tasa", to: "My Arms", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Their Production", equation: "MAX(0, Their Arms - My Arms + 50) * Tasa", to: "Their Arms", pos: { x: 100, y: 100 } });
    addConstant(model, { name: "Tasa", value: 0.05, pos: { x: 200, y: 0 } });
    addConnector(model, { from: "My Arms", to: "My Production" });
    addConnector(model, { from: "Their Arms", to: "My Production", polarity: "-" });
    addConnector(model, { from: "Their Arms", to: "Their Production" });
    addConnector(model, { from: "My Arms", to: "Their Production", polarity: "-" });

    expect(matchesOf(detectArchetypes(model), "escalation")).toHaveLength(0);
  });

  test("Success to the Successful: two reinforcing loops fed by one allocation", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Allocation", equation: "Success A + Success B", pos: { x: 0, y: 0 } });
    addAuxiliary(model, { name: "Activity A", equation: "Allocation", pos: { x: 100, y: 0 } });
    addAuxiliary(model, { name: "Success A", equation: "Activity A", pos: { x: 200, y: 0 } });
    addAuxiliary(model, { name: "Activity B", equation: "Allocation", pos: { x: 100, y: 100 } });
    addAuxiliary(model, { name: "Success B", equation: "Activity B", pos: { x: 200, y: 100 } });
    addConnector(model, { from: "Allocation", to: "Activity A" });
    addConnector(model, { from: "Activity A", to: "Success A" });
    addConnector(model, { from: "Success A", to: "Allocation" });
    addConnector(model, { from: "Allocation", to: "Activity B" });
    addConnector(model, { from: "Activity B", to: "Success B" });
    addConnector(model, { from: "Success B", to: "Allocation" });

    const matches = detectArchetypes(model);
    expect(shape(matches)).toEqual([
      {
        archetype: "success-to-the-successful",
        confidence: "likely",
        loops: ["R1", "R2"],
        nodes: ["Allocation", "Activity A", "Success A", "Activity B", "Success B"],
      },
    ]);
    expect(matches[0]!.summary).toContain("both draw on `Allocation`");
  });

  // The minimal shape: problem and fix wired straight to each other, with the unintended
  // consequence riding on a third variable. The balancing loop has nothing of its own here, so
  // requiring a detour on both sides would miss exactly the case this archetype is drawn as.
  test("Fixes that Fail: a balancing and a reinforcing path between the same two variables", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Problem", equation: "Side Effect", pos: { x: 0, y: 0 } });
    addAuxiliary(model, { name: "Fix", equation: "Problem", pos: { x: 100, y: 0 } });
    addAuxiliary(model, { name: "Side Effect", equation: "Fix", pos: { x: 200, y: 0 } });
    addConnector(model, { from: "Problem", to: "Fix" });
    addConnector(model, { from: "Fix", to: "Problem", polarity: "-" });
    addConnector(model, { from: "Fix", to: "Side Effect" });
    addConnector(model, { from: "Side Effect", to: "Problem" });

    const matches = detectArchetypes(model);
    expect(shape(matches)).toEqual([
      { archetype: "fixes-that-fail", confidence: "likely", loops: ["B1", "R1"], nodes: ["Problem", "Fix"] },
    ]);
    // The bare balancing loop reads as a loop label, not "B1 via " with an empty detour.
    expect(matches[0]!.summary).toBe(
      "B1 (balancing) and R1 (reinforcing) are two different paths between `Problem`, `Fix` — B1, R1 via `Side Effect`.",
    );
  });

  test("no loops, no matches", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Alone", initialEquation: "1", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Tap", equation: "1", from: "Alone", pos: { x: 100, y: 0 } });
    expect(detectArchetypes(model)).toEqual([]);
  });

  test("an empty model reports nothing rather than throwing", () => {
    expect(detectArchetypes(createEmptyModel())).toEqual([]);
  });

  test("every summary names real variables, never a placeholder", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Water", initialEquation: "1000", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Use A", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Use B", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 100 } });
    addConnector(model, { from: "Water", to: "Use A" });
    addConnector(model, { from: "Water", to: "Use B" });

    for (const match of detectArchetypes(model)) {
      expect(match.summary).toContain(`\`${match.nodeNames[0]}\``);
      expect(match.nodeIds).toHaveLength(match.nodeNames.length);
      expect(match.loopIds).toHaveLength(match.loopLabels.length);
    }
  });

  test("the same structure is reported once, not once per route to it", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Water", initialEquation: "1000", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Use A", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Use B", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 100 } });
    addConnector(model, { from: "Water", to: "Use A" });
    addConnector(model, { from: "Water", to: "Use B" });

    const ids = detectArchetypes(model).map((m) => m.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // One candidate per shared resource, not one per pair of flows: three users of one stock are a
  // single commons, so a second one has to come from a second stock.
  // Shifting the Burden turns on a delay, which no amount of loop structure can show: the two
  // paths differ only in that one of them is slow. That is readable from the equation and from
  // nothing else, which is why this archetype was missing until DELAY existed.
  test("Shifting the Burden: a fast path and a delayed one out of the same problem", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Problem", initialEquation: "100", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Relief", equation: "Problem * 0.3", from: "Problem", pos: { x: 0, y: 100 } }); // fast
    addAuxiliary(model, { name: "Slow Path", equation: "DELAY1(Problem, 8)", pos: { x: 200, y: 0 } });
    addFlow(model, { name: "Cure", equation: "Slow Path", from: "Problem", pos: { x: 200, y: 100 } }); // delayed
    addConnector(model, { from: "Problem", to: "Relief" });
    addConnector(model, { from: "Problem", to: "Slow Path" });
    addConnector(model, { from: "Slow Path", to: "Cure" });

    const matches = matchesOf(detectArchetypes(model), "shifting-the-burden");
    expect(matches).toHaveLength(1);
    // No reinforcing loop spans the two paths here, so this is the bare two-path structure.
    expect(matches[0]!.confidence).toBe("possible");
    expect(matches[0]!.summary).toContain("runs through a delay");
  });

  test("Shifting the Burden: not reported when both paths are the same speed", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Problem", initialEquation: "100", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Relief", equation: "Problem * 0.3", from: "Problem", pos: { x: 0, y: 100 } });
    addFlow(model, { name: "Cure", equation: "Problem * 0.2", from: "Problem", pos: { x: 200, y: 100 } });
    addConnector(model, { from: "Problem", to: "Relief" });
    addConnector(model, { from: "Problem", to: "Cure" });
    expect(matchesOf(detectArchetypes(model), "shifting-the-burden")).toEqual([]);
  });

  test("limit caps the report", () => {
    const model = createEmptyModel();
    for (const [stock, a, b] of [
      ["Water", "Irrigate", "Drink"],
      ["Fish", "Trawl", "Angle"],
    ] as const) {
      addStock(model, { name: stock, initialEquation: "1000", pos: { x: 0, y: 0 } });
      addFlow(model, { name: a, equation: `${stock} * 0.1`, from: stock, pos: { x: 100, y: 0 } });
      addFlow(model, { name: b, equation: `${stock} * 0.1`, from: stock, pos: { x: 100, y: 100 } });
      addConnector(model, { from: stock, to: a });
      addConnector(model, { from: stock, to: b });
    }

    expect(detectArchetypes(model)).toHaveLength(2);
    expect(detectArchetypes(model, { limit: 1 })).toHaveLength(1);
  });
});

describe("archetype examples", () => {
  // The property that makes the examples trustworthy: each one is a real model the detector
  // reads as the archetype it is filed under. Neither can drift without the suite failing.
  for (const archetype of ARCHETYPES) {
    test(`${archetype.label}: its own example is detected as it`, () => {
      // `limit` is raised well past its default because a model with many loops can honestly
      // produce more than twelve matches — and the default slice runs in archetype order, so a
      // crowded report would hide this match rather than mean the detector never fired at all.
      // This test is about the detector, so it asks for everything the detector found.
      const matches = detectArchetypes(buildArchetypeExample(archetype.id), { limit: 200 });
      expect(matches.map((m) => m.archetype)).toContain(archetype.id);
    });

    test(`${archetype.label}: its example runs and produces finite output`, () => {
      const result = simulate(buildArchetypeExample(archetype.id));
      expect(result.time.length).toBeGreaterThan(1);
      for (const [name, values] of Object.entries(result.series)) {
        expect(values.every((v) => Number.isFinite(v))).toBe(true);
        // Every series here is a count of something — people, water, missiles, cases — and none of
        // them can go below zero. Not a hypothetical: the Shifting the Burden example ran its
        // problem straight through zero, because the cure is delayed by eight months and kept
        // working at the rate the problem *used* to justify after the problem had gone.
        expect(values.every((v) => v >= 0)).toBe(true);
        expect(name.length).toBeGreaterThan(0);
      }
      expect(Object.keys(result.series).length).toBeGreaterThan(1);
    });

    test(`${archetype.label}: its example has a label, a meaning and a distinct model`, () => {
      expect(archetype.label.length).toBeGreaterThan(0);
      expect(archetype.meaning.length).toBeGreaterThan(20);
      expect(buildArchetypeExample(archetype.id).name).toContain(archetype.label.split(" — ")[0]!);
    });

    test(`${archetype.label}: building its example twice gives independent models`, () => {
      const first = buildArchetypeExample(archetype.id);
      const second = buildArchetypeExample(archetype.id);
      expect(first.stocks.map((s) => s.id)).not.toEqual(second.stocks.map((s) => s.id));
    });
  }

  // Each archetype is a causal claim, and a causal claim can be tested: take the mechanism away
  // and the outcome has to change. Structure alone turned out to be too weak a bar — a model can
  // carry an archetype's loops and still be driven entirely by something else. The commons example
  // had two farms drawing on one aquifer and lost the aquifer just as fast with one; Success to
  // the Successful had a success-feeds-allocation loop that, given equal access, left the two
  // activities at 1337.6 and 1335.6 — the loop did nothing, and a difference in access rates was
  // doing all the work. Both passed every structural test in this file.
  describe("archetype examples behave like the archetype", () => {
    test("Limits to Growth: the limit is what stops the growth", () => {
      const model = buildArchetypeExample("limits-to-growth");
      // Births and deaths balance at 4000, so it climbs towards that and flattens.
      expect(endOf(model, "Population")).toBeGreaterThan(3800);
      expect(endOf(model, "Population")).toBeLessThan(4000);
      // Remove the crowding term and nothing stops it.
      expect(endOf(without(model, "Death Rate", "Base Death Rate"), "Population")).toBeGreaterThan(100_000);
    });

    test("Tragedy of the Commons: the second farm is what drains it", () => {
      const model = buildArchetypeExample("tragedy-of-the-commons");
      // One farm asks for 60,000 against a sustainable yield of 100,000, so it is fine forever —
      // the aquifer even recovers from where it starts.
      expect(endOf(without(model, "Demanda B", "0"), "Agua disponible")).toBeGreaterThan(700_000);
      // The same farm twice asks for 120,000 against the same 100,000, and it drains to nothing.
      expect(endOf(model, "Agua disponible")).toBeLessThan(1_000);
    });

    test("Tragedy of the Commons: the stock rises to a peak before it collapses", () => {
      const model = buildArchetypeExample("tragedy-of-the-commons");
      const result = simulate(model);
      const water = result.series["Agua disponible"]!;
      const peak = Math.max(...water);
      const peakAt = water.indexOf(peak) / water.length;

      // The curve this archetype is drawn with has three phases: abundant and rising, then a peak,
      // then collapse. A stock that is over-drawn from the first day has only one — it falls away
      // from wherever it started — and that is what this example did until the second farm was
      // made to arrive part-way through rather than at full tilt. Checking the phases directly,
      // because "it depletes" is satisfied by a straight line and this is not a straight line.
      expect(peak).toBeGreaterThan(water[0]! * 1.1); // phase 1: it grows while only one farm draws
      expect(peakAt).toBeGreaterThan(0.2); // the peak is neither at the start...
      expect(peakAt).toBeLessThan(0.5); // ...nor at the end
      expect(water.at(-1)!).toBeLessThan(peak * 0.01); // phase 3: it goes, and does not come back
    });

    test("Success to the Successful: allocating by track record is what starves the loser", () => {
      const model = buildArchetypeExample("success-to-the-successful");
      expect(endOf(model, "Actividad A")).toBeGreaterThan(30);
      expect(endOf(model, "Actividad B")).toBeLessThan(1); // starved out entirely
      // Give both a fixed half of the budget instead and there is no winner at all — so the
      // allocation feedback, not the two-project head start, is what produces the outcome.
      const flat = without(without(model, "Acceso A", "0.5"), "Acceso B", "0.5");
      expect(endOf(flat, "Actividad A")).toBeCloseTo(endOf(flat, "Actividad B"), 1);
    });

    test("Fixes that Fail: the side effect is what brings the problem back", () => {
      const model = buildArchetypeExample("fixes-that-fail");
      const problem = simulate(model).series["Problema"]!;
      expect(Math.min(...problem)).toBeLessThan(50); // the fix works at first
      expect(problem.at(-1)!).toBeGreaterThan(500); // then the problem returns past where it started
      // Without the side effect it simply resolves.
      expect(endOf(without(model, "Tasa de efecto", "0"), "Problema")).toBeLessThan(1);
    });

    test("Shifting the Burden: the quick fix is what destroys the capacity", () => {
      const model = buildArchetypeExample("shifting-the-burden");
      // The relief is a real improvement — the problem falls well below where it started.
      expect(endOf(model, "Problema")).toBeLessThan(200);
      // And it is paid for out of the same effort budget: the capacity is never built, and decays.
      expect(endOf(model, "Capacidad")).toBeLessThan(1);
      // Fund the cure instead and the capacity gets built and the problem ends up lower still —
      // after a much worse middle, which is the trade the archetype describes.
      const cureOnly = without(model, "Alivio rapido", "0");
      expect(endOf(cureOnly, "Capacidad")).toBeGreaterThan(30);
      expect(endOf(cureOnly, "Problema")).toBeLessThan(endOf(model, "Problema"));
    });

    test("Escalation: neither side can leave the race", () => {
      const model = buildArchetypeExample("escalation");
      const unopposed = without(without(model, "Produccion B", "0"), "Misiles B", "0");
      // No rival arsenal, no arms race: A has nothing to respond to.
      expect(endOf(unopposed, "Misiles A")).toBeLessThan(130);
      // And with a rival, both keep climbing — the loser included.
      expect(endOf(model, "Misiles A")).toBeGreaterThan(300);
      expect(endOf(model, "Misiles B")).toBeGreaterThan(200);
    });
  });

  // Each archetype is also drawn with a characteristic curve, and the curve is a second,
  // independent check on the example: "it depletes", "it grows" and "it goes up" are all satisfied
  // by a straight line, and none of these are straight lines. Where the counterfactual tests above
  // ask whether the *mechanism* is load-bearing, these ask whether the *shape* is the archetype's.
  describe("archetype examples have the shape the archetype is drawn with", () => {
    test("Limits to Growth: it climbs and then flattens", () => {
      const p = simulate(buildArchetypeExample("limits-to-growth")).series["Population"]!;
      const mid = Math.floor(p.length / 2);
      expect(p.at(-1)! - p[mid]!).toBeLessThan(p[mid]! - p[0]!); // still rising, but slower
      expect(p.at(-1)!).toBeLessThan(4000); // and inside the limit, not through it
    });

    test("Escalation: both sides run away, and neither settles", () => {
      const a = simulate(buildArchetypeExample("escalation")).series["Misiles A"]!;
      const quarter = Math.floor(a.length / 4);
      // An exponential: the last quarter adds more than the first, which a settling curve can't do.
      expect(a.at(-1)! - a[3 * quarter]!).toBeGreaterThan(a[quarter]! - a[0]!);
      expect(a.at(-1)!).toBeGreaterThan(a[0]! * 5);
    });

    test("Success to the Successful: the loser rises, peaks, and is starved out", () => {
      const result = simulate(buildArchetypeExample("success-to-the-successful"));
      const a = result.series["Actividad A"]!;
      const b = result.series["Actividad B"]!;
      expect(a.at(-1)!).toBeGreaterThan(a[0]! * 3); // the winner runs away with it
      expect(b.indexOf(Math.max(...b))).toBeGreaterThan(0); // the loser is not beaten from the start...
      expect(b.at(-1)!).toBeLessThan(b[0]! * 0.1); // ...it is out-competed on the way
    });

    test("Fixes that Fail: the problem dips and then overshoots where it began", () => {
      const p = simulate(buildArchetypeExample("fixes-that-fail")).series["Problema"]!;
      expect(Math.min(...p)).toBeLessThan(p[0]! * 0.5); // the fix visibly works first
      expect(p.at(-1)!).toBeGreaterThan(p[0]!); // and the problem ends worse than it started
    });

    test("Shifting the Burden: the relief's gain is given back as the capacity dies", () => {
      const result = simulate(buildArchetypeExample("shifting-the-burden"));
      const problem = result.series["Problema"]!;
      const capacity = result.series["Capacidad"]!;
      const low = Math.min(...problem);
      expect(low).toBeLessThan(problem[0]! * 0.25); // the relief works, and fast
      expect(problem.at(-1)!).toBeGreaterThan(low * 2); // then the gain is partly given back
      // But never past where it started — that would be Fixes that Fail. What makes this its own
      // archetype is that the problem settles at the level the *relief alone* can hold.
      expect(problem.at(-1)!).toBeLessThan(problem[0]!);
      expect(capacity.at(-1)!).toBeLessThan(capacity[0]! * 0.05); // because the capacity is gone
    });
  });

  test("no two archetypes share an id", () => {
    const ids = ARCHETYPES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
