import { describe, expect, test } from "bun:test";
import { addAuxiliary, addComment, addConnector, addFlow, addStock } from "../src/model/builder/index.js";
import { autoLayout } from "../src/layout/autoLayout.js";
import { annotateLoops, loopAnnotationPos } from "../src/loops/annotate.js";
import { detectLoops } from "../src/loops/detect.js";
import { createEmptyModel } from "../src/model/types.js";

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

    autoLayout(model);

    const centerY = (v: { pos: { y: number }; size: { height: number } }) => v.pos.y + v.size.height / 2;
    // The precondition this test exists to exercise — asserted rather than guarded, so it can
    // never quietly pass by the two stocks happening to come out level.
    expect(Math.abs(centerY(high) - centerY(low))).toBeGreaterThan(4);
    const flow = model.flows.find((f) => f.id === transfer.id)!;
    expect(centerY(flow)).toBe(centerY(high));
  });
});
