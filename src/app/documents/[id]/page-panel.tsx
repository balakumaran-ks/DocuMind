"use client";

import { useEffect, useState } from "react";
import { errorMessageFrom } from "@/lib/api/client";

type LoadedPage = { pageNumber: number; pageCount: number; text: string; isEmpty: boolean };
type State = { status: "loading" } | { status: "loaded"; page: LoadedPage } | { status: "error"; message: string };

type Props = {
  documentId: string;
  pageNumber: number;
  onClose: () => void;
  onNavigate: (pageNumber: number) => void;
};

/** The full text of one page, opened from a citation, with previous/next. */
export function PagePanel({ documentId, pageNumber, onClose, onNavigate }: Props) {
  const url = `/api/documents/${documentId}/pages/${pageNumber}`;
  // The last result and the page it belongs to; any other page is still loading.
  const [result, setResult] = useState<{ url: string; state: State } | null>(null);
  const state: State = result?.url === url ? result.state : { status: "loading" };

  useEffect(() => {
    let current = true;
    (async () => {
      let next: State;
      try {
        const response = await fetch(url);
        next = response.ok
          ? { status: "loaded", page: (await response.json()) as LoadedPage }
          : { status: "error", message: await errorMessageFrom(response) };
      } catch {
        next = { status: "error", message: "Couldn't load this page. Check your connection and try again." };
      }
      if (current) setResult({ url, state: next });
    })();
    return () => {
      current = false;
    };
  }, [url]);

  const pageCount = state.status === "loaded" ? state.page.pageCount : null;

  return (
    <aside className="flex h-full flex-col border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <h2 className="font-medium">{pageCount ? `Page ${pageNumber} of ${pageCount}` : `Page ${pageNumber}`}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={pageNumber <= 1}
            onClick={() => onNavigate(pageNumber - 1)}
            className="rounded-lg px-2 py-1 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-900"
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Next page"
            disabled={pageCount === null || pageNumber >= pageCount}
            onClick={() => onNavigate(pageNumber + 1)}
            className="rounded-lg px-2 py-1 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-900"
          >
            →
          </button>
          <button
            type="button"
            aria-label="Close page"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {state.status === "loading" && <p className="text-sm text-zinc-500">Loading page…</p>}
        {state.status === "error" && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {state.message}
          </p>
        )}
        {state.status === "loaded" &&
          (state.page.isEmpty ? (
            <p className="text-sm italic text-amber-700 dark:text-amber-300">No text on this page (it may be a scan).</p>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-7">{state.page.text}</p>
          ))}
      </div>
    </aside>
  );
}
