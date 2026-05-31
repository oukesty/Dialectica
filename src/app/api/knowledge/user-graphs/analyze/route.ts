export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, getSettings } from "@/lib/data/repository";
import { getLatestCrossGraphAnalysis, saveLatestCrossGraphAnalysis } from "@/lib/knowledge/cross-graph-analyses";
import { getUserGraph } from "@/lib/knowledge/user-graphs";
import { applyKnowledgeGraphBudget } from "@/lib/knowledge/budget";
import { getProvider } from "@/lib/providers/registry";
import { getProviderDescriptor, normalizeProviderModel } from "@/lib/providers/provider-catalog";
import { createId, normalizeText, sanitizePlainText } from "@/lib/utils";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_NODE_TYPES,
  KNOWLEDGE_RELATION_TYPES,
  KnowledgeCategory,
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeRelation,
  KnowledgeRelationType,
  CrossGraphAnalysis,
} from "@/lib/knowledge/types";
import { AppLocale } from "@/lib/types";
import { isLocale } from "@/lib/i18n";

const analyzeSchema = z.object({
  graphIds: z.array(z.string()).min(2).max(10),
  analysisGoal: z.string().max(500).optional().default(""),
  locale: z.string().optional(),
});

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function graphLanguageLabel(locale: AppLocale) {
  return locale === "zh-CN"
    ? "Chinese (Simplified)"
    : locale === "ja"
      ? "Japanese"
      : locale === "ko"
        ? "Korean"
        : locale === "fr"
          ? "French"
          : locale === "ru"
            ? "Russian"
            : "English";
}

