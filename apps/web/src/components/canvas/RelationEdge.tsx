import { setConnectorBend, type Connector, type Position } from "@vensim-ai/core";
import { BaseEdge, EdgeLabelRenderer, useReactFlow, type EdgeProps } from "@xyflow/react";
import { useCallback } from "react";
import { useModelStore } from "@/state/modelStore";

/** Same perpendicular-offset curve used when a relation has no manual bend point set yet —
 * kept in sync with packages/core/src/mdl/writer.ts's curveWaypoint so the exported .mdl's
 * default curve matches what's on screen. */
function defaultBend(sx: number, sy: number, tx: number, ty: number): Position {
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

export function RelationEdge({ id, sourceX, sourceY, targetX, targetY, data, style, markerEnd }: EdgeProps) {
  const mutate = useModelStore((s) => s.mutate);
  const { screenToFlowPosition } = useReactFlow();
  const connector = (data as { connector?: Connector } | undefined)?.connector;
  const bend = connector?.bend ?? defaultBend(sourceX, sourceY, targetX, targetY);
  const path = `M ${sourceX},${sourceY} Q ${bend.x},${bend.y} ${targetX},${targetY}`;

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        const pos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        mutate((m) => setConnectorBend(m, id, pos));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [id, mutate, screenToFlowPosition],
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
          className="nodrag nopan absolute flex size-4 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border border-[var(--connector-color)] bg-background text-[10px] font-bold text-[var(--connector-color)] shadow active:cursor-grabbing"
          style={{ left: bend.x, top: bend.y, pointerEvents: "all" }}
          onPointerDown={onHandlePointerDown}
          onDoubleClick={onHandleDoubleClick}
          title="Drag to curve this relation; double-click to reset"
        >
          {connector?.polarity}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
