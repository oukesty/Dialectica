import { CollaborationEvent } from "@/lib/collaboration/types";
import { AiTask, AppLocale } from "@/lib/types";

type DigestLabels = {
  did: string;
  highlights: string;
  relation: string;
  next: string;
  originalExcerpt: string;
  tasks: Record<AiTask | "knowledgeExtraction" | "conversation", string>;
  relationByTask: Record<AiTask | "knowledgeExtraction" | "conversation", string>;
  nextByTask: Record<AiTask | "knowledgeExtraction" | "conversation", string>;
};

const DIGEST_LABELS: Record<AppLocale, DigestLabels> = {
  "zh-CN": {
    did: "AI 做了什么",
    highlights: "提炼重点",
    relation: "和图谱 / 总结的关系",
    next: "下一步建议",
    originalExcerpt: "原文节选",
    tasks: {
      summarizeDiscussion: "更新讨论总结，提取关键结论、风险和行动项。",
      evaluateDiscussion: "评估讨论质量，识别证据、逻辑和回应度问题。",
      generateFollowupQuestions: "生成后续问题，帮助补齐未解决信息。",
      multiperspectiveSummary: "整理多方视角，压缩不同立场的重点。",
      debateAnalysis: "分析争议结构，区分支持、反对和中立观点。",
      knowledgeExtraction: "提取可进入知识图谱的结构化要点。",
      conversation: "回应当前讨论，并给出局部建议。",
    },
    relationByTask: {
      summarizeDiscussion: "这次介入主要服务于自动总结；其中的结论、风险和行动项可作为图谱候选重点。",
      evaluateDiscussion: "这次介入主要服务于质量评估；证据缺口和分歧可辅助后续图谱筛选。",
      generateFollowupQuestions: "这次介入主要服务于后续追问；问题节点可进入图谱的未解决事项。",
      multiperspectiveSummary: "这次介入主要服务于多视角总结；不同立场可作为图谱观点节点。",
      debateAnalysis: "这次介入主要服务于争议分析；支持和反对关系可作为图谱关系候选。",
      knowledgeExtraction: "这次介入直接服务于知识图谱生成。",
      conversation: "这次介入属于普通 AI 回复，不会自动等同于图谱或总结结果。",
    },
    nextByTask: {
      summarizeDiscussion: "检查总结是否覆盖关键分歧，再决定是否生成或刷新图谱。",
      evaluateDiscussion: "优先补充证据薄弱或回应不足的部分。",
      generateFollowupQuestions: "挑选最关键的问题继续追问。",
      multiperspectiveSummary: "确认各方立场是否准确，再进入决策或图谱整理。",
      debateAnalysis: "优先处理高风险分歧和未解决问题。",
      knowledgeExtraction: "打开图谱检查节点和关系是否聚焦。",
      conversation: "把有价值的建议转成明确行动项或追问。",
    },
  },
  en: {
    did: "What AI did",
    highlights: "Key points",
    relation: "Relation to graph / summary",
    next: "Suggested next step",
    originalExcerpt: "Original excerpt",
    tasks: {
      summarizeDiscussion: "Updated the discussion summary and extracted conclusions, risks, and action items.",
      evaluateDiscussion: "Evaluated discussion quality and identified evidence, logic, and responsiveness gaps.",
      generateFollowupQuestions: "Generated follow-up questions to fill unresolved information.",
      multiperspectiveSummary: "Condensed multiple viewpoints into their main positions.",
      debateAnalysis: "Mapped the dispute structure across supporting, opposing, and neutral points.",
      knowledgeExtraction: "Extracted structured points for the knowledge graph.",
      conversation: "Responded to the current discussion with local guidance.",
    },
    relationByTask: {
      summarizeDiscussion: "This intervention primarily updates the summary; conclusions, risks, and actions can become graph candidates.",
      evaluateDiscussion: "This intervention supports quality review; evidence gaps and disagreements can guide graph filtering.",
      generateFollowupQuestions: "This intervention supports follow-up; open questions can become unresolved graph nodes.",
      multiperspectiveSummary: "This intervention supports multi-view summaries; positions can become viewpoint nodes.",
      debateAnalysis: "This intervention supports dispute analysis; support and opposition can become graph relations.",
      knowledgeExtraction: "This intervention directly supports knowledge graph generation.",
      conversation: "This is a normal AI reply and is not automatically a graph or summary result.",
    },
    nextByTask: {
      summarizeDiscussion: "Check whether the summary covers the main disagreements before refreshing the graph.",
      evaluateDiscussion: "Prioritize weak evidence or unanswered responses.",
      generateFollowupQuestions: "Pick the most important question and continue the discussion.",
      multiperspectiveSummary: "Confirm the positions before turning them into decisions or graph nodes.",
      debateAnalysis: "Resolve high-risk disagreements and open questions first.",
      knowledgeExtraction: "Open the graph and check whether nodes and relations stay focused.",
      conversation: "Turn useful guidance into a concrete action item or follow-up question.",
    },
  },
  ja: {
    did: "AI の実行内容",
    highlights: "要点",
    relation: "グラフ / 要約との関係",
    next: "次の提案",
    originalExcerpt: "原文抜粋",
    tasks: {} as DigestLabels["tasks"],
    relationByTask: {} as DigestLabels["relationByTask"],
    nextByTask: {} as DigestLabels["nextByTask"],
  },
  ko: {
    did: "AI가 한 일",
    highlights: "핵심",
    relation: "그래프 / 요약과의 관계",
    next: "다음 제안",
    originalExcerpt: "원문 발췌",
    tasks: {} as DigestLabels["tasks"],
    relationByTask: {} as DigestLabels["relationByTask"],
    nextByTask: {} as DigestLabels["nextByTask"],
  },
  fr: {
    did: "Ce que l'IA a fait",
    highlights: "Points clés",
    relation: "Lien avec graphe / résumé",
    next: "Prochaine étape",
    originalExcerpt: "Extrait original",
    tasks: {} as DigestLabels["tasks"],
    relationByTask: {} as DigestLabels["relationByTask"],
    nextByTask: {} as DigestLabels["nextByTask"],
  },
  ru: {
    did: "Что сделал ИИ",
    highlights: "Ключевые пункты",
    relation: "Связь с графом / сводкой",
    next: "Следующий шаг",
    originalExcerpt: "Фрагмент исходного текста",
    tasks: {} as DigestLabels["tasks"],
    relationByTask: {} as DigestLabels["relationByTask"],
    nextByTask: {} as DigestLabels["nextByTask"],
  },
};

