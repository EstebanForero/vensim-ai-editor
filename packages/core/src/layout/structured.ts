import { allVariables, type Model, type Position, type Variable } from "../model/types.js";
import { boxesOverlap, centerOf, segmentHitsBox, segmentsCross } from "./geometry.js";
import { finalizeLayout } from "./finalize.js";
import { pipeRelationBend, pipeRelationSide } from "./pipeRelation.js";
import type { AutoLayoutOptions, LayoutDirection } from "./types.js";

/**
 * A stock-and-flow layout. Stocks in one chain share a line, the flow between them sits on
 * that line, and the auxiliaries that feed a rate sit beside it instead of in the pipe.
 * Relations then get a bend that bows away from the chain, which is what the curved style draws.
 * Straight style ignores the bend and keeps the same node positions.
 */
export function structuredLayout(model: Model, options: AutoLayoutOptions = {}): void {
  const { direction = "LR", nodeSep = 60, rankSep = 120 } = options;
  const gap = Math.max(28, Math.round(nodeSep * 0.5));
  for (const connector of model.connectors) connector.bend = null;

  const variables = allVariables(model);
  const edges: [string, string][] = [];
  for (const flow of model.flows) {
    if (flow.from) edges.push([flow.from, flow.id]);
    if (flow.to) edges.push([flow.id, flow.to]);
  }
  for (const connector of model.connectors) edges.push([connector.from, connector.to]);
  const degree = new Map<string, number>();
  for (const [a, b] of edges) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  const live = variables.filter((v) => (degree.get(v.id) ?? 0) > 0);
  const liveIds = new Set(live.map((v) => v.id));

  const byId = new Map(variables.map((v) => [v.id, v]));
  const mainOf = (v: Variable) => (direction === "LR" ? v.size.width : v.size.height);
  const crossOf = (v: Variable) => (direction === "LR" ? v.size.height : v.size.width);

  const centers = new Map<string, { main: number; cross: number }>();
  const stocks = model.stocks.filter((s) => liveIds.has(s.id));
  const stockIds = new Set(stocks.map((s) => s.id));
  const stockEdges = model.flows
    .filter((f) => f.from && f.to && f.from !== f.to && stockIds.has(f.from) && stockIds.has(f.to))
    .map((f) => ({ from: f.from!, to: f.to!, id: f.id }));
  const forward = withoutBackEdges(stocks.map((s) => s.id), stockEdges);
  const rank = longestRanks(stocks.map((s) => s.id), forward);
  const pitch =
    Math.max(40, ...stocks.map(mainOf), 0) + Math.max(40, ...model.flows.map(mainOf), 0) + gap * 2;

  const components = stockComponents(stocks.map((s) => s.id), stockEdges);
  let cursor = 0;
  const placedFlows = new Set<string>();
  for (const component of components) {
    const local = component.map((id) => rank.get(id) ?? 0);
    const minRank = Math.min(...local);
    const spine = longestSpine(component, forward, rank);
    const cross = branchCross(component, spine, forward, Math.max(...stocks.map(crossOf), 48) + nodeSep + 72);
    const member = new Set(component);
    for (const id of component) {
      const main = ((rank.get(id) ?? 0) - minRank) * pitch;
      centers.set(id, { main, cross: cross.get(id) ?? 0 });
    }
    placeChainFlows(model, member, centers, byId, stockIds, placedFlows, mainOf, crossOf, gap);
    let minMain = Infinity;
    let maxMain = -Infinity;
    for (const [id, at] of centers) {
      if (!member.has(id) && !flowTouches(model, id, member)) continue;
      const variable = byId.get(id)!;
      minMain = Math.min(minMain, at.main - mainOf(variable) / 2);
      maxMain = Math.max(maxMain, at.main + mainOf(variable) / 2);
    }
    const shift = cursor - minMain;
    for (const [id, at] of centers) {
      if (!member.has(id) && !flowTouches(model, id, member)) continue;
      at.main += shift;
    }
    cursor = maxMain + shift + gap + pitch * 0.35;
  }

  for (const flow of model.flows) {
    if (placedFlows.has(flow.id) || !liveIds.has(flow.id)) continue;
    const anchorId = flow.from && centers.has(flow.from) ? flow.from : flow.to && centers.has(flow.to) ? flow.to : undefined;
    const anchor = anchorId ? centers.get(anchorId) : undefined;
    centers.set(flow.id, anchor ? { main: anchor.main, cross: anchor.cross + crossOf(flow) + gap } : { main: cursor, cross: 0 });
    cursor += mainOf(flow) + gap;
    placedFlows.add(flow.id);
  }

  const auxes = model.auxiliaries.filter((a) => liveIds.has(a.id));
  placeAndRelaxAuxiliaries(auxes.map((a) => a.id), model, centers, byId, mainOf, crossOf, gap);

  const placedBoxes = () =>
    [...centers.entries()].map(([id, at]) => {
      const v = byId.get(id)!;
      return { id, pos: topLeft(at, v, direction), size: v.size };
    });

  let minX = Infinity;
  let minY = Infinity;
  for (const box of placedBoxes()) {
    minX = Math.min(minX, box.pos.x);
    minY = Math.min(minY, box.pos.y);
  }
  if (Number.isFinite(minX)) {
    const dx = 40 - minX;
    const dy = 40 - minY;
    for (const [id, at] of centers) {
      const v = byId.get(id)!;
      const pos = topLeft(at, v, direction);
      v.pos = { x: pos.x + dx, y: pos.y + dy };
    }
  }

  routeBends(model, byId, direction);
  finalizeLayout(model, { nodeSep, rankSep, placedIds: new Set([...centers.keys()].filter((id) => liveIds.has(id))) });
}

