import { MongoMemoryServer } from "mongodb-memory-server";
import { vi } from "vitest";

/**
 * A throwaway MongoDB for one test file. Real database behaviour (indexes,
 * filters, unique constraints) without touching Atlas.
 */
export async function startMongo(): Promise<MongoMemoryServer> {
  return MongoMemoryServer.create();
}

/** Every required variable, pointed at the in-memory server. Values are fake except the URI. */
export function stubServerEnv(uri: string, dbName: string) {
  vi.stubEnv("MONGODB_URI", uri);
  vi.stubEnv("MONGODB_DB", dbName);
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("AUTH_GOOGLE_ID", "test-client-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "test-client-secret");
}
