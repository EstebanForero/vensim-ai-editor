import { addConnector, moveElement } from "@vensim-ai/core";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import { useEffect } from "react";
import { useModelStore } from "@/state/modelStore";
import { buildGraph } from "./graph";
import { AuxNode, FlowNode, StockNode } from "./nodes";

const nodeTypes = { stock: StockNode, flow: FlowNode, aux: AuxNode };

export function FlowCanvas() {
  const model = useModelStore((s) => s.model);
  const selectedId = useModelStore((s) => s.selectedId);
  const select = useModelStore((s) => s.select);
  const mutate = useModelStore((s) => s.mutate);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(model, selectedId);
    setNodes(n);
    setEdges(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, selectedId]);

  const onNodeClick: NodeMouseHandler = (_evt, node) => select(node.id);
  const onPaneClick = () => select(null);

  const onNodeDragStop: OnNodeDrag<Node> = (_evt, node) => {
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

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
      >
        <Background gap={20} />
        <Controls />
        <MiniMap pannable zoomable className="!bg-card" />
      </ReactFlow>
    </div>
  );
}
