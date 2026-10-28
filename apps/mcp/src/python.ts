// `run_python` for a process on this machine. The agent uses it to check a simulation numerically,
// and an MCP client can call the same tool directly. Each call is its own process: one run cannot
// leave state for the next, and a timeout can kill it without orphans.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pythonGlobals, type ToolCallResult } from "@vensim-ai/agent";
import type { Model } from "@vensim-ai/core";

const TIMEOUT_MS = 30_000;

const BOOTSTRAP = `import json as _json, os as _os
with open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "globals.json")) as _f:
    globals().update(_json.load(_f))
del _json, _os, _f

`;

function interpreter(): string | null {
  return Bun.which("python3") ?? Bun.which("python");
}

async function runOnce(python: string, code: string, globals: Record<string, unknown>): Promise<ToolCallResult> {
  const dir = await mkdtemp(join(tmpdir(), "vensim-ai-"));
  try {
    await writeFile(join(dir, "globals.json"), JSON.stringify(globals));
    await writeFile(join(dir, "run.py"), BOOTSTRAP + code);
    const proc = Bun.spawn([python, join(dir, "run.py")], { stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, TIMEOUT_MS);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    clearTimeout(timer);
    const output = stdout + stderr;
    if (timedOut) return { ok: false, error: `Timed out after ${TIMEOUT_MS / 1000}s and was killed.`, result: { stdout: output } };
    if (exitCode === 0) return { ok: true, result: { stdout: output } };
    return { ok: false, error: output.trim() || `Exited with code ${exitCode}.` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runPython(code: string, model: Model): Promise<ToolCallResult> {
  const python = interpreter();
  if (!python) {
    return { ok: false, error: "No python3 on PATH — run_simulation and check_units are still available." };
  }
  return runOnce(python, code, pythonGlobals(model));
}
