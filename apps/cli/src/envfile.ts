// The `.env` file: somewhere to leave a key, found the same way from either entry point.
//
// The command runs from the repository root (`bun run generate`) and from apps/cli (`bun start`),
// so "the .env next to you" would mean two different files depending on how it was invoked. The
// search walks up from where the command was run and stops at the top of the repository, which
// finds the same file from either — and never picks up one from a directory above the checkout.
//
// What it will not do is override a variable that is already set. An exported key, or one passed
// inline (`DEEPSEEK_API_KEY=… bun run generate`), is a deliberate act about one run; a file left in
// the repository is a default. The more specific wins, the same way a flag beats the environment.

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface EnvFile {
  /** Where it was found, or null when there is none — which is worth telling the user apart from
   * "one was read and it didn't set what you needed": only one of those is a file in the wrong
   * place. */
  path: string | null;
  /** What it declares. Used to fill in what the environment doesn't already have. */
  values: Record<string, string>;
}

/** The nearest `.env` at or above `from`, stopping at the top of the repository. */
export function findEnvFile(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, ".env");
    if (isFile(candidate)) return candidate;
    // The repository root is the boundary: a `.env` above a checkout is not this project's, and
    // walking to the filesystem root would happily pick up one in a shared parent like /tmp.
    if (isDirectory(join(dir, ".git"))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null; // the filesystem root, and no .env anywhere below it
    dir = parent;
  }
}

/**
 * `KEY=value` lines, one per line. Comments and blank lines are skipped, an `export` prefix is
 * allowed, and a value may be quoted — with `"` or `'` — in which case it is taken exactly as
 * written, `#` and spaces and all. Nothing beyond that: no interpolation, no `$VAR`, no multi-line
 * values. A file of keys and values is easy to reason about; a file with a language in it is not,
 * and nothing this CLI configures needs one.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length) : line;
    const eq = body.indexOf("=");
    if (eq < 1) continue; // no `=`, or a line that starts with one — not a declaration
    const key = body.slice(0, eq).trim();
    if (key) values[key] = unquote(body.slice(eq + 1).trim());
  }
  return values;
}

function unquote(raw: string): string {
  const quote = raw[0];
  if (raw.length >= 2 && (quote === '"' || quote === "'") && raw.endsWith(quote)) return raw.slice(1, -1);
  // An unquoted trailing comment — `KEY=value # why` — dropped, but only when whitespace comes
  // before the `#`, so a value that contains one (`KEY=a#b`) keeps it.
  return raw.replace(/\s+#.*$/, "").trim();
}

/** What a `.env` says, or nothing if there isn't one. */
export function loadEnvFile(from: string = process.cwd()): EnvFile {
  const path = findEnvFile(from);
  if (!path) return { path: null, values: {} };
  try {
    return { path, values: parseEnvFile(readFileSync(path, "utf-8")) };
  } catch {
    // Unreadable, which is rare enough (permissions, or a `.env` that is a broken symlink) not to
    // be worth failing the run over: the key may still come from the environment or a flag, and if
    // it doesn't, the error that follows says what to do about it.
    return { path, values: {} };
  }
}

/** The environment a run should see: what was already set, over what the file says. */
export function mergeInto(env: NodeJS.ProcessEnv, file: EnvFile): NodeJS.ProcessEnv {
  return { ...file.values, ...env };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
