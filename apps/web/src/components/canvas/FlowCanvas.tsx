import { addConnector, deleteComment, deleteElement, detectLoops, moveComment, moveElement, type Loop } from "@vensim-ai/core";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import { useModelStore } from "@/state/modelStore";
import { buildGraph } from "./graph";
import { AuxNode, CommentNode, FlowNode, LoopNode, StockNode } from "./nodes";
import { RelationEdge } from "./RelationEdge";

const nodeTypes = { stock: StockNode, flow: FlowNode, aux: AuxNode, loop: LoopNode, comment: CommentNode };
const edgeTypes = { relation: RelationEdge };

export function FlowCanvas() {
  const model = useModelStore((s) => s.model);
  const selectedId = useModelStore((s) => s.selectedId);
  const select = useModelStore((s) => s.select);
  const mutate = useModelStore((s) => s.mutate);
  const showLoops = useModelStore((s) => s.showLoops);
  const relationMode = useModelStore((s) => s.relationMode);
  const pendingRelationFrom = useModelStore((s) => s.pendingRelationFrom);
  const setPendingRelationFrom = useModelStore((s) => s.setPendingRelationFrom);
  const editingId = useModelStore((s) => s.editingId);
  const setEditingId = useModelStore((s) => s.setEditingId);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const loops: Loop[] = useMemo(() => (showLoops ? detectLoops(model) : []), [model, showLoops]);

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(model, selectedId, loops, editingId);
    setNodes(n);
    setEdges(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, selectedId, loops, editingId]);

  const onNodeDoubleClick: NodeMouseHandler = (_evt, node) => {
    if (node.type === "stock" || node.type === "flow" || node.type === "aux" || node.type === "comment") {
      setEditingId(node.id);
    }
  };

  const onNodeClick: NodeMouseHandler = (_evt, node) => {
    if (node.type === "loop") return;
    if (relationMode && node.type !== "comment") {
      if (!pendingRelationFrom) {
        setPendingRelationFrom(node.id);
      } else if (pendingRelationFrom === node.id) {
        setPendingRelationFrom(null);
      } else {
        try {
          mutate((m) => addConnector(m, { from: pendingRelationFrom, to: node.id }));
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        }
        setPendingRelationFrom(null);
      }
      return;
    }
    select(node.id);
  };

  const onEdgeClick: EdgeMouseHandler = (_evt, edge) => {
    if (edge.data?.connector) select(edge.id);
  };

  const onPaneClick = () => {
    select(null);
    if (relationMode) setPendingRelationFrom(null);
  };

  const onNodeDragStop: OnNodeDrag<Node> = (_evt, node) => {
    if (node.type === "loop") return;
    if (node.type === "comment") {
      mutate((m) => moveComment(m, node.id, { x: node.position.x, y: node.position.y }));
      return;
    }
    mutate((m) => moveElement(m, node.id, { x: node.position.x, y: node.position.y }));
  };

  const onConnect = (conn: Connection) => {
    if (!conn.source || !conn.target) return;
    try {
      mutate((m) => addConnector(m, { from: conn.source!, to: conn.target! }));
    } catch {
      // ignore invalid connections (e.g. dangling handles)
    }
  };

  // Delete/Backspace removes the currently-selected element (our own selectedId, not React
  // Flow's built-in node.selected — that gets discarded every time buildGraph rebuilds the
  // nodes array from the model, so RF's own deleteKeyCode wiring wouldn't stay in sync with
  // what's actually selected). Guarded so Backspace inside a text field still edits text.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (!selectedId) return;
      e.preventDefault();
      mutate((m) => {
        if (m.comments.some((c) => c.id === selectedId)) deleteComment(m, selectedId);
        else deleteElement(m, selectedId);
      });
      select(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, mutate, select]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        selectNodesOnDrag={false}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
      >
        <Background gap={20} />
        <Controls />
        <MiniMap pannable zoomable className="!bg-card" />
        {relationMode && (
          <Panel position="top-center" className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
            {pendingRelationFrom ? "Click the target variable to complete the relation…" : "Click the source variable for a new relation…"}
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
