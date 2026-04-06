import { describe, expect, it, vi } from "vitest";
import { InteractionSessionSchema } from "../interaction/session.js";
import { runInteractionRequest } from "../interaction/runtime.js";

describe("interaction runtime", () => {
  it("routes continue/write intents to writeNextChapter", async () => {
    const writeNextChapter = vi.fn(async () => ({
      chapterNumber: 7,
      title: "Harbor Ledger",
      wordCount: 3210,
      revised: false,
      status: "ready-for-review" as const,
    }));
    const reviseDraft = vi.fn();
    const updateCurrentFocus = vi.fn();
    const updateAuthorIntent = vi.fn();

    const session = InteractionSessionSchema.parse({
      sessionId: "session-1",
      projectRoot: "/tmp/project",
      activeBookId: "harbor",
      automationMode: "semi",
      messages: [],
    });

    const result = await runInteractionRequest({
      session,
      request: { intent: "write_next", bookId: "harbor" },
      tools: { writeNextChapter, reviseDraft, updateCurrentFocus, updateAuthorIntent },
    });

    expect(writeNextChapter).toHaveBeenCalledWith("harbor");
    expect(reviseDraft).not.toHaveBeenCalled();
    expect(result.session.activeBookId).toBe("harbor");
    expect(result.session.currentExecution?.status).toBe("completed");
  });

  it("routes revise_chapter to reviseDraft with local-fix", async () => {
    const writeNextChapter = vi.fn();
    const reviseDraft = vi.fn(async () => ({
      chapterNumber: 3,
      wordCount: 2800,
      fixedIssues: ["tightened ending"],
      applied: true,
      status: "ready-for-review" as const,
    }));

    const session = InteractionSessionSchema.parse({
      sessionId: "session-2",
      projectRoot: "/tmp/project",
      activeBookId: "harbor",
      automationMode: "manual",
      messages: [],
    });

    await runInteractionRequest({
      session,
      request: { intent: "revise_chapter", bookId: "harbor", chapterNumber: 3 },
      tools: {
        writeNextChapter,
        reviseDraft,
        updateCurrentFocus: vi.fn(),
        updateAuthorIntent: vi.fn(),
      },
    });

    expect(reviseDraft).toHaveBeenCalledWith("harbor", 3, "local-fix");
  });

  it("routes rewrite_chapter to reviseDraft with rewrite mode", async () => {
    const reviseDraft = vi.fn(async () => ({
      chapterNumber: 5,
      wordCount: 3100,
      fixedIssues: ["rewrote chapter"],
      applied: true,
      status: "ready-for-review" as const,
    }));

    await runInteractionRequest({
      session: InteractionSessionSchema.parse({
        sessionId: "session-3",
        projectRoot: "/tmp/project",
        activeBookId: "harbor",
        automationMode: "manual",
        messages: [],
      }),
      request: { intent: "rewrite_chapter", bookId: "harbor", chapterNumber: 5 },
      tools: {
        writeNextChapter: vi.fn(),
        reviseDraft,
        updateCurrentFocus: vi.fn(),
        updateAuthorIntent: vi.fn(),
      },
    });

    expect(reviseDraft).toHaveBeenCalledWith("harbor", 5, "rewrite");
  });

  it("routes update_focus to the focus updater", async () => {
    const updateCurrentFocus = vi.fn(async () => ({ ok: true }));

    await runInteractionRequest({
      session: InteractionSessionSchema.parse({
        sessionId: "session-4",
        projectRoot: "/tmp/project",
        activeBookId: "harbor",
        automationMode: "semi",
        messages: [],
      }),
      request: {
        intent: "update_focus",
        bookId: "harbor",
        instruction: "Bring the story back to the old harbor debt line.",
      },
      tools: {
        writeNextChapter: vi.fn(),
        reviseDraft: vi.fn(),
        updateCurrentFocus,
        updateAuthorIntent: vi.fn(),
      },
    });

    expect(updateCurrentFocus).toHaveBeenCalledWith(
      "harbor",
      "Bring the story back to the old harbor debt line.",
    );
  });

  it("updates automation mode without invoking pipeline tools", async () => {
    const writeNextChapter = vi.fn();
    const reviseDraft = vi.fn();
    const updateCurrentFocus = vi.fn();
    const updateAuthorIntent = vi.fn();

    const result = await runInteractionRequest({
      session: InteractionSessionSchema.parse({
        sessionId: "session-5",
        projectRoot: "/tmp/project",
        activeBookId: "harbor",
        automationMode: "semi",
        messages: [],
      }),
      request: { intent: "switch_mode", mode: "auto" },
      tools: {
        writeNextChapter,
        reviseDraft,
        updateCurrentFocus,
        updateAuthorIntent,
      },
    });

    expect(result.session.automationMode).toBe("auto");
    expect(writeNextChapter).not.toHaveBeenCalled();
    expect(reviseDraft).not.toHaveBeenCalled();
    expect(updateCurrentFocus).not.toHaveBeenCalled();
    expect(updateAuthorIntent).not.toHaveBeenCalled();
  });
});
