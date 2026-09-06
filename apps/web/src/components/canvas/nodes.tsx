import { renameVariable, setCommentText, type Auxiliary, type Comment, type Flow, type Loop, type Stock } from "@vensim-ai/core";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Droplet, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useModelStore } from "@/state/modelStore";

export interface StockNodeData extends Record<string, unknown> {
  variable: Stock;
  selected: boolean;
  editing: boolean;
}
export interface FlowNodeData extends Record<string, unknown> {
  variable: Flow;
  selected: boolean;
  editing: boolean;
}
export interface AuxNodeData extends Record<string, unknown> {
  variable: Auxiliary;
  selected: boolean;
  editing: boolean;
}
export interface LoopNodeData extends Record<string, unknown> {
  loop: Loop;
  names: string[];
}
export interface CommentNodeData extends Record<string, unknown> {
  comment: Comment;
  selected: boolean;
  editing: boolean;
}

const handleStyle = { width: 8, height: 8, opacity: 0 };

const SIDES: { side: "top" | "right" | "bottom" | "left"; position: Position }[] = [
  { side: "top", position: Position.Top },
  { side: "right", position: Position.Right },
  { side: "bottom", position: Position.Bottom },
  { side: "left", position: Position.Left },
];

/** A target+source handle pair on every side, so an edge can attach to whichever side of this
 * node is actually closest to the other end (see edgeRouting.ts's closestSides) instead of
 * being forced through one fixed left/right pair regardless of where the other node sits. */
function AllSideHandles() {
  return SIDES.flatMap(({ side, position }) => [
    <Handle key={`${side}-target`} type="target" position={position} id={`${side}-target`} style={handleStyle} />,
    <Handle key={`${side}-source`} type="source" position={position} id={`${side}-source`} style={handleStyle} />,
  ]);
}

/**
 * A variable's name, editable in place. `editing` is driven by FlowCanvas's
 * onNodeDoubleClick (React Flow's own double-click detection on the node, not a raw DOM
 * `dblclick` here) — a plain DOM listener on this span would have its second click's mousedown
 * swallowed by React Flow's node-drag pointer handling before the browser ever recognizes it
 * as a double-click, so editing state has to be driven from outside where drag and
 * double-click are already reconciled.
 */
function EditableLabel({ id, name, editing, className }: { id: string; name: string; editing: boolean; className?: string }) {
  const mutate = useModelStore((s) => s.mutate);
  const setEditingId = useModelStore((s) => s.setEditingId);
  const [value, setValue] = useState(name);

  useEffect(() => {
    if (editing) setValue(name);
  }, [editing, name]);

  const commit = () => {
    setEditingId(null);
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) return;
    try {
      mutate((m) => renameVariable(m, id, trimmed));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };
  const cancel = () => {
    setEditingId(null);
    setValue(name);
  };

  if (editing) {
    return (
      <input
        autoFocus
        className={cn("nodrag min-w-0 rounded border-0 bg-transparent text-center outline-none ring-1 ring-primary", className)}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return <span className={cn("whitespace-nowrap", className)}>{name}</span>;
}

export function StockNode({ data }: NodeProps & { data: StockNodeData }) {
  const { variable, selected, editing } = data;
  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center border-2 bg-[var(--stock-fill)] px-2 text-center text-xs font-medium",
        selected ? "border-primary ring-2 ring-primary/40" : "border-[var(--stock-border)]",
      )}
      style={{ minWidth: 90, minHeight: 45 }}
    >
      <AllSideHandles />
      <EditableLabel id={variable.id} name={variable.name} editing={editing} className="line-clamp-2" />
    </div>
  );
}

export function FlowNode({ data }: NodeProps & { data: FlowNodeData }) {
  const { variable, selected, editing } = data;
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full border bg-background px-2 py-1 text-[11px] font-medium text-[var(--flow-color)] shadow-sm",
        selected ? "border-primary ring-2 ring-primary/40" : "border-[var(--flow-color)]",
      )}
    >
      <AllSideHandles />
      <Droplet className="size-3" />
      <EditableLabel id={variable.id} name={variable.name} editing={editing} />
    </div>
  );
}

/** Auto-detected feedback-loop badge: R (Reinforcing) or B (Balancing), with an icon showing
 * the loop's visual rotation as laid out on the canvas. Not draggable/selectable — it's a
 * read-only annotation computed from the current diagram, not an editable element. */
export function LoopNode({ data }: NodeProps & { data: LoopNodeData }) {
  const { loop, names } = data;
  const isReinforcing = loop.polarity === "R";
  const RotateIcon = loop.direction === "clockwise" ? RotateCw : RotateCcw;
  return (
    <div
      title={`${loop.polarity}${loop.number} — ${isReinforcing ? "Reinforcing" : "Balancing"} loop (${loop.direction}): ${names.join(" → ")}`}
      className={cn(
        "flex items-center gap-1 rounded-full border-2 px-1.5 py-1 text-xs font-bold shadow-md",
        isReinforcing
          ? "border-[var(--loop-r-color)] bg-[var(--loop-r-color)]/15 text-[var(--loop-r-color)]"
          : "border-[var(--loop-b-color)] bg-[var(--loop-b-color)]/15 text-[var(--loop-b-color)]",
      )}
    >
      <RotateIcon className="size-3.5" />
      <span>
        {loop.polarity}
        {loop.number}
      </span>
    </div>
  );
}

/** A freestanding text annotation. Double-click to edit inline (see EditableLabel's comment
 * on why `editing` is driven by FlowCanvas rather than a DOM dblclick here); also
 * editable/deletable from the Inspector when selected. */
export function CommentNode({ data }: NodeProps & { data: CommentNodeData }) {
  const { comment, selected, editing } = data;
  const mutate = useModelStore((s) => s.mutate);
  const setEditingId = useModelStore((s) => s.setEditingId);
  const [value, setValue] = useState(comment.text);

  useEffect(() => {
    if (editing) setValue(comment.text);
  }, [editing, comment.text]);

  const commit = () => {
    setEditingId(null);
    mutate((m) => setCommentText(m, comment.id, value));
  };

  return (
    <div
      className={cn(
        "h-full w-full rounded-md border border-dashed bg-[var(--comment-bg)] p-2 text-xs italic",
        selected ? "border-primary border-solid ring-2 ring-primary/40" : "border-[var(--comment-border)]",
      )}
      style={{ minWidth: 140, minHeight: 50 }}
    >
      {editing ? (
        <textarea
          autoFocus
          className="nodrag h-full w-full resize-none bg-transparent text-xs outline-none not-italic"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="whitespace-pre-wrap">{comment.text}</span>
      )}
    </div>
  );
}

export function AuxNode({ data }: NodeProps & { data: AuxNodeData }) {
  const { variable, selected, editing } = data;
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full border border-dashed bg-background px-3 py-1.5 text-[11px] text-[var(--aux-color)]",
        selected && "border-primary border-solid ring-2 ring-primary/40",
      )}
    >
      <AllSideHandles />
      <EditableLabel id={variable.id} name={variable.name} editing={editing} />
    </div>
  );
}
