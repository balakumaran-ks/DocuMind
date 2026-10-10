import type { DocumentStatus, StoredDocument } from "@/lib/db/documents";

/** What the browser sees of a document: ids and dates as strings, no internal fields. */
export type DocumentSummary = {
  id: string;
  filename: string;
  pageCount: number;
  sizeBytes: number;
  status: DocumentStatus;
  chunkCount: number | null;
  /** Chunks with a vector so far; equals chunkCount once ready. */
  embeddedChunks: number | null;
  createdAt: string;
};

export function toDocumentSummary(document: StoredDocument): DocumentSummary {
  return {
    id: document._id.toHexString(),
    filename: document.filename,
    pageCount: document.pageCount,
    sizeBytes: document.sizeBytes,
    status: document.status,
    chunkCount: document.chunkCount ?? null,
    embeddedChunks: document.embeddedChunks ?? null,
    createdAt: document.createdAt.toISOString(),
  };
}
