import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, connectionOptions, DatabaseUnavailableError, getDb } from "@/lib/db/client";
import { EnvError } from "@/lib/env";
import { startMongo, stubServerEnv } from "./helpers/mongo";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await startMongo();
});

afterEach(async () => {
  await closeDb();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await mongo.stop();
});

describe("getDb", () => {
  it("connects to the database named by MONGODB_DB", async () => {
    stubServerEnv(mongo.getUri(), "documind_client_test");
    const db = await getDb();
    expect(db.databaseName).toBe("documind_client_test");
    await expect(db.command({ ping: 1 })).resolves.toMatchObject({ ok: 1 });
  });

  it("reuses one client across calls instead of opening a pool per request", async () => {
    stubServerEnv(mongo.getUri(), "documind_client_test");
    const [a, b] = await Promise.all([getDb(), getDb()]);
    expect(a).toBe(b);
  });

  it("opens a fresh connection after closeDb", async () => {
    stubServerEnv(mongo.getUri(), "documind_client_test");
    const first = await getDb();
    await closeDb();
    const second = await getDb();
    expect(second).not.toBe(first);
    await expect(second.command({ ping: 1 })).resolves.toMatchObject({ ok: 1 });
  });

  it("refuses to connect without configuration", async () => {
    stubServerEnv(mongo.getUri(), "documind_client_test");
    vi.stubEnv("MONGODB_URI", "");
    await expect(getDb()).rejects.toBeInstanceOf(EnvError);
  });

  it("fails fast with DatabaseUnavailableError when the server can't be reached", async () => {
    // Port 1 refuses connections; the URI shortens the timeout for the test.
    stubServerEnv("mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300", "documind_client_test");
    const started = Date.now();
    await expect(getDb()).rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("does not cache a failed connection; the next call retries", async () => {
    stubServerEnv("mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300", "documind_client_test");
    await expect(getDb()).rejects.toBeInstanceOf(DatabaseUnavailableError);

    stubServerEnv(mongo.getUri(), "documind_client_test");
    await expect((await getDb()).command({ ping: 1 })).resolves.toMatchObject({ ok: 1 });
  });
});

describe("connectionOptions", () => {
  it("gives up on server selection after a few seconds by default, not the driver's 30", () => {
    const { serverSelectionTimeoutMS } = connectionOptions("mongodb+srv://u:p@cluster0.example.mongodb.net/");
    expect(serverSelectionTimeoutMS).toBeGreaterThan(0);
    expect(serverSelectionTimeoutMS).toBeLessThanOrEqual(10_000);
  });

  it.each([
    "mongodb+srv://u:p@cluster0.example.mongodb.net/?serverSelectionTimeoutMS=20000",
    "mongodb://127.0.0.1:27017/?retryWrites=true&serverselectiontimeoutms=20000",
  ])("leaves the timeout to the connection string when it sets one: %s", (uri) => {
    expect(connectionOptions(uri).serverSelectionTimeoutMS).toBeUndefined();
  });
});
