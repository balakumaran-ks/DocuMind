/**
 * Typed access to server environment variables.
 *
 * Validation is lazy (called from the code that needs a variable) so that
 * `next build` and unit tests work without secrets, while a misconfigured
 * deployment fails loudly on the first request instead of deep inside a
 * database or model call.
 */

export type ServerEnv = {
  mongodbUri: string;
  mongodbDb: string;
  googleApiKey: string;
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  authSecret: string;
  authGoogleId: string;
  authGoogleSecret: string;
};

const REQUIRED = [
  "MONGODB_URI",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
] as const;

export const ENV_DEFAULTS = {
  MONGODB_DB: "documind",
  GEMINI_CHAT_MODEL: "gemini-3.5-flash",
  GEMINI_EMBEDDING_MODEL: "gemini-embedding-2",
  EMBEDDING_DIMENSIONS: "768",
} as const;

export class EnvError extends Error {
  constructor(readonly missing: string[], message?: string) {
    super(message ?? `Missing required environment variables: ${missing.join(", ")}`);
    this.name = "EnvError";
  }
}

type Source = Record<string, string | undefined>;

export function readServerEnv(source: Source = process.env): ServerEnv {
  const value = (key: string) => source[key]?.trim() || undefined;

  const missing = REQUIRED.filter((key) => !value(key));
  if (missing.length > 0) throw new EnvError([...missing]);

  const dimensionsRaw = value("EMBEDDING_DIMENSIONS") ?? ENV_DEFAULTS.EMBEDDING_DIMENSIONS;
  const embeddingDimensions = Number(dimensionsRaw);
  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions < 128 || embeddingDimensions > 3072) {
    throw new EnvError(
      [],
      `EMBEDDING_DIMENSIONS must be an integer between 128 and 3072, got "${dimensionsRaw}"`,
    );
  }

  return {
    mongodbUri: value("MONGODB_URI")!,
    mongodbDb: value("MONGODB_DB") ?? ENV_DEFAULTS.MONGODB_DB,
    googleApiKey: value("GOOGLE_GENERATIVE_AI_API_KEY")!,
    chatModel: value("GEMINI_CHAT_MODEL") ?? ENV_DEFAULTS.GEMINI_CHAT_MODEL,
    embeddingModel: value("GEMINI_EMBEDDING_MODEL") ?? ENV_DEFAULTS.GEMINI_EMBEDDING_MODEL,
    embeddingDimensions,
    authSecret: value("AUTH_SECRET")!,
    authGoogleId: value("AUTH_GOOGLE_ID")!,
    authGoogleSecret: value("AUTH_GOOGLE_SECRET")!,
  };
}

/** Names of required variables that are unset, for the health check. Never returns values. */
export function missingServerEnv(source: Source = process.env): string[] {
  return REQUIRED.filter((key) => !source[key]?.trim());
}
