import { BaseEdge, Position, type EdgeProps } from "@xyflow/react";
import { flowPipePath, type Side } from "./edgeRouting";

/**
 * A flow pipe. Vensim pipes run straight, or turn once at a right angle. They do not curve,
 * and a short gap must not fold the pipe back on itself. Relation arrows are the dashed curves.
 */
function sideOf(position: Position | undefined): Side {
  if (position === Position.Left || position === Position.Right || position === Position.Top || position === Position.Bottom) return position;
  return "right";
}

export function FlowPipeEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, style, markerEnd }: EdgeProps) {
  const path = flowPipePath({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, sideOf(sourcePosition));
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}
