import { z } from "zod";
import { REFUSAL } from "@/lib/rag/prompt";

const Question = z
  .object({
    question: z.string().trim().min(1),
    documentFile: z.string().min(1),
    expectedPages: z.array(z.number().int().positive()),
    answerable: z.boolean(),
  })
  .refine((q) => (q.answerable ? q.expectedPages.length > 0 : q.expectedPages.length === 0), {
    message: "answerable questions need expectedPages; unanswerable ones must have none",
  });

/** One line of evals/questions.jsonl. */
export type EvalQuestion = z.infer<typeof Question>;

/** A question with what the system did: the pages it retrieved, the pages it cited, and its answer. */
export type EvalCase = EvalQuestion & { retrievedPages: number[]; citedPages: number[]; answer: string };

/** Reads the JSONL question file, rejecting any malformed line with its line number. */
export function parseQuestions(jsonl: string): EvalQuestion[] {
  const questions: EvalQuestion[] = [];
  jsonl.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === "") return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`evals/questions.jsonl line ${i + 1}: invalid JSON`);
    }
    const parsed = Question.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`evals/questions.jsonl line ${i + 1}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }
    questions.push(parsed.data);
  });
  return questions;
}

const TOP_K = 5;

/**
 * hit: an expected page is among the top 5 retrieved. citationCorrect: the
 * answer cites at least one page and every cited page is expected. Both are
 * null for unanswerable questions, where only the refusal matters.
 */
export function scoreCase(c: EvalCase): { hit: boolean | null; citationCorrect: boolean | null; refused: boolean } {
  const refused = c.answer.trim() === REFUSAL;
  if (!c.answerable) return { hit: null, citationCorrect: null, refused };
  const expected = new Set(c.expectedPages);
  return {
    hit: c.retrievedPages.slice(0, TOP_K).some((page) => expected.has(page)),
    citationCorrect: c.citedPages.length > 0 && c.citedPages.every((page) => expected.has(page)),
    refused,
  };
}

const rate = (count: number, total: number) => (total === 0 ? null : count / total);

/** Overall scores: hit@5, citation accuracy and false refusals over answerable questions; refusals over the rest. */
export function summarize(cases: EvalCase[]) {
  const scored = cases.map((c) => ({ c, s: scoreCase(c) }));
  const answerable = scored.filter(({ c }) => c.answerable);
  const unanswerable = scored.filter(({ c }) => !c.answerable);
  return {
    questions: cases.length,
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    hitAt5: rate(answerable.filter(({ s }) => s.hit).length, answerable.length),
    citationAccuracy: rate(answerable.filter(({ s }) => s.citationCorrect).length, answerable.length),
    refusalRate: rate(unanswerable.filter(({ s }) => s.refused).length, unanswerable.length),
    falseRefusalRate: rate(answerable.filter(({ s }) => s.refused).length, answerable.length),
  };
}
