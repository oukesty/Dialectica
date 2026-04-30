import {
  createDefaultGoal,
  createDiscussionRoom,
  createEmptyInsights,
  createEmptySummary,
  createProviderSnapshot,
} from "@/lib/factories";
import { discussionProjectSchema } from "@/lib/schema";
import { deriveAvatarPreset } from "@/lib/avatar";
import {
  AppLocale,
  DiscussionProject,
  ExportFormat,
  ImportPayload,
  ImportResult,
  Participant,
  TranscriptEntry,
} from "@/lib/types";
import { createId, pickInitials } from "@/lib/utils";

const participantPalette = ["#b45309", "#1d4ed8", "#0f766e", "#7c3aed", "#be123c"];

const localeLabels: Partial<Record<AppLocale, Record<string, string>>> & { en: Record<string, string> } = {
  "zh-CN": {
    importedTitle: "导入讨论项目",
    importedDescription: "由导入内容自动生成的讨论项目，可继续接入 AI 进行结构化总结与评估。",
    importedParticipantStance: "导入内容参与者",
    importedParticipantBio: "由导入内容自动创建。",
    participants: "参与者",
    timeline: "时间线",
    nodes: "论点节点",
    insights: "争议追踪",
    overview: "讨论概览",
    coreTopics: "核心议题",
    majorClaims: "主要观点",
    keyEvidence: "关键证据",
    majorRebuttals: "主要反驳",
    unresolved: "未解决问题",
    conclusion: "当前结论",
    nextSteps: "下一步建议",
    goal: "目标",
    provider: "模型提供方",
    unknown: "未知",
    none: "无",
  },
  en: {
    importedTitle: "Imported discussion",
    importedDescription: "Discussion project generated from imported content, ready for structured AI summaries and evaluation.",
    importedParticipantStance: "Imported participant",
    importedParticipantBio: "Created automatically from imported content.",
    participants: "Participants",
    timeline: "Timeline",
    nodes: "Argument Nodes",
    insights: "Insight Tracker",
    overview: "Overview",
    coreTopics: "Core Topics",
    majorClaims: "Major Claims",
    keyEvidence: "Key Evidence",
    majorRebuttals: "Major Rebuttals",
    unresolved: "Unresolved Questions",
    conclusion: "Current Conclusion",
    nextSteps: "Next Steps",
    goal: "Goal",
    provider: "Provider",
    unknown: "Unknown",
    none: "None",
  },
  ja: {
    importedTitle: "インポートしたディスカッション",
    importedDescription: "インポートした内容から生成されたディスカッションプロジェクトです。AI による構造化要約と評価の準備が整っています。",
    importedParticipantStance: "インポート参加者",
    importedParticipantBio: "インポート内容から自動作成されました。",
    participants: "参加者",
    timeline: "タイムライン",
    nodes: "論点ノード",
    insights: "インサイトトラッカー",
    overview: "概要",
    coreTopics: "主要トピック",
    majorClaims: "主要主張",
    keyEvidence: "主要証拠",
    majorRebuttals: "主な反論",
    unresolved: "未解決の問い",
    conclusion: "現時点の結論",
    nextSteps: "次のアクション",
    goal: "目的",
    provider: "モデルプロバイダー",
    unknown: "不明",
    none: "なし",
  },
  ko: {
    importedTitle: "가져온 토론",
    importedDescription: "가져온 내용으로 생성된 토론 프로젝트입니다. 구조화된 AI 요약과 평가를 이어서 진행할 수 있습니다.",
    importedParticipantStance: "가져온 참여자",
    importedParticipantBio: "가져온 내용에서 자동 생성되었습니다.",
    participants: "참여자",
    timeline: "타임라인",
    nodes: "논점 노드",
    insights: "인사이트 추적기",
    overview: "개요",
    coreTopics: "핵심 주제",
    majorClaims: "주요 주장",
    keyEvidence: "핵심 근거",
    majorRebuttals: "주요 반박",
    unresolved: "미해결 질문",
    conclusion: "현재 결론",
    nextSteps: "다음 단계",
    goal: "목표",
    provider: "모델 제공자",
    unknown: "알 수 없음",
    none: "없음",
  },
  fr: {
    importedTitle: "Discussion importee",
    importedDescription: "Projet de discussion genere a partir du contenu importe, pret pour des syntheses et evaluations IA structurees.",
    importedParticipantStance: "Participant importe",
    importedParticipantBio: "Cree automatiquement a partir du contenu importe.",
    participants: "Participants",
    timeline: "Chronologie",
    nodes: "Noeuds argumentatifs",
    insights: "Suivi des controverses",
    overview: "Vue d'ensemble",
    coreTopics: "Sujets centraux",
    majorClaims: "Arguments majeurs",
    keyEvidence: "Preuves cles",
    majorRebuttals: "Principaux contre-arguments",
    unresolved: "Questions non resolues",
    conclusion: "Conclusion actuelle",
    nextSteps: "Prochaines actions",
    goal: "Objectif",
    provider: "Fournisseur de modele",
    unknown: "Inconnu",
    none: "Aucun",
  },
  ru: {
    importedTitle: "Импортированное обсуждение",
    importedDescription: "Проект обсуждения, созданный из импортированного содержимого и готовый к структурированным AI-сводкам и оценке.",
    importedParticipantStance: "Импортированный участник",
    importedParticipantBio: "Создано автоматически из импортированного содержимого.",
    participants: "Участники",
    timeline: "Хронология",
    nodes: "Узлы аргументов",
    insights: "Трекер инсайтов",
    overview: "Обзор",
    coreTopics: "Ключевые темы",
    majorClaims: "Основные тезисы",
    keyEvidence: "Ключевые доказательства",
    majorRebuttals: "Основные возражения",
    unresolved: "Нерешённые вопросы",
    conclusion: "Текущий вывод",
    nextSteps: "Следующие шаги",
    goal: "Цель",
    provider: "Провайдер",
    unknown: "Неизвестно",
    none: "Нет",
  },
} satisfies (Partial<Record<AppLocale, Record<string, string>>> & { en: Record<string, string> });

