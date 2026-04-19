export type CliLanguage = "ko" | "zh" | "en";

type WriteIssue = {
  readonly severity: string;
  readonly category: string;
  readonly description: string;
};

type WriteResultShape = {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly status: string;
  readonly revised: boolean;
  readonly issues: ReadonlyArray<WriteIssue>;
  readonly auditPassed?: boolean;
  readonly passedAudit?: boolean;
};

type ImportResultShape = {
  readonly importedCount: number;
  readonly totalWords: number;
  readonly nextChapter: number;
  readonly continueBookId: string;
};

function localize(language: CliLanguage, messages: { ko: string; zh: string; en: string }): string {
  if (language === "en") return messages.en;
  return language === "ko" ? messages.ko : messages.zh;
}

export function formatCliLengthCount(count: number, language: CliLanguage): string {
  if (language === "en") return `${count} words`;
  return language === "ko" ? `${count}자` : `${count}字`;
}

export function resolveCliLanguage(language?: string): CliLanguage {
  if (language === "en") return "en";
  if (language === "zh") return "zh";
  return "ko";
}

export function formatBookCreateCreating(
  language: CliLanguage,
  title: string,
  genre: string,
  platform: string,
): string {
  return localize(language, {
    ko: `책 "${title}" 생성 중... (${genre} / ${platform})`,
    zh: `创建书籍 "${title}"（${genre} / ${platform}）...`,
    en: `Creating book "${title}" (${genre} / ${platform})...`,
  });
}

export function formatBookCreateCreated(language: CliLanguage, bookId: string): string {
  return localize(language, {
    ko: `생성된 책: ${bookId}`,
    zh: `已创建书籍：${bookId}`,
    en: `Book created: ${bookId}`,
  });
}

export function formatBookCreateLocation(language: CliLanguage, bookId: string): string {
  return localize(language, {
    ko: `  위치: books/${bookId}/`,
    zh: `  位置：books/${bookId}/`,
    en: `  Location: books/${bookId}/`,
  });
}

export function formatBookCreateFoundationReady(language: CliLanguage): string {
  return localize(language, {
    ko: "  스토리 바이블, 개요, 책 규칙을 생성했습니다.",
    zh: "  故事圣经、大纲和书籍规则已生成。",
    en: "  Story bible, outline, book rules generated.",
  });
}

export function formatBookCreateNextStep(language: CliLanguage, bookId: string): string {
  return localize(language, {
    ko: `다음 단계: inkos write next ${bookId}`,
    zh: `下一步：inkos write next ${bookId}`,
    en: `Next: inkos write next ${bookId}`,
  });
}

export function formatWriteNextProgress(
  language: CliLanguage,
  current: number,
  total: number,
  bookId: string,
): string {
  return localize(language, {
    ko: `[${current}/${total}] "${bookId}"의 다음 화를 집필하는 중...`,
    zh: `[${current}/${total}] 为「${bookId}」撰写章节...`,
    en: `[${current}/${total}] Writing chapter for "${bookId}"...`,
  });
}

export function formatWriteNextResultLines(
  language: CliLanguage,
  result: WriteResultShape,
): string[] {
  const auditPassed = result.auditPassed ?? result.passedAudit ?? false;
  const lengthLabel = formatCliLengthCount(result.wordCount, language);
  const lines = [
    localize(language, {
      ko: `  ${result.chapterNumber}화: ${result.title}`,
      zh: `  第${result.chapterNumber}章：${result.title}`,
      en: `  Chapter ${result.chapterNumber}: ${result.title}`,
    }),
    localize(language, {
      ko: `  분량: ${lengthLabel}`,
      zh: `  字数：${lengthLabel}`,
      en: `  Length: ${lengthLabel}`,
    }),
    localize(language, {
      ko: `  검토: ${auditPassed ? "통과" : "재검토 필요"}`,
      zh: `  审计：${auditPassed ? "通过" : "需复核"}`,
      en: `  Audit: ${auditPassed ? "PASSED" : "NEEDS REVIEW"}`,
    }),
  ];

  if (result.revised) {
    lines.push(localize(language, {
      ko: "  자동 수정: 실행됨 (중요 문제를 보정함)",
      zh: "  自动修正：已执行（已修复关键问题）",
      en: "  Auto-revised: YES (critical issues were fixed)",
    }));
  }

  lines.push(localize(language, {
    ko: `  상태: ${result.status}`,
    zh: `  状态：${result.status}`,
    en: `  Status: ${result.status}`,
  }));

  if (result.issues.length > 0) {
    lines.push(localize(language, {
      ko: "  이슈:",
      zh: "  问题：",
      en: "  Issues:",
    }));
    for (const issue of result.issues) {
      lines.push(`    [${issue.severity}] ${issue.category}: ${issue.description}`);
    }
  }

  return lines;
}

