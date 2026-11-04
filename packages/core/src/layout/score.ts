import { allVariables, type Model, type Position, type Variable } from "../model/types.js";
import { centerOf, segmentHitsBox, segmentsCross } from "./geometry.js";

export interface LayoutScore {
  overlaps: number;
  /** Flows whose pipe cannot leave the stock in a straight line. */
  flowKinks: number;
  /** How far stocks sit off one shared line. A readable stock-and-flow chain is near 0. */
  stockScatter: number;
  /** A flow whose destination stock is drawn upstream of its source. */
  reversedPipes: number;
  /** Causal arrows that cross each other. */
  crossings: number;
  /** Causal arrows that pass through some other variable's box. */
  nodeHits: number;
  /** Auxiliaries sitting in the stock-and-flow band. */
  spineIntrusions: number;
  /** Sum of distances from each flow to the stock it leaves or enters. */
  pipeReach: number;
  meanArrow: number;
  longestArrow: number;
  /** Lower is a diagram that is easier to read. */
  total: number;
}

/**
 * How readable a laid-out diagram is, for a straight relation or a curved one.
 * The two styles share node positions; curved follows each relation's bend.
 */
export function scoreLayout(model: Model, style: "straight" | "curved"): LayoutScore {
  const variables = allVariables(model);
  const overlaps = countOverlaps(variables);
  const flowKinks = countKinks(model);
  const stockScatter = stockLineScatter(model);
  const reversedPipes = countReversedPipes(model);
  const lines = relationLines(model, style);
  const crossings = countCrossings(lines.map((line) => line.points));
  const nodeHits = countNodeHits(lines, variables);
  const spineIntrusions = countSpineIntrusions(model);
  const pipeReach = flowPipeReach(model);
  const lengths = lines.map((line) =>
    line.points.reduce(
      (part, point, index) => (index === 0 ? 0 : part + Math.hypot(point.x - line.points[index - 1]!.x, point.y - line.points[index - 1]!.y)),
      0,
    ),
  );
  const meanArrow = lengths.length === 0 ? 0 : lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const longestArrow = lengths.length === 0 ? 0 : Math.max(...lengths);
  // A stock-and-flow diagram is read along the pipes. Stocks on one line and short pipes
  // matter more than shaving a crossing by scattering the stocks across the page.
  const total =
    overlaps * 200 +
    flowKinks * 15 +
    stockScatter * 0.2 +
    reversedPipes * 25 +
    crossings * 3 +
    nodeHits * 4 +
    spineIntrusions * 8 +
    pipeReach / 25 +
    meanArrow / 35 +
    longestArrow / 70;
  return {
    overlaps,
    flowKinks,
    stockScatter,
    reversedPipes,
    crossings,
    nodeHits,
    spineIntrusions,
    pipeReach,
    meanArrow,
    longestArrow,
    total,
  };
}

function stockLineScatter(model: Model): number {
  if (model.stocks.length === 0) return 0;
  const xs = model.stocks.map((stock) => centerOf(stock).x);
  const ys = model.stocks.map((stock) => centerOf(stock).y);
  const horizontal = variance(xs) >= variance(ys);
  return Math.sqrt(variance(horizontal ? ys : xs));
}

function countReversedPipes(model: Model): number {
  if (model.stocks.length === 0) return 0;
  const xs = model.stocks.map((stock) => centerOf(stock).x);
  const ys = model.stocks.map((stock) => centerOf(stock).y);
  const horizontal = variance(xs) >= variance(ys);
  const byId = new Map(model.stocks.map((stock) => [stock.id, stock]));
  let reversed = 0;
  for (const flow of model.flows) {
    if (!flow.from || !flow.to) continue;
    const from = byId.get(flow.from);
    const to = byId.get(flow.to);
    if (!from || !to) continue;
    const fromMain = horizontal ? centerOf(from).x : centerOf(from).y;
    const toMain = horizontal ? centerOf(to).x : centerOf(to).y;
    if (toMain < fromMain - 4) reversed += 1;
  }
  return reversed;
}

