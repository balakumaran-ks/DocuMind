import Link from "next/link";
import { auth, signIn } from "@/auth";

const steps = [
  { title: "Upload a PDF", body: "Text is extracted page by page, chunked and embedded once." },
  { title: "Ask a question", body: "The closest passages are retrieved from your document only." },
  { title: "Check the source", body: "Every answer cites its page, or says it is not in the document." },
];

export default async function Home() {
  const session = await auth();
  const user = session?.user?.id ? session.user : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-24">
      <div className="flex flex-col gap-4">
        <span className="w-fit rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300">
          Setup phase complete &middot; MVP in progress
        </span>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">DocuMind</h1>
        <p className="max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Chat with your documents. Upload a PDF, ask questions, and get answers with
          page-level citations.
        </p>
        {user ? (
          <Link
            href="/documents"
            className="w-fit rounded-xl bg-indigo-600 px-5 py-3 font-medium text-white shadow-sm hover:bg-indigo-500"
          >
            Go to your documents
          </Link>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/documents" });
            }}
          >
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-5 py-3 font-medium text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Sign in with Google
            </button>
          </form>
        )}
      </div>
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400">
              0{i + 1}
            </span>
            <h2 className="mt-2 font-medium">{step.title}</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{step.body}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
