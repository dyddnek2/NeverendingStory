import { afterEach, describe, expect, it, vi } from "vitest";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("FoundationReviewerAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses dedicated Korean review prompts and excerpts", async () => {
    const agent = new FoundationReviewerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== DIMENSION: 1 ===",
          "점수: 85",
          "의견: 갈등 축이 선명하다.",
          "",
          "=== OVERALL ===",
          "총점: 85",
          "통과: 예",
          "총평: 바로 집필 가능한 수준이다.",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.review({
      mode: "original",
      language: "ko",
      foundation: {
        storyBible: "스토리 바이블",
        volumeOutline: "권차 개요",
        bookRules: "작품 규칙",
        currentState: "현재 상태",
        pendingHooks: "복선 풀",
      },
    });

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>;
    expect(messages[0]?.content).toContain("수석 소설 편집자");
    expect(messages[0]?.content).toContain("## 채점 기준");
    expect(messages[1]?.content).toContain("## 스토리 바이블");
    expect(messages[1]?.content).toContain("## 초기 복선");
    expect(messages[0]?.content).not.toContain("资深小说编辑");
  });

  it("localizes Korean canon and style reference headings", async () => {
    const agent = new FoundationReviewerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: "=== OVERALL ===\n총평: 통과 가능\n",
        usage: ZERO_USAGE,
      });

    await agent.review({
      mode: "series",
      language: "ko",
      sourceCanon: "원작 정전",
      styleGuide: "문체 지침",
      foundation: {
        storyBible: "스토리 바이블",
        volumeOutline: "권차 개요",
        bookRules: "작품 규칙",
        currentState: "현재 상태",
        pendingHooks: "복선 풀",
      },
    });

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>;
    expect(messages[0]?.content).toContain("## 원작 정전 참조");
    expect(messages[0]?.content).toContain("## 원작 문체 참조");
    expect(messages[0]?.content).not.toContain("## 原作正典参照");
  });
});
