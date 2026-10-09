import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { LIMITS } from "@/lib/limits";
import type { DocumentSummary } from "@/lib/documents/summary";
import { DocumentLibrary } from "./document-library";

const doc = (overrides: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id: "6ac68534ae92936b3b5a0515",
  filename: "handbook.pdf",
  pageCount: 12,
  sizeBytes: 300_000,
  status: "ready",
  chunkCount: 20,
  createdAt: "2026-10-08T10:00:00.000Z",
  ...overrides,
});

const pdfFile = (name = "notes.pdf", size = 2048, type = "application/pdf") =>
  new File([new Uint8Array(size)], name, { type });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apiError = (status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  json(status, { error: { code, message, ...extra } });

let fetchMock: Mock<typeof fetch>;

/** The calls made with a given method, as [url, init] pairs. */
const callsWith = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET").toUpperCase() === method);

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(documents: DocumentSummary[] = []) {
  const user = userEvent.setup({ applyAccept: false });
  render(<DocumentLibrary initialDocuments={documents} />);
  const input = () => screen.getByLabelText(/upload a pdf/i) as HTMLInputElement;
  return { user, input };
}

describe("DocumentLibrary — list", () => {
  it("shows a deliberate empty state with the limits", () => {
    setup([]);
    expect(screen.getByText(/no documents yet/i)).toBeTruthy();
    expect(screen.getByText(/4\.0 MB/)).toBeTruthy();
    expect(screen.getByText(/50 pages/)).toBeTruthy();
  });

  it("lists documents with their page count and status, linking ready ones to their chat", () => {
    setup([
      doc(),
      doc({ id: "6ac68534ae92936b3b5a0516", filename: "broken.pdf", status: "failed", chunkCount: null }),
      doc({ id: "6ac68534ae92936b3b5a0517", filename: "new.pdf", status: "processing", chunkCount: null }),
    ]);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByRole("link", { name: "handbook.pdf" }).getAttribute("href")).toBe(
      "/documents/6ac68534ae92936b3b5a0515",
    );
    expect(within(items[0]!).getByText(/12 pages/)).toBeTruthy();
    expect(within(items[0]!).getByText("Ready")).toBeTruthy();
    expect(within(items[1]!).getByText("Failed")).toBeTruthy();
    expect(within(items[1]!).queryByRole("link")).toBeNull();
    expect(within(items[2]!).getByText("Processing")).toBeTruthy();
  });
});

