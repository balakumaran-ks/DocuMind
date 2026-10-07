import { MongoClient, MongoNetworkError, MongoServerSelectionError, type Db, type MongoClientOptions } from "mongodb";
import { readServerEnv } from "@/lib/env";
import { ensureChunkIndexes } from "./chunks";
import { ensureIndexes } from "./documents";

/** How long to look for a reachable server before failing (the driver's default is 30 s). */
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5_000;

/** The database can't be reached right now (network, IP allowlist, or cluster down). */
export class DatabaseUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The database is unavailable right now. Please try again in a minute.", options);
    this.name = "DatabaseUnavailableError";
  }
}

/** True for errors that mean "can't reach MongoDB", as opposed to a bad query. */
export function isDatabaseUnavailable(error: unknown): boolean {
  return (
    error instanceof DatabaseUnavailableError ||
    error instanceof MongoServerSelectionError ||
    error instanceof MongoNetworkError
  );
}

/**
 * Client options for a connection string. A timeout set in the connection
 * string wins, so it stays the one place to tune it.
 */
export function connectionOptions(uri: string): MongoClientOptions {
  const setInUri = /[?&]serverSelectionTimeoutMS=/i.test(uri);
  return {
    appName: "documind",
    ...(setInUri ? {} : { serverSelectionTimeoutMS: DEFAULT_SERVER_SELECTION_TIMEOUT_MS }),
  };
}

type Connection = { client: MongoClient; db: Db };

// Kept on globalThis so hot reloads in development reuse one connection pool
// instead of opening a new one on every edit.
const cache = globalThis as typeof globalThis & { __documindDb?: Promise<Connection> };

async function connect(): Promise<Connection> {
  const env = readServerEnv();
  let client: MongoClient;
  try {
    client = await MongoClient.connect(env.mongodbUri, connectionOptions(env.mongodbUri));
  } catch (cause) {
    throw isDatabaseUnavailable(cause) ? new DatabaseUnavailableError({ cause }) : cause;
  }
  const db = client.db(env.mongodbDb);
  await ensureIndexes(db);
  await ensureChunkIndexes(db);
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
