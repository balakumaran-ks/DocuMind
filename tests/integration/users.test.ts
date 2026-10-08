import { MongoClient, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { upsertUser } from "@/lib/db/users";
import { startMongo } from "./helpers/mongo";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db("documind_users_test");
});

beforeEach(async () => {
  await db.collection("users").deleteMany({});
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

const ada = { userId: "google:1", email: "ada@example.com", name: "Ada", image: "https://example.com/ada.png" };

describe("upsertUser", () => {
  it("creates the user on first sign-in, keyed by the stable user id", async () => {
    await upsertUser(db, ada);
    expect(await db.collection("users").find({}).toArray()).toEqual([
      {
        _id: "google:1",
        email: "ada@example.com",
        name: "Ada",
        image: "https://example.com/ada.png",
        createdAt: expect.any(Date),
        lastSignInAt: expect.any(Date),
      },
    ]);
  });

  it("updates the profile and sign-in time on later sign-ins, keeping when the user was created", async () => {
    await upsertUser(db, ada);
    const first = await db.collection("users").findOne({ _id: "google:1" } as never);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await upsertUser(db, { ...ada, name: "Ada L." });

    const rows = await db.collection("users").find({}).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Ada L.", createdAt: first?.createdAt });
    expect(rows[0]?.lastSignInAt.getTime()).toBeGreaterThan(first?.lastSignInAt.getTime());
  });

  it("stores missing profile fields as null", async () => {
    await upsertUser(db, { userId: "google:2", email: null, name: null, image: null });
    expect(await db.collection("users").findOne({ _id: "google:2" } as never)).toMatchObject({
      email: null,
      name: null,
      image: null,
    });
  });

  it("keeps different users separate", async () => {
    await upsertUser(db, ada);
    await upsertUser(db, { ...ada, userId: "google:2", email: "grace@example.com" });
    expect(await db.collection("users").countDocuments()).toBe(2);
  });
});
