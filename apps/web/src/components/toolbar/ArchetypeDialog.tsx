import { ARCHETYPES, type ArchetypeConfidence, type ArchetypeId, type ArchetypeMatch } from "@vensim-ai/core";
import { useReactFlow } from "@xyflow/react";
import { Shapes } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useModelStore } from "@/state/modelStore";
import { ArchetypeCurve } from "./ArchetypeCurve";
import { ARCHETYPE_DIAGRAMS } from "./archetypeExamples";

/** "likely" is the full signature; "possible" is a weaker form of it that a small diagram often
 * matches by coincidence. Styled apart rather than merged, so the weaker ones don't carry the
 * same weight as the structural matches. */
const CONFIDENCE_STYLES: Record<ArchetypeConfidence, string> = {
  likely: "bg-primary/10 text-primary",
  possible: "bg-muted text-muted-foreground",
};

const MEANINGS = new Map(ARCHETYPES.map((a) => [a.id, a.meaning]));

/**
 * One line in the list: a candidate found in the current model, or — with `match` null — an
 * archetype this model doesn't match, kept so the examples stay reachable from a model that has
 * nothing to report.
 *
 * Keyed per *match* rather than per archetype, because one model can contain the same archetype
 * twice (two separate Limits to Growth structures) and those are two distinct candidates.
 */
interface Row {
  key: string;
  id: ArchetypeId;
  label: string;
  match: ArchetypeMatch | null;
}

function ConfidencePill({ confidence }: { confidence: ArchetypeConfidence }) {
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-normal tracking-wide uppercase ${CONFIDENCE_STYLES[confidence]}`}>
      {confidence}
    </span>
  );
}

/** The results panel for the toolbar's "Archetypes" button.
 *
 * Every archetype is listed, not only the ones the model matches. The examples are the point of
 * the panel as much as the findings are — they're how you learn what the pattern looks like — and
 * gating them behind a match meant that on an empty or unmatched model (the app's own starting
 * state) there was nothing to click and no way to reach any of them. */
export function ArchetypeDialog() {
  const open = useModelStore((s) => s.archetypeDialogOpen);
  const setOpen = useModelStore((s) => s.setArchetypeDialogOpen);
  const matches = useModelStore((s) => s.archetypeMatches);
  const loadExample = useModelStore((s) => s.loadArchetypeExample);
  const { fitView } = useReactFlow();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Matches first — they're the report — then every archetype the model didn't match. Both
  // groups keep the table's order, so the list is stable between runs.
  const rows = useMemo<Row[]>(() => {
    const found = (matches ?? []).map((m) => ({ key: m.id, id: m.archetype, label: m.label, match: m }));
    const matchedIds = new Set(found.map((r) => r.id));
    const rest = ARCHETYPES.filter((a) => !matchedIds.has(a.id)).map((a) => ({
      key: `archetype:${a.id}`,
      id: a.id,
      label: a.label,
      match: null,
    }));
    return [...found, ...rest];
  }, [matches]);

  // The example's own coordinates are nothing like the current model's, so without this it lands
  // somewhere off-screen — the same reason Auto Layout fits the view after re-arranging.
  const openExample = useCallback(
    (row: Row) => {
      if (loadExample({ archetype: row.id, label: row.label })) {
        requestAnimationFrame(() => fitView({ duration: 300, padding: 0.2 }));
      }
    },
    [loadExample, fitView],
  );

  // Derived rather than stored, so a fresh report opens on its first candidate and a selection
  // whose row no longer exists falls back on its own — no effect needed to keep them in step.
  const selected = rows.find((r) => r.key === selectedKey) ?? rows[0] ?? null;
  const firstUnmatched = rows.findIndex((r) => !r.match);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Archetypes</DialogTitle>
          <DialogDescription>
            The classic systems archetypes, each with a schematic, a sample curve and a model you can open and run. The
            ones this model's <em>structure</em> matches are listed first — candidates to confirm, not a verdict, since
            a signature is necessary but not sufficient and a small diagram can match several at once. Each names the
            loops and variables it was read from, so you can check it against the diagram.
          </DialogDescription>
        </DialogHeader>

        {/* Tall enough to show the schematic, the sample curve and its slider together — the
            slider is the point of the curve panel and must not be something you have to scroll to
            find — but bounded by the viewport, so on a short screen it scrolls instead. */}
        <div className="flex max-h-[max(24rem,calc(100vh-13rem))] gap-4">
          <div className="w-64 shrink-0 space-y-2 overflow-y-auto pr-1">
            {/* Here rather than above the two columns: it belongs to the list (this is every
                archetype, not the ones found), and the column below the six rows is empty space
                the detail pane next to it can't afford to waste. */}
            {matches !== null && matches.length === 0 && (
              <p className="flex items-start gap-1.5 rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                <Shapes className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  No structural matches — no match, not no archetype: a model that has the pattern modelled differently
                  from these signatures won't be picked up.
                </span>
              </p>
            )}
            {rows.map((row, i) => (
              <Fragment key={row.key}>
                {i === firstUnmatched && (
                  <div className="pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    {firstUnmatched > 0 ? "Not in this model" : "All archetypes"}
                  </div>
                )}
                <CandidateRow row={row} selected={row.key === selected?.key} onSelect={() => setSelectedKey(row.key)} />
              </Fragment>
            ))}
          </div>
          {/* Keyed on the row, so the SVG's single marker id is never duplicated. */}
          {selected && <CandidateDetail key={selected.key} row={selected} onOpenExample={openExample} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CandidateRow({ row, selected, onSelect }: { row: Row; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`block w-full rounded-md border p-2 text-left text-sm ${
        selected ? "border-primary/50 bg-accent" : "border-border bg-card hover:bg-accent/50"
      }`}
    >
      <div className="flex items-center gap-1.5 font-medium">
        <span className="truncate">{row.label}</span>
        {row.match && <ConfidencePill confidence={row.match.confidence} />}
      </div>
      {row.match && (
        <div className="mt-1 flex flex-wrap gap-1">
          {row.match.loopLabels.map((label) => (
            <span key={label} className="rounded border border-border px-1 py-0.5 text-[10px] text-muted-foreground">
              {label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function CandidateDetail({ row, onOpenExample }: { row: Row; onOpenExample: (row: Row) => void }) {
  const Diagram = ARCHETYPE_DIAGRAMS[row.id];
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold">{row.label}</h3>
          {row.match && <ConfidencePill confidence={row.match.confidence} />}
        </div>
        <div className="rounded-md border border-border bg-card p-2">
          <Diagram />
        </div>
        {/* The structure above says what the archetype is made of; this says what that structure
            *does* when it runs — the same claim, in the other direction, and the one the example
            is checked against. */}
        <div className="mt-3 mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium">Sample curve</span>
          <span className="text-[10px] text-muted-foreground">the example's own run</span>
        </div>
        <ArchetypeCurve id={row.id} />
        <p className="mt-2 text-sm">{MEANINGS.get(row.id)}</p>
        {/* Only when there's something to say about *this* model. With no match the note above the
            list has already said it, and repeating it here cost two lines the panel can't spare —
            the slider below the curve has to stay above the fold. */}
        {row.match && <p className="mt-2 text-xs text-muted-foreground">{row.match.summary}</p>}
      </div>
      {/* Below the scroll area, not inside it: the button is the one thing here you can't find by
          scrolling past a long summary, so it must not be something you have to scroll to. */}
      <div className="shrink-0 pt-3">
        <Button size="sm" variant="outline" onClick={() => onOpenExample(row)}>
          Open example
        </Button>
      </div>
    </div>
  );
}
