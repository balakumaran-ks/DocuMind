import { extractText, getDocumentProxy } from "unpdf";

export type ExtractedPage = {
  pageNumber: number;
  text: string;
  charCount: number;
  /** No text at all; most often a scanned page. */
  isEmpty: boolean;
};

/** The bytes could not be parsed as a PDF (corrupt, truncated, encrypted or not a PDF). */
export class PdfReadError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Could not read this PDF. It may be damaged or password-protected.", options);
    this.name = "PdfReadError";
  }
}

async function openPdf(bytes: Uint8Array) {
  try {
    // pdf.js takes ownership of (and may detach) the buffer it is given, so
    // hand it a copy and leave the caller's bytes usable.
    return await getDocumentProxy(bytes.slice(), { verbosity: 0 });
  } catch (cause) {
    throw new PdfReadError({ cause });
  }
}

/** Page count only; cheap enough to enforce the page cap before extracting text. */
export async function countPages(bytes: Uint8Array): Promise<number> {
  const pdf = await openPdf(bytes);
  try {
    return pdf.numPages;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export async function extractPages(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const pdf = await openPdf(bytes);
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((raw, i) => {
      const normalized = normalizeText(raw);
      return {
        pageNumber: i + 1,
        text: normalized,
        charCount: normalized.length,
        isEmpty: normalized.length === 0,
      };
    });
  } catch (cause) {
    throw cause instanceof PdfReadError ? cause : new PdfReadError({ cause });
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Canonical whitespace so chunk boundaries, hashes and character counts are
 * stable: LF line endings, single spaces, trimmed lines, at most one blank line.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
