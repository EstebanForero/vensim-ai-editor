import { normalizeLookupTable, type LookupTable } from "@vensim-ai/core";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

/** The curve's points, extended flat to the axis edges — a lookup holds its first/last output
 * beyond the data rather than extrapolating, so a preview that stopped at the outermost point
 * would draw a curve that doesn't match what the model actually computes outside that range.
 * Exported because the editor's bigger chart needs the same series. */
export function lookupCurvePoints(table: LookupTable): { x: number; y: number }[] {
  const t = normalizeLookupTable(table);
  if (t.points.length === 0) return [];
  const first = t.points[0]!;
  const last = t.points[t.points.length - 1]!;
  const out: { x: number; y: number }[] = [];
  if (t.xMin < first.x) out.push({ x: t.xMin, y: first.y });
  out.push(...t.points);
  if (t.xMax > last.x) out.push({ x: t.xMax, y: last.y });
  return out;
}

/**
 * A lookup's curve as a bare SVG polyline — no axes, no grid, no chart library. This is the
 * glance-level view: the shape of the relationship at a node-sized scale, on a canvas that may
 * hold a dozen of them. The full editor (LookupEditorDialog) is where you read values off it.
 *
 * Scales the DATA range to the box rather than drawing the axis limits, so a curve that only
 * occupies part of its declared range still fills the preview instead of huddling in a corner.
 */
/** Measures the box the sparkline is actually given. Scaling the SVG to a fixed nominal width
 * instead would stretch the curve non-uniformly on a narrower container, which misreports the
 * one thing a curve is read for — how steep it is. */
function useMeasuredWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || fallback);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

export function LookupSparkline({
  table,
  width,
  height,
  fluid = false,
  color = "var(--lookup-color)",
  strokeWidth = 1.5,
  showPoints = false,
  className,
}: {
  table: LookupTable;
  /** Fixed width, or the fallback used before a `fluid` sparkline has measured its container. */
  width: number;
  height: number;
  /** Fill the parent's width instead of using `width`. */
  fluid?: boolean;
  color?: string;
  strokeWidth?: number;
  /** Marks the actual data points, so it's clear which samples are given and which are
   * interpolated between them. Worth it at editor scale, visual noise at node scale. */
  showPoints?: boolean;
  className?: string;
}) {
  const [containerRef, measured] = useMeasuredWidth(width);
  const drawWidth = fluid ? measured : width;

  const { path, points } = useMemo(() => {
    const pts = lookupCurvePoints(table);
    if (pts.length === 0) return { path: "", points: [] };

    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const spanX = x1 - x0 || 1;
    const spanY = y1 - y0 || 1;
    // Inset by the stroke so the extremes aren't clipped at the edges.
    const pad = strokeWidth;
    const sx = (x: number) => pad + ((x - x0) / spanX) * (drawWidth - pad * 2);
    const sy = (y: number) => height - pad - ((y - y0) / spanY) * (height - pad * 2);

    return {
      path: pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(" "),
      points: normalizeLookupTable(table).points.map((p) => ({ cx: sx(p.x), cy: sy(p.y) })),
    };
  }, [table, drawWidth, height, strokeWidth]);

  const svg = !path ? null : (
    <svg width={drawWidth} height={height} className={className} aria-hidden="true" role="presentation">
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {showPoints &&
        points.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={strokeWidth + 1.5} fill={color} stroke="var(--background)" strokeWidth={1.5} />
        ))}
    </svg>
  );

  return fluid ? <div ref={containerRef} className="flex w-full justify-center">{svg}</div> : svg;
}
