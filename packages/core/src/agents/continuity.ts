import { BaseAgent } from "./base.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { FanficMode, WritingLanguage } from "../models/book.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import { readGenreProfile, readBookLanguage, readBookRules } from "./rules-reader.js";
import { getFanficDimensionConfig, FANFIC_DIMENSIONS } from "./fanfic-dimensions.js";
import { readFile, readdir } from "node:fs/promises";
import { filterHooks, filterSummaries, filterSubplots, filterEmotionalArcs, filterCharacterMatrix } from "../utils/context-filter.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import { join } from "node:path";

export interface AuditResult {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly summary: string;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface AuditIssue {
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

type PromptLanguage = WritingLanguage;

const DIMENSION_LABELS: Record<number, { readonly zh: string; readonly en: string; readonly ko: string }> = {
  1: { zh: "OOC检查", en: "OOC Check", ko: "캐릭터 붕괴 점검" },
  2: { zh: "时间线检查", en: "Timeline Check", ko: "시간선 점검" },
  3: { zh: "设定冲突", en: "Lore Conflict Check", ko: "설정 충돌 점검" },
  4: { zh: "战力崩坏", en: "Power Scaling Check", ko: "전력 체계 점검" },
  5: { zh: "数值检查", en: "Numerical Consistency Check", ko: "수치 일관성 점검" },
  6: { zh: "伏笔检查", en: "Hook Check", ko: "복선 점검" },
  7: { zh: "节奏检查", en: "Pacing Check", ko: "전개 리듬 점검" },
  8: { zh: "文风检查", en: "Style Check", ko: "문체 점검" },
  9: { zh: "信息越界", en: "Information Boundary Check", ko: "정보 경계 점검" },
  10: { zh: "词汇疲劳", en: "Lexical Fatigue Check", ko: "어휘 피로도 점검" },
  11: { zh: "利益链断裂", en: "Incentive Chain Check", ko: "이해관계 사슬 점검" },
  12: { zh: "年代考据", en: "Era Accuracy Check", ko: "시대 고증 점검" },
  13: { zh: "配角降智", en: "Side Character Competence Check", ko: "조연 역량 점검" },
  14: { zh: "配角工具人化", en: "Side Character Instrumentalization Check", ko: "조연 도구화 점검" },
  15: { zh: "爽点虚化", en: "Payoff Dilution Check", ko: "보상감 희석 점검" },
  16: { zh: "台词失真", en: "Dialogue Authenticity Check", ko: "대사 진정성 점검" },
  17: { zh: "流水账", en: "Chronicle Drift Check", ko: "나열식 서술 점검" },
  18: { zh: "知识库污染", en: "Knowledge Base Pollution Check", ko: "지식 베이스 오염 점검" },
  19: { zh: "视角一致性", en: "POV Consistency Check", ko: "시점 일관성 점검" },
  20: { zh: "段落等长", en: "Paragraph Uniformity Check", ko: "문단 획일성 점검" },
  21: { zh: "套话密度", en: "Cliche Density Check", ko: "상투어 밀도 점검" },
  22: { zh: "公式化转折", en: "Formulaic Twist Check", ko: "공식적 반전 점검" },
  23: { zh: "列表式结构", en: "List-like Structure Check", ko: "목록식 구조 점검" },
  24: { zh: "支线停滞", en: "Subplot Stagnation Check", ko: "서브플롯 정체 점검" },
  25: { zh: "弧线平坦", en: "Arc Flatline Check", ko: "감정선 평탄화 점검" },
  26: { zh: "节奏单调", en: "Pacing Monotony Check", ko: "리듬 단조화 점검" },
  27: { zh: "敏感词检查", en: "Sensitive Content Check", ko: "민감 표현 점검" },
  28: { zh: "正传事件冲突", en: "Mainline Canon Event Conflict", ko: "본편 사건 충돌 점검" },
  29: { zh: "未来信息泄露", en: "Future Knowledge Leak Check", ko: "미래 정보 누설 점검" },
  30: { zh: "世界规则跨书一致性", en: "Cross-Book World Rule Check", ko: "세계 규칙 교차 일관성 점검" },
  31: { zh: "番外伏笔隔离", en: "Spinoff Hook Isolation Check", ko: "외전 복선 격리 점검" },
  32: { zh: "读者期待管理", en: "Reader Expectation Check", ko: "독자 기대 관리 점검" },
  33: { zh: "大纲偏离检测", en: "Outline Drift Check", ko: "개요 이탈 점검" },
  34: { zh: "角色还原度", en: "Character Fidelity Check", ko: "캐릭터 재현도 점검" },
  35: { zh: "世界规则遵守", en: "World Rule Compliance Check", ko: "세계 규칙 준수 점검" },
  36: { zh: "关系动态", en: "Relationship Dynamics Check", ko: "관계 역학 점검" },
  37: { zh: "正典事件一致性", en: "Canon Event Consistency Check", ko: "정전 사건 일치 점검" },
};

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/u.test(text);
}

function resolveGenreLabel(genreId: string, profileName: string, language: PromptLanguage): string {
  if (language === "zh" || !containsChinese(profileName)) {
    return profileName;
  }

  if (genreId === "other") {
    return "general";
  }

  return genreId.replace(/[_-]+/g, " ");
}

function dimensionName(id: number, language: PromptLanguage): string | undefined {
  return DIMENSION_LABELS[id]?.[language];
}

function joinLocalized(items: ReadonlyArray<string>, language: PromptLanguage): string {
  return items.join(language === "en" || language === "ko" ? ", " : "、");
}

function formatFanficSeverityNote(
  severity: "critical" | "warning" | "info",
  language: PromptLanguage,
): string {
  if (language === "en") {
    return severity === "critical"
      ? "Strict check."
      : severity === "info"
        ? "Log only; do not fail the chapter."
        : "Warning level.";
  }

  if (language === "ko") {
    return severity === "critical"
      ? "엄격 심사 항목."
      : severity === "info"
        ? "기록만 하고, 화 실패 판정에는 사용하지 않는다."
        : "경고 수준.";
  }

  return severity === "critical"
    ? "（严格检查）"
    : severity === "info"
      ? "（仅记录，不判定失败）"
      : "（警告级别）";
}

function buildDimensionNote(
  id: number,
  language: PromptLanguage,
  gp: GenreProfile,
  bookRules: BookRules | null,
  fanficMode: FanficMode | undefined,
  fanficConfig: ReturnType<typeof getFanficDimensionConfig> | undefined,
): string {
  const words = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : gp.fatigueWords;

  if (fanficConfig?.notes.has(id) && language === "zh") {
    return fanficConfig.notes.get(id)!;
  }

  if (id === 1 && fanficMode === "ooc") {
      return language === "en"
        ? "In OOC mode, personality drift can be intentional; record only, do not fail. Evaluate against the character dossiers in fanfic_canon.md."
        : language === "ko"
          ? "OOC 모드에서는 성격 이탈이 의도일 수 있다. 기록만 하고 실패 판정은 하지 않는다. fanfic_canon.md의 캐릭터 도감을 기준으로 본다."
        : "OOC模式下角色可偏离性格底色，此维度仅记录不判定失败。参照 fanfic_canon.md 角色档案评估偏离程度。";
  }

  if (id === 1 && fanficMode === "canon") {
      return language === "en"
        ? "Canon-faithful fanfic: characters must stay close to their original personality core. Evaluate against fanfic_canon.md character dossiers."
        : language === "ko"
          ? "정전 지향 동인에서는 캐릭터가 원작의 성격 핵심에 가깝게 유지되어야 한다. fanfic_canon.md 인물 자료를 기준으로 본다."
        : "原作向同人：角色必须严格遵守性格底色。参照 fanfic_canon.md 角色档案中的性格底色和行为模式。";
  }

  if (id === 10 && words.length > 0) {
      return language === "en"
        ? `Fatigue words: ${words.join(", ")}. Also check AI tell markers (仿佛/不禁/宛如/竟然/忽然/猛地); warn when any appears more than once per 3,000 words.`
        : language === "ko"
          ? `고피로 어휘: ${words.join(", ")}. AI 표식어(仿佛/不禁/宛如/竟然/忽然/猛地) 밀도도 함께 본다. 3000자당 1회를 넘기면 경고한다.`
        : `高疲劳词：${words.join("、")}。同时检查AI标记词（仿佛/不禁/宛如/竟然/忽然/猛地）密度，每3000字超过1次即warning`;
  }

  if (id === 15 && gp.satisfactionTypes.length > 0) {
      return language === "en"
        ? `Payoff types: ${gp.satisfactionTypes.join(", ")}`
        : language === "ko"
          ? `보상감 유형: ${gp.satisfactionTypes.join(", ")}`
        : `爽点类型：${gp.satisfactionTypes.join("、")}`;
  }

  if (id === 12 && bookRules?.eraConstraints) {
    const era = bookRules.eraConstraints;
    const parts = [era.period, era.region].filter(Boolean);
    if (parts.length > 0) {
      return language === "en"
        ? `Era: ${parts.join(", ")}`
        : language === "ko"
          ? `시대 배경: ${parts.join(", ")}`
        : `年代：${parts.join("，")}`;
    }
  }

  switch (id) {
    case 19:
      return language === "en"
        ? "Check whether POV shifts are signaled clearly and stay consistent with the configured viewpoint."
        : language === "ko"
          ? "시점 전환이 분명하게 신호되고, 설정된 시점 규칙과 일관되는지 본다."
        : "检查视角切换是否有过渡、是否与设定视角一致";
    case 24:
      return language === "en"
        ? "Cross-check subplot_board and chapter_summaries: flag any subplot that stays dormant long enough to feel abandoned, or a recent run where every subplot is only restated instead of genuinely moving."
        : language === "ko"
          ? "subplot_board와 chapter_summaries를 대조해, 너무 오래 방치되어 버려진 것처럼 보이는 서브플롯이나 최근 화에서 말만 반복되고 실제로 움직이지 않는 서브플롯을 표시한다."
        : "对照 subplot_board 和 chapter_summaries：标记那些沉寂到接近被遗忘的支线，或近期连续只被重复提及、没有真实推进的支线。";
    case 25:
      return language === "en"
        ? "Cross-check emotional_arcs and chapter_summaries: flag any major character whose emotional line holds one pressure shape across a run instead of taking new pressure, release, reversal, or reinterpretation. Distinguish unchanged circumstances from unchanged inner movement."
        : language === "ko"
          ? "emotional_arcs와 chapter_summaries를 대조해, 주요 인물이 같은 압박 형태에 너무 오래 머물러 새 압력, 해소, 반전, 재해석이 없는 경우를 표시한다. 처지가 안 바뀐 것과 내면이 안 움직인 것은 구분한다."
        : "对照 emotional_arcs 和 chapter_summaries：标记主要角色在一段时间内始终停留在同一种情绪压力形态、没有新压力、释放、转折或重估的情况。注意区分'处境未变'和'内心未变'。";
    case 26:
      return language === "en"
        ? "Cross-check chapter_summaries for chapter-type distribution: warn when the recent sequence stays in the same mode long enough to flatten rhythm, or when payoff / release beats disappear for too long. Explicitly list the recent type sequence."
        : language === "ko"
          ? "chapter_summaries의 화 타입 분포를 대조해, 최근 연속 구간이 같은 모드에 너무 오래 머물러 리듬이 평평해지거나 보상/이완 박자가 지나치게 오래 사라졌는지 경고한다. 최근 타입 시퀀스를 분명히 적는다."
        : "对照 chapter_summaries 的章节类型分布：当近期章节长时间停留在同一种模式、把节奏压平，或回收/释放/高潮章节缺席过久时给出 warning。请明确列出最近章节的类型序列。";
    case 28:
      return language === "en"
        ? "Check whether spinoff events contradict the mainline canon constraints."
        : "检查番外事件是否与正典约束表矛盾";
    case 29:
      return language === "en"
        ? "Check whether characters reference information that should only be revealed after the divergence point (see the information-boundary table)."
        : "检查角色是否引用了分歧点之后才揭示的信息（参照信息边界表）";
    case 30:
      return language === "en"
        ? "Check whether the spinoff violates mainline world rules (power system, geography, factions)."
        : "检查番外是否违反正传世界规则（力量体系、地理、阵营）";
    case 31:
      return language === "en"
        ? "Check whether the spinoff resolves mainline hooks without authorization (warning level)."
        : "检查番外是否越权回收正传伏笔（warning级别）";
    case 32:
      return language === "en"
        ? "Check whether the ending renews curiosity, whether promised payoffs are landing on the cadence their hooks imply, whether pressure gets any release, and whether reader expectation gaps are accumulating faster than they are being satisfied."
        : "检查：章尾是否重新点燃好奇心，已经承诺的回收是否按伏笔自身节奏落地，压力是否得到释放，读者期待缺口是在持续累积还是在被满足。";
    case 33:
      return language === "en"
        ? "Cross-check volume_outline: does this chapter match the planned beat for the current chapter range? Did it skip planned nodes or consume later nodes too early? Does actual pacing match the planned chapter span? If a beat planned for N chapters is consumed in 1-2 chapters -> critical."
        : "对照 volume_outline：本章内容是否对应卷纲中当前章节范围的剧情节点？是否跳过了节点或提前消耗了后续节点？剧情推进速度是否与卷纲规划的章节跨度匹配？如果卷纲规划某段剧情跨N章但实际1-2章就讲完→critical";
    case 34:
    case 35:
    case 36:
    case 37: {
      if (!fanficConfig) return "";
      const severity = fanficConfig.severityOverrides.get(id) ?? "warning";
      const baseNote = language === "en"
        ? {
            34: "Check whether dialogue tics, speaking style, and behavior remain consistent with the character dossiers in fanfic_canon.md. Deviations need clear situational motivation.",
            35: "Check whether the chapter violates world rules documented in fanfic_canon.md (geography, power system, faction relations).",
            36: "Check whether relationship beats remain plausible and aligned with, or meaningfully develop from, the key relationships documented in fanfic_canon.md.",
            37: "Check whether the chapter contradicts the key event timeline in fanfic_canon.md.",
          }[id]
        : FANFIC_DIMENSIONS.find((dimension) => dimension.id === id)?.baseNote;

      return baseNote
        ? `${baseNote} ${formatFanficSeverityNote(severity, language)}`
        : "";
    }
    default:
      return "";
  }
}

function buildDimensionList(
  gp: GenreProfile,
  bookRules: BookRules | null,
  language: PromptLanguage,
  hasParentCanon = false,
  fanficMode?: FanficMode,
): ReadonlyArray<{ readonly id: number; readonly name: string; readonly note: string }> {
  const activeIds = new Set(gp.auditDimensions);

  // Add book-level additional dimensions (supports both numeric IDs and name strings)
  if (bookRules?.additionalAuditDimensions) {
    // Build reverse lookup: name → id
    const nameToId = new Map<string, number>();
    for (const [id, labels] of Object.entries(DIMENSION_LABELS)) {
      nameToId.set(labels.zh, Number(id));
      nameToId.set(labels.en, Number(id));
    }

    for (const d of bookRules.additionalAuditDimensions) {
      if (typeof d === "number") {
        activeIds.add(d);
      } else if (typeof d === "string") {
        // Try exact match first, then substring match
        const exactId = nameToId.get(d);
        if (exactId !== undefined) {
          activeIds.add(exactId);
        } else {
          // Fuzzy: find dimension whose name contains the string
          for (const [name, id] of nameToId) {
            if (name.includes(d) || d.includes(name)) {
              activeIds.add(id);
              break;
            }
          }
        }
      }
    }
  }

  // Always-active dimensions
  activeIds.add(32); // 读者期待管理 — universal
  activeIds.add(33); // 大纲偏离检测 — universal

  // Conditional overrides
  if (gp.eraResearch || bookRules?.eraConstraints?.enabled) {
    activeIds.add(12);
  }

  // Spinoff dimensions — activated when parent_canon.md exists (but NOT in fanfic mode)
  if (hasParentCanon && !fanficMode) {
    activeIds.add(28); // 正传事件冲突
    activeIds.add(29); // 未来信息泄露
    activeIds.add(30); // 世界规则跨书一致性
    activeIds.add(31); // 番外伏笔隔离
  }

  // Fanfic dimensions — replace spinoff dims with fanfic-specific checks
  let fanficConfig: ReturnType<typeof getFanficDimensionConfig> | undefined;
  if (fanficMode) {
    fanficConfig = getFanficDimensionConfig(fanficMode, bookRules?.allowedDeviations);
    for (const id of fanficConfig.activeIds) {
      activeIds.add(id);
    }
    for (const id of fanficConfig.deactivatedIds) {
      activeIds.delete(id);
    }
  }

  const dims: Array<{ id: number; name: string; note: string }> = [];

  for (const id of [...activeIds].sort((a, b) => a - b)) {
    const name = dimensionName(id, language);
    if (!name) continue;

    const note = buildDimensionNote(id, language, gp, bookRules, fanficMode, fanficConfig);

    dims.push({ id, name, note });
  }

  return dims;
}

export class ContinuityAuditor extends BaseAgent {
  get name(): string {
    return "continuity-auditor";
  }

