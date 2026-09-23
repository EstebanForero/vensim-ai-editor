import { findVariable, lookupTableOf, setLookupTable } from "@vensim-ai/core";
import { useModelStore } from "@/state/modelStore";
import { LookupEditorDialog } from "./LookupEditorDialog";

/**
 * Mounts the lookup curve editor for whichever variable `lookupEditorId` names — the single
 * place it's rendered, so the canvas (double-clicking a lookup node) and the Inspector (the
 * "Edit lookup table" button) open the exact same dialog without either owning it. It lives at
 * the app root rather than inside the Inspector because the editor has to be usable for a
 * variable that isn't the currently selected one.
 */
export function LookupEditorHost() {
  const model = useModelStore((s) => s.model);
  const lookupEditorId = useModelStore((s) => s.lookupEditorId);
  const closeLookupEditor = useModelStore((s) => s.closeLookupEditor);
  const mutate = useModelStore((s) => s.mutate);

  const variable = lookupEditorId ? findVariable(model, lookupEditorId) : undefined;
  const table = variable ? lookupTableOf(variable, model) : null;

  return (
    <LookupEditorDialog
      open={!!variable}
      onOpenChange={(open) => {
        if (!open) closeLookupEditor();
      }}
      variableName={variable?.name ?? ""}
      table={table}
      onApply={(next) => {
        if (variable) mutate((m) => setLookupTable(m, variable.id, next));
      }}
    />
  );
}
