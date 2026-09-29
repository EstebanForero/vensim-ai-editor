// Drills: questions about a model whose answers are known by construction.
//
// Read-only by design. Nothing here mutates a model, nothing here is consulted by the simulator,
// the loop detector, the archetype registry, the `.mdl` codec or the AI tools — the dependency runs
// one way, out of those modules and into this one. Deleting this folder would cost the Study tab's
// drills and nothing else, which is the point: practising must not be able to change what the
// editor does.

export * from "./types.js";
export * from "./situations.js";
export * from "./grade.js";
export * from "./generate.js";
export * from "./plantFault.js";
