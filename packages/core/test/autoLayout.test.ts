import { describe, expect, test } from "bun:test";
import { buildArchetypeExample } from "../src/archetypes/examples.js";
import { addAuxiliary, addComment, addConnector, addConstant, addFlow, addStock } from "../src/model/builder/index.js";
import { autoLayout } from "../src/layout/autoLayout.js";
import { scoreLayout } from "../src/layout/score.js";
import { annotateLoops, loopAnnotationPos } from "../src/loops/annotate.js";
import { detectLoops } from "../src/loops/detect.js";
import { createEmptyModel, type Model } from "../src/model/types.js";

describe("autoLayout", () => {
  // Regression: dagre optimizes the whole graph's layout together, blending flow-pipe edges and
  // causal-relation edges — a flow pulled on by an unrelated relation could land off the
  // straight line to its own stock(s), reading as an unnecessarily kinked/diagonal pipe even
  // though nothing structurally required that. A flow's perpendicular-axis position is now
  // always snapped onto its stock(s)' shared line after layout.
  test("a flow between two stocks lands exactly on the perpendicular line between them", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A", initialEquation: "100" });
    const b = addStock(model, { name: "B", initialEquation: "0" });
    const flow = addFlow(model, { name: "Transfer", equation: "5", from: a.id, to: b.id });

    autoLayout(model);

    const aCenterY = a.pos.y + a.size.height / 2;
    const bCenterY = b.pos.y + b.size.height / 2;
    const flowCenterY = flow.pos.y + flow.size.height / 2;
    // Nothing else in this model to pull either stock off the other's line, so both land on the
    // same rank and the flow's own line is exactly that shared y.
    expect(aCenterY).toBeCloseTo(bCenterY, 1);
    expect(flowCenterY).toBeCloseTo((aCenterY + bCenterY) / 2, 1);
  });



  // A loop's own annotation must track the loop's centroid, not go stale wherever it happened
  // to land before the elements underneath it moved — the whole point of a loop annotation is
  // to sit in the middle of what it's describing.
  test("re-centers a loop's own annotation on its new centroid after relayout", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100", pos: { x: 900, y: 900 } });
    addFlow(model, { name: "Births", equation: "Population * 0.02", to: pop.id, pos: { x: 900, y: 950 } });
    addConnector(model, { from: "Population", to: "Births" });
    annotateLoops(model);

    const staleComment = model.comments[0]!;
    const staleCentroid = { x: staleComment.pos.x, y: staleComment.pos.y };

    autoLayout(model);

    const loop = detectLoops(model)[0]!;
    const expected = loopAnnotationPos(loop.centroid);
    expect(staleComment.pos).toEqual(expected);
    // The layout must have actually moved things for this to be a meaningful check.
    expect(staleComment.pos).not.toEqual(staleCentroid);
  });

  // Regression: a genuine comment used to only get nudged if it happened to already overlap a
  // node — anywhere else was left alone, which could still land inside where the just-relaid-out
  // diagram was about to expand into, or just scattered among the nodes rather than set apart
  // from them. It's now always placed in a dedicated column clear of every node, not just
  // reactively moved when it happens to collide.
  test("a genuine hand-written comment is set apart from the diagram, never overlapping a node", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Births", equation: "Population * 0.02", to: pop.id, pos: { x: 100, y: 0 } });
    addConnector(model, { from: "Population", to: "Births" });
    const note = addComment(model, { text: "Not a loop annotation", pos: { x: 0, y: 0 } });

    autoLayout(model);

    const overlapsAnyNode = [pop].some(
      (v) =>
        note.pos.x < v.pos.x + v.size.width &&
        note.pos.x + note.size.width > v.pos.x &&
        note.pos.y < v.pos.y + v.size.height &&
        note.pos.y + note.size.height > v.pos.y,
    );
    expect(overlapsAnyNode).toBe(false);
    // Set apart in its own column to the right of the whole cluster, not merely nudged down.
    expect(note.pos.x).toBeGreaterThan(pop.pos.x + pop.size.width);
  });

  test("multiple genuine comments stack in their own column without overlapping each other", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 } });
    const note1 = addComment(model, { text: "First note", pos: { x: 0, y: 0 } });
    const note2 = addComment(model, { text: "Second note", pos: { x: 0, y: 0 } });

    autoLayout(model);

    expect(note1.pos.x).toBe(note2.pos.x); // same column
    expect(note1.pos.y).not.toBe(note2.pos.y); // stacked, not stacked exactly on top of each other
  });

  test("multiple loops each re-center on their own distinct centroid, not a shared/averaged one", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A", initialEquation: "10", pos: { x: 0, y: 0 } });
    const inflowA = addFlow(model, { name: "InflowA", equation: "A * 0.1", to: a.id, pos: { x: 50, y: 0 } });
    addConnector(model, { from: "A", to: "InflowA" });

    const b = addStock(model, { name: "B", initialEquation: "10", pos: { x: 800, y: 800 } });
    const inflowB = addFlow(model, { name: "InflowB", equation: "B * 0.1", to: b.id, pos: { x: 850, y: 800 } });
    addConnector(model, { from: "B", to: "InflowB" });

    annotateLoops(model);
    expect(model.comments).toHaveLength(2);

    autoLayout(model);

    const loops = detectLoops(model);
    const byLabel = new Map(loops.map((l) => [`${l.polarity}${l.number}`, l]));
    for (const c of model.comments) {
      const label = /^([RB]\d+) loop: /.exec(c.text)?.[1];
      const loop = label ? byLabel.get(label) : undefined;
      expect(loop).toBeDefined();
      expect(c.pos).toEqual(loopAnnotationPos(loop!.centroid));
    }
    // The two annotations must not have collapsed onto the same spot.
    expect(model.comments[0]!.pos).not.toEqual(model.comments[1]!.pos);
  });
});

