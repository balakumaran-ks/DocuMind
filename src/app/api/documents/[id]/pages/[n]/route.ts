import { errorResponse, unauthorized, withDatabaseErrors } from "@/lib/api/responses";
import { getUserId } from "@/lib/auth/user";
import { getDb } from "@/lib/db/client";
import { getDocument, getPage } from "@/lib/db/documents";

/** One page's text, for the citation panel. */
export async function GET(_request: Request, ctx: RouteContext<"/api/documents/[id]/pages/[n]">) {
  return withDatabaseErrors(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized("Sign in to read documents.");

    const { id, n } = await ctx.params;
    const db = await getDb();
    const document = await getDocument(db, userId, id);
    if (!document) return errorResponse(404, "document_not_found", "That document doesn't exist.");

    const pageNumber = /^[1-9]\d*$/.test(n) ? Number(n) : null;
    const page = pageNumber === null ? null : await getPage(db, userId, document._id, pageNumber);
    if (!page) return errorResponse(404, "page_not_found", `This document has pages 1 to ${document.pageCount}.`);

    return Response.json({
      pageNumber: page.pageNumber,
      pageCount: document.pageCount,
      text: page.text,
      isEmpty: page.isEmpty,
    });
  });
}
