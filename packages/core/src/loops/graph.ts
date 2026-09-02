import { allVariables, type Model } from "../model/types.js";

export interface SignedEdge {
  to: string;
  sign: 1 | -1;
}

/**
 * Builds the directed, signed causal graph used for loop detection: connectors carry their
 * own polarity, and each flow contributes an edge into the stock(s) it touches — "+" for an
 * inflow (raises the stock), "-" for an outflow (lowers it). A cycle through this graph is a
 * feedback loop; the product of the signs traversed determines whether it's reinforcing or
 * balancing.
 */
export function buildSignedGraph(model: Model): Map<string, SignedEdge[]> {
  const adjacency = new Map<string, SignedEdge[]>();
  for (const v of allVariables(model)) adjacency.set(v.id, []);

  for (const c of model.connectors) {
    adjacency.get(c.from)?.push({ to: c.to, sign: c.polarity === "-" ? -1 : 1 });
  }
  for (const f of model.flows) {
    if (f.to) adjacency.get(f.id)?.push({ to: f.to, sign: 1 });
    if (f.from) adjacency.get(f.id)?.push({ to: f.from, sign: -1 });
  }

  return adjacency;
}
