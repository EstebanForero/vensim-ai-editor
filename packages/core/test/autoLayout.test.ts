import { describe, expect, test } from "bun:test";
import { addComment, addConnector, addFlow, addStock } from "../src/model/builder/index.js";
import { autoLayout } from "../src/layout/autoLayout.js";
import { annotateLoops, loopAnnotationPos } from "../src/loops/annotate.js";
import { detectLoops } from "../src/loops/detect.js";
import { createEmptyModel } from "../src/model/types.js";

describe("autoLayout", () => {
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

  test("a genuine hand-written comment is only nudged if it overlaps, never re-centered like a loop annotation", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Births", equation: "Population * 0.02", to: pop.id, pos: { x: 100, y: 0 } });
    addConnector(model, { from: "Population", to: "Births" });
    const note = addComment(model, { text: "Not a loop annotation", pos: { x: 5000, y: 5000 } });

    autoLayout(model);
    // Far from everything else, so it should never have overlapped anything and stays put.
    expect(note.pos).toEqual({ x: 5000, y: 5000 });
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
