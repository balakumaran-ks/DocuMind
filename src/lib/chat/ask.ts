import { errorMessageFrom } from "@/lib/api/client";

/** How asking a question ended. */
export type AskOutcome =
  /** The whole answer streamed; it is saved under `chatId`. */
  | { kind: "answered"; chatId: string }
  /** Nothing was answered (rejected by the server or never sent); `message` explains why. */
  | { kind: "rejected"; message: string }
  /** The answer started but the stream broke; what arrived has been passed to `onText`. */
  | { kind: "interrupted"; chatId: string | null };

export const OFFLINE = "Your question didn't reach the server. Check your connection and try again.";

/**
 * POST /api/ask and read the plain-text stream, passing each piece of the
 * answer to `onText` as it arrives. The chat id comes back in `X-Chat-Id`.
 */
export async function askQuestion(input: {
  documentId: string;
  chatId: string | null;
  question: string;
  onText: (text: string) => void;
}): Promise<AskOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentId: input.documentId,
        ...(input.chatId ? { chatId: input.chatId } : {}),
        question: input.question,
      }),
    });
  } catch {
    return { kind: "rejected", message: OFFLINE };
  }
  if (!response.ok || !response.body) return { kind: "rejected", message: await errorMessageFrom(response) };

  const chatId = response.headers.get("x-chat-id");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) input.onText(value);
    }
  } catch {
    return { kind: "interrupted", chatId };
  }
  return chatId ? { kind: "answered", chatId } : { kind: "interrupted", chatId: null };
}
