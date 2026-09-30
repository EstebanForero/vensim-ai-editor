// Where the model goes: the one place that decides a file name, and writes the file.
//
// Two commands write a model — the one-shot run, and a chat session's `/save` — and they have to
// agree about it, down to what `-o` means and what the file is called when it isn't given. The
// same three lines in two places is how `-o` ends up meaning something slightly different in one
// of them, so it is one function.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Model } from "@vensim-ai/core";
import { formatOf, type FormatName } from "./formats.js";
import { slugify } from "./naming.js";

/**
 * Writes `model` and returns the absolute path it went to — which is the thing worth telling the
 * user, and what the summary line is built from.
 *
 * `override` is a path given at the moment of writing (a chat `/save <path>`), which beats the one
 * the command line named. Absent both, the file is the model's own name: the model was titled
 * after what it is when it was built or first described, so its name is the best answer available
 * and needs no second naming scheme.
 */
export function writeModel(model: Model, opts: { out: string | null; format: FormatName }, override?: string): string {
  const format = formatOf(opts.format);
  const path = resolve(override ?? opts.out ?? `${slugify(model.name)}.${format.extension}`);
  writeFileSync(path, format.write(model));
  return path;
}
