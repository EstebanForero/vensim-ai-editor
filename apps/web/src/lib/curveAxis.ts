// The vertical scale for a small chart: round tick values, and an axis top that the data fits
// under. Kept apart from the chart that uses it because "does the top of the curve fit" is the
// one thing about a chart that can be checked without looking at it.

/**
 * Four intervals at a step of 1, 2 or 5 times a power of ten, so every gridline lands on a number
 * a reader recognises — 0, 500, 1K, 1.5K, 2K rather than 0, 372, 744, 1116, 1488.
 *
 * The top is the last tick, which is what `ticks[ticks.length - 1]` returns and what the caller
 * must scale by. It is always >= `max`, so nothing is ever clipped: the smallest round step that
 * reaches the data is the one used, which bounds the headroom at 2.5x — the widest gap between
 * two steps, 2 to 5 — and typically leaves much less. A curve that peaks at 37 gets an axis to 40
 * rather than to 100, so it fills its frame instead of sitting in the bottom third of it.
 */
export function axisFor(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].find((s) => s * magnitude >= rough)! * magnitude;
  return { top: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * step) };
}
