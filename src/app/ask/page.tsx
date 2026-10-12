import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth/user";
import { toChatMessage } from "@/lib/chat/message";
import { latestChatAcross, listMessages } from "@/lib/db/chats";
import { getDb } from "@/lib/db/client";
import { listDocuments } from "@/lib/db/documents";
import { AskAcross } from "./ask-across";

export const metadata: Metadata = { title: "Ask across documents · DocuMind" };

/** Ask one question across several of the user's documents. Reopens the latest such chat. */
export default async function AskAcrossPage() {
  const userId = await getUserId();
  if (!userId) redirect("/");

  const db = await getDb();
  const ready = (await listDocuments(db, userId))
    .filter((document) => document.status === "ready")
    .map((document) => ({ id: document._id.toHexString(), filename: document.filename, pageCount: document.pageCount }));

  const back = (
    <Link href="/documents" className="text-sm text-zinc-600 hover:text-indigo-600 dark:text-zinc-400">
      ← Your documents
    </Link>
  );

  if (ready.length < 2) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-12">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">Ask across documents</h1>
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          Asking across documents needs at least two ready documents. Upload another one from your document list.
        </p>
      </main>
    );
  }

  const chat = await latestChatAcross(db, userId);
  const chatDocumentIds = chat?.documentIds?.map((id) => id.toHexString()) ?? [];
  // A chat whose documents are all still ready can be reopened; deleting a document deletes its chats anyway.
  const initialChat =
    chat && chatDocumentIds.every((id) => ready.some((document) => document.id === id))
      ? { id: chat._id.toHexString(), documentIds: chatDocumentIds, messages: (await listMessages(db, userId, chat._id)).map(toChatMessage) }
      : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-1">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">Ask across documents</h1>
        <p className="text-sm text-zinc-500">Answers cite each document by its letter and page.</p>
      </div>
      <AskAcross documents={ready} initialChat={initialChat} />
    </main>
  );
}