function extractJsonCandidates(text: string) {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(cleaned.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function parseAiJsonObject(reply: string): Record<string, unknown> | null {
  for (const candidate of extractJsonCandidates(reply)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const object = parsed as Record<string, unknown>;
        if (Array.isArray(object.nodes) && Array.isArray(object.relations)) return object;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function normalizeNodeType(value: unknown): KnowledgeNodeType {
  const raw = typeof value === "string" ? value.toLowerCase().trim() : "";
  if ((KNOWLEDGE_NODE_TYPES as readonly string[]).includes(raw)) return raw as KnowledgeNodeType;
  if (raw.includes("risk") || raw.includes("conflict")) return "conflict";
  if (raw.includes("evidence") || raw.includes("data")) return "evidence";
  if (raw.includes("action") || raw.includes("recommend")) return "recommendation";
  if (raw.includes("decision") || raw.includes("conclusion")) return "conclusion";
  if (raw.includes("question") || raw.includes("unresolved")) return "question";
  return "concept";
}

function normalizeCategory(value: unknown): KnowledgeCategory {
  const raw = typeof value === "string" ? value.toLowerCase().trim() : "";
  return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(raw) ? raw as KnowledgeCategory : "other";
}

function normalizeRelationType(value: unknown): KnowledgeRelationType {
  const raw = typeof value === "string" ? value.toLowerCase().trim() : "";
  if ((KNOWLEDGE_RELATION_TYPES as readonly string[]).includes(raw)) return raw as KnowledgeRelationType;
  if (raw.includes("oppose") || raw.includes("conflict") || raw.includes("contradict")) return "opposes";
  if (raw.includes("cause") || raw.includes("trigger") || raw.includes("lead")) return "causes";
  if (raw.includes("derive") || raw.includes("source")) return "derived_from";
  if (raw.includes("support")) return "supports";
  if (raw.includes("extend")) return "extends";
  if (raw.includes("unresolved")) return "unresolved_with";
  if (raw.includes("reference")) return "references";
  return "related_to";
}

function stringList(value: unknown, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizePlainText(String(item ?? ""), 120))
    .filter(Boolean)
    .slice(0, limit);
}

function safeText(value: unknown, maxLength: number) {
  return sanitizePlainText(String(value ?? ""), maxLength).trim();
}

function graphSourceExcerpt(node: KnowledgeNode) {
  return [
    node.title,
    node.summary,
    node.evidenceReferences.slice(0, 2).map((reference) => reference.excerpt ?? reference.label).join(" "),
  ].filter(Boolean).join(" | ");
}

function buildCrossGraphPrompt(
  graphs: Array<{ id: string; title: string; sourceProjectTitles: string[]; nodes: KnowledgeNode[]; relations: KnowledgeRelation[] }>,
  analysisGoal: string,
  locale: AppLocale,
) {
  const sourceGraphs = graphs.map((graph) => ({
    graphId: graph.id,
    title: graph.title,
    sourceProjects: graph.sourceProjectTitles,
    nodes: graph.nodes.slice(0, 80).map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type,
      category: node.category,
      summary: node.summary,
      topics: node.topics.slice(0, 6),
      sourceProjectTitle: node.sourceProjectTitle,
      evidence: node.evidenceReferences.slice(0, 3).map((reference) => reference.excerpt ?? reference.label),
    })),
    relations: graph.relations.slice(0, 120).map((relation) => ({
      id: relation.id,
      source: relation.sourceNodeId,
      target: relation.targetNodeId,
      type: relation.type,
      note: relation.note,
    })),
  }));
  return JSON.stringify({
    task: "extract_cross_graph_association_graph",
    language: graphLanguageLabel(locale),
    analysisGoal,
    instructions: [
      "You are a JSON-only API. Use the source graph nodes, relations, and source project context to extract a new cross-graph association graph.",
      "Do not stitch all graphs together. Do not copy every source node. Identify why the graphs are related.",
      "Prioritize shared themes, differences, complementary relationships, shared risks, conflicts, evidence chains, action paths, and unresolved boundaries.",
      "Every generated node must cite at least one source node id in sourceNodeIds. Prefer nodes that cite source nodes from more than one source graph when possible.",
      "Return fewer high-value nodes instead of a dense graph. Use 10 to 16 nodes and 10 to 18 relations when evidence supports that scale.",
      "If there is not enough basis, return empty nodes and relations instead of inventing content.",
      "All labels, descriptions, notes, and analysis fields must be written in the target language.",
      "Your entire response must be one valid JSON object and nothing else.",
    ],
    format: {
      sharedConcepts: [{ concept: "short shared concept", graphIds: ["graph id"], sourceNodeIds: ["node id"], note: "why it matters" }],
      conflictingViewpoints: [{ topic: "topic", viewpoints: [{ graphId: "graph id", stance: "stance based on source nodes" }], note: "conflict or boundary" }],
      supportingConclusions: [{ conclusion: "conclusion", graphIds: ["graph id"], evidence: "source-backed evidence" }],
      unrelatedNodes: [{ nodeId: "source node id", graphId: "graph id", reason: "why it remains graph-specific" }],
      nodes: [{ id: "x1", label: "concise node label", type: "concept|topic|viewpoint|argument|evidence|conflict|conclusion|question|recommendation|document", category: "public-policy|operations|research|ai-ethics|other", description: "source-backed explanation", topics: ["topic"], tags: ["tag"], sourceNodeIds: ["source node id"] }],
      relations: [{ source: "x1", target: "x2", type: "supports|opposes|references|extends|causes|related_to|unresolved_with|derived_from", label: "meaningful relation", sourceNodeIds: ["source node id"] }],
    },
    sourceGraphs,
  }).slice(0, 26000);
}

function buildSourceNodeIndex(graphs: Array<{ id: string; nodes: KnowledgeNode[] }>) {
  const nodeToGraph = new Map<string, string>();
  const nodes = new Map<string, KnowledgeNode>();
  graphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      nodeToGraph.set(node.id, graph.id);
      nodes.set(node.id, node);
    });
  });
  return { nodeToGraph, nodes };
}

