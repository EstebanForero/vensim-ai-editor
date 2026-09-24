// The AI agent: one provider-agnostic loop, two backends, and the tool surface it drives.
//
// Lives apart from the app that first needed it because none of it is app-shaped — it is
// plumbing over an OpenAI-compatible or Gemini endpoint, and the CLI (`apps/cli`) is a second,
// headless front end onto the same loop. What a host has to supply is the one thing that really
// does differ between them: an interpreter for `run_python` (Pyodide in the browser, a local
// `python3` here), or none at all.

export * from "./agent.js";
export * from "./tools.js";
export * from "./providerPresets.js";
export * from "./types.js";
