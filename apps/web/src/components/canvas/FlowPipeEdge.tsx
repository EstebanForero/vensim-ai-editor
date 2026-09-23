import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

/**
 * A flow pipe.
 *
 * Previously a plain straight edge, which meant any time a flow wasn't exactly level with the
 * node it connects to, the pipe ran diagonally out of the stock. That happens whenever the two
 * ends can't share a line — a flow between two stocks that auto-layout placed at different
 * heights can only be aligned with one of them, so the other pipe is necessarily skewed.
 *
 * This routes orthogonally instead: the pipe leaves each end perpendicular to the side it
 * attaches to, with a single right-angle turn between them. So the segment at the stock is
 * always straight, which is what a flow pipe should look like — and it's what Vensim draws,
 * whose own pipe points are expected to form right angles.
 *
 * When the two ends ARE level (the common case, since auto-layout pulls a flow onto its stock's
 * center line) the elbow collapses to nothing and the path is a straight line, so this doesn't
 * change the ordinary case at all.
 */
export function FlowPipeEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd }: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    // Just enough to soften the corner without reading as a curve — a flow pipe is a pipe, not
    // a relation arrow (those are deliberately curved and dashed, to stay distinguishable).
    borderRadius: 6,
  });
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}
