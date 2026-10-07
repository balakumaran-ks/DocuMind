import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/limits";
import { chunkDocument, chunkPage, contentHash, type PageChunk } from "./chunker";

// ---------- deterministic test text ----------

const sentence = (i: number) => `Sentence ${i} explains how refunds, deliveries and warranties work for customers.`;

/** Sentences joined by spaces, starting at sentence `from`, until the paragraph reaches `minLength`. */
function paragraph(minLength: number, from = 0): string {
  let text = sentence(from);
  for (let i = from + 1; text.length < minLength; i++) text += ` ${sentence(i)}`;
  return text;
}

/** Plain words with no sentence punctuation, so only word boundaries are available. */
function words(minLength: number): string {
  const vocabulary = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
  let text = vocabulary[0];
  for (let i = 1; text.length < minLength; i++) text += ` ${vocabulary[i % vocabulary.length]}`;
  return text;
}

const page = (text: string, pageNumber = 1) => ({ pageNumber, text });

const isWordStart = (text: string, i: number) => i === 0 || /\s/.test(text[i - 1]);
const isWordEnd = (text: string, i: number) => i === text.length || /\s/.test(text[i]);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** The structural guarantees every chunking of every page must satisfy. */
function expectValidChunks(text: string, chunks: PageChunk[], size: number, overlap: number) {
  const first = text.search(/\S/);
  const last = text.trimEnd().length;
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks[0].start).toBe(first);
  expect(chunks.at(-1)?.end).toBe(last);

  chunks.forEach((chunk, i) => {
    expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text);
    expect(chunk.text).toBe(chunk.text.trim());
    expect(chunk.text.length).toBeGreaterThan(0);
    expect(chunk.end - chunk.start).toBeLessThanOrEqual(size);
    expect(chunk.text).not.toMatch(LONE_SURROGATE);

    const next = chunks[i + 1];
    if (!next) return;
    expect(next.start).toBeGreaterThan(chunk.start);
    expect(next.end).toBeGreaterThan(chunk.end);
    expect(chunk.end - next.start).toBeLessThanOrEqual(overlap);
    if (next.start > chunk.end) expect(text.slice(chunk.end, next.start).trim()).toBe("");
  });
}

// ---------- chunkPage ----------

describe("chunkPage — basics", () => {
  it.each(["", "   ", "\n\n  \n"])("returns no chunks for an empty page (%j)", (text) => {
    expect(chunkPage(page(text), { size: 100, overlap: 10 })).toEqual([]);
  });

  it("returns one chunk, without surrounding whitespace, for a page that fits", () => {
    const text = "  Refunds are accepted within 30 days.\n";
    expect(chunkPage(page(text, 7), { size: 100, overlap: 10 })).toEqual([
      { pageNumber: 7, start: 2, end: 38, text: "Refunds are accepted within 30 days." },
    ]);
  });

  it("keeps a page of exactly `size` characters in one chunk", () => {
    const text = words(300).slice(0, 120).trimEnd();
    const size = text.length;
    expect(chunkPage(page(text), { size, overlap: 20 })).toHaveLength(1);
  });

  it("uses LIMITS.chunkSize and LIMITS.chunkOverlap by default", () => {
    const text = paragraph(5000);
    expect(chunkPage(page(text))).toEqual(
      chunkPage(page(text), { size: LIMITS.chunkSize, overlap: LIMITS.chunkOverlap }),
    );
  });

  it("is deterministic", () => {
    const text = `${paragraph(1500)}\n\n${paragraph(900, 40)}`;
    expect(chunkPage(page(text), { size: 400, overlap: 80 })).toEqual(chunkPage(page(text), { size: 400, overlap: 80 }));
  });
});

describe("chunkPage — guarantees on longer text", () => {
  it.each([
    [1200, 200],
    [800, 150],
    [400, 80],
    [300, 0],
  ])("holds every structural guarantee with size %i and overlap %i", (size, overlap) => {
    const text = [paragraph(700), paragraph(1300, 20), paragraph(250, 60), paragraph(2100, 70)].join("\n\n");
    expectValidChunks(text, chunkPage(page(text), { size, overlap }), size, overlap);
  });

  it("overlaps consecutive chunks in normal prose", () => {
    const text = paragraph(6000);
    const chunks = chunkPage(page(text), { size: 1200, overlap: 200 });
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].start).toBeLessThan(chunks[i - 1].end);
  });

  it("does not overlap at all when overlap is 0", () => {
    const text = paragraph(3000);
    const chunks = chunkPage(page(text), { size: 500, overlap: 0 });
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].start).toBeGreaterThanOrEqual(chunks[i - 1].end);
  });

  it("starts and ends every chunk on a word boundary when words are short", () => {
    const text = [paragraph(1800), words(2500)].join("\n\n");
    const chunks = chunkPage(page(text), { size: 500, overlap: 100 });
    for (const chunk of chunks) {
      expect(isWordStart(text, chunk.start)).toBe(true);
      expect(isWordEnd(text, chunk.end)).toBe(true);
    }
  });
});

