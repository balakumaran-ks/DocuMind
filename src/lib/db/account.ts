import type { Db } from "mongodb";

/** The collections that hold a user's rows by `userId`, children before parents. */
const OWNED = ["messages", "chats", "chunks", "pages", "documents", "uploadCounts"] as const;

/**
 * Deletes everything a user has: messages, chats, chunks, pages, documents,
 * upload counters and finally the profile itself. Every delete filters by the
 * user's id, so no one else's data (sample templates included) is touched.
 */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  for (const name of OWNED) await db.collection(name).deleteMany({ userId });
  await db.collection<{ _id: string }>("users").deleteOne({ _id: userId });
}
