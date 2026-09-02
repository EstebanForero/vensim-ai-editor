import { listFunctions } from "@vensim-ai/core";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface EquationVariableHint {
  name: string;
  units: string;
}

interface Suggestion {
  name: string;
  hint: string;
}

const FUNCTIONS = listFunctions().map((f) => ({ name: f.name.replace(/_/g, " "), hint: f.description }));

/** Finds the identifier being typed immediately before the caret, e.g. "Population * Bir|"
 * (caret at |) -> "Bir", so it can be replaced by whatever suggestion the user picks. Doesn't
 * try to handle a partial *quoted* multi-word name — only a plain trailing word. */
function currentWordRange(text: string, caret: number): { start: number; end: number; word: string } | null {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1]!)) start--;
  if (start === caret) return null;
  return { start, end: caret, word: text.slice(start, caret) };
}

/**
 * An equation textarea with autocomplete for variable names (showing each one's units) and
 * built-in Vensim functions (showing a one-line description) — typing a few letters of either
 * suggests matches; Tab/Enter/click inserts the full name at the cursor.
 */
export function EquationInput({
  id,
  value,
  onChange,
  onBlur,
  variables,
  rows = 3,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  variables: EquationVariableHint[];
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const varSuggestions: Suggestion[] = useMemo(() => variables.map((v) => ({ name: v.name, hint: v.units || "—" })), [variables]);

  const word = ref.current ? currentWordRange(value, ref.current.selectionStart ?? value.length) : null;

  const matches = useMemo(() => {
    if (!word || word.word.length === 0) return [];
    const needle = word.word.toLowerCase();
    const all = [...varSuggestions, ...FUNCTIONS];
    return all.filter((s) => s.name.replace(/\s/g, "").toLowerCase().startsWith(needle.replace(/\s/g, ""))).slice(0, 8);
  }, [word, varSuggestions]);

  const showSuggestions = open && matches.length > 0;

  const applySuggestion = (s: Suggestion) => {
    const el = ref.current;
    if (!el || !word) return;
    const needsQuotes = /\s/.test(s.name);
    const replacement = needsQuotes ? `"${s.name}"` : s.name;
    const next = value.slice(0, word.start) + replacement + value.slice(word.end);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const caret = word.start + replacement.length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="relative">
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        value={value}
        className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onBlur={() => {
          // let a click on a suggestion register before the list disappears
          setTimeout(() => setOpen(false), 120);
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (!showSuggestions) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === "Tab" || e.key === "Enter") {
            e.preventDefault();
            applySuggestion(matches[activeIndex]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showSuggestions && (
        <div className="absolute z-20 mt-1 w-full max-w-sm rounded-md border bg-popover shadow-lg">
          {matches.map((s, i) => (
            <button
              key={s.name}
              type="button"
              className={cn(
                "flex w-full items-center justify-between gap-3 px-2 py-1 text-left text-xs",
                i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
              onMouseDown={(e) => e.preventDefault()} // keep textarea focused through the click
              onClick={() => applySuggestion(s)}
            >
              <span className="font-mono font-medium">{s.name}</span>
              <span className="truncate text-muted-foreground">{s.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
