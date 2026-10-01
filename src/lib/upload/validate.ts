import { formatBytes, LIMITS, PDF_MAGIC_BYTES } from "@/lib/limits";

export type UploadCheck = {
  /** File size in bytes, measured on the server. */
  size: number;
  /** The first bytes of the file; at least PDF_MAGIC_BYTES.length when available. */
  head: Uint8Array;
  /** Documents the user already has. */
  documentCount: number;
};

export type UploadRejection = {
  ok: false;
  status: 409 | 413 | 415;
  code: "too_large" | "not_pdf" | "too_many_documents";
  message: string;
};

export type UploadResult = { ok: true } | UploadRejection;

/**
 * Server-side checks that need no parsing, cheapest first: size, then type by
 * magic bytes (never the browser's MIME type or file name), then the per-user cap.
 */
export function validateUpload({ size, head, documentCount }: UploadCheck): UploadResult {
  if (size > LIMITS.maxUploadBytes) {
    return {
      ok: false,
      status: 413,
      code: "too_large",
      message: `PDF is larger than ${formatBytes(LIMITS.maxUploadBytes)}.`,
    };
  }

  if (!startsWithPdfSignature(head)) {
    return { ok: false, status: 415, code: "not_pdf", message: "File is not a PDF." };
  }

  if (documentCount >= LIMITS.maxDocumentsPerUser) {
    return {
      ok: false,
      status: 409,
      code: "too_many_documents",
      message: `You can keep up to ${LIMITS.maxDocumentsPerUser} documents. Delete one to upload another.`,
    };
  }

  return { ok: true };
}

function startsWithPdfSignature(head: Uint8Array): boolean {
  return head.length >= PDF_MAGIC_BYTES.length && PDF_MAGIC_BYTES.every((byte, i) => head[i] === byte);
}
