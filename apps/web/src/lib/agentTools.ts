// The browser's `run_python`: a real CPython compiled to WebAssembly, loaded from a CDN on first
// use and run entirely inside the page. `@vensim-ai/agent` owns everything else about the tool —
// its name, its description, the globals it hands over — and takes this as the runner.

import type { Model } from "@vensim-ai/core";
import { makeToolExecutor, pythonGlobals, type ToolCallResult, type ToolExecutor } from "@vensim-ai/agent";
import { runPython } from "./pyodide.js";

async function runPythonTool(code: string, model: Model): Promise<ToolCallResult> {
  const run = await runPython(code, pythonGlobals(model));
  // stdout is worth returning either way (a failing check's prints, or a traceback's context up
  // to the point it failed), not just on success.
  if (run.ok) return { ok: true, result: { stdout: run.stdout } };
  return { ok: false, error: run.stdout ? `${run.error}\n\nstdout so far:\n${run.stdout}` : (run.error ?? "Unknown error") };
}

/** The executor the chat panel runs its turns through. */
export const executeToolCall: ToolExecutor = makeToolExecutor(runPythonTool);
