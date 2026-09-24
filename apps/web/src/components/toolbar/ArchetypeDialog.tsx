import { ARCHETYPES, type ArchetypeConfidence, type ArchetypeMatch } from "@vensim-ai/core";
import { useReactFlow } from "@xyflow/react";
import { Shapes } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useModelStore } from "@/state/modelStore";
import { ARCHETYPE_DIAGRAMS } from "./archetypeExamples";

/** "likely" is the full signature; "possible" is a weaker form of it that a small diagram often
 * matches by coincidence. Styled apart rather than merged, so the weaker ones don't carry the
 * same weight as the structural matches. */
const CONFIDENCE_STYLES: Record<ArchetypeConfidence, string> = {
  likely: "bg-primary/10 text-primary",
  possible: "bg-muted text-muted-foreground",
};

const MEANINGS = new Map(ARCHETYPES.map((a) => [a.id, a.meaning]));

function ConfidencePill({ confidence }: { confidence: ArchetypeConfidence }) {
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-normal tracking-wide uppercase ${CONFIDENCE_STYLES[confidence]}`}>
      {confidence}
    </span>
  );
}

/** The results panel for the toolbar's "Archetypes" button — the classic system-dynamics
 * archetypes the model's structure matches, each with a schematic and a runnable example. */
export function ArchetypeDialog() {
  const open = useModelStore((s) => s.archetypeDialogOpen);
  const setOpen = useModelStore((s) => s.setArchetypeDialogOpen);
  const matches = useModelStore((s) => s.archetypeMatches);
  const loadExample = useModelStore((s) => s.loadArchetypeExample);
  const { fitView } = useReactFlow();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The example's own coordinates are nothing like the current model's, so without this it lands
  // somewhere off-screen — the same reason Auto Layout fits the view after re-arranging.
  const openExample = useCallback(
    (match: ArchetypeMatch) => {
      if (loadExample(match)) requestAnimationFrame(() => fitView({ duration: 300, padding: 0.2 }));
    },
    [loadExample, fitView],
  );

  // Derived rather than stored, so a fresh report opens on its first candidate and a selection
  // whose match no longer exists falls back on its own — no effect needed to keep them in step.
  const selected = matches?.find((m) => m.id === selectedId) ?? matches?.[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Archetypes</DialogTitle>
          <DialogDescription>
            The classic systems archetypes this model's <em>structure</em> matches — an R loop and a B loop on one stock, two
            reinforcing loops fighting each other, and so on. These are candidates to confirm, not a verdict: a signature is
            necessary but not sufficient, so a small diagram can match several at once. Each names the loops and variables it
            was read from, so you can check it against the diagram.
          </DialogDescription>
        </DialogHeader>

        {!matches || matches.length === 0 ? (
          <EmptyState hasRun={!!matches} />
        ) : (
          <div className="flex max-h-[32rem] gap-4">
            <div className="w-64 shrink-0 space-y-2 overflow-y-auto pr-1">
              {matches.map((match) => (
                <CandidateRow
                  key={match.id}
                  match={match}
                  selected={match.id === selected?.id}
                  onSelect={() => setSelectedId(match.id)}
                />
              ))}
            </div>
            {selected && <CandidateDetail key={selected.id} match={selected} onOpenExample={openExample} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ hasRun }: { hasRun: boolean }) {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
      <Shapes className="size-5 shrink-0" />
      {hasRun
        ? "No structural matches found — which means no match, not no archetype: a model that has the pattern modelled differently from these signatures won't be picked up."
        : "Run the check to see archetype candidates."}
    </div>
  );
}

function CandidateRow({ match, selected, onSelect }: { match: ArchetypeMatch; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`block w-full rounded-md border p-2 text-left text-sm ${
        selected ? "border-primary/50 bg-accent" : "border-border bg-card hover:bg-accent/50"
      }`}
    >
      <div className="flex items-center gap-1.5 font-medium">
        <span className="truncate">{match.label}</span>
        <ConfidencePill confidence={match.confidence} />
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {match.loopLabels.map((label) => (
          <span key={label} className="rounded border border-border px-1 py-0.5 text-[10px] text-muted-foreground">
            {label}
          </span>
        ))}
      </div>
    </button>
  );
}

function CandidateDetail({ match, onOpenExample }: { match: ArchetypeMatch; onOpenExample: (match: ArchetypeMatch) => void }) {
  const Diagram = ARCHETYPE_DIAGRAMS[match.archetype];
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{match.label}</h3>
        <ConfidencePill confidence={match.confidence} />
      </div>
      {/* Keyed on the match by the caller, so the SVG's single marker id is never duplicated. */}
      <div className="rounded-md border border-border bg-card p-2">
        <Diagram />
      </div>
      <p className="mt-2 text-sm">{MEANINGS.get(match.archetype)}</p>
      <p className="mt-2 text-xs text-muted-foreground">{match.summary}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={() => onOpenExample(match)}>
        Open example
      </Button>
    </div>
  );
}
