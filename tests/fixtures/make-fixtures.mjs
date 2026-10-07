#!/usr/bin/env node
/**
 * Writes the small PDFs used by the tests, so every fixture has known text on
 * known pages. Zero dependencies: each file is a hand-built PDF 1.4 (catalog,
 * page tree, one Helvetica font, one content stream per page, xref table).
 *
 *   node tests/fixtures/make-fixtures.mjs
 *
 * The output is deterministic and committed; re-run only when changing fixtures.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dirname;

const escapePdfString = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** One text line per entry, 14pt apart, starting near the top-left of a Letter page. */
function contentStream(lines) {
  if (lines.length === 0) return "";
  const ops = ["BT", "/F1 12 Tf", "14 TL", "72 720 Td"];
  lines.forEach((line, i) => {
    ops.push(`(${escapePdfString(line)}) Tj`);
    if (i < lines.length - 1) ops.push("T*");
  });
  ops.push("ET");
  return ops.join("\n");
}

/** @param {string[][]} pages lines of text for each page; [] makes a blank page */
function buildPdf(pages) {
  const objects = [];
  const add = (body) => objects.push(body); // returns the new object number
  const catalog = add("");
  const pageTree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const kids = pages.map((lines) => {
    const stream = contentStream(lines);
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = objects.map((body, i) => {
    const offset = Buffer.byteLength(out, "latin1");
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

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
