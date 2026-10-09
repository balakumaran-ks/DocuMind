import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth/user";
import { getDb } from "@/lib/db/client";
import { listDocuments } from "@/lib/db/documents";
import { toDocumentSummary } from "@/lib/documents/summary";
import { DocumentLibrary } from "./document-library";

export const metadata: Metadata = { title: "Your documents · DocuMind" };

/** The signed-in user's document library. */
export default async function DocumentsPage() {
  const userId = await getUserId();
  if (!userId) redirect("/");

  const documents = (await listDocuments(await getDb(), userId)).map(toDocumentSummary);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Your documents</h1>
      <DocumentLibrary initialDocuments={documents} />
    </main>
  );
}
