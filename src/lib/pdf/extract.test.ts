import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countPages, extractPages, normalizeText, PdfReadError } from "./extract";

/** A fresh copy each time, so one test can never see a buffer another test consumed. */
const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", name)));

describe("normalizeText", () => {
  it.each([
    ["collapses runs of spaces and tabs", "a  b\t\tc", "a b c"],
    ["converts CRLF and CR to LF", "line 1\r\nline 2\rline 3", "line 1\nline 2\nline 3"],
    ["keeps at most one blank line", "para 1\n\n\n\npara 2", "para 1\n\npara 2"],
    ["trims each line and the whole text", "  lead \n  trail  \n ", "lead\ntrail"],
    ["turns non-breaking spaces into spaces", "30 days", "30 days"],
    ["empties a line that is only whitespace", "a\n \t \nb", "a\n\nb"],
    ["leaves an empty string empty", "", ""],
    ["keeps non-Latin text intact", "தமிழ்  உரை", "தமிழ் உரை"],
  ])("%s", (_name, input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });
});

describe("countPages", () => {
  it("counts pages without needing to extract text", async () => {
    expect(await countPages(fixture("text-3-pages.pdf"))).toBe(3);
    expect(await countPages(fixture("pages-51.pdf"))).toBe(51);
  });

  it.each(["truncated.pdf", "not-a-pdf.pdf"])("throws PdfReadError for %s", async (name) => {
    await expect(countPages(fixture(name))).rejects.toBeInstanceOf(PdfReadError);
  });
});

describe("extractPages", () => {
  it("returns one entry per page, numbered from 1", async () => {
    const pages = await extractPages(fixture("text-3-pages.pdf"));
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
  });

  it("keeps each page's text on its own page", async () => {
    const [p1, p2, p3] = await extractPages(fixture("text-3-pages.pdf"));
    expect(p1.text).toContain("Refunds are accepted within 30 days of delivery.");
    expect(p2.text).toContain("Orders ship within two business days.");
    expect(p3.text).toContain("two year warranty");
    expect(p2.text).not.toContain("Refunds");
    expect(p1.text).not.toContain("warranty");
  });

  it("preserves line breaks between lines of a page", async () => {
    const [p1] = await extractPages(fixture("text-3-pages.pdf"));
    expect(p1.text.split("\n")).toEqual([
      "Returns and refunds",
      "Refunds are accepted within 30 days of delivery.",
      "Damaged items may be returned at any time.",
    ]);
  });

  it("reports charCount as the length of the normalised text", async () => {
    const pages = await extractPages(fixture("text-3-pages.pdf"));
    for (const page of pages) {
      expect(page.charCount).toBe(page.text.length);
      expect(page.isEmpty).toBe(false);
    }
  });

  it("flags a page with no text as empty", async () => {
    const pages = await extractPages(fixture("blank-page-2.pdf"));
    expect(pages.map((p) => p.isEmpty)).toEqual([false, true, false]);
    expect(pages[1]).toMatchObject({ pageNumber: 2, text: "", charCount: 0 });
  });

  it("flags every page of a text-less (likely scanned) PDF as empty", async () => {
    const pages = await extractPages(fixture("all-blank.pdf"));
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.isEmpty)).toBe(true);
  });

  it.each(["truncated.pdf", "not-a-pdf.pdf"])("throws PdfReadError for %s", async (name) => {
    await expect(extractPages(fixture(name))).rejects.toBeInstanceOf(PdfReadError);
  });

  it("can be called after countPages on the same bytes", async () => {
    // pdf.js may take ownership of the buffer it is given; callers must not have to care.
    const bytes = fixture("text-3-pages.pdf");
    expect(await countPages(bytes)).toBe(3);
    await expect(extractPages(bytes)).resolves.toHaveLength(3);
  });
});
