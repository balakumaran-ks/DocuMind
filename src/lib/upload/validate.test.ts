import { describe, expect, it } from "vitest";
import { formatBytes, LIMITS } from "@/lib/limits";
import { validateUpload } from "./validate";

const PDF_HEAD = new TextEncoder().encode("%PDF-1.7\n");
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const valid = { size: 1024, head: PDF_HEAD, documentCount: 0 };

describe("validateUpload", () => {
  it("accepts a small PDF from a user under the document cap", () => {
    expect(validateUpload(valid)).toEqual({ ok: true });
  });

  describe("size (413)", () => {
    it("accepts a file of exactly the limit", () => {
      expect(validateUpload({ ...valid, size: LIMITS.maxUploadBytes })).toEqual({ ok: true });
    });

    it("rejects one byte over the limit, naming the limit in the message", () => {
      const result = validateUpload({ ...valid, size: LIMITS.maxUploadBytes + 1 });
      expect(result).toMatchObject({ ok: false, status: 413, code: "too_large" });
      expect(!result.ok && result.message).toContain(formatBytes(LIMITS.maxUploadBytes));
    });
  });

  describe("type by magic bytes (415)", () => {
    it("rejects a PNG even when the caller claims it is a PDF", () => {
      expect(validateUpload({ ...valid, head: PNG_HEAD })).toMatchObject({ ok: false, status: 415, code: "not_pdf" });
    });

    it("rejects an empty file", () => {
      expect(validateUpload({ ...valid, size: 0, head: new Uint8Array() })).toMatchObject({ status: 415 });
    });

    it("rejects a header that stops short of the full %PDF- signature", () => {
      expect(validateUpload({ ...valid, head: new TextEncoder().encode("%PDF") })).toMatchObject({ status: 415 });
    });

    it("rejects a signature that does not start at byte 0", () => {
      expect(validateUpload({ ...valid, head: new TextEncoder().encode(" %PDF-1.7") })).toMatchObject({ status: 415 });
    });
  });

  describe("per-user document cap (409)", () => {
    it("accepts the last allowed document", () => {
      expect(validateUpload({ ...valid, documentCount: LIMITS.maxDocumentsPerUser - 1 })).toEqual({ ok: true });
    });

    it("rejects once the user already has the maximum", () => {
      expect(validateUpload({ ...valid, documentCount: LIMITS.maxDocumentsPerUser })).toMatchObject({
        ok: false,
        status: 409,
        code: "too_many_documents",
      });
    });
  });

  describe("precedence when several checks fail", () => {
    it("reports size before type", () => {
      const result = validateUpload({ size: LIMITS.maxUploadBytes + 1, head: PNG_HEAD, documentCount: 0 });
      expect(result).toMatchObject({ status: 413 });
    });

    it("reports type before the document cap", () => {
      const result = validateUpload({ ...valid, head: PNG_HEAD, documentCount: LIMITS.maxDocumentsPerUser });
      expect(result).toMatchObject({ status: 415 });
    });
  });
});
