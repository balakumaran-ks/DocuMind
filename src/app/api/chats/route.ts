import { errorResponse, isObjectIdHex, unauthorized, withDatabaseErrors } from "@/lib/api/responses";
import { getUserId } from "@/lib/auth/user";
import { listChats } from "@/lib/db/chats";
import { getDb } from "@/lib/db/client";
import { getDocument } from "@/lib/db/documents";

/** The chats about one of the user's documents (`?documentId=`), most recently active first. */
export async function GET(request: Request) {
  return withDatabaseErrors(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized("Sign in to see your chats.");

    const documentId = new URL(request.url).searchParams.get("documentId");
    if (!isObjectIdHex(documentId)) return errorResponse(400, "invalid_request", "Pass a documentId.");

    const db = await getDb();
    const document = await getDocument(db, userId, documentId);
    if (!document) return errorResponse(404, "document_not_found", "That document doesn't exist.");

    const rows = await listChats(db, userId, document._id);
    return Response.json({
      chats: rows.map((chat) => ({
        id: chat._id.toHexString(),
        title: chat.title,
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
      })),
    });
  });
}
