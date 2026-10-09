import { ObjectId, type Db } from "mongodb";
import type { ExtractedPage } from "@/lib/pdf/extract";
import { deleteChatsForDocument } from "./chats";
import { deleteChunksForDocument } from "./chunks";

export type DocumentStatus = "processing" | "ready" | "failed";

export type StoredDocument = {
  _id: ObjectId;
  userId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  pageCount: number;
  status: DocumentStatus;
  createdAt: Date;
  /** Set once embedded (status "ready"). */
  chunkCount?: number;
  embeddingModel?: string;
  /** Why ingestion failed (status "failed"). */
  error?: string;
};

export type StoredPage = {
  _id: ObjectId;
  documentId: ObjectId;
  userId: string;
  pageNumber: number;
  text: string;
  charCount: number;
  isEmpty: boolean;
};

export type NewDocument = {
  userId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  pages: ExtractedPage[];
};

const documents = (db: Db) => db.collection<StoredDocument>("documents");
const pages = (db: Db) => db.collection<StoredPage>("pages");

/** Creates the indexes these queries rely on. Idempotent. */
export async function ensureIndexes(db: Db): Promise<void> {
  await documents(db).createIndex({ userId: 1, createdAt: -1 });
  await pages(db).createIndex({ documentId: 1, pageNumber: 1 }, { unique: true });
}

export async function countDocuments(db: Db, userId: string): Promise<number> {
  return documents(db).countDocuments({ userId });
}

/**
 * Stores a document (status "processing") and one row per page. If the pages
 * can't be written, the document is removed again so no half-stored upload is
 * left behind.
 */
export async function insertDocumentWithPages(db: Db, input: NewDocument): Promise<ObjectId> {
  const _id = new ObjectId();
  await documents(db).insertOne({
    _id,
    userId: input.userId,
    filename: input.filename,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    pageCount: input.pages.length,
    status: "processing",
    createdAt: new Date(),
  });

  try {
    await pages(db).insertMany(
      input.pages.map((page) => ({
        _id: new ObjectId(),
        documentId: _id,
        userId: input.userId,
        pageNumber: page.pageNumber,
        text: page.text,
        charCount: page.charCount,
        isEmpty: page.isEmpty,
      })),
    );
  } catch (error) {
    await pages(db).deleteMany({ documentId: _id, userId: input.userId });
    await documents(db).deleteOne({ _id, userId: input.userId });
    throw error;
  }

  return _id;
}

export async function markDocumentReady(
  db: Db,
  userId: string,
  documentId: ObjectId,
  details: { chunkCount: number; embeddingModel: string },
): Promise<void> {
  await documents(db).updateOne(
    { _id: documentId, userId },
    { $set: { status: "ready", ...details }, $unset: { error: "" } },
  );
}

export async function markDocumentFailed(db: Db, userId: string, documentId: ObjectId, error: string): Promise<void> {
  await documents(db).updateOne({ _id: documentId, userId }, { $set: { status: "failed", error } });
}

/** A user's documents, newest first. */
export async function listDocuments(db: Db, userId: string): Promise<StoredDocument[]> {
  return documents(db).find({ userId }).sort({ createdAt: -1, _id: -1 }).toArray();
}

/** One page of a user's document, or null if it doesn't exist or isn't theirs. */
export async function getPage(
  db: Db,
  userId: string,
  documentId: ObjectId,
  pageNumber: number,
): Promise<StoredPage | null> {
  return pages(db).findOne({ documentId, userId, pageNumber });
}

/**
 * Deletes a user's document with everything derived from it. The document row
 * goes last, so if a step fails the document is still listed and can be
 * deleted again. Returns false if it doesn't exist or isn't theirs.
 */
export async function deleteDocument(db: Db, userId: string, documentId: string): Promise<boolean> {
  const document = await getDocument(db, userId, documentId);
  if (!document) return false;

  await deleteChunksForDocument(db, userId, document._id);
  await pages(db).deleteMany({ documentId: document._id, userId });
  await deleteChatsForDocument(db, userId, document._id);
  await documents(db).deleteOne({ _id: document._id, userId });
  return true;
}

/** A user's document, or null if it doesn't exist or isn't theirs. */
export async function getDocument(db: Db, userId: string, documentId: string): Promise<StoredDocument | null> {
  // Only the 24-hex-character form; ObjectId.isValid also accepts other shapes.
  if (!/^[0-9a-f]{24}$/i.test(documentId)) return null;
  return documents(db).findOne({ _id: new ObjectId(documentId), userId });
}

/** A user's document with its pages in order, or null if it doesn't exist or isn't theirs. */
export async function getDocumentWithPages(
  db: Db,
  userId: string,
  documentId: string,
): Promise<{ document: StoredDocument; pages: StoredPage[] } | null> {
  const document = await getDocument(db, userId, documentId);
  if (!document) return null;

  const rows = await pages(db).find({ documentId: document._id, userId }).sort({ pageNumber: 1 }).toArray();
  return { document, pages: rows };
}
