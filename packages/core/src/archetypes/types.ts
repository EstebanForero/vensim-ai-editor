// Public shapes of the archetype report. The archetypes themselves — their labels, meanings,
// detectors and examples — live in registry.ts; `ArchetypeId` is declared here explicitly rather
// than derived from that table, so this module has no imports and the table can import it
// without a cycle.

/** The classic system-dynamics archetypes this codebase can detect.
 *
 * Every one of these is decidable from the model itself: loop structure from the diagram, and —
 * for Shifting the Burden — the presence of a delay read from the equations. Archetypes that
 * would need to judge *intent* rather than structure are not here, and neither are ones whose
 * discriminating feature the model format can't express. */
export type ArchetypeId =
  | "limits-to-growth"
  | "tragedy-of-the-commons"
  | "escalation"
  | "success-to-the-successful"
  | "fixes-that-fail"
  | "shifting-the-burden";

/**
 * How much structure backs a match. `"likely"` means the full signature is present — e.g. both
 * loops are independent paths drawing on one shared stock. `"possible"` means a weaker form of
 * the same signature, which is worth showing but is more often a coincidence of a small diagram
 * than a real instance of the archetype.
 */
export type ArchetypeConfidence = "likely" | "possible";

/**
 * One structural match. Deliberately *not* a verdict: an archetype's signature is a necessary
 * condition, not a sufficient one, and a three-loop diagram will match several archetypes at
 * once. Every field here exists so a modeler can confirm or dismiss the candidate in one glance
 * rather than trusting the label.
 */
export interface ArchetypeMatch {
  /** Opaque, stable identifier for this match, derived from the structure it was found on — so
   * the same candidate keeps the same id as the model is edited around it. */
  id: string;
  archetype: ArchetypeId;
  /** The archetype's canonical name, e.g. "Limits to Growth". */
  label: string;
  confidence: ArchetypeConfidence;
  /**
   * What the model actually contains — the *structure*, never an interpretation of it. Says
   * "`R1` and `B1` both act on the same stock, `Water`", not "this model is limited by water":
   * the archetype name supplies the pattern, and this line lets the reader check it against the
   * diagram instead of taking it on faith. (What the pattern *means* is on the definition, in
   * registry.ts.)
   */
  summary: string;
  /** ids of the loops involved, as `detectLoops` returns them. */
  loopIds: string[];
  /** Their canvas labels ("R1", "B1", ...) — the same text the loop badges show, so a candidate
   * can be traced straight to what's drawn on the diagram. */
  loopLabels: string[];
  /** ids of the variables that define the match — the shared stock, the escalation pair, etc. */
  nodeIds: string[];
  nodeNames: string[];
}

export interface DetectArchetypesOptions {
  /** Most matches to return, most specific first. Default 12. */
  limit?: number;
}
