// Lazily loads Pyodide (a real CPython interpreter compiled to WebAssembly) from a CDN, only
// when the AI actually calls run_python — this keeps the normal app bundle free of a multi-MB
// runtime for the (presumably common) case where a chat session never uses it. Everything runs
// fully client-side in the browser; no code or data is sent to any server beyond the CDN
// download of the interpreter itself.

interface PyodideInterface {
  runPythonAsync(code: string): Promise<unknown>;
  globals: { set(name: string, value: unknown): void };
  setStdout(options: { batched: (msg: string) => void }): void;
  setStderr(options: { batched: (msg: string) => void }): void;
}

declare global {
  interface Window {
    loadPyodide?: (options?: { indexURL?: string }) => Promise<PyodideInterface>;
  }
}

const PYODIDE_VERSION = "0.26.4";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise: Promise<PyodideInterface> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load Pyodide from ${src}`));
    document.head.appendChild(script);
  });
}

/** The interpreter is created once and reused for every run_python call in a session — each
 * call still gets fresh injected globals (see runPython below), but re-creating the whole
 * ~interpreter would re-download/re-initialize Pyodide every time, which is slow enough to
 * make the AI's validation loop impractically sluggish. */
async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      await loadScript(`${PYODIDE_CDN}pyodide.js`);
      if (!window.loadPyodide) throw new Error("Pyodide script loaded but window.loadPyodide is missing.");
      return window.loadPyodide({ indexURL: PYODIDE_CDN });
    })();
  }
  return pyodidePromise;
}

export interface RunPythonResult {
  ok: boolean;
  stdout: string;
  error: string | null;
}

/**
 * Runs `code` under Pyodide with `globals` injected as top-level Python names beforehand.
 * Injection goes through JSON (a single `_injected_json` string global, parsed and splatted
 * into `globals()` by a small bootstrap run first) rather than Pyodide's own JS<->Python proxy
 * conversion — deliberately, since JSON round-tripping has one unambiguous native-Python result
 * per value (dict/list/float/str/bool/None) that's easy to reason about and test, instead of
 * depending on proxy/conversion edge cases. `globals` values must therefore be JSON-serializable
 * (the simulation result and model summary this is meant for already are).
 *
 * Captures stdout/stderr into `stdout` and any raised exception's message into `error`, rather
 * than letting either escape — this is meant to hand the AI a clean pass/fail plus whatever it
 * printed, not raw interpreter internals.
 */
export async function runPython(code: string, globals: Record<string, unknown> = {}): Promise<RunPythonResult> {
  const pyodide = await getPyodide();
  let stdout = "";
  pyodide.setStdout({ batched: (msg) => (stdout += msg + "\n") });
  pyodide.setStderr({ batched: (msg) => (stdout += msg + "\n") });

  pyodide.globals.set("_injected_json", JSON.stringify(globals));
  try {
    await pyodide.runPythonAsync(
      "import json as _json\n" + "globals().update(_json.loads(_injected_json))\n" + "del _injected_json, _json\n",
    );
    await pyodide.runPythonAsync(code);
    return { ok: true, stdout, error: null };
  } catch (err) {
    return { ok: false, stdout, error: err instanceof Error ? err.message : String(err) };
  }
}