describe("chunkPage — where chunks break", () => {
  it("prefers the latest paragraph break that fits", () => {
    const a = paragraph(480);
    const b = paragraph(480, 20);
    const c = paragraph(480, 40);
    // Preconditions: A + B fit in one chunk, A + B + C do not.
    expect(a.length + 2 + b.length).toBeLessThanOrEqual(1200);
    expect(a.length + 2 + b.length + 2 + c.length).toBeGreaterThan(1200);

    const chunks = chunkPage(page([a, b, c].join("\n\n")), { size: 1200, overlap: 200 });
    expect(chunks[0].text).toBe(`${a}\n\n${b}`);
    expect(chunks.at(-1)?.text.endsWith(c)).toBe(true);
  });

  it("falls back to the latest sentence end inside a long paragraph", () => {
    const text = paragraph(3500);
    const chunks = chunkPage(page(text), { size: 1000, overlap: 150 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.text).toMatch(/[.!?]$/);
  });

  it("falls back to word boundaries when there are no sentence ends", () => {
    const text = words(3000);
    const chunks = chunkPage(page(text), { size: 700, overlap: 100 });
    expectValidChunks(text, chunks, 700, 100);
    for (const chunk of chunks) expect(isWordEnd(text, chunk.end)).toBe(true);
  });

  it("splits inside a word only when one word is longer than size", () => {
    const text = "x".repeat(3000);
    const chunks = chunkPage(page(text), { size: 1200, overlap: 200 });
    expect(chunks[0]).toMatchObject({ start: 0, end: 1200 });
    expectValidChunks(text, chunks, 1200, 200);
  });
});

describe("chunkPage — Unicode", () => {
  it("never cuts an emoji in half on a hard split", () => {
    const text = "😀".repeat(1000); // 2,000 UTF-16 code units, no whitespace
    const chunks = chunkPage(page(text), { size: 1201, overlap: 101 });
    expectValidChunks(text, chunks, 1201, 101);
    for (const chunk of chunks) expect(chunk.start % 2).toBe(0);
  });

  it("chunks Tamil text with the same guarantees", () => {
    const tamil = "திரும்பப் பெறுதல் விநியோகத்திலிருந்து முப்பது நாட்களுக்குள் ஏற்றுக்கொள்ளப்படும்.";
    const text = Array.from({ length: 40 }, () => tamil).join(" ");
    expectValidChunks(text, chunkPage(page(text), { size: 300, overlap: 50 }), 300, 50);
  });
});

describe("chunkPage — invalid options", () => {
  it.each([
    [{ size: 0, overlap: 0 }],
    [{ size: -10, overlap: 0 }],
    [{ size: 100, overlap: -1 }],
    [{ size: 100, overlap: 100 }],
    [{ size: 100, overlap: 150 }],
  ])("throws RangeError for %j", (options) => {
    expect(() => chunkPage(page("Some text."), options)).toThrow(RangeError);
  });
});

// ---------- chunkDocument ----------

describe("chunkDocument", () => {
  const pages = [page(paragraph(2600), 1), page("", 2), page(paragraph(900, 50), 3), page(paragraph(300, 80), 4)];

  it("numbers chunks 0…n-1 across pages, in page order", () => {
    const chunks = chunkDocument(pages, { size: 1000, overlap: 150 });
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    const pageOrder = chunks.map((c) => c.pageNumber);
    expect(pageOrder).toEqual([...pageOrder].sort((x, y) => x - y));
  });

  it("skips empty pages", () => {
    const chunks = chunkDocument(pages, { size: 1000, overlap: 150 });
    expect(new Set(chunks.map((c) => c.pageNumber))).toEqual(new Set([1, 3, 4]));
  });

  it("never mixes text from two pages in one chunk", () => {
    const chunks = chunkDocument(pages, { size: 1000, overlap: 150 });
    for (const chunk of chunks) {
      const source = pages.find((p) => p.pageNumber === chunk.pageNumber);
      expect(source?.text.slice(chunk.start, chunk.end)).toBe(chunk.text);
    }
  });

  it("matches chunkPage for each page", () => {
    const chunks = chunkDocument(pages, { size: 1000, overlap: 150 });
    const perPage = pages.flatMap((p) => chunkPage(p, { size: 1000, overlap: 150 }));
    expect(chunks.map(({ chunkIndex: _i, ...rest }) => rest)).toEqual(perPage);
  });

  it("returns no chunks for a document with no text", () => {
    expect(chunkDocument([page("", 1), page("  ", 2)])).toEqual([]);
  });
});

// ---------- contentHash ----------

describe("contentHash", () => {
  const model = "gemini-embedding-2";

  it("is 64 lowercase hex characters", () => {
    expect(contentHash("Refunds within 30 days.", model)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same text and model", () => {
    expect(contentHash("Refunds within 30 days.", model)).toBe(contentHash("Refunds within 30 days.", model));
  });

  it("ignores whitespace differences, because text is normalised first", () => {
    expect(contentHash("Refunds  within\r\n30 days. ", model)).toBe(contentHash("Refunds within\n30 days.", model));
  });

  it("changes with the text", () => {
    expect(contentHash("Refunds within 30 days.", model)).not.toBe(contentHash("Refunds within 31 days.", model));
  });

  it("changes with the embedding model, so vectors from different models are never mixed", () => {
    expect(contentHash("Refunds within 30 days.", model)).not.toBe(contentHash("Refunds within 30 days.", "other-model"));
  });

  it("cannot be confused by moving characters between text and model", () => {
    expect(contentHash("ab", "c")).not.toBe(contentHash("a", "bc"));
  });
});
