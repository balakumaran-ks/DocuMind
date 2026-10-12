import { ObjectId, type Db } from "mongodb";
import { SAMPLES_USER } from "@/lib/samples/catalog";
import type { StoredChunk } from "./chunks";
import type { StoredDocument, StoredPage } from "./documents";

const documents = (db: Db) => db.collection<StoredDocument>("documents");
const pages = (db: Db) => db.collection<StoredPage>("pages");
const chunks = (db: Db) => db.collection<StoredChunk>("chunks");

/** The ready template of a sample, indexed with `embeddingModel`, or null if there is none. */
export async function findSampleTemplate(db: Db, sampleKey: string, embeddingModel: string): Promise<StoredDocument | null> {
  return documents(db).findOne(
    { userId: SAMPLES_USER, sampleKey, status: "ready", embeddingModel },
    { sort: { createdAt: -1, _id: -1 } },
  );
}

/** Whether the user already has a copy of this sample. */
export async function hasSample(db: Db, userId: string, sampleKey: string): Promise<boolean> {
  return (await documents(db).countDocuments({ userId, sampleKey }, { limit: 1 })) > 0;
}

/**
 * Copies a sample template into the user's library: the document, its pages and
 * its chunks with their vectors, so it is ready at once without any embedding
 * calls. The copy is stored as processing and marked ready only once every row
 * is in; if a step fails, what was written is removed again.
 */
export async function copySample(db: Db, userId: string, template: StoredDocument): Promise<StoredDocument> {
  const documentId = new ObjectId();
  const now = new Date();
  const copy: StoredDocument = {
    _id: documentId,
    userId,
    filename: template.filename,
    sizeBytes: template.sizeBytes,
    sha256: template.sha256,
    pageCount: template.pageCount,
    status: "processing",
    createdAt: now,
    ...(template.chunkCount !== undefined ? { chunkCount: template.chunkCount, embeddedChunks: template.chunkCount } : {}),
    ...(template.embeddingModel ? { embeddingModel: template.embeddingModel } : {}),
    ...(template.sampleKey ? { sampleKey: template.sampleKey } : {}),
  };
  await documents(db).insertOne(copy);

  try {
    const templatePages = await pages(db).find({ userId: SAMPLES_USER, documentId: template._id }).toArray();
    if (templatePages.length > 0) {
      await pages(db).insertMany(templatePages.map(({ _id, ...page }) => ({ ...page, _id: new ObjectId(), documentId, userId })));
    }
    const templateChunks = await chunks(db).find({ userId: SAMPLES_USER, documentId: template._id }).toArray();
    if (templateChunks.length > 0) {
      await chunks(db).insertMany(
        templateChunks.map(({ _id, ...chunk }) => ({ ...chunk, _id: new ObjectId(), documentId, userId, createdAt: now })),
      );
    }
    await documents(db).updateOne({ _id: documentId, userId }, { $set: { status: "ready" } });
  } catch (error) {
    await chunks(db).deleteMany({ userId, documentId });
    await pages(db).deleteMany({ userId, documentId });
    await documents(db).deleteOne({ _id: documentId, userId });
    throw error;
  }
  return { ...copy, status: "ready" };
}