describe("autoLayout: the flow-straightening pass must not stack flows", () => {
  function overlapPairs(model: ReturnType<typeof createEmptyModel>): string[] {
    const vs = [...model.stocks, ...model.flows, ...model.auxiliaries];
    const hits: string[] = [];
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i]!;
        const b = vs[j]!;
        const hit =
          a.pos.x < b.pos.x + b.size.width &&
          b.pos.x < a.pos.x + a.size.width &&
          a.pos.y < b.pos.y + b.size.height &&
          b.pos.y < a.pos.y + a.size.height;
        if (hit) hits.push(`${a.name} <> ${b.name}`);
      }
    }
    return hits;
  }

  // Regression: two flows between the SAME pair of stocks both snap onto that pair's shared
  // center line, and dagre gives same-rank nodes the same coordinate along the flow axis too —
  // so both landed at exactly the same point, one flow rendered invisibly underneath the other.
  test("two flows between the same two stocks do not land on top of each other", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "Source", initialEquation: "100" });
    const b = addStock(model, { name: "Sink", initialEquation: "0" });
    addFlow(model, { name: "Flow One", equation: "1", from: a.id, to: b.id });
    addFlow(model, { name: "Flow Two", equation: "1", from: a.id, to: b.id });

    autoLayout(model);
    expect(overlapPairs(model)).toEqual([]);
  });

  test("no node overlaps any other after layout, across a mixed model", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A", initialEquation: "100" });
    const b = addStock(model, { name: "B", initialEquation: "0" });
    const c = addStock(model, { name: "C", initialEquation: "0" });
    addFlow(model, { name: "AB", equation: "1", from: a.id, to: b.id });
    addFlow(model, { name: "AC", equation: "1", from: a.id, to: c.id });
    addFlow(model, { name: "In", equation: "2", to: a.id });
    addAuxiliary(model, { name: "Rate", equation: "0.1" });
    addConnector(model, { from: "Rate", to: "AB" });

    autoLayout(model);
    expect(overlapPairs(model)).toEqual([]);
  });
});

