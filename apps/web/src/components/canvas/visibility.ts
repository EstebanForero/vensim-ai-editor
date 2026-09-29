// Whether the canvas needs re-framing after a change.
//
// The canvas has one job it must never fail at, and it failed at it. With a model of eleven
// elements and two of them on screen the pane looks *exactly* like a pane whose model was never
// built, and there is nothing on either to say which one you are looking at — which is what made
// this so hard to report and so alarming to hit.
//
// Nothing guaranteed it. React Flow's own `fitView` prop frames the model when nodes first appear
// on an empty canvas, and both panels re-frame after a successful `auto_layout`. So a canvas that
// starts empty is always framed, and a relayout is always framed. Everything else was luck: an
// agent adding nodes while the view is panned away, a file opened over a model that was already
// there, a template. The agent case is the ordinary one, because the canvas someone has been
// working on is exactly the canvas that is not sitting at the origin.
//
// The rule is deliberately about what a change *added*, not about the model as a whole. "Is any of
// the model on screen" was the first attempt and it does not fire in the case that actually
// happens: a canvas someone has been using keeps most of its nodes near the origin, a pane panned
// a little way off still catches one or two of them, and two of eleven is not "the model is on
// screen" — it is the bug. What the person needs is to see the thing that just appeared.
//
// Pure functions, because "what counts as visible" is arithmetic and deserves a test rather than a
// screenshot.

import type { Model } from "@vensim-ai/core";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Something the canvas draws a box for. */
export interface Placed {
  id: string;
  pos: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * Everything with a position of its own. Connectors are deliberately absent: an arrow has no box,
 * and it is visible exactly when the things it joins are, so counting it would mean counting a
 * zero-sized nothing at the origin.
 */
export function placedElements(model: Model): Placed[] {
  return [...model.stocks, ...model.flows, ...model.auxiliaries, ...model.comments];
}

/** What the given elements occupy, in flow coordinates. Null when there are none — the one case
 * where an empty canvas is the right answer rather than a bug. */
export function boundsOf(items: readonly Placed[]): Box | null {
  if (items.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.pos.x);
    minY = Math.min(minY, item.pos.y);
    maxX = Math.max(maxX, item.pos.x + item.size.width);
    maxY = Math.max(maxY, item.pos.y + item.size.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * What is on screen, in the same coordinates — React Flow's viewport transform inverted over the
 * pane's own size. A viewport of `{x: -800, y: -500, zoom: 2}` means flow coordinate `(0,0)` is
 * drawn 800px left and 500px up of the pane's corner at twice scale, so the pane is showing the
 * flow region starting at `(400, 250)`.
 */
export function visibleBounds(pane: { width: number; height: number }, viewport: Viewport): Box {
  // The `+ 0` is not decoration: negating a zero gives `-0`, which is the same number but not the
  // same value to anything comparing these — so an untransformed viewport would report a box whose
  // origin differs from `{x: 0, y: 0}` by a sign, which is exactly the sort of difference that ends
  // up costing an afternoon.
  return {
    x: -viewport.x / viewport.zoom + 0,
    y: -viewport.y / viewport.zoom + 0,
    width: pane.width / viewport.zoom,
    height: pane.height / viewport.zoom,
  };
}

/** Whether any part of one box is inside the other. */
export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Whether the model changed in a way the view has to follow: something was added, and not all of it
 * is on screen.
 *
 * "Not all" rather than "none", because the point is to see what appeared — one new node visible
 * out of four is not showing the change, it is showing a corner of it. In practice this settles
 * after a single re-frame: new elements are auto-placed in a grid near the origin, so once the
 * origin is in view the rest of the change is too, and a long agent turn does not drag the canvas
 * around on every call.
 *
 * A model replaced wholesale — a file opened, a template — has no ids in common with the old one,
 * so every element counts as added and it re-frames if any of it is out of view. That is the same
 * rule, and it is how those cases are covered without naming them.
 */
export function needsReframe(previous: Model, model: Model, pane: { width: number; height: number }, viewport: Viewport): boolean {
  const before = new Set(placedElements(previous).map((element) => element.id));
  const added = placedElements(model).filter((element) => !before.has(element.id));
  if (added.length === 0) return false;

  const visible = visibleBounds(pane, viewport);
  return !added.every((element) => {
    const box = boundsOf([element]);
    return box !== null && intersects(box, visible);
  });
}