function labels(locale: AppLocale) {
  return localeLabels[locale] ?? localeLabels.en;
}

function isStructuralMarkdownLine(line: string) {
  const trimmed = line.trim();
  return (
    trimmed.length === 0
    || /^#{1,6}\s+/.test(trimmed)
    || /^>\s*/.test(trimmed)
    || /^```/.test(trimmed)
    || /^---+$/.test(trimmed)
    || /^##\s+/.test(trimmed)
  );
}

function parseSpeakerLine(line: string) {
  const cleaned = line.trim().replace(/^[-*+]\s*/, "").replace(/^>\s*/, "");
  const speakerMatch = cleaned.match(/^(?:\[(?<timestamp>[^\]]+)\]\s*)?(?<speaker>[^:：]{1,80})[:：]\s*(?<content>.+)$/);
  if (speakerMatch?.groups?.speaker && speakerMatch.groups.content) {
    return {
      speaker: speakerMatch.groups.speaker.trim(),
      content: speakerMatch.groups.content.trim(),
      timestamp: speakerMatch.groups.timestamp?.trim(),
    };
  }

  const exportedTimelineMatch = cleaned.match(/^[-*+]\s*(?<timestamp>[^|]+?)\s*\|\s*\*\*(?<speaker>.+?)\*\*\s*\|\s*(?<content>.+)$/);
  if (exportedTimelineMatch?.groups?.speaker && exportedTimelineMatch.groups.content) {
    return {
      speaker: exportedTimelineMatch.groups.speaker.trim(),
      content: exportedTimelineMatch.groups.content.trim(),
      timestamp: exportedTimelineMatch.groups.timestamp?.trim(),
    };
  }

  return undefined;
}

function toTimestamp(candidate: string | undefined, fallbackIndex: number) {
  if (candidate) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date(Date.now() + fallbackIndex * 60_000).toISOString();
}

function buildParticipant(name: string, index: number, locale: AppLocale): Participant {
  return {
    id: createId("participant"),
    name,
    role: "speaker",
    collaborationRole: index === 0 ? "host" : "participant",
    stance: labels(locale).importedParticipantStance,
    color: participantPalette[index % participantPalette.length],
    bio: labels(locale).importedParticipantBio,
    avatarLabel: pickInitials(name),
    avatarPreset: deriveAvatarPreset(name),
    avatarImageDataUrl: "",
    presence: {
      status: index === 0 ? "online" : "offline",
      lastSeenAt: new Date().toISOString(),
      isTyping: false,
    },
  };
}

function buildImportedProject(
  title: string,
  locale: AppLocale,
  participants: Participant[],
  entries: TranscriptEntry[],
  description?: string,
): DiscussionProject {
  const timestamp = new Date().toISOString();
  const goal = createDefaultGoal(locale, "discussion");
  const room = createDiscussionRoom(locale, goal, participants);
  const hydratedEntries = entries.map((entry) => ({
    ...entry,
    roomId: room.id,
    sessionId: room.session.id,
  }));

  return discussionProjectSchema.parse({
    id: createId("project"),
    title,
    description: description?.trim() || labels(locale).importedDescription,
    scenario: "discussion",
    language: locale,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "active",
    goal,
    tags: [],
    participants,
    entries: hydratedEntries,
    nodes: [],
    relations: [],
    insights: createEmptyInsights(timestamp),
    summary: createEmptySummary(locale),
    room,
    providerSnapshot: createProviderSnapshot("mock", "rule-balanced-v1", "import", timestamp),
    metadata: {
      isSample: false,
      source: "import",
    },
  });
}

function importJsonProject(content: string): ImportResult {
  const parsed = discussionProjectSchema.parse(JSON.parse(content));
  return { project: parsed, warnings: [] };
}

function importTranscript(content: string, locale: AppLocale, format: "txt" | "markdown"): ImportResult {
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];
  const speakerMap = new Map<string, Participant>();
  const entries: TranscriptEntry[] = [];
  const copy = labels(locale);

  let title = copy.importedTitle;
  let description = "";

  if (format === "markdown") {
    const heading = lines.find((line) => /^#\s+/.test(line.trim()));
    if (heading) {
      title = heading.replace(/^#\s+/, "").trim() || title;
    }

    const descriptionLines = lines
      .filter((line) => !/^#/.test(line.trim()))
      .filter((line) => !/^>/.test(line.trim()))
      .filter((line) => line.trim().length > 0)
      .slice(0, 2)
      .filter((line) => !parseSpeakerLine(line));

    if (descriptionLines.length > 0) {
      description = descriptionLines.join(" ");
    }
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const parsed = parseSpeakerLine(line);
    if (!parsed) {
      if (format === "markdown" && isStructuralMarkdownLine(line)) {
        return;
      }
      if (/^[-*+]\s+\*\*.+\*\*\s*\(.+\)\s*-/.test(trimmed)) {
        return;
      }
      warnings.push(`Skipped line ${index + 1}: ${trimmed}`);
      return;
    }

    let participant = speakerMap.get(parsed.speaker);
    if (!participant) {
      participant = buildParticipant(parsed.speaker, speakerMap.size, locale);
      speakerMap.set(parsed.speaker, participant);
    }

    entries.push({
      id: createId("entry"),
      participantId: participant.id,
      ownerParticipantId: participant.id,
      roomId: "pending-room",
      sessionId: "pending-session",
      occurredAt: toTimestamp(parsed.timestamp, entries.length),
      content: parsed.content,
      tags: [],
      kind: "statement",
      highlighted: false,
      linkedNodeIds: [],
      relatedEntryIds: [],
      source: "import",
      syncState: "local",
    });
  });

  return {
    project: buildImportedProject(title, locale, [...speakerMap.values()], entries, description),
    warnings,
  };
}

function joinLines(lines: Array<string | undefined | false>) {
  return lines.filter(Boolean).join("\n");
}

function listOrFallback(items: string[], fallback: string) {
  if (items.length === 0) {
    return `- ${fallback}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

export function importProject(payload: ImportPayload): ImportResult {
  if (payload.format === "json") {
    return importJsonProject(payload.content);
  }

  if (payload.format === "markdown") {
    return importTranscript(payload.content, payload.locale, "markdown");
  }

  return importTranscript(payload.content, payload.locale, "txt");
}

export function exportProject(project: DiscussionProject, format: ExportFormat) {
  switch (format) {
    case "json":
      return JSON.stringify(project, null, 2);
    case "txt":
      return projectToText(project);
    case "markdown":
      return projectToMarkdown(project);
    default:
      return JSON.stringify(project, null, 2);
  }
}

export function projectToText(project: DiscussionProject) {
  const copy = labels(project.language);
  const participantSummary = project.participants
    .map((participant) => `${participant.name} (${participant.role}/${participant.collaborationRole})`)
    .join(", ");

  const timeline = project.entries
    .map((entry) => {
      const participant = project.participants.find((candidate) => candidate.id === entry.participantId);
      return `[${entry.occurredAt}] ${participant?.name ?? copy.unknown}: ${entry.content}`;
    })
    .join("\n");

  return joinLines([
    project.title,
    project.description,
    `${copy.goal}: ${project.goal}`,
    `${copy.provider}: ${project.providerSnapshot.providerId} (${project.providerSnapshot.model})`,
    `${copy.participants}: ${participantSummary || copy.none}`,
    "",
    `${copy.timeline}:`,
    timeline,
  ]);
}

export function projectToMarkdown(project: DiscussionProject) {
  const copy = labels(project.language);
  const participantLines = project.participants
    .map((participant) => {
      const stance = participant.stance ? ` - ${participant.stance}` : "";
      return `- **${participant.name}** (${participant.role} / ${participant.collaborationRole})${stance}`;
    })
    .join("\n");

  const timeline = project.entries
    .map((entry) => {
      const participant = project.participants.find((candidate) => candidate.id === entry.participantId);
      return `- ${entry.occurredAt} | **${participant?.name ?? copy.unknown}** | ${entry.content}`;
    })
    .join("\n");

  const nodes = project.nodes
    .map((node) => `- **${node.title}** (${node.type}) - ${node.description}`)
    .join("\n");

  const insights = project.insights.items
    .map((item) => `- **${item.title}** - ${item.detail}`)
    .join("\n");

  return [
    `# ${project.title}`,
    "",
    project.description,
    "",
    `> ${copy.goal}: ${project.goal}`,
    `> ${copy.provider}: ${project.providerSnapshot.providerId} (${project.providerSnapshot.model})`,
    "",
    `## ${copy.participants}`,
    participantLines || `- ${copy.none}`,
    "",
    `## ${copy.timeline}`,
    timeline || `- ${copy.none}`,
    "",
    `## ${copy.nodes}`,
    nodes || `- ${copy.none}`,
    "",
    `## ${copy.insights}`,
    insights || `- ${copy.none}`,
    "",
    `## ${copy.overview}`,
    project.summary.overview,
    "",
    `## ${copy.coreTopics}`,
    listOrFallback(project.summary.coreTopics, copy.none),
    "",
    `## ${copy.majorClaims}`,
    listOrFallback(project.summary.majorClaims, copy.none),
    "",
    `## ${copy.keyEvidence}`,
    listOrFallback(project.summary.keyEvidence, copy.none),
    "",
    `## ${copy.majorRebuttals}`,
    listOrFallback(project.summary.majorRebuttals, copy.none),
    "",
    `## ${copy.unresolved}`,
    listOrFallback(project.summary.unresolvedQuestions, copy.none),
    "",
    `## ${copy.nextSteps}`,
    listOrFallback(project.summary.nextSteps, copy.none),
    "",
    `## ${copy.conclusion}`,
    project.summary.currentConclusion,
  ].join("\n");
}
