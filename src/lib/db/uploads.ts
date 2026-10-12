import { MongoServerError, type Db } from "mongodb";
import { startOfUtcDay } from "./chats";

/** One user's uploads on one UTC day; `_id` is `<userId>:<YYYY-MM-DD>`. */
type UploadCount = { _id: string; userId: string; count: number; expiresAt: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const counts = (db: Db) => db.collection<UploadCount>("uploadCounts");

/** Old days' counters remove themselves. Idempotent. */
export async function ensureUploadIndexes(db: Db): Promise<void> {
  await counts(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

/**
 * Counts one upload against the user's cap for today and returns true, or
 * returns false if `cap` uploads were already counted. Atomic: the increment
 * only matches while the count is below the cap, and since the id is unique
 * per user and day, two first uploads of the day can't create two counters.
 */
export async function reserveUpload(db: Db, userId: string, now: Date, cap: number): Promise<boolean> {
  const day = startOfUtcDay(now);
  try {
    await counts(db).updateOne(
      { _id: `${userId}:${day.toISOString().slice(0, 10)}`, userId, count: { $lt: cap } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(day.getTime() + 2 * DAY_MS) } },
      { upsert: true },
    );
    return true;
  } catch (cause) {
    // At the cap the filter matches nothing, so the upsert tries to insert the same id again.
    if (cause instanceof MongoServerError && cause.code === 11000) return false;
    throw cause;
  }
}