describe("DocumentLibrary — upload", () => {
  it("uploads the chosen PDF, shows progress, then shows the refreshed list", async () => {
    let finishUpload: (response: Response) => void = () => {};
    fetchMock.mockImplementation((url, init) => {
      if (init?.method === "POST") return new Promise((resolve) => (finishUpload = resolve));
      return Promise.resolve(json(200, { documents: [doc({ filename: "notes.pdf" })] }));
    });
    const { user, input } = setup([]);

    await user.upload(input(), pdfFile());

    expect(await screen.findByText(/uploading and indexing/i)).toBeTruthy();
    expect(input().disabled).toBe(true);
    const [url, init] = callsWith("POST")[0]!;
    expect(url).toBe("/api/documents");
    expect((init?.body as FormData).get("file")).toBeInstanceOf(File);

    finishUpload(json(201, { documentId: "6ac68534ae92936b3b5a0515", pageCount: 12, emptyPages: [], status: "ready", chunkCount: 20 }));

    expect(await screen.findByRole("link", { name: "notes.pdf" })).toBeTruthy();
    expect(screen.queryByText(/uploading and indexing/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects a file over the size limit in the browser, without uploading it", async () => {
    const { user, input } = setup([]);
    await user.upload(input(), pdfFile("big.pdf", LIMITS.maxUploadBytes + 1));

    expect((await screen.findByRole("alert")).textContent).toMatch(/the limit is 4\.0 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a file that is not a PDF in the browser, without uploading it", async () => {
    const { user, input } = setup([]);
    await user.upload(input(), pdfFile("notes.docx", 2048, "application/msword"));

    expect((await screen.findByRole("alert")).textContent).toBe("Only PDF files are supported.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [415, "not_pdf", "This file isn't a PDF."],
    [413, "too_large", "This PDF is larger than 4.0 MB."],
    [409, "too_many_documents", "You already have 5 documents. Delete one to upload another."],
    [422, "too_many_pages", "This PDF has 51 pages; the limit is 50."],
    [422, "unreadable_pdf", "This PDF couldn't be read."],
    [422, "no_text", "No text was found in this PDF. It looks like a scan, and scanned PDFs aren't supported yet."],
    [503, "database_unavailable", "The database is unavailable right now. Please try again in a minute."],
  ])("shows the server's message for %i %s", async (status, code, message) => {
    fetchMock.mockResolvedValue(apiError(status, code, message));
    const { user, input } = setup([]);
    await user.upload(input(), pdfFile());

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(input().disabled).toBe(false);
  });

  it("on 502 embedding_failed, shows the message and refreshes the list so the failed document appears", async () => {
    fetchMock.mockImplementation((url, init) =>
      Promise.resolve(
        init?.method === "POST"
          ? apiError(502, "embedding_failed", "The document was saved, but indexing it failed. Please try again in a minute.", {
              documentId: "6ac68534ae92936b3b5a0515",
            })
          : json(200, { documents: [doc({ filename: "notes.pdf", status: "failed", chunkCount: null })] }),
      ),
    );
    const { user, input } = setup([]);
    await user.upload(input(), pdfFile());

    expect((await screen.findByRole("alert")).textContent).toMatch(/indexing it failed/);
    expect(await screen.findByText("Failed")).toBeTruthy();
    expect(callsWith("GET")).toHaveLength(1);
  });

  it("explains a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user, input } = setup([]);
    await user.upload(input(), pdfFile());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The upload didn't reach the server. Check your connection and try again.",
    );
  });

  it("shows a generic message when the server's reply isn't the usual error shape", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Internal Server Error</html>", { status: 500 }));
    const { user, input } = setup([]);
    await user.upload(input(), pdfFile());

    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong. Please try again.");
  });

  it("clears an earlier error when a new upload starts", async () => {
    fetchMock.mockResolvedValueOnce(apiError(415, "not_pdf", "This file isn't a PDF."));
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { user, input } = setup([]);
    await user.upload(input(), pdfFile());
    await screen.findByRole("alert");

    await user.upload(input(), pdfFile("second.pdf"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it(`disables upload at ${LIMITS.maxDocumentsPerUser} documents and says why`, () => {
    const documents = Array.from({ length: LIMITS.maxDocumentsPerUser }, (_, i) =>
      doc({ id: `6ac68534ae92936b3b5a05${10 + i}`, filename: `doc-${i}.pdf` }),
    );
    const { input } = setup(documents);

    expect(input().disabled).toBe(true);
    expect(screen.getByText(/delete one to upload another/i)).toBeTruthy();
  });
});

describe("DocumentLibrary — delete", () => {
  it("asks for confirmation, deletes, and removes the document from the list", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { user } = setup([doc(), doc({ id: "6ac68534ae92936b3b5a0516", filename: "other.pdf" })]);

    await user.click(screen.getAllByRole("button", { name: /delete/i })[0]!);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /confirm delete/i }));

    expect(callsWith("DELETE")[0]?.[0]).toBe("/api/documents/6ac68534ae92936b3b5a0515");
    expect(await screen.findByText("other.pdf")).toBeTruthy();
    expect(screen.queryByText("handbook.pdf")).toBeNull();
  });

  it("can cancel the confirmation", async () => {
    const { user } = setup([doc()]);
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("button", { name: /delete/i })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the document and explains when deleting fails", async () => {
    fetchMock.mockResolvedValue(
      apiError(503, "database_unavailable", "The database is unavailable right now. Please try again in a minute."),
    );
    const { user } = setup([doc()]);
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /confirm delete/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/database is unavailable/);
    expect(screen.getByText("handbook.pdf")).toBeTruthy();
  });
});