  async auditChapter(
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    genre?: string,
    options?: {
      temperature?: number;
      chapterIntent?: string;
      contextPackage?: ContextPackage;
      ruleStack?: RuleStack;
      truthFileOverrides?: {
        currentState?: string;
        ledger?: string;
        hooks?: string;
      };
    },
  ): Promise<AuditResult> {
    const [diskCurrentState, diskLedger, diskHooks, styleGuideRaw, subplotBoard, emotionalArcs, characterMatrix, chapterSummaries, parentCanon, fanficCanon, volumeOutline] =
      await Promise.all([
        this.readFileSafe(join(bookDir, "story/current_state.md")),
        this.readFileSafe(join(bookDir, "story/particle_ledger.md")),
        this.readFileSafe(join(bookDir, "story/pending_hooks.md")),
        this.readFileSafe(join(bookDir, "story/style_guide.md")),
        this.readFileSafe(join(bookDir, "story/subplot_board.md")),
        this.readFileSafe(join(bookDir, "story/emotional_arcs.md")),
        this.readFileSafe(join(bookDir, "story/character_matrix.md")),
        this.readFileSafe(join(bookDir, "story/chapter_summaries.md")),
        this.readFileSafe(join(bookDir, "story/parent_canon.md")),
        this.readFileSafe(join(bookDir, "story/fanfic_canon.md")),
        this.readFileSafe(join(bookDir, "story/volume_outline.md")),
      ]);
    const currentState = options?.truthFileOverrides?.currentState ?? diskCurrentState;
    const ledger = options?.truthFileOverrides?.ledger ?? diskLedger;
    const hooks = options?.truthFileOverrides?.hooks ?? diskHooks;

    const hasParentCanon = parentCanon !== "(文件不存在)";
    const hasFanficCanon = fanficCanon !== "(文件不存在)";

    // Load last chapter full text for fine-grained continuity checking
    const previousChapter = await this.loadPreviousChapter(bookDir, chapterNumber);

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
      : (parsedRules?.body ?? "(无文风指南)");

    const resolvedLanguage = bookLanguage ?? gp.language;
    const isEnglish = resolvedLanguage === "en";
    const isKorean = resolvedLanguage === "ko";
    const fanficMode = hasFanficCanon ? (bookRules?.fanficMode as FanficMode | undefined) : undefined;
    const dimensions = buildDimensionList(gp, bookRules, resolvedLanguage, hasParentCanon, fanficMode);
    const dimList = dimensions
      .map((d) => `${d.id}. ${d.name}${d.note ? (isEnglish ? ` (${d.note})` : `（${d.note}）`) : ""}`)
      .join("\n");
    const genreLabel = resolveGenreLabel(genreId, gp.name, resolvedLanguage);

    const protagonistBlock = bookRules?.protagonist
      ? isEnglish
        ? `\n\nProtagonist lock: ${bookRules.protagonist.name}; personality locks: ${joinLocalized(bookRules.protagonist.personalityLock, resolvedLanguage)}; behavioral constraints: ${joinLocalized(bookRules.protagonist.behavioralConstraints, resolvedLanguage)}.`
        : isKorean
          ? `\n\n주인공 고정값: ${bookRules.protagonist.name}; 성격 고정값: ${joinLocalized(bookRules.protagonist.personalityLock, resolvedLanguage)}; 행동 제약: ${joinLocalized(bookRules.protagonist.behavioralConstraints, resolvedLanguage)}.`
        : `\n主角人设锁定：${bookRules.protagonist.name}，${bookRules.protagonist.personalityLock.join("、")}，行为约束：${bookRules.protagonist.behavioralConstraints.join("、")}`
      : "";

    const searchNote = gp.eraResearch
      ? isEnglish
        ? "\n\nYou have web-search capability (search_web / fetch_url). For real-world eras, people, events, geography, or policies, you must verify with search_web instead of relying on memory. Cross-check at least 2 sources."
        : isKorean
          ? "\n\n당신은 웹 검색 기능(search_web / fetch_url)을 사용할 수 있다. 실제 시대, 인물, 사건, 지리, 정책이 나오면 기억에 기대지 말고 반드시 검색으로 확인하라. 최소 2개 출처를 교차 검증한다."
        : "\n\n你有联网搜索能力（search_web / fetch_url）。对于涉及真实年代、人物、事件、地理、政策的内容，你必须用search_web核实，不可凭记忆判断。至少对比2个来源交叉验证。"
      : "";

    const systemPrompt = isEnglish
      ? `You are a strict ${genreLabel} web fiction editor. Audit the chapter for continuity, consistency, and quality. ALL OUTPUT MUST BE IN ENGLISH.${protagonistBlock}${searchNote}

Audit dimensions:
${dimList}

Output format MUST be JSON:
{
  "passed": true/false,
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "dimension name",
      "description": "specific issue description",
      "suggestion": "fix suggestion"
    }
  ],
  "summary": "one-sentence audit conclusion"
}

passed is false ONLY when critical-severity issues exist.`
      : isKorean
        ? `당신은 엄격한 ${genreLabel} 웹소설 편집자다. 이 화를 연속성, 일관성, 품질 측면에서 심사하라. 모든 출력은 반드시 한국어로 작성한다.${protagonistBlock}${searchNote}

심사 항목:
${dimList}

출력 형식은 반드시 JSON이어야 한다:
{
  "passed": true/false,
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "심사 항목 이름",
      "description": "구체적인 문제 설명",
      "suggestion": "수정 제안"
    }
  ],
  "summary": "심사 결론 한 문장"
}

critical 등급 문제가 있을 때만 passed를 false로 둔다.`
      : `你是一位严格的${gp.name}网络小说审稿编辑。你的任务是对章节进行连续性、一致性和质量审查。${protagonistBlock}${searchNote}

审查维度：
${dimList}

输出格式必须为 JSON：
{
  "passed": true/false,
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "审查维度名称",
      "description": "具体问题描述",
      "suggestion": "修改建议"
    }
  ],
  "summary": "一句话总结审查结论"
}

只有当存在 critical 级别问题时，passed 才为 false。`;

    const ledgerBlock = gp.numericalSystem
      ? isEnglish
        ? `\n## Resource Ledger\n${ledger}`
        : isKorean
          ? `\n## 자원 장부\n${ledger}`
        : `\n## 资源账本\n${ledger}`
      : "";

    // Smart context filtering for auditor — same logic as writer
    const bookRulesForFilter = parsedRules?.rules ?? null;
    const filteredSubplots = filterSubplots(subplotBoard);
    const filteredArcs = filterEmotionalArcs(emotionalArcs, chapterNumber);
    const filteredMatrix = filterCharacterMatrix(characterMatrix, volumeOutline, bookRulesForFilter?.protagonist?.name);
    const filteredSummaries = filterSummaries(chapterSummaries, chapterNumber);
    const filteredHooks = filterHooks(hooks);

    const governedMemoryBlocks = options?.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(options.contextPackage, resolvedLanguage)
      : undefined;

    const hooksBlock = governedMemoryBlocks?.hooksBlock
      ?? (filteredHooks !== "(文件不存在)"
        ? isEnglish
          ? `\n## Pending Hooks\n${filteredHooks}\n`
          : isKorean
            ? `\n## 현재 복선\n${filteredHooks}\n`
          : `\n## 伏笔池\n${filteredHooks}\n`
        : "");
    const subplotBlock = filteredSubplots !== "(文件不存在)"
      ? isEnglish
        ? `\n## Subplot Board\n${filteredSubplots}\n`
        : isKorean
          ? `\n## 서브플롯 보드\n${filteredSubplots}\n`
        : `\n## 支线进度板\n${filteredSubplots}\n`
      : "";
    const emotionalBlock = filteredArcs !== "(文件不存在)"
      ? isEnglish
        ? `\n## Emotional Arcs\n${filteredArcs}\n`
        : isKorean
          ? `\n## 감정선\n${filteredArcs}\n`
        : `\n## 情感弧线\n${filteredArcs}\n`
      : "";
    const matrixBlock = filteredMatrix !== "(文件不存在)"
      ? isEnglish
        ? `\n## Character Interaction Matrix\n${filteredMatrix}\n`
        : isKorean
          ? `\n## 인물 상호작용 매트릭스\n${filteredMatrix}\n`
        : `\n## 角色交互矩阵\n${filteredMatrix}\n`
      : "";
    const summariesBlock = governedMemoryBlocks?.summariesBlock
      ?? (filteredSummaries !== "(文件不存在)"
        ? isEnglish
          ? `\n## Chapter Summaries (for pacing checks)\n${filteredSummaries}\n`
          : isKorean
            ? `\n## 장 요약 (리듬 점검용)\n${filteredSummaries}\n`
          : `\n## 章节摘要（用于节奏检查）\n${filteredSummaries}\n`
        : "");
    const volumeSummariesBlock = governedMemoryBlocks?.volumeSummariesBlock ?? "";

    const canonBlock = hasParentCanon
      ? isEnglish
        ? `\n## Mainline Canon Reference (for spinoff audit)\n${parentCanon}\n`
        : isKorean
          ? `\n## 본편 정전 참조 (외전 심사용)\n${parentCanon}\n`
        : `\n## 正传正典参照（番外审查专用）\n${parentCanon}\n`
      : "";

    const fanficCanonBlock = hasFanficCanon
      ? isEnglish
        ? `\n## Fanfic Canon Reference (for fanfic audit)\n${fanficCanon}\n`
        : isKorean
          ? `\n## 동인 정전 참조 (동인 심사용)\n${fanficCanon}\n`
        : `\n## 同人正典参照（同人审查专用）\n${fanficCanon}\n`
      : "";

    const outlineBlock = volumeOutline !== "(文件不存在)"
      ? isEnglish
        ? `\n## Volume Outline (for outline drift checks)\n${volumeOutline}\n`
        : isKorean
          ? `\n## 권차 개요 (개요 이탈 점검용)\n${volumeOutline}\n`
        : `\n## 卷纲（用于大纲偏离检测）\n${volumeOutline}\n`
      : "";
    const reducedControlBlock = options?.chapterIntent && options.contextPackage && options.ruleStack
      ? this.buildReducedControlBlock(options.chapterIntent, options.contextPackage, options.ruleStack, resolvedLanguage)
      : "";
    const styleGuideBlock = reducedControlBlock.length === 0
      ? isEnglish
        ? `\n## Style Guide\n${styleGuide}`
        : isKorean
          ? `\n## 문체 가이드\n${styleGuide}`
        : `\n## 文风指南\n${styleGuide}`
      : "";

    const prevChapterBlock = previousChapter
      ? isEnglish
        ? `\n## Previous Chapter Full Text (for transition checks)\n${previousChapter}\n`
        : isKorean
          ? `\n## 직전 화 전문 (연결 점검용)\n${previousChapter}\n`
        : `\n## 上一章全文（用于衔接检查）\n${previousChapter}\n`
      : "";

    const userPrompt = isEnglish
      ? `Review chapter ${chapterNumber}.

## Current State Card
${currentState}
${ledgerBlock}
${hooksBlock}${volumeSummariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${reducedControlBlock || outlineBlock}${prevChapterBlock}${styleGuideBlock}

## Chapter Content Under Review
${chapterContent}`
      : isKorean
        ? `${chapterNumber}화를 심사하라.

## 현재 상태 카드
${currentState}
${ledgerBlock}
${hooksBlock}${volumeSummariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${reducedControlBlock || outlineBlock}${prevChapterBlock}${styleGuideBlock}

## 심사 대상 본문
${chapterContent}`
      : `请审查第${chapterNumber}章。

## 当前状态卡
${currentState}
${ledgerBlock}
${hooksBlock}${volumeSummariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${reducedControlBlock || outlineBlock}${prevChapterBlock}${styleGuideBlock}

## 待审章节内容
${chapterContent}`;

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];
    const chatOptions = { temperature: options?.temperature ?? 0.3 };

