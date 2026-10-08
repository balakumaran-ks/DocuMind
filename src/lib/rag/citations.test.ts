import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { parseCitations } from "./citations";
import type { RetrievedChunk } from "./retrieve";

function chunk(pageNumber: number, score: number): RetrievedChunk {
  return { _id: new ObjectId(), pageNumber, chunkIndex: pageNumber * 10, text: `page ${pageNumber}`, score };
}

const p1 = chunk(1, 0.71);
const p3 = chunk(3, 0.92);
const p7 = chunk(7, 0.65);
const retrieved = [p3, p1, p7];

describe("parseCitations", () => {
  it("returns one citation per cited page, linked to the retrieved chunk", () => {
    expect(parseCitations("Fees are due monthly [p. 3]. Late fees apply [p. 7].", retrieved)).toEqual([
      { pageNumber: 3, chunkId: p3._id },
      { pageNumber: 7, chunkId: p7._id },
    ]);
  });

  it("keeps the order in which pages are first cited", () => {
    const pages = parseCitations("A [p. 7]. B [p. 1]. C [p. 3].", retrieved).map((c) => c.pageNumber);
    expect(pages).toEqual([7, 1, 3]);
  });

  it("removes duplicate pages", () => {
    const pages = parseCitations("A [p. 3]. B [p. 3]. C [p. 1] and [p. 3].", retrieved).map((c) => c.pageNumber);
    expect(pages).toEqual([3, 1]);
  });

  it("reads several pages in one marker", () => {
    const pages = parseCitations("Both rules apply [p. 3, 7].", retrieved).map((c) => c.pageNumber);
    expect(pages).toEqual([3, 7]);
  });

  it.each([
    ["no space", "[p.3]"],
    ["extra spaces", "[p.  3 ]"],
    ["pp. prefix", "[pp. 3]"],
    ["upper case", "[P. 3]"],
  ])("accepts harmless variations: %s", (_, marker) => {
    expect(parseCitations(`Answer ${marker}.`, retrieved)).toEqual([{ pageNumber: 3, chunkId: p3._id }]);
  });

  it("drops pages that were not among the retrieved chunks", () => {
    const pages = parseCitations("Real [p. 3]. Invented [p. 12]. Also invented [p. 2, 7].", retrieved).map(
      (c) => c.pageNumber,
    );
    expect(pages).toEqual([3, 7]);
  });

  it.each([
    ["empty", "[p. ]"],
    ["not a number", "[p. three]"],
    ["zero", "[p. 0]"],
    ["negative", "[p. -3]"],
    ["decimal", "[p. 3.5]"],
    ["range", "[p. 1-3]"],
    ["trailing comma", "[p. 3,]"],
    ["mixed list", "[p. 3, x]"],
    ["wrong word", "[page 3]"],
    ["no brackets", "p. 3"],
    ["parentheses", "(p. 3)"],
    ["unclosed", "[p. 3"],
  ])("ignores malformed markers: %s", (_, marker) => {
    expect(parseCitations(`Answer ${marker}.`, retrieved)).toEqual([]);
  });

  it("keeps valid markers next to malformed ones", () => {
    const pages = parseCitations("A [p. x]. B [p. 1]. C [page 3].", retrieved).map((c) => c.pageNumber);
    expect(pages).toEqual([1]);
  });

  it("links a page to its highest-scoring retrieved chunk", () => {
    const weaker = chunk(3, 0.5);
    const stronger = chunk(3, 0.95);
    expect(parseCitations("[p. 3]", [weaker, stronger, p1])).toEqual([{ pageNumber: 3, chunkId: stronger._id }]);
  });

  it("returns no citations for a refusal or an answer without markers", () => {
    expect(parseCitations("That isn't covered in this document.", retrieved)).toEqual([]);
    expect(parseCitations("", retrieved)).toEqual([]);
  });

  it("returns no citations when nothing was retrieved", () => {
    expect(parseCitations("Made up [p. 3].", [])).toEqual([]);
  });
});
