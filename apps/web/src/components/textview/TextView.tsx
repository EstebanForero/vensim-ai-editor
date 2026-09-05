import { parseMdl, writeMdl } from "@vensim-ai/core";
import { Check, Copy, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useModelStore } from "@/state/modelStore";

/**
 * Live text-language view of the model — the same Vensim `.mdl` text that Save/Open use, so a
 * change made anywhere (canvas, inspector, or the AI chat) is always visible here as text, and
 * text edited here (by hand, or pasted from another AI) can be applied back onto the model.
 * Once the user starts typing, live model updates stop overwriting the draft until they Apply
 * or Discard, so an in-progress edit is never clobbered out from under them.
 */
export function TextView() {
  const model = useModelStore((s) => s.model);
  const setModel = useModelStore((s) => s.setModel);

  const [draft, setDraft] = useState(() => writeMdl(model));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(writeMdl(model));
  }, [model, dirty]);

  const apply = () => {
    try {
      const parsed = parseMdl(draft);
      parsed.name = model.name;
      setModel(parsed);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const discard = () => {
    setDraft(writeMdl(model));
    setDirty(false);
    setError(null);
  };

  const copy = () => {
    navigator.clipboard.writeText(draft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">Model as text</span>
          <p className="text-xs text-muted-foreground">
            Native Vensim <code>.mdl</code> syntax — the same format Save/Open use. Edit it directly, or paste in
            text from another AI, then Apply.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" className="size-7" onClick={copy} title="Copy to clipboard">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
          {dirty && (
            <Button size="icon" variant="ghost" className="size-7" onClick={discard} title="Discard edits">
              <RotateCcw className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <Textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
          setError(null);
        }}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none whitespace-pre font-mono text-[11px] leading-relaxed"
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        {dirty && <span className="text-xs text-muted-foreground">Unapplied changes</span>}
        <Button size="sm" onClick={apply} disabled={!dirty}>
          Apply to model
        </Button>
      </div>
    </div>
  );
}
