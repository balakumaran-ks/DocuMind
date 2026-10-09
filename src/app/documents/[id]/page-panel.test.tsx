import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { PagePanel } from "./page-panel";

const DOC_ID = "6ac68534ae92936b3b5a0515";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const page = (pageNumber: number, text = `Text of page ${pageNumber}.`) =>
  json(200, { pageNumber, pageCount: 12, text, isEmpty: text === "" });

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>((url) => {
    const n = Number(String(url).split("/").at(-1));
    return Promise.resolve(page(n));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(pageNumber: number) {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  const view = render(<PagePanel documentId={DOC_ID} pageNumber={pageNumber} onClose={onClose} onNavigate={onNavigate} />);
  return { onClose, onNavigate, user: userEvent.setup(), view };
}

describe("PagePanel", () => {
  it("loads the cited page and shows its text with its position in the document", async () => {
    setup(3);
    expect(screen.getByText(/loading page/i)).toBeTruthy();
    expect(await screen.findByText("Text of page 3.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Page 3 of 12" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/documents/${DOC_ID}/pages/3`);
  });

  it("loads the new page when the cited page changes", async () => {
    const { view, onClose, onNavigate } = setup(3);
    await screen.findByText("Text of page 3.");

    view.rerender(<PagePanel documentId={DOC_ID} pageNumber={5} onClose={onClose} onNavigate={onNavigate} />);
    expect(await screen.findByText("Text of page 5.")).toBeTruthy();
    expect(screen.queryByText("Text of page 3.")).toBeNull();
  });

  it("says so when a page has no text", async () => {
    fetchMock.mockResolvedValue(page(2, ""));
    setup(2);
    expect(await screen.findByText(/no text on this page/i)).toBeTruthy();
  });

  it("shows the server's message when the page can't be loaded", async () => {
    fetchMock.mockResolvedValue(
      json(404, { error: { code: "page_not_found", message: "This document has pages 1 to 12." } }),
    );
    setup(13);
    expect((await screen.findByRole("alert")).textContent).toBe("This document has pages 1 to 12.");
  });

  it("explains a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    setup(3);
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't load this page/i);
  });

  it("moves to the previous and next pages", async () => {
    const { user, onNavigate } = setup(3);
    await screen.findByText("Text of page 3.");

    await user.click(screen.getByRole("button", { name: /previous page/i }));
    await user.click(screen.getByRole("button", { name: /next page/i }));
    expect(onNavigate.mock.calls).toEqual([[2], [4]]);
  });

  it("disables previous on the first page and next on the last", async () => {
    setup(1);
    await screen.findByText("Text of page 1.");
    expect((screen.getByRole("button", { name: /previous page/i }) as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    setup(12);
    await screen.findByText("Text of page 12.");
    expect((screen.getByRole("button", { name: /next page/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes", async () => {
    const { user, onClose } = setup(3);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
