import { addComment, deleteComment } from "../model/builder/comment.js";
import { allVariables, type Comment, type Model } from "../model/types.js";
import { detectLoops } from "./detect.js";
import type { DetectLoopsOptions } from "./types.js";

// Every auto-generated loop annotation starts with this exact shape ("R1 loop: ", "B2 loop: ",
// ...), which is what lets a second call find and replace its own earlier output instead of
// piling up stale duplicates once the model (and therefore which loops exist) has changed.
const LOOP_COMMENT_PREFIX_RE = /^[RB]\d+ loop: /;

/** Regenerates one freestanding text annotation per detected feedback loop — e.g.
 * "R1 loop: Inventario de bicicletas → Pedido de bicicletas → Recepción de bicicletas →
 * Inventario de bicicletas" — using each element's actual name around the cycle, not its kind
 * (a modeler reading the diagram wants to know *which* stock/flow/variable is involved, not
 * that a step happens to be "a flow"). Backs both the "Annotate Loops" toolbar action and the
 * `annotate_loops` AI tool, and is a plain `Comment` under the hood, so it round-trips through
 * both the `.mdl` and XMILE writers exactly like any other annotation — no format-specific loop
 * representation to keep in sync between them.
 *
 * Idempotent: previously auto-generated annotations (matched by their own `R1 loop: ` / `B2
 * loop: ` prefix) are removed and replaced each call, so re-running this after editing the model
 * reflects the current loops rather than accumulating one annotation per past call. A comment a
 * user wrote by hand is never touched — only ones matching the auto-generated prefix are ever
 * removed. */
export function annotateLoops(model: Model, options: DetectLoopsOptions = {}): Comment[] {
  for (const c of [...model.comments]) {
    if (LOOP_COMMENT_PREFIX_RE.test(c.text)) deleteComment(model, c.id);
  }

  const loops = detectLoops(model, options);
  const nameById = new Map(allVariables(model).map((v) => [v.id, v.name]));

  return loops.map((loop) => {
    const names = loop.nodeIds.map((id) => nameById.get(id) ?? id);
    const chain = [...names, names[0]].join(" → ");
    const label = `${loop.polarity}${loop.number}`;
    return addComment(model, {
      text: `${label} loop: ${chain}`,
      pos: { x: loop.centroid.x - 80, y: loop.centroid.y + 30 },
    });
  });
}
