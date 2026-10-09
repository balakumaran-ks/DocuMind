import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { LIMITS } from "@/lib/limits";
import { REFUSAL } from "@/lib/rag/prompt";
import { ChatView, type ChatMessage } from "./chat-view";

const DOC = { id: "6ac68534ae92936b3b5a0515", filename: "handbook.pdf", pageCount: 12 };
const CHAT_ID = "6ac7025ed3d5f6ed7fd8be94";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A streamed text response whose chunks the test releases one at a time. */
function controlledStream(chatId = CHAT_ID) {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "x-chat-id": chatId } }),
    push: (text: string) => controller?.enqueue(encoder.encode(text)),
    end: () => controller?.close(),
    fail: () => controller?.error(new TypeError("network error")),
  };
}

const savedMessages = (question: string, answer: string, pages: number[]) =>
  json(200, {
    chat: { id: CHAT_ID, documentId: DOC.id, title: question },
    messages: [
      { id: "m1", role: "user", content: question, citations: [], createdAt: "2026-10-09T10:00:00.000Z" },
      {
        id: "m2",
        role: "assistant",
        content: answer,
        citations: pages.map((pageNumber) => ({ pageNumber, chunkId: `c${pageNumber}` })),
        createdAt: "2026-10-09T10:00:01.000Z",
      },
    ],
  });

let fetchMock: Mock<typeof fetch>;
/** Requests to /api/ask, with their parsed JSON bodies. */
const askBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === "/api/ask")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(initialMessages: ChatMessage[] = [], initialChatId: string | null = null) {
  render(<ChatView document={DOC} initialChatId={initialChatId} initialMessages={initialMessages} />);
  const user = userEvent.setup();
  const box = () => screen.getByRole("textbox", { name: /your question/i }) as HTMLTextAreaElement;
  const askButton = () => screen.getByRole("button", { name: /^ask$/i }) as HTMLButtonElement;
  return { user, box, askButton };
}

/** Routes fetch by URL: the ask stream, the saved messages, and page text. */
function routeFetch(ask: () => Response | Promise<Response>, saved: () => Response) {
  fetchMock.mockImplementation(async (url) => {
    const path = String(url);
    if (path === "/api/ask") return ask();
    if (path.startsWith("/api/chats/")) return saved();
    if (path.includes("/pages/")) return json(200, { pageNumber: 2, pageCount: 12, text: "Fees are due monthly.", isEmpty: false });
    throw new Error(`unexpected fetch ${path}`);
  });
}

describe("ChatView — history and empty state", () => {
  it("shows a deliberate empty state for a new chat", () => {
    setup();
    expect(screen.getByText(/ask anything about handbook\.pdf/i)).toBeTruthy();
  });

  it("shows earlier messages, with validated citations as buttons", () => {
    setup(
      [
        { id: "m1", role: "user", content: "When are fees due?", citations: [] },
        { id: "m2", role: "assistant", content: "Monthly [p. 2].", citations: [{ pageNumber: 2, chunkId: "c2" }] },
      ],
      CHAT_ID,
    );
    expect(screen.getByText("When are fees due?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open page 2" })).toBeTruthy();
    expect(screen.queryByText(/ask anything about/i)).toBeNull();
  });
});

