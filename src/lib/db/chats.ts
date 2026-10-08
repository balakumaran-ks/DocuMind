import { ObjectId, type Db } from "mongodb";
import type { Citation } from "@/lib/rag/citations";
import type { ChatTurn } from "@/lib/rag/prompt";

/** One conversation about one document. */
export type StoredChat = {
  _id: ObjectId;
  userId: string;
  documentId: ObjectId;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

/** A question, or an answer with what it was built from. */
export type StoredMessage = {
  _id: ObjectId;
  chatId: ObjectId;
  userId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  /** Answers only. */
  citations?: Citation[];
  retrievedChunkIds?: ObjectId[];
  latencyMs?: number;
  usage?: { inputTokens: number | null; outputTokens: number | null };
};

const chats = (db: Db) => db.collection<StoredChat>("chats");
const messages = (db: Db) => db.collection<StoredMessage>("messages");

/** Indexes for chat lists, history and the daily question count. Idempotent. */
export async function ensureChatIndexes(db: Db): Promise<void> {
  await chats(db).createIndex({ userId: 1, documentId: 1, updatedAt: -1 });
  await messages(db).createIndex({ chatId: 1, createdAt: 1 });
  await messages(db).createIndex({ userId: 1, role: 1, createdAt: 1 });
}

/** Midnight UTC at the start of the given moment's UTC day; the daily cap resets then. */
export function startOfUtcDay(now: Date): Date {
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  return midnight;
}

/** Questions the user has asked since `since` (answers don't count). */
export async function countQuestionsSince(db: Db, userId: string, since: Date): Promise<number> {
  return messages(db).countDocuments({ userId, role: "user", createdAt: { $gte: since } });
}

/** The user's chat about this document, or null if it doesn't exist or isn't theirs. */
export async function findChat(db: Db, userId: string, documentId: ObjectId, chatId: string): Promise<StoredChat | null> {
  if (!/^[0-9a-f]{24}$/i.test(chatId)) return null;
  return chats(db).findOne({ _id: new ObjectId(chatId), userId, documentId });
}

export async function createChat(db: Db, input: { userId: string; documentId: ObjectId; title: string }): Promise<StoredChat> {
  const now = new Date();
  const chat: StoredChat = { _id: new ObjectId(), ...input, createdAt: now, updatedAt: now };
  await chats(db).insertOne(chat);
  return chat;
}

/** The chats about one of the user's documents, most recently active first. */
export async function listChats(db: Db, userId: string, documentId: ObjectId): Promise<StoredChat[]> {
  return chats(db).find({ userId, documentId }).sort({ updatedAt: -1, _id: -1 }).toArray();
}

/** A user's chat by id, or null if it doesn't exist or isn't theirs. */
export async function getChat(db: Db, userId: string, chatId: string): Promise<StoredChat | null> {
  if (!/^[0-9a-f]{24}$/i.test(chatId)) return null;
  return chats(db).findOne({ _id: new ObjectId(chatId), userId });
}

/** Every message of a user's chat, oldest first. */
export async function listMessages(db: Db, userId: string, chatId: ObjectId): Promise<StoredMessage[]> {
  return messages(db).find({ chatId, userId }).sort({ createdAt: 1, _id: 1 }).toArray();
}

/** Deletes a document's chats and their messages (messages first). */
export async function deleteChatsForDocument(db: Db, userId: string, documentId: ObjectId): Promise<void> {
  const chatIds = await chats(db).distinct("_id", { userId, documentId });
  if (chatIds.length === 0) return;
  await messages(db).deleteMany({ userId, chatId: { $in: chatIds } });
  await chats(db).deleteMany({ userId, _id: { $in: chatIds } });
}

/** The chat's last `limit` messages, oldest first, as prompt history. */
export async function recentMessages(db: Db, userId: string, chatId: ObjectId, limit: number): Promise<ChatTurn[]> {
  const rows = await messages(db)
    .find({ chatId, userId }, { projection: { _id: 0, role: 1, content: 1 } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .toArray();
  return rows.reverse().map(({ role, content }) => ({ role, content }));
}

/** Stores a message and marks its chat as just updated. */
export async function saveMessage(db: Db, message: Omit<StoredMessage, "_id" | "createdAt">): Promise<void> {
  const createdAt = new Date();
  await messages(db).insertOne({ _id: new ObjectId(), ...message, createdAt });
  await chats(db).updateOne({ _id: message.chatId, userId: message.userId }, { $set: { updatedAt: createdAt } });
}
