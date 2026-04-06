import type { AutomationMode } from "./modes.js";
import { routeInteractionRequest } from "./request-router.js";
import type { InteractionRequest } from "./intents.js";
import type { InteractionSession } from "./session.js";
import { bindActiveBook, updateAutomationMode } from "./session.js";

type ReviseMode = "local-fix" | "rewrite";

export interface InteractionRuntimeTools {
  readonly writeNextChapter: (bookId: string) => Promise<unknown>;
  readonly reviseDraft: (bookId: string, chapterNumber: number, mode: ReviseMode) => Promise<unknown>;
  readonly updateCurrentFocus: (bookId: string, content: string) => Promise<unknown>;
  readonly updateAuthorIntent: (bookId: string, content: string) => Promise<unknown>;
}

export interface InteractionRuntimeResult {
  readonly session: InteractionSession;
}

export async function runInteractionRequest(params: {
  readonly session: InteractionSession;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
}): Promise<InteractionRuntimeResult> {
  const request = routeInteractionRequest(params.request);
  let session = params.session;

  if (request.mode) {
    session = updateAutomationMode(session, request.mode as AutomationMode);
  }

  const markCompleted = (nextSession: InteractionSession): InteractionSession => ({
    ...nextSession,
    currentExecution: {
      status: "completed",
      bookId: nextSession.activeBookId,
      chapterNumber: nextSession.activeChapterNumber,
      stageLabel: "completed",
    },
  });

  switch (request.intent) {
    case "write_next":
    case "continue_book": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error("No active book is bound to the interaction session.");
      }
      await params.tools.writeNextChapter(bookId);
      session = bindActiveBook(session, bookId);
      return { session: markCompleted(session) };
    }
    case "revise_chapter":
    case "rewrite_chapter": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error("No active book is bound to the interaction session.");
      }
      if (!request.chapterNumber) {
        throw new Error("Chapter number is required for chapter revision.");
      }
      const mode: ReviseMode = request.intent === "rewrite_chapter" ? "rewrite" : "local-fix";
      await params.tools.reviseDraft(bookId, request.chapterNumber, mode);
      session = bindActiveBook(session, bookId, request.chapterNumber);
      return { session: markCompleted(session) };
    }
    case "update_focus": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error("No active book is bound to the interaction session.");
      }
      if (!request.instruction) {
        throw new Error("Focus update requires instruction content.");
      }
      await params.tools.updateCurrentFocus(bookId, request.instruction);
      session = bindActiveBook(session, bookId);
      return { session: markCompleted(session) };
    }
    case "update_author_intent": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error("No active book is bound to the interaction session.");
      }
      if (!request.instruction) {
        throw new Error("Author intent update requires instruction content.");
      }
      await params.tools.updateAuthorIntent(bookId, request.instruction);
      session = bindActiveBook(session, bookId);
      return { session: markCompleted(session) };
    }
    case "switch_mode":
      return {
        session: markCompleted(session),
      };
    default:
      throw new Error(`Intent "${request.intent}" is not implemented in the interaction runtime yet.`);
  }
}
