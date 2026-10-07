import { notFound } from "next/navigation";
import { getUserId } from "@/lib/auth/user";
import { getDb } from "@/lib/db/client";
import { getDocumentWithPages } from "@/lib/db/documents";
import { formatBytes } from "@/lib/limits";

/** Temporary viewer for extracted text; replaced by the chat UI in task 005. */
export default async function DocumentPage(props: PageProps<"/documents/[id]">) {
  const { id } = await props.params;
  const userId = await getUserId();
  if (!userId) notFound();

  const result = await getDocumentWithPages(await getDb(), userId, id);
  if (!result) notFound();
  const { document, pages } = result;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{document.filename}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {document.pageCount} pages &middot; {formatBytes(document.sizeBytes)} &middot; {document.status}
      </p>
      <ol className="mt-10 flex flex-col gap-8">
        {pages.map((page) => (
          <li key={page.pageNumber}>
            <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">Page {page.pageNumber}</h2>
            {page.isEmpty ? (
              <p className="mt-2 text-sm italic text-amber-600">No text on this page (it may be a scan).</p>
            ) : (
              <p className="mt-2 whitespace-pre-wrap leading-7">{page.text}</p>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
