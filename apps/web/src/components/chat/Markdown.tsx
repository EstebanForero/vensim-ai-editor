// An assistant reply, drawn as the markdown it is.
//
// The agent writes in markdown — bulleted findings, `code` around equations, the occasional
// heading or table — and drawing that as one pre-wrapped string makes the structure invisible:
// the reader sees the asterisks instead of the emphasis.
//
// Only assistant text goes through here. The user's own typing is not markdown, and rendering it
// as such would eat the `*` in an equation they pasted in; a tool line is `add_stock({...})`,
// whose underscores would come out as emphasis and whose braces the parser would have opinions
// about. Both are literal text and stay literal.
//
// react-markdown rather than markdown-to-HTML: it builds React elements, so nothing in a reply can
// inject any, and there is no sanitiser to keep in step with a parser. Raw HTML in a reply is
// shown as the text it is — which is the honest thing for it to be.

import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** One block's spacing, in the bubble's own scale. The first and last are trimmed by the wrapper
 * so the padding around the text is the bubble's and not a margin that happens to look like it. */
const BLOCK = "my-2 leading-relaxed";

/**
 * How each markdown element is drawn.
 *
 * Written out by element rather than pulled from a typography preset because these sit inside a
 * chat bubble, where the defaults are all wrong in the same direction: a `prose` heading is sized
 * for a document page, not for 14px of secondary-foreground text, and its vertical rhythm fights
 * the bubble's own padding. Every colour here is a theme token, so both themes come out right.
 *
 * Props are destructured rather than spread: react-markdown hands each component a `node` for the
 * AST position, and spreading it would put a `node` attribute on a DOM element.
 */
const components: Components = {
  p: ({ children }) => <p className={BLOCK}>{children}</p>,

  h1: ({ children }) => <h1 className="mt-3 mb-1.5 text-base font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1.5 text-[15px] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2.5 mb-1 text-sm font-medium">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-2.5 mb-1 text-sm font-medium">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-2.5 mb-1 text-sm font-medium text-muted-foreground">{children}</h6>,

  ul: ({ children }) => <ul className={`${BLOCK} list-disc space-y-1 pl-5`}>{children}</ul>,
  ol: ({ children }) => <ol className={`${BLOCK} list-decimal space-y-1 pl-5`}>{children}</ol>,
  // A list item is usually one line, so the paragraph inside it should not add a second gap.
  li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,

  // Inline code — an equation, a variable name, a tool name. The background is what marks it as
  // quoted text rather than a typographic flourish.
  //
  // `foreground/10` rather than `bg-muted`, and not by taste: `--muted` and `--secondary` are the
  // same value in both themes, and the assistant bubble is `bg-secondary` — so a muted chip is
  // exactly invisible in the one place it is drawn. Tinting the *text* colour instead contrasts
  // against whatever surface the chip ends up on, in either theme.
  code: ({ children }) => <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  // A fenced block is the same thing laid out, so the inner code drops the chip styling the
  // inline case gave it. `overflow-x-auto` keeps a long equation from widening the bubble, which
  // is one thing a chat bubble must never do.
  pre: ({ children }) => (
    <pre className={`${BLOCK} overflow-x-auto rounded-md bg-foreground/10 p-2 font-mono text-[11.5px] [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]`}>
      {children}
    </pre>
  ),

  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">
      {children}
    </a>
  ),

  // A reply is quoted material, and the reference here is what it is quoting.
  blockquote: ({ children }) => (
    <blockquote className={`${BLOCK} border-l-2 border-border pl-3 text-muted-foreground`}>{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,

  // GFM tables. Scrollable for the same reason as a code block: the bubble's width is not the
  // model's to spend.
  table: ({ children }) => (
    <div className={`${BLOCK} overflow-x-auto`}>
      <table className="w-full border-collapse text-[11.5px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-border/60 px-2 py-1 align-top">{children}</td>,

  // GFM task lists. Rendered explicitly because React warns about a `checked` input with no change
  // handler, and this one only ever records what the reply said.
  input: ({ checked }) => (
    <input type="checkbox" checked={Boolean(checked)} readOnly disabled className="mr-1.5 align-middle accent-[var(--primary)]" />
  ),

  // An image would make this app fetch a URL the model chose — a request from the user's machine
  // to a third party, for a picture nobody asked for, and a way to find out whether the reply was
  // read. Drawn as the link it is, so nothing is fetched until it is clicked.
  img: ({ src, alt }) => (
    <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
      {alt ? `[image: ${alt}]` : "[image]"}
    </a>
  ),
};

export interface MarkdownProps {
  children: string;
  /** True while the reply is still arriving — the wrapper takes the caret, which the stylesheet
   * hangs off whichever block turned out to be last. */
  streaming?: boolean;
}

/**
 * Memoised on the text: a streaming reply re-renders on every delta, and without this every
 * earlier message in the transcript would be re-parsed as markdown again each time one arrives.
 */
export const Markdown = memo(function Markdown({ children, streaming }: MarkdownProps): ReactNode {
  return (
    <div className={`[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${streaming ? "reply-streaming" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