function topLeft(at: { main: number; cross: number }, v: Variable, direction: LayoutDirection): Position {
  return direction === "LR"
    ? { x: at.main - v.size.width / 2, y: at.cross - v.size.height / 2 }
    : { x: at.cross - v.size.width / 2, y: at.main - v.size.height / 2 };
}

function withoutBackEdges(nodes: string[], edges: { from: string; to: string; id: string }[]): { from: string; to: string }[] {
  const adj = new Map<string, { from: string; to: string }[]>();
  for (const edge of edges) {
    const list = adj.get(edge.from) ?? [];
    list.push(edge);
    adj.set(edge.from, list);
  }
  const color = new Map<string, "gray" | "black">();
  const back = new Set<{ from: string; to: string }>();
  const visit = (id: string) => {
    color.set(id, "gray");
    for (const edge of adj.get(id) ?? []) {
      const tone = color.get(edge.to);
      if (tone === "gray") back.add(edge);
      else if (!tone) visit(edge.to);
    }
    color.set(id, "black");
  };
  for (const id of nodes) if (!color.has(id)) visit(id);
  return edges.filter((edge) => !back.has(edge));
}

function longestRanks(nodes: string[], edges: { from: string; to: string }[]): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  const indeg = new Map<string, number>(nodes.map((id) => [id, 0]));
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
    indeg.set(edge.to, (indeg.get(edge.to) ?? 0) + 1);
  }
  const rank = new Map<string, number>(nodes.map((id) => [id, 0]));
  const queue = nodes.filter((id) => (indeg.get(id) ?? 0) === 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const next of outgoing.get(id) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  return rank;
}

