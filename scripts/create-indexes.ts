/**
 * Creates the Atlas Vector Search and Atlas Search (keyword) indexes on
 * `chunks` if they don't exist and waits until both are queryable. Safe to run
 * more than once.
 *
 *   npm run db:indexes
 *
 * Runs directly with Node's TypeScript support and reads .env.local.
 * Regular indexes are created by the app itself on first connection.
 */
import { MongoClient } from "mongodb";
import { readServerEnv } from "../src/lib/env.ts";
import {
  ensureTextIndex,
  ensureVectorIndex,
  TEXT_INDEX_NAME,
  VECTOR_INDEX_NAME,
  waitUntilQueryable,
} from "../src/lib/db/search-index.ts";

const env = readServerEnv();
const client = await MongoClient.connect(env.mongodbUri, { appName: "documind-scripts" });

try {
  const db = client.db(env.mongodbDb);
  const result = await ensureVectorIndex(db, env.embeddingDimensions);

  if (result.status === "mismatch") {
    console.error(
      `Index "${VECTOR_INDEX_NAME}" exists with ${String(result.existingDimensions)} dimensions, ` +
        `but EMBEDDING_DIMENSIONS is ${env.embeddingDimensions}. Drop it in Atlas and re-embed to change it.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Index "${VECTOR_INDEX_NAME}": ${result.status} (${env.embeddingDimensions} dimensions, cosine).`);
    const text = await ensureTextIndex(db);
    console.log(`Index "${TEXT_INDEX_NAME}": ${text.status} (keyword search, English analyzer).`);
    console.log("Waiting until both are queryable...");
    const ready = await waitUntilQueryable(db);
    console.log(ready ? "Queryable." : "Still building after 2 minutes; check Atlas → Search & Vector Search.");
    if (!ready) process.exitCode = 1;
  }
} finally {
  await client.close();
}
