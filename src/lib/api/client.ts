/** Shown when a response isn't the usual `{ error: { message } }` shape. */
export const GENERIC_ERROR = "Something went wrong. Please try again.";

/** The human-readable message from an API error response. */
export async function errorMessageFrom(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const { error } = body;
      if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
        return error.message;
      }
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return GENERIC_ERROR;
}
