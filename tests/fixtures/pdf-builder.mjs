/**
 * Builds small text PDFs with no dependencies: a hand-built PDF 1.4 (catalog,
 * page tree, one Helvetica font, one content stream per page, xref table).
 * The output is deterministic, so generated files can be committed.
 */

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
export function buildPdf(pages) {
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
