#!/usr/bin/env node
/**
 * Writes the small PDFs used by the tests, so every fixture has known text on
 * known pages (see pdf-builder.mjs).
 *
 *   node tests/fixtures/make-fixtures.mjs
 *
 * The output is deterministic and committed; re-run only when changing fixtures.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPdf } from "./pdf-builder.mjs";

const dir = import.meta.dirname;

const textThreePages = buildPdf([
  ["Returns and refunds", "Refunds are accepted within 30 days of delivery.", "Damaged items may be returned at any time."],
  ["Shipping", "Orders ship within two business days."],
  ["Warranty", "Every product has a two year warranty from purchase."],
]);

const fixtures = {
  "text-3-pages.pdf": textThreePages,
  "blank-page-2.pdf": buildPdf([["Introduction to the test document."], [], ["Conclusion: the second page is blank."]]),
  "all-blank.pdf": buildPdf([[], []]),
  "pages-51.pdf": buildPdf(Array.from({ length: 51 }, (_, i) => [`This is page ${i + 1}.`])),
  // Starts with %PDF- (passes the magic-byte check) but cannot be parsed.
  "truncated.pdf": textThreePages.subarray(0, Math.floor(textThreePages.length / 2)),
  "not-a-pdf.pdf": Buffer.from("This is a plain text file pretending to be a PDF.\n", "utf8"),
};

for (const [name, bytes] of Object.entries(fixtures)) {
  writeFileSync(join(dir, name), bytes);
  console.log(`✓ tests/fixtures/${name} (${bytes.length} bytes)`);
}
