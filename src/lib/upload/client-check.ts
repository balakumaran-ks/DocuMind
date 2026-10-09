import { formatBytes, LIMITS } from "@/lib/limits";

/**
 * A quick check in the browser before uploading, so obvious mistakes don't
 * cost a round trip. The server checks again (magic bytes, size, pages).
 * Returns a message to show, or null if the file can be sent.
 */
export function checkFileBeforeUpload(file: { name: string; size: number; type: string }): string | null {
  const looksLikePdf = file.type === "application/pdf" || (file.type === "" && /\.pdf$/i.test(file.name));
  if (!looksLikePdf) return "Only PDF files are supported.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > LIMITS.maxUploadBytes) {
    return `This file is ${formatBytes(file.size)}; the limit is ${formatBytes(LIMITS.maxUploadBytes)}.`;
  }
  return null;
}
