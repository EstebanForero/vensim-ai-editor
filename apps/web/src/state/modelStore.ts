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
  /** True while an assistant message is still being streamed in — lets the UI show a "still
   * typing" indicator on this specific bubble, cleared once the message completes. */
  streaming?: boolean;
}

function readLocalStorage(key: string, fallback: string): string {
  if (typeof localStorage === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}
function writeLocalStorage(key: string, value: string): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
}

export interface ConnectionProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

const CONNECTIONS_KEY = "vensim-ai:connections";
const ACTIVE_CONNECTION_KEY = "vensim-ai:activeConnectionId";

/** Loads every saved connection profile, migrating the old single apiKey/baseUrl/model keys
 * into a first "Default" profile the very first time this runs. Deliberately additive only:
 * the legacy `vensim-ai:apiKey`/`vensim-ai:baseUrl`/`vensim-ai:model` keys are read but never
 * cleared, so a user's already-saved key is never at risk of being wiped by this migration or
 * by anything that follows it. */
function loadConnections(): { connections: ConnectionProfile[]; activeId: string } {
  const raw = readLocalStorage(CONNECTIONS_KEY, "");
  let connections: ConnectionProfile[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) connections = parsed;
    } catch {
      connections = [];
    }
  }
  if (connections.length === 0) {
    connections = [
      {
        id: "default",
        name: "Default",
        apiKey: readLocalStorage("vensim-ai:apiKey", ""),
        baseUrl: readLocalStorage("vensim-ai:baseUrl", DEFAULT_BASE_URL),
        model: readLocalStorage("vensim-ai:model", DEFAULT_MODEL),
      },
    ];
  }
  const savedActiveId = readLocalStorage(ACTIVE_CONNECTION_KEY, connections[0]!.id);
  const activeId = connections.some((c) => c.id === savedActiveId) ? savedActiveId : connections[0]!.id;
  return { connections, activeId };
}

function saveConnections(connections: ConnectionProfile[]): void {
  writeLocalStorage(CONNECTIONS_KEY, JSON.stringify(connections));
}

/** Patches the currently active profile within `state.connections` and persists the result —
 * shared by setApiKey/setBaseUrl/setAiModel, which edit the active profile in place rather than
 * create a new one. */
function updateActive(state: { connections: ConnectionProfile[]; activeConnectionId: string }, patch: Partial<ConnectionProfile>): ConnectionProfile[] {
  const connections = state.connections.map((c) => (c.id === state.activeConnectionId ? { ...c, ...patch } : c));
  saveConnections(connections);
  return connections;
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

  /** OpenAI-compatible connection settings (all stored only in this browser's localStorage).
   * `apiKey`/`baseUrl`/`aiModel` always mirror the currently active profile in `connections` —
   * kept as top-level fields (rather than always reading through `connections`) so existing
   * consumers (the chat send path, in particular) don't need to know profiles exist at all. */
  apiKey: string;
  baseUrl: string;
  aiModel: string;
  connections: ConnectionProfile[];
  activeConnectionId: string;

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
  /** Adds a new profile (from a blank form or a provider preset) and switches to it. Never
   * touches any existing profile. */
  addConnectionProfile: (profile: Omit<ConnectionProfile, "id">) => void;
  /** Switches the active profile — apiKey/baseUrl/aiModel immediately mirror it. */
  selectConnectionProfile: (id: string) => void;
  /** Removes a profile (never the last remaining one — there must always be something to
   * select). Switches to the first remaining profile if the deleted one was active. */
  deleteConnectionProfile: (id: string) => void;
  renameConnectionProfile: (id: string, name: string) => void;
  addChatMessage: (msg: ChatMessage) => void;
  /** Appends `delta` to the message with `id`, creating it (as a streaming assistant message)
   * if it doesn't exist yet — the first chunk of a streamed reply and every chunk after it go
   * through this same call. */
  appendToChatMessage: (id: string, delta: string) => void;
  /** Marks a streamed message as complete (clears its `streaming` flag). */
  finalizeChatMessage: (id: string) => void;
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

  ...(() => {
    const { connections, activeId } = loadConnections();
    const active = connections.find((c) => c.id === activeId)!;
    return { connections, activeConnectionId: activeId, apiKey: active.apiKey, baseUrl: active.baseUrl, aiModel: active.model };
  })(),

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

  // Legacy single-value keys are kept written too — never the only copy, but harmless, and it
  // means a downgrade (or anything else still reading them directly) keeps working.
  setApiKey: (key) => {
    writeLocalStorage("vensim-ai:apiKey", key);
    set((s) => ({ apiKey: key, connections: updateActive(s, { apiKey: key }) }));
  },
  setBaseUrl: (url) => {
    writeLocalStorage("vensim-ai:baseUrl", url);
    set((s) => ({ baseUrl: url, connections: updateActive(s, { baseUrl: url }) }));
  },
  setAiModel: (name) => {
    writeLocalStorage("vensim-ai:model", name);
    set((s) => ({ aiModel: name, connections: updateActive(s, { model: name }) }));
  },

  addConnectionProfile: (profile) => {
    const created: ConnectionProfile = { ...profile, id: crypto.randomUUID() };
    set((s) => {
      const connections = [...s.connections, created];
      saveConnections(connections);
      writeLocalStorage(ACTIVE_CONNECTION_KEY, created.id);
      return { connections, activeConnectionId: created.id, apiKey: created.apiKey, baseUrl: created.baseUrl, aiModel: created.model };
    });
  },

  selectConnectionProfile: (id) => {
    set((s) => {
      const profile = s.connections.find((c) => c.id === id);
      if (!profile) return s;
      writeLocalStorage(ACTIVE_CONNECTION_KEY, id);
      return { activeConnectionId: id, apiKey: profile.apiKey, baseUrl: profile.baseUrl, aiModel: profile.model };
    });
  },

  deleteConnectionProfile: (id) => {
    set((s) => {
      if (s.connections.length <= 1) return s; // always keep at least one profile to select
      const connections = s.connections.filter((c) => c.id !== id);
      saveConnections(connections);
      if (s.activeConnectionId !== id) return { connections };
      const next = connections[0]!;
      writeLocalStorage(ACTIVE_CONNECTION_KEY, next.id);
      return { connections, activeConnectionId: next.id, apiKey: next.apiKey, baseUrl: next.baseUrl, aiModel: next.model };
    });
  },

  renameConnectionProfile: (id, name) => {
    set((s) => {
      const connections = s.connections.map((c) => (c.id === id ? { ...c, name } : c));
      saveConnections(connections);
      return { connections };
    });
  },

  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),

  appendToChatMessage: (id, delta) =>
    set((s) => {
      const idx = s.chatMessages.findIndex((m) => m.id === id);
      if (idx === -1) {
        return { chatMessages: [...s.chatMessages, { id, role: "assistant", text: delta, streaming: true }] };
      }
      const chatMessages = [...s.chatMessages];
      chatMessages[idx] = { ...chatMessages[idx]!, text: chatMessages[idx]!.text + delta };
      return { chatMessages };
    }),

  finalizeChatMessage: (id) =>
    set((s) => ({ chatMessages: s.chatMessages.map((m) => (m.id === id ? { ...m, streaming: false } : m)) })),
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