describe("autoLayout: aligning a flow between two misaligned stocks", () => {
  // Regression: when a flow's two stocks are on different lines, neither can be satisfied — so
  // the flow used to be left wherever dagre put it, skewing BOTH pipes. It now aligns with the
  // stock it leaves (its `from`), so that pipe runs straight and only the other end turns.
  test("the flow aligns with its from-stock, not with neither", () => {
    const model = createEmptyModel();
    const high = addStock(model, { name: "High", initialEquation: "100" });
    const low = addStock(model, { name: "Low", initialEquation: "0" });
    const transfer = addFlow(model, { name: "Transfer", equation: "1", from: high.id, to: low.id });
    addFlow(model, { name: "Sideways", equation: "1", from: high.id });

    autoLayout(model, { algorithm: "layered" });

    const centerY = (v: { pos: { y: number }; size: { height: number } }) => v.pos.y + v.size.height / 2;
    // The precondition this test exists to exercise — asserted rather than guarded, so it can
    // never quietly pass by the two stocks happening to come out level.
    expect(Math.abs(centerY(high) - centerY(low))).toBeGreaterThan(4);
    const flow = model.flows.find((f) => f.id === transfer.id)!;
    expect(centerY(flow)).toBe(centerY(high));
  });
});

describe("structured layout", () => {
  test("an open flow does not pull the two stocks off their shared line", () => {
    const model = createEmptyModel();
    const high = addStock(model, { name: "High", initialEquation: "100" });
    const low = addStock(model, { name: "Low", initialEquation: "0" });
    const transfer = addFlow(model, { name: "Transfer", equation: "1", from: high.id, to: low.id });
    const sideways = addFlow(model, { name: "Sideways", equation: "1", from: high.id });

    autoLayout(model, { algorithm: "structured" });

    const centerY = (v: { pos: { y: number }; size: { height: number } }) => v.pos.y + v.size.height / 2;
    expect(centerY(high)).toBeCloseTo(centerY(low), 1);
    expect(centerY(transfer)).toBeCloseTo(centerY(high), 1);
    expect(centerY(sideways)).toBeCloseTo(centerY(high), 1);
    const overlap =
      sideways.pos.x < transfer.pos.x + transfer.size.width &&
      transfer.pos.x < sideways.pos.x + sideways.size.width &&
      sideways.pos.y < transfer.pos.y + transfer.size.height &&
      transfer.pos.y < sideways.pos.y + sideways.size.height;
    expect(overlap).toBe(false);
  });

  test("a causal link that restates a pipe bends outside the pipe, not through its gap", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100" });
    const births = addFlow(model, { name: "Births", equation: "Population * Birth rate", to: pop.id });
    addConstant(model, { name: "Birth rate", value: 0.03 });
    addConnector(model, { from: "Population", to: "Births" });
    addConnector(model, { from: "Birth rate", to: "Births" });

    autoLayout(model, { algorithm: "structured" });

    const link = model.connectors.find((connector) => connector.from === pop.id && connector.to === births.id);
    const bend = link?.bend;
    expect(bend).toBeTruthy();
    const floor = Math.max(pop.pos.y + pop.size.height, births.pos.y + births.size.height);
    expect(bend!.y).toBeGreaterThan(floor);
  });

  test("gives a curved relation a bend, and the layered layout clears bends", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100" });
    addFlow(model, { name: "Births", equation: "Population * Birth rate", to: pop.id });
    addConstant(model, { name: "Birth rate", value: 0.03 });
    addConnector(model, { from: "Birth rate", to: "Births" });

    autoLayout(model, { algorithm: "structured" });
    expect(model.connectors[0]!.bend).not.toBeNull();

    autoLayout(model, { algorithm: "layered" });
    expect(model.connectors[0]!.bend).toBeNull();
  });
});

