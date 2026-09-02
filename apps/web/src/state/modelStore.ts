import {
  createEmptyModel,
  simulate,
  validateModel,
  type Model,
  type SimResult,
  type ValidationIssue,
} from "@vensim-ai/core";
import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
}

interface ModelStoreState {
  model: Model;
  selectedId: string | null;
  simResult: SimResult | null;
  issues: ValidationIssue[];
  apiKey: string;
  chatMessages: ChatMessage[];
  isAgentRunning: boolean;

  setModel: (model: Model) => void;
  /** Applies an in-place mutation (a @vensim-ai/core builder call) and commits a fresh snapshot. */
  mutate: (fn: (model: Model) => void) => void;
  select: (id: string | null) => void;
  runSimulation: () => void;
  setApiKey: (key: string) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setAgentRunning: (running: boolean) => void;
  clearChat: () => void;
}

function commit(model: Model) {
  return { model: structuredClone(model), issues: validateModel(model) };
}

export const useModelStore = create<ModelStoreState>((set, get) => ({
  model: createEmptyModel("Untitled Model"),
  selectedId: null,
  simResult: null,
  issues: [],
  apiKey: typeof localStorage !== "undefined" ? (localStorage.getItem("vensim-ai:apiKey") ?? "") : "",
  chatMessages: [],
  isAgentRunning: false,

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

  setApiKey: (key) => {
    if (typeof localStorage !== "undefined") localStorage.setItem("vensim-ai:apiKey", key);
    set({ apiKey: key });
  },

  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  setAgentRunning: (running) => set({ isAgentRunning: running }),
  clearChat: () => set({ chatMessages: [] }),
}));
