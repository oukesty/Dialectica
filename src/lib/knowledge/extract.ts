import { RoomAttachment } from "@/lib/collaboration/types";
import { AppLocale, AppSettings, ArgumentNode, DiscussionProject } from "@/lib/types";
import {
  KnowledgeCategory,
  KnowledgeNode,
  KnowledgeProjectSnapshot,
  KnowledgeRelation,
  StructuredDiscussionAnalysis,
} from "@/lib/knowledge/types";
import { normalizeText, slugify } from "@/lib/utils";

function localize<T>(locale: DiscussionProject["language"], values: Partial<Record<DiscussionProject["language"], T>> & { en: T }) {
  return values[locale] ?? values.en;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nodeId(projectId: string, type: string, sourceId: string) {
  return `knowledge_${projectId}_${type}_${slugify(sourceId)}`;
}

function relationId(projectId: string, sourceNodeId: string, targetNodeId: string, type: string) {
  return `krel_${projectId}_${slugify(`${sourceNodeId}_${type}_${targetNodeId}`)}`;
}

const LOW_SIGNAL_KNOWLEDGE_TERMS = [
  "hello",
  "hi",
  "hey",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "sure",
  "got it",
  "sounds good",
  "noted",
  "understood",
  "你好",
  "您好",
  "谢谢",
  "好的",
  "收到",
  "明白",
  "嗯",
  "哈喽",
  "こんにちは",
  "ありがとう",
  "了解",
  "はい",
  "merci",
  "d'accord",
  "bien note",
] as const;
const LOW_SIGNAL_KNOWLEDGE_TOKEN_SET = new Set(
  LOW_SIGNAL_KNOWLEDGE_TERMS.flatMap((term) => normalizeText(term).split(" ").filter(Boolean)),
);

const GENERIC_KNOWLEDGE_PATTERNS = [
  /untitled discussion workspace/i,
  /名称未設定のディスカッションワークスペース/i,
  /espace de discussion sans titre/i,
  /未命名讨论工作区/i,
];

function isGenericKnowledgeLabel(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return GENERIC_KNOWLEDGE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isLowSignalKnowledgeText(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  if (isGenericKnowledgeLabel(text)) return true;
  if (LOW_SIGNAL_KNOWLEDGE_TERMS.some((term) => normalized === normalizeText(term))) return true;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => LOW_SIGNAL_KNOWLEDGE_TOKEN_SET.has(token))) {
    return true;
  }
  if (
    tokens.length <= 5
    && LOW_SIGNAL_KNOWLEDGE_TOKEN_SET.has(tokens[0] ?? "")
  ) {
    return true;
  }
  return false;
}

function selectImportantTopics(project: DiscussionProject, analysis: StructuredDiscussionAnalysis) {
  return unique([
    ...analysis.topics,
    ...project.summary.coreTopics,
    ...project.tags,
  ]).filter((topic) => !isLowSignalKnowledgeText(topic)).slice(0, 5);
}

function buildArgumentRelationStats(project: DiscussionProject, nodeIdValue: string) {
  const incoming = project.relations.filter((relation) => relation.targetNodeId === nodeIdValue);
  const outgoing = project.relations.filter((relation) => relation.sourceNodeId === nodeIdValue);
  const all = [...incoming, ...outgoing];
  return {
    incoming,
    outgoing,
    all,
    meaningfulCount: all.filter((relation) => ["supports", "rebuts", "asks", "concludes", "clarifies", "references"].includes(relation.type)).length,
    evidenceSupportCount: incoming.filter((relation) => relation.type === "supports").length,
  };
}

function shouldForceKeepKnowledgeNode(node: ArgumentNode, stats: ReturnType<typeof buildArgumentRelationStats>) {
  const lowSignal = isLowSignalKnowledgeText(`${node.title} ${node.description}`);
  if (lowSignal && !["conclusion", "actionItem", "evidence"].includes(node.type)) {
    return false;
  }
  return node.type === "conclusion"
    || node.type === "actionItem"
    || node.type === "evidence"
    || (node.type === "question" && node.status !== "resolved")
    || node.status === "contested"
    || stats.meaningfulCount > 0
    || node.entryIds.length > 1;
}