function flowPipeReach(model: Model): number {
  let reach = 0;
  for (const flow of model.flows) {
    const anchor = flow.from
      ? model.stocks.find((stock) => stock.id === flow.from)
      : flow.to
        ? model.stocks.find((stock) => stock.id === flow.to)
        : undefined;
    if (!anchor) continue;
    const flowCenter = centerOf(flow);
    const anchorCenter = centerOf(anchor);
    reach += Math.hypot(flowCenter.x - anchorCenter.x, flowCenter.y - anchorCenter.y);
  }
  return reach;
}

function countOverlaps(variables: Variable[]): number {
  let hits = 0;
  for (let i = 0; i < variables.length; i++) {
    for (let j = i + 1; j < variables.length; j++) {
      const a = variables[i]!;
      const b = variables[j]!;
      const overlap =
        a.pos.x < b.pos.x + b.size.width &&
        b.pos.x < a.pos.x + a.size.width &&
        a.pos.y < b.pos.y + b.size.height &&
        b.pos.y < a.pos.y + a.size.height;
      if (overlap) hits += 1;
    }
  }
  return hits;
}

function countKinks(model: Model): number {
  let kinks = 0;
  for (const flow of model.flows) {
    const from = flow.from ? model.stocks.find((stock) => stock.id === flow.from) : undefined;
    if (!from) continue;
    const flowCenter = centerOf(flow);
    const fromCenter = centerOf(from);
    const aligned = Math.abs(flowCenter.y - fromCenter.y) <= 4 || Math.abs(flowCenter.x - fromCenter.x) <= 4;
    if (!aligned) kinks += 1;
  }
  return kinks;
}

interface RelationLine {
  fromId: string;
  toId: string;
  points: Position[];
}

function relationLines(model: Model, style: "straight" | "curved"): RelationLine[] {
  const byId = new Map(allVariables(model).map((v) => [v.id, v]));
  const lines: RelationLine[] = [];
  for (const connector of model.connectors) {
    const from = byId.get(connector.from);
    const to = byId.get(connector.to);
    if (!from || !to) continue;
    const a = centerOf(from);
    const b = centerOf(to);
    if (style === "straight" || connector.from === connector.to) {
      lines.push({ fromId: connector.from, toId: connector.to, points: [a, b] });
      continue;
    }
    const control = connector.bend ?? defaultBend(a, b);
    lines.push({
      fromId: connector.from,
      toId: connector.to,
      points: [0, 0.25, 0.5, 0.75, 1].map((t) => quadratic(a, control, b, t)),
    });
  }
  return lines;
}

function defaultBend(a: Position, b: Position): Position {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const amount = Math.min(60, len * 0.25);
  return { x: mx + (-dy / len) * amount, y: my + (dx / len) * amount };
}

function quadratic(a: Position, control: Position, b: Position, t: number): Position {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
  };
}

function countCrossings(lines: Position[][]): number {
  let hits = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (polylinesCross(lines[i]!, lines[j]!)) hits += 1;
    }
  }
  return hits;
}

function polylinesCross(a: Position[], b: Position[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentsCross(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!)) return true;
    }
  }
  return false;
}

function countNodeHits(lines: RelationLine[], variables: Variable[]): number {
  let hits = 0;
  for (const line of lines) {
    let hit = false;
    for (let i = 1; i < line.points.length && !hit; i++) {
      for (const variable of variables) {
        if (variable.id === line.fromId || variable.id === line.toId) continue;
        if (segmentHitsBox(line.points[i - 1]!, line.points[i]!, variable)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) hits += 1;
  }
  return hits;
}

function countSpineIntrusions(model: Model): number {
  if (model.stocks.length === 0) return 0;
  const xs = model.stocks.map((stock) => centerOf(stock).x);
  const ys = model.stocks.map((stock) => centerOf(stock).y);
  const horizontal = variance(xs) >= variance(ys);
  const values = horizontal ? ys : xs;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)]!;
  const band = (horizontal ? model.stocks[0]!.size.height : model.stocks[0]!.size.width) / 2 + 4;
  let hits = 0;
  for (const aux of model.auxiliaries) {
    const center = horizontal ? centerOf(aux).y : centerOf(aux).x;
    if (Math.abs(center - mid) < band) hits += 1;
  }
  return hits;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}
