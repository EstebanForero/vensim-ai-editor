import {
  customGraphs,
  deleteCustomGraph,
  findCustomGraph,
  isLookupVariable,
  setCustomGraph,
  type CustomGraph,
  type GraphScale,
  type GraphVariable,
  type LineStyle,
  type Model,
} from "@vensim-ai/core";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { CHART_PALETTE as PALETTE, chartWash } from "@/lib/chartPalette";
import { useModelStore } from "@/state/modelStore";

const STYLE_CHOICES: { value: "" | LineStyle; label: string }[] = [
  { value: "", label: "Solid" },
  { value: "DOT", label: "Dotted" },
  { value: "DASH", label: "Dashed" },
  { value: "DASHDOT", label: "Dash-dot" },
  { value: "DASHDOTDOT", label: "Dash-dot-dot" },
];

/** SVG dash patterns for Vensim's four styled lines. A solid line has no pattern. */
function dashArray(style: LineStyle | undefined): string | undefined {
  switch (style) {
    case "DOT":
      return "1 4";
    case "DASH":
      return "5 4";
    case "DASHDOT":
      return "5 3 1 3";
    case "DASHDOTDOT":
      return "5 3 1 3 1 3";
    default:
      return undefined;
  }
}

const STYLE_CYCLE: (LineStyle | undefined)[] = [undefined, "DOT", "DASH", "DASHDOT", "DASHDOTDOT"];

function plottedNames(model: Model): string[] {
  return [...model.stocks, ...model.flows, ...model.auxiliaries].filter((v) => !isLookupVariable(v, model)).map((v) => v.name);
}

function nextGraphName(model: Model): string {
  const taken = new Set(customGraphs(model).map((g) => g.name));
  let n = 1;
  while (taken.has(`Graph ${n}`)) n += 1;
  return `Graph ${n}`;
}

function explicitBounds(graph: CustomGraph, scale: GraphScale): { min?: number; max?: number } {
  let min = graph.yMin;
  let max = graph.yMax;
  for (const variable of scale.variables) {
    if (variable.yMin !== undefined) min = variable.yMin;
    if (variable.yMax !== undefined) max = variable.yMax;
  }
  return { min, max };
}

function seriesExtent(values: number[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? null : { min, max };
}

/** Each scale fills the chart. A few percent of padding keeps the line off the frame;
 * a constant (min = max) is lifted off the axis so it stays visible. An explicit min or max is left alone. */
function paddedDomain(values: number[], bounds: { min?: number; max?: number }): [number, number] {
  const extent = seriesExtent(values);
  let lo = bounds.min ?? extent?.min ?? 0;
  let hi = bounds.max ?? extent?.max ?? 1;
  if (lo === hi) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.05 : 1;
    if (bounds.min === undefined) lo -= pad;
    if (bounds.max === undefined) hi += pad;
  } else {
    const span = hi - lo;
    if (bounds.min === undefined) lo -= span * 0.05;
    if (bounds.max === undefined) hi += span * 0.05;
  }
  if (!(hi > lo)) hi = lo + 1;
  return [lo, hi];
}

function formatTick(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e5 || abs < 0.001)) return n.toExponential(2);
  const rounded = Number(n.toPrecision(4));
  return String(rounded);
}

/** One `:SCALE` holding every variable. Otherwise each variable keeps the y-scale it was given. */
function sharesOneAxis(graph: CustomGraph): boolean {
  return graph.scales.length === 1 && graph.scales[0]!.shared && graph.scales[0]!.variables.length > 1;
}

function isTimeAxis(name: string | undefined): boolean {
  return !name || name.toLowerCase() === "time";
}

