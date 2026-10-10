import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { readServerEnv } from "@/lib/env";

/** The model that writes answers: Gemini, named by GEMINI_CHAT_MODEL. Tests replace it with a mock. */
export function getAnswerModel(): LanguageModel {
  const env = readServerEnv();
  return createGoogle({ apiKey: env.googleApiKey }).languageModel(env.chatModel);
}

/**
 * The answer models in the order to try them: GEMINI_CHAT_MODEL, then
 * GEMINI_FALLBACK_CHAT_MODEL if set. Both use the same key; free-tier quotas
 * are counted per model, so the backup has its own allowance.
 */
export function getAnswerModels(): { name: string; model: LanguageModel }[] {
  const env = readServerEnv();
  const google = createGoogle({ apiKey: env.googleApiKey });
  const names = env.chatFallbackModel ? [env.chatModel, env.chatFallbackModel] : [env.chatModel];
  return names.map((name) => ({ name, model: google.languageModel(name) }));
}
