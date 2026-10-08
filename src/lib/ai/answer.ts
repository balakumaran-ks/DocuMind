import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { readServerEnv } from "@/lib/env";

/** The model that writes answers: Gemini, named by GEMINI_CHAT_MODEL. Tests replace it with a mock. */
export function getAnswerModel(): LanguageModel {
  const env = readServerEnv();
  return createGoogle({ apiKey: env.googleApiKey }).languageModel(env.chatModel);
}