function scoreArgumentNodeForKnowledge(project: DiscussionProject, node: ArgumentNode) {
  const stats = buildArgumentRelationStats(project, node.id);
  const baseScore = node.type === "conclusion"
    ? 9
    : node.type === "actionItem"
      ? 8
      : node.type === "question"
        ? node.status !== "resolved" ? 7 : 3
        : node.type === "evidence"
          ? 7
          : node.type === "claim"
            ? 6
            : node.type === "rebuttal"
              ? 6
              : node.type === "clarification"
                ? 3
                : 4;
  const textPenalty = isLowSignalKnowledgeText(`${node.title} ${node.description}`) ? 6 : 0;
  const score = baseScore
    + node.strength
    + Math.min(node.entryIds.length, 3)
    + stats.meaningfulCount * 1.5
    + stats.evidenceSupportCount
    + (node.status === "contested" ? 2 : 0)
    - textPenalty;

  return {
    node,
    stats,
    forceKeep: shouldForceKeepKnowledgeNode(node, stats),
    score,
  };
}

function selectImportantArgumentNodes(project: DiscussionProject) {
  const ranked = project.nodes
    .map((node) => scoreArgumentNodeForKnowledge(project, node))
    .filter((candidate) => candidate.forceKeep || candidate.score > 3)
    .sort((left, right) => {
      if (left.forceKeep !== right.forceKeep) return left.forceKeep ? -1 : 1;
      return right.score - left.score;
    });

  const targetCount = Math.min(Math.max(8, Math.ceil(project.nodes.length * 0.55)), 16);
  const keepCount = Math.min(ranked.length, Math.max(ranked.filter((candidate) => candidate.forceKeep).length, targetCount));
  return ranked.slice(0, keepCount).map((candidate) => candidate.node);
}

function shouldIncludeParticipantViewpoint(project: DiscussionProject, participant: DiscussionProject["participants"][number], selectedNodes: ArgumentNode[]) {
  const participantEntryCount = project.entries.filter((entry) => entry.participantId === participant.id).length;
  const ownsImportantNodes = selectedNodes.some((node) => node.participantId === participant.id);
  return ownsImportantNodes
    || participantEntryCount >= 2
    || !isLowSignalKnowledgeText(participant.stance)
    || !isLowSignalKnowledgeText(participant.bio);
}

function mapKnowledgeRelationType(project: DiscussionProject, relation: DiscussionProject["relations"][number]) {
  const sourceNode = project.nodes.find((node) => node.id === relation.sourceNodeId);
  const targetNode = project.nodes.find((node) => node.id === relation.targetNodeId);

  switch (relation.type) {
    case "supports":
      return "supports" as const;
    case "rebuts":
      return "opposes" as const;
    case "references":
      return "references" as const;
    case "concludes":
      return "extends" as const;
    case "asks":
      return "unresolved_with" as const;
    case "clarifies":
      return (sourceNode?.type === "evidence" || targetNode?.type === "question" || targetNode?.type === "claim")
        ? "extends" as const
        : null;
    case "responds_to":
      return targetNode?.type === "question"
        ? "extends" as const
        : null;
    default:
      return null;
  }
}

function inferCategory(project: DiscussionProject, node: Pick<KnowledgeNode, "title" | "summary" | "tags" | "topics">): KnowledgeCategory {
  const text = `${project.title} ${project.description} ${project.goal} ${node.title} ${node.summary} ${node.tags.join(" ")} ${node.topics.join(" ")}`.toLowerCase();
  if (/(policy|governance|city|public|交通|政策|治理|公共)/.test(text)) return "public-policy";
  if (/(employment|hiring|workforce|job|就业|雇佣)/.test(text)) return "employment";
  if (/(education|learning|training|教学|教育)/.test(text)) return "education";
  if (/(ethics|bias|fairness|伦理|公平)/.test(text)) return "ai-ethics";
  if (/(automation|workflow|agent|自动化)/.test(text)) return "automation";
  if (/(research|study|evidence|survey|研究)/.test(text)) return "research";
  if (/(meeting|operations|policy workshop|ops|运营|会议)/.test(text)) return "operations";
  if (/(model|provider|llm|gpt|gemini|claude|deepseek|qwen|ai|人工智能)/.test(text)) return "ai-technology";
  return "other";
}

