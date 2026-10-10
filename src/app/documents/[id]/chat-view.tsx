"use client";

import { useRef, useState } from "react";
import { askQuestion } from "@/lib/chat/ask";
import { LIMITS } from "@/lib/limits";
import { Answer } from "./answer";
import { PagePanel } from "./page-panel";

/** A message as the API returns it (`GET /api/chats/:id/messages`). */
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: { pageNumber: number; chunkId: string }[];
};
/** `pending`: streaming, or not yet replaced by the saved, validated version. */
type ShownMessage = ChatMessage & { pending?: boolean };

type Props = {
  document: { id: string; filename: string; pageCount: number };
  initialChatId: string | null;
  initialMessages: ChatMessage[];
};

const INTERRUPTED = "The answer was interrupted. Please ask again.";

/** Questions and cited answers about one document, with the cited page in a side panel. */
export function ChatView({ document, initialChatId, initialMessages }: Props) {
  const [messages, setMessages] = useState<ShownMessage[]>(initialMessages);
  const [chatId, setChatId] = useState(initialChatId);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPage, setOpenPage] = useState<number | null>(null);
  const nextLocalId = useRef(0);

  const tooLong = question.length > LIMITS.maxQuestionChars;
  const canAsk = !asking && question.trim() !== "" && !tooLong;

  async function ask() {
    if (!canAsk) return;
    const text = question.trim();
    const userId = `local-${nextLocalId.current++}`;
    const answerId = `local-${nextLocalId.current++}`;
    setError(null);
    setQuestion("");
    setAsking(true);
    setMessages((current) => [
      ...current,
      { id: userId, role: "user", content: text, citations: [] },
      { id: answerId, role: "assistant", content: "", citations: [], pending: true },
    ]);

    const outcome = await askQuestion({
      documentId: document.id,
      chatId,
      question: text,
      onText: (piece) =>
        setMessages((current) => current.map((m) => (m.id === answerId ? { ...m, content: m.content + piece } : m))),
    });

    if (outcome.kind === "rejected") {
      setMessages((current) => current.filter((m) => m.id !== userId && m.id !== answerId));
      setQuestion(text);
      setError(outcome.message);
    } else {
      if (outcome.chatId) setChatId(outcome.chatId);
      if (outcome.kind === "interrupted") setError(INTERRUPTED);
      // Swap in the saved messages, whose citations were validated on the server.
      if (outcome.kind === "answered") await loadSaved(outcome.chatId);
    }
    setAsking(false);
  }

  async function loadSaved(id: string) {
    try {
      const response = await fetch(`/api/chats/${id}/messages`);
      if (response.ok) setMessages(((await response.json()) as { messages: ChatMessage[] }).messages);
    } catch {
      // Keep the streamed answer as plain text.
    }
  }

  function newChat() {
    setMessages([]);
    setChatId(null);
    setError(null);
    setOpenPage(null);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {messages.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
          <p className="font-medium">Ask anything about {document.filename}</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Answers come only from this document and cite their pages. Click a citation to read the page.
          </p>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <button type="button" onClick={newChat} className="text-sm text-zinc-600 hover:text-indigo-600 dark:text-zinc-400">
              New chat
            </button>
          </div>
          <ol className="flex flex-col gap-5">
            {messages.map((message) => (
              <li key={message.id} className={message.role === "user" ? "self-end max-w-[85%]" : "max-w-[85%]"}>
                {message.role === "user" ? (
                  <p className="whitespace-pre-wrap rounded-2xl bg-indigo-600 px-4 py-2.5 text-white">{message.content}</p>
                ) : message.content === "" ? (
                  <p className="animate-pulse text-sm text-zinc-500">Searching the document…</p>
                ) : (
                  <Answer
                    content={message.content}
                    citations={message.citations}
                    streaming={message.pending === true}
                    onOpenPage={setOpenPage}
                  />
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <form
        className="sticky bottom-4 mt-auto flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <textarea
          aria-label="Your question"
          rows={2}
          value={question}
          placeholder={`Ask a question about ${document.filename}`}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void ask();
            }
          }}
          className="resize-none bg-transparent px-1 outline-none"
        />
        <div className="flex items-center justify-between gap-3">
          <span className={`text-xs ${tooLong ? "text-red-600" : "text-zinc-500"}`}>
            {question.length > LIMITS.maxQuestionChars * 0.9
              ? `${question.length} / ${LIMITS.maxQuestionChars}`
              : "Enter to send, Shift+Enter for a new line"}
          </span>
          <button
            type="submit"
            disabled={!canAsk}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask
          </button>
        </div>
      </form>

      {openPage !== null && (
        <div className="fixed inset-y-0 right-0 z-10 w-full max-w-md border-l shadow-xl">
          <PagePanel
            documentId={document.id}
            pageNumber={openPage}
            onClose={() => setOpenPage(null)}
            onNavigate={setOpenPage}
          />
        </div>
      )}
    </div>
  );
}
