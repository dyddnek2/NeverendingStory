import { describe, expect, it } from "vitest";
import { buildObserverSystemPrompt, buildObserverUserPrompt } from "../agents/observer-prompts.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "../agents/settler-prompts.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";

const BOOK: BookConfig = {
  id: "ko-book",
  title: "검은 파도 항로",
  platform: "other",
  genre: "other",
  status: "active",
  targetChapters: 80,
  chapterWordCount: 2200,
  language: "ko",
  createdAt: "2026-04-20T00:00:00.000Z",
  updatedAt: "2026-04-20T00:00:00.000Z",
};

const GENRE: GenreProfile = {
  id: "modern-fantasy-ko",
  name: "현대 판타지",
  language: "ko",
  chapterTypes: [],
  auditDimensions: [6, 33],
  fatigueWords: [],
  pacingRule: "",
  satisfactionTypes: [],
  numericalSystem: true,
  powerScaling: false,
  eraResearch: false,
};

describe("Korean prompt branches in active post-write pipeline", () => {
  it("uses dedicated Korean observer prompts", () => {
    const systemPrompt = buildObserverSystemPrompt(BOOK, GENRE, "ko");
    const userPrompt = buildObserverUserPrompt(3, "파도 아래 문", "본문", "ko");

    expect(systemPrompt).toContain("반드시 한국어로 작성한다");
    expect(systemPrompt).toContain("## 추출 범주");
    expect(systemPrompt).toContain("[인물 행동]");
    expect(systemPrompt).not.toContain("## 提取类别");
    expect(userPrompt).toContain("3화");
    expect(userPrompt).toContain("모든 사실");
  });

  it("uses dedicated Korean settler prompts", () => {
    const systemPrompt = buildSettlerSystemPrompt(BOOK, GENRE, null, "ko");
    const userPrompt = buildSettlerUserPrompt({
      chapterNumber: 3,
      title: "파도 아래 문",
      content: "본문",
      currentState: "현재 상태",
      ledger: "장부",
      hooks: "복선",
      chapterSummaries: "요약",
      subplotBoard: "서브플롯",
      emotionalArcs: "감정선",
      characterMatrix: "매트릭스",
      volumeOutline: "개요",
      observations: "관찰",
      language: "ko",
    });

    expect(systemPrompt).toContain("모든 출력(state card, hooks");
    expect(systemPrompt).toContain("## 복선 추적 규칙");
    expect(systemPrompt).toContain("## 출력 형식 (엄수)");
    expect(userPrompt).toContain("3화");
    expect(userPrompt).toContain("## 관찰 로그");
    expect(userPrompt).toContain("## 현재 복선 풀");
    expect(userPrompt).not.toContain("## 当前伏笔池");
  });
});
