/**
 * The RAG eval: ingests the PDFs in evals/docs into a separate database, asks
 * every question in evals/questions.jsonl through the same retrieval, prompt
 * and citation code as the app, prints the scores and writes
 * evals/results/<date>.json.
 *
 *   npm run eval
 *
 * Uses real Atlas Vector Search and real Gemini calls (one embedding and one
 * answer per question, plus the documents' chunks), so it reads .env.local.
 * The database is EVAL_DB (default "documind_eval"), never the app's.
 * Calls are paced for the free tier (EVAL_EMBEDS_PER_MINUTE, default 90;
 * EVAL_ANSWERS_PER_MINUTE, default 4), and unchanged documents are reused.
 * If a daily quota runs out, the run stops and saves what it has. Set
 * GEMINI_CHAT_MODEL (e.g. gemma-4-31b-it) to evaluate another answer model.
 *
 *   npm run eval -- --rescore
 *
 * re-scores the latest saved run against the current questions file without
 * calling any model, after expected pages are corrected.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { generateText } from "ai";
import { MongoClient, type Db, type ObjectId } from "mongodb";
import { getAnswerModel } from "@/lib/ai/answer";
import { EmbeddingRateLimitError, getEmbedder, type Embedder } from "@/lib/ai/embed";
import { describeWait, isDailyQuota, quotaRetrySeconds } from "@/lib/ai/quota";
import { ensureChunkIndexes } from "@/lib/db/chunks";
import { ensureIndexes, insertDocumentWithPages } from "@/lib/db/documents";
import { ensureVectorIndex, waitUntilQueryable } from "@/lib/db/search-index";
import { readServerEnv } from "@/lib/env";
import { compareRuns, parseQuestions, summarize, type EvalCase } from "@/lib/eval/metrics";
import { ingestDocument } from "@/lib/ingest";
import { LIMITS } from "@/lib/limits";
import { countPages, extractPages } from "@/lib/pdf/extract";
import { parseCitations } from "@/lib/rag/citations";
import { buildPrompt } from "@/lib/rag/prompt";
import { retrieveChunks } from "@/lib/rag/retrieve";

const EVAL_USER = "eval";
const root = new URL("../evals/", import.meta.url);

const env = readServerEnv();
const embedder = paced(getEmbedder(), Number(process.env.EVAL_EMBEDS_PER_MINUTE ?? 90));
const reserveAnswer = perMinuteBudget(Number(process.env.EVAL_ANSWERS_PER_MINUTE ?? 4), "answer");
const questions = parseQuestions(readFileSync(new URL("questions.jsonl", root), "utf8"));
const resultsDir = new URL("results/", root);
mkdirSync(resultsDir, { recursive: true });

if (process.argv.includes("--rescore")) {
  rescore();
  process.exit(0);
}

const client = await MongoClient.connect(env.mongodbUri, { appName: "documind-eval" });

try {
  const db = client.db(process.env.EVAL_DB ?? "documind_eval");
  await prepare(db);
  const documentIds = await ingest(db, [...new Set(questions.map((q) => q.documentFile))]);

  const cases: (EvalCase & { latencyMs: number })[] = [];
  let stoppedEarly: string | null = null;
  const failures: { question: string; error: string }[] = [];
  for (const [i, q] of questions.entries()) {
    const started = Date.now();
    const documentId = documentIds.get(q.documentFile);
    if (!documentId) throw new Error(`No document for ${q.documentFile}`);

    let answered: Awaited<ReturnType<typeof askOne>>;
    try {
      answered = await askOne(db, documentId, q.question);
    } catch (error) {
      const wait = quotaWait(error);
      if (wait !== null && isDailyQuota(wait)) {
        stoppedEarly = `The free daily quota ran out at question ${i + 1} of ${questions.length}; it resets in ${describeWait(wait)}.`;
        console.log(`\n${stoppedEarly} Saving the ${cases.length} results so far.`);
        break;
      }
      // The provider kept failing on this question: record it and carry on, so one outage doesn't lose the run.
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ question: q.question, error: message });
      console.log(`${String(i + 1).padStart(2)}. ${q.question}\n    FAILED · ${message.slice(0, 90)}`);
      continue;
    }
    const { chunks, text, answerMs } = answered;

    const result = {
      ...q,
      retrievedPages: chunks.map((chunk) => chunk.pageNumber),
      citedPages: parseCitations(text, chunks).map((citation) => citation.pageNumber),
      answer: text,
      latencyMs: Date.now() - started,
      /** The model's own response time, without pacing waits or retries. */
      answerMs,
    };
    cases.push(result);
    console.log(`${String(i + 1).padStart(2)}. ${q.question}\n    retrieved ${result.retrievedPages.join(",")} · cited ${result.citedPages.join(",") || "-"} · ${text.slice(0, 90).replace(/\s+/g, " ")}`);
  }

  const settings = { chatModel: env.chatModel, embeddingModel: env.embeddingModel, dimensions: env.embeddingDimensions, limits: LIMITS };
  report({ settings, cases, ...(stoppedEarly ? { stoppedEarly } : {}), ...(failures.length > 0 ? { failures } : {}) });
} finally {
  await client.close();
}

