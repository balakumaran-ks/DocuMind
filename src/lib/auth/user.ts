/** Owner of everything created before real sign-in exists (task 005). */
export const DEV_USER_ID = "dev-user";

/**
 * The signed-in user's id, or null when nobody is signed in.
 *
 * Until Auth.js is wired up this returns a fixed dev user in development and
 * test only. In production it returns null, so every protected route answers
 * 401: an early deploy fails closed instead of exposing one shared account.
 */
export async function getUserId(): Promise<string | null> {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test" ? DEV_USER_ID : null;
}
