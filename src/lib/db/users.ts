import type { Db } from "mongodb";

/** A signed-in person, keyed by the stable user id from `userIdFor`. */
export type StoredUser = {
  _id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  createdAt: Date;
  lastSignInAt: Date;
};

/** Records a sign-in: creates the user the first time, refreshes the profile after that. */
export async function upsertUser(
  db: Db,
  input: { userId: string; email: string | null; name: string | null; image: string | null },
): Promise<void> {
  const now = new Date();
  await db.collection<StoredUser>("users").updateOne(
    { _id: input.userId },
    {
      $set: { email: input.email, name: input.name, image: input.image, lastSignInAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}
