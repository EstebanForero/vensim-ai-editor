import { addAuxiliary, addConstant, addFlow, addStock } from "@vensim-ai/core";
import { Circle, Droplet, FolderOpen, GitBranch, RotateCw, Save, Square, Waves } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadMdl, openMdlFilePicker } from "@/lib/fileIO";
import { SAMPLE_MODELS } from "@/lib/sampleModels";
import { useModelStore } from "@/state/modelStore";

let placeCounter = 0;
function nextPos() {
  placeCounter += 1;
  return { x: 120 + (placeCounter % 6) * 140, y: 120 + Math.floor(placeCounter / 6) * 100 };
}

export function Toolbar() {
  const model = useModelStore((s) => s.model);
  const mutate = useModelStore((s) => s.mutate);
  const setModel = useModelStore((s) => s.setModel);
  const select = useModelStore((s) => s.select);
  const relationMode = useModelStore((s) => s.relationMode);
  const toggleRelationMode = useModelStore((s) => s.toggleRelationMode);
  const showLoops = useModelStore((s) => s.showLoops);
  const toggleShowLoops = useModelStore((s) => s.toggleShowLoops);
  const [fileError, setFileError] = useState<string | null>(null);

  const addNamed = (fn: (m: typeof model) => void) => mutate(fn);

  const onAddStock = () =>
    addNamed((m) => {
      const v = addStock(m, { name: uniqueName(m, "Stock"), pos: nextPos() });
      select(v.id);
    });
  const onAddFlow = () =>
    addNamed((m) => {
      if (m.stocks.length === 0) {
        alert("Add a stock first — a flow needs at least one stock to connect to.");
        return;
      }
      const v = addFlow(m, { name: uniqueName(m, "Flow"), to: m.stocks[0]!.id, pos: nextPos() });
      select(v.id);
    });
  const onAddAux = () =>
    addNamed((m) => {
      const v = addAuxiliary(m, { name: uniqueName(m, "Auxiliary"), equation: "0", pos: nextPos() });
      select(v.id);
    });
  const onAddConst = () =>
    addNamed((m) => {
      const v = addConstant(m, { name: uniqueName(m, "Constant"), value: 1, pos: nextPos() });
      select(v.id);
    });

  return (
    <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
      <Input
        className="h-8 w-48"
        value={model.name}
        onChange={(e) => mutate((m) => (m.name = e.target.value))}
        placeholder="Model name"
      />
      <div className="mx-1 h-5 w-px bg-border" />
      <Button size="sm" variant="outline" onClick={onAddStock} title="Add Stock">
        <Square className="size-4" /> Stock
      </Button>
      <Button size="sm" variant="outline" onClick={onAddFlow} title="Add Flow">
        <Droplet className="size-4" /> Flow
      </Button>
      <Button size="sm" variant="outline" onClick={onAddAux} title="Add Auxiliary">
        <Waves className="size-4" /> Auxiliary
      </Button>
      <Button size="sm" variant="outline" onClick={onAddConst} title="Add Constant">
        <Circle className="size-4" /> Constant
      </Button>
      <Button
        size="sm"
        variant={relationMode ? "default" : "outline"}
        onClick={toggleRelationMode}
        title="Click two variables in sequence to draw a signed causal relation between them (also usable for pure causal-loop diagrams — no stocks/flows needed)"
      >
        <GitBranch className="size-4" /> Relation
      </Button>
      <Button
        size="sm"
        variant={showLoops ? "default" : "outline"}
        onClick={toggleShowLoops}
        title="Auto-detect feedback loops and label them R (Reinforcing) / B (Balancing)"
      >
        <RotateCw className="size-4" /> Loops
      </Button>

      <div className="mx-1 h-5 w-px bg-border" />
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        defaultValue=""
        onChange={(e) => {
          const sample = SAMPLE_MODELS.find((s) => s.name === e.target.value);
          if (sample) setModel(sample.build());
          e.target.value = "";
        }}
      >
        <option value="" disabled>
          New from template…
        </option>
        {SAMPLE_MODELS.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-2">
        {fileError && <span className="text-xs text-destructive">{fileError}</span>}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => openMdlFilePicker((m) => setModel(m), (err) => setFileError(err))}
        >
          <FolderOpen className="size-4" /> Open .mdl
        </Button>
        <Button size="sm" variant="ghost" onClick={() => downloadMdl(model)}>
          <Save className="size-4" /> Save .mdl
        </Button>
      </div>
    </div>
  );
}

function uniqueName(model: { stocks: { name: string }[]; flows: { name: string }[]; auxiliaries: { name: string }[] }, base: string): string {
  const all = new Set([...model.stocks, ...model.flows, ...model.auxiliaries].map((v) => v.name));
  if (!all.has(base)) return base;
  let i = 2;
  while (all.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}
