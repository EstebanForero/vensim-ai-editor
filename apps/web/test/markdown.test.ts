import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components/chat/Markdown.js";
import { Transcript } from "../src/components/chat/Transcript.js";
import type { ChatMessage } from "../src/components/chat/message.js";

/**
 * Markdown rendering, at the level the two panels actually consume it: what a string of assistant
 * text turns into, and — more importantly — what it does *not* turn into when the text belongs to
 * a role that isn't markdown.
 *
 * Rendered to a string rather than mounted, because nothing here is behaviour: it is a pure
 * function from text to markup, and that function is the whole component.
 */

// `Markdown` takes its text as children and there is no JSX in a `.ts` file, so `createElement` is
// the only way to call it — which is the one case the no-children-prop rule is wrong about.
// eslint-disable-next-line react/no-children-prop
const draw = (text: string, streaming = false) => renderToStaticMarkup(createElement(Markdown, { children: text, streaming }));

const drawTranscript = (messages: ChatMessage[]) =>
  renderToStaticMarkup(createElement(Transcript, { messages, running: false }));

const say = (role: ChatMessage["role"], text: string, streaming = false): ChatMessage => ({
  id: `${role}-1`,
  role,
  text,
  ...(streaming ? { streaming: true } : {}),
});

describe("an assistant reply", () => {
  test("emphasis, code and lists become elements rather than staying punctuation", () => {
    expect(draw("This is **wrong** and `Population` is the reason.")).toContain("<strong>wrong</strong>");
    expect(draw("This is **wrong** and `Population` is the reason.")).toContain("<code");
    expect(draw("- first\n- second")).toContain("<li");
    expect(draw("1. first\n2. second")).toContain("<ol");
  });

  test("a fenced block is drawn as a block, not as a chip with newlines in it", () => {
    const html = draw("```\nPopulation * Birth rate\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("Population * Birth rate");
  });

  test("headings get their own weight rather than the browser's", () => {
    expect(draw("## What I found")).toContain("<h2");
    // Present so the element is styled at all — Tailwind's preflight leaves headings at body size
    // and weight, so an unstyled one would be indistinguishable from a paragraph.
    expect(draw("## What I found")).toMatch(/<h2 class="[^"]*font-semibold/);
  });

  test("a GFM table becomes a table, in something that can scroll sideways", () => {
    const html = draw("| loop | sign |\n| --- | --- |\n| R1 | + |");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("overflow-x-auto");
  });

  test("a link opens away from the app, and an image is not fetched at all", () => {
    const link = draw("[the docs](https://example.com/x)");
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noreferrer"');

    // An image would be a request from the user's machine to a URL the model chose. Shown as a
    // link, so nothing happens until it is clicked.
    const image = draw("![a chart](https://example.com/tracker.png)");
    expect(image).not.toContain("<img");
    expect(image).toContain("[image: a chart]");
  });

  // Not a nicety: react-markdown's default is to leave HTML alone, and the guarantee that nothing
  // in a reply can inject an element rests on that staying true.
  test("raw HTML in a reply does not become an element", () => {
    const html = draw('<script>alert("x")</script> and <b>bold</b>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
  });

  test("the caret is the wrapper's, and only while the reply is still arriving", () => {
    expect(draw("half a sen", true)).toContain("reply-streaming");
    expect(draw("a whole reply")).not.toContain("reply-streaming");
  });

  // Empty text is the first thing a streamed reply is, and it must not throw or draw an empty
  // bubble's worth of block.
  test("an empty reply renders nothing rather than failing", () => {
    expect(draw("")).toBe('<div class="[&amp;&gt;*:first-child]:mt-0 [&amp;&gt;*:last-child]:mb-0 "></div>');
  });
});

describe("everything that is not an assistant reply", () => {
  // The failure this guards against is silent and ugly: markdown turns `set_relation_polarity`
  // into two pieces of italic text and a bulleted list into a list.
  test("a tool line is drawn exactly as recorded", () => {
    const html = drawTranscript([say("tool", '✓ add_stock({"name": "*initial*"})')]);
    expect(html).toContain("*initial*");
    expect(html).not.toContain("<em>");
    expect(html).not.toContain("<li");
  });

  test("the user's own words are drawn back as they typed them", () => {
    const html = drawTranscript([say("user", "- demand **falls** as price rises")]);
    expect(html).toContain("- demand **falls** as price rises");
    expect(html).not.toContain("<li");
    expect(html).not.toContain("<strong>");
  });

  test("an assistant reply in the same transcript is markdown", () => {
    const html = drawTranscript([say("user", "what is wrong?"), say("assistant", "The **sign** on `Demand` is flipped.")]);
    expect(html).toContain("<strong>sign</strong>");
    expect(html).toContain("<code");
  });

  test("only the streaming reply carries the caret", () => {
    const html = drawTranscript([say("assistant", "done"), say("assistant", "still going", true)]);
    expect(html.split("reply-streaming")).toHaveLength(2);
  });
});
