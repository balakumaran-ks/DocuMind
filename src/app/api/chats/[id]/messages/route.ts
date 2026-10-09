import { errorResponse, unauthorized, withDatabaseErrors } from "@/lib/api/responses";
import { getUserId } from "@/lib/auth/user";
import { getChat, listMessages } from "@/lib/db/chats";
import { getDb } from "@/lib/db/client";

/** A chat's history, oldest first. Usage and latency stay on the server. */
export async function GET(_request: Request, ctx: RouteContext<"/api/chats/[id]/messages">) {
  return withDatabaseErrors(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized("Sign in to see your chats.");

    const { id } = await ctx.params;
    const db = await getDb();
    const chat = await getChat(db, userId, id);
    if (!chat) return errorResponse(404, "chat_not_found", "That chat doesn't exist.");

    const rows = await listMessages(db, userId, chat._id);
    return Response.json({
      chat: { id: chat._id.toHexString(), documentId: chat.documentId.toHexString(), title: chat.title },
      messages: rows.map((message) => ({
        id: message._id.toHexString(),
        role: message.role,
        content: message.content,
        citations: (message.citations ?? []).map((citation) => ({
          pageNumber: citation.pageNumber,
          chunkId: citation.chunkId.toHexString(),
        })),
        createdAt: message.createdAt.toISOString(),
      })),
    });
  });
}
