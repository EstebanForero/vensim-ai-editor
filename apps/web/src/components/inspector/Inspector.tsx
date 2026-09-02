import { deleteElement, findVariable, renameVariable, setConnectorPolarity, setEquation, type Polarity } from "@vensim-ai/core";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useModelStore } from "@/state/modelStore";

export function Inspector() {
  const model = useModelStore((s) => s.model);
  const selectedId = useModelStore((s) => s.selectedId);

  const connector = selectedId ? model.connectors.find((c) => c.id === selectedId) : undefined;
  if (connector) return <RelationInspector connectorId={connector.id} />;

  return <VariableInspector />;
}

function RelationInspector({ connectorId }: { connectorId: string }) {
  const model = useModelStore((s) => s.model);
  const select = useModelStore((s) => s.select);
  const mutate = useModelStore((s) => s.mutate);

  const connector = model.connectors.find((c) => c.id === connectorId);
  if (!connector) return null;
  const fromName = findVariable(model, connector.from)?.name ?? connector.from;
  const toName = findVariable(model, connector.to)?.name ?? connector.to;

  const setPolarity = (p: Polarity) => mutate((m) => setConnectorPolarity(m, connectorId, p));
  const onDelete = () => {
    mutate((m) => deleteElement(m, connectorId));
    select(null);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Relation</span>
        <Button variant="ghost" size="icon" onClick={onDelete} title="Delete">
          <Trash2 className="size-4" />
        </Button>
      </div>

      <p className="text-sm">
        <span className="font-medium">{fromName}</span> <span className="text-muted-foreground">→</span>{" "}
        <span className="font-medium">{toName}</span>
      </p>

      <div className="flex flex-col gap-1.5">
        <Label>Polarity</Label>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className={cn(connector.polarity === "+" && "border-primary bg-primary/10")}
            onClick={() => setPolarity("+")}
          >
            + (increases)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={cn(connector.polarity === "-" && "border-primary bg-primary/10")}
            onClick={() => setPolarity("-")}
          >
            − (decreases)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Whether an increase in {fromName} tends to increase or decrease {toName}. Used to auto-detect Reinforcing
          (R) vs. Balancing (B) feedback loops.
        </p>
      </div>
    </div>
  );
}

function VariableInspector() {
  const model = useModelStore((s) => s.model);
  const selectedId = useModelStore((s) => s.selectedId);
  const select = useModelStore((s) => s.select);
  const mutate = useModelStore((s) => s.mutate);

  const variable = selectedId ? findVariable(model, selectedId) : undefined;

  const [name, setName] = useState("");
  const [equation, setEquationText] = useState("");
  const [units, setUnits] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!variable) return;
    setName(variable.name);
    setUnits(variable.units);
    setComment(variable.comment);
    setEquationText(variable.kind === "stock" ? variable.initialEquation : variable.equation);
  }, [variable]);

  if (!variable) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a stock, flow, or auxiliary on the canvas to edit its equation, or ask the AI assistant to build part
        of the model.
      </div>
    );
  }

  const commitName = () => {
    if (name.trim() && name !== variable.name) {
      try {
        mutate((m) => renameVariable(m, variable.id, name.trim()));
      } catch (err) {
        setName(variable.name);
        alert(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const commitEquation = () => {
    try {
      mutate((m) => setEquation(m, variable.id, equation, variable.kind === "stock" ? "initial" : "equation"));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const commitUnitsComment = () => {
    mutate((m) => {
      const v = findVariable(m, variable.id);
      if (v) {
        v.units = units;
        v.comment = comment;
      }
    });
  };

  const onDelete = () => {
    mutate((m) => deleteElement(m, variable.id));
    select(null);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{variable.kind}</span>
        <Button variant="ghost" size="icon" onClick={onDelete} title="Delete">
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="var-name">Name</Label>
        <Input id="var-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="var-eq">{variable.kind === "stock" ? "Initial value" : "Equation"}</Label>
        <Textarea id="var-eq" value={equation} onChange={(e) => setEquationText(e.target.value)} onBlur={commitEquation} rows={3} />
        {variable.kind === "stock" && (
          <p className="text-xs text-muted-foreground">
            Inflows: {variable.inflows.length} · Outflows: {variable.outflows.length}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="var-units">Units</Label>
        <Input id="var-units" value={units} onChange={(e) => setUnits(e.target.value)} onBlur={commitUnitsComment} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="var-comment">Comment</Label>
        <Textarea id="var-comment" value={comment} onChange={(e) => setComment(e.target.value)} onBlur={commitUnitsComment} rows={2} />
      </div>
    </div>
  );
}
