import { addAuxiliary, addComment, addStock, annotateLoops, autoLayout } from "@vensim-ai/core";
import { useReactFlow } from "@xyflow/react";
import {
  Droplet,
  FolderOpen,
  GitBranch,
  LayoutGrid,
  MessageSquarePlus,
  MessageSquareText,
  Ruler,
  RotateCw,
  Save,
  Square,
  Waves,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadMdl, downloadXmile, openMdlFilePicker } from "@/lib/fileIO";
import { uniqueName } from "@/lib/naming";
import { SAMPLE_MODELS } from "@/lib/sampleModels";
import { useModelStore } from "@/state/modelStore";
import { UnitsCheckDialog } from "./UnitsCheckDialog";

export function Toolbar() {
  const model = useModelStore((s) => s.model);
  const mutate = useModelStore((s) => s.mutate);
  const setModel = useModelStore((s) => s.setModel);
  const select = useModelStore((s) => s.select);
  const relationMode = useModelStore((s) => s.relationMode);
  const toggleRelationMode = useModelStore((s) => s.toggleRelationMode);
  const flowMode = useModelStore((s) => s.flowMode);
  const toggleFlowMode = useModelStore((s) => s.toggleFlowMode);
  const showLoops = useModelStore((s) => s.showLoops);
  const toggleShowLoops = useModelStore((s) => s.toggleShowLoops);
  const runUnitsCheck = useModelStore((s) => s.runUnitsCheck);
  const [fileError, setFileError] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  // Ctrl+U (or Cmd+U on Mac) — matches Vensim's own Units Check shortcut. The browser's default
  // "view page source" action for Ctrl+U is what needs preventDefault here.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
        e.preventDefault();
        runUnitsCheck();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runUnitsCheck]);

  const addNamed = (fn: (m: typeof model) => void) => mutate(fn);

  const onAutoLayout = () => {
    mutate((m) => autoLayout(m));
    requestAnimationFrame(() => fitView({ duration: 300, padding: 0.2 }));
  };

  const onAnnotateLoops = () => mutate((m) => annotateLoops(m));

  const onAddStock = () =>
    addNamed((m) => {
      const v = addStock(m, { name: uniqueName(m, "Stock") });
      select(v.id);
    });
  const onAddAux = () =>
    addNamed((m) => {
      // A fresh auxiliary defaults to a plain number, which already reads as a constant per
      // isConstantAuxiliary — there's no separate "Constant" element to pick, matching Vensim.
      const v = addAuxiliary(m, { name: uniqueName(m, "Variable"), equation: "1" });
      select(v.id);
    });
  const onAddComment = () =>
    addNamed((m) => {
      const c = addComment(m, { text: "Comment" });
      select(c.id);
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
      <Button
        size="sm"
        variant={flowMode ? "default" : "outline"}
        onClick={toggleFlowMode}
        title="Click a source, then a destination, to draw a flow — a stock or empty canvas (a cloud) for either end, so direction and which stock are always explicit"
      >
        <Droplet className="size-4" /> Flow
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onAddAux}
        title="Add a variable — a plain number reads as a constant, an equation referencing others makes it computed, just like Vensim"
      >
        <Waves className="size-4" /> Variable
      </Button>
      <Button size="sm" variant="outline" onClick={onAddComment} title="Add a freestanding text comment/annotation">
        <MessageSquarePlus className="size-4" /> Comment
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
      <Button
        size="sm"
        variant="outline"
        onClick={onAutoLayout}
        title="Automatically re-arrange every stock/flow/auxiliary into a tidy layered layout based on their flow and causal connections, then fit the view"
      >
        <LayoutGrid className="size-4" /> Auto Layout
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onAnnotateLoops}
        title={`Auto-generate one text annotation per feedback loop (e.g. "R1 loop: Population → Births → Population"), using each element's own name — re-running replaces this tool's own earlier annotations to match the model's current loops, and never touches a comment you wrote by hand`}
      >
        <MessageSquareText className="size-4" /> Annotate Loops
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={runUnitsCheck}
        title="Check units (Ctrl+U) — a structural check of every equation's units against its variable's declared units, the same idea as Vensim's own Units Check"
      >
        <Ruler className="size-4" /> Check Units
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
        <Button
          size="sm"
          variant="ghost"
          onClick={() => downloadXmile(model)}
          title="Export as XMILE (the OASIS open standard) — Vensim can open this directly (File > Open, XMILE filter), and it sidesteps the .mdl format's undocumented flow-valve attachment quirk"
        >
          <Save className="size-4" /> Save .xmile
        </Button>
      </div>

      <UnitsCheckDialog />
    </div>
  );
}
