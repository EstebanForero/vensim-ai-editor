import type { Position, Size } from "../model/types.js";

export interface Box {
  pos: Position;
  size: Size;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.pos.x < b.pos.x + b.size.width &&
    b.pos.x < a.pos.x + a.size.width &&
    a.pos.y < b.pos.y + b.size.height &&
    b.pos.y < a.pos.y + a.size.height
  );
}

export function centerOf(box: Box): Position {
  return { x: box.pos.x + box.size.width / 2, y: box.pos.y + box.size.height / 2 };
}

/** Proper crossing of two open segments. A shared endpoint or a collinear touch is not a crossing. */
export function segmentsCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const orient = (p: Position, q: Position, r: Position) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false;
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function pointInBox(p: Position, box: Box, pad = 0): boolean {
  return (
    p.x > box.pos.x - pad &&
    p.x < box.pos.x + box.size.width + pad &&
    p.y > box.pos.y - pad &&
    p.y < box.pos.y + box.size.height + pad
  );
}

/** True when the open segment passes through the box. Endpoints sitting on the box do not count. */
export function segmentHitsBox(a: Position, b: Position, box: Box): boolean {
  const samples = 7;
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (pointInBox(p, box)) return true;
  }
  return false;
}
