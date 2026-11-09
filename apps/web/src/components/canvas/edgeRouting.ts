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

/**
 * A flow pipe as Vensim draws one: a straight run, or a single right angle when the two ends
 * don't share a line. Never a curve, and never a path that leaves the handle and folds back.
 * The smooth-step router does that on a short gap — its 20px handle offset is longer than the
 * gap, so the two ends cross and the pipe loops.
 */
export function flowPipePath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  sourceSide: Side,
): string {
  const sx = source.x;
  const sy = source.y;
  const tx = target.x;
  const ty = target.y;
  const straight = `M ${sx} ${sy} L ${tx} ${ty}`;
  const horizontal = sourceSide === "left" || sourceSide === "right";
  const forward = horizontal
    ? sourceSide === "right"
      ? tx > sx + 1
      : tx < sx - 1
    : sourceSide === "bottom"
      ? ty > sy + 1
      : ty < sy - 1;
  const aligned = horizontal ? Math.abs(ty - sy) < 1.5 : Math.abs(tx - sx) < 1.5;
  // An elbow only exists when the target is still in front of the handle. Behind it, the
  // corner would have to double back, which is the loop a flow pipe is not allowed to make.
  if (!forward || aligned) return straight;
  if (horizontal) {
    const mx = sx + (tx - sx) / 2;
    return `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ty} L ${tx} ${ty}`;
  }
  const my = sy + (ty - sy) / 2;
  return `M ${sx} ${sy} L ${sx} ${my} L ${tx} ${my} L ${tx} ${ty}`;
}

export function sourceHandleId(side: Side): string {
  return `${side}-source`;
}
export function targetHandleId(side: Side): string {
  return `${side}-target`;
}
