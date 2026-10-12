import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { findCitationMarkers, parseCitations } from "./citations";
import type { RetrievedChunk } from "./retrieve";

const DOC = new ObjectId();

function chunk(pageNumber: number, score: number, documentId = DOC): RetrievedChunk {
  return { _id: new ObjectId(), documentId, pageNumber, chunkIndex: pageNumber * 10, text: `page ${pageNumber}`, score };
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

  it("ignores markers that name a document, which only cross-document answers use", () => {
    expect(parseCitations("Answer [A p. 3].", retrieved)).toEqual([]);
    expect(parseCitations("Answer [A p. 3].", retrieved, [DOC])).toEqual([]);
  });
});

describe("findCitationMarkers", () => {
  it("reads an optional document letter, in upper case", () => {
    expect(findCitationMarkers("X [A p. 3]. Y [b, pp. 4, 5]. Z [p. 6].")).toEqual([
      { start: 2, end: 10, label: "A", pages: [3] },
      { start: 14, end: 27, label: "B", pages: [4, 5] },
      { start: 31, end: 37, pages: [6] },
    ]);
  });

  it.each([
    ["two letters", "[AB p. 3]"],
    ["a letter run into the p", "[Ap. 3]"],
    ["a digit", "[1 p. 3]"],
  ])("ignores a malformed document letter: %s", (_, marker) => {
    expect(findCitationMarkers(`Answer ${marker}.`)).toEqual([]);
  });

  it("doesn't mistake pp. for a document letter", () => {
    expect(findCitationMarkers("[pp. 3]")).toEqual([{ start: 0, end: 7, pages: [3] }]);
  });
});

describe("parseCitations across documents", () => {
  const handbook = new ObjectId();
  const policy = new ObjectId();
  const documents = [handbook, policy];
  const a2 = chunk(2, 0.8, handbook);
  const a5 = chunk(5, 0.7, handbook);
  const b2 = chunk(2, 0.9, policy);
  const across = [a2, b2, a5];

  it("links each lettered citation to the retrieved chunk of that document and page", () => {
    expect(parseCitations("Monthly [A p. 2]. Refunds [B p. 2].", across, documents)).toEqual([
      { documentId: handbook, pageNumber: 2, chunkId: a2._id },
      { documentId: policy, pageNumber: 2, chunkId: b2._id },
    ]);
  });

  it("reads several pages of one document, and harmless variations", () => {
    const cited = parseCitations("X [A p. 2, 5]. Y [b, p. 2]. Z [A pp. 5].", across, documents);
    expect(cited.map((c) => [c.documentId, c.pageNumber])).toEqual([
      [handbook, 2],
      [handbook, 5],
      [policy, 2],
    ]);
  });

  it("drops a page that wasn't retrieved from the cited document, even if another document's was", () => {
    expect(parseCitations("Invented [B p. 5].", across, documents)).toEqual([]);
  });

  it("ignores markers without a letter, and letters beyond the chat's documents", () => {
    expect(parseCitations("Which one? [p. 2]. Unknown [C p. 2].", across, documents)).toEqual([]);
  });

  it("removes duplicates per document and page, keeping first-cited order", () => {
    const cited = parseCitations("[B p. 2] [A p. 2] [B p. 2] [A p. 2, 5]", across, documents);
    expect(cited.map((c) => [c.documentId, c.pageNumber])).toEqual([
      [policy, 2],
      [handbook, 2],
      [handbook, 5],
    ]);
  });
});
