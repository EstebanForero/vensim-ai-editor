// The schematic shown for each archetype in the report.
//
// Drawn by hand rather than rendered from the archetype's example model: these are textbook
// figures with generic role names ("Quick fix", "Capacity"), not pictures of a particular model,
// and building a real Model just to draw three boxes would tie the explanation to the canvas
// machinery. They do borrow the canvas's own color tokens (--stock-*, --aux-color,
// --connector-color, --loop-r-color/--loop-b-color from index.css), so the figure still reads as
// the same visual language as the diagram it's being compared against.
//
// Only minus signs are drawn. A relation is "+" unless marked otherwise, and the R/B badge
// already states what the signs add up to — so the pluses were four more glyphs per figure
// saying what the badge says once.

import type { ArchetypeId } from "@vensim-ai/core";

/** One causal link. Arrowheads inherit the line color through `context-stroke`, so a single
 * marker definition serves every figure. */
function Arrow({ d, sign, at }: { d: string; sign?: "−"; at?: readonly [number, number] }) {
  return (
    <>
      <path d={d} fill="none" stroke="var(--connector-color)" strokeWidth={1.5} markerEnd="url(#arch-ex-arrow)" />
      {sign && at && (
        <text x={at[0]} y={at[1]} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700} fill="var(--connector-color)">
          {sign}
        </text>
      )}
    </>
  );
}

/** A stock box or a plain variable label, styled as the canvas draws each. */
function Box({ x, y, label, stock }: { x: number; y: number; label: string; stock?: boolean }) {
  const w = 92;
  const h = 30;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={stock ? 3 : h / 2}
        fill={stock ? "var(--stock-fill)" : "var(--background)"}
        stroke={stock ? "var(--stock-border)" : "var(--aux-color)"}
        strokeWidth={stock ? 2 : 1.5}
      />
      <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="var(--foreground)">
        {label}
      </text>
    </g>
  );
}

/** The R/B badge the canvas draws, at the point given. */
function LoopBadge({ cx, cy, polarity, n }: { cx: number; cy: number; polarity: "R" | "B"; n: number }) {
  const color = polarity === "R" ? "var(--loop-r-color)" : "var(--loop-b-color)";
  return (
    <g>
      <circle cx={cx} cy={cy} r={13} fill="var(--background)" stroke={color} strokeWidth={2} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill={color}>
        {polarity}
        {n}
      </text>
    </g>
  );
}

/** The shared canvas for every figure. Height-capped so a wide dialog can't stretch the figure
 * tall enough to push the meaning and the "Open example" button out of view — the pane scrolls,
 * but a button you have to scroll to find is one you don't find. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 320 190" className="max-h-72 w-full" role="img">
      <defs>
        <marker id="arch-ex-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>
      {children}
    </svg>
  );
}

/** Limits to Growth — a reinforcing loop grows the state, a balancing loop tightens as it grows,
 * so the growth flattens instead of continuing. */
function LimitsToGrowth() {
  return (
    <Frame>
      <Box x={114} y={10} label="State" stock />
      <Box x={12} y={138} label="Growth" />
      <Box x={216} y={138} label="Limit" />
      <Arrow d="M 140 42 L 76 136" />
      <Arrow d="M 12 153 L 4 153 L 4 25 L 112 25" />
      <Arrow d="M 180 42 L 244 136" />
      <Arrow d="M 308 153 L 316 153 L 316 25 L 208 25" sign="−" at={[284, 16]} />
      <LoopBadge cx={50} cy={92} polarity="R" n={1} />
      <LoopBadge cx={270} cy={92} polarity="B" n={1} />
    </Frame>
  );
}

/** Tragedy of the Commons — two loops drawing on one shared stock. Neither equation mentions the
 * other, which is exactly why the depletion goes unnoticed. */
function TragedyOfTheCommons() {
  return (
    <Frame>
      <Box x={16} y={12} label="User A" />
      <Box x={212} y={12} label="User B" />
      <Box x={114} y={140} label="Resource" stock />
      <Arrow d="M 68 44 L 140 138" sign="−" at={[88, 86]} />
      <Arrow d="M 114 170 L 6 170 L 6 27 L 14 27" />
      <Arrow d="M 252 44 L 180 138" sign="−" at={[232, 86]} />
      <Arrow d="M 206 170 L 314 170 L 314 27 L 306 27" />
      <LoopBadge cx={44} cy={54} polarity="B" n={1} />
      <LoopBadge cx={276} cy={54} polarity="B" n={2} />
    </Frame>
  );
}

/** Escalation — two reinforcing loops, each pushing the other's side down, so neither can back
 * off without losing ground. */