function summarizeNode(node: ArgumentNode) {
  return node.description || node.title;
}

function buildReferences(project: DiscussionProject, entryIds: string[]) {
  return entryIds
    .map((entryId) => project.entries.find((entry) => entry.id === entryId))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => ({
      entryId: entry.id,
      label: entry.content.slice(0, 80),
      excerpt: entry.content,
    }));
}

function buildAnalysis(project: DiscussionProject, attachments: RoomAttachment[], settings: AppSettings): StructuredDiscussionAnalysis {
  const topics = unique([...project.summary.coreTopics, ...project.tags, project.title]);
  const argumentNodes = project.nodes.filter((node) => ["claim", "rebuttal", "clarification", "conclusion", "actionItem"].includes(node.type));
  const evidenceNodes = project.nodes.filter((node) => node.type === "evidence");
  const questionNodes = project.nodes.filter((node) => node.type === "question" && node.status !== "resolved");
  const conflictingRelations = project.relations.filter((relation) => relation.type === "rebuts");

  return {
    primaryTopic: topics[0] ?? project.title,
    topics,
    viewpoints: project.participants.map((participant) => ({
      participantId: participant.id,
      participantName: participant.name,
      stance: participant.stance || participant.role,
      summary: participant.bio || participant.stance || participant.role,
    })),
    arguments: argumentNodes.map((node) => ({
      nodeId: node.id,
      title: node.title,
      stance: node.stance,
      summary: summarizeNode(node),
      participantId: node.participantId,
    })),
    evidence: [
      ...evidenceNodes.map((node) => ({
        nodeId: node.id,
        title: node.title,
        summary: summarizeNode(node),
        participantId: node.participantId,
      })),
      ...(settings.knowledgePreferences.includeAttachmentsAsEvidence
        ? attachments.map((attachment) => ({
            attachmentId: attachment.id,
            title: attachment.name,
            summary: attachment.note || attachment.mimeType,
            participantId: attachment.uploadedByParticipantId,
          }))
        : []),
    ],
    conflicts: conflictingRelations.map((relation) => ({
      sourceNodeId: relation.sourceNodeId,
      targetNodeId: relation.targetNodeId,
      title: project.nodes.find((node) => node.id === relation.sourceNodeId)?.title ?? relation.note,
      detail: relation.note,
    })),
    evaluation: project.summary.evaluation,
    conclusion: project.summary.currentConclusion,
    unresolvedQuestions: unique([
      ...project.summary.unresolvedQuestions,
      ...(settings.knowledgePreferences.includeUnresolvedQuestions ? questionNodes.map((node) => node.title) : []),
    ]),
    followupQuestions: unique(project.summary.followupQuestions),
    recommendations: unique([...project.summary.suggestions, ...project.summary.evaluation.improvementSuggestions]),
  };
}

