/**
 * The categorical series colors, in the fixed order they're assigned: a series' color follows the
 * entity, never its rank, so the same variable keeps its color as the selection changes.
 *
 * One list, shared by every chart in the app, so a variable that's violet in the Simulation panel
 * is violet wherever else it's plotted. Assigned by index and never cycled — past the eighth
 * series a chart should fold the rest into "other" or facet rather than start generating hues.
 *
 * The values are the `--chart-*` theme tokens rather than fixed colors, because the two themes
 * need different steps: these are the app's own colors, and a series that reads well on white can
 * sit within 1.2:1 of the dark card. Identity never rests on color alone in any case — every
 * series sharing a chart is also named and valued in text beside it.
 */
export const CHART_PALETTE = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`);

/**
 * The same color at a low opacity, for a wash behind a chip or a label — `color-mix` rather than
 * string-concatenating an alpha suffix, which a `var()` reference can't take.
 */
export function chartWash(color: string, percent = 13): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}
