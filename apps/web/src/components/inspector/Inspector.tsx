import {
  allVariables,
  deleteComment,
  deleteElement,
  findVariable,
  renameVariable,
  setCommentText,
  setConnectorPolarity,
  setEquation,
  setFlowEndpoint,
  variableRelationships,
  type Polarity,
} from "@vensim-ai/core";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useModelStore } from "@/state/modelStore";
import { EquationInput } from "./EquationInput";

export function Inspector() {
  const model = useModelStore((s) => s.model);
  const selectedId = useModelStore((s) => s.selectedId);

  const connector = selectedId ? model.connectors.find((c) => c.id === selectedId) : undefined;
  if (connector) return <RelationInspector connectorId={connector.id} />;

  const comment = selectedId ? model.comments.find((c) => c.id === selectedId) : undefined;
  if (comment) return <CommentInspector commentId={comment.id} />;

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

      <p className="text-xs text-muted-foreground">
        Drag the small circle on the relation's curve (on the canvas) to bend it; double-click the circle to reset
        to the automatic curve.
      </p>
    </div>
  );
}

function CommentInspector({ commentId }: { commentId: string }) {
  const model = useModelStore((s) => s.model);
  const select = useModelStore((s) => s.select);
  const mutate = useModelStore((s) => s.mutate);

  const comment = model.comments.find((c) => c.id === commentId);
  const [text, setText] = useState(comment?.text ?? "");
  useEffect(() => setText(comment?.text ?? ""), [comment?.text]);
  if (!comment) return null;

  const onChange = (value: string) => {
    setText(value);
    mutate((m) => setCommentText(m, commentId, value));
  };
  const onDelete = () => {
    mutate((m) => deleteComment(m, commentId));
    select(null);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Comment</span>
        <Button variant="ghost" size="icon" onClick={onDelete} title="Delete">
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="comment-text">Text</Label>
        <Textarea id="comment-text" value={text} onChange={(e) => onChange(e.target.value)} rows={4} />
      </div>
      <p className="text-xs text-muted-foreground">
        A freestanding annotation — not tied to any variable's equation. Double-click it directly on the canvas to
        edit it there too.
      </p>
    </div>
  );
}

const CLOUD = "__cloud__";

/**
 * A flow's From/To stocks, made visible and directly editable — until now the only way to see
 * whether a flow was genuinely wired to a stock (vs. a cloud, vs. accidentally disconnected on
 * both ends) was the raw equation text in the "Text" tab. A flow that looks connected on the
 * canvas because it happens to sit next to a stock, but isn't actually linked, shows up here as
 * "Cloud" on both sides instead — and can be fixed right here rather than deleted/recreated.
 */
