import { parseMdl, writeMdl, writeXmile, type Model } from "@vensim-ai/core";

function download(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadMdl(model: Model): void {
  download(writeMdl(model), `${model.name || "model"}.mdl`, "text/plain");
}

/** XMILE (the OASIS open standard) as an alternative export target — Vensim can open it
 * directly (File > Open, XMILE filter) using its own built-in importer, which sidesteps the
 * undocumented valve/label "attachment" quirk in Vensim's own native `.mdl` sketch format (see
 * packages/core/src/xmile/writer.ts for the full story). */
export function downloadXmile(model: Model): void {
  download(writeXmile(model), `${model.name || "model"}.xmile`, "application/xml");
}

export function openMdlFilePicker(onLoaded: (model: Model, fileName: string) => void, onError: (message: string) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".mdl,text/plain";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const model = parseMdl(String(reader.result));
        model.name = file.name.replace(/\.mdl$/i, "");
        onLoaded(model, file.name);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.onerror = () => onError("Could not read file.");
    reader.readAsText(file);
  };
  input.click();
}
