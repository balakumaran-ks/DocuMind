import type { Account, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

/**
 * The app's user id: provider plus the provider's own account id, e.g.
 * "google:1082…". Auth.js gives each sign-in a random id when there is no
 * user database, so ownership is keyed on this instead.
 */
export function userIdFor(account: Pick<Account, "provider" | "providerAccountId">): string {
  return `${account.provider}:${account.providerAccountId}`;
}

/** At sign-in (when `account` is set), stores the stable user id in the session token. */
export function jwtCallback({
  token,
  account,
}: {
  token: JWT;
  account?: Pick<Account, "provider" | "providerAccountId"> | null;
}): JWT {
  return account ? { ...token, userId: userIdFor(account) } : token;
}

/** Exposes the token's user id as `session.user.id`; without one, the session has no id and routes answer 401. */
export function sessionCallback({ session, token }: { session: Session; token: JWT }): Session {
  const userId = typeof token.userId === "string" && token.userId !== "" ? token.userId : undefined;
  if (!userId) return session;
  return { ...session, user: { ...session.user, id: userId } };
}

/** Pages that need a signed-in user. API routes check the session themselves and answer 401. */
export function isProtectedPath(pathname: string): boolean {
  return pathname === "/documents" || pathname.startsWith("/documents/");
}
