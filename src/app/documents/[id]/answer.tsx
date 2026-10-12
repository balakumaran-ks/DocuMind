"use client";

import type { ReactNode } from "react";
import { findCitationMarkers } from "@/lib/rag/citations";
import { isRefusal, REFUSAL_ACROSS } from "@/lib/rag/prompt";

type Props = {
  content: string;
  /** Pages that passed validation on the server (with their document, across documents); only these become buttons. */
  citations: { pageNumber: number; documentId?: string }[];
  /** While streaming, markers may be incomplete and citations aren't validated yet. */
  streaming: boolean;
  /** Called with the page, and across documents with the cited document's id. */
  onOpenPage: (pageNumber: number, documentId?: string) => void;
  /** Set for a chat across documents: lettered markers name these, in order (A, B, C…). */
  documents?: { id: string; filename: string }[];
};

/**
 * An assistant answer, with validated `[p. N]` markers rendered as page buttons.
 * Across documents, `[A p. N]` markers become buttons naming the document.
 */
export function Answer({ content, citations, streaming, onOpenPage, documents }: Props) {
  const across = documents && documents.length > 1 ? documents : null;

  if (isRefusal(content)) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          {content.trim() === REFUSAL_ACROSS ? "Not in these documents" : "Not in this document"}
        </p>
        <p className="mt-1 text-sm">{content.trim()}</p>
      </div>
    );
  }
  if (streaming) return <p className="whitespace-pre-wrap leading-7">{content}</p>;

  const valid = new Set(citations.map((citation) => `${across ? citation.documentId : ""}:${citation.pageNumber}`));
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const marker of findCitationMarkers(content)) {
    // A single-document answer leaves lettered markers as written.
    if (!across && marker.label) continue;
    const document = across && marker.label ? across[marker.label.charCodeAt(0) - "A".charCodeAt(0)] : undefined;
    const prefix = marker.label ? `${marker.label} ` : "";
    parts.push(content.slice(cursor, marker.start));
    marker.pages.forEach((page, i) => {
      if (i > 0) parts.push(" ");
      const key = `${marker.start}-${page}`;
      const checked = across ? document !== undefined && valid.has(`${document.id}:${page}`) : valid.has(`:${page}`);
      parts.push(
        checked ? (
          <button
            key={key}
            type="button"
            aria-label={document ? `Open page ${page} of ${document.filename}` : `Open page ${page}`}
            title={document?.filename}
            onClick={() => (document ? onOpenPage(page, document.id) : onOpenPage(page))}
            className="mx-0.5 rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
          >
            {prefix}p. {page}
          </button>
        ) : (
          <span key={key} title="Not among the retrieved pages, so it can't be checked" className="mx-0.5 text-xs text-zinc-400 line-through">
            {prefix}p. {page}
          </span>
        ),
      );
    });
    cursor = marker.end;
  }
  parts.push(content.slice(cursor));

  return <p className="whitespace-pre-wrap leading-7">{parts}</p>;
}
