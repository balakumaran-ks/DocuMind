"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorMessageFrom, GENERIC_ERROR } from "@/lib/api/client";
import type { DocumentSummary } from "@/lib/documents/summary";
import { formatBytes, LIMITS } from "@/lib/limits";
import { checkFileBeforeUpload } from "@/lib/upload/client-check";

const OFFLINE = "The upload didn't reach the server. Check your connection and try again.";

const STATUS: Record<DocumentSummary["status"], { label: string; className: string }> = {
  ready: { label: "Ready", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  processing: { label: "Processing", className: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  failed: { label: "Failed", className: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

/** How long to wait before retrying while another tab indexes the same document. */
const BUSY_RETRY_MS = 5_000;
const INDEXING_OFFLINE = "Indexing paused: the server couldn't be reached. Check your connection, then resume.";

type ApiError = { code?: string; message: string; retryAfterSeconds?: number; chunkCount?: number; embeddedChunks?: number };
type Progress = Pick<DocumentSummary, "status" | "chunkCount" | "embeddedChunks">;

/** The `error` object of an API error body, with a generic message if the body isn't one. */
function apiErrorOf(body: unknown): ApiError {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : null;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error as ApiError;
  }
  return { message: GENERIC_ERROR };
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The progress line of a processing document: `waitSeconds` is undefined when
 * this tab isn't indexing it, null while a batch runs, or the quota wait left.
 */
function indexingText(document: DocumentSummary, waitSeconds: number | null | undefined): string {
  const counts =
    document.chunkCount !== null && document.embeddedChunks !== null ? ` ${document.embeddedChunks} of ${document.chunkCount} chunks` : "";
  if (waitSeconds === undefined) return counts ? `Paused at${counts}` : "Paused";
  if (waitSeconds !== null && waitSeconds > 0) return `Waiting for the free quota… ${waitSeconds} s`;
  return `Indexing…${counts}`;
}

type Props = {
  initialDocuments: DocumentSummary[];
  /** Waits between indexing requests; replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
};

/** The user's documents, with upload, delete, and indexing progress for large documents. */
export function DocumentLibrary({ initialDocuments, sleep = realSleep }: Props) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Documents this tab is indexing, with the seconds left to wait for the quota (null while a batch runs).
  const [indexing, setIndexing] = useState<Record<string, number | null>>({});

  const atCap = documents.length >= LIMITS.maxDocumentsPerUser;
  const waiting = Object.values(indexing).some((seconds) => seconds !== null && seconds > 0);

  // Count the quota wait down once a second while any document is waiting.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      setIndexing((current) =>
        Object.fromEntries(Object.entries(current).map(([id, seconds]) => [id, seconds === null ? null : Math.max(0, seconds - 1)])),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const update = (id: string, progress: Partial<Progress>) =>
    setDocuments((current) => current.map((document) => (document.id === id ? { ...document, ...progress } : document)));

  /**
   * Indexes a processing document batch by batch until it is ready, waiting
   * out the free quota when the server says so. `firstWaitMs` comes from an
   * upload that already hit the quota.
   */
  async function index(id: string, firstWaitMs = 0) {
    setError(null);
    const setWait = (ms: number | null) => setIndexing((current) => ({ ...current, [id]: ms === null ? null : Math.ceil(ms / 1000) }));
    try {
      for (let waitMs = firstWaitMs; ; ) {
        if (waitMs > 0) {
          setWait(waitMs);
          await sleep(waitMs);
        }
        setWait(null);
        const response = await fetch(`/api/documents/${id}/ingest`, { method: "POST" });
        const body: unknown = await response.json().catch(() => null);
        if (response.ok) {
          const progress = body as Progress;
          update(id, progress);
          if (progress.status === "ready") return;
          waitMs = 0;
          continue;
        }
        const failure = apiErrorOf(body);
        if (response.status === 429) {
          update(id, { chunkCount: failure.chunkCount ?? null, embeddedChunks: failure.embeddedChunks ?? null });
          waitMs = (failure.retryAfterSeconds ?? 60) * 1000;
        } else if (failure.code === "ingest_in_progress") {
          waitMs = BUSY_RETRY_MS;
        } else {
          setError(failure.message);
          await refresh();
          return;
        }
      }
    } catch {
      setError(INDEXING_OFFLINE);
    } finally {
      setIndexing(({ [id]: _done, ...rest }) => rest);
    }
  }

  async function refresh() {
    const response = await fetch("/api/documents");
    if (response.ok) setDocuments(((await response.json()) as { documents: DocumentSummary[] }).documents);
  }

  async function upload(file: File) {
    setError(null);
    const problem = checkFileBeforeUpload(file);
    if (problem) return setError(problem);

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/documents", { method: "POST", body: form });
      if (!response.ok) setError(await errorMessageFrom(response));
      // A 502 still stored the document (as failed), so refresh after it too.
      if (response.ok || response.status === 502) {
        const stored = response.status === 202 ? ((await response.json()) as { documentId: string; retryAfterSeconds?: number }) : null;
        await refresh();
        // Larger than one batch: keep indexing from this tab.
        if (stored) void index(stored.documentId, (stored.retryAfterSeconds ?? 0) * 1000);
      }
    } catch {
      setError(OFFLINE);
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    setConfirming(null);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (!response.ok) return setError(await errorMessageFrom(response));
      setDocuments((current) => current.filter((document) => document.id !== id));
    } catch {
      setError("The request didn't reach the server. Check your connection and try again.");
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          PDFs up to {formatBytes(LIMITS.maxUploadBytes)} and {LIMITS.maxPagesPerDocument} pages, up to{" "}
          {LIMITS.maxDocumentsPerUser} documents.
        </p>
        <label
          className={`rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-sm ${
            uploading || atCap ? "cursor-not-allowed bg-indigo-300 dark:bg-indigo-900" : "cursor-pointer bg-indigo-600 hover:bg-indigo-500"
          }`}
        >
          {uploading ? "Uploading and indexing…" : "Upload a PDF"}
          <input
            type="file"
            aria-label="Upload a PDF"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={uploading || atCap}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
      </div>

      {atCap && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You have {LIMITS.maxDocumentsPerUser} documents, the limit. Delete one to upload another.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {documents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <p className="font-medium">No documents yet</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Upload a PDF to start asking questions about it.</p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
              <div className="min-w-0 flex-1">
                {document.status === "ready" ? (
                  <Link href={`/documents/${document.id}`} className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400">
                    {document.filename}
                  </Link>
                ) : (
                  <span className="font-medium">{document.filename}</span>
                )}
                <p className="text-sm text-zinc-500">
                  {document.pageCount} pages · {formatBytes(document.sizeBytes)}
                </p>
                {document.status === "processing" && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-amber-700 dark:text-amber-300">
                    <span>{indexingText(document, indexing[document.id])}</span>
                    {!(document.id in indexing) && (
                      <button
                        type="button"
                        onClick={() => void index(document.id)}
                        className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                      >
                        Resume indexing
                      </button>
                    )}
                  </p>
                )}
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS[document.status].className}`}>
                {STATUS[document.status].label}
              </span>
              {confirming === document.id ? (
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void remove(document.id)}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(document.id)}
                  className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-zinc-900"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
