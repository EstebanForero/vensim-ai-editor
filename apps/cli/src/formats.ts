// The file formats this can write. A table rather than a switch so that adding one — an import
// format, a different dialect — is a row here and nothing else: the flag that selects it, the
// help text, the default extension and the writer all read from these entries.

import { writeMdl, writeXmile, type Model } from "@vensim-ai/core";

export interface OutputFormat {
  name: string;
  extension: string;
  write(model: Model): string;
  /** What to say about it in `--help`, when there's something worth saying. */
  note?: string;
}

export const FORMATS = {
  mdl: {
    name: "mdl",
    extension: "mdl",
    write: writeMdl,
    note: "Vensim's own format, and what this editor reads back.",
  },
  xmile: {
    name: "xmile",
    extension: "xmile",
    write: writeXmile,
    note: "The OASIS open standard — Vensim opens it directly, and it avoids .mdl's flow-valve quirk.",
  },
} as const satisfies Record<string, OutputFormat>;

export type FormatName = keyof typeof FORMATS;

export const FORMAT_NAMES = Object.keys(FORMATS) as FormatName[];

export function formatOf(name: FormatName): OutputFormat {
  return FORMATS[name];
}
