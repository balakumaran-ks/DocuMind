import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUserId } from "@/lib/auth/user";
import { listChats, listMessages } from "@/lib/db/chats";
import { getDb } from "@/lib/db/client";
import { getDocument } from "@/lib/db/documents";
import { ChatView, type ChatMessage } from "./chat-view";

/** Chat with one document. Reopening it shows its most recent chat. */
export default async function DocumentPage(props: PageProps<"/documents/[id]">) {
  const { id } = await props.params;
  const userId = await getUserId();
  if (!userId) redirect("/");

  const db = await getDb();
  const document = await getDocument(db, userId, id);
  if (!document) notFound();

  const back = (
    <Link href="/documents" className="text-sm text-zinc-600 hover:text-indigo-600 dark:text-zinc-400">
      ← Your documents
    </Link>
  );

  if (document.status !== "ready") {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-12">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">{document.filename}</h1>
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          {document.status === "failed"
            ? "Indexing this document failed, so it can't be asked about. Delete it and upload it again."
            : "This document isn't fully indexed yet. Indexing continues from your document list, where you can resume it."}
        </p>
      </main>
    );
  }

  const [latest] = await listChats(db, userId, document._id);
  const messages: ChatMessage[] = latest
    ? (await listMessages(db, userId, latest._id)).map((message) => ({
        id: message._id.toHexString(),
        role: message.role,
        content: message.content,
        citations: (message.citations ?? []).map((c) => ({ pageNumber: c.pageNumber, chunkId: c.chunkId.toHexString() })),
      }))
    : [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-1">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">{document.filename}</h1>
        <p className="text-sm text-zinc-500">{document.pageCount} pages</p>
      </div>
      <ChatView
        document={{ id: document._id.toHexString(), filename: document.filename, pageCount: document.pageCount }}
        initialChatId={latest ? latest._id.toHexString() : null}
        initialMessages={messages}
      />
    </main>
  );
}
