"use client";

import { useState } from "react";
import { ChatView } from "@/app/documents/[id]/chat-view";
import type { ChatMessage } from "@/lib/chat/message";
import { documentLabel } from "@/lib/rag/citations";

type DocumentRef = { id: string; filename: string; pageCount: number };

type Props = {
  /** The user's ready documents, in library order. */
  documents: DocumentRef[];
  /** The latest chat across documents, reopened with its own documents and letters. */
  initialChat: { id: string; documentIds: string[]; messages: ChatMessage[] } | null;
};

/**
 * Pick two or more documents and ask across them. The picked documents are
 * lettered A, B, C… in order; the letters appear in citations.
 */
export function AskAcross({ documents, initialChat }: Props) {
  const [selected, setSelected] = useState<string[]>(initialChat?.documentIds ?? documents.map((document) => document.id));
  const chosen = selected.flatMap((id) => documents.filter((document) => document.id === id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current.includes(id) ? current.filter((other) => other !== id) : [...current, id]);
      return documents.filter((document) => next.has(document.id)).map((document) => document.id);
    });
  }

  const picker = (
    <fieldset className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <legend className="px-1 text-sm font-medium">Documents to search</legend>
      <ul className="flex flex-col gap-2">
        {documents.map((document) => {
          const index = selected.indexOf(document.id);
          return (
            <li key={document.id}>
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={index !== -1}
                  onChange={() => toggle(document.id)}
                  className="h-4 w-4 accent-indigo-600"
                />
                <span className="w-4 font-semibold text-indigo-600 dark:text-indigo-400">
                  {index !== -1 && <span data-testid="document-letter">{documentLabel(index)}</span>}
                </span>
                <span>{document.filename}</span>
                <span className="text-zinc-500">{document.pageCount} pages</span>
              </label>
            </li>
          );
        })}
      </ul>
      {selected.length < 2 && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Pick at least two documents.</p>}
    </fieldset>
  );

  return (
    <ChatView
      documents={chosen}
      initialChatId={initialChat?.id ?? null}
      initialMessages={initialChat?.messages ?? []}
      picker={picker}
      disabled={chosen.length < 2}
    />
  );
}
