import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AskAcross } from "./ask-across";

const HANDBOOK = { id: "6ac68534ae92936b3b5a0515", filename: "handbook.pdf", pageCount: 12 };
const POLICY = { id: "6ac7025ed3d5f6ed7fd8be94", filename: "policy.pdf", pageCount: 8 };
const NOTES = { id: "6ac7025ed3d5f6ed7fd8be95", filename: "notes.pdf", pageCount: 3 };
const CHAT_ID = "6ac7025ed3d5f6ed7fd8be99";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const checkbox = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) }) as HTMLInputElement;
const askButton = () => screen.getByRole("button", { name: /^ask$/i }) as HTMLButtonElement;
const askBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === "/api/ask")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

describe("AskAcross", () => {
  it("picks every ready document by default, lettered in order", () => {
    render(<AskAcross documents={[HANDBOOK, POLICY, NOTES]} initialChat={null} />);

    expect([checkbox("handbook.pdf"), checkbox("policy.pdf"), checkbox("notes.pdf")].map((c) => c.checked)).toEqual([
      true,
      true,
      true,
    ]);
    expect(screen.getAllByTestId("document-letter").map((el) => el.textContent)).toEqual(["A", "B", "C"]);
  });

  it("asks across the picked documents only, re-lettering them", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    const user = userEvent.setup();
    render(<AskAcross documents={[HANDBOOK, POLICY, NOTES]} initialChat={null} />);

    await user.click(checkbox("policy.pdf"));
    expect(screen.getAllByTestId("document-letter").map((el) => el.textContent)).toEqual(["A", "B"]);
    await user.type(screen.getByRole("textbox", { name: /your question/i }), "When are fees due?{Enter}");

    await waitFor(() => expect(askBodies()).toEqual([{ documentIds: [HANDBOOK.id, NOTES.id], question: "When are fees due?" }]));
  });

  it("needs at least two documents", async () => {
    const user = userEvent.setup();
    render(<AskAcross documents={[HANDBOOK, POLICY]} initialChat={null} />);

    await user.click(checkbox("policy.pdf"));
    await user.type(screen.getByRole("textbox", { name: /your question/i }), "When are fees due?");

    expect(screen.getByText(/pick at least two documents/i)).toBeTruthy();
    expect(askButton().disabled).toBe(true);
  });

  it("reopens the latest chat with its own documents and messages, without the picker", () => {
    render(
      <AskAcross
        documents={[HANDBOOK, POLICY, NOTES]}
        initialChat={{
          id: CHAT_ID,
          documentIds: [NOTES.id, HANDBOOK.id],
          messages: [
            { id: "m1", role: "user", content: "What changed?", citations: [], rating: null },
            { id: "m2", role: "assistant", content: "Nothing [A p. 1].", citations: [], rating: null },
          ],
        }}
      />,
    );

    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.getByText("What changed?")).toBeTruthy();
    expect(screen.getAllByTestId("document-letter").map((el) => el.parentElement?.textContent)).toEqual([
      "Anotes.pdf",
      "Bhandbook.pdf",
    ]);
  });
});
