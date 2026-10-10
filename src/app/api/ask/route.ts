import { streamText, type TextStreamPart, type ToolSet } from "ai";
import { z } from "zod";
import { getAnswerModel } from "@/lib/ai/answer";
import { EmbeddingError, EmbeddingRateLimitError, getEmbedder } from "@/lib/ai/embed";
import { quotaMessage, quotaRetrySeconds } from "@/lib/ai/quota";
import { rateLimited } from "@/lib/api/responses";
import { getUserId } from "@/lib/auth/user";
import {
  countQuestionsSince,
  createChat,
  findChat,
  recentMessages,
  saveMessage,
  startOfUtcDay,
} from "@/lib/db/chats";
import { getDb, isDatabaseUnavailable } from "@/lib/db/client";
import { getDocument } from "@/lib/db/documents";
import { LIMITS } from "@/lib/limits";
import { parseCitations } from "@/lib/rag/citations";
import { buildPrompt } from "@/lib/rag/prompt";
import { retrieveChunks } from "@/lib/rag/retrieve";

// Embedding the question, searching and streaming the answer usually take a few seconds.
export const maxDuration = 60;

type ErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "question_too_long"
  | "document_not_found"
  | "document_not_ready"
  | "chat_not_found"
  | "daily_limit_reached"
  | "embedding_failed"
  | "answer_failed"
  | "database_unavailable";

function error(status: number, code: ErrorCode, message: string, extra: Record<string, string> = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

const objectId = z.string().regex(/^[0-9a-f]{24}$/i);
const AskBody = z.object({
  documentId: objectId,
  chatId: objectId.optional(),
  question: z.string().trim().min(1),
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ask a question about one document and stream a cited answer. Every check
 * runs before anything is written; the question is saved before the model
 * runs (so it counts toward the daily cap) and the answer when it finishes.
 */
export async function POST(request: Request) {
  try {
    return await handleAsk(request);
  } catch (cause) {
    if (isDatabaseUnavailable(cause)) {
      return error(503, "database_unavailable", "The database is unavailable right now. Please try again in a minute.");
    }
    throw cause;
  }
}

async function handleAsk(request: Request) {
  const started = Date.now();
  const userId = await getUserId();
  if (!userId) return error(401, "unauthorized", "Sign in to ask questions.");

  const body = AskBody.safeParse(await request.json().catch(() => undefined));
  if (!body.success) return error(400, "invalid_request", "Send a documentId and a non-empty question.");
  const { documentId, chatId, question } = body.data;
  if (question.length > LIMITS.maxQuestionChars) {
    return error(400, "question_too_long", `Questions can be up to ${LIMITS.maxQuestionChars} characters.`);
  }

  const db = await getDb();
  const document = await getDocument(db, userId, documentId);
  if (!document) return error(404, "document_not_found", "That document doesn't exist.");
  if (document.status !== "ready") {
    return error(409, "document_not_ready", "This document isn't ready for questions yet.");
  }

  const existingChat = chatId ? await findChat(db, userId, document._id, chatId) : null;
  if (chatId && !existingChat) return error(404, "chat_not_found", "That chat doesn't exist.");

  const today = startOfUtcDay(new Date(started));
  if ((await countQuestionsSince(db, userId, today)) >= LIMITS.maxQuestionsPerDay) {
    return error(
      429,
      "daily_limit_reached",
      `You've reached the daily limit of ${LIMITS.maxQuestionsPerDay} questions. It resets at midnight UTC.`,
      { resetsAt: new Date(today.getTime() + DAY_MS).toISOString() },
    );
  }

  let queryVector: number[];
  try {
    queryVector = await getEmbedder().embedQuery(question);
  } catch (cause) {
    if (cause instanceof EmbeddingRateLimitError) {
      return rateLimited(quotaMessage("questions", cause.retryAfterSeconds), cause.retryAfterSeconds);
    }
    if (cause instanceof EmbeddingError) {
      return error(502, "embedding_failed", "Your question couldn't be processed. Please try again in a minute.");
    }
    throw cause;
  }

  const chunks = await retrieveChunks({ db, userId, documentId: document._id, queryVector });
  const history = existingChat ? await recentMessages(db, userId, existingChat._id, LIMITS.historyMessages) : [];

  const prompt = buildPrompt({ question, chunks, history });
  const result = streamText({
    model: getAnswerModel(),
    instructions: prompt.system,
    messages: prompt.messages,
    onError: ({ error: cause }) => console.error("Answer generation failed", cause),
  });

  // Wait for the first piece of the answer, so a used-up quota or a model failure is still a
  // proper error response, and a question that was never answered isn't saved or counted.
  const parts = result.fullStream[Symbol.asyncIterator]();
  const first = await firstText(parts);
  if ("error" in first) {
    await parts.return?.();
    const wait = quotaRetrySeconds(first.error);
    if (wait !== null) return rateLimited(quotaMessage("questions", wait), wait);
    return error(502, "answer_failed", "The answer couldn't be generated. Please try again in a minute.");
  }

  const chat = existingChat ?? (await createChat(db, { userId, documentId: document._id, title: question }));
  await saveMessage(db, { chatId: chat._id, userId, role: "user", content: question });

  /** Saves the finished answer with what it was built from; a failure here mustn't break the stream. */
  const owner = userId;
  async function saveAnswer(text: string) {
    try {
      const usage = await result.totalUsage;
      await saveMessage(db, {
        chatId: chat._id,
        userId: owner,
        role: "assistant",
        content: text,
        citations: parseCitations(text, chunks),
        retrievedChunkIds: chunks.map((chunk) => chunk._id),
        latencyMs: Date.now() - started,
        usage: { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null },
      });
    } catch (cause) {
      console.error("Saving the answer failed", cause);
    }
  }

  const encoder = new TextEncoder();
  let text = first.text;
  const answer = new ReadableStream<Uint8Array>({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
    },
    // Each pull must enqueue, close or error: parts without text (step and finish markers) are skipped here,
    // because a pull that does none of those is never repeated and the response would stall.
    async pull(controller) {
      for (;;) {
        const { done, value } = await parts.next();
        if (done) {
          await saveAnswer(text);
          return controller.close();
        }
        if (value.type === "error") return controller.error(value.error);
        if (value.type === "text-delta" && value.text !== "") {
          text += value.text;
          return controller.enqueue(encoder.encode(value.text));
        }
      }
    },
    async cancel() {
      await parts.return?.();
    },
  });
  return new Response(answer, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Chat-Id": chat._id.toHexString() },
  });
}

type Parts = AsyncIterator<TextStreamPart<ToolSet>>;

/** Reads until the first text of the answer, or the error that came instead. */
async function firstText(parts: Parts): Promise<{ text: string } | { error: unknown }> {
  for (;;) {
    const { done, value } = await parts.next();
    if (done) return { text: "" };
    if (value.type === "error") return { error: value.error };
    if (value.type === "text-delta" && value.text !== "") return { text: value.text };
  }
}