function community(): Model {
  const model = createEmptyModel("Community");
  const people = addStock(model, { name: "Population", initialEquation: "1000" });
  const houses = addStock(model, { name: "Housing", initialEquation: "400" });
  const jobs = addStock(model, { name: "Jobs", initialEquation: "300" });
  const land = addStock(model, { name: "Open land", initialEquation: "2000" });

  addFlow(model, { name: "Births", equation: "Population * Birth rate", to: people.id });
  addFlow(model, { name: "Deaths", equation: "Population * Death rate", from: people.id });
  addFlow(model, { name: "Building", equation: "Housing starts", to: houses.id });
  addFlow(model, { name: "Demolition", equation: "Housing / Housing life", from: houses.id });
  addFlow(model, { name: "Hiring", equation: "Jobs * Job growth", to: jobs.id });
  addFlow(model, { name: "Layoffs", equation: "Jobs * Layoff rate", from: jobs.id });
  addFlow(model, { name: "Conversion", equation: "Land converted", from: land.id, to: houses.id });

  addConstant(model, { name: "Birth rate", value: 0.03 });
  addConstant(model, { name: "Normal death rate", value: 0.01 });
  addAuxiliary(model, { name: "Crowding", equation: "Population / Housing" });
  addAuxiliary(model, { name: "Death rate", equation: "Normal death rate * Crowding" });
  addConstant(model, { name: "Housing life", value: 50 });
  addAuxiliary(model, { name: "Housing starts", equation: "Jobs * Construction fraction" });
  addConstant(model, { name: "Construction fraction", value: 0.02 });
  addConstant(model, { name: "Job growth", value: 0.04 });
  addAuxiliary(model, { name: "Layoff rate", equation: "0.02 * Crowding" });
  addAuxiliary(model, { name: "Land converted", equation: "Housing starts * Lot size" });
  addConstant(model, { name: "Lot size", value: 0.2 });

  for (const [from, to] of [
    ["Population", "Births"],
    ["Birth rate", "Births"],
    ["Population", "Deaths"],
    ["Death rate", "Deaths"],
    ["Normal death rate", "Death rate"],
    ["Crowding", "Death rate"],
    ["Population", "Crowding"],
    ["Housing", "Crowding"],
    ["Housing starts", "Building"],
    ["Jobs", "Housing starts"],
    ["Construction fraction", "Housing starts"],
    ["Housing", "Demolition"],
    ["Housing life", "Demolition"],
    ["Jobs", "Hiring"],
    ["Job growth", "Hiring"],
    ["Jobs", "Layoffs"],
    ["Layoff rate", "Layoffs"],
    ["Crowding", "Layoff rate"],
    ["Housing starts", "Land converted"],
    ["Lot size", "Land converted"],
    ["Land converted", "Conversion"],
    ["Open land", "Conversion"],
  ] as const) {
    addConnector(model, { from, to });
  }
  return model;
}

describe("layout clarity on a complex system", () => {
  test("structured reads more clearly than layered, straight and curved", () => {
    const models = [community(), buildArchetypeExample("limits-to-growth"), buildArchetypeExample("tragedy-of-the-commons")];
    for (const style of ["straight", "curved"] as const) {
      let structured = 0;
      let layered = 0;
      const detail: unknown[] = [];
      for (const source of models) {
        const structuredModel = clone(source);
        const layeredModel = clone(source);
        autoLayout(structuredModel, { algorithm: "structured" });
        autoLayout(layeredModel, { algorithm: "layered" });
        const structuredScore = scoreLayout(structuredModel, style);
        const layeredScore = scoreLayout(layeredModel, style);
        expect(overlapPairs(structuredModel)).toEqual([]);
        structured += structuredScore.total;
        layered += layeredScore.total;
        detail.push({ name: source.name, style, structured: structuredScore, layered: layeredScore });
      }
      if (!(structured < layered)) {
        throw new Error(`structured ${structured} is not clearer than layered ${layered} for ${style}: ${JSON.stringify(detail)}`);
      }
    }
  });
});

function clone(model: Model): Model {
  return JSON.parse(JSON.stringify(model)) as Model;
}

function overlapPairs(model: Model): string[] {
  const vs = [...model.stocks, ...model.flows, ...model.auxiliaries];
  const hits: string[] = [];
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i]!;
      const b = vs[j]!;
      const hit =
        a.pos.x < b.pos.x + b.size.width &&
        b.pos.x < a.pos.x + a.size.width &&
        a.pos.y < b.pos.y + b.size.height &&
        b.pos.y < a.pos.y + a.size.height;
      if (hit) hits.push(`${a.name} <> ${b.name}`);
    }
  }
  return hits;
}
