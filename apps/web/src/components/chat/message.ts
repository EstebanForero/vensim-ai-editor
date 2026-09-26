// What one line of a conversation with the agent is. Its own module because three things need the
// shape and none of them owns it: the store holds the editor's transcript, the editor's panel
// draws it, and the study tab keeps one of its own.

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "warning";
  text: string;
  /** True while an assistant message is still being streamed in — lets the UI show a "still
   * typing" indicator on this specific bubble, cleared once the message completes. */
  streaming?: boolean;
}

/** A fresh message with its own id — every call site otherwise repeats the same
 * `crypto.randomUUID()` incantation, and the id is the only field that must be unique. */
export function message(role: ChatMessage["role"], text: string): ChatMessage {
  return { id: crypto.randomUUID(), role, text };
}
