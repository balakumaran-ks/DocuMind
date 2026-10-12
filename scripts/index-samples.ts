/**
 * Indexes the sample documents (src/lib/samples/catalog.ts) once, as templates
 * owned by the user "samples", so that users can add them without any
 * embedding calls. A sample already indexed from the same file with the
 * current embedding model is skipped; a re-indexed one replaces the old
 * template.
 *
 *   npm run samples
 *
 * Uses the same batched ingestion as uploads and waits out per-minute quota
 * pauses. If the daily quota runs out, it stops; run it again the next day.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { getEmbedder } from "@/lib/ai/embed";
import { describeWait, isDailyQuota } from "@/lib/ai/quota";
import { ensureChunkIndexes } from "@/lib/db/chunks";
import { deleteDocument, ensureIndexes, insertDocumentWithPages } from "@/lib/db/documents";
import { findSampleTemplate } from "@/lib/db/samples";
import { readServerEnv } from "@/lib/env";
import { continueIngestion, startIngestion } from "@/lib/ingest";
import { extractPages } from "@/lib/pdf/extract";
import { SAMPLE_DOCUMENTS, SAMPLES_USER } from "@/lib/samples/catalog";

const env = readServerEnv();
const embedder = getEmbedder();
const client = await MongoClient.connect(env.mongodbUri, { appName: "documind-scripts" });

try {
  const db = client.db(env.mongodbDb);
  await ensureIndexes(db);
  await ensureChunkIndexes(db);

  for (const sample of SAMPLE_DOCUMENTS) {
    const bytes = new Uint8Array(readFileSync(new URL(`../evals/docs/${sample.file}`, import.meta.url)));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const current = await findSampleTemplate(db, sample.key, embedder.model);
    if (current?.sha256 === sha256) {
      console.log(`${sample.key}: already indexed (${current.chunkCount ?? 0} chunks)`);
      continue;
    }

    const pages = await extractPages(bytes);
    const documentId = await insertDocumentWithPages(db, {
      userId: SAMPLES_USER,
      filename: sample.filename,
      sizeBytes: bytes.length,
      sha256,
      pages,
    });
    await db.collection("documents").updateOne({ _id: documentId, userId: SAMPLES_USER }, { $set: { sampleKey: sample.key } });
    const target = { db, embedder, userId: SAMPLES_USER, documentId };

    let progress = await startIngestion({ ...target, pages });
    while (progress.status !== "ready") {
      const wait = progress.retryAfterSeconds ?? 0;
      if (isDailyQuota(wait)) {
        throw new Error(`The daily embedding quota is used up; run npm run samples again in ${describeWait(wait)}.`);
      }
      if (wait > 0) {
        console.log(`  waiting ${wait} s for the embedding quota`);
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      }
      const next = await continueIngestion(target);
      if (!next) throw new Error(`${sample.key}: indexing failed`);
      progress = next;
      console.log(`  ${progress.embeddedChunks} of ${progress.chunkCount} chunks`);
    }

    // The new template is ready; remove older ones, including any left half-indexed by an earlier run.
    const older = await db
      .collection("documents")
      .find({ userId: SAMPLES_USER, sampleKey: sample.key, _id: { $ne: documentId } }, { projection: { _id: 1 } })
      .toArray();
    for (const document of older) await deleteDocument(db, SAMPLES_USER, document._id.toHexString());
    console.log(`${sample.key}: indexed ${progress.chunkCount} chunks${older.length > 0 ? `, replaced ${older.length} older` : ""}`);
  }
} finally {
  await client.close();
}
