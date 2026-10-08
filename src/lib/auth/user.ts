import { auth } from "@/auth";

/** The signed-in user's id from the session, or null when nobody is signed in. */
export async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id || null;
}
