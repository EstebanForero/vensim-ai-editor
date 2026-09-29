import { describe, expect, test } from "bun:test";
import { addComment, addStock, createEmptyModel, type Model } from "@vensim-ai/core";
import { boundsOf, intersects, needsReframe, placedElements, visibleBounds } from "../src/components/canvas/visibility.js";

/**
 * The canvas must never leave what a change added off screen. Reported as "it generated something
 * and I don't see anything" — which is what a blank pane looks like whether the model was lost or
 * merely moved out of view, and the two are indistinguishable to the person looking at it.
 *
 * These are the arithmetic behind the rule, kept pure so it can be checked without a browser.
 */

const PANE = { width: 1000, height: 800 };
const AT_ORIGIN = { x: 0, y: 0, zoom: 1 };
/** The reproduction: 1000x800 pane, panned and zoomed 2x, showing flow (400,250)-(900,650). */
const PANNED = { x: -800, y: -500, zoom: 2 };

function modelWith(...stocks: { name: string; x: number; y: number }[]): Model {
  const model = createEmptyModel("M");
  for (const s of stocks) addStock(model, { name: s.name, pos: { x: s.x, y: s.y }, size: { width: 90, height: 45 } });
  return model;
}

/**
 * The next state of a model, the way the store produces one: a clone with something added, so every
 * element that was there before keeps its id.
 *
 * Building a fresh model with the same names instead gives every element a new id, which makes the
 * whole model look newly added — a real case (a file opened over a model) but not the one being
 * tested, and it hides the difference between "this was added" and "this was replaced".
 */
function adding(model: Model, ...stocks: { name: string; x: number; y: number }[]): Model {
  const next = structuredClone(model);
  for (const s of stocks) addStock(next, { name: s.name, pos: { x: s.x, y: s.y }, size: { width: 90, height: 45 } });
  return next;
}

describe("what the model occupies", () => {
  test("an empty model occupies nothing, so a blank canvas can be the right answer", () => {
    expect(boundsOf(placedElements(createEmptyModel("Empty")))).toBeNull();
  });

  test("covers every element, from the top-left of one to the bottom-right of another", () => {
    expect(boundsOf(placedElements(modelWith({ name: "A", x: 100, y: 100 }, { name: "B", x: 400, y: 300 })))).toEqual({
      x: 100,
      y: 100,
      width: 390,
      height: 245,
    });
  });

  // A note far from everything else is still part of what the model shows.
  test("includes comments", () => {
    const model = modelWith({ name: "A", x: 0, y: 0 });
    addComment(model, { text: "far away", pos: { x: 2000, y: 1500 }, size: { width: 200, height: 60 } });
    expect(boundsOf(placedElements(model))).toEqual({ x: 0, y: 0, width: 2200, height: 1560 });
  });
});

describe("what is on screen", () => {
  test("an untransformed viewport shows the pane's own rectangle from the origin", () => {
    expect(visibleBounds(PANE, AT_ORIGIN)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  // Zooming out shows more of the flow; panning slides the window over it.
  test("inverts the viewport transform", () => {
    expect(visibleBounds(PANE, PANNED)).toEqual({ x: 400, y: 250, width: 500, height: 400 });
    expect(visibleBounds(PANE, { x: 100, y: 50, zoom: 0.5 })).toEqual({ x: -200, y: -100, width: 2000, height: 1600 });
  });

  test("a model over the edge of the pane is not visible, and one overlapping it is", () => {
    const off = boundsOf(placedElements(modelWith({ name: "A", x: 1001, y: 10 })))!;
    const overlapping = boundsOf(placedElements(modelWith({ name: "A", x: -80, y: -30 })))!;
    expect(intersects(off, visibleBounds(PANE, AT_ORIGIN))).toBe(false);
    expect(intersects(overlapping, visibleBounds(PANE, AT_ORIGIN))).toBe(true);
  });
});

describe("whether the view has to follow a change", () => {
  // The reported bug, as arithmetic. A canvas already in use — most of its nodes near the origin —
  // panned a little way off, and an agent that then builds somewhere else. One of the four new
  // nodes happened to fall inside the pane, which is why the first rule ("is any of the model on
  // screen") stayed quiet and the canvas looked empty anyway.
  test("re-frames when the thing just added is off screen, even though other nodes are not", () => {
    const before = modelWith({ name: "Old", x: 500, y: 300 });
    const after = adding(before, { name: "New", x: 60, y: 60 });
    expect(needsReframe(before, after, PANE, PANNED)).toBe(true);
  });

  test("leaves the view alone when what was added is already on screen", () => {
    // The panned pane is showing flow (400,250)-(900,650), so this one lands inside it.
    const before = modelWith({ name: "Old", x: 60, y: 60 });
    const after = adding(before, { name: "New", x: 500, y: 300 });
    expect(needsReframe(before, after, PANE, PANNED)).toBe(false);
  });

  // Editing an equation is a change to the model, and must never move the canvas.
  test("does nothing when a change added nothing", () => {
    const before = modelWith({ name: "A", x: 500, y: 300 });
    const after = structuredClone(before);
    expect(needsReframe(before, after, PANE, PANNED)).toBe(false);
  });

  // A model replaced wholesale — a file opened, a template — shares no ids with the old one, so
  // every element counts as added. That is how those cases are covered without naming them.
  test("re-frames a model that was replaced rather than edited", () => {
    const before = modelWith({ name: "Gone", x: 60, y: 60 });
    const after = modelWith({ name: "Opened", x: 4000, y: 4000 });
    expect(needsReframe(before, after, PANE, PANNED)).toBe(true);
  });

  test("the same model at the origin needs nothing — this is not a rule that always fires", () => {
    const before = modelWith({ name: "Old", x: 60, y: 60 });
    const after = adding(before, { name: "New", x: 200, y: 200 });
    expect(needsReframe(before, after, PANE, AT_ORIGIN)).toBe(false);
  });

  // Deleting everything leaves nothing to show, and an empty canvas is then correct rather than a
  // bug — so this must not try to frame something that is not there.
  test("does not fire on a model that was emptied", () => {
    const before = modelWith({ name: "Only", x: 4000, y: 4000 });
    expect(needsReframe(before, createEmptyModel("Cleared"), PANE, PANNED)).toBe(false);
  });
});