type Run = {
  settings: { chatModel: string };
  cases: EvalCase[];
  stoppedEarly?: string;
  failures?: { question: string; error: string }[];
  rescoredFrom?: string;
};

/** Prints the scores and the changes since the latest saved run, then saves this run. */
function report(run: Run) {
  const summary = summarize(run.cases);
  const percent = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
  console.log(`\nAnswer model: ${run.settings.chatModel}${run.stoppedEarly ? " (partial run)" : ""}`);
  console.log(`${summary.questions} questions (${summary.answerable} answerable, ${summary.unanswerable} not)`);
  if (run.failures) console.log(`provider errors    ${run.failures.length} question(s) not scored`);
  console.log(`hit@5              ${percent(summary.hitAt5)}`);
  console.log(`citation accuracy  ${percent(summary.citationAccuracy)}`);
  console.log(`refusal rate       ${percent(summary.refusalRate)}`);
  console.log(`false refusals     ${percent(summary.falseRefusalRate)}`);
  const times = run.cases
    .map((c) => (c as EvalCase & { answerMs?: number }).answerMs)
    .filter((ms): ms is number => typeof ms === "number")
    .sort((a, b) => a - b);
  if (times.length > 0) {
    const at = (q: number) => Math.round((times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0) / 1000);
    console.log(`answer time        median ${at(0.5)} s, p90 ${at(0.9)} s`);
  }

  const previous = latestResults(resultsDir);
  if (previous) {
    const changes = compareRuns(previous.run.cases, run.cases);
    console.log(`\nSince ${previous.name}:`);
    for (const [label, questions] of Object.entries(changes)) {
      if (questions.length > 0) console.log(`  ${label}: ${questions.map((question) => `\n    - ${question}`).join("")}`);
    }
    if (Object.values(changes).every((questions) => questions.length === 0)) console.log("  no per-question changes");
  }

  const runAt = new Date().toISOString();
  const name = `${runAt.slice(0, 10)}-${runAt.slice(11, 13)}${runAt.slice(14, 16)}${run.rescoredFrom ? "-rescored" : ""}.json`;
  const { cases, ...rest } = run;
  writeFileSync(new URL(name, resultsDir), `${JSON.stringify({ date: runAt.slice(0, 10), runAt, ...rest, summary, cases }, null, 2)}\n`);
  console.log(`\nWrote evals/results/${name}`);
}

/**
 * Re-scores the latest saved run against the current questions file, without
 * calling any model: for when expected pages in the answer key are corrected.
 */
function rescore() {
  const latest = latestResults(resultsDir);
  if (!latest) throw new Error("No saved results to rescore.");
  const current = new Map(questions.map((q) => [q.question, q]));
  const cases = latest.run.cases.flatMap((c) => {
    const q = current.get(c.question);
    return q ? [{ ...c, expectedPages: q.expectedPages, answerable: q.answerable }] : [];
  });
  console.log(`Rescoring ${latest.name} against evals/questions.jsonl (no model calls).`);
  report({ ...latest.run, cases, rescoredFrom: latest.name });
}

/** Seconds to wait if `error` is a used-up quota (embedding or answer), otherwise null. */
function quotaWait(error: unknown): number | null {
  return error instanceof EmbeddingRateLimitError ? error.retryAfterSeconds : quotaRetrySeconds(error);
}

/**
 * Embeds the question, retrieves, and answers it through the app's own code.
 * A per-minute quota is waited out (up to three attempts); a daily one is thrown.
 */
async function askOne(db: Db, documentId: ObjectId, question: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      const queryVector = await embedder.embedQuery(question);
      const chunks = await retrieveChunks({ db, userId: EVAL_USER, documentId, queryVector });
      const prompt = buildPrompt({ question, chunks, history: [] });
      await reserveAnswer();
      const answerStarted = Date.now();
      const { text } = await generateText({ model: getAnswerModel(), instructions: prompt.system, messages: prompt.messages });
      return { chunks, text, answerMs: Date.now() - answerStarted };
    } catch (error) {
      const wait = quotaWait(error);
      if ((wait !== null && isDailyQuota(wait)) || attempt >= 3) throw error;
      // A per-minute quota says how long to wait; anything else (such as a 500) gets a short pause.
      const seconds = wait ?? 15;
      console.log(`    (attempt ${attempt} failed; waiting ${seconds} s)`);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  }
}

