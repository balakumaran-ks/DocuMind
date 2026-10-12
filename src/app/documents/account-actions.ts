"use server";

import { signOut } from "@/auth";
import { getUserId } from "@/lib/auth/user";
import { deleteAccount } from "@/lib/db/account";
import { getDb } from "@/lib/db/client";

/** Deletes the signed-in user's account and all their data, then signs them out. */
export async function deleteAccountAction(): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;
  await deleteAccount(await getDb(), userId);
  await signOut({ redirectTo: "/" });
}
