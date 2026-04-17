import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { BookSessionSchema, createBookSession } from "./session.js";
import type { BookSession } from "./session.js";

const SESSIONS_DIR = ".inkos/sessions";

function sessionsDir(projectRoot: string): string {
  return join(projectRoot, SESSIONS_DIR);
}

function sessionPath(projectRoot: string, sessionId: string): string {
  return join(sessionsDir(projectRoot), `${sessionId}.json`);
}

export class SessionAlreadyMigratedError extends Error {
  constructor(sessionId: string, currentBookId: string) {
    super(`Session "${sessionId}" is already bound to book "${currentBookId}"`);
    this.name = "SessionAlreadyMigratedError";
  }
}

export async function loadBookSession(
  projectRoot: string,
  sessionId: string,
): Promise<BookSession | null> {
  try {
    const raw = await readFile(sessionPath(projectRoot, sessionId), "utf-8");
    return BookSessionSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function persistBookSession(
  projectRoot: string,
  session: BookSession,
): Promise<void> {
  const dir = sessionsDir(projectRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(
    sessionPath(projectRoot, session.sessionId),
    JSON.stringify(session, null, 2),
  );
}

export interface BookSessionSummary {
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly title: string | null;
  readonly messageCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export async function listBookSessions(
  projectRoot: string,
  bookId: string | null,
): Promise<ReadonlyArray<BookSessionSummary>> {
  const dir = sessionsDir(projectRoot);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((file) => file.endsWith(".json"));
  const summaries = await Promise.all(
    jsonFiles.map(async (file): Promise<BookSessionSummary | null> => {
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const data = JSON.parse(raw) as {
          sessionId?: unknown;
          bookId?: unknown;
          title?: unknown;
          messages?: unknown;
          createdAt?: unknown;
          updatedAt?: unknown;
        };
        if (typeof data.sessionId !== "string") return null;
        const parsedBookId = data.bookId === null || typeof data.bookId === "string"
          ? (data.bookId as string | null)
          : null;
        if (parsedBookId !== bookId) return null;
        return {
          sessionId: data.sessionId,
          bookId: parsedBookId,
          title: typeof data.title === "string" ? data.title : null,
          messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
          createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
          updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
        };
      } catch {
        return null;
      }
    }),
  );

  return summaries
    .filter((summary): summary is BookSessionSummary => summary !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function renameBookSession(
  projectRoot: string,
  sessionId: string,
  title: string,
): Promise<BookSession | null> {
  const session = await loadBookSession(projectRoot, sessionId);
  if (!session) return null;
  const updated = { ...session, title, updatedAt: Date.now() };
  await persistBookSession(projectRoot, updated);
  return updated;
}

export async function updateSessionTitle(
  projectRoot: string,
  sessionId: string,
  title: string,
): Promise<BookSession | null> {
  const session = await loadBookSession(projectRoot, sessionId);
  if (!session || session.title !== null) return session;
  const updated = { ...session, title, updatedAt: Date.now() };
  await persistBookSession(projectRoot, updated);
  return updated;
}

export async function deleteBookSession(
  projectRoot: string,
  sessionId: string,
): Promise<void> {
  try {
    await unlink(sessionPath(projectRoot, sessionId));
  } catch {
    // Session file is already absent; treat delete as idempotent.
  }
}

export async function migrateBookSession(
  projectRoot: string,
  sessionId: string,
  newBookId: string,
): Promise<BookSession | null> {
  const session = await loadBookSession(projectRoot, sessionId);
  if (!session) return null;
  if (session.bookId !== null) {
    throw new SessionAlreadyMigratedError(sessionId, session.bookId);
  }

  const updated = {
    ...session,
    bookId: newBookId,
    updatedAt: Date.now(),
  };
  await persistBookSession(projectRoot, updated);
  return updated;
}

export async function createAndPersistBookSession(
  projectRoot: string,
  bookId: string | null,
): Promise<BookSession> {
  const session = createBookSession(bookId);
  await persistBookSession(projectRoot, session);
  return session;
}
