/**
 * Public-domain PDFs anyone can add to their library in one click. Each is
 * indexed once as a template (`npm run samples`) and copied with its vectors,
 * so adding one uses no embedding quota. Browser-safe: no server imports.
 */
export const SAMPLE_DOCUMENTS = [
  {
    key: "nist-csf",
    filename: "NIST Cybersecurity Framework 2.0.pdf",
    /** The source PDF in evals/docs. */
    file: "nist-csf-2.0.pdf",
    pageCount: 32,
    description: "Functions, Tiers and Profiles for managing cybersecurity risk",
  },
  {
    key: "irs-p501",
    filename: "IRS Publication 501 (2025).pdf",
    file: "irs-p501.pdf",
    pageCount: 31,
    description: "Dependents, the standard deduction and filing status",
  },
] as const;

export type SampleDocument = (typeof SAMPLE_DOCUMENTS)[number];

/** Owner of the sample templates; no sign-in can produce it (app users are `google:<id>`). */
export const SAMPLES_USER = "samples";

export function sampleByKey(key: string): SampleDocument | null {
  return SAMPLE_DOCUMENTS.find((sample) => sample.key === key) ?? null;
}
