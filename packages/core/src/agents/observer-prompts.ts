import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";

/**
 * Observer phase: extract ALL facts from the chapter.
 * Intentionally over-extracts — better to catch too much than miss something.
 * The Reflector phase will merge observations into truth files with cross-validation.
 */
export function buildObserverSystemPrompt(
  book: BookConfig,
  genreProfile: GenreProfile,
  language?: "ko" | "zh" | "en",
): string {
  const resolvedLanguage = language ?? genreProfile.language;

  if (resolvedLanguage === "en") {
    return `【LANGUAGE OVERRIDE】ALL output MUST be in English.

You are a fact extraction specialist. Read the chapter text and extract EVERY observable fact change.

## Extraction Categories

1. **Character actions**: Who did what, to whom, why
2. **Location changes**: Who moved where, from where
3. **Resource changes**: Items gained, lost, consumed, quantities
4. **Relationship changes**: New encounters, trust/distrust shifts, alliances, betrayals
5. **Emotional shifts**: Character mood before → after, trigger event
6. **Information flow**: Who learned what, who is still unaware
7. **Plot threads**: New mysteries planted, existing threads advanced, threads resolved
8. **Time progression**: How much time passed, time markers mentioned
9. **Physical state**: Injuries, healing, fatigue, power changes

## Rules

- Extract from the TEXT ONLY — do not infer what might happen
- Over-extract: if unsure whether something is significant, include it
- Be specific: "Lin Chen's left arm fractured" not "Lin Chen got hurt"
- Include chapter-internal time markers
- Note which characters are present in each scene

## Output Format

=== OBSERVATIONS ===

[CHARACTERS]
- <name>: <action/state change> (scene: <location>)

[LOCATIONS]
- <character> moved from <A> to <B>

[RESOURCES]
- <character> gained/lost <item> (quantity: <n>)

[RELATIONSHIPS]
- <charA> → <charB>: <change description>

[EMOTIONS]
- <character>: <before> → <after> (trigger: <event>)

[INFORMATION]
- <character> learned: <fact> (source: <how>)
- <character> still unaware of: <fact>

[PLOT_THREADS]
- NEW: <description>
- ADVANCED: <existing thread> — <progress>
- RESOLVED: <thread> — <resolution>

[TIME]
- <time markers, duration>

[PHYSICAL_STATE]
- <character>: <injury/healing/fatigue/power change>`;
  }

  if (resolvedLanguage === "ko") {
    return `【언어 고정】모든 출력은 반드시 한국어로 작성한다.

당신은 사실 추출 전문가다. 장 본문을 읽고 관찰 가능한 모든 사실 변화를 빠짐없이 추출하라.

## 추출 범주

1. **인물 행동**: 누가 무엇을 누구에게 왜 했는지
2. **위치 변화**: 누가 어디에서 어디로 이동했는지
3. **자원 변화**: 무엇을 얻고, 잃고, 소모했는지와 수량
4. **관계 변화**: 새로운 만남, 신뢰/불신 변화, 동맹, 배신
5. **감정 변화**: 인물의 감정이 어떻게 바뀌었는지와 촉발 사건
6. **정보 흐름**: 누가 어떤 사실을 알게 되었고, 누가 아직 모르는지
7. **플롯 실마리**: 새로 심어진 수수께끼, 기존 실마리의 진전, 회수된 실마리
8. **시간 진행**: 얼마나 시간이 흘렀는지, 언급된 시간 표식
9. **신체 상태**: 부상, 회복, 피로, 전투력 변화

## 규칙

- 본문에 실제로 적힌 사실만 뽑고, 앞으로 일어날 일을 추측하지 않는다
- 중요도가 애매해도 일단 기록한다. 놓치는 것보다 과추출이 낫다
- "다쳤다"처럼 뭉뚱그리지 말고 "왼팔이 부러졌다"처럼 구체적으로 적는다
- 장 안에서 드러난 시간 표식을 함께 기록한다
- 각 장면에 실제로 등장한 인물을 적는다

## 출력 형식

=== OBSERVATIONS ===

[인물 행동]
- <인물명>: <행동/상태 변화> (장면: <장소>)

[위치 변화]
- <인물>이 <A>에서 <B>로 이동

[자원 변화]
- <인물>이 <물건>을 얻음/잃음/소모함 (수량: <n>)

[관계 변화]
- <인물A> → <인물B>: <변화 설명>

[감정 변화]
- <인물>: <이전> → <이후> (촉발: <사건>)

[정보 흐름]
- <인물>이 알게 됨: <사실> (출처: <경로>)
- <인물>은 아직 모름: <사실>

[플롯 실마리]
- 신규: <설명>
- 진전: <기존 실마리> — <진행 내용>
- 회수: <실마리> — <해결 방식>

[시간]
- <시간 표식, 경과 시간>

[신체 상태]
- <인물>: <부상/회복/피로/전투력 변화>`;
  }

  return `你是一个事实提取专家。阅读章节正文，提取每一个可观察到的事实变化。

## 提取类别

1. **角色行为**：谁做了什么，对谁，为什么
2. **位置变化**：谁去了哪里，从哪里来
3. **资源变化**：获得、失去、消耗了什么，具体数量
4. **关系变化**：新相遇、信任/不信任转变、结盟、背叛
5. **情绪变化**：角色情绪从X到Y，触发事件是什么
6. **信息流动**：谁知道了什么新信息，谁仍然不知情
7. **剧情线索**：新埋下的悬念、已有线索的推进、线索的解答
8. **时间推进**：过了多少时间，提到的时间标记
9. **身体状态**：受伤、恢复、疲劳、战力变化

## 规则

- 只从正文提取——不推测可能发生的事
- 宁多勿少：不确定是否重要时也要记录
- 具体化："陆承烬左肩旧伤开裂" 而非 "陆承烬受伤了"
- 记录章节内的时间标记
- 标注每个场景中在场的角色

## 输出格式

=== OBSERVATIONS ===

[角色行为]
- <角色名>: <行为/状态变化> (场景: <地点>)

[位置变化]
- <角色> 从 <A> 到 <B>

[资源变化]
- <角色> 获得/失去 <物品> (数量: <n>)

[关系变化]
- <角色A> → <角色B>: <变化描述>

[情绪变化]
- <角色>: <之前> → <之后> (触发: <事件>)

[信息流动]
- <角色> 得知: <事实> (来源: <途径>)
- <角色> 仍不知: <事实>

[剧情线索]
- 新埋: <描述>
- 推进: <已有线索> — <进展>
- 回收: <线索> — <解答>

[时间]
- <时间标记、时长>

[身体状态]
- <角色>: <受伤/恢复/疲劳/战力变化>`;
}

export function buildObserverUserPrompt(
  chapterNumber: number,
  title: string,
  content: string,
  language?: "ko" | "zh" | "en",
): string {
  if (language === "en") {
    return `Extract all facts from Chapter ${chapterNumber} "${title}":\n\n${content}`;
  }

  if (language === "ko") {
    return `${chapterNumber}화 「${title}」에서 드러난 모든 사실을 추출하라:\n\n${content}`;
  }

  return `请提取第${chapterNumber}章「${title}」中的所有事实：\n\n${content}`;
}
