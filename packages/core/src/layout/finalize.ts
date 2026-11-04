import { loopAnnotationPos, loopLabelOf } from "../loops/annotate.js";
import { detectLoops } from "../loops/detect.js";
import { allVariables, type Model } from "../model/types.js";

/**
 * Parks variables the layout did not place, then puts loop labels back on their loops and
 * hand-written comments in a column beside the diagram. Shared by every layout algorithm so
 * those rules do not drift.
 */
export function finalizeLayout(model: Model, options: { nodeSep: number; rankSep: number; placedIds: Set<string> }): void {
  const { nodeSep, rankSep, placedIds } = options;
  const variables = allVariables(model);
  const placed = variables.filter((v) => placedIds.has(v.id));
  const isolated = variables.filter((v) => !placedIds.has(v.id));

  let clusterBottom = 0;
  let clusterLeft = 0;
  for (const v of placed) {
    clusterBottom = Math.max(clusterBottom, v.pos.y + v.size.height);
    clusterLeft = Math.min(clusterLeft, v.pos.x);
  }

  const gridOriginY = placed.length > 0 ? clusterBottom + rankSep : 0;
  const gridOriginX = placed.length > 0 ? clusterLeft : 0;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(isolated.length)));
  isolated.forEach((v, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    v.pos = { x: gridOriginX + col * (v.size.width + nodeSep), y: gridOriginY + row * (v.size.height + nodeSep) };
  });

  const loopByLabel = new Map(detectLoops(model).map((loop) => [`${loop.polarity}${loop.number}`, loop]));
  const clusterRight =
    placed.length > 0 || isolated.length > 0 ? Math.max(0, ...allVariables(model).map((v) => v.pos.x + v.size.width)) : 0;
  let commentColumnY = 0;
  const commentColumnX = clusterRight + rankSep;

  for (const c of model.comments) {
    const label = loopLabelOf(c.text);
    const loop = label ? loopByLabel.get(label) : undefined;
    if (loop) {
      c.pos = loopAnnotationPos(loop.centroid);
      continue;
    }
    c.pos = { x: commentColumnX, y: commentColumnY };
    commentColumnY += c.size.height + nodeSep;
  }
}