function FlowEndpoints({ flowId }: { flowId: string }) {
  const model = useModelStore((s) => s.model);
  const mutate = useModelStore((s) => s.mutate);
  const flow = model.flows.find((f) => f.id === flowId);
  if (!flow) return null;

  const setEnd = (which: "from" | "to", value: string) => {
    try {
      mutate((m) => setFlowEndpoint(m, flowId, which, value === CLOUD ? null : value));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const Select = ({ which, value }: { which: "from" | "to"; value: string | null }) => (
    <select
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      value={value ?? CLOUD}
      onChange={(e) => setEnd(which, e.target.value)}
    >
      <option value={CLOUD}>Cloud (unconnected)</option>
      {model.stocks.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Connects</Label>
      <div className="flex items-center gap-2">
        <span className="w-8 text-xs text-muted-foreground">From</span>
        <Select which="from" value={flow.from} />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-8 text-xs text-muted-foreground">To</span>
        <Select which="to" value={flow.to} />
      </div>
      {!flow.from && !flow.to && (
        <p className="text-xs text-destructive">
          Not connected to any stock — this flow won't do anything, and exports as two disconnected clouds.
        </p>
      )}
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

  // Renaming live (on every keystroke) reflects on the canvas immediately, matching the other
  // fields below. renameVariable enforces name uniqueness, so an in-progress/duplicate value
  // is simply not committed yet rather than surfacing an error on every keystroke — commitName
  // (on blur) reports it if it's still invalid once the user is done typing.
  const onNameChange = (value: string) => {
    setName(value);
    const trimmed = value.trim();
    if (!trimmed || trimmed === variable.name) return;
    try {
      mutate((m) => renameVariable(m, variable.id, trimmed));
    } catch {
      // keep typing — reported on blur if it's still invalid then
    }
  };
  const commitNameOnBlur = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(variable.name);
      return;
    }
    if (trimmed !== variable.name) {
      try {
        mutate((m) => renameVariable(m, variable.id, trimmed));
      } catch (err) {
        setName(variable.name);
        alert(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const onEquationChange = (value: string) => {
    setEquationText(value);
    mutate((m) => setEquation(m, variable.id, value, variable.kind === "stock" ? "initial" : "equation"));
  };

  const onUnitsChange = (value: string) => {
    setUnits(value);
    mutate((m) => {
      const v = findVariable(m, variable.id);
      if (v) v.units = value;
    });
  };
  const onCommentChange = (value: string) => {
    setComment(value);
    mutate((m) => {
      const v = findVariable(m, variable.id);
      if (v) v.comment = value;
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
        <Input id="var-name" value={name} onChange={(e) => onNameChange(e.target.value)} onBlur={commitNameOnBlur} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="var-eq">{variable.kind === "stock" ? "Initial value" : "Equation"}</Label>
        <EquationInput
          id="var-eq"
          value={equation}
          onChange={onEquationChange}
          variables={allVariables(model)
            .filter((v) => v.id !== variable.id)
            .map((v) => ({ name: v.name, units: v.units }))}
          rows={3}
        />
        {variable.kind === "stock" && (
          <p className="text-xs text-muted-foreground">
            Inflows: {variable.inflows.map((id) => model.flows.find((f) => f.id === id)?.name ?? id).join(", ") || "none"} · Outflows:{" "}
            {variable.outflows.map((id) => model.flows.find((f) => f.id === id)?.name ?? id).join(", ") || "none"}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Start typing a name for suggestions — variables show their units, functions show a description.
        </p>
      </div>

      {variable.kind === "flow" && <FlowEndpoints flowId={variable.id} />}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="var-units">Units</Label>
        <Input id="var-units" value={units} onChange={(e) => onUnitsChange(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="var-comment">Comment</Label>
        <Textarea id="var-comment" value={comment} onChange={(e) => onCommentChange(e.target.value)} rows={2} />
      </div>

      <DependencyPanel variableId={variable.id} />
    </div>
  );
}

/** "Smart inspector": shows what this variable depends on and what depends on it — from its
 * equation and any causal-relation arrows — computed live, not stored, so it's never stale.
 * Constants (per isConstantAuxiliary) get a plain badge instead of an empty "Depends on" list,
 * since "has no equation dependencies" is exactly what makes something a constant here. */
function DependencyPanel({ variableId }: { variableId: string }) {
  const model = useModelStore((s) => s.model);
  const select = useModelStore((s) => s.select);
  const { dependsOn, usedBy, isConstant } = variableRelationships(model, variableId);

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      {isConstant && (
        <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Constant — no equation dependencies
        </span>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Depends on</Label>
        {dependsOn.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing — this variable's equation references no others.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {dependsOn.map((v) => (
              <button
                key={v.id}
                onClick={() => select(v.id)}
                className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-muted"
                title={`Jump to ${v.name}`}
              >
                {v.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Used by</Label>
        {usedBy.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing references this variable yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {usedBy.map((v) => (
              <button
                key={v.id}
                onClick={() => select(v.id)}
                className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-muted"
                title={`Jump to ${v.name}`}
              >
                {v.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
