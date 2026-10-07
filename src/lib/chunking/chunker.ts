import { createHash } from "node:crypto";
import { LIMITS } from "@/lib/limits";
import { normalizeText } from "@/lib/pdf/extract";

/**
 * Page-bounded chunking (ADR-0004).
 *
 * Each page is split on its own, so every chunk belongs to exactly one page and
 * every citation is an exact page. Within a page, a chunk ends at the latest
 * paragraph break that fits, otherwise the latest sentence end, otherwise the
 * latest word boundary, and only splits a word that is longer than the chunk
 * size. The next chunk starts up to `overlap` characters earlier, at a word
 * start, so a fact that straddles a boundary appears whole in one chunk.
 */

export type PageInput = { pageNumber: number; text: string };

/** A slice of one page: `text === pageText.slice(start, end)`. */
export type PageChunk = { pageNumber: number; start: number; end: number; text: string };

/** A chunk with its position in the whole document. */
export type Chunk = PageChunk & { chunkIndex: number };

export type ChunkOptions = {
  /** Maximum chunk length in characters (UTF-16 code units). */
  size?: number;
  /** Maximum number of characters shared by consecutive chunks. */
  overlap?: number;
};

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);
const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

export function chunkPage(page: PageInput, options: ChunkOptions = {}): PageChunk[] {
  const size = options.size ?? LIMITS.chunkSize;
  const overlap = options.overlap ?? LIMITS.chunkOverlap;
  if (size <= 0) throw new RangeError(`Chunk size must be positive, got ${size}`);
  if (overlap < 0 || overlap >= size) {
    throw new RangeError(`Chunk overlap must be at least 0 and less than size (${size}), got ${overlap}`);
  }

  const text = page.text;
  const first = text.search(/\S/);
  if (first < 0) return [];
  const last = text.trimEnd().length;

  const chunks: PageChunk[] = [];
  let start = first;
  let previousEnd = first;
  for (;;) {
    let end = chooseEnd(text, start, size, last, previousEnd);
    while (isSpace(text[end - 1])) end--;
    chunks.push({ pageNumber: page.pageNumber, start, end, text: text.slice(start, end) });
    if (end >= last) return chunks;

    start = chooseNextStart(text, start, end, overlap);
    previousEnd = end;
  }
}

/** Chunks every page in order and numbers the chunks across the document. Empty pages produce none. */
export function chunkDocument(pages: PageInput[], options: ChunkOptions = {}): Chunk[] {
  return pages
    .flatMap((page) => chunkPage(page, options))
    .map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }));
}

/**
 * Identity of a chunk's embedding: SHA-256 of the normalised text and the model
 * name. Whitespace differences don't change it; a different model does, so
 * vectors from two models are never mixed. JSON encoding keeps the two parts
 * unambiguous ("ab" + "c" never equals "a" + "bc").
 */
export function contentHash(text: string, model: string): string {
  return createHash("sha256").update(JSON.stringify([model, normalizeText(text)])).digest("hex");
}

/**
 * Where a chunk starting at `start` should end. The end must be past
 * `minEnd` (the previous chunk's end) so chunks always make progress.
 */
function chooseEnd(text: string, start: number, size: number, last: number, minEnd: number): number {
  const limit = start + size;
  if (limit >= last) return last;

  // 1. The latest paragraph break that fits.
  const paragraph = text.lastIndexOf("\n\n", limit);
  if (paragraph > minEnd) return paragraph;

  // 2. The latest sentence end that fits.
  for (let end = limit; end > minEnd; end--) {
    if (/[.!?]/.test(text[end - 1]) && isSpace(text[end])) return end;
  }

  // 3. The latest word boundary that fits.
  for (let end = limit; end > minEnd; end--) {
    if (!isSpace(text[end - 1]) && isSpace(text[end])) return end;
  }

  // 4. A word longer than the chunk: cut at the limit, but never inside a surrogate pair.
  return isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit;
}

/** Where the chunk after [start, end) begins: up to `overlap` characters back, at a word start. */
function chooseNextStart(text: string, start: number, end: number, overlap: number): number {
  const earliest = Math.max(end - overlap, start + 1);

  // The first word that starts inside the overlap window.
  for (let i = earliest; i < end; i++) {
    if (!isSpace(text[i]) && isSpace(text[i - 1])) return i;
  }

  // No word starts in the window. After a hard split inside a long word, keep a
  // raw overlap; otherwise start at the next word with no overlap.
  const insideWord = !isSpace(text[end - 1]) && !isSpace(text[end]);
  let next = insideWord && overlap > 0 ? earliest : end;
  if (isLowSurrogate(text.charCodeAt(next))) next += 1;
  while (isSpace(text[next])) next++;
  return next;
}
