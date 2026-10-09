"use client";

import Link from "next/link";
import { useState } from "react";
import { errorMessageFrom } from "@/lib/api/client";
import type { DocumentSummary } from "@/lib/documents/summary";
import { formatBytes, LIMITS } from "@/lib/limits";
import { checkFileBeforeUpload } from "@/lib/upload/client-check";

const OFFLINE = "The upload didn't reach the server. Check your connection and try again.";

const STATUS: Record<DocumentSummary["status"], { label: string; className: string }> = {
  ready: { label: "Ready", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  processing: { label: "Processing", className: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  failed: { label: "Failed", className: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

/** The user's documents, with upload and delete. */
export function DocumentLibrary({ initialDocuments }: { initialDocuments: DocumentSummary[] }) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const atCap = documents.length >= LIMITS.maxDocumentsPerUser;

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
      if (response.ok || response.status === 502) await refresh();
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