function Escalation() {
  return (
    <Frame>
      <Box x={10} y={10} label="My Activity" />
      <Box x={218} y={10} label="Their Activity" />
      <Box x={10} y={142} label="My Result" />
      <Box x={218} y={142} label="Their Result" />
      <Arrow d="M 40 40 L 40 140" />
      <Arrow d="M 74 142 L 74 42" />
      <Arrow d="M 248 40 L 248 140" />
      <Arrow d="M 282 142 L 282 42" />
      {/* The two cross-links are the whole archetype, and as straight lines they lie almost
          exactly on top of one another — one thick arrow with two minus signs smeared together.
          Bowed apart instead, so each is a link you can trace and each sign belongs to a line. */}
      <Arrow d="M 100 38 Q 204 62 240 142" sign="−" at={[194, 68]} />
      <Arrow d="M 218 150 Q 118 126 102 42" sign="−" at={[132, 118]} />
      <LoopBadge cx={57} cy={90} polarity="R" n={1} />
      <LoopBadge cx={265} cy={90} polarity="R" n={2} />
    </Frame>
  );
}

/** Success to the Successful — one allocation feeding two reinforcing loops, so whichever side is
 * ahead gets more of it and pulls further ahead. */
function SuccessToTheSuccessful() {
  return (
    <Frame>
      <Box x={114} y={10} label="Allocation" />
      <Box x={16} y={140} label="Activity A" />
      <Box x={212} y={140} label="Activity B" />
      <Arrow d="M 140 42 L 74 138" />
      <Arrow d="M 16 165 L 4 165 L 4 25 L 112 25" />
      <Arrow d="M 180 42 L 246 138" />
      <Arrow d="M 304 165 L 316 165 L 316 25 L 208 25" />
      <LoopBadge cx={50} cy={100} polarity="R" n={1} />
      <LoopBadge cx={270} cy={100} polarity="R" n={2} />
    </Frame>
  );
}

/** Fixes that Fail — a balancing loop that fixes the problem and a reinforcing loop through the
 * unintended consequence, so the problem comes back. */
function FixesThatFail() {
  return (
    <Frame>
      <Box x={10} y={10} label="Problem" />
      <Box x={218} y={10} label="Fix" />
      <Box x={114} y={148} label="Side Effect" />
      <Arrow d="M 104 25 L 216 25" />
      <Arrow d="M 232 42 L 80 40" sign="−" at={[160, 52]} />
      <Arrow d="M 248 42 L 194 146" />
      <Arrow d="M 114 163 L 10 163 L 10 44" />
      {/* Both badges sit in their own loop's interior. B1's loop is the thin sliver between the
          two arrows at the top, which is too narrow to hold a badge, so it goes directly beneath
          it — leaving it mid-figure put it closer to the R loop than to the one it names. */}
      <LoopBadge cx={150} cy={62} polarity="B" n={1} />
      <LoopBadge cx={120} cy={112} polarity="R" n={1} />
    </Frame>
  );
}

/** Shifting the Burden — a problem with two solutions, one immediate and one that takes time,
 * where the immediate one erodes the capacity the other depends on. The two solution boxes are
 * named for what distinguishes them, since that distinction *is* the archetype. */
function ShiftingTheBurden() {
  return (
    <Frame>
      <Box x={114} y={8} label="Problem" stock />
      <Box x={8} y={104} label="Quick fix" />
      <Box x={216} y={104} label="Delayed fix" />
      <Box x={114} y={154} label="Capacity" stock />
      {/* The minus belongs on the *solution → problem* link — more relief, less problem — not on
          problem → solution, which is "more problem, more relief". Either way the loop sums to B,
          so the wrong pairing looks right until you read it: it says more problem means less
          fixing. */}
      <Arrow d="M 140 38 L 78 102" />
      <Arrow d="M 8 118 L 2 118 L 2 23 L 112 23" sign="−" at={[56, 16]} />
      <Arrow d="M 180 38 L 242 102" />
      <Arrow d="M 312 118 L 318 118 L 318 23 L 208 23" sign="−" at={[268, 16]} />
      <Arrow d="M 78 134 L 132 160" sign="−" at={[92, 154]} />
      {/* Capacity feeds the delayed fix — without this the R badge labeled a loop with no visible
          closure, since the erosion arrow alone is only one side of it. */}
      <Arrow d="M 206 169 L 240 169 L 240 136" />
      <LoopBadge cx={54} cy={62} polarity="B" n={1} />
      <LoopBadge cx={286} cy={62} polarity="B" n={2} />
      {/* Inside the erosion cycle (quick fix → capacity → delayed fix → problem), not on top of
          the Capacity box, which is where it landed when the box was drawn last. */}
      <LoopBadge cx={158} cy={122} polarity="R" n={1} />
    </Frame>
  );
}

export const ARCHETYPE_DIAGRAMS: Record<ArchetypeId, () => React.ReactElement> = {
  "limits-to-growth": LimitsToGrowth,
  "tragedy-of-the-commons": TragedyOfTheCommons,
  escalation: Escalation,
  "success-to-the-successful": SuccessToTheSuccessful,
  "fixes-that-fail": FixesThatFail,
  "shifting-the-burden": ShiftingTheBurden,
};
