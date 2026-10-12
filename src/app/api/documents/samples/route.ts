import { z } from "zod";
import { getEmbedder } from "@/lib/ai/embed";
import { errorResponse, unauthorized, withDatabaseErrors } from "@/lib/api/responses";
import { getUserId } from "@/lib/auth/user";
import { startOfUtcDay } from "@/lib/db/chats";
import { getDb } from "@/lib/db/client";
import { countDocuments } from "@/lib/db/documents";
import { copySample, findSampleTemplate, hasSample } from "@/lib/db/samples";
import { reserveUpload } from "@/lib/db/uploads";
import { toDocumentSummary } from "@/lib/documents/summary";
import { LIMITS } from "@/lib/limits";
import { sampleByKey } from "@/lib/samples/catalog";

const SampleBody = z.object({ sample: z.string().refine((key) => sampleByKey(key) !== null) });

/**
 * Adds a sample document to the user's library: a copy of a pre-indexed
 * template, ready at once and costing no embedding quota. Counts as an upload.
 */
export async function POST(request: Request) {
  return withDatabaseErrors(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized("Sign in to add a sample document.");

    const body = SampleBody.safeParse(await request.json().catch(() => undefined));
    if (!body.success) return errorResponse(400, "invalid_request", "Choose one of the sample documents.");
    const { sample } = body.data;

    const db = await getDb();
    const template = await findSampleTemplate(db, sample, getEmbedder().model);
    if (!template) {
      return errorResponse(503, "sample_unavailable", "That sample isn't available right now. Upload a PDF instead.");
    }
    if (await hasSample(db, userId, sample)) {
      return errorResponse(409, "sample_already_added", "That sample is already in your library.");
    }
    if ((await countDocuments(db, userId)) >= LIMITS.maxDocumentsPerUser) {
      return errorResponse(
        409,
        "too_many_documents",
        `You can keep up to ${LIMITS.maxDocumentsPerUser} documents. Delete one to add another.`,
      );
    }
    const now = new Date();
    if (!(await reserveUpload(db, userId, now, LIMITS.maxUploadsPerDay))) {
      return errorResponse(
        429,
        "daily_upload_limit_reached",
        `You've reached the daily limit of ${LIMITS.maxUploadsPerDay} uploads. It resets at midnight UTC.`,
        { resetsAt: new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000).toISOString() },
      );
    }

    const document = await copySample(db, userId, template);
    return Response.json({ document: toDocumentSummary(document) }, { status: 201 });
  });
}
