// The sample curve for an archetype: its example model's own run, scrubbed by a slider.
//
// Which series to plot is not a choice made here. Each archetype declares in core's registry the
// series its *shape* is defined by (`curve:` — `{ "Agua disponible": collapses }` and so on), and
// that same declaration is what `verifyArchetypeExample` checks when the test suite runs. So the
// chart draws exactly what the archetype claims about itself, and a curve whose run stopped
// looking like its archetype would fail the suite and stop being drawn here with it.
//
// Drawn as plain SVG rather than through recharts, for the one thing the Simulation panel's chart
// doesn't need: the curve has to be *revealed* as the slider moves, which means clipping each
// series at the marker. It also borrows the canvas's own color tokens, so the figure reads as the
// same visual language as the schematic above it.

import { ARCHETYPES, buildArchetypeExample, simulate, type ArchetypeId, type SimResult } from "@vensim-ai/core";
import { useMemo, useState } from "react";
import { CHART_PALETTE } from "@/lib/chartPalette";
import { axisFor } from "@/lib/curveAxis";

/** Examples are simulated once and kept: picking through the list would otherwise re-run a model
 * on every click, and they never change between runs. */
const RUNS = new Map<ArchetypeId, SimResult>();

function runOf(id: ArchetypeId): SimResult {
  const cached = RUNS.get(id);
  if (cached) return cached;
  const result = simulate(buildArchetypeExample(id));
  RUNS.set(id, result);
  return result;
}

// Wide and shallow on purpose. The svg fills the panel's width, so its rendered height is the
// panel's width times H/W — a 460x186 box in a 570px column came out 230px tall, tall enough to
// push the slider below the fold on a laptop screen. This aspect puts it at about 155px.
const W = 620;
const H = 156;
const PAD = { top: 10, right: 16, bottom: 20, left: 52 };
const PLOT = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };

/** Axis labels in the axis' own shorthand (250K, 1.5K) and the readout in full. */
const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const FULL = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

function pathThrough(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

/**
 * One archetype's sample curve, with a slider through the run and the value of every plotted
 * series at the slider's position.
 *
 * Colour is assigned by position in this archetype's own series list, so a series keeps its colour
 * for as long as the panel is open — and every series is named and valued in the readout beside
 * the chart, so nothing depends on telling two colours apart.
 */
export function ArchetypeCurve({ id }: { id: ArchetypeId }) {
  const names = useMemo(() => Object.keys(ARCHETYPES.find((a) => a.id === id)!.curve), [id]);
  const run = useMemo(() => runOf(id), [id]);
  // Starts at the end, so the panel opens on the whole curve — the shape is the point, and the
  // slider is for walking back through how it got there.
  const [at, setAt] = useState(() => run.time.length - 1);

  const last = run.time.length - 1;
  const values = names.map((name) => run.series[name] ?? []);
  const axis = axisFor(Math.max(...values.flat(), 0));
  const t0 = run.time[0]!;
  const t1 = run.time[last]!;

  const x = (i: number) => PAD.left + (last === 0 ? 0 : (i / last) * PLOT.w);
  const y = (v: number) => PAD.top + PLOT.h - (axis.top === 0 ? 0 : (v / axis.top) * PLOT.h);

  return (
    <div className="rounded-md border border-border bg-card p-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Sample curve: ${names.join(", ")} over time ${t0} to ${t1}`}
      >
        {axis.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT.w}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text x={PAD.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="central" fontSize={10} fill="var(--muted-foreground)">
              {COMPACT.format(tick)}
            </text>
          </g>
        ))}

        {/* The tail past the marker is drawn faint rather than hidden: the shape stays readable at
            any position, and the fade is what says "past here hasn't happened yet". */}
        {names.map((name, s) => {
          const points = values[s]!.map((v, i) => [x(i), y(v)] as const);
          return (
            <path
              key={`${name}-rest`}
              d={pathThrough(points)}
              fill="none"
              stroke={CHART_PALETTE[s % CHART_PALETTE.length]}
              strokeWidth={2}
              opacity={0.3}
              strokeLinecap="round"
            />
          );
        })}
        {names.map((name, s) => {
          const points = values[s]!.slice(0, at + 1).map((v, i) => [x(i), y(v)] as const);
          return (
            <path
              key={`${name}-so-far`}
              d={pathThrough(points)}
              fill="none"
              stroke={CHART_PALETTE[s % CHART_PALETTE.length]}
              strokeWidth={2}
              strokeLinecap="round"
            />
          );
        })}

        <line x1={PAD.left} x2={PAD.left + PLOT.w} y1={PAD.top + PLOT.h} y2={PAD.top + PLOT.h} stroke="var(--border)" strokeWidth={1} />
        <text x={PAD.left} y={H - 8} fontSize={10} fill="var(--muted-foreground)">
          time {t0}
        </text>
        <text x={PAD.left + PLOT.w} y={H - 8} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
          {t1}
        </text>

        {at > 0 && at < last && (
          <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + PLOT.h} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {names.map((name, s) => (
          <circle
            key={`${name}-dot`}
            cx={x(at)}
            cy={y(values[s]![at] ?? 0)}
            r={4}
            fill="var(--card)"
            stroke={CHART_PALETTE[s % CHART_PALETTE.length]}
            strokeWidth={2}
          />
        ))}
      </svg>

      <input
        type="range"
        min={0}
        max={last}
        step={1}
        value={at}
        onChange={(e) => setAt(Number(e.target.value))}
        aria-label="Time through the run"
        className="curve-slider mt-1"
      />

      {/* The readout is also the legend: each series named and valued in text, with its colour on
          the swatch beside it rather than on the text itself. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-1 text-xs">
        <span className="text-muted-foreground">
          time <span className="tabular-nums text-foreground">{FULL.format(run.time[at] ?? t1)}</span>
        </span>
        {names.map((name, s) => (
          <span key={name} className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: CHART_PALETTE[s % CHART_PALETTE.length] }} />
            <span className="text-muted-foreground">{name}</span>
            <span className="tabular-nums text-foreground">{FULL.format(values[s]![at] ?? 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
