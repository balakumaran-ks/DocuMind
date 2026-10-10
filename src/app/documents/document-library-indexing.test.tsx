import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { DocumentSummary } from "@/lib/documents/summary";
import { DocumentLibrary } from "./document-library";

const ID = "6ac68534ae92936b3b5a0515";
const INGEST_URL = `/api/documents/${ID}/ingest`;

const doc = (overrides: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id: ID,
  filename: "p501.pdf",
  pageCount: 31,
  sizeBytes: 1_500_000,
  status: "processing",
  chunkCount: 220,
  embeddedChunks: 80,
  createdAt: "2026-10-10T10:00:00.000Z",
  ...overrides,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const progress = (embeddedChunks: number, status = "processing") => json(200, { status, chunkCount: 220, embeddedChunks });
const quota = (retryAfterSeconds: number, embeddedChunks: number) =>
  json(429, {
    error: { code: "rate_limited", message: `Indexing continues in ${retryAfterSeconds} seconds.`, retryAfterSeconds, chunkCount: 220, embeddedChunks },
  });

let fetchMock: Mock<typeof fetch>;
/** Answers for successive POSTs to the ingest route, in order. */
let ingestReplies: Response[];
/** Pending waits requested by the component, released by the test. */
let waits: { ms: number; release: () => void }[];

const ingestCalls = () => fetchMock.mock.calls.filter(([url]) => url === INGEST_URL).length;

function sleep(ms: number) {
  return new Promise<void>((resolve) => waits.push({ ms, release: resolve }));
}

beforeEach(() => {
  ingestReplies = [];
  waits = [];
  fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (url === INGEST_URL) return ingestReplies.shift() ?? new Promise<Response>(() => {});
    if (url === "/api/documents" && init?.method === "POST") {
      return json(202, { documentId: ID, pageCount: 31, emptyPages: [], status: "processing", chunkCount: 220, embeddedChunks: 80 });
    }
    if (url === "/api/documents") return json(200, { documents: [doc()] });
    throw new Error(`unexpected fetch ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(documents: DocumentSummary[] = []) {
  const user = userEvent.setup({ applyAccept: false });
  render(<DocumentLibrary initialDocuments={documents} sleep={sleep} />);
  const input = () => screen.getByLabelText(/upload a pdf/i) as HTMLInputElement;
  const row = () => screen.getByText("p501.pdf").closest("li") as HTMLElement;
  return { user, input, row };
}

const pdf = () => new File([new Uint8Array(2048)], "p501.pdf", { type: "application/pdf" });

describe("DocumentLibrary — indexing large documents", () => {
  it("keeps indexing after a 202 upload, showing progress, until the document is ready", async () => {
    ingestReplies = [progress(160), progress(220, "ready")];
    const { user, input, row } = setup();

    await user.upload(input(), pdf());

    expect(await within(row()).findByText("Indexing… 160 of 220 chunks")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "p501.pdf" })).toBeTruthy();
    expect(within(row()).getByText("Ready")).toBeTruthy();
    expect(ingestCalls()).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("waits out the free quota with a countdown, then carries on", async () => {
    ingestReplies = [quota(30, 80), progress(220, "ready")];
    const { user, input, row } = setup();

    await user.upload(input(), pdf());

    expect(await within(row()).findByText("Waiting for the free quota… 30 s")).toBeTruthy();
    await waitFor(() => expect(waits.map((w) => w.ms)).toEqual([30_000]));
    expect(ingestCalls()).toBe(1);

    waits[0]?.release();
    expect(await screen.findByRole("link", { name: "p501.pdf" })).toBeTruthy();
    expect(ingestCalls()).toBe(2);
  });

  it("waits first when the upload itself hit the quota", async () => {
    fetchMock.mockImplementationOnce(async () =>
      json(202, { documentId: ID, pageCount: 31, emptyPages: [], status: "processing", chunkCount: 220, embeddedChunks: 0, retryAfterSeconds: 20 }),
    );
    ingestReplies = [progress(220, "ready")];
    const { user, input } = setup();

    await user.upload(input(), pdf());

    await waitFor(() => expect(waits.map((w) => w.ms)).toEqual([20_000]));
    expect(ingestCalls()).toBe(0);
    waits[0]?.release();
    expect(await screen.findByRole("link", { name: "p501.pdf" })).toBeTruthy();
  });

  it("waits briefly and tries again while another tab is indexing", async () => {
    ingestReplies = [
      json(409, { error: { code: "ingest_in_progress", message: "This document is already being indexed." } }),
      progress(220, "ready"),
    ];
    const { user } = setup([doc()]);

    await user.click(screen.getByRole("button", { name: /resume indexing/i }));
    await waitFor(() => expect(waits.map((w) => w.ms)).toEqual([5_000]));
    waits[0]?.release();
    expect(await screen.findByRole("link", { name: "p501.pdf" })).toBeTruthy();
  });

  it("stops with the server's message when indexing fails, and shows the failed status", async () => {
    ingestReplies = [json(502, { error: { code: "embedding_failed", message: "Indexing this document failed. Delete it and upload it again." } })];
    fetchMock.mockImplementation(async (url, init) => {
      if (url === INGEST_URL) return ingestReplies.shift() ?? new Promise<Response>(() => {});
      if (url === "/api/documents" && !init?.method) return json(200, { documents: [doc({ status: "failed" })] });
      throw new Error(`unexpected fetch ${String(url)}`);
    });
    const { user, row } = setup([doc()]);

    await user.click(screen.getByRole("button", { name: /resume indexing/i }));

    expect((await screen.findByRole("alert")).textContent).toBe("Indexing this document failed. Delete it and upload it again.");
    expect(await within(row()).findByText("Failed")).toBeTruthy();
  });

  it("offers to resume a document left processing, without starting on its own", async () => {
    ingestReplies = [progress(220, "ready")];
    const { user, row } = setup([doc()]);

    expect(within(row()).getByText("Paused at 80 of 220 chunks")).toBeTruthy();
    expect(within(row()).queryByRole("link")).toBeNull();
    expect(ingestCalls()).toBe(0);

    await user.click(within(row()).getByRole("button", { name: /resume indexing/i }));
    expect(await screen.findByRole("link", { name: "p501.pdf" })).toBeTruthy();
  });

  it("explains a network failure and lets the user resume", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === INGEST_URL) throw new TypeError("Failed to fetch");
      throw new Error(`unexpected fetch ${String(url)}`);
    });
    const { user, row } = setup([doc()]);

    await user.click(screen.getByRole("button", { name: /resume indexing/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/connection/i);
    expect(within(row()).getByRole("button", { name: /resume indexing/i })).toBeTruthy();
  });
});
