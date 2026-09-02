import { deleteElement, findVariable, renameVariable, setEquation } from "@vensim-ai/core";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useModelStore } from "@/state/modelStore";

export function Inspector() {
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