function stockComponents(nodes: string[], edges: { from: string; to: string }[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const id of nodes) adj.set(id, []);
  for (const edge of edges) {
    adj.get(edge.from)?.push(edge.to);
    adj.get(edge.to)?.push(edge.from);
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of nodes) {
    if (seen.has(id)) continue;
    const component: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adj.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function longestSpine(component: string[], edges: { from: string; to: string }[], rank: Map<string, number>): Set<string> {
  const inside = new Set(component);
  let end = component[0]!;
  for (const id of component) if ((rank.get(id) ?? 0) >= (rank.get(end) ?? 0)) end = id;
  const spine = new Set<string>();
  while (end && inside.has(end) && !spine.has(end)) {
    spine.add(end);
    const preds = edges.filter((edge) => edge.to === end && inside.has(edge.from));
    if (preds.length === 0) break;
    preds.sort((a, b) => (rank.get(b.from) ?? 0) - (rank.get(a.from) ?? 0));
    end = preds[0]!.from;
  }
  return spine;
}

function branchCross(component: string[], spine: Set<string>, edges: { from: string; to: string }[], band: number): Map<string, number> {
  const inside = new Set(component);
  const adj = new Map<string, string[]>();
  for (const id of component) adj.set(id, []);
  for (const edge of edges) {
    if (!inside.has(edge.from) || !inside.has(edge.to)) continue;
    adj.get(edge.from)?.push(edge.to);
    adj.get(edge.to)?.push(edge.from);
  }
  const cross = new Map<string, number>();
  let layer = [...spine];
  for (const id of spine) cross.set(id, 0);
  let step = 1;
  while (layer.length) {
    const next: string[] = [];
    for (const id of layer) {
      for (const neighbor of adj.get(id) ?? []) {
        if (cross.has(neighbor)) continue;
        cross.set(neighbor, step * band);
        next.push(neighbor);
      }
    }
    layer = next;
    step += 1;
  }
  for (const id of component) if (!cross.has(id)) cross.set(id, step * band);
  return cross;
}

function flowTouches(model: Model, id: string, stocks: Set<string>): boolean {
  const flow = model.flows.find((item) => item.id === id);
  if (!flow) return false;
  return (!!flow.from && stocks.has(flow.from)) || (!!flow.to && stocks.has(flow.to));
}

function placeChainFlows(
  model: Model,
  member: Set<string>,
  centers: Map<string, { main: number; cross: number }>,
  byId: Map<string, Variable>,
  stockIds: Set<string>,
  placedFlows: Set<string>,
  mainOf: (v: Variable) => number,
  crossOf: (v: Variable) => number,
  gap: number,
): void {
  const between = model.flows.filter(
    (flow) => flow.from && flow.to && flow.from !== flow.to && member.has(flow.from) && member.has(flow.to),
  );
  const groups = new Map<string, typeof between>();
  for (const flow of between) {
    const key = [flow.from, flow.to].sort().join("|");
    const group = groups.get(key) ?? [];
    group.push(flow);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.forEach((flow, index) => {
      const from = centers.get(flow.from!);
      const to = centers.get(flow.to!);
      if (!from || !to) return;
      const dir = Math.sign(to.cross - from.cross) || 1;
      let cross = from.cross + (index === 0 ? 0 : dir * index * (crossOf(flow) + 16));
      const main = (from.main + to.main) / 2;
      let guard = 0;
      while (slotTaken(centers, byId, main, cross, flow.id, mainOf, crossOf) && guard++ < 8) {
        cross += dir * (crossOf(flow) + 16);
      }
      centers.set(flow.id, { main, cross });
      placedFlows.add(flow.id);
    });
  }

  for (const stockId of member) {
    const stock = byId.get(stockId);
    const at = centers.get(stockId);
    if (!stock || !at || !stockIds.has(stockId)) continue;
    const inflows = model.flows.filter((flow) => flow.to === stockId && !flow.from && !placedFlows.has(flow.id));
    const outflows = model.flows.filter((flow) => flow.from === stockId && !flow.to && !placedFlows.has(flow.id));
    placeOpen(inflows, at, "in", stock, centers, byId, mainOf, crossOf, gap);
    placeOpen(outflows, at, "out", stock, centers, byId, mainOf, crossOf, gap);
    for (const flow of [...inflows, ...outflows]) placedFlows.add(flow.id);
  }
}

function slotTaken(
  centers: Map<string, { main: number; cross: number }>,
  byId: Map<string, Variable>,
  main: number,
  cross: number,
  self: string,
  mainOf: (v: Variable) => number,
  crossOf: (v: Variable) => number,
): boolean {
  const own = byId.get(self);
  if (!own) return false;
  for (const [id, at] of centers) {
    if (id === self) continue;
    const other = byId.get(id);
    if (!other) continue;
    if (Math.abs(at.main - main) < mainOf(own) / 2 + mainOf(other) / 2 && Math.abs(at.cross - cross) < crossOf(own) / 2 + crossOf(other) / 2) {
      return true;
    }
  }
  return false;
}

function placeOpen(
  flows: Variable[],
  stock: { main: number; cross: number },
  side: "in" | "out",
  stockVar: Variable,
  centers: Map<string, { main: number; cross: number }>,
  byId: Map<string, Variable>,
  mainOf: (v: Variable) => number,
  crossOf: (v: Variable) => number,
  gap: number,
): void {
  flows.forEach((flow, index) => {
    let outward = side === "in" ? -1 : 1;
    const stepMain = () => stock.main + outward * (mainOf(stockVar) / 2 + gap + mainOf(flow) / 2);
    let main = stepMain();
    if (slotTaken(centers, byId, main, stock.cross, flow.id, mainOf, crossOf)) {
      outward = -outward;
      main = stepMain();
    }
    let guard = 0;
    while (slotTaken(centers, byId, main, stock.cross, flow.id, mainOf, crossOf) && guard++ < 6) {
      main += outward * (mainOf(flow) + gap);
    }
    let cross = stock.cross + (index === 0 ? 0 : index * (crossOf(flow) + 16));
    guard = 0;
    while (slotTaken(centers, byId, main, cross, flow.id, mainOf, crossOf) && guard++ < 6) {
      cross += crossOf(flow) + 16;
    }
    centers.set(flow.id, { main, cross });
  });
}

function placeAndRelaxAuxiliaries(
  ids: string[],
  model: Model,
  centers: Map<string, { main: number; cross: number }>,
  byId: Map<string, Variable>,
  mainOf: (v: Variable) => number,
  crossOf: (v: Variable) => number,
  gap: number,
): void {
  if (ids.length === 0) return;
  const neighborsOf = (id: string) =>
    model.connectors.flatMap((connector) => (connector.from === id ? [connector.to] : connector.to === id ? [connector.from] : []));
  const averageMain = (id: string) => {
    const mains = neighborsOf(id)
      .map((other) => centers.get(other)?.main)
      .filter((value): value is number => value !== undefined);
    if (mains.length === 0) return 0;
    return mains.reduce((sum, value) => sum + value, 0) / mains.length;
  };

  let order = [...ids];
  for (let sweep = 0; sweep < 4; sweep++) {
    order = [...order].sort((a, b) => averageMain(a) - averageMain(b) || a.localeCompare(b));
    order.forEach((id, index) => {
      const variable = byId.get(id)!;
      const row = Math.floor(index / 5);
      const col = index % 5;
      const rowCount = Math.min(5, order.length - row * 5);
      const slot = mainOf(variable) + gap;
      const mains = [...centers.values()].map((at) => at.main);
      const mid = mains.reduce((sum, value) => sum + value, 0) / mains.length;
      centers.set(id, {
        main: mid - ((rowCount - 1) * slot) / 2 + col * slot,
        cross: -(row + 1) * (crossOf(variable) + gap) - 36,
      });
    });
  }

  const cost = () => auxCost(model, centers, byId, mainOf, crossOf);
  for (let pass = 0; pass < 3; pass++) {
    for (const id of order) {
      const start = centers.get(id)!;
      let best = { ...start };
      let bestCost = cost();
      for (const dm of [-180, -100, -50, 0, 50, 100, 180]) {
        for (const dc of [0, -60, -120]) {
          const variable = byId.get(id)!;
          const next = {
            main: start.main + dm,
            cross: Math.min(start.cross + dc, -(crossOf(variable) / 2 + 36)),
          };
          centers.set(id, next);
          const nextCost = cost();
          if (nextCost < bestCost) {
            bestCost = nextCost;
            best = { ...next };
          }
        }
      }
      centers.set(id, best);
    }
  }
  separateAuxiliaries(ids, centers, byId, mainOf, crossOf);
}

function auxCost(
  model: Model,
  centers: Map<string, { main: number; cross: number }>,
  byId: Map<string, Variable>,
  mainOf: (v: Variable) => number,
  crossOf: (v: Variable) => number,
): number {
  const boxOf = (id: string) => {
    const at = centers.get(id)!;
    const variable = byId.get(id)!;
    return {
      pos: { x: at.main - mainOf(variable) / 2, y: at.cross - crossOf(variable) / 2 },
      size: { width: mainOf(variable), height: crossOf(variable) },
    };
  };
  const lines: { from: string; to: string; a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (const connector of model.connectors) {
    const from = centers.get(connector.from);
    const to = centers.get(connector.to);
    if (!from || !to) continue;
    lines.push({ from: connector.from, to: connector.to, a: { x: from.main, y: from.cross }, b: { x: to.main, y: to.cross } });
  }
  let crossings = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (segmentsCross(lines[i]!.a, lines[i]!.b, lines[j]!.a, lines[j]!.b)) crossings += 1;
    }
  }
  let hits = 0;
  for (const line of lines) {
    for (const [id] of centers) {
      if (id === line.from || id === line.to) continue;
      if (segmentHitsBox(line.a, line.b, boxOf(id))) {
        hits += 1;
        break;
      }
    }
  }
  let overlaps = 0;
  const ids = [...centers.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (boxesOverlap(boxOf(ids[i]!), boxOf(ids[j]!))) overlaps += 1;
    }
  }
  let intrusions = 0;
  for (const aux of model.auxiliaries) {
    const at = centers.get(aux.id);
    if (!at) continue;
    if (Math.abs(at.cross) < crossOf(aux) / 2 + 8) intrusions += 1;
  }
  return overlaps * 100 + crossings * 5 + hits * 7 + intrusions * 4;
}

