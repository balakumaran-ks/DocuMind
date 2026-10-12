import type { StoredMessage } from "@/lib/db/chats";

/** A user's verdict on one answer. */
export type Rating = "up" | "down";

/** A message as the browser sees it: `GET /api/chats/:id/messages` and the document page. */
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: { pageNumber: number; chunkId: string }[];
  /** `null` for questions and unrated answers; absent on messages the browser hasn't reloaded yet. */
  rating?: Rating | null;
};

/** The browser's view of a stored message. Usage, latency and retrieved chunks stay on the server. */
export function toChatMessage(message: StoredMessage): ChatMessage {
  return {
    id: message._id.toHexString(),
    role: message.role,
    content: message.content,
    citations: (message.citations ?? []).map((citation) => ({
      pageNumber: citation.pageNumber,
      chunkId: citation.chunkId.toHexString(),
    })),
    rating: message.feedback?.rating ?? null,
  };
}
