import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useModelStore } from "@/state/modelStore";

/** The results panel for Ctrl+U / the toolbar's "Check Units" button — Vensim's own Units Check
 * (also Ctrl+U) opens a report window listing every variable whose equation's units don't work
 * out to its declared units; this mirrors that, grouped by variable. */
export function UnitsCheckDialog() {
  const open = useModelStore((s) => s.unitsDialogOpen);
  const setOpen = useModelStore((s) => s.setUnitsDialogOpen);
  const unitIssues = useModelStore((s) => s.unitIssues);
  const select = useModelStore((s) => s.select);

  const grouped = new Map<string, { name: string; messages: string[] }>();
  for (const issue of unitIssues ?? []) {
    const entry = grouped.get(issue.variableId) ?? { name: issue.variableName, messages: [] };
    entry.messages.push(issue.message);
    grouped.set(issue.variableId, entry);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Units Check</DialogTitle>
          <DialogDescription>
            A structural check of each variable's equation against its declared units — the same idea as Vensim's own
            Ctrl+U. A variable with no declared units, or an equation this check can't fully resolve, is never flagged.
          </DialogDescription>
        </DialogHeader>

        {grouped.size === 0 ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="size-5 text-green-600" />
            No units issues found.
          </div>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {[...grouped.entries()].map(([id, entry]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  select(id);
                  setOpen(false);
                }}
                className="block w-full rounded-md border border-destructive/30 bg-destructive/5 p-2 text-left text-sm hover:bg-destructive/10"
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
                  {entry.name}
                </div>
                <ul className="mt-1 space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {entry.messages.map((m, i) => (
                    <li key={i} className="list-disc">
                      {m}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
