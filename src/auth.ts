import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { jwtCallback, sessionCallback, userIdFor } from "@/lib/auth/callbacks";
import { getDb } from "@/lib/db/client";
import { upsertUser } from "@/lib/db/users";

/**
 * Google sign-in with a stateless JWT session cookie (D14). Auth.js reads
 * AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback,
  },
  events: {
    async signIn({ user, account }) {
      if (!account) return;
      // Recording the user is bookkeeping; a database outage must not block sign-in.
      try {
        await upsertUser(await getDb(), {
          userId: userIdFor(account),
          email: user.email ?? null,
          name: user.name ?? null,
          image: user.image ?? null,
        });
      } catch (cause) {
        console.error("Recording the sign-in failed", cause);
      }
    },
  },
});
