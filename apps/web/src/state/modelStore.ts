import {
  checkUnits,
  createEmptyModel,
  simulate,
  validateModel,
  type Model,
  type SimResult,
  type UnitIssue,
  type ValidationIssue,
} from "@vensim-ai/core";
import { create } from "zustand";
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from "@/lib/openai";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "warning";
  text: string;
}

function readLocalStorage(key: string, fallback: string): string {
  if (typeof localStorage === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}
function writeLocalStorage(key: string, value: string): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
}

interface ModelStoreState {
  model: Model;
  selectedId: string | null;
  simResult: SimResult | null;
  issues: ValidationIssue[];
  /** null = the units check (Ctrl+U, matching Vensim's own shortcut) hasn't been run yet this
   * session; [] = it was run and found nothing. Kept separate from `issues` (which re-validates
   * on every mutation) since a units check is a deliberate, on-demand report, same as in Vensim
   * itself, not a live-updating badge. */
  unitIssues: UnitIssue[] | null;
  unitsDialogOpen: boolean;
  chatMessages: ChatMessage[];
  isAgentRunning: boolean;

  /** OpenAI-compatible connection settings (all stored only in this browser's localStorage). */
  apiKey: string;
  baseUrl: string;
  aiModel: string;

  showLoops: boolean;
  /** When true, clicking two nodes in sequence on the canvas adds a relation between them. */
  relationMode: boolean;
  pendingRelationFrom: string | null;
  /** When true, clicking two endpoints in sequence draws a flow between them — a stock or
   * empty canvas (a cloud source/sink) for either end, in the order clicked (source, then
   * destination), so direction and which stock are always explicit rather than guessed. */
  flowMode: boolean;
  /** `stockId: null` means the picked endpoint was empty canvas (a cloud), not a stock. */
  pendingFlowFrom: { stockId: string | null; pos: { x: number; y: number } } | null;
  /** id of the node currently showing an inline rename/edit field, set by double-clicking it
   * on the canvas (via React Flow's own onNodeDoubleClick, not a raw DOM dblclick — that
   * reliably coexists with node dragging, where a plain DOM listener would not). */
  editingId: string | null;

  setModel: (model: Model) => void;
  /** Applies an in-place mutation (a @vensim-ai/core builder call) and commits a fresh snapshot. */
  mutate: (fn: (model: Model) => void) => void;
  select: (id: string | null) => void;
  runSimulation: () => void;
  runUnitsCheck: () => void;
  setUnitsDialogOpen: (open: boolean) => void;
  setApiKey: (key: string) => void;
  setBaseUrl: (url: string) => void;
  setAiModel: (name: string) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setAgentRunning: (running: boolean) => void;
  clearChat: () => void;
  toggleShowLoops: () => void;
  toggleRelationMode: () => void;
  setPendingRelationFrom: (id: string | null) => void;
  toggleFlowMode: () => void;
  setPendingFlowFrom: (v: { stockId: string | null; pos: { x: number; y: number } } | null) => void;
  setEditingId: (id: string | null) => void;
}

function commit(model: Model) {
  return { model: structuredClone(model), issues: validateModel(model) };
}

export const useModelStore = create<ModelStoreState>((set, get) => ({
  model: createEmptyModel("Untitled Model"),
  selectedId: null,
  simResult: null,
  issues: [],
  unitIssues: null,
  unitsDialogOpen: false,
  chatMessages: [],
  isAgentRunning: false,

  apiKey: readLocalStorage("vensim-ai:apiKey", ""),
  baseUrl: readLocalStorage("vensim-ai:baseUrl", DEFAULT_BASE_URL),
  aiModel: readLocalStorage("vensim-ai:model", DEFAULT_MODEL),

  showLoops: true,
  relationMode: false,
  pendingRelationFrom: null,
  flowMode: false,
  pendingFlowFrom: null,
  editingId: null,

  setModel: (model) => set({ ...commit(model), selectedId: null, simResult: null }),

  mutate: (fn) => {
    const { model } = get();
    fn(model);
    set(commit(model));
  },

  select: (id) => set({ selectedId: id }),

  runSimulation: () => {
    const { model } = get();
    try {
      set({ simResult: simulate(model) });
    } catch (err) {
      console.error(err);
      set({ simResult: null });
    }
  },

  runUnitsCheck: () => {
    const { model } = get();
    set({ unitIssues: checkUnits(model), unitsDialogOpen: true });
  },
  setUnitsDialogOpen: (open) => set({ unitsDialogOpen: open }),

  setApiKey: (key) => {
    writeLocalStorage("vensim-ai:apiKey", key);
    set({ apiKey: key });
  },
  setBaseUrl: (url) => {
    writeLocalStorage("vensim-ai:baseUrl", url);
    set({ baseUrl: url });
  },
  setAiModel: (name) => {
    writeLocalStorage("vensim-ai:model", name);
    set({ aiModel: name });
  },

  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  setAgentRunning: (running) => set({ isAgentRunning: running }),
  clearChat: () => set({ chatMessages: [] }),

  toggleShowLoops: () => set((s) => ({ showLoops: !s.showLoops })),
  toggleRelationMode: () =>
    set((s) => ({ relationMode: !s.relationMode, pendingRelationFrom: null, flowMode: false, pendingFlowFrom: null })),
  setPendingRelationFrom: (id) => set({ pendingRelationFrom: id }),
  toggleFlowMode: () => set((s) => ({ flowMode: !s.flowMode, pendingFlowFrom: null, relationMode: false, pendingRelationFrom: null })),
  setPendingFlowFrom: (v) => set({ pendingFlowFrom: v }),
  setEditingId: (id) => set({ editingId: id }),
}));
