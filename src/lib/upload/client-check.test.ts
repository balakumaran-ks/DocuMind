import { describe, expect, it } from "vitest";
import { LIMITS } from "../limits";
import { checkFileBeforeUpload } from "./client-check";

const pdf = (size: number, name = "notes.pdf", type = "application/pdf") => ({ name, size, type });

describe("checkFileBeforeUpload", () => {
  it("accepts a PDF within the size limit", () => {
    expect(checkFileBeforeUpload(pdf(1024))).toBeNull();
    expect(checkFileBeforeUpload(pdf(LIMITS.maxUploadBytes))).toBeNull();
  });

  it("rejects a file over the size limit, saying how big it is and what the limit is", () => {
    expect(checkFileBeforeUpload(pdf(LIMITS.maxUploadBytes + 1))).toMatch(/the limit is 4\.0 MB\.$/);
    expect(checkFileBeforeUpload(pdf(6 * 1024 * 1024))).toBe("This file is 6.0 MB; the limit is 4.0 MB.");
  });

  it("rejects files that are not PDFs by type and name", () => {
    expect(checkFileBeforeUpload(pdf(1024, "notes.docx", "application/vnd.openxmlformats"))).toBe(
      "Only PDF files are supported.",
    );
  });

  it("accepts a .pdf name when the browser reports no type", () => {
    expect(checkFileBeforeUpload(pdf(1024, "Scan.PDF", ""))).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(checkFileBeforeUpload(pdf(0))).toBe("This file is empty.");
  });
});
