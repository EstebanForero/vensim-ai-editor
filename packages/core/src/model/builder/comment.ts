import { ModelError } from "../errors.js";
import { nextId } from "../ids.js";
import type { Comment, Model, Position, Size } from "../types.js";
import { autoPlacePosition } from "./helpers.js";

const DEFAULT_SIZE: Size = { width: 160, height: 60 };

export interface AddCommentInput {
  text?: string;
  pos?: Position;
  size?: Size;
}

/** Adds a freestanding text annotation — not a variable, carries no equation, never
 * participates in simulation or loop detection. Vensim's own "Comment" sketch tool. */
export function addComment(model: Model, input: AddCommentInput = {}): Comment {
  const comment: Comment = {
    kind: "comment",
    id: nextId("comment"),
    text: input.text ?? "Comment",
    pos: input.pos ?? autoPlacePosition(model),
    size: input.size ?? DEFAULT_SIZE,
  };
  model.comments.push(comment);
  return comment;
}

function findCommentOrThrow(model: Model, id: string): Comment {
  const c = model.comments.find((x) => x.id === id);
  if (!c) throw new ModelError(`No comment found with id "${id}".`);
  return c;
}

export function setCommentText(model: Model, id: string, text: string): Comment {
  const c = findCommentOrThrow(model, id);
  c.text = text;
  return c;
}

export function moveComment(model: Model, id: string, pos: Position): Comment {
  const c = findCommentOrThrow(model, id);
  c.pos = pos;
  return c;
}

export function deleteComment(model: Model, id: string): void {
  const idx = model.comments.findIndex((c) => c.id === id);
  if (idx === -1) throw new ModelError(`No comment found with id "${id}".`);
  model.comments.splice(idx, 1);
}
