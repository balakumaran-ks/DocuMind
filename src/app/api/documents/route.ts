import { createHash } from "node:crypto";
import { EmbeddingError, getEmbedder } from "@/lib/ai/embed";
import { getUserId } from "@/lib/auth/user";
import { getDb, isDatabaseUnavailable } from "@/lib/db/client";
import { unauthorized, withDatabaseErrors } from "@/lib/api/responses";
import { countDocuments, insertDocumentWithPages, listDocuments } from "@/lib/db/documents";
import { ingestDocument } from "@/lib/ingest";
import { LIMITS, PDF_MAGIC_BYTES } from "@/lib/limits";
import { countPages, extractPages, PdfReadError } from "@/lib/pdf/extract";
import { validateUpload } from "@/lib/upload/validate";

// Parsing and storing a 50-page PDF can take a few seconds (ADR-0005).
export const maxDuration = 60;

type ErrorCode =
  | "unauthorized"
  | "missing_file"
  | "too_large"
  | "not_pdf"
  | "too_many_documents"
  | "too_many_pages"
  | "unreadable_pdf"
  | "no_text"
  | "database_unavailable"
  | "embedding_failed";

function error(status: number, code: ErrorCode, message: string, extra: Record<string, string> = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

/** The signed-in user's documents, newest first. */
export async function GET(_request: Request) {
  return withDatabaseErrors(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized("Sign in to see your documents.");

    const rows = await listDocuments(await getDb(), userId);
    return Response.json({
      documents: rows.map((document) => ({
        id: document._id.toHexString(),
        filename: document.filename,
        pageCount: document.pageCount,
        sizeBytes: document.sizeBytes,
        status: document.status,
        chunkCount: document.chunkCount ?? null,
        createdAt: document.createdAt.toISOString(),
      })),
    });
  });
}

/**
 * Upload a PDF: validate it on the server, extract text per page, and store the
 * document with its pages. Checks run cheapest first, and nothing is written
 * unless every check passes.
 */
export async function POST(request: Request) {
  try {
    return await handleUpload(request);
  } catch (cause) {
    if (isDatabaseUnavailable(cause)) {
      return error(503, "database_unavailable", "The database is unavailable right now. Please try again in a minute.");
    }
    throw cause;
  }
}

async function handleUpload(request: Request) {
  const userId = await getUserId();
  if (!userId) return error(401, "unauthorized", "Sign in to upload documents.");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return error(400, "missing_file", "Choose a PDF to upload.");

  const db = await getDb();
  // Only the first bytes are needed for the type check; the whole file is read after it passes.
  const head = new Uint8Array(await file.slice(0, PDF_MAGIC_BYTES.length).arrayBuffer());
  const check = validateUpload({ size: file.size, head, documentCount: await countDocuments(db, userId) });
  if (!check.ok) return error(check.status, check.code, check.message);

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const pageCount = await countPages(bytes);
    if (pageCount > LIMITS.maxPagesPerDocument) {
      return error(
        422,
        "too_many_pages",
        `This PDF has ${pageCount} pages; the limit is ${LIMITS.maxPagesPerDocument}.`,
      );
    }

    const pages = await extractPages(bytes);
    if (pages.every((page) => page.isEmpty)) {
      return error(
        422,
        "no_text",
        "No text was found in this PDF. It looks like a scan, and scanned PDFs aren't supported yet.",
      );
    }

    const documentId = await insertDocumentWithPages(db, {
      userId,
      filename: file.name,
      sizeBytes: file.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      pages,
    });

    let chunkCount: number;
    try {
      ({ chunkCount } = await ingestDocument({ db, embedder: getEmbedder(), userId, documentId, pages }));
    } catch (cause) {
      // The document and its pages are kept, marked "failed", so indexing can be retried later.
      if (cause instanceof EmbeddingError) {
        return error(
          502,
          "embedding_failed",
          "The document was saved, but indexing it failed. Please try again in a minute.",
          { documentId: documentId.toHexString() },
        );
      }
      throw cause;
    }

    return Response.json(
      {
        documentId: documentId.toHexString(),
        pageCount: pages.length,
        emptyPages: pages.filter((page) => page.isEmpty).map((page) => page.pageNumber),
        status: "ready",
        chunkCount,
      },
      { status: 201 },
    );
  } catch (cause) {
    if (cause instanceof PdfReadError) return error(422, "unreadable_pdf", cause.message);
    throw cause;
  }
}
