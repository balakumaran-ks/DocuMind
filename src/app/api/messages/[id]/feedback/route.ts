import { z } from "zod";
import { errorResponse, unauthorized, withDatabaseErrors } from "@/lib/api/responses";
import { getUserId } from "@/lib/auth/user";
import { setFeedback } from "@/lib/db/chats";
import { getDb } from "@/lib/db/client";

const FeedbackBody = z.object({ rating: z.enum(["up", "down"]).nullable() });

/** Rates one of the user's answers (`up` or `down`), or clears the rating with `null`. */
export async function POST(request: Request, ctx: RouteContext<"/api/messages/[id]/feedback">) {
  return withDatabaseErrors(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized("Sign in to rate answers.");

    const body = FeedbackBody.safeParse(await request.json().catch(() => undefined));
    if (!body.success) return errorResponse(400, "invalid_request", 'Send a rating: "up", "down" or null.');

    const { id } = await ctx.params;
    const db = await getDb();
    if (!(await setFeedback(db, userId, id, body.data.rating))) {
      return errorResponse(404, "message_not_found", "That answer doesn't exist.");
    }
    return Response.json({ rating: body.data.rating });
  });
}
