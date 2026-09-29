import { beforeEach, describe, expect, test } from "bun:test";
import { addStock, createEmptyModel, type Model } from "@vensim-ai/core";
import { EDITOR_MODEL_KEY, loadEditorModel, saveEditorModel } from "../src/state/modelStore.js";

/**
 * Keeping the model across a reload, and — the half that matters — refusing to bring back one
 * that cannot be read.
 *
 * The test process has no `localStorage`, which is the same situation as a browser with storage
 * switched off, so one is installed here. The module reads the global on every call rather than
 * capturing it, so installing one is enough to exercise the real code path.
 */

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const install = (s: unknown) => {
  (globalThis as { localStorage?: unknown }).localStorage = s;
};

function aModel(): Model {
  const m = createEmptyModel("Account");
  addStock(m, { name: "Savings Balance", initialEquation: "10000", units: "€" });
  return m;
}

beforeEach(() => install(memoryStorage()));

describe("a saved model", () => {
  test("comes back as it went in", () => {
    const model = aModel();
    saveEditorModel(model);
    expect(loadEditorModel()).toEqual(model);
  });

  test("comes back after the next reload too, not only the first", () => {
    saveEditorModel(aModel());
    const first = loadEditorModel()!;
    saveEditorModel(first);
    expect(loadEditorModel()).toEqual(first);
  });

  test("is nowhere to be found when nothing was ever saved", () => {
    expect(loadEditorModel()).toBeNull();
  });
});

describe("a payload that cannot be trusted", () => {
  // Each of these is a way the canvas could have been handed something it cannot draw, and so a
  // way the editor could have failed to open at all. Falling back to a new model is the whole
  // point: the failure has to be a lost afternoon, never a broken app.
  test("that is not JSON is discarded rather than thrown", () => {
    localStorage.setItem(EDITOR_MODEL_KEY, "{ this is not json");
    expect(loadEditorModel()).toBeNull();
  });

  test("from another version is discarded rather than guessed at", () => {
    const model = aModel();
    localStorage.setItem(EDITOR_MODEL_KEY, JSON.stringify({ v: 99, model }));
    expect(loadEditorModel()).toBeNull();
  });

  test("without a version at all is discarded", () => {
    localStorage.setItem(EDITOR_MODEL_KEY, JSON.stringify({ model: aModel() }));
    expect(loadEditorModel()).toBeNull();
  });

  test("that is JSON but not a model is discarded", () => {
    for (const junk of [null, 42, "model", {}, { v: 1, model: { stocks: [] } }, { v: 1, model: { stocks: [], flows: [], auxiliaries: [], connectors: [], comments: [] } }]) {
      localStorage.setItem(EDITOR_MODEL_KEY, JSON.stringify(junk));
      expect({ junk, loaded: loadEditorModel() }).toEqual({ junk, loaded: null });
    }
  });
});

describe("storage that will not cooperate", () => {
  test("a write that fails does not take the edit down with it", () => {
    install({
      ...memoryStorage(),
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
    });
    expect(() => saveEditorModel(aModel())).not.toThrow();
  });

  test("having no storage at all is survivable in both directions", () => {
    install(undefined);
    expect(loadEditorModel()).toBeNull();
    expect(() => saveEditorModel(aModel())).not.toThrow();
  });
});
