// A `.env` next to the checkout, found the same way the CLI finds it.
//
// An MCP host launches this process with whatever working directory it uses for itself, which is
// often not the repository. Walking up to the checkout's `.git` still finds the project's file
// when the process was started inside it, and never picks up a `.env` that belongs to a parent
// directory. A variable already set in the environment wins: that is a choice about this run, and
// the file is only the default.

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface EnvFile {
  path: string | null;
  values: Record<string, string>;
}

/** The nearest `.env` at or above `from`, stopping at the top of the repository. */
export function findEnvFile(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, ".env");
    if (isFile(candidate)) return candidate;
    if (isDirectory(join(dir, ".git"))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `KEY=value` lines. Quoted values are taken as written; nothing is interpolated. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length) : line;
    const eq = body.indexOf("=");
    if (eq < 1) continue;
    const key = body.slice(0, eq).trim();
    if (key) values[key] = unquote(body.slice(eq + 1).trim());
  }
  return values;
}

function unquote(raw: string): string {
  const quote = raw[0];
  if (raw.length >= 2 && (quote === '"' || quote === "'") && raw.endsWith(quote)) return raw.slice(1, -1);
  return raw.replace(/\s+#.*$/, "").trim();
}

export function loadEnvFile(from: string = process.cwd()): EnvFile {
  const path = findEnvFile(from);
  if (!path) return { path: null, values: {} };
  try {
    return { path, values: parseEnvFile(readFileSync(path, "utf-8")) };
  } catch {
    return { path, values: {} };
  }
}

/**
 * Fills `env` with what the file says, without overriding a variable that is already set.
 * Returns the file path when one was read.
 */
export function applyEnvFile(env: NodeJS.ProcessEnv = process.env, from: string = process.cwd()): string | null {
  const file = loadEnvFile(from);
  for (const [key, value] of Object.entries(file.values)) {
    if (env[key] === undefined) env[key] = value;
  }
  return file.path;
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
