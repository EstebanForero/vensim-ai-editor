import { lookupEquation, normalizeLookupTable, tableFromPoints, type LookupTable } from "@vensim-ai/core";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { lookupCurvePoints } from "@/components/charts/LookupSparkline";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The lookup's own identity color, matching the canvas node and the inspector's curve card — the
// same curve should look like the same thing everywhere it appears.
const CURVE_COLOR = "var(--lookup-color)";

/** Rows are held as strings, not numbers, so a half-typed entry ("-", "0.", "") doesn't get
 * clobbered mid-keystroke — the numbers are derived on every render and validated on Apply. */
interface DraftRow {
  x: string;
  y: string;
}

export interface LookupDraft {
  rows: DraftRow[];
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
}

function toDraft(table: LookupTable | null): LookupDraft {
  const t = table ?? tableFromPoints([{ x: 0, y: 0 }, { x: 10, y: 1 }]);
  return {
    rows: t.points.map((p) => ({ x: String(p.x), y: String(p.y) })),
    xMin: String(t.xMin),
    xMax: String(t.xMax),
    yMin: String(t.yMin),
    yMax: String(t.yMax),
  };
}

function parseDraft(draft: LookupDraft): { table: LookupTable | null; error: string | null } {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < draft.rows.length; i++) {
    const x = Number(draft.rows[i]!.x);
    const y = Number(draft.rows[i]!.y);
    if (draft.rows[i]!.x.trim() === "" || draft.rows[i]!.y.trim() === "" || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { table: null, error: `Row ${i + 1} needs a numeric input and output.` };
    }
    points.push({ x, y });
  }
  if (points.length === 0) return { table: null, error: "Add at least one row." };

  const axis = {
    xMin: Number(draft.xMin),
    xMax: Number(draft.xMax),
    yMin: Number(draft.yMin),
    yMax: Number(draft.yMax),
  };
  for (const [key, value] of Object.entries(axis)) {
    if (!Number.isFinite(value)) return { table: null, error: `Axis limit ${key} must be a number.` };
  }
  // normalizeLookupTable sorts by input and widens the limits to contain the data — Vensim
  // requires strictly increasing inputs, and an axis range that excludes the curve would draw a
  // graph whose own points fall outside its own axes.
  return { table: normalizeLookupTable({ points, ...axis }), error: null };
}

/**
 * Vensim's own graphical-function editor: the curve as an Input/Output table plus the four axis
 * limits, with the equation it generates shown underneath. The equation is the real artifact —
 * a lookup is stored as exactly that text (see core's model/lookup.ts), so what this dialog
 * writes is what a Vensim user would have typed, and what other equations call as `Name(input)`.
 */
export function LookupEditorDialog({
  open,
  onOpenChange,
  variableName,
  table,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variableName: string;
  /** The variable's current curve, or null when converting a plain equation into a lookup. */
  table: LookupTable | null;
  onApply: (table: LookupTable) => void;
}) {
  const [draft, setDraft] = useState<LookupDraft>(() => toDraft(table));

  // Seed on OPEN, and only on open — keyed on `open` alone, deliberately. `table` is re-parsed
  // from the model on every render of the inspector, so depending on it would reset the draft
  // (losing whatever the user had typed) on any unrelated re-render while the dialog is up. The
  // ref carries the current value without making the effect depend on it.
  const tableRef = useRef(table);
  tableRef.current = table;
  useEffect(() => {
    if (open) setDraft(toDraft(tableRef.current));
  }, [open]);

  const parsed = useMemo(() => parseDraft(draft), [draft]);

  const patchRow = (i: number, patch: Partial<DraftRow>) =>
    setDraft((d) => ({ ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRow = () => setDraft((d) => ({ ...d, rows: [...d.rows, { x: "", y: "" }] }));
  const removeRow = (i: number) => setDraft((d) => ({ ...d, rows: d.rows.filter((_, j) => j !== i) }));

  // The curve is piecewise linear, so the plotted points ARE the curve — no sampling, and the
  // dots land exactly on the values in the table. lookupCurvePoints extends it flat to the axis
  // edges, which is how the curve actually behaves outside the data (it holds its ends).
  const chartData = useMemo(() => (parsed.table ? lookupCurvePoints(parsed.table) : []), [parsed.table]);

  const rows = draft.rows;
  const axisField = (key: "xMin" | "xMax" | "yMin" | "yMax", label: string) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        className="h-8"
        value={draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Lookup table — {variableName}</DialogTitle>
          <DialogDescription>
            A piecewise-linear curve from an input to an output. Interpolated between the points you give, and held at
            the first/last output beyond either end.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Axis limits</Label>
          <div className="grid grid-cols-4 gap-2">
            {axisField("xMin", "X min")}
            {axisField("xMax", "X max")}
            {axisField("yMin", "Y min")}
            {axisField("yMax", "Y max")}
          </div>
          <p className="text-xs text-muted-foreground">
            The range Vensim draws the graph over — widened automatically if a point falls outside it.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Points</Label>
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="size-3.5" /> Add
              </Button>
            </div>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1">
                <span className="text-[11px] font-medium text-muted-foreground">Input</span>
                <span className="text-[11px] font-medium text-muted-foreground">Output</span>
                <span className="w-8" />
              </div>
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <Input
                    type="number"
                    className="h-8"
                    value={row.x}
                    onChange={(e) => patchRow(i, { x: e.target.value })}
                    aria-label={`Input ${i + 1}`}
                  />
                  <Input
                    type="number"
                    className="h-8"
                    value={row.y}
                    onChange={(e) => patchRow(i, { y: e.target.value })}
                    aria-label={`Output ${i + 1}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    onClick={() => removeRow(i)}
                    disabled={rows.length <= 1}
                    title="Remove point"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Curve</Label>
            <div className="h-64 rounded-md border p-2">
              {parsed.table ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={[parsed.table.xMin, parsed.table.xMax]}
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                    />
                    <YAxis
                      dataKey="y"
                      type="number"
                      domain={[parsed.table.yMin, parsed.table.yMax]}
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(value) => [String(value), "Output"]}
                      labelFormatter={(x) => `Input ${String(x)}`}
                    />
                    <Line
                      dataKey="y"
                      stroke={CURVE_COLOR}
                      strokeWidth={2}
                      dot={{ r: 4, fill: CURVE_COLOR, stroke: "var(--background)", strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="p-2 text-xs text-muted-foreground">Fix the table to see the curve.</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Dots are the points you gave; the line is the interpolation.</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Generated equation
          </Label>
          <pre className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
            {parsed.table ? lookupEquation(parsed.table) : "—"}
          </pre>
          <p className="text-xs text-muted-foreground">
            Other equations use this curve as a function of their own input:{" "}
            <code className="font-mono">{variableName}(Input)</code>. Points are stored sorted by input.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {parsed.error && <p className="mr-auto text-xs text-destructive">{parsed.error}</p>}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={!parsed.table}
              onClick={() => {
                if (parsed.table) onApply(parsed.table);
                onOpenChange(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