function convertAiGraph(
  object: Record<string, unknown>,
  graphs: Array<{ id: string; nodes: KnowledgeNode[] }>,
  now: string,
) {
  const { nodeToGraph, nodes: sourceNodes } = buildSourceNodeIndex(graphs);
  const rawNodes = Array.isArray(object.nodes) ? object.nodes as Array<Record<string, unknown>> : [];
  const keptNodes: KnowledgeNode[] = [];
  const nodeIdMap = new Map<string, string>();
  const seenLabels = new Set<string>();

  rawNodes.slice(0, 40).forEach((raw, index) => {
    const label = safeText(raw.label ?? raw.title, 90);
    const summary = safeText(raw.description ?? raw.summary, 320);
    const sourceNodeIds = stringList(raw.sourceNodeIds, 8).filter((id) => sourceNodes.has(id));
    if (!label || !summary || sourceNodeIds.length === 0) return;
    const normalized = normalizeText(label);
    if (!normalized || seenLabels.has(normalized)) return;
    seenLabels.add(normalized);
    const firstSource = sourceNodes.get(sourceNodeIds[0]);
    if (!firstSource) return;
    const id = createId("xnode");
    nodeIdMap.set(safeText(raw.id, 64) || `x${index + 1}`, id);
    keptNodes.push({
      id,
      title: label,
      type: normalizeNodeType(raw.type),
      category: normalizeCategory(raw.category),
      summary,
      sourceProjectId: firstSource.sourceProjectId,
      sourceProjectTitle: firstSource.sourceProjectTitle,
      sourceDiscussionId: firstSource.sourceDiscussionId,
      tags: [...new Set([...stringList(raw.tags, 6), "cross-graph"])],
      topics: [...new Set(stringList(raw.topics, 6))],
      relatedParticipantIds: [],
      evidenceReferences: sourceNodeIds.slice(0, 4).map((nodeId) => {
        const source = sourceNodes.get(nodeId)!;
        return {
          nodeId,
          label: source.title,
          excerpt: graphSourceExcerpt(source).slice(0, 260),
        };
      }),
      relatedNodeIds: [],
      createdFrom: ["summary", "argument-node", "insight"],
      createdAt: now,
      updatedAt: now,
      provenance: {
        projectId: firstSource.sourceProjectId,
        projectTitle: firstSource.sourceProjectTitle,
        projectLocale: firstSource.provenance.projectLocale,
        scenario: "cross-graph",
        createdFrom: ["summary", "argument-node", "insight"],
        generatedAt: now,
      },
    });
  });

  const rawRelations = Array.isArray(object.relations) ? object.relations as Array<Record<string, unknown>> : [];
  const keptRelations: KnowledgeRelation[] = [];
  const nodeSet = new Set(keptNodes.map((node) => node.id));
  const relationKeys = new Set<string>();
  rawRelations.slice(0, 80).forEach((raw) => {
    const source = nodeIdMap.get(safeText(raw.source, 64));
    const target = nodeIdMap.get(safeText(raw.target, 64));
    if (!source || !target || source === target || !nodeSet.has(source) || !nodeSet.has(target)) return;
    const key = `${source}:${target}:${normalizeRelationType(raw.type)}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    const sourceNodeIds = stringList(raw.sourceNodeIds, 6).filter((id) => sourceNodes.has(id));
    const sourceProjectId = sourceNodeIds.length > 0
      ? sourceNodes.get(sourceNodeIds[0])!.sourceProjectId
      : sourceNodes.get(graphs[0]?.nodes[0]?.id ?? "")?.sourceProjectId ?? "";
    keptRelations.push({
      id: createId("xrel"),
      sourceNodeId: source,
      targetNodeId: target,
      type: normalizeRelationType(raw.type),
      note: safeText(raw.label ?? raw.note, 240),
      sourceProjectId,
      createdAt: now,
    });
  });

  const budgeted = applyKnowledgeGraphBudget(keptNodes, keptRelations, "2d");
  return { nodes: budgeted.nodes, relations: budgeted.relations, nodeToGraph };
}

function parseAnalysisList<T>(value: unknown, mapper: (item: Record<string, unknown>) => T | null, limit: number): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === "object" && !Array.isArray(item) ? mapper(item as Record<string, unknown>) : null))
    .filter((item): item is T => Boolean(item))
    .slice(0, limit);
}

/**
 * Analyze relationships between multiple user-owned knowledge graphs.
 * Finds shared concepts, conflicting viewpoints, and supporting conclusions.
 */
export async function GET(request: Request) {
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "")
    ? (url.searchParams.get("locale") as AppLocale)
    : settings.locale;
  const viewer = {
    identityId: settings.profile.localIdentityId,
    displayName: settings.profile.displayName,
  };
  const analysis = await getLatestCrossGraphAnalysis(viewer.identityId);
  if (!analysis) {
    return NextResponse.json({ analysis: null });
  }

  for (const graphId of analysis.sourceGraphIds) {
    const graph = await getUserGraph(graphId, viewer, locale);
    if (!graph || graph.status !== "ready") {
      return NextResponse.json({ analysis: null });
    }
  }

  return NextResponse.json({ analysis });
}

export async function POST(request: Request) {
  const settings = await getSettings();
  const rawBody = await request.json().catch(() => null);
  const parsed = analyzeSchema.safeParse(rawBody);
  const locale = isLocale((rawBody as { locale?: string } | null)?.locale ?? "")
    ? ((rawBody as { locale?: string }).locale as AppLocale)
    : settings.locale;

  if (!parsed.success) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "请至少选择 2 个图谱后再运行关联分析。",
        en: "Select at least two graphs before running cross-analysis.",
        ja: "クロス分析を実行する前に、少なくとも 2 つのグラフを選択してください。",
        ko: "교차 분석을 실행하기 전에 그래프를 최소 2개 선택해 주세요.",
        fr: "Selectionnez au moins deux graphes avant de lancer l'analyse croisee.",
        ru: "Перед запуском перекрёстного анализа выберите как минимум два графа.",
      }),
      issues: parsed.error.issues,
    }, { status: 400 });
  }

  const { graphIds, analysisGoal } = parsed.data;
  const viewer = {
    identityId: settings.profile.localIdentityId,
    displayName: settings.profile.displayName,
  };

  // Load all requested graphs
  const graphs: Array<{ id: string; title: string; sourceProjectIds: string[]; sourceProjectTitles: string[]; nodes: KnowledgeNode[]; relations: KnowledgeRelation[] }> = [];
  for (const graphId of graphIds) {
    const graph = await getUserGraph(graphId, viewer);
    if (!graph) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": `图谱 ${graphId} 不存在，或你当前没有访问权限。`,
          en: `Graph ${graphId} was not found or you do not have access to it.`,
          ja: `グラフ ${graphId} が見つからないか、現在のアカウントにはアクセス権がありません。`,
          ko: `그래프 ${graphId} 를 찾을 수 없거나 현재 계정에 접근 권한이 없습니다.`,
          fr: `Le graphe ${graphId} est introuvable ou vous n'y avez pas acces.`,
          ru: `Граф ${graphId} не найден или у вас нет доступа к нему.`,
        }),
      }, { status: 404 });
    }
    if (graph.status !== "ready") {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": `图谱“${graph.title}”尚未就绪（当前状态：${graph.status}）。请稍后再试。`,
          en: `Graph "${graph.title}" is not ready yet (current status: ${graph.status}). Please try again shortly.`,
          ja: `グラフ「${graph.title}」はまだ準備できていません（現在の状態: ${graph.status}）。しばらくしてから再試行してください。`,
          ko: `그래프 "${graph.title}" 는 아직 준비되지 않았습니다(현재 상태: ${graph.status}). 잠시 후 다시 시도해 주세요.`,
          fr: `Le graphe « ${graph.title} » n'est pas encore pret (etat actuel : ${graph.status}). Reessayez dans un instant.`,
          ru: `Граф "${graph.title}" ещё не готов (текущий статус: ${graph.status}). Повторите попытку чуть позже.`,
        }),
      }, { status: 409 });
    }
    graphs.push({
      id: graph.id,
      title: graph.title,
      sourceProjectIds: graph.sourceProjectIds,
      sourceProjectTitles: graph.sourceProjectTitles,
      nodes: graph.nodes,
      relations: graph.relations,
    });
  }

  const providerId = settings.provider.activeProviderId;
  const providerConfig = settings.provider.providers[providerId];
  const descriptor = getProviderDescriptor(providerId);
  const model = normalizeProviderModel(providerId, providerConfig.model);
  const provider = getProvider(providerId);
  const prompt = buildCrossGraphPrompt(graphs, analysisGoal, locale);
  const projectContextId = graphs.flatMap((graph) => graph.sourceProjectIds)[0];
  const projectContext = projectContextId
    ? await getProject(projectContextId, locale).catch(() => null)
    : null;

  if (!projectContext) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "找不到跨图谱分析的来源项目上下文，关联图谱生成已停止。",
        en: "The source project context for cross-graph analysis was not found. Generation stopped.",
        ja: "クロスグラフ分析の元プロジェクト文脈が見つかりません。生成を停止しました。",
        ko: "교차 그래프 분석의 원본 프로젝트 맥락을 찾지 못해 생성을 중단했습니다.",
        fr: "Le contexte du projet source pour l'analyse intergraphes est introuvable. La generation est arretee.",
        ru: "Контекст исходного проекта для межграфового анализа не найден. Создание остановлено.",
      }),
    }, { status: 404 });
  }

  const response = await provider.respondInConversation(projectContext, {
    locale,
    replyLanguage: locale,
    aiRole: "assistant",
    responseLength: "detailed",
    emphasis: "balanced",
    stage: "final-summary",
    goal: "Return JSON cross-graph association analysis",
    providerConfig: { ...providerConfig, model, mode: descriptor?.mode ?? providerConfig.mode },
    requestTimeoutMs: 60000,
    preferServerKeys: settings.provider.preferServerKeys,
    allowFallbackToScaffold: false,
    attachmentContext: { total: 0, items: [] },
  }, {
    prompt,
    history: [],
  });

  if (!response.ok || !response.reply) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": `AI 未能完成跨图谱关联分析：${response.message || "请检查 Provider / Model / API Key 后重试。"}`,
        en: `AI could not complete the cross-graph analysis: ${response.message || "Check Provider / Model / API key and retry."}`,
        ja: `AI がクロスグラフ分析を完了できませんでした: ${response.message || "Provider / Model / API Key を確認して再試行してください。"}`,
        ko: `AI가 교차 그래프 분석을 완료하지 못했습니다: ${response.message || "Provider / Model / API Key를 확인한 뒤 다시 시도하세요."}`,
        fr: `L'IA n'a pas pu terminer l'analyse intergraphes : ${response.message || "Verifiez le Provider / Model / API Key puis reessayez."}`,
        ru: `ИИ не смог завершить межграфовый анализ: ${response.message || "Проверьте Provider / Model / API Key и повторите."}`,
      }),
    }, { status: 502 });
  }

  const parsedObject = parseAiJsonObject(response.reply);
  if (!parsedObject) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "AI 没有返回有效的跨图谱 JSON 结构，未保存或展示假图谱。",
        en: "AI did not return a valid cross-graph JSON structure. No fake graph was produced.",
        ja: "AI は有効なクロスグラフ JSON 構造を返しませんでした。偽のグラフは生成していません。",
        ko: "AI가 유효한 교차 그래프 JSON 구조를 반환하지 않았습니다. 가짜 그래프는 만들지 않았습니다.",
        fr: "L'IA n'a pas renvoye de structure JSON intergraphes valide. Aucun faux graphe n'a ete produit.",
        ru: "ИИ не вернул допустимую JSON-структуру межграфового анализа. Фальшивый граф не создан.",
      }),
    }, { status: 502 });
  }

  const now = new Date().toISOString();
  const converted = convertAiGraph(parsedObject, graphs, now);
  if (converted.nodes.length < 2 || converted.relations.length < 1) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "AI 返回的跨图谱关联依据不足，未生成关联图谱。请换用更强的模型或补充源图谱内容后重试。",
        en: "The AI response did not contain enough source-backed cross-graph links. No association graph was generated.",
        ja: "AI の応答には根拠あるクロスグラフ関連が不足しています。関連グラフは生成していません。",
        ko: "AI 응답에 근거 있는 교차 그래프 연결이 부족해 연결 그래프를 생성하지 않았습니다.",
        fr: "La reponse de l'IA ne contient pas assez de liens intergraphes etayes. Aucun graphe d'association n'a ete genere.",
        ru: "В ответе ИИ недостаточно обоснованных межграфовых связей. Ассоциативный граф не создан.",
      }),
    }, { status: 422 });
  }

  const mapGraphIds = (value: unknown) => stringList(value, 10).filter((graphId) => graphIds.includes(graphId));
  const analysis: CrossGraphAnalysis = {
    id: createId("xanalysis"),
    ownerIdentityId: viewer.identityId,
    title: analysisGoal || localize(locale, {
      "zh-CN": `跨图谱关联：${graphs.map((graph) => graph.title).join(" / ")}`,
      en: `Cross-graph links: ${graphs.map((graph) => graph.title).join(" / ")}`,
      ja: `クロスグラフ関連: ${graphs.map((graph) => graph.title).join(" / ")}`,
      ko: `교차 그래프 연결: ${graphs.map((graph) => graph.title).join(" / ")}`,
      fr: `Liens intergraphes : ${graphs.map((graph) => graph.title).join(" / ")}`,
      ru: `Межграфовые связи: ${graphs.map((graph) => graph.title).join(" / ")}`,
    }),
    sourceGraphIds: graphIds,
    analysisGoal,
    sharedConcepts: parseAnalysisList(parsedObject.sharedConcepts, (item) => {
      const concept = safeText(item.concept, 120);
      if (!concept) return null;
      return { concept, graphIds: mapGraphIds(item.graphIds), note: safeText(item.note, 260) };
    }, 30),
    conflictingViewpoints: parseAnalysisList(parsedObject.conflictingViewpoints, (item) => {
      const topic = safeText(item.topic, 120);
      const viewpoints = Array.isArray(item.viewpoints)
        ? item.viewpoints.map((viewpoint) => {
          const source = viewpoint as Record<string, unknown>;
          return { graphId: safeText(source.graphId, 80), stance: safeText(source.stance, 220) };
        }).filter((viewpoint) => graphIds.includes(viewpoint.graphId) && viewpoint.stance)
        : [];
      if (!topic || viewpoints.length === 0) return null;
      return { topic, viewpoints, note: safeText(item.note, 260) };
    }, 20),
    supportingConclusions: parseAnalysisList(parsedObject.supportingConclusions, (item) => {
      const conclusion = safeText(item.conclusion, 160);
      if (!conclusion) return null;
      return { conclusion, graphIds: mapGraphIds(item.graphIds), evidence: safeText(item.evidence, 360) };
    }, 20),
    unrelatedNodes: parseAnalysisList(parsedObject.unrelatedNodes, (item) => {
      const nodeId = safeText(item.nodeId, 120);
      const graphId = safeText(item.graphId, 120);
      if (!nodeId || !graphIds.includes(graphId)) return null;
      return { nodeId, graphId, reason: safeText(item.reason, 260) };
    }, 50),
    nodes: converted.nodes,
    relations: converted.relations,
    createdAt: now,
  };

  const savedAnalysis = await saveLatestCrossGraphAnalysis(viewer.identityId, analysis);
  return NextResponse.json({ analysis: savedAnalysis });
}
