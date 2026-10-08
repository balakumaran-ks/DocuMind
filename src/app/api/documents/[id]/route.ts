import { errorResponse, unauthorized, withDatabaseErrors } from "@/lib/api/responses";
import { getUserId } from "@/lib/auth/user";
import { getDb } from "@/lib/db/client";
import { deleteDocument } from "@/lib/db/documents";

/** Delete one of the user's documents with its pages, chunks, chats and messages. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  return withDatabaseErrors(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized("Sign in to delete documents.");

    const { id } = await ctx.params;
    if (!(await deleteDocument(await getDb(), userId, id))) {
      return errorResponse(404, "document_not_found", "That document doesn't exist.");
    }
    return new Response(null, { status: 204 });
  });
}
