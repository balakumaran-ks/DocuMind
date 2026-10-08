import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

/**
 * A language model that never calls a network service. It streams `state.reply`
 * word by word and reports `state.usage`; set `failWith` to make the call fail.
 * `model.doStreamCalls` records every prompt it was sent.
 */
export function fakeAnswerModel() {
  const state = {
    reply: "Fees are due monthly [p. 2].",
    usage: { inputTokens: 120, outputTokens: 15 },
    failWith: null as Error | null,
  };

  const model = new MockLanguageModelV4({
    doStream: async () => {
      if (state.failWith) throw state.failWith;
      const words = state.reply.match(/\S+\s*/g) ?? [];
      return {
        stream: simulateReadableStream({
          initialDelayInMs: null,
          chunkDelayInMs: null,
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "t1" },
            ...words.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
            { type: "text-end" as const, id: "t1" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: "STOP" },
              usage: {
                inputTokens: { total: state.usage.inputTokens, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: state.usage.outputTokens, text: undefined, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  });

  /** The prompt of the n-th call as plain role/text pairs, system message first. */
  function sentPrompt(n = 0): { role: string; text: string }[] {
    const call = model.doStreamCalls[n];
    if (!call) throw new Error(`the model was called ${model.doStreamCalls.length} times`);
    return call.prompt.map((message) => ({
      role: message.role,
      text:
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
    }));
  }

  return { model, state, sentPrompt };
}
