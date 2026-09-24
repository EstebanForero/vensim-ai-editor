import type { ArchetypeConfidence } from "@vensim-ai/core";
import { Shapes } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useModelStore } from "@/state/modelStore";

/** "likely" is the full signature; "possible" is a weaker form of it that a small diagram often
 * matches by coincidence. Styled apart rather than merged, so the weaker ones don't carry the
 * same weight as the structural matches. */
const CONFIDENCE_STYLES: Record<ArchetypeConfidence, string> = {
  likely: "bg-primary/10 text-primary",
  possible: "bg-muted text-muted-foreground",
};

/** The results panel for the toolbar's "Archetypes" button — the classic system-dynamics
 * archetypes the model's structure matches. */
export function ArchetypeDialog() {
  const open = useModelStore((s) => s.archetypeDialogOpen);
  const setOpen = useModelStore((s) => s.setArchetypeDialogOpen);
  const matches = useModelStore((s) => s.archetypeMatches);
  const select = useModelStore((s) => s.select);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Archetypes</DialogTitle>
          <DialogDescription>
            The classic systems archetypes this model's <em>structure</em> matches — an R loop and a B loop on one stock, two
            reinforcing loops fighting each other, and so on. These are candidates to confirm, not a verdict: a signature is
            necessary but not sufficient, so a small diagram can match several at once. Each names the loops and variables it
            was read from, so you can check it against the diagram. Delay-dependent archetypes (Shifting the Burden) aren't
            listed — telling those apart needs to know which path is slow, which needs DELAY/SMOOTH support the simulator
            doesn't have yet.
          </DialogDescription>
        </DialogHeader>

        {!matches || matches.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Shapes className="size-5" />
            {!matches
              ? "Run the check to see archetype candidates."
              : "No structural matches found — which means no match, not no archetype: a model that has the pattern modelled differently from these signatures won't be picked up."}
          </div>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {matches.map((match) => (
              <button
                key={match.id}
                type="button"
                onClick={() => {
                  // Land on the variable the archetype is *about* (the shared resource, the
                  // fixed pair, ...) rather than the first loop's arbitrary starting node.
                  select(match.nodeIds[0] ?? null);
                  setOpen(false);
                }}
                className="block w-full rounded-md border border-border bg-card p-2 text-left text-sm hover:bg-accent/50"
              >
                <div className="flex items-center gap-2 font-medium">
                  <Shapes className="size-3.5 shrink-0 text-muted-foreground" />
                  {match.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-normal tracking-wide uppercase ${CONFIDENCE_STYLES[match.confidence]}`}
                  >
                    {match.confidence}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {match.loopLabels.map((label) => (
                      <span key={label} className="rounded border border-border px-1 py-0.5 text-[10px] font-normal">
                        {label}
                      </span>
                    ))}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{match.summary}</p>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
