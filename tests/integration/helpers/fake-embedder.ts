import { EmbeddingError, type Embedder } from "@/lib/ai/embed";

const asEmbeddingError = (error: Error) => (error instanceof EmbeddingError ? error : new EmbeddingError({ cause: error }));

/** Deterministic vector for a text: same text, same vector; different texts differ. */
export function vectorFor(text: string, dims: number): number[] {
  let seed = 0;
  for (const ch of text) seed = (seed * 31 + (ch.codePointAt(0) ?? 0)) % 1_000_003;
  return Array.from({ length: dims }, (_, i) => ((seed + i * 7919) % 1000) / 1000);
}

/**
 * An Embedder that never calls a network service. `calls` records the texts of
 * each embedDocuments call and `queries` each embedQuery text; set `failWith`
 * to make the next calls fail (an EmbeddingError, such as a rate limit, is
 * thrown as is; anything else is wrapped in EmbeddingError).
 */
export function fakeEmbedder(dims = 4) {
  const state = { calls: [] as string[][], queries: [] as string[], failWith: null as Error | null };
  const embedder: Embedder = {
    model: "fake-embedding-model",
    dimensions: dims,
    async embedDocuments(texts) {
      if (state.failWith) throw asEmbeddingError(state.failWith);
      state.calls.push(texts);
      return texts.map((text) => vectorFor(text, dims));
    },
    async embedQuery(text) {
      if (state.failWith) throw asEmbeddingError(state.failWith);
      state.queries.push(text);
      return vectorFor(text, dims);
    },
  };
  return { embedder, state, embeddedTexts: () => state.calls.flat() };
}
