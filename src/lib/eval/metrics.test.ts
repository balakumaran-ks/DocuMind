import { describe, expect, it } from "vitest";
import { REFUSAL } from "../rag/prompt";
import { caseCorrect, compareRuns, parseQuestions, scoreCase, summarize, type EvalCase } from "./metrics";

const answerable = (overrides: Partial<EvalCase> = {}): EvalCase => ({
  question: "What is the standard deduction?",
  documentFile: "irs-p501.pdf",
  expectedPages: [3, 4],
  answerable: true,
  retrievedPages: [4, 9, 12, 1, 2],
  citedPages: [4],
  answer: "It is $15,750 [p. 4].",
  ...overrides,
});

const unanswerable = (overrides: Partial<EvalCase> = {}): EvalCase => ({
  question: "Who wrote this?",
  documentFile: "irs-p501.pdf",
  expectedPages: [],
  answerable: false,
  retrievedPages: [1, 2, 3, 4, 5],
  citedPages: [],
  answer: REFUSAL,
  ...overrides,
});

describe("parseQuestions", () => {
  it("reads one question per line, skipping blank lines", () => {
    const jsonl = [
      '{"question":"Q1?","documentFile":"a.pdf","expectedPages":[2],"answerable":true}',
      "",
      '{"question":"Q2?","documentFile":"a.pdf","expectedPages":[],"answerable":false}',
    ].join("\n");
    expect(parseQuestions(jsonl)).toEqual([
      { question: "Q1?", documentFile: "a.pdf", expectedPages: [2], answerable: true },
      { question: "Q2?", documentFile: "a.pdf", expectedPages: [], answerable: false },
    ]);
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["a missing field", '{"question":"Q?","documentFile":"a.pdf","answerable":true}'],
    ["an answerable question without expected pages", '{"question":"Q?","documentFile":"a.pdf","expectedPages":[],"answerable":true}'],
    ["an unanswerable question with expected pages", '{"question":"Q?","documentFile":"a.pdf","expectedPages":[1],"answerable":false}'],
    ["a page that isn't a positive integer", '{"question":"Q?","documentFile":"a.pdf","expectedPages":[0],"answerable":true}'],
    ["an empty question", '{"question":" ","documentFile":"a.pdf","expectedPages":[1],"answerable":true}'],
  ])("rejects %s, naming the line", (_, line) => {
    expect(() => parseQuestions(`\n${line}`)).toThrow(/line 2/);
  });
});

describe("scoreCase", () => {
  it("counts a hit when any of the top 5 retrieved chunks is on an expected page", () => {
    expect(scoreCase(answerable()).hit).toBe(true);
    expect(scoreCase(answerable({ retrievedPages: [9, 12, 1, 2, 7] })).hit).toBe(false);
  });

  it("only looks at the first 5 retrieved pages", () => {
    expect(scoreCase(answerable({ retrievedPages: [9, 12, 1, 2, 7, 4] })).hit).toBe(false);
  });

  it("counts a citation as correct when the answer cites pages and all of them are expected", () => {
    expect(scoreCase(answerable({ citedPages: [3, 4] })).citationCorrect).toBe(true);
    expect(scoreCase(answerable({ citedPages: [4, 9] })).citationCorrect).toBe(false);
    expect(scoreCase(answerable({ citedPages: [] })).citationCorrect).toBe(false);
  });

  it("recognises the refusal sentence, ignoring surrounding whitespace", () => {
    expect(scoreCase(unanswerable({ answer: `  ${REFUSAL}\n` })).refused).toBe(true);
    expect(scoreCase(unanswerable({ answer: "The author is the IRS [p. 1]." })).refused).toBe(false);
  });

  it("does not score retrieval or citations for unanswerable questions", () => {
    expect(scoreCase(unanswerable())).toEqual({ hit: null, citationCorrect: null, refused: true });
  });
});

describe("caseCorrect", () => {
  it("counts an answerable question as correct when its citations are", () => {
    expect(caseCorrect(answerable())).toBe(true);
    expect(caseCorrect(answerable({ citedPages: [9] }))).toBe(false);
    expect(caseCorrect(answerable({ answer: REFUSAL, citedPages: [] }))).toBe(false);
  });

  it("counts an unanswerable question as correct when it was refused", () => {
    expect(caseCorrect(unanswerable())).toBe(true);
    expect(caseCorrect(unanswerable({ answer: "Made up [p. 2].", citedPages: [2] }))).toBe(false);
  });
});

describe("compareRuns", () => {
  const q = (question: string, overrides: Partial<EvalCase> = {}) => answerable({ question, ...overrides });
  const wrong = { citedPages: [9] };
  const missed = { retrievedPages: [9, 10, 11, 12, 13] };

  it("lists questions that became correct or incorrect since the previous run", () => {
    const previous = [q("A", wrong), q("B"), q("C")];
    const current = [q("A"), q("B", wrong), q("C")];
    expect(compareRuns(previous, current)).toMatchObject({ fixed: ["A"], broken: ["B"] });
  });

  it("lists answerable questions whose retrieval started or stopped finding an expected page", () => {
    const previous = [q("A", missed), q("B"), q("C")];
    const current = [q("A"), q("B", missed), q("C")];
    expect(compareRuns(previous, current)).toMatchObject({ hitGained: ["A"], hitLost: ["B"] });
  });

  it("ignores retrieval changes for unanswerable questions", () => {
    const previous = [unanswerable({ question: "U" })];
    const current = [unanswerable({ question: "U", retrievedPages: [7, 8, 9, 10, 11] })];
    expect(compareRuns(previous, current)).toMatchObject({ hitGained: [], hitLost: [] });
  });

  it("matches questions by their text, and lists new and dropped ones separately", () => {
    const previous = [q("A"), q("Old")];
    const current = [q("A"), q("New", wrong)];
    expect(compareRuns(previous, current)).toEqual({
      fixed: [],
      broken: [],
      hitGained: [],
      hitLost: [],
      added: ["New"],
      removed: ["Old"],
    });
  });

  it("reports nothing for identical runs", () => {
    const run = [q("A"), unanswerable()];
    expect(compareRuns(run, run)).toEqual({ fixed: [], broken: [], hitGained: [], hitLost: [], added: [], removed: [] });
  });
});

describe("summarize", () => {
  it("reports hit@5 and citation accuracy over answerable questions, and refusals over unanswerable ones", () => {
    const summary = summarize([
      answerable(),
      answerable({ retrievedPages: [9, 10, 11, 12, 13], citedPages: [9] }),
      answerable({ citedPages: [3] }),
      answerable({ answer: REFUSAL, citedPages: [] }),
      unanswerable(),
      unanswerable({ answer: "Made up [p. 2].", citedPages: [2] }),
    ]);

    expect(summary).toEqual({
      questions: 6,
      answerable: 4,
      unanswerable: 2,
      hitAt5: 0.75,
      citationAccuracy: 0.5,
      refusalRate: 0.5,
      falseRefusalRate: 0.25,
    });
  });

  it("reports null for a rate with nothing to measure", () => {
    expect(summarize([answerable()])).toMatchObject({ refusalRate: null, hitAt5: 1 });
    expect(summarize([unanswerable()])).toMatchObject({ hitAt5: null, citationAccuracy: null, falseRefusalRate: null });
  });
});
