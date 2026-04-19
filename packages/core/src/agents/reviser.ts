import { BaseAgent } from "./base.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { AuditIssue } from "./continuity.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import { readGenreProfile, readBookLanguage, readBookRules } from "./rules-reader.js";
import { countChapterLength } from "../utils/length-metrics.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import { filterSummaries } from "../utils/context-filter.js";
import {
  buildGovernedCharacterMatrixWorkingSet,
  buildGovernedHookWorkingSet,
  mergeTableMarkdownByKey,
} from "../utils/governed-working-set.js";
import { applySpotFixPatches, parseSpotFixPatches } from "../utils/spot-fix-patches.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type ReviseMode = "polish" | "rewrite" | "rework" | "anti-detect" | "spot-fix";

export const DEFAULT_REVISE_MODE: ReviseMode = "spot-fix";

export interface ReviseOutput {
  readonly revisedContent: string;
  readonly wordCount: number;
  readonly fixedIssues: ReadonlyArray<string>;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

function formatIssueLine(issue: AuditIssue, language: "ko" | "zh" | "en"): string {
  return language === "ko"
    ? `- [${issue.severity}] ${issue.category}: ${issue.description}\n  제안: ${issue.suggestion}`
    : `- [${issue.severity}] ${issue.category}: ${issue.description}\n  建议: ${issue.suggestion}`;
}

const MODE_DESCRIPTIONS: Record<ReviseMode, string> = {
  polish: "润色：只改表达、节奏、段落呼吸，不改事实与剧情结论。禁止：增删段落、改变人名/地名/物品名、增加新情节或新对话、改变因果关系。只允许：替换用词、调整句序、修改标点节奏",
  rewrite: "改写：允许重组问题段落、调整画面和叙述力度，但优先保留原文的绝大部分句段。除非问题跨越整章，否则禁止整章推倒重写；只能围绕问题段落及其直接上下文改写，同时保留核心事实与人物动机",
  rework: "重写：可重构场景推进和冲突组织，但不改主设定和大事件结果",
  "anti-detect": `反检测改写：在保持剧情不变的前提下，降低AI生成可检测性。

改写手法（附正例）：
1. 打破句式规律：连续短句 → 长短交替，句式不可预测
2. 口语化替代：✗"然而事情并没有那么简单" → ✓"哪有那么便宜的事"
3. 减少"了"字密度：✗"他走了过去，拿了杯子" → ✓"他走过去，端起杯子"
4. 转折词降频：✗"虽然…但是…" → ✓ 用角色内心吐槽或直接动作切换
5. 情绪外化：✗"他感到愤怒" → ✓"他捏碎了茶杯，滚烫的茶水流过指缝"
6. 删掉叙述者结论：✗"这一刻他终于明白了力量" → ✓ 只写行动，让读者自己感受
7. 群像反应具体化：✗"全场震惊" → ✓"老陈的烟掉在裤子上，烫得他跳起来"
8. 段落长度差异化：不再等长段落，有的段只有一句话，有的段七八行
9. 消灭"不禁""仿佛""宛如"等AI标记词：换成具体感官描写`,
  "spot-fix": "定点修复：只修改审稿意见指出的具体句子或段落，其余所有内容必须原封不动保留。修改范围限定在问题句子及其前后各一句。禁止改动无关段落",
};

export class ReviserAgent extends BaseAgent {
  get name(): string {
    return "reviser";
  }

