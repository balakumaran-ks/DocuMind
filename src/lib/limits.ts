/**
 * Product limits for the MVP. Every server-side check reads from here so the
 * numbers in the PRD, the UI copy and the enforcement never drift apart.
 */
export const LIMITS = {
  /** Largest PDF accepted by the upload route; under Vercel's 4.5 MB body limit (ADR-0006). */
  maxUploadBytes: 4 * 1024 * 1024,
  /** Pages beyond this are rejected so ingestion fits in one function call. */
  maxPagesPerDocument: 50,
  /** Documents a single user may keep at once. */
  maxDocumentsPerUser: 5,
  /** Questions a single user may ask per UTC day. */
  maxQuestionsPerDay: 50,
  /** Chunks retrieved per question and passed to the model. */
  retrievalTopK: 5,
  /** Maximum chunk length in characters, ~300 tokens (ADR-0004; tuned with evals in week 4). */
  chunkSize: 1200,
  /** Characters shared by consecutive chunks of a page (ADR-0004). */
  chunkOverlap: 200,
  /** Embedding requests allowed in flight at once, to stay inside free-tier rate limits. */
  embedMaxParallelCalls: 2,
  /** Nearest neighbours the vector search considers before keeping the top `retrievalTopK`. */
  vectorNumCandidates: 100,
  /** Earlier chat messages (questions and answers) sent with each new question. */
  historyMessages: 6,
  /** Longest question accepted by the ask route. */
  maxQuestionChars: 1000,
} as const;

export const ACCEPTED_MIME_TYPES = ["application/pdf"] as const;

/** The first bytes of every PDF file ("%PDF-"). Checked on the server. */
export const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
