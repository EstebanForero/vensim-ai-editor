import { parseMdl, writeMdl, type Model } from "@vensim-ai/core";

export function downloadMdl(model: Model): void {
  const text = writeMdl(model);
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${model.name || "model"}.mdl`;
  a.click();
  URL.revokeObjectURL(url);
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
