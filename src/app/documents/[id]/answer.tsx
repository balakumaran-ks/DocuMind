"use client";

import type { ReactNode } from "react";
import { findCitationMarkers } from "@/lib/rag/citations";
import { REFUSAL } from "@/lib/rag/prompt";

type Props = {
  content: string;
  /** Pages that passed validation on the server; only these become buttons. */
  citations: { pageNumber: number }[];
  /** While streaming, markers may be incomplete and citations aren't validated yet. */
  streaming: boolean;
  onOpenPage: (pageNumber: number) => void;
};

/** An assistant answer, with validated `[p. N]` markers rendered as page buttons. */
export function Answer({ content, citations, streaming, onOpenPage }: Props) {
  if (content.trim() === REFUSAL) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Not in this document</p>
        <p className="mt-1 text-sm">{content.trim()}</p>
      </div>
    );
  }
  if (streaming) return <p className="whitespace-pre-wrap leading-7">{content}</p>;

  const valid = new Set(citations.map((citation) => citation.pageNumber));
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const marker of findCitationMarkers(content)) {
    parts.push(content.slice(cursor, marker.start));
    marker.pages.forEach((page, i) => {
      if (i > 0) parts.push(" ");
      parts.push(
        valid.has(page) ? (
          <button
            key={`${marker.start}-${page}`}
            type="button"
            aria-label={`Open page ${page}`}
            onClick={() => onOpenPage(page)}
            className="mx-0.5 rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
          >
            p. {page}
          </button>
        ) : (
          <span
            key={`${marker.start}-${page}`}
            title="Not among the retrieved pages, so it can't be checked"
            className="mx-0.5 text-xs text-zinc-400 line-through"
          >
            p. {page}
          </span>
        ),
      );
    });
    cursor = marker.end;
  }
  parts.push(content.slice(cursor));

  return <p className="whitespace-pre-wrap leading-7">{parts}</p>;
}
