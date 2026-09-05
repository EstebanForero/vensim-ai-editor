import type { Position as ModelPosition, Size } from "@vensim-ai/core";

export type Side = "top" | "right" | "bottom" | "left";

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function center(pos: ModelPosition, size: Size) {
  return { x: pos.x + size.width / 2, y: pos.y + size.height / 2 };
}

/**
 * Which side of box `a` faces box `b`, so an edge between them attaches to whichever side is
 * actually closest instead of a node's single fixed left/right handle — a flow placed above,
 * below, or beside its stock still gets a pipe that runs straight to it rather than looping
 * around to a handle on the wrong side. Compares which axis (horizontal/vertical) dominates
 * the direction between the two centers and picks that side; not a full geometric
 * line-box intersection, but enough to pick the right side for typical diagram layouts.
 */
export function closestSides(
  a: { pos: ModelPosition; size: Size },
  b: { pos: ModelPosition; size: Size },
): { from: Side; to: Side } {
  const ca = center(a.pos, a.size);
  const cb = center(b.pos, b.size);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const from: Side = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
  return { from, to: OPPOSITE[from] };
}

export function sourceHandleId(side: Side): string {
  return `${side}-source`;
}
export function targetHandleId(side: Side): string {
  return `${side}-target`;
}
