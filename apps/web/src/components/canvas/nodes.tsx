import type { Auxiliary, Flow, Loop, Stock } from "@vensim-ai/core";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Droplet, RotateCcw, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StockNodeData extends Record<string, unknown> {
  variable: Stock;
  selected: boolean;
}
export interface FlowNodeData extends Record<string, unknown> {
  variable: Flow;
  selected: boolean;
}
export interface AuxNodeData extends Record<string, unknown> {
  variable: Auxiliary;
  selected: boolean;
}
export interface LoopNodeData extends Record<string, unknown> {
  loop: Loop;
  names: string[];
}

const handleStyle = { width: 8, height: 8, opacity: 0 };

export function StockNode({ data }: NodeProps & { data: StockNodeData }) {
  const { variable, selected } = data;
  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center border-2 bg-[var(--stock-fill)] px-2 text-center text-xs font-medium",
        selected ? "border-primary ring-2 ring-primary/40" : "border-[var(--stock-border)]",
      )}
      style={{ minWidth: 90, minHeight: 45 }}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <span className="line-clamp-2">{variable.name}</span>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

export function FlowNode({ data }: NodeProps & { data: FlowNodeData }) {
  const { variable, selected } = data;
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full border bg-background px-2 py-1 text-[11px] font-medium text-[var(--flow-color)] shadow-sm",
        selected ? "border-primary ring-2 ring-primary/40" : "border-[var(--flow-color)]",
      )}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <Droplet className="size-3" />
      <span className="whitespace-nowrap">{variable.name}</span>
      <Handle type="source" position={Position.Right} style={handleStyle} />
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
      title={`${isReinforcing ? "Reinforcing" : "Balancing"} loop (${loop.direction}): ${names.join(" → ")}`}
      className={cn(
        "flex items-center gap-1 rounded-full border-2 px-1.5 py-1 text-xs font-bold shadow-md",
        isReinforcing
          ? "border-[var(--loop-r-color)] bg-[var(--loop-r-color)]/15 text-[var(--loop-r-color)]"
          : "border-[var(--loop-b-color)] bg-[var(--loop-b-color)]/15 text-[var(--loop-b-color)]",
      )}
    >
      <RotateIcon className="size-3.5" />
      <span>{loop.polarity}</span>
    </div>
  );
}

export function AuxNode({ data }: NodeProps & { data: AuxNodeData }) {
  const { variable, selected } = data;
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full border border-dashed bg-background px-3 py-1.5 text-[11px] text-[var(--aux-color)]",
        selected && "border-primary border-solid ring-2 ring-primary/40",
      )}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <span className="whitespace-nowrap">
        {variable.name}
        {variable.isConstant ? "" : ""}
      </span>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}
