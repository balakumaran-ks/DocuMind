import type { ObjectId } from "mongodb";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

/**
 * A page the answer cites, linked to the retrieved chunk the citation panel
 * opens. In a chat across documents it also names the document.
 */
export type Citation = { pageNumber: number; chunkId: ObjectId; documentId?: ObjectId };

/**
 * A well-formed marker in an answer, with its position: `[p. N]` / `[p. N, M]`,
 * or with a document letter in a chat across documents, `[A p. N]`.
 */
export type CitationMarker = { start: number; end: number; pages: number[]; label?: string };

/** The letter for the document at `index` in a chat across documents: A, B, C… */
export function documentLabel(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

/**
 * Anything shaped like a citation, with an optional one-letter document label
 * followed by a space or a comma; the inside is validated separately.
 */
const MARKER = /\[(?:([a-z])(?:\s*,\s*|\s+))?(pp?)\.([^\]]*)\]/gi;
/** A comma-separated list of positive page numbers, nothing else. */
const PAGE_LIST = /^\s*[1-9]\d*(\s*,\s*[1-9]\d*)*\s*$/;

/** The well-formed citation markers in a text, in order. Malformed ones are skipped whole. */
export function findCitationMarkers(text: string): CitationMarker[] {
  const markers: CitationMarker[] = [];
  for (const match of text.matchAll(MARKER)) {
    const inside = match[3] ?? "";
    if (!PAGE_LIST.test(inside)) continue;
    const label = match[1]?.toUpperCase();
    markers.push({
      start: match.index,
      end: match.index + match[0].length,
      pages: inside.split(",").map((n) => Number(n.trim())),
      ...(label ? { label } : {}),
    });
  }
  return markers;
}

/**
 * The pages cited, in order of first citation, without duplicates. A malformed
 * marker is ignored whole, and a page that was not retrieved is dropped, so the
 * model cannot cite a page it never saw.
 *
 * With two or more `documents` (a chat across documents), only lettered markers
 * count: `[B p. 3]` must match a retrieved chunk of page 3 of the second
 * document, and the citation records that document. With one document, only
 * unlettered markers count.
 */
export function parseCitations(answer: string, chunks: RetrievedChunk[], documents: ObjectId[] = []): Citation[] {
  const across = documents.length > 1;
  const keyOf = (documentId: ObjectId, page: number) => (across ? `${documentId.toHexString()}:${page}` : String(page));

  const bestChunk = new Map<string, RetrievedChunk>();
  for (const chunk of chunks) {
    const key = keyOf(chunk.documentId, chunk.pageNumber);
    const best = bestChunk.get(key);
    if (!best || chunk.score > best.score) bestChunk.set(key, chunk);
  }

  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const marker of findCitationMarkers(answer)) {
    if (across !== (marker.label !== undefined)) continue;
    const documentId = marker.label ? documents[marker.label.charCodeAt(0) - "A".charCodeAt(0)] : undefined;
    if (across && !documentId) continue;
    for (const page of marker.pages) {
      const chunk = documentId ? bestChunk.get(keyOf(documentId, page)) : bestChunk.get(String(page));
      if (!chunk) continue;
      const key = keyOf(chunk.documentId, page);
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push(documentId ? { documentId, pageNumber: page, chunkId: chunk._id } : { pageNumber: page, chunkId: chunk._id });
    }
  }
  return citations;
}