/** The most recently written results file, if any, for comparing this run with. */
function latestResults(dir: URL): { name: string; run: Run } | null {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, mtime: statSync(new URL(name, dir)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const latest = files[0];
  if (!latest) return null;
  return { name: latest.name, run: JSON.parse(readFileSync(new URL(latest.name, dir), "utf8")) as Run };
}

/**
 * A per-minute budget, like the Gemini free tier's quotas: `reserve(n)` waits
 * until n more units fit in the last 60 seconds.
 */
function perMinuteBudget(perMinute: number, label: string) {
  const sent: number[] = [];
  return async function reserve(count = 1) {
    for (;;) {
      const now = Date.now();
      while (sent.length > 0 && (sent[0] ?? now) <= now - 60_000) sent.shift();
      if (sent.length + count <= perMinute) break;
      const wait = (sent[sent.length + count - perMinute - 1] ?? now) + 60_000 - now + 500;
      console.log(`    (waiting ${Math.ceil(wait / 1000)} s for the ${label} quota)`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    sent.push(...Array.from({ length: count }, () => Date.now()));
  };
}

/** Keeps embedding calls under the per-minute quota, which counts texts, not requests. */
function paced(inner: Embedder, perMinute: number): Embedder {
  const reserve = perMinuteBudget(perMinute, "embedding");
  return {
    model: inner.model,
    dimensions: inner.dimensions,
    async embedDocuments(texts) {
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += perMinute) {
        const batch = texts.slice(i, i + perMinute);
        await reserve(batch.length);
        vectors.push(...(await inner.embedDocuments(batch)));
      }
      return vectors;
    },
    async embedQuery(text) {
      await reserve(1);
      return inner.embedQuery(text);
    },
  };
}

/** Indexes, and a queryable vector index. Earlier eval documents are kept and reused when unchanged. */
async function prepare(db: Db) {
  await ensureIndexes(db);
  await ensureChunkIndexes(db);
  const index = await ensureVectorIndex(db, env.embeddingDimensions);
  if (index.status === "mismatch") throw new Error("The eval database's vector index has different dimensions; drop it in Atlas.");
  if (!(await waitUntilQueryable(db))) throw new Error("The vector index is still building; run the eval again in a minute.");
}

/**
 * Stores and embeds each PDF the way an upload does, then waits until search
 * sees its chunks. A ready copy with the same content and embedding model is
 * reused; anything else for that file is deleted and ingested again.
 */
async function ingest(db: Db, files: string[]): Promise<Map<string, ObjectId>> {
  const ids = new Map<string, ObjectId>();
  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(new URL(`docs/${file}`, root)));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existing = await db.collection("documents").findOne({
      userId: EVAL_USER,
      filename: file,
      sha256,
      status: "ready",
      embeddingModel: embedder.model,
    });
    if (existing) {
      console.log(`Reusing ${file} (${String(existing.chunkCount)} chunks)`);
      ids.set(file, existing._id);
      continue;
    }
    const stale = await db.collection("documents").find({ userId: EVAL_USER, filename: file }).toArray();
    for (const document of stale) {
      await Promise.all(
        ["pages", "chunks"].map((name) => db.collection(name).deleteMany({ userId: EVAL_USER, documentId: document._id })),
      );
      await db.collection("documents").deleteOne({ _id: document._id, userId: EVAL_USER });
    }

    const pageCount = await countPages(bytes);
    if (pageCount > LIMITS.maxPagesPerDocument) throw new Error(`${file} has ${pageCount} pages; the limit is ${LIMITS.maxPagesPerDocument}.`);
    const pages = await extractPages(bytes);
    const documentId = await insertDocumentWithPages(db, { userId: EVAL_USER, filename: file, sizeBytes: bytes.length, sha256, pages });
    const { chunkCount } = await ingestDocument({ db, embedder, userId: EVAL_USER, documentId, pages });
    console.log(`Ingested ${file}: ${pageCount} pages, ${chunkCount} chunks`);
    await waitUntilSearchable(db, documentId, chunkCount);
    ids.set(file, documentId);
  }
  return ids;
}

/** Atlas indexes new vectors asynchronously; wait until a search returns as many chunks as it should. */
async function waitUntilSearchable(db: Db, documentId: ObjectId, chunkCount: number) {
  const probe = await db.collection("chunks").findOne({ userId: EVAL_USER, documentId });
  if (!probe) return;
  const wanted = Math.min(LIMITS.retrievalTopK, chunkCount);
  for (let attempt = 0; attempt < 40; attempt++) {
    const found = await retrieveChunks({ db, userId: EVAL_USER, documentId, queryVector: probe.embedding });
    if (found.length >= wanted) return;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error("Chunks are still not searchable after 2 minutes.");
}
