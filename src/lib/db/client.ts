import { MongoClient, type Db } from "mongodb";
import { readServerEnv } from "@/lib/env";
import { ensureIndexes } from "./documents";

type Connection = { client: MongoClient; db: Db };

// Kept on globalThis so hot reloads in development reuse one connection pool
// instead of opening a new one on every edit.
const cache = globalThis as typeof globalThis & { __documindDb?: Promise<Connection> };

async function connect(): Promise<Connection> {
  const env = readServerEnv();
  const client = await MongoClient.connect(env.mongodbUri, { appName: "documind" });
  const db = client.db(env.mongodbDb);
  await ensureIndexes(db);
  return { client, db };
}

/** The app's database. Connects (and ensures indexes) once per process. */
export async function getDb(): Promise<Db> {
  if (!cache.__documindDb) {
    cache.__documindDb = connect().catch((error: unknown) => {
      // Don't cache a failure: the next request should retry.
      cache.__documindDb = undefined;
      throw error;
    });
  }
  return (await cache.__documindDb).db;
}

/** Closes the shared connection; the next getDb() opens a new one. For tests and scripts. */
export async function closeDb(): Promise<void> {
  const pending = cache.__documindDb;
  cache.__documindDb = undefined;
  if (pending) await (await pending.catch(() => undefined))?.client.close();
}
