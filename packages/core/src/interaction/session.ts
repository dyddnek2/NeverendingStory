import { z } from "zod";
import { AutomationModeSchema, type AutomationMode } from "./modes.js";
import { ExecutionStateSchema } from "./events.js";

export const PendingDecisionSchema = z.object({
  kind: z.string().min(1),
  bookId: z.string().min(1),
  chapterNumber: z.number().int().min(1).optional(),
  summary: z.string().min(1),
});

export type PendingDecision = z.infer<typeof PendingDecisionSchema>;

export const InteractionMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
});

export type InteractionMessage = z.infer<typeof InteractionMessageSchema>;

export const InteractionSessionSchema = z.object({
  sessionId: z.string().min(1),
  projectRoot: z.string().min(1),
  activeBookId: z.string().min(1).optional(),
  activeChapterNumber: z.number().int().min(1).optional(),
  automationMode: AutomationModeSchema.default("semi"),
  messages: z.array(InteractionMessageSchema).default([]),
  pendingDecision: PendingDecisionSchema.optional(),
  currentExecution: ExecutionStateSchema.optional(),
});

export type InteractionSession = z.infer<typeof InteractionSessionSchema>;

export function bindActiveBook(
  session: InteractionSession,
  bookId: string,
  chapterNumber?: number,
): InteractionSession {
  return {
    ...session,
    activeBookId: bookId,
    ...(chapterNumber !== undefined ? { activeChapterNumber: chapterNumber } : {}),
  };
}

export function clearPendingDecision(session: InteractionSession): InteractionSession {
  if (!session.pendingDecision) {
    return session;
  }

  return {
    ...session,
    pendingDecision: undefined,
  };
}

export function updateAutomationMode(
  session: InteractionSession,
  automationMode: AutomationMode,
): InteractionSession {
  return {
    ...session,
    automationMode,
  };
}
