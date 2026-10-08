import Link from "next/link";
import { auth, signOut } from "@/auth";

/** App name, and who is signed in with a sign-out button. */
export async function SiteHeader() {
  const session = await auth();
  const user = session?.user?.id ? session.user : null;

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="font-semibold tracking-tight">
          DocuMind
        </Link>
        {user && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">{user.name ?? user.email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
