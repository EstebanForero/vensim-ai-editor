// Imperative API to mutate a Model in place — the single code path both the UI and the AI
// tools go through, split by the kind of element each module manages.
export * from "./auxiliary.js";
export * from "./comment.js";
export * from "./connector.js";
export * from "./flow.js";
export * from "./mutations.js";
export * from "./stock.js";
