import { isDatabaseUnavailable } from "@/lib/db/client";

/** The error shape every route returns: `{ error: { code, message, ...extra } }`. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, string | number> = {},
  headers?: HeadersInit,
) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers });
}

/** 429 for a used-up provider quota, with the wait in the body and in Retry-After. */
export function rateLimited(message: string, retryAfterSeconds: number, extra: Record<string, number> = {}) {
  return errorResponse(429, "rate_limited", message, { retryAfterSeconds, ...extra }, { "Retry-After": String(retryAfterSeconds) });
}

export const unauthorized = (message = "Sign in to continue.") => errorResponse(401, "unauthorized", message);

/** Runs a handler and turns "can't reach MongoDB" into a 503 instead of a hang or a bare 500. */
export async function withDatabaseErrors(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (cause) {
    if (isDatabaseUnavailable(cause)) {
      return errorResponse(503, "database_unavailable", "The database is unavailable right now. Please try again in a minute.");
    }
    throw cause;
  }
}

/** True for the 24-hex-character form of an ObjectId (ObjectId.isValid also accepts other shapes). */
export function isObjectIdHex(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{24}$/i.test(value);
}
