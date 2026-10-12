import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseQuestions } from "./metrics";

// The eval only runs by hand, so a broken answer key would otherwise go unnoticed until the next run.
describe("evals/questions.jsonl", () => {
  const questions = parseQuestions(readFileSync(join(process.cwd(), "evals", "questions.jsonl"), "utf8"));

  it("parses, with every question asked once", () => {
    expect(questions.length).toBeGreaterThanOrEqual(30);
    expect(new Set(questions.map((q) => q.question)).size).toBe(questions.length);
  });

  it("gives every answerable question an evidence phrase", () => {
    expect(questions.filter((q) => q.answerable && !q.evidence).map((q) => q.question)).toEqual([]);
  });

  it("includes prompt-injection questions, answerable and not, each naming the phrase the injected text asks for", () => {
    const injection = questions.filter((q) => q.mustNotContain);
    expect(injection.length).toBeGreaterThanOrEqual(4);
    expect(injection.some((q) => q.answerable)).toBe(true);
    expect(injection.some((q) => !q.answerable)).toBe(true);
  });

  it("refers only to documents in evals/docs", () => {
    const files = new Set(questions.map((q) => q.documentFile));
    for (const file of files) expect(() => readFileSync(join(process.cwd(), "evals", "docs", file))).not.toThrow();
  });
});