export function extractKnowledgeSnapshot(
  project: DiscussionProject,
  attachments: RoomAttachment[],
  settings: AppSettings,
  options: { generateGraphLinks?: boolean; locale?: AppLocale } = {},
): KnowledgeProjectSnapshot {
  const generatedAt = new Date().toISOString();
  const analysis = buildAnalysis(project, attachments, settings);
  const outputLocale = options.locale ?? project.language;
  const shouldGenerateGraphLinks = Boolean(options.generateGraphLinks);
  const selectedArgumentNodes = selectImportantArgumentNodes(project);
  const projectNodeId = nodeId(project.id, "project", project.id);
  const nodes: KnowledgeNode[] = [];
  const relations: KnowledgeRelation[] = [];
  const relatedTopics = selectImportantTopics(project, analysis);

  const projectNode: KnowledgeNode = {
    id: projectNodeId,
    title: project.title,
    type: "project",
    category: inferCategory(project, {
      title: project.title,
      summary: project.summary.overview,
      tags: project.tags,
      topics: relatedTopics,
    }),
    summary: project.summary.overview,
    sourceProjectId: project.id,
    sourceProjectTitle: project.title,
    sourceDiscussionId: project.id,
    tags: project.tags,
    topics: relatedTopics,
    relatedParticipantIds: project.participants.map((participant) => participant.id),
    evidenceReferences: [],
    relatedNodeIds: [],
    createdFrom: ["summary", "transcript"],
    createdAt: project.createdAt,
    updatedAt: generatedAt,
    provenance: {
      projectId: project.id,
      projectTitle: project.title,
      projectLocale: outputLocale,
      scenario: project.scenario,
      createdFrom: ["summary", "transcript"],
      generatedAt,
    },
  };
  nodes.push(projectNode);

  for (const topic of relatedTopics) {
    const topicId = nodeId(project.id, "topic", topic);
    nodes.push({
      id: topicId,
      title: topic,
      type: "topic",
      category: inferCategory(project, { title: topic, summary: topic, tags: project.tags, topics: [topic] }),
      summary: topic,
      sourceProjectId: project.id,
      sourceProjectTitle: project.title,
      sourceDiscussionId: project.id,
      tags: project.tags,
      topics: [topic],
      relatedParticipantIds: [],
      evidenceReferences: [],
      relatedNodeIds: [projectNodeId],
      createdFrom: ["summary"],
      createdAt: generatedAt,
      updatedAt: generatedAt,
      provenance: {
        projectId: project.id,
        projectTitle: project.title,
        projectLocale: outputLocale,
        scenario: project.scenario,
        createdFrom: ["summary"],
        generatedAt,
      },
    });
    relations.push({
      id: relationId(project.id, projectNodeId, topicId, "related_to"),
      sourceNodeId: projectNodeId,
      targetNodeId: topicId,
      type: "related_to",
      note: localize(outputLocale, {
        "zh-CN": `该主题由项目 ${project.title} 的总结与标签抽取而来。`,
        en: `Topic extracted from ${project.title}.`,
        ja: `このトピックはプロジェクト ${project.title} の要約とタグから抽出されました。`,
        fr: `Sujet extrait du projet ${project.title}.`,
      }),
      sourceProjectId: project.id,
      createdAt: generatedAt,
    });
  }

  for (const participant of project.participants.filter((candidate) => shouldIncludeParticipantViewpoint(project, candidate, selectedArgumentNodes))) {
    const participantNodeId = nodeId(project.id, "viewpoint", participant.id);
    nodes.push({
      id: participantNodeId,
      title: participant.name,
      type: "viewpoint",
      category: inferCategory(project, {
        title: participant.name,
        summary: participant.stance || participant.bio,
        tags: project.tags,
        topics: relatedTopics,
      }),
      summary: participant.bio || participant.stance || participant.role,
      sourceProjectId: project.id,
      sourceProjectTitle: project.title,
      sourceDiscussionId: project.id,
      tags: unique([...project.tags, participant.role, participant.collaborationRole]),
      topics: relatedTopics,
      relatedParticipantIds: [participant.id],
      evidenceReferences: [],
      relatedNodeIds: [projectNodeId],
      createdFrom: ["transcript", "summary"],
      createdAt: generatedAt,
      updatedAt: generatedAt,
      provenance: {
        projectId: project.id,
        projectTitle: project.title,
        projectLocale: outputLocale,
        scenario: project.scenario,
        createdFrom: ["transcript", "summary"],
        generatedAt,
      },
    });
    relations.push({
      id: relationId(project.id, projectNodeId, participantNodeId, "related_to"),
      sourceNodeId: projectNodeId,
      targetNodeId: participantNodeId,
      type: "related_to",
      note: localize(outputLocale, {
        "zh-CN": `${participant.name} 是这场讨论中的参与者观点节点。`,
        en: `${participant.name} is a participant viewpoint in this discussion.`,
        ja: `${participant.name} はこの議論における参加者の観点ノードです。`,
        fr: `${participant.name} represente un point de vue participant dans cette discussion.`,
      }),
      sourceProjectId: project.id,
      createdAt: generatedAt,
    });
  }

  for (const node of selectedArgumentNodes) {
    const knowledgeType = node.type === "evidence"
      ? "evidence"
      : node.type === "question"
        ? "question"
        : node.type === "conclusion"
          ? "conclusion"
          : node.type === "actionItem"
            ? "recommendation"
            : "argument";
    const knowledgeNodeId = nodeId(project.id, node.type, node.id);
    const evidenceReferences = buildReferences(project, node.entryIds);
    const knowledgeNode: KnowledgeNode = {
      id: knowledgeNodeId,
      title: node.title,
      type: knowledgeType,
      category: inferCategory(project, {
        title: node.title,
        summary: summarizeNode(node),
        tags: unique([...project.tags, ...node.stance.split(/\s+/)]),
        topics: relatedTopics,
      }),
      summary: summarizeNode(node),
      sourceProjectId: project.id,
      sourceProjectTitle: project.title,
      sourceDiscussionId: project.id,
      tags: unique([...project.tags, ...project.entries.filter((entry) => node.entryIds.includes(entry.id)).flatMap((entry) => entry.tags)]),
      topics: relatedTopics,
      relatedParticipantIds: node.participantId ? [node.participantId] : [],
      evidenceReferences,
      relatedNodeIds: [projectNodeId],
      createdFrom: node.type === "evidence" ? ["argument-node", "summary"] : ["argument-node"],
      createdAt: project.createdAt,
      updatedAt: generatedAt,
      provenance: {
        projectId: project.id,
        projectTitle: project.title,
        projectLocale: outputLocale,
        scenario: project.scenario,
        createdFrom: ["argument-node"],
        generatedAt,
      },
    };
    nodes.push(knowledgeNode);
    relations.push({
      id: relationId(project.id, projectNodeId, knowledgeNodeId, "derived_from"),
      sourceNodeId: projectNodeId,
      targetNodeId: knowledgeNodeId,
      type: "derived_from",
      note: localize(outputLocale, {
      "zh-CN": `${node.title} 是从源讨论中的结构化论点沉淀出来的。`,
      en: `${node.title} was derived from the source discussion.`,
      ja: `${node.title} は元の議論にある構造化論点から生成されました。`,
      fr: `${node.title} a ete derive de la discussion source.`,
    }),
      sourceProjectId: project.id,
      createdAt: generatedAt,
    });
  }

  for (const attachment of attachments) {
    const attachmentNodeId = nodeId(project.id, "attachment", attachment.id);
    const type = attachment.kind === "document" ? "document" : "evidence";
    nodes.push({
      id: attachmentNodeId,
      title: attachment.name,
      type,
      category: inferCategory(project, {
        title: attachment.name,
        summary: attachment.note || attachment.mimeType,
        tags: project.tags,
        topics: relatedTopics,
      }),
      summary: attachment.note || attachment.mimeType,
      sourceProjectId: project.id,
      sourceProjectTitle: project.title,
      sourceDiscussionId: project.id,
      tags: unique([...project.tags, attachment.kind, attachment.mimeType]),
      topics: relatedTopics,
      relatedParticipantIds: attachment.uploadedByParticipantId ? [attachment.uploadedByParticipantId] : [],
      evidenceReferences: [{ attachmentId: attachment.id, label: attachment.name, excerpt: attachment.note }],
      relatedNodeIds: [projectNodeId],
      createdFrom: ["attachment"],
      createdAt: attachment.uploadedAt,
      updatedAt: generatedAt,
      provenance: {
        projectId: project.id,
        projectTitle: project.title,
        projectLocale: outputLocale,
        scenario: project.scenario,
        createdFrom: ["attachment"],
        generatedAt,
      },
    });
    relations.push({
      id: relationId(project.id, projectNodeId, attachmentNodeId, "references"),
      sourceNodeId: projectNodeId,
      targetNodeId: attachmentNodeId,
      type: "references",
      note: localize(outputLocale, {
        "zh-CN": `${attachment.name} 作为讨论中的附件证据或参考材料被纳入知识层。`,
        en: `${attachment.name} is attached as source material for the discussion.`,
        ja: `${attachment.name} は議論における添付証拠または参照資料として知識層に取り込まれました。`,
        fr: `${attachment.name} est joint comme source ou element de preuve pour la discussion.`,
      }),
      sourceProjectId: project.id,
      createdAt: generatedAt,
    });
  }

  const knowledgeIdByArgumentNode = new Map(selectedArgumentNodes.map((node) => [node.id, nodeId(project.id, node.type, node.id)]));
  for (const relation of project.relations) {
    const sourceNodeId = knowledgeIdByArgumentNode.get(relation.sourceNodeId);
    const targetNodeId = knowledgeIdByArgumentNode.get(relation.targetNodeId);
    if (!sourceNodeId || !targetNodeId) continue;
    const mappedType = mapKnowledgeRelationType(project, relation);
    if (!mappedType) continue;
    relations.push({
      id: relationId(project.id, sourceNodeId, targetNodeId, mappedType),
      sourceNodeId,
      targetNodeId,
      type: mappedType,
      note: relation.note,
      sourceProjectId: project.id,
      createdAt: generatedAt,
    });
  }

  if (shouldGenerateGraphLinks) {
    for (const unresolvedQuestion of analysis.unresolvedQuestions) {
      const unresolvedNodeId = nodeId(project.id, "unresolved", unresolvedQuestion);
      nodes.push({
        id: unresolvedNodeId,
        title: unresolvedQuestion,
        type: "conflict",
        category: inferCategory(project, { title: unresolvedQuestion, summary: unresolvedQuestion, tags: project.tags, topics: relatedTopics }),
        summary: unresolvedQuestion,
        sourceProjectId: project.id,
        sourceProjectTitle: project.title,
        sourceDiscussionId: project.id,
        tags: project.tags,
        topics: relatedTopics,
        relatedParticipantIds: [],
        evidenceReferences: [],
        relatedNodeIds: [projectNodeId],
        createdFrom: ["summary"],
        createdAt: generatedAt,
        updatedAt: generatedAt,
        provenance: {
          projectId: project.id,
          projectTitle: project.title,
          projectLocale: outputLocale,
          scenario: project.scenario,
          createdFrom: ["summary"],
          generatedAt,
        },
      });
      relations.push({
        id: relationId(project.id, projectNodeId, unresolvedNodeId, "unresolved_with"),
        sourceNodeId: projectNodeId,
        targetNodeId: unresolvedNodeId,
        type: "unresolved_with",
        note: localize(outputLocale, {
        "zh-CN": `项目 ${project.title} 目前仍保留这条未解决的问题链路。`,
        en: `${project.title} still carries this unresolved thread.`,
        ja: `プロジェクト ${project.title} にはまだ未解決の論点が残っています。`,
        fr: `Le projet ${project.title} conserve encore ce fil non resolu.`,
      }),
        sourceProjectId: project.id,
        createdAt: generatedAt,
      });
    }
  }

  const dedupedNodes = [...new Map(nodes.map((node) => [node.id, node])).values()].map((node) => ({
    ...node,
    relatedNodeIds: unique(node.relatedNodeIds.filter((candidate) => candidate !== node.id)),
  }));
  const dedupedRelations = [...new Map(relations.map((relation) => [relation.id, relation])).values()];
  const categoryCounts = {
    "ai-industry": 0,
    "ai-technology": 0,
    "ai-ethics": 0,
    automation: 0,
    employment: 0,
    education: 0,
    "public-policy": 0,
    operations: 0,
    research: 0,
    other: 0,
  } as Record<KnowledgeCategory, number>;

  for (const node of dedupedNodes) {
    categoryCounts[node.category] += 1;
  }

  return {
    projectId: project.id,
    locale: outputLocale,
    projectTitle: project.title,
    scenario: project.scenario,
    generatedAt,
    analysis,
    nodes: dedupedNodes,
    relations: dedupedRelations,
    stats: {
      nodeCount: dedupedNodes.length,
      relationCount: dedupedRelations.length,
      topicCount: relatedTopics.length,
      categoryCounts,
    },
  };
}
