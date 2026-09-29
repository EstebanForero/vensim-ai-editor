import { ModelError } from "../errors.js";
import { nextId } from "../ids.js";
import type { Comment, Model, Position, Size } from "../types.js";
import { autoPlacePosition, stripDiacritics } from "./helpers.js";

const DEFAULT_SIZE: Size = { width: 160, height: 60 };

/**
 * The box a comment's text actually needs.
 *
 * A comment is drawn with `whitespace-pre-wrap` and nothing clips it, so a box that is too small
 * does not hide the text — the text spills out of it, across the canvas, over whatever is beside
 * it. Every comment used to be 160x60 whatever it said, which is fine for "Comment" and wrong for
 * the things this editor generates: a loop annotation is a sentence, and the note an agent leaves
 * is a paragraph. The paragraph measured 190 units tall inside a 60-unit box.
 *
 * Everything that decides where the view should be measures the *box*, not the spill, so the two
 * disagreeing had three consequences at once: the text covered the model, `autoLayout` packed a
 * column of these things using the 60 they claimed and stacked each one over the next, and
 * `fitView` framed a diagram considerably smaller than what was on screen.
 *
 * Approximate on purpose — the exact wrap depends on the font — but approximate in the direction
 * that is safe: too tall leaves a little space, too short puts the text back on top of the model.
 */
export function commentSizeFor(text: string): Size {
  const CHARS_PER_LINE = 24; // at the canvas's text-xs inside a 160-wide box, less its padding
  const LINE_HEIGHT = 18; // measured: the canvas's text-xs wraps taller than its nominal 16
  const PADDING = 16;
  return { width: DEFAULT_SIZE.width, height: Math.max(DEFAULT_SIZE.height, Math.ceil(text.length / CHARS_PER_LINE) * LINE_HEIGHT + PADDING) };
}

export interface AddCommentInput {
  text?: string;
  pos?: Position;
  size?: Size;
}

/** Adds a freestanding text annotation — not a variable, carries no equation, never
 * participates in simulation or loop detection. Vensim's own "Comment" sketch tool. */
export function addComment(model: Model, input: AddCommentInput = {}): Comment {
  const text = stripDiacritics(input.text ?? "Comment");
  const comment: Comment = {
    kind: "comment",
    id: nextId("comment"),
    text,
    pos: input.pos ?? autoPlacePosition(model),
    // Sized to its text, so the box means what it says. `setCommentText` re-sizes below for the
    // same reason — a note that grows from one line to five has to take up five lines of room, or
    // it takes up five lines of everything else's.
    size: input.size ?? commentSizeFor(text),
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
  c.text = stripDiacritics(text);
  // Re-sized to the new text — growing it is the case that matters, since that is the one that
  // starts spilling over whatever is next to it.
  c.size = { width: c.size.width, height: commentSizeFor(c.text).height };
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