function separateAuxiliaries(
  ids: string[],
  centers: Map<string, { main: number; cross: number }>,
  byId: Map<string, Variable>,
  mainOf: (v: Variable) => number,
  crossOf: (v: Variable) => number,
): void {
  const box = (id: string) => {
    const at = centers.get(id)!;
    const v = byId.get(id)!;
    return {
      pos: { x: at.main - mainOf(v) / 2, y: at.cross - crossOf(v) / 2 },
      size: { width: mainOf(v), height: crossOf(v) },
    };
  };
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (const id of ids) {
      const at = centers.get(id);
      if (!at) continue;
      for (const [otherId] of centers) {
        if (otherId === id) continue;
        if (!boxesOverlap(box(id), box(otherId))) continue;
        const other = centers.get(otherId)!;
        if (ids.includes(otherId) && Math.abs(at.cross - other.cross) < 8) {
          if (at.main >= other.main) at.main += 10;
          else at.main -= 10;
        } else {
          at.cross += at.cross <= 0 ? -12 : 12;
        }
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
}

function routeBends(model: Model, byId: Map<string, Variable>, direction: LayoutDirection): void {
  const spine = spineCross(model, direction);
  const seen = new Map<string, number>();
  for (const connector of model.connectors) {
    const from = byId.get(connector.from);
    const to = byId.get(connector.to);
    if (!from || !to) continue;
    const a = centerOf(from);
    const b = centerOf(to);
    const key = [connector.from, connector.to].sort().join("|");
    const duplicate = seen.get(key) ?? 0;
    seen.set(key, duplicate + 1);
    if (connector.from === connector.to) {
      connector.bend = { x: a.x, y: a.y - from.size.height / 2 - 56 };
      continue;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const side = bowSide(mid, nx, ny, spine, direction);
    const alongPipe = pipeRelationSide(model, connector.from, connector.to);
    if (alongPipe) {
      // The canvas attaches this link to the open side. A bow inside the pipe gap folds
      // back on itself, because the visible gap is much shorter than the distance between centers.
      connector.bend = pipeRelationBend(from, to, alongPipe, 36 + duplicate * 16);
      continue;
    }
    const flipped = duplicate % 2 === 0 ? side : -side;
    // Bow against the visible gap, not the center-to-center length. A 28px bend on a 30px gap
    // between a stock and the rate beside it folds the arrow back on itself.
    const span = facingGap(from, to, len);
    const cap = Math.min(64, Math.max(10, span * 0.45));
    let amount = Math.min(cap, span < 90 ? span * 0.22 : Math.max(22, span * 0.2));
    let bend = { x: mid.x + nx * amount * flipped, y: mid.y + ny * amount * flipped };
    const others = [...byId.values()].filter((v) => v.id !== from.id && v.id !== to.id);
    for (let step = 0; step < 4 && amount < cap && curveHits(a, bend, b, others); step++) {
      amount = Math.min(cap, amount + len * 0.12);
      bend = { x: mid.x + nx * amount * flipped, y: mid.y + ny * amount * flipped };
    }
    if (curveHits(a, bend, b, others)) {
      bend = { x: mid.x + nx * amount * -flipped, y: mid.y + ny * amount * -flipped };
    }
    connector.bend = bend;
  }
}

function facingGap(from: Variable, to: Variable, centerLen: number): number {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const gap =
    Math.abs(dx) >= Math.abs(dy)
      ? dx >= 0
        ? to.pos.x - (from.pos.x + from.size.width)
        : from.pos.x - (to.pos.x + to.size.width)
      : dy >= 0
        ? to.pos.y - (from.pos.y + from.size.height)
        : from.pos.y - (to.pos.y + to.size.height);
  return Math.max(12, Math.min(centerLen, gap));
}

function spineCross(model: Model, direction: LayoutDirection): number {
  if (model.stocks.length === 0) return 0;
  const values = model.stocks.map((stock) => (direction === "LR" ? stock.pos.y + stock.size.height / 2 : stock.pos.x + stock.size.width / 2));
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)]!;
}

function bowSide(mid: Position, nx: number, ny: number, spine: number, direction: LayoutDirection): 1 | -1 {
  const along = direction === "LR" ? "y" : "x";
  const toward = mid[along] + (along === "y" ? ny : nx) * 40;
  const away = mid[along] - (along === "y" ? ny : nx) * 40;
  return Math.abs(toward - spine) >= Math.abs(away - spine) ? 1 : -1;
}

function curveHits(a: Position, control: Position, b: Position, boxes: { pos: Position; size: { width: number; height: number } }[]): boolean {
  for (const t of [0.25, 0.5, 0.75]) {
    const p = {
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * control.x + t * t * b.x,
      y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * control.y + t * t * b.y,
    };
    for (const box of boxes) {
      if (p.x > box.pos.x && p.x < box.pos.x + box.size.width && p.y > box.pos.y && p.y < box.pos.y + box.size.height) return true;
    }
  }
  return false;
}
