import type { Model } from "@vensim-ai/core";

/** `base`, or `base 2`, `base 3`, … — whichever isn't already a stock/flow/auxiliary name. */
export function uniqueName(model: Pick<Model, "stocks" | "flows" | "auxiliaries">, base: string): string {
  const all = new Set([...model.stocks, ...model.flows, ...model.auxiliaries].map((v) => v.name));
  if (!all.has(base)) return base;
  let i = 2;
  while (all.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}