    // Use web search for fact verification when eraResearch is enabled
    const response = gp.eraResearch
      ? await this.chatWithSearch(chatMessages, chatOptions)
      : await this.chat(chatMessages, chatOptions);

    const result = this.parseAuditResult(response.content, resolvedLanguage);
    return { ...result, tokenUsage: response.usage };
  }

  private parseAuditResult(content: string, language: PromptLanguage): AuditResult {
    // Try multiple JSON extraction strategies (handles small/local models)

    // Strategy 1: Find balanced JSON object (not greedy)
    const balanced = this.extractBalancedJson(content);
    if (balanced) {
      const result = this.tryParseAuditJson(balanced, language);
      if (result) return result;
    }

    // Strategy 2: Try the whole content as JSON (some models output pure JSON)
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      const result = this.tryParseAuditJson(trimmed, language);
      if (result) return result;
    }

    // Strategy 3: Look for ```json code blocks
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      const result = this.tryParseAuditJson(codeBlockMatch[1]!.trim(), language);
      if (result) return result;
    }

    // Strategy 4: Try to extract individual fields via regex (last resort fallback)
    const passedMatch = content.match(/"passed"\s*:\s*(true|false)/);
    const issuesMatch = content.match(/"issues"\s*:\s*\[([\s\S]*?)\]/);
    const summaryMatch = content.match(/"summary"\s*:\s*"([^"]*)"/);
    if (passedMatch) {
      const issues: AuditIssue[] = [];
      if (issuesMatch) {
        // Try to parse individual issue objects
        const issuePattern = /\{[^{}]*"severity"\s*:\s*"[^"]*"[^{}]*\}/g;
        let match: RegExpExecArray | null;
        while ((match = issuePattern.exec(issuesMatch[1]!)) !== null) {
          try {
            const issue = JSON.parse(match[0]);
            issues.push({
              severity: issue.severity ?? "warning",
              category: issue.category ?? (language === "en" ? "Uncategorized" : language === "ko" ? "미분류" : "未分类"),
              description: issue.description ?? "",
              suggestion: issue.suggestion ?? "",
            });
          } catch {
            // skip malformed individual issue
          }
        }
      }
      return {
        passed: passedMatch[1] === "true",
        issues,
        summary: summaryMatch?.[1] ?? "",
      };
    }

    return {
      passed: false,
      issues: [{
        severity: "critical",
        category: language === "en" ? "System Error" : language === "ko" ? "시스템 오류" : "系统错误",
        description: language === "en"
          ? "Audit output format was invalid and could not be parsed as JSON."
          : language === "ko"
            ? "심사 출력 형식이 잘못되어 JSON으로 파싱할 수 없었다."
          : "审稿输出格式异常，无法解析为 JSON",
        suggestion: language === "en"
          ? "The model may not support reliable structured output. Try a stronger model or inspect the API response format."
          : language === "ko"
            ? "모델이 구조화 출력을 안정적으로 지원하지 않을 수 있다. 더 강한 모델을 쓰거나 API 응답 형식을 점검하라."
          : "可能是模型不支持结构化输出。尝试换一个更大的模型，或检查 API 返回格式。",
      }],
      summary: language === "en" ? "Audit output parsing failed" : language === "ko" ? "심사 출력 파싱 실패" : "审稿输出解析失败",
    };
  }

  private buildReducedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: PromptLanguage,
  ): string {
    const selectedContext = contextPackage.selectedContext
      .map((entry) => `- ${entry.source}: ${entry.reason}${entry.excerpt ? ` | ${entry.excerpt}` : ""}`)
      .join("\n");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";

    return language === "en"
      ? `\n## Chapter Control Inputs (compiled by Planner/Composer)
${chapterIntent}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`
      : language === "ko"
        ? `\n## 이번 화 제어 입력 (Planner/Composer가 컴파일함)
${chapterIntent}

### 선택된 컨텍스트
${selectedContext || "- 없음"}

### 규칙 스택
- 하드 가드레일: ${ruleStack.sections.hard.join(", ") || "(없음)"}
- 소프트 제약: ${ruleStack.sections.soft.join(", ") || "(없음)"}
- 진단 규칙: ${ruleStack.sections.diagnostic.join(", ") || "(없음)"}

### 현재 오버라이드
${overrides === "- none" ? "- 없음" : overrides}\n`
      : `\n## 本章控制输入（由 Planner/Composer 编译）
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

  private extractBalancedJson(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  private tryParseAuditJson(json: string, language: PromptLanguage = "zh"): AuditResult | null {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed.passed !== "boolean" && parsed.passed !== undefined) return null;
      return {
        passed: Boolean(parsed.passed ?? false),
        issues: Array.isArray(parsed.issues)
          ? parsed.issues.map((i: Record<string, unknown>) => ({
              severity: (i.severity as string) ?? "warning",
              category: (i.category as string) ?? (language === "en" ? "Uncategorized" : language === "ko" ? "미분류" : "未分类"),
              description: (i.description as string) ?? "",
              suggestion: (i.suggestion as string) ?? "",
            }))
          : [],
        summary: String(parsed.summary ?? ""),
      };
    } catch {
      return null;
    }
  }

  private async loadPreviousChapter(bookDir: string, currentChapter: number): Promise<string> {
    if (currentChapter <= 1) return "";
    const chaptersDir = join(bookDir, "chapters");
    try {
      const files = await readdir(chaptersDir);
      const paddedPrev = String(currentChapter - 1).padStart(4, "0");
      const prevFile = files.find((f) => f.startsWith(paddedPrev) && f.endsWith(".md"));
      if (!prevFile) return "";
      return await readFile(join(chaptersDir, prevFile), "utf-8");
    } catch {
      return "";
    }
  }

  private async readFileSafe(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件不存在)";
    }
  }
}
