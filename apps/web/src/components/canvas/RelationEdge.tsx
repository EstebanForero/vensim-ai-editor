import { setConnectorBend, type Connector, type Position } from "@vensim-ai/core";
import { BaseEdge, EdgeLabelRenderer, useReactFlow, type EdgeProps } from "@xyflow/react";
import { useCallback } from "react";
import { useModelStore } from "@/state/modelStore";

/** Same perpendicular-offset curve used when a relation has no manual bend point set yet —
 * kept in sync with packages/core/src/mdl/writer.ts's curveWaypoint so the exported .mdl's
 * default curve matches what's on screen. */
function defaultControlPoint(sx: number, sy: number, tx: number, ty: number): Position {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const bend = Math.min(60, len * 0.25);
  return { x: mx + px * bend, y: my + py * bend };
}

/** The point actually ON a quadratic bezier at its midpoint (t=0.5). A quadratic curve does
 * NOT pass through its control point — only bows toward it — so a handle drawn at the control
 * point itself drifts further off the visible curve the more it's dragged. This is the point
 * to both render the handle at and hit-test against. */
function curveMidpoint(p0: Position, control: Position, p2: Position): Position {
  return { x: 0.25 * p0.x + 0.5 * control.x + 0.25 * p2.x, y: 0.25 * p0.y + 0.5 * control.y + 0.25 * p2.y };
}

/** Inverse of curveMidpoint: the control point that puts the curve's midpoint exactly at
 * `midpoint`, so dragging the handle keeps it glued to the cursor instead of the control
 * point (2x further from the midpoint than the cursor movement) racing ahead of it. */
function controlPointForMidpoint(midpoint: Position, p0: Position, p2: Position): Position {
  return { x: 2 * midpoint.x - 0.5 * (p0.x + p2.x), y: 2 * midpoint.y - 0.5 * (p0.y + p2.y) };
}

export function RelationEdge({ id, sourceX, sourceY, targetX, targetY, data, style, markerEnd }: EdgeProps) {
  const mutate = useModelStore((s) => s.mutate);
  const { screenToFlowPosition } = useReactFlow();
  const relations = useModelStore((s) => s.relations);
  const connector = (data as { connector?: Connector } | undefined)?.connector;
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  // Straight is the default and the one that round-trips exactly: a curve needs a control point,
  // and the only free source for one was the relation's own id — which carries a random suffix, so
  // the same model curved differently on every save. See `writeMdl`'s `RelationStyle`.
  const straight = relations === "straight";
  const control = connector?.bend ?? defaultControlPoint(sourceX, sourceY, targetX, targetY);
  const handlePos = straight ? { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 } : curveMidpoint(source, control, target);
  const path = straight
    ? `M ${sourceX},${sourceY} L ${targetX},${targetY}`
    : `M ${sourceX},${sourceY} Q ${control.x},${control.y} ${targetX},${targetY}`;

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        const midpoint = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        mutate((m) => setConnectorBend(m, id, controlPointForMidpoint(midpoint, source, target)));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [id, mutate, screenToFlowPosition, source, target],
  );

  const onHandleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      mutate((m) => setConnectorBend(m, id, null));
    },
    [id, mutate],
  );

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className={`nodrag nopan absolute flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--connector-color)] bg-background text-[10px] font-bold text-[var(--connector-color)] shadow ${
            straight ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          }`}
          style={{ left: handlePos.x, top: handlePos.y, pointerEvents: "all" }}
          // Straight relations have no curve to drag — the handle is the polarity badge and
          // nothing more, rather than a grab that silently does nothing to what is written out.
          onPointerDown={straight ? undefined : onHandlePointerDown}
          onDoubleClick={straight ? undefined : onHandleDoubleClick}
          title={straight ? "Relations are drawn straight — switch to Curved in the toolbar to bend this one" : "Drag to curve this relation; double-click to reset"}
        >
          {connector?.polarity}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