export function formatWriteNextComplete(language: CliLanguage): string {
  return localize(language, {
    ko: "완료.",
    zh: "完成。",
    en: "Done.",
  });
}

export function formatImportChaptersDiscovery(
  language: CliLanguage,
  chapterCount: number,
  bookId: string,
): string {
  return localize(language, {
    ko: `${chapterCount}개 장을 찾아 "${bookId}"에 가져올 준비를 합니다.`,
    zh: `发现 ${chapterCount} 章，准备导入到「${bookId}」。`,
    en: `Found ${chapterCount} chapters to import into "${bookId}".`,
  });
}

export function formatImportChaptersResume(
  language: CliLanguage,
  resumeFrom: number,
): string {
  return localize(language, {
    ko: `${resumeFrom}화부터 이어서 가져옵니다.`,
    zh: `从第 ${resumeFrom} 章继续导入。`,
    en: `Resuming from chapter ${resumeFrom}.`,
  });
}

export function formatImportChaptersComplete(
  language: CliLanguage,
  result: ImportResultShape,
): string[] {
  const lengthLabel = formatCliLengthCount(result.totalWords, language);
  return [
    localize(language, {
      ko: "가져오기 완료:",
      zh: "导入完成：",
      en: "Import complete:",
    }),
    localize(language, {
      ko: `  가져온 화 수: ${result.importedCount}`,
      zh: `  已导入章节：${result.importedCount}`,
      en: `  Chapters imported: ${result.importedCount}`,
    }),
    localize(language, {
      ko: `  총 분량: ${lengthLabel}`,
      zh: `  总长度：${lengthLabel}`,
      en: `  Total length: ${lengthLabel}`,
    }),
    localize(language, {
      ko: `  다음 화 번호: ${result.nextChapter}`,
      zh: `  下一章编号：${result.nextChapter}`,
      en: `  Next chapter number: ${result.nextChapter}`,
    }),
    "",
    localize(language, {
      ko: `"inkos write next ${result.continueBookId}"로 이어서 집필하세요.`,
      zh: `运行 "inkos write next ${result.continueBookId}" 继续写作。`,
      en: `Run "inkos write next ${result.continueBookId}" to continue writing.`,
    }),
  ];
}

export function formatImportCanonStart(
  language: CliLanguage,
  parentBookId: string,
  targetBookId: string,
): string {
  return localize(language, {
    ko: `"${parentBookId}"의 정전을 "${targetBookId}"에 가져오는 중...`,
    zh: `把 "${parentBookId}" 的正典导入到 "${targetBookId}"...`,
    en: `Importing canon from "${parentBookId}" into "${targetBookId}"...`,
  });
}

export function formatImportCanonComplete(language: CliLanguage): string[] {
  return [
    localize(language, {
      ko: "정전 가져오기 완료: story/parent_canon.md",
      zh: "正典已导入：story/parent_canon.md",
      en: "Canon imported: story/parent_canon.md",
    }),
    localize(language, {
      ko: "동인 모드에서는 writer 와 auditor 가 이 파일을 자동으로 인식합니다.",
      zh: "Writer 和 auditor 会在番外模式下自动识别这个文件。",
      en: "Writer and auditor will auto-detect this file for spinoff mode.",
    }),
  ];
}
