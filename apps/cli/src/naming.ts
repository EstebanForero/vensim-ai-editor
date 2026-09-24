// Names: the model's, from the prompt; the file's, from the model's.
//
// Both are pure string work, kept apart from the command that uses them because they are the one
// part of the CLI with no I/O and no provider in them — and because "what should this file be
// called" is a question with more edge cases (accents, punctuation, an eight-word title that is
// really a sentence) than it looks.

/** A model name from the prompt, so a one-liner needs no `-o` and the file's own title says what
 * it is when it's opened later. Eight words, because a whole prompt as a title is a paragraph. */
export function nameFromPrompt(prompt: string): string {
  const words = prompt.replace(/\s+/g, " ").trim().split(" ");
  const title = words.slice(0, 8).join(" ").replace(/[.,;:!?]+$/, "");
  const trimmed = title.length > 70 ? `${title.slice(0, 67).trimEnd()}…` : title;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** A file name from a model name: ASCII, hyphenated, and never empty — an accented title or one
 * that is all punctuation still has to produce something writeable. */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "model"
  );
}