  async reviseChapter(
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    issues: ReadonlyArray<AuditIssue>,
    mode: ReviseMode = DEFAULT_REVISE_MODE,
    genre?: string,
    options?: {
      chapterIntent?: string;
      contextPackage?: ContextPackage;
      ruleStack?: RuleStack;
      lengthSpec?: LengthSpec;
    },
  ): Promise<ReviseOutput> {
    const [currentState, ledger, hooks, styleGuideRaw, volumeOutline, storyBible, characterMatrix, chapterSummaries, parentCanon, fanficCanon] = await Promise.all([
      this.readFileSafe(join(bookDir, "story/current_state.md")),
      this.readFileSafe(join(bookDir, "story/particle_ledger.md")),
      this.readFileSafe(join(bookDir, "story/pending_hooks.md")),
      this.readFileSafe(join(bookDir, "story/style_guide.md")),
      this.readFileSafe(join(bookDir, "story/volume_outline.md")),
      this.readFileSafe(join(bookDir, "story/story_bible.md")),
      this.readFileSafe(join(bookDir, "story/character_matrix.md")),
      this.readFileSafe(join(bookDir, "story/chapter_summaries.md")),
      this.readFileSafe(join(bookDir, "story/parent_canon.md")),
      this.readFileSafe(join(bookDir, "story/fanfic_canon.md")),
    ]);

    // Load genre profile and book rules
    const genreId = genre ?? "other";
    const [{ profile: gp }, bookLanguage] = await Promise.all([
      readGenreProfile(this.ctx.projectRoot, genreId),
      readBookLanguage(bookDir),
    ]);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    // Fallback: use book_rules body when style_guide.md doesn't exist
    const styleGuide = styleGuideRaw !== "(文件不存在)"
      ? styleGuideRaw
      : (parsedRules?.body ?? ((bookLanguage ?? gp.language) === "ko" ? "(문체 가이드 없음)" : "(无文风指南)"));

    const issueList = issues
      .map((i) => formatIssueLine(i, bookLanguage ?? gp.language))
      .join("\n");

    const modeDesc = MODE_DESCRIPTIONS[mode];
    const numericalRule = gp.numericalSystem
      ? "\n3. 数值错误必须精确修正，前后对账"
      : "";
    const protagonistBlock = bookRules?.protagonist
      ? (bookLanguage ?? gp.language) === "ko"
        ? `\n\n주인공 고정값: ${bookRules.protagonist.name}, ${bookRules.protagonist.personalityLock.join(", ")}. 수정은 이 인물 축을 벗어나면 안 된다.`
        : `\n\n主角人设锁定：${bookRules.protagonist.name}，${bookRules.protagonist.personalityLock.join("、")}。修改不得违反人设。`
      : "";
    const lengthGuardrail = options?.lengthSpec
      ? (bookLanguage ?? gp.language) === "ko"
        ? `\n8. 화 분량은 목표 구간 안에 최대한 유지하고, 치명적 문제를 고치는 데 꼭 필요할 때만 소폭 벗어난다`
        : `\n8. 保持章节字数在目标区间内；只有在修复关键问题确实需要时才允许轻微偏离`
      : "";

    const isEnglish = (bookLanguage ?? gp.language) === "en";
    const resolvedLanguage = (bookLanguage ?? gp.language) === "ko"
      ? "ko"
      : isEnglish ? "en" : "zh";
    const langPrefix = isEnglish
      ? mode === "spot-fix"
        ? `【LANGUAGE OVERRIDE】ALL output (FIXED_ISSUES, PATCHES, UPDATED_STATE, UPDATED_HOOKS) MUST be in English. Every TARGET_TEXT and REPLACEMENT_TEXT must be written entirely in English.\n\n`
        : `【LANGUAGE OVERRIDE】ALL output (FIXED_ISSUES, REVISED_CONTENT, UPDATED_STATE, UPDATED_HOOKS) MUST be in English. The revised chapter content must be written entirely in English.\n\n`
      : resolvedLanguage === "ko"
        ? mode === "spot-fix"
          ? `【언어 고정】모든 출력(FIXED_ISSUES, PATCHES, UPDATED_STATE, UPDATED_HOOKS)은 반드시 한국어로 작성한다. 모든 TARGET_TEXT와 REPLACEMENT_TEXT도 완전한 한국어 문장으로 적는다.\n\n`
          : `【언어 고정】모든 출력(FIXED_ISSUES, REVISED_CONTENT, UPDATED_STATE, UPDATED_HOOKS)은 반드시 한국어로 작성한다. 수정된 본문도 자연스러운 한국어로 써야 한다.\n\n`
      : "";
    const governedMode = Boolean(options?.chapterIntent && options?.contextPackage && options?.ruleStack);
    const hooksWorkingSet = governedMode && options?.contextPackage
      ? buildGovernedHookWorkingSet({
          hooksMarkdown: hooks,
          contextPackage: options.contextPackage,
          chapterNumber,
          language: resolvedLanguage,
        })
      : hooks;
    const chapterSummariesWorkingSet = governedMode
      ? filterSummaries(chapterSummaries, chapterNumber)
      : chapterSummaries;
    const characterMatrixWorkingSet = governedMode
      ? buildGovernedCharacterMatrixWorkingSet({
          matrixMarkdown: characterMatrix,
          chapterIntent: options?.chapterIntent ?? volumeOutline,
          contextPackage: options!.contextPackage!,
          protagonistName: bookRules?.protagonist?.name,
        })
      : characterMatrix;

    const outputFormat = mode === "spot-fix"
      ? resolvedLanguage === "ko"
        ? `=== FIXED_ISSUES ===
(무엇을 어떻게 고쳤는지 한 줄씩 적는다. 안전한 정밀 수정이 불가능하면 그 이유도 적는다)

=== PATCHES ===
(교체할 국소 패치만 출력한다. 장 전체 재작성은 금지한다. 아래 형식을 반복 사용 가능)
--- PATCH 1 ---
TARGET_TEXT:
(원문에서 정확히 복사한, 유일하게 매칭되는 문장 또는 문단)
REPLACEMENT_TEXT:
(교체 후 국소 텍스트)
--- END PATCH ---

=== UPDATED_STATE ===
(갱신된 전체 상태 카드)
${gp.numericalSystem ? "\n=== UPDATED_LEDGER ===\n(갱신된 전체 자원 장부)" : ""}
=== UPDATED_HOOKS ===
(갱신된 전체 복선 풀)`
        : `=== FIXED_ISSUES ===
(逐条说明修正了什么，一行一条；如果无法安全定点修复，也在这里说明)

=== PATCHES ===
(只输出需要替换的局部补丁，不得输出整章重写。格式如下，可重复多个 PATCH 区块)
--- PATCH 1 ---
TARGET_TEXT:
(必须从原文中精确复制、且能唯一命中的原句或原段)
REPLACEMENT_TEXT:
(替换后的局部文本)
--- END PATCH ---

=== UPDATED_STATE ===
(更新后的完整状态卡)
${gp.numericalSystem ? "\n=== UPDATED_LEDGER ===\n(更新后的完整资源账本)" : ""}
=== UPDATED_HOOKS ===
(更新后的完整伏笔池)`
      : resolvedLanguage === "ko"
        ? `=== FIXED_ISSUES ===
(무엇을 어떻게 고쳤는지 한 줄씩 적는다)

=== REVISED_CONTENT ===
(수정된 전체 본문)

=== UPDATED_STATE ===
(갱신된 전체 상태 카드)
${gp.numericalSystem ? "\n=== UPDATED_LEDGER ===\n(갱신된 전체 자원 장부)" : ""}
=== UPDATED_HOOKS ===
(갱신된 전체 복선 풀)`
        : `=== FIXED_ISSUES ===
(逐条说明修正了什么，一行一条)

=== REVISED_CONTENT ===
(修正后的完整正文)

=== UPDATED_STATE ===
(更新后的完整状态卡)
${gp.numericalSystem ? "\n=== UPDATED_LEDGER ===\n(更新后的完整资源账本)" : ""}
=== UPDATED_HOOKS ===
(更新后的完整伏笔池)`;

    const systemPrompt = resolvedLanguage === "ko"
      ? `${langPrefix}당신은 ${gp.name} 장르를 다루는 전문 웹소설 교정 편집자다. 심사 의견에 따라 장을 수정하라.${protagonistBlock}

수정 모드: ${modeDesc}

수정 원칙:
1. 모드에 맞게 수정 폭을 통제한다
2. 표면만 다듬지 말고 원인을 고친다${numericalRule}
4. 복선 상태는 복선 풀과 반드시 동기화한다
5. 줄거리 방향과 핵심 갈등은 바꾸지 않는다
6. 원문의 언어 결, 리듬, 장면 감각을 유지한다
7. 수정 후 상태 카드${gp.numericalSystem ? ", 장부" : ""}, 복선 풀도 함께 갱신한다
${lengthGuardrail}
${mode === "spot-fix" ? "\n9. spot-fix는 국소 패치만 출력해야 하며 장 전체 재작성은 금지한다. TARGET_TEXT는 원문에서 유일하게 찾아져야 한다\n10. 대규모 재작성이 필요하면 안전한 spot-fix가 불가능하다고 설명하고 PATCHES는 비워 둔다" : ""}

출력 형식:

${outputFormat}`
      : `${langPrefix}你是一位专业的${gp.name}网络小说修稿编辑。你的任务是根据审稿意见对章节进行修正。${protagonistBlock}

修稿模式：${modeDesc}

修稿原则：
1. 按模式控制修改幅度
2. 修根因，不做表面润色${numericalRule}
4. 伏笔状态必须与伏笔池同步
5. 不改变剧情走向和核心冲突
6. 保持原文的语言风格和节奏
7. 修改后同步更新状态卡${gp.numericalSystem ? "、账本" : ""}、伏笔池
${lengthGuardrail}
${mode === "spot-fix" ? "\n9. spot-fix 只能输出局部补丁，禁止输出整章改写；TARGET_TEXT 必须能在原文中唯一命中\n10. 如果需要大面积改写，说明无法安全 spot-fix，并让 PATCHES 留空" : ""}

输出格式：

${outputFormat}`;

    const ledgerBlock = gp.numericalSystem
      ? resolvedLanguage === "ko"
        ? `\n## 자원 장부\n${ledger}`
        : `\n## 资源账本\n${ledger}`
      : "";
    const governedMemoryBlocks = options?.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(options.contextPackage, resolvedLanguage)
      : undefined;
    const hookDebtBlock = governedMemoryBlocks?.hookDebtBlock ?? "";
    const hooksBlock = governedMemoryBlocks?.hooksBlock
      ?? (resolvedLanguage === "ko"
        ? `\n## 복선 풀\n${hooksWorkingSet}\n`
        : `\n## 伏笔池\n${hooksWorkingSet}\n`);
    const outlineBlock = volumeOutline !== "(文件不存在)"
      ? resolvedLanguage === "ko"
        ? `\n## 권차 개요\n${volumeOutline}\n`
        : `\n## 卷纲\n${volumeOutline}\n`
      : "";
    const bibleBlock = !governedMode && storyBible !== "(文件不存在)"
      ? resolvedLanguage === "ko"
        ? `\n## 세계관 설정\n${storyBible}\n`
        : `\n## 世界观设定\n${storyBible}\n`
      : "";
    const matrixBlock = characterMatrixWorkingSet !== "(文件不存在)"
      ? resolvedLanguage === "ko"
        ? `\n## 인물 상호작용 매트릭스\n${characterMatrixWorkingSet}\n`
        : `\n## 角色交互矩阵\n${characterMatrixWorkingSet}\n`
      : "";
    const summariesBlock = governedMemoryBlocks?.summariesBlock
      ?? (chapterSummariesWorkingSet !== "(文件不存在)"
        ? resolvedLanguage === "ko"
          ? `\n## 장 요약\n${chapterSummariesWorkingSet}\n`
          : `\n## 章节摘要\n${chapterSummariesWorkingSet}\n`
        : "");
    const volumeSummariesBlock = governedMemoryBlocks?.volumeSummariesBlock ?? "";

    const hasParentCanon = parentCanon !== "(文件不存在)";
    const hasFanficCanon = fanficCanon !== "(文件不存在)";

    const canonBlock = hasParentCanon
      ? resolvedLanguage === "ko"
        ? `\n## 본편 정전 참조 (수정 전용)\n이 책은 외전이다. 수정 시 정전 제약을 따라야 하며 정전 사실을 바꾸면 안 된다.\n${parentCanon}\n`
        : `\n## 正传正典参照（修稿专用）\n本书为番外作品。修改时参照正典约束，不可改变正典事实。\n${parentCanon}\n`
      : "";

    const fanficCanonBlock = hasFanficCanon
      ? resolvedLanguage === "ko"
        ? `\n## 동인 정전 참조 (수정 전용)\n이 책은 동인 작품이다. 수정 시 정전 인물 자료와 세계 규칙을 따라야 하며 정전 사실을 어기면 안 된다. 대사도 원작 말버릇을 유지해야 한다.\n${fanficCanon}\n`
        : `\n## 同人正典参照（修稿专用）\n本书为同人作品。修改时参照正典角色档案和世界规则，不可违反正典事实。角色对话必须保留原作语癖。\n${fanficCanon}\n`
      : "";
    const reducedControlBlock = options?.chapterIntent && options.contextPackage && options.ruleStack
      ? this.buildReducedControlBlock(options.chapterIntent, options.contextPackage, options.ruleStack, resolvedLanguage)
      : "";
    const lengthGuidanceBlock = options?.lengthSpec
      ? resolvedLanguage === "ko"
        ? `\n## 분량 가드레일\n목표 분량: ${options.lengthSpec.target}\n권장 범위: ${options.lengthSpec.softMin}-${options.lengthSpec.softMax}\n하드 범위: ${options.lengthSpec.hardMin}-${options.lengthSpec.hardMax}\n수정 뒤 범위를 넘기면 군더더기 설명, 반복 동작, 약한 정보 문장을 먼저 줄여라. 새 서브플롯을 만들거나 핵심 사실을 삭제하면 안 된다.\n`
        : `\n## 字数护栏\n目标字数：${options.lengthSpec.target}\n允许区间：${options.lengthSpec.softMin}-${options.lengthSpec.softMax}\n极限区间：${options.lengthSpec.hardMin}-${options.lengthSpec.hardMax}\n如果修正后超出允许区间，请优先压缩冗余解释、重复动作和弱信息句，不得新增支线或删掉核心事实。\n`
      : "";
    const styleGuideBlock = reducedControlBlock.length === 0
      ? resolvedLanguage === "ko"
        ? `\n## 문체 가이드\n${styleGuide}`
        : `\n## 文风指南\n${styleGuide}`
      : "";

    const userPrompt = resolvedLanguage === "ko"
      ? `제${chapterNumber}화를 수정하라.

## 심사 문제
${issueList}

## 현재 상태 카드
${currentState}
${ledgerBlock}
${hookDebtBlock}${hooksBlock}${volumeSummariesBlock}${reducedControlBlock || outlineBlock}${bibleBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${styleGuideBlock}${lengthGuidanceBlock}

## 수정 대상 본문
${chapterContent}`
      : `请修正第${chapterNumber}章。

## 审稿问题
${issueList}

## 当前状态卡
${currentState}
${ledgerBlock}
${hookDebtBlock}${hooksBlock}${volumeSummariesBlock}${reducedControlBlock || outlineBlock}${bibleBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${styleGuideBlock}${lengthGuidanceBlock}

## 待修正章节
${chapterContent}`;

    const maxTokens = mode === "spot-fix" ? 8192 : 16384;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, maxTokens },
    );

