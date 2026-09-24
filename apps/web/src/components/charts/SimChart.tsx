import { isLookupVariable } from "@vensim-ai/core";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { useModelStore } from "@/state/modelStore";

const PALETTE = ["#6d28d9", "#0ea5e9", "#16a34a", "#dc2626", "#d97706", "#db2777", "#0891b2", "#65a30d"];

export function SimChart() {
  const model = useModelStore((s) => s.model);
  const simResult = useModelStore((s) => s.simResult);
  const runSimulation = useModelStore((s) => s.runSimulation);

  // Lookup definitions are curves, not time series — they have no values to plot, so offering
  // them as a series would just produce an empty line.
  const allNames = useMemo(
    () => [...model.stocks, ...model.flows, ...model.auxiliaries].filter((v) => !isLookupVariable(v, model)).map((v) => v.name),
    [model],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(model.stocks.map((s) => s.name)));
  // Re-sync when the model is replaced (a template, an opened file, an archetype example).
  // Without this the initializer above only ever runs once, so the chips and the plotted lines
  // would still be the *previous* model's variable names — and, since nothing in the new model
  // matches them, every line would read NaN.
  useEffect(() => {
    setSelected(new Set(model.stocks.map((s) => s.name)));
  }, [model]);

  const data = useMemo(() => {
    if (!simResult) return [];
    return simResult.time.map((t, i) => {
      const row: Record<string, number> = { time: t };
      for (const name of selected) row[name] = simResult.series[name]?.[i] ?? NaN;
      return row;
    });
  }, [simResult, selected]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Simulation</span>
        <Button size="sm" onClick={runSimulation}>
          Run
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
        {allNames.map((name, i) => (
          <button
            key={name}
            onClick={() => toggle(name)}
            className="rounded-full border px-2 py-0.5 text-[11px]"
            style={{
              borderColor: PALETTE[i % PALETTE.length],
              backgroundColor: selected.has(name) ? PALETTE[i % PALETTE.length] + "22" : "transparent",
              color: PALETTE[i % PALETTE.length],
            }}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {simResult ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {[...selected].map((name) => {
                const i = allNames.indexOf(name);
                return <Line key={name} type="monotone" dataKey={name} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={2} />;
              })}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Click Run to simulate the model.
          </div>
        )}
      </div>
    </div>
  );
}
