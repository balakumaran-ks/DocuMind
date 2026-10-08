import type { ObjectId } from "mongodb";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

/** A page the answer cites, linked to the retrieved chunk the citation panel opens. */
export type Citation = { pageNumber: number; chunkId: ObjectId };

/** Anything shaped like a citation; the inside is validated separately. */
const MARKER = /\[(pp?)\.([^\]]*)\]/gi;
/** A comma-separated list of positive page numbers, nothing else. */
const PAGE_LIST = /^\s*[1-9]\d*(\s*,\s*[1-9]\d*)*\s*$/;

/**
 * The pages cited with `[p. N]` or `[p. N, M]` markers, in order of first
 * citation, without duplicates. A malformed marker is ignored whole, and a page
 * that was not retrieved is dropped, so the model cannot cite a page it never saw.
 */
export function parseCitations(answer: string, chunks: RetrievedChunk[]): Citation[] {
  const bestChunkByPage = new Map<number, RetrievedChunk>();
  for (const chunk of chunks) {
    const best = bestChunkByPage.get(chunk.pageNumber);
    if (!best || chunk.score > best.score) bestChunkByPage.set(chunk.pageNumber, chunk);
  }

  const citations: Citation[] = [];
  const seen = new Set<number>();
  for (const [, , inside = ""] of answer.matchAll(MARKER)) {
    if (!PAGE_LIST.test(inside)) continue;
    for (const page of inside.split(",").map((n) => Number(n.trim()))) {
      const chunk = bestChunkByPage.get(page);
      if (!chunk || seen.has(page)) continue;
      seen.add(page);
      citations.push({ pageNumber: page, chunkId: chunk._id });
    }
  }
  return citations;
}
