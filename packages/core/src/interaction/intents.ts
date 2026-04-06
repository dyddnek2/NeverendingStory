import { z } from "zod";
import { AutomationModeSchema } from "./modes.js";

export const InteractionIntentTypeSchema = z.enum([
  "create_book",
  "select_book",
  "continue_book",
  "write_next",
  "pause_book",
  "resume_book",
  "revise_chapter",
  "rewrite_chapter",
  "edit_truth",
  "update_focus",
  "update_author_intent",
  "explain_status",
  "explain_failure",
  "export_book",
  "switch_mode",
]);

export type InteractionIntentType = z.infer<typeof InteractionIntentTypeSchema>;

export const InteractionRequestSchema = z.object({
  intent: InteractionIntentTypeSchema,
  bookId: z.string().min(1).optional(),
  chapterNumber: z.number().int().min(1).optional(),
  instruction: z.string().min(1).optional(),
  mode: AutomationModeSchema.optional(),
});

export type InteractionRequest = z.infer<typeof InteractionRequestSchema>;
