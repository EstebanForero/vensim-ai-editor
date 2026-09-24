// The CLI's `run_python`: a real interpreter on this machine, spawned per call.
//
// The browser runs the model's code in Pyodide, which is a WASM sandbox inside the page. There is
// no equivalent here — this runs whatever the model wrote, as you, with your permissions. That is
// the same trust you already extend by running the agent at all (it can write files through the
// model tools), but it is worth being plain about, because it is the one capability that behaves
// differently from the app rather than merely looking different.
//
// Each call gets its own process and its own temp directory, so one run cannot leave state behind
// for the next and a runaway loop can be killed without leaving orphans.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@vensim-ai/core";
import { pythonGlobals, type ToolCallResult } from "@vensim-ai/agent";

/** Long enough for a real numerical check over a few thousand simulated steps, short enough that
 * a `while True:` doesn't hold the terminal until you notice and ^C. */
const TIMEOUT_MS = 30_000;

/** The same bootstrap Pyodide's runner performs, expressed for a real interpreter: inject the
 * globals as JSON, then run the model's code with them in scope. */
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
    // A timeout that doesn't fire has to be cancelled, or the process stays alive and the CLI
    // never exits — the classic "why is my terminal hung after the script finished" bug. The flag
    // rather than `proc.killed` decides the outcome: Bun reports `killed` for a process that has
    // merely finished, which would report every non-zero exit as a timeout.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, TIMEOUT_MS);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    clearTimeout(timer);

    // stdout and stderr are merged, exactly as the browser's runner does: a check that failed
    // half way through is most useful as its prints followed by the traceback that stopped it.
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
