import { describe, expect, it } from "vitest";
import { LIMITS } from "../limits";
import { cleanFilename } from "./filename";

describe("cleanFilename", () => {
  it("keeps an ordinary name as it is", () => {
    expect(cleanFilename("Employee Handbook 2026.pdf")).toBe("Employee Handbook 2026.pdf");
  });

  it("removes control characters and collapses whitespace", () => {
    expect(cleanFilename("  notes\u0000\u0007\n\tfinal .pdf ")).toBe("notes final .pdf");
  });

  it("removes direction-override characters that can disguise a name", () => {
    // U+202E reverses what follows, so this name displays as "invoiceexe.pdf".
    expect(cleanFilename("invoice‮fdp.exe")).toBe("invoicefdp.exe");
    expect(cleanFilename("a⁦b⁩c‏.pdf")).toBe("abc.pdf");
  });

  it(`shortens names over ${LIMITS.maxFilenameChars} characters, keeping the extension`, () => {
    const cleaned = cleanFilename(`${"a".repeat(300)}.pdf`);
    expect(cleaned.length).toBe(LIMITS.maxFilenameChars);
    expect(cleaned.endsWith("….pdf")).toBe(true);
  });

  it("falls back to a generic name when nothing is left", () => {
    expect(cleanFilename("‮\u0000  ")).toBe("document.pdf");
  });
});