describe("ChatView — asking", () => {
  it("shows the question at once, streams the answer, then shows its validated citations", async () => {
    const stream = controlledStream();
    routeFetch(() => stream.response, () => savedMessages("When are fees due?", "Monthly [p. 2].", [2]));
    const { user, box } = setup();

    await user.type(box(), "When are fees due?");
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    expect(screen.getByText("When are fees due?")).toBeTruthy();
    expect(box().value).toBe("");
    expect(await screen.findByText(/searching the document/i)).toBeTruthy();
    expect(askBodies()).toEqual([{ documentId: DOC.id, question: "When are fees due?" }]);

    stream.push("Monthly ");
    expect(await screen.findByText(/^Monthly/)).toBeTruthy();
    expect(screen.queryByText(/searching the document/i)).toBeNull();

    stream.push("[p. 2].");
    stream.end();

    expect(await screen.findByRole("button", { name: "Open page 2" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/chats/${CHAT_ID}/messages`);
  });

  it("continues the same chat: follow-ups send the chat id from the first answer", async () => {
    routeFetch(
      () => {
        const stream = controlledStream();
        stream.push("Monthly [p. 2].");
        stream.end();
        return stream.response;
      },
      () => savedMessages("q", "Monthly [p. 2].", [2]),
    );
    const { user, box } = setup();

    await user.type(box(), "When are fees due?{Enter}");
    await screen.findByRole("button", { name: "Open page 2" });
    await user.type(box(), "And late fees?{Enter}");

    await waitFor(() => expect(askBodies()).toHaveLength(2));
    expect(askBodies()[1]).toEqual({ documentId: DOC.id, chatId: CHAT_ID, question: "And late fees?" });
  });

  it("sends the existing chat id when continuing a reopened chat", async () => {
    routeFetch(() => new Promise<Response>(() => {}), () => json(500, {}));
    const { user, box } = setup([{ id: "m1", role: "user", content: "Earlier?", citations: [] }], CHAT_ID);

    await user.type(box(), "Next?{Enter}");
    await waitFor(() => expect(askBodies()).toEqual([{ documentId: DOC.id, chatId: CHAT_ID, question: "Next?" }]));
  });

  it("shows a refusal as 'Not in this document'", async () => {
    routeFetch(
      () => {
        const stream = controlledStream();
        stream.push(REFUSAL);
        stream.end();
        return stream.response;
      },
      () => savedMessages("Who is the CEO?", REFUSAL, []),
    );
    const { user, box } = setup();
    await user.type(box(), "Who is the CEO?{Enter}");

    expect(await screen.findByText("Not in this document")).toBeTruthy();
  });

  it("opens the cited page in the side panel, and closes it", async () => {
    routeFetch(() => json(500, {}), () => json(500, {}));
    const { user } = setup(
      [{ id: "m2", role: "assistant", content: "Monthly [p. 2].", citations: [{ pageNumber: 2, chunkId: "c2" }] }],
      CHAT_ID,
    );

    await user.click(screen.getByRole("button", { name: "Open page 2" }));
    expect(await screen.findByText("Fees are due monthly.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/documents/${DOC.id}/pages/2`);

    await user.click(screen.getByRole("button", { name: /close page/i }));
    expect(screen.queryByText("Fees are due monthly.")).toBeNull();
  });

  it("starts a new chat: clears the messages and stops sending the old chat id", async () => {
    routeFetch(() => new Promise<Response>(() => {}), () => json(500, {}));
    const { user, box } = setup([{ id: "m1", role: "user", content: "Earlier?", citations: [] }], CHAT_ID);

    await user.click(screen.getByRole("button", { name: /new chat/i }));
    expect(screen.queryByText("Earlier?")).toBeNull();
    expect(screen.getByText(/ask anything about/i)).toBeTruthy();

    await user.type(box(), "Fresh start?{Enter}");
    await waitFor(() => expect(askBodies()).toEqual([{ documentId: DOC.id, question: "Fresh start?" }]));
  });
});

describe("ChatView — input", () => {
  it("can't send a blank question", async () => {
    const { user, box, askButton } = setup();
    expect(askButton().disabled).toBe(true);
    await user.type(box(), "   {Enter}");
    expect(askButton().disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds a new line with Shift+Enter instead of sending", async () => {
    const { user, box } = setup();
    await user.type(box(), "Line one{Shift>}{Enter}{/Shift}Line two");
    expect(box().value).toBe("Line one\nLine two");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it(`shows a counter and blocks questions over ${LIMITS.maxQuestionChars} characters`, async () => {
    const { user, box, askButton } = setup();
    await user.click(box());
    await user.paste("a".repeat(LIMITS.maxQuestionChars + 1));

    expect(screen.getByText(`${LIMITS.maxQuestionChars + 1} / ${LIMITS.maxQuestionChars}`)).toBeTruthy();
    expect(askButton().disabled).toBe(true);
  });

  it("disables asking while an answer is on its way", async () => {
    routeFetch(() => new Promise<Response>(() => {}), () => json(500, {}));
    const { user, box, askButton } = setup();
    await user.type(box(), "First?{Enter}");
    await user.type(box(), "Second?");

    expect(askButton().disabled).toBe(true);
  });
});

describe("ChatView — errors", () => {
  it("shows the server's message (e.g. the daily limit) and puts the question back", async () => {
    const message = "You've reached the daily limit of 50 questions. It resets at midnight UTC.";
    routeFetch(() => json(429, { error: { code: "daily_limit_reached", message } }), () => json(500, {}));
    const { user, box } = setup();

    await user.type(box(), "One more?{Enter}");

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(box().value).toBe("One more?");
    expect(screen.queryByText(/searching the document/i)).toBeNull();
    expect(screen.getByText(/ask anything about/i)).toBeTruthy();
  });

  it("explains a network failure and puts the question back", async () => {
    routeFetch(() => Promise.reject(new TypeError("Failed to fetch")), () => json(500, {}));
    const { user, box } = setup();
    await user.type(box(), "Hello?{Enter}");

    expect((await screen.findByRole("alert")).textContent).toMatch(/didn't reach the server/i);
    expect(box().value).toBe("Hello?");
  });

  it("keeps a partial answer and says so when the stream breaks", async () => {
    const stream = controlledStream();
    routeFetch(() => stream.response, () => json(500, {}));
    const { user, box } = setup();
    await user.type(box(), "When are fees due?{Enter}");

    stream.push("Fees are due");
    await screen.findByText(/Fees are due/);
    stream.fail();

    expect((await screen.findByRole("alert")).textContent).toMatch(/interrupted/i);
    expect(screen.getByText(/Fees are due/)).toBeTruthy();
  });

  it("keeps the streamed answer as plain text when its citations can't be loaded", async () => {
    routeFetch(
      () => {
        const stream = controlledStream();
        stream.push("Monthly [p. 2].");
        stream.end();
        return stream.response;
      },
      () => json(503, { error: { code: "database_unavailable", message: "down" } }),
    );
    const { user, box } = setup();
    await user.type(box(), "When are fees due?{Enter}");

    expect(await screen.findByText("Monthly [p. 2].")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/chats/${CHAT_ID}/messages`));
    expect(screen.queryByRole("button", { name: /open page/i })).toBeNull();
  });
});