    const output = this.parseOutput(response.content, gp, mode, chapterContent, resolvedLanguage);
    const mergedOutput = governedMode
      ? {
          ...output,
          updatedHooks: mergeTableMarkdownByKey(hooks, output.updatedHooks, [0]),
        }
      : output;
    const wordCount = options?.lengthSpec
      ? countChapterLength(mergedOutput.revisedContent, options.lengthSpec.countingMode)
      : mergedOutput.wordCount;
    return { ...mergedOutput, wordCount, tokenUsage: response.usage };
  }

  private parseOutput(
    content: string,
    gp: GenreProfile,
    mode: ReviseMode,
    originalChapter: string,
    language: "ko" | "zh" | "en",
  ): ReviseOutput {
    const extract = (tag: string): string => {
      const regex = new RegExp(
        `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
      );
      const match = content.match(regex);
      return match?.[1]?.trim() ?? "";
    };

    const fixedRaw = extract("FIXED_ISSUES");
    const fixedIssues = fixedRaw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (mode === "spot-fix") {
      const patches = parseSpotFixPatches(extract("PATCHES"));
      const patchResult = applySpotFixPatches(originalChapter, patches);

        return {
          revisedContent: patchResult.revisedContent,
          wordCount: patchResult.revisedContent.length,
          fixedIssues: patchResult.applied ? fixedIssues : [],
          updatedState: extract("UPDATED_STATE") || this.missingStatePlaceholder(language),
          updatedLedger: gp.numericalSystem
          ? (extract("UPDATED_LEDGER") || this.missingLedgerPlaceholder(language))
          : "",
          updatedHooks: extract("UPDATED_HOOKS") || this.missingHooksPlaceholder(language),
        };
      }

    const revisedContent = extract("REVISED_CONTENT");

    return {
      revisedContent,
      wordCount: revisedContent.length,
      fixedIssues,
      updatedState: extract("UPDATED_STATE") || this.missingStatePlaceholder(language),
      updatedLedger: gp.numericalSystem
        ? (extract("UPDATED_LEDGER") || this.missingLedgerPlaceholder(language))
        : "",
      updatedHooks: extract("UPDATED_HOOKS") || this.missingHooksPlaceholder(language),
    };
  }

  private async readFileSafe(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件不存在)";
    }
  }

  private missingStatePlaceholder(language: "ko" | "zh" | "en"): string {
    return language === "ko" ? "(상태 카드 미갱신)" : "(状态卡未更新)";
  }

  private missingLedgerPlaceholder(language: "ko" | "zh" | "en"): string {
    return language === "ko" ? "(장부 미갱신)" : "(账本未更新)";
  }

  private missingHooksPlaceholder(language: "ko" | "zh" | "en"): string {
    return language === "ko" ? "(복선 풀 미갱신)" : "(伏笔池未更新)";
  }

  private buildReducedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: "ko" | "zh" | "en",
  ): string {
    const selectedContext = contextPackage.selectedContext
      .map((entry) => `- ${entry.source}: ${entry.reason}${entry.excerpt ? ` | ${entry.excerpt}` : ""}`)
      .join("\n");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";

    if (language === "ko") {
      return `\n## 이번 화 제어 입력 (Planner/Composer가 컴파일함)
${chapterIntent}

### 선택된 컨텍스트
${selectedContext || "- 없음"}

### 규칙 스택
- 하드 가드레일: ${ruleStack.sections.hard.join(", ") || "(없음)"}
- 소프트 제약: ${ruleStack.sections.soft.join(", ") || "(없음)"}
- 진단 규칙: ${ruleStack.sections.diagnostic.join(", ") || "(없음)"}

### 현재 오버라이드
${overrides === "- none" ? "- 없음" : overrides}\n`;
    }

    return `\n## 本章控制输入（由 Planner/Composer 编译）
${chapterIntent}

### 已选上下文
${selectedContext || "- none"}

### 规则栈
- 硬护栏：${ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${ruleStack.sections.diagnostic.join("、") || "(无)"}

### 当前覆盖
${overrides}\n`;
  }
}
