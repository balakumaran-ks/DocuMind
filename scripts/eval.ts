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
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateText } from "ai";
import { MongoClient, type Db, type ObjectId } from "mongodb";
import { getAnswerModel } from "@/lib/ai/answer";
import { getEmbedder } from "@/lib/ai/embed";
import { ensureChunkIndexes } from "@/lib/db/chunks";
import { ensureIndexes, insertDocumentWithPages } from "@/lib/db/documents";
import { ensureVectorIndex, waitUntilQueryable } from "@/lib/db/search-index";
import { readServerEnv } from "@/lib/env";
import { parseQuestions, summarize, type EvalCase } from "@/lib/eval/metrics";
import { ingestDocument } from "@/lib/ingest";
import { LIMITS } from "@/lib/limits";
import { countPages, extractPages } from "@/lib/pdf/extract";
import { parseCitations } from "@/lib/rag/citations";
import { buildPrompt } from "@/lib/rag/prompt";
import { retrieveChunks } from "@/lib/rag/retrieve";

const EVAL_USER = "eval";
const root = new URL("../evals/", import.meta.url);

const env = readServerEnv();
const embedder = getEmbedder();
const questions = parseQuestions(readFileSync(new URL("questions.jsonl", root), "utf8"));
const client = await MongoClient.connect(env.mongodbUri, { appName: "documind-eval" });

try {
  const db = client.db(process.env.EVAL_DB ?? "documind_eval");
  await prepare(db);
  const documentIds = await ingest(db, [...new Set(questions.map((q) => q.documentFile))]);

  const cases: (EvalCase & { latencyMs: number })[] = [];
  for (const [i, q] of questions.entries()) {
    const started = Date.now();
    const documentId = documentIds.get(q.documentFile);
    if (!documentId) throw new Error(`No document for ${q.documentFile}`);

    const queryVector = await embedder.embedQuery(q.question);
    const chunks = await retrieveChunks({ db, userId: EVAL_USER, documentId, queryVector });
    const prompt = buildPrompt({ question: q.question, chunks, history: [] });
    const { text } = await generateText({ model: getAnswerModel(), instructions: prompt.system, messages: prompt.messages });

    const result = {
      ...q,
      retrievedPages: chunks.map((chunk) => chunk.pageNumber),
      citedPages: parseCitations(text, chunks).map((citation) => citation.pageNumber),
      answer: text,
      latencyMs: Date.now() - started,
    };
    cases.push(result);
    console.log(`${String(i + 1).padStart(2)}. ${q.question}\n    retrieved ${result.retrievedPages.join(",")} · cited ${result.citedPages.join(",") || "-"} · ${text.slice(0, 90).replace(/\s+/g, " ")}`);
  }

  const summary = summarize(cases);
  const percent = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
  console.log(`\n${summary.questions} questions (${summary.answerable} answerable, ${summary.unanswerable} not)`);
  console.log(`hit@5              ${percent(summary.hitAt5)}`);
  console.log(`citation accuracy  ${percent(summary.citationAccuracy)}`);
  console.log(`refusal rate       ${percent(summary.refusalRate)}`);
  console.log(`false refusals     ${percent(summary.falseRefusalRate)}`);

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(new URL("results/", root), { recursive: true });
  const file = new URL(`results/${date}.json`, root);
  const settings = { chatModel: env.chatModel, embeddingModel: env.embeddingModel, dimensions: env.embeddingDimensions, limits: LIMITS };
  writeFileSync(file, `${JSON.stringify({ date, settings, summary, cases }, null, 2)}\n`);
  console.log(`\nWrote evals/results/${date}.json`);
} finally {
  await client.close();
}

/** Indexes, a clean slate for the eval user, and a queryable vector index. */
async function prepare(db: Db) {
  await ensureIndexes(db);
  await ensureChunkIndexes(db);
  await Promise.all(["documents", "pages", "chunks"].map((name) => db.collection(name).deleteMany({ userId: EVAL_USER })));
  const index = await ensureVectorIndex(db, env.embeddingDimensions);
  if (index.status === "mismatch") throw new Error("The eval database's vector index has different dimensions; drop it in Atlas.");
  if (!(await waitUntilQueryable(db))) throw new Error("The vector index is still building; run the eval again in a minute.");
}

/** Stores and embeds each PDF the way an upload does, then waits until search sees its chunks. */
async function ingest(db: Db, files: string[]): Promise<Map<string, ObjectId>> {
  const ids = new Map<string, ObjectId>();
  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(new URL(`docs/${file}`, root)));
    const pageCount = await countPages(bytes);
    if (pageCount > LIMITS.maxPagesPerDocument) throw new Error(`${file} has ${pageCount} pages; the limit is ${LIMITS.maxPagesPerDocument}.`);
    const pages = await extractPages(bytes);
    const documentId = await insertDocumentWithPages(db, { userId: EVAL_USER, filename: file, sizeBytes: bytes.length, sha256: "", pages });
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
