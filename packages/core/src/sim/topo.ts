import { ModelError } from "../model/errors.js";

export interface TopoNode {
  id: string;
  /** Ids of other nodes in the same set that this node's equation depends on. */
  dependsOn: string[];
}

/** Topologically sorts nodes so dependencies are evaluated before dependents. Throws on cycles. */
export function topoSort(nodes: TopoNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();

  function visit(id: string, path: string[]): void {
    const st = state.get(id);
    if (st === "done") return;
    if (st === "visiting") {
      throw new ModelError(`Circular dependency detected: ${[...path, id].join(" -> ")}`);
    }
    state.set(id, "visiting");
    const node = byId.get(id);
    if (node) {
      for (const dep of node.dependsOn) {
        if (byId.has(dep)) visit(dep, [...path, id]);
      }
    }
    state.set(id, "done");
    order.push(id);
  }

  for (const n of nodes) visit(n.id, []);
  return order;
}
