import { createHash } from "node:crypto";
import { getUserId } from "@/lib/auth/user";
import { getDb, isDatabaseUnavailable } from "@/lib/db/client";
import { countDocuments, insertDocumentWithPages } from "@/lib/db/documents";
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
  | "database_unavailable";

function error(status: number, code: ErrorCode, message: string) {
  return Response.json({ error: { code, message } }, { status });
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

    return Response.json(
      {
        documentId: documentId.toHexString(),
        pageCount: pages.length,
        emptyPages: pages.filter((page) => page.isEmpty).map((page) => page.pageNumber),
      },
      { status: 201 },
    );
  } catch (cause) {
    if (cause instanceof PdfReadError) return error(422, "unreadable_pdf", cause.message);
    throw cause;
  }
}