for (const locale of ["ja", "ko", "fr", "ru"] as const) {
  DIGEST_LABELS[locale].tasks = DIGEST_LABELS.en.tasks;
  DIGEST_LABELS[locale].relationByTask = DIGEST_LABELS.en.relationByTask;
  DIGEST_LABELS[locale].nextByTask = DIGEST_LABELS.en.nextByTask;
}

function compactLine(value: string, maxLength = 170) {
  const cleaned = value
    .replace(/[*_`>#]/g, "")
    .replace(/^\s*[-\d.)]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trim()}...`;
}

function extractHighlights(message: string) {
  const lines = message
    .split(/\n+/)
    .map((line) => compactLine(line))
    .filter((line) => line.length >= 12 && !/^AI\s*(summary|evaluation|follow-up|总结|评估)/i.test(line));
  const bulletLike = lines.filter((line) => /^[-\d.)]/.test(line) || /(risk|action|question|evidence|风险|行动|问题|证据|分歧|结论)/i.test(line));
  const source = bulletLike.length > 0 ? bulletLike : compactLine(message, 360).split(/(?<=[.!?。！？])\s+/);
  return [...new Set(source.map((line) => compactLine(line)).filter((line) => line.length >= 12))].slice(0, 4);
}

function taskKey(event: Pick<CollaborationEvent, "aiTask">): AiTask | "knowledgeExtraction" | "conversation" {
  return event.aiTask ?? "conversation";
}

export function buildLatestAiInterventionDigest(
  event: Pick<CollaborationEvent, "message" | "aiTask">,
  locale: AppLocale,
) {
  const labels = DIGEST_LABELS[locale] ?? DIGEST_LABELS.en;
  const key = taskKey(event);
  const highlights = extractHighlights(event.message);
  const originalExcerpt = event.message.trim().length > 700
    ? `${event.message.trim().slice(0, 700).trim()}...`
    : event.message.trim();
  const markdown = [
    `**${labels.did}**: ${labels.tasks[key]}`,
    `**${labels.highlights}**`,
    ...(highlights.length > 0 ? highlights.map((item) => `- ${item}`) : [`- ${compactLine(event.message, 170)}`]),
    `**${labels.relation}**: ${labels.relationByTask[key]}`,
    `**${labels.next}**: ${labels.nextByTask[key]}`,
  ].join("\n");

  return {
    markdown,
    originalExcerpt,
    isTruncated: event.message.trim().length > originalExcerpt.length,
    originalExcerptLabel: labels.originalExcerpt,
  };
}