export function SimChart() {
  const model = useModelStore((s) => s.model);
  const simResult = useModelStore((s) => s.simResult);
  const runSimulation = useModelStore((s) => s.runSimulation);
  const mutate = useModelStore((s) => s.mutate);

  const allNames = useMemo(() => plottedNames(model), [model]);
  const graphs = useMemo(() => customGraphs(model), [model]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const active = graphs.find((g) => g.name === activeName) ?? null;

  const [selected, setSelected] = useState<Set<string>>(() => new Set(model.stocks.map((s) => s.name)));
  // Re-sync when the model is replaced (a template, an opened file, an archetype example).
  // Without this the initializer above only ever runs once, so the chips and the plotted lines
  // would still be the *previous* model's variable names.
  useEffect(() => {
    setSelected(new Set(model.stocks.map((s) => s.name)));
  }, [model]);

  useEffect(() => {
    if (activeName && !graphs.some((g) => g.name === activeName)) setActiveName(null);
  }, [graphs, activeName]);

  const adHoc = useMemo(() => {
    if (!simResult || active) return null;
    const names = allNames.filter((name) => selected.has(name));
    const data = simResult.time.map((t, i) => {
      const row: Record<string, number> = { time: t };
      for (const name of names) row[name] = simResult.series[name]?.[i] ?? NaN;
      return row;
    });
    const separate = names.length > 1;
    const series = names.map((name) => {
      const values = data.map((row) => row[name]!);
      const extent = seriesExtent(values);
      return {
        name,
        color: PALETTE[allNames.indexOf(name) % PALETTE.length]!,
        domain: paddedDomain(values, {}),
        legend: separate && extent ? `${name} (${formatTick(extent.min)}–${formatTick(extent.max)})` : name,
      };
    });
    return { data, series, separate };
  }, [simResult, selected, active, allNames]);

  const customPlot = useMemo(() => (active && simResult ? plotCustomGraph(active, simResult) : null), [active, simResult]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const saveSelection = () => {
    const names = allNames.filter((name) => selected.has(name));
    if (names.length === 0) return;
    const name = nextGraphName(model);
    mutate((draft) => {
      setCustomGraph(draft, {
        name,
        title: name,
        scales: names.map((variable, i) => ({
          shared: false,
          variables: [{ name: variable, lineStyle: STYLE_CYCLE[i % STYLE_CYCLE.length], extra: [] }],
        })),
        extra: [],
      });
    });
    setActiveName(name);
  };

  const addVariable = (name: string) => {
    if (!active) return;
    mutate((draft) => {
      const graph = findCustomGraph(draft, active.name);
      if (!graph) return;
      const count = graph.scales.reduce((n, s) => n + s.variables.length, 0);
      const variable: GraphVariable = { name, lineStyle: STYLE_CYCLE[count % STYLE_CYCLE.length], extra: [] };
      const shared = graph.scales.length === 1 && graph.scales[0]?.shared;
      if (shared && graph.scales[0]) graph.scales[0].variables.push(variable);
      else graph.scales.push({ shared: false, variables: [variable] });
    });
  };

  const setShareAxis = (shared: boolean) => {
    if (!active) return;
    mutate((draft) => {
      const graph = findCustomGraph(draft, active.name);
      if (!graph) return;
      const variables = graph.scales.flatMap((scale) => scale.variables);
      if (variables.length < 2) return;
      graph.scales = shared
        ? [{ shared: true, variables }]
        : variables.map((variable) => ({ shared: false, variables: [variable] }));
    });
  };

  const setStyle = (scaleIndex: number, variableIndex: number, style: "" | LineStyle) => {
    if (!active) return;
    mutate((draft) => {
      const variable = findCustomGraph(draft, active.name)?.scales[scaleIndex]?.variables[variableIndex];
      if (!variable) return;
      if (style) {
        variable.lineStyle = style;
        delete variable.lineWidth;
      } else {
        delete variable.lineStyle;
      }
    });
  };

  const removeVariable = (scaleIndex: number, variableIndex: number) => {
    if (!active) return;
    mutate((draft) => {
      const graph = findCustomGraph(draft, active.name);
      const scale = graph?.scales[scaleIndex];
      if (!graph || !scale) return;
      scale.variables.splice(variableIndex, 1);
      graph.scales = graph.scales.filter((s) => s.variables.length > 0);
      if (graph.scales.length === 0) deleteCustomGraph(draft, graph.name);
    });
  };

  const removeGraph = () => {
    if (!active) return;
    mutate((draft) => deleteCustomGraph(draft, active.name));
    setActiveName(null);
  };

  const setDots = (dots: boolean) => {
    if (!active) return;
    mutate((draft) => {
      const graph = findCustomGraph(draft, active.name);
      if (graph) graph.dots = dots;
    });
  };

  const unused = active ? allNames.filter((name) => !active.scales.some((s) => s.variables.some((v) => v.name === name))) : [];

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Simulation</span>
        <Button size="sm" onClick={runSimulation}>
          Run
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="custom-graph">
          Graph
        </label>
        <select
          id="custom-graph"
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          value={active?.name ?? ""}
          onChange={(e) => setActiveName(e.target.value || null)}
        >
          <option value="">Ad hoc series</option>
          {graphs.map((graph) => (
            <option key={graph.name} value={graph.name}>
              {graph.name}
            </option>
          ))}
        </select>
        {active ? (
          <Button size="sm" variant="outline" onClick={removeGraph}>
            Delete
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={saveSelection} disabled={[...selected].length === 0}>
            Save graph
          </Button>
        )}
      </div>

      {active ? (
        <CustomGraphFields
          graph={active}
          unused={unused}
          onStyle={setStyle}
          onRemove={removeVariable}
          onAdd={addVariable}
          onDots={setDots}
          onShareAxis={setShareAxis}
        />
      ) : (
        <div className="flex flex-wrap gap-1">
          {allNames.map((name, i) => (
            <button
              key={name}
              onClick={() => toggle(name)}
              className="rounded-full border px-2 py-0.5 text-[11px]"
              style={{
                borderColor: PALETTE[i % PALETTE.length],
                backgroundColor: selected.has(name) ? chartWash(PALETTE[i % PALETTE.length]!) : "transparent",
                color: PALETTE[i % PALETTE.length],
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {simResult ? (
          active && customPlot ? (
            <CustomGraphChart graph={active} plot={customPlot} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={adHoc?.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                {(adHoc?.series ?? []).map((series, i) => (
                  <YAxis
                    key={series.name}
                    yAxisId={series.name}
                    domain={series.domain}
                    allowDataOverflow
                    niceTicks="none"
                    orientation="left"
                    tick={adHoc?.separate ? false : { fontSize: 11 }}
                    axisLine={!adHoc?.separate}
                    tickLine={!adHoc?.separate}
                    width={adHoc?.separate ? (i === 0 ? 8 : 0) : undefined}
                  />
                ))}
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {(adHoc?.series ?? []).map((series) => (
                  <Line
                    key={series.name}
                    type="monotone"
                    dataKey={series.name}
                    name={series.legend}
                    yAxisId={series.name}
                    stroke={series.color}
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Click Run to simulate the model.</div>
        )}
      </div>
    </div>
  );
}

function CustomGraphFields({
  graph,
  unused,
  onStyle,
  onRemove,
  onAdd,
  onDots,
  onShareAxis,
}: {
  graph: CustomGraph;
  unused: string[];
  onStyle: (scaleIndex: number, variableIndex: number, style: "" | LineStyle) => void;
  onRemove: (scaleIndex: number, variableIndex: number) => void;
  onAdd: (name: string) => void;
  onDots: (dots: boolean) => void;
  onShareAxis: (shared: boolean) => void;
}) {
  const variableCount = graph.scales.reduce((n, scale) => n + scale.variables.length, 0);
  return (
    <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
      <div className="text-[11px] text-muted-foreground">{graph.title && graph.title !== graph.name ? graph.title : "Custom graph"}</div>
      <label className="flex items-center gap-2 text-[11px]">
        <input type="checkbox" checked={graph.dots === true} onChange={(e) => onDots(e.target.checked)} />
        Points only
      </label>
      <label className="flex items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={sharesOneAxis(graph)}
          disabled={variableCount < 2}
          onChange={(e) => onShareAxis(e.target.checked)}
        />
        One shared axis
      </label>
      {graph.scales.map((scale, scaleIndex) =>
        scale.variables.map((variable, variableIndex) => (
          <div key={`${scaleIndex}-${variableIndex}`} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[11px]" title={variable.name}>
              {variable.label || variable.name}
              {graph.scales.length > 1 ? ` (scale ${scaleIndex + 1})` : ""}
            </span>
            <select
              aria-label={`Line style for ${variable.name}`}
              className="h-7 rounded-md border border-input bg-background px-1 text-[11px]"
              value={variable.lineStyle ?? ""}
              onChange={(e) => onStyle(scaleIndex, variableIndex, e.target.value as "" | LineStyle)}
            >
              {STYLE_CHOICES.map((choice) => (
                <option key={choice.label} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
            <button className="px-1 text-[11px] text-muted-foreground" onClick={() => onRemove(scaleIndex, variableIndex)} aria-label={`Remove ${variable.name}`}>
              ×
            </button>
          </div>
        )),
      )}
      {unused.length > 0 && (
        <select
          aria-label="Add variable"
          className="h-7 rounded-md border border-input bg-background px-1 text-[11px]"
          value=""
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value);
          }}
        >
          <option value="">Add variable…</option>
          {unused.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

interface PlotSeries {
  key: string;
  name: string;
  legend: string;
  range?: string;
  color: string;
  dash?: string;
  width: number;
  yAxisId: number;
}

interface CustomPlot {
  data: Record<string, number>[];
  xKey: string;
  xLabel: string;
  series: PlotSeries[];
  domains: [number, number][];
  /** More than one y-scale, so tick numbers would describe only one of the lines. */
  separate: boolean;
  missing: string[];
  xy: boolean;
}

function plotCustomGraph(graph: CustomGraph, sim: { time: number[]; series: Record<string, number[] | undefined> }): CustomPlot {
  const xy = !isTimeAxis(graph.xAxis);
  const xValues = xy ? sim.series[graph.xAxis!] : sim.time;
  const missing: string[] = [];
  if (xy && !xValues) missing.push(graph.xAxis!);
  const series: PlotSeries[] = [];
  const columns: number[][] = [];
  const scaleValues: number[][] = graph.scales.map(() => []);
  graph.scales.forEach((scale, scaleIndex) => {
    for (const variable of scale.variables) {
      const raw = sim.series[variable.name];
      if (!raw) {
        missing.push(variable.name);
        continue;
      }
      const column = graph.cumulative ? integrate(sim.time, raw) : raw;
      columns.push(column);
      scaleValues[scaleIndex]!.push(...column);
      const extent = seriesExtent(column);
      const label = variable.label || variable.name;
      series.push({
        key: `s${series.length}`,
        name: variable.name,
        legend: label,
        range: extent ? `${formatTick(extent.min)}–${formatTick(extent.max)}` : undefined,
        color: variable.lineColor
          ? `rgb(${variable.lineColor.r}, ${variable.lineColor.g}, ${variable.lineColor.b})`
          : PALETTE[series.length % PALETTE.length]!,
        dash: dashArray(variable.lineStyle),
        width: variable.lineStyle ? 1.5 : (variable.lineWidth ?? 2),
        yAxisId: scaleIndex,
      });
    }
  });

  const rows: Record<string, number>[] = [];
  for (let i = 0; i < sim.time.length; i++) {
    const x = xy ? xValues?.[i] : sim.time[i];
    if (x === undefined || Number.isNaN(x)) continue;
    const row: Record<string, number> = { x };
    series.forEach((plotted, column) => {
      row[plotted.key] = columns[column]?.[i] ?? NaN;
    });
    rows.push(row);
  }
  if (xy) rows.sort((a, b) => a.x! - b.x!);

  const separate = new Set(series.map((plotted) => plotted.yAxisId)).size > 1;
  return {
    data: rows,
    xKey: "x",
    xLabel: graph.xLabel || (xy ? graph.xAxis! : "Time"),
    series,
    domains: graph.scales.map((scale, i) => paddedDomain(scaleValues[i] ?? [], explicitBounds(graph, scale))),
    separate,
    missing,
    xy,
  };
}

function integrate(time: number[], values: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    if (i > 0) acc += (values[i] ?? 0) * ((time[i] ?? 0) - (time[i - 1] ?? 0));
    out.push(acc);
  }
  return out;
}

function StyleLegend({
  payload,
  ranges,
}: {
  payload?: ReadonlyArray<{ value?: string; color?: string; dataKey?: unknown; payload?: { strokeDasharray?: string } }>;
  ranges?: Record<string, string | undefined>;
}) {
  if (!payload?.length) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px]">
      {payload.map((item) => {
        const range = ranges?.[String(item.dataKey ?? "")];
        return (
          <li key={item.value} className="flex items-center gap-1">
            <svg width="28" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="28"
                y2="4"
                stroke={item.color}
                strokeWidth="2"
                strokeDasharray={item.payload?.strokeDasharray}
              />
            </svg>
            {item.value}
            {range ? <span className="text-muted-foreground">{range}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function CustomGraphChart({ graph, plot }: { graph: CustomGraph; plot: CustomPlot }) {
  const xDomain: [number | "auto", number | "auto"] = [graph.xMin ?? "auto", graph.xMax ?? "auto"];
  return (
    <div className="flex h-full flex-col">
      <div className="truncate text-center text-[11px] font-medium">{graph.title || graph.name}</div>
      {plot.missing.length > 0 && (
        <div className="truncate text-center text-[10px] text-muted-foreground">Not in this run: {plot.missing.join(", ")}</div>
      )}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={plot.data} margin={{ top: 8, right: plot.domains.length > 1 ? 16 : 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey={plot.xKey} tick={{ fontSize: 11 }} domain={xDomain} label={{ value: plot.xLabel, fontSize: 10, position: "insideBottom", offset: -2 }} />
            {plot.domains.map((domain, i) => (
              <YAxis
                key={i}
                yAxisId={i}
                orientation="left"
                domain={domain}
                allowDataOverflow
                niceTicks="none"
                tick={plot.separate ? false : { fontSize: 11 }}
                axisLine={!plot.separate}
                tickLine={!plot.separate}
                width={plot.separate ? (i === 0 ? 8 : 0) : undefined}
              />
            ))}
            <Tooltip />
            {graph.noLegend === undefined && (
              <Legend
                content={(props) => (
                  <StyleLegend
                    payload={props.payload}
                    ranges={
                      plot.separate
                        ? Object.fromEntries(plot.series.map((series) => [series.key, series.range]))
                        : undefined
                    }
                  />
                )}
                wrapperStyle={{ fontSize: 11 }}
              />
            )}
            {plot.series.map((series) => (
              <Line
                key={series.key}
                type={graph.dots ? "linear" : "monotone"}
                dataKey={series.key}
                name={series.legend}
                yAxisId={series.yAxisId}
                stroke={series.color}
                strokeDasharray={graph.dots ? undefined : series.dash}
                strokeWidth={graph.dots ? 0 : series.width}
                dot={graph.dots ? { r: 2.5 } : false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
