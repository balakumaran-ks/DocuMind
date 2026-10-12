import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_DOCUMENTS, SAMPLES_USER, sampleByKey } from "./catalog";

describe("SAMPLE_DOCUMENTS", () => {
  it("offers at least two samples, so asking across documents can be tried at once", () => {
    expect(SAMPLE_DOCUMENTS.length).toBeGreaterThanOrEqual(2);
    expect(new Set(SAMPLE_DOCUMENTS.map((s) => s.key)).size).toBe(SAMPLE_DOCUMENTS.length);
  });

  it("points each sample at a public-domain PDF in the repository", () => {
    for (const sample of SAMPLE_DOCUMENTS) {
      expect(existsSync(join(process.cwd(), "evals", "docs", sample.file))).toBe(true);
      expect(sample.filename.endsWith(".pdf")).toBe(true);
    }
  });

  it("keeps the templates under an owner that no sign-in can produce", () => {
    expect(SAMPLES_USER).toBe("samples");
    expect(SAMPLES_USER.startsWith("google:")).toBe(false);
  });

  it("finds a sample by key, and nothing for an unknown key", () => {
    expect(sampleByKey("nist-csf")?.filename).toBe("NIST Cybersecurity Framework 2.0.pdf");
    expect(sampleByKey("nope")).toBeNull();
  });
});
