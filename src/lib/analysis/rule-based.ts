import {
  AiTaskOutput,
  AnalysisContext,
  AnalysisResponse,
  DiscussionProject,
  InsightItem,
  Participant,
  TranscriptEntry,
} from "@/lib/types";
import { createEmptyInsights, createEmptySummary, createProviderRuntimeMap, createProviderSnapshot } from "@/lib/factories";
import { normalizeText } from "@/lib/utils";
import {
  buildAdapterScaffoldOutput,
  buildOrchestrationPacket,
  buildProviderTaskResult,
  scenarioLabel,
} from "@/lib/ai/orchestration";

function localize<T>(locale: AnalysisContext["locale"], values: Partial<Record<AnalysisContext["locale"], T>> & { en: T }) {
  return values[locale] ?? values.en;
}

function strings(locale: AnalysisContext["locale"]) {
  return {
    balanced: localize(locale, {
      "zh-CN": "当前讨论更接近阶段性折中结论。",
      en: "The discussion currently leans toward a provisional middle ground.",
      ja: "現在の議論は暫定的な折衷案に近づいています。",
      fr: "La discussion penche actuellement vers un compromis provisoire.",
    }),
    pending: localize(locale, {
      "zh-CN": "待分析",
      en: "Pending analysis",
      ja: "分析待ち",
      fr: "Analyse en attente",
    }),
    overview: (project: DiscussionProject) =>
      localize(locale, {
        "zh-CN": `该 ${scenarioLabel(project.scenario, locale)} 工作区记录了 ${project.participants.length} 位参与者、${project.entries.length} 条发言，并通过 AI 编排层组织上下文、争议、总结和建议。`,
        en: `This ${scenarioLabel(project.scenario, locale)} workspace captures ${project.participants.length} participants and ${project.entries.length} transcript entries, then uses the AI orchestration layer to organize context, disputes, summaries, and recommendations.`,
        ja: `この ${scenarioLabel(project.scenario, locale)} ワークスペースでは ${project.participants.length} 人の参加者と ${project.entries.length} 件の発言を記録し、AI オーケストレーション層が文脈、争点、要約、提案を整理します。`,
        fr: `Cet espace de ${scenarioLabel(project.scenario, locale)} enregistre ${project.participants.length} participants et ${project.entries.length} interventions, puis utilise la couche d'orchestration IA pour structurer le contexte, les controverses, les résumés et les recommandations.`,
      }),
    participantSummary: (participant: Participant, entryCount: number) =>
      localize(locale, {
        "zh-CN": `${participant.name} 以“${participant.stance}”的立场参与讨论，承担 ${participant.role} / ${participant.collaborationRole} 角色，目前已记录 ${entryCount} 条发言。`,
        en: `${participant.name} contributes from the stance "${participant.stance}", serves as ${participant.role} / ${participant.collaborationRole}, and currently owns ${entryCount} captured entries.`,
        ja: `${participant.name} は「${participant.stance}」の立場で参加し、${participant.role} / ${participant.collaborationRole} の役割を担い、現在 ${entryCount} 件の発言が記録されています。`,
        fr: `${participant.name} intervient depuis la posture « ${participant.stance} », occupe le rôle ${participant.role} / ${participant.collaborationRole} et porte actuellement ${entryCount} interventions enregistrées.`,
      }),
    evidenceReason: (name: string) =>
      localize(locale, {
        "zh-CN": `${name} 的证据链更完整。`,
        en: `${name} presents the stronger evidence chain.`,
        ja: `${name} の根拠チェーンがより整っています。`,
        fr: `${name} présente la chaîne de preuves la plus solide.`,
      }),
    responseReason: (name: string) =>
      localize(locale, {
        "zh-CN": `${name} 对关键问题的回应更充分。`,
        en: `${name} answers the critical questions more directly.`,
        ja: `${name} は重要な問いにより直接的に応答しています。`,
        fr: `${name} répond plus directement aux questions critiques.`,
      }),
    logicReason: (name: string) =>
      localize(locale, {
        "zh-CN": `${name} 的论证链条更连贯。`,
        en: `${name} maintains the more coherent reasoning chain.`,
        ja: `${name} の論証の流れがより一貫しています。`,
        fr: `${name} maintient la chaîne argumentative la plus cohérente.`,
      }),
    unansweredReason: (name: string) =>
      localize(locale, {
        "zh-CN": `${name} 一侧仍承受更多未回应问题。`,
        en: `${name} still carries more unanswered pressure points.`,
        ja: `${name} 側には未解消の問いがより多く残っています。`,
        fr: `${name} porte encore davantage de questions non résolues.`,
      }),
    controversyTitle: (title: string) =>
      localize(locale, {
        "zh-CN": `核心争议：${title}`,
        en: `Contested issue: ${title}`,
        ja: `争点: ${title}`,
        fr: `Point de controverse : ${title}`,
      }),
    controversyDetail: localize(locale, {
      "zh-CN": "该节点同时受到支持与反驳，是当前讨论中的主要冲突线。",
      en: "This node receives both support and rebuttal, making it an active fault line in the discussion.",
      ja: "このノードは支持と反論の両方を受けており、議論の主要な対立線になっています。",
      fr: "Ce nœud reçoit à la fois du soutien et des contre-arguments, ce qui en fait une ligne de tension active.",
    }),
    unansweredTitle: (title: string) =>
      localize(locale, {
        "zh-CN": `未回应问题：${title}`,
        en: `Unanswered question: ${title}`,
        ja: `未回答の問い: ${title}`,
        fr: `Question sans réponse : ${title}`,
      }),
    unansweredDetail: localize(locale, {
      "zh-CN": "该问题还没有形成清晰回应链或阶段性结论。",
      en: "This question still lacks a clear response path or provisional conclusion.",
      ja: "この問いには明確な応答経路や暫定結論がまだありません。",
      fr: "Cette question ne dispose pas encore d'une réponse claire ni d'une conclusion provisoire.",
    }),
    repetitionTitle: (term: string) =>
      localize(locale, {
        "zh-CN": `重复主题：${term}`,
        en: `Repeated topic: ${term}`,
        ja: `繰り返し現れるテーマ: ${term}`,
        fr: `Thème récurrent : ${term}`,
      }),
    repetitionDetail: localize(locale, {
      "zh-CN": "该关键词在多条发言中反复出现，适合沉淀为共享知识节点。",
      en: "This keyword appears across multiple entries and may deserve consolidation into a shared knowledge node.",
      ja: "このキーワードは複数の発言に繰り返し現れており、共有知識ノードとして整理できます。",
      fr: "Ce mot-clé revient dans plusieurs interventions et peut être consolidé en nœud de connaissance partagé.",
    }),
    evidenceGapTitle: (title: string) =>
      localize(locale, {
        "zh-CN": `证据缺口：${title}`,
        en: `Evidence gap: ${title}`,
        ja: `根拠ギャップ: ${title}`,
        fr: `Lacune de preuve : ${title}`,
      }),
    evidenceGapDetail: localize(locale, {
      "zh-CN": "该主张当前缺少来自证据节点的直接支撑。",
      en: "This claim currently lacks direct support from evidence nodes.",
      ja: "この主張には、証拠ノードからの直接的な支えがまだ不足しています。",
      fr: "Cette affirmation manque encore d'un appui direct issu de nœuds de preuve.",
    }),
    consensusTitle: (title: string) =>
      localize(locale, {
        "zh-CN": `阶段性共识：${title}`,
        en: `Working consensus: ${title}`,
        ja: `暫定合意: ${title}`,
        fr: `Consensus de travail : ${title}`,
      }),
    consensusDetail: localize(locale, {
      "zh-CN": "该节点反映了已经形成的暂时共识或可执行方向。",
      en: "This node reflects a provisional agreement or an executable direction.",
      ja: "このノードは暫定合意または実行可能な方向性を示しています。",
      fr: "Ce nœud traduit un accord provisoire ou une direction exécutable.",
    }),
    pendingTitle: (title: string) =>
      localize(locale, {
        "zh-CN": `待推进议题：${title}`,
        en: `Pending thread: ${title}`,
        ja: `継続検討項目: ${title}`,
        fr: `Sujet à poursuivre : ${title}`,
      }),
    pendingDetail: localize(locale, {
      "zh-CN": "该行动项或开放节点仍需要后续推进。",
      en: "This action item or open node still needs follow-through.",
      ja: "このアクション項目または未解決ノードには引き続き対応が必要です。",
      fr: "Cet élément d'action ou nœud ouvert demande encore un suivi.",
    }),
    confidenceMedium: localize(locale, {
      "zh-CN": "中",
      en: "Medium",
      ja: "中",
      fr: "Moyenne",
    }),
    confidenceLow: localize(locale, {
      "zh-CN": "低",
      en: "Low",
      ja: "低",
      fr: "Faible",
    }),
    fallbackConclusion: localize(locale, {
      "zh-CN": "当前尚未形成明确结论。",
      en: "No clear conclusion has emerged yet.",
      ja: "まだ明確な結論は出ていません。",
      fr: "Aucune conclusion claire n'a encore émergé.",
    }),
    suggestionEvidence: localize(locale, {
      "zh-CN": "补强与场景直接相关的数据、案例与证据链。",
      en: "Strengthen the evidence chain with scenario-specific data and examples.",
      ja: "シナリオに直接関係するデータ、事例、根拠チェーンを補強してください。",
      fr: "Renforcez la chaîne de preuves avec des données et exemples propres au scénario.",
    }),
    suggestionResponse: localize(locale, {
      "zh-CN": "为仍未回应的问题建立明确的回应关系。",
      en: "Create explicit response links for the questions that remain unanswered.",
      ja: "未回答の問いに対して、明確な応答リンクを作成してください。",
      fr: "Créez des liens de réponse explicites pour les questions encore ouvertes.",
    }),
    suggestionAction: localize(locale, {
      "zh-CN": "把阶段性共识转化为可验证的行动项或试点。",
      en: "Translate the provisional agreement into verifiable action items or pilots.",
      ja: "暫定合意を検証可能なアクション項目や試行に変換してください。",
      fr: "Transformez l'accord provisoire en actions ou pilotes vérifiables.",
    }),
  };
}

function byParticipant(project: DiscussionProject) {
  return new Map(project.participants.map((participant) => [participant.id, participant]));
}

function countParticipantEntries(entries: TranscriptEntry[]) {
  const counts = new Map<string, number>();
  entries.forEach((entry) => {
    counts.set(entry.participantId, (counts.get(entry.participantId) ?? 0) + 1);
  });
  return counts;
}

function pickTopParticipant(project: DiscussionProject, score: Map<string, number>) {
  const participants = byParticipant(project);
  const winner = [...score.entries()].sort((left, right) => right[1] - left[1])[0];
  if (!winner || winner[1] <= 0) {
    return undefined;
  }
  return participants.get(winner[0]);
}

function evidenceScore(project: DiscussionProject) {
  const scores = new Map<string, number>();
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));

  project.nodes.forEach((node) => {
    if (!node.participantId) return;
    if (node.type === "evidence") {
      scores.set(node.participantId, (scores.get(node.participantId) ?? 0) + 2 + node.strength / 5);
    }
    if (node.type === "claim") {
      const supportCount = project.relations.filter((relation) => {
        if (relation.targetNodeId !== node.id || relation.type !== "supports") return false;
        const source = nodes.get(relation.sourceNodeId);
        return source?.type === "evidence" || source?.type === "clarification";
      }).length;
      scores.set(node.participantId, (scores.get(node.participantId) ?? 0) + supportCount + 1);
    }
  });

  return scores;
}

function responseScore(project: DiscussionProject) {
  const scores = new Map<string, number>();
  project.entries.forEach((entry) => {
    if (entry.kind === "response") {
      scores.set(entry.participantId, (scores.get(entry.participantId) ?? 0) + 2);
    }
    if (entry.kind === "summary") {
      scores.set(entry.participantId, (scores.get(entry.participantId) ?? 0) + 1);
    }
  });
  return scores;
}

function logicScore(project: DiscussionProject) {
  const scores = new Map<string, number>();
  project.nodes.forEach((node) => {
    if (!node.participantId) return;
    if (["claim", "evidence", "rebuttal", "clarification", "conclusion"].includes(node.type)) {
      scores.set(node.participantId, (scores.get(node.participantId) ?? 0) + 1 + node.strength / 10);
    }
  });
  return scores;
}

function unansweredPressure(project: DiscussionProject) {
  const scores = new Map<string, number>();
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));

  project.nodes.forEach((node) => {
    if (node.type !== "question" || !node.participantId || node.status === "resolved") return;
    const answered = project.relations.some(
      (relation) =>
        relation.targetNodeId === node.id
        && ["responds_to", "clarifies", "concludes"].includes(relation.type),
    );

    if (!answered) {
      scores.set(node.participantId, (scores.get(node.participantId) ?? 0) + 1);
    }
  });

  project.nodes.forEach((node) => {
    if (node.type !== "claim" || !node.participantId) return;
    const hasEvidence = project.relations.some((relation) => {
      if (relation.targetNodeId !== node.id || relation.type !== "supports") return false;
      const source = nodes.get(relation.sourceNodeId);
      return source?.type === "evidence";
    });
    if (!hasEvidence) {
      scores.set(node.participantId, (scores.get(node.participantId) ?? 0) + 1);
    }
  });

  return scores;
}

function repeatedTopics(entries: TranscriptEntry[]) {
  const counts = new Map<string, number>();
  entries.forEach((entry) => {
    entry.tags.forEach((tag) => {
      const normalized = normalizeText(tag);
      if (!normalized) return;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    });
  });

  return [...counts.entries()].filter(([, count]) => count >= 2).slice(0, 3);
}

function includesAny(content: string, terms: string[]) {
  const normalized = normalizeText(content);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function inferEntryArguments(entries: TranscriptEntry[]) {
  return entries
    .filter((entry) => entry.kind === "statement" || entry.kind === "summary")
    .filter((entry) => entry.content.length > 24)
    .slice(0, 5)
    .map((entry) => entry.content);
}

function inferEntryEvidence(entries: TranscriptEntry[]) {
  const evidenceTerms = ["evidence", "metric", "metrics", "data", "proof", "reference", "references", "log", "logs", "case", "cases", "证据", "数据", "依据", "根拠", "データ", "preuve", "donnee", "donnees", "reference"];
  return entries
    .filter((entry) => entry.tags.some((tag) => includesAny(tag, evidenceTerms)) || includesAny(entry.content, evidenceTerms))
    .slice(0, 4)
    .map((entry) => entry.content);
}

function inferEntryConflicts(entries: TranscriptEntry[]) {
  const conflictTerms = ["risk", "concern", "concerns", "unresolved", "conflict", "issue", "issues", "objection", "pressure", "controversy", "dispute", "风险", "争议", "冲突", "未解决", "未回应", "懸念", "未解決", "risque", "preoccupation", "conflit", "controverse", "non resolu"];
  return entries
    .filter((entry) => entry.kind === "question" || entry.tags.some((tag) => includesAny(tag, conflictTerms)) || includesAny(entry.content, conflictTerms))
    .slice(0, 4)
    .map((entry) => entry.content);
}

function buildInsights(project: DiscussionProject, context: AnalysisContext): InsightItem[] {
  const t = strings(context.locale);
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const items: InsightItem[] = [];

  project.nodes.forEach((node) => {
    const incoming = project.relations.filter((relation) => relation.targetNodeId === node.id);
    const incomingTypes = incoming.map((relation) => relation.type);

    if (incomingTypes.includes("supports") && incomingTypes.includes("rebuts")) {
      items.push({
        id: `ins_${node.id}_controversy`,
        category: "controversy",
        title: t.controversyTitle(node.title),
        detail: t.controversyDetail,
        severity: 3,
        status: "open",
        relatedEntryIds: node.entryIds,
        relatedNodeIds: [node.id],
      });
    }

    if (node.type === "question" && node.status !== "resolved") {
      const answered = incomingTypes.some((type) => ["responds_to", "clarifies", "concludes"].includes(type));
      if (!answered) {
        items.push({
          id: `ins_${node.id}_question`,
          category: "unanswered",
          title: t.unansweredTitle(node.title),
          detail: t.unansweredDetail,
          severity: 3,
          status: "open",
          relatedEntryIds: node.entryIds,
          relatedNodeIds: [node.id],
        });
      }
    }

    if (node.type === "claim") {
      const hasEvidence = project.relations.some((relation) => {
        if (relation.targetNodeId !== node.id || relation.type !== "supports") return false;
        const source = nodes.get(relation.sourceNodeId);
        return source?.type === "evidence";
      });
      if (!hasEvidence) {
        items.push({
          id: `ins_${node.id}_evidence`,
          category: "evidenceGap",
          title: t.evidenceGapTitle(node.title),
          detail: t.evidenceGapDetail,
          severity: 2,
          status: "watching",
          relatedEntryIds: node.entryIds,
          relatedNodeIds: [node.id],
        });
      }
    }

    if ((node.type === "conclusion" || node.type === "clarification") && node.status === "resolved") {
      items.push({
        id: `ins_${node.id}_consensus`,
        category: "consensus",
        title: t.consensusTitle(node.title),
        detail: t.consensusDetail,
        severity: 1,
        status: "resolved",
        relatedEntryIds: node.entryIds,
        relatedNodeIds: [node.id],
      });
    }

    if ((node.type === "actionItem" || node.status === "open") && node.type !== "question") {
      items.push({
        id: `ins_${node.id}_pending`,
        category: "pending",
        title: t.pendingTitle(node.title),
        detail: t.pendingDetail,
        severity: node.type === "actionItem" ? 2 : 1,
        status: node.status === "resolved" ? "resolved" : "watching",
        relatedEntryIds: node.entryIds,
        relatedNodeIds: [node.id],
      });
    }
  });

  repeatedTopics(project.entries).forEach(([term]) => {
    items.push({
      id: `ins_repeat_${term}`,
      category: "repetition",
      title: t.repetitionTitle(term),
      detail: t.repetitionDetail,
      severity: 1,
      status: "watching",
      relatedEntryIds: project.entries
        .filter((entry) => entry.tags.some((tag) => normalizeText(tag) === term))
        .map((entry) => entry.id),
      relatedNodeIds: [],
    });
  });

  return items.slice(0, 12);
}

function buildRuleBasedOutput(project: DiscussionProject, context: AnalysisContext): AiTaskOutput {
  const t = strings(context.locale);
  const evidenceTop = pickTopParticipant(project, evidenceScore(project));
  const responseTop = pickTopParticipant(project, responseScore(project));
  const logicTop = pickTopParticipant(project, logicScore(project));
  const unansweredTop = pickTopParticipant(project, unansweredPressure(project));
  const questionNodes = project.nodes.filter((node) => node.type === "question" && node.status !== "resolved");
  const contestedNodes = project.nodes.filter((node) => node.status === "contested");
  const evidenceNodes = project.nodes.filter((node) => node.type === "evidence");
  const argumentNodes = project.nodes.filter((node) => ["claim", "rebuttal", "clarification", "conclusion"].includes(node.type));
  const entryArguments = inferEntryArguments(project.entries);
  const entryEvidence = inferEntryEvidence(project.entries);
  const entryConflicts = inferEntryConflicts(project.entries);
  const conclusionNode = project.nodes.find((node) => node.type === "conclusion");
  const recommendationMap = {
    balanced: [t.suggestionEvidence, t.suggestionResponse, t.suggestionAction],
    evidence: [t.suggestionEvidence, t.suggestionAction, t.suggestionResponse],
    responsiveness: [t.suggestionResponse, t.suggestionEvidence, t.suggestionAction],
  } as const;
  const recommendations = [...recommendationMap[context.emphasis]];
  const attachmentEvidence = (context.attachmentContext?.items ?? [])
    .slice(0, 3)
    .map((attachment) => `${attachment.name} (${attachment.kind})`);
  const attachmentSummary = context.attachmentContext?.total
    ? localize(context.locale, {
        "zh-CN": `当前房间还带有 ${context.attachmentContext.total} 个附件上下文，可作为证据或来源材料继续引用。`,
        en: `The room also carries ${context.attachmentContext.total} attachment contexts that can be used as evidence or source material.`,
        ja: `このルームには ${context.attachmentContext.total} 件の添付コンテキストがあり、根拠や資料として参照できます。`,
        fr: `La salle contient egalement ${context.attachmentContext.total} contextes de piece jointe reutilisables comme preuve ou source.`,
      })
    : "";
  const orderedReasons = {
    balanced: [
      evidenceTop ? t.evidenceReason(evidenceTop.name) : undefined,
      responseTop ? t.responseReason(responseTop.name) : undefined,
      logicTop ? t.logicReason(logicTop.name) : undefined,
    ],
    evidence: [
      evidenceTop ? t.evidenceReason(evidenceTop.name) : undefined,
      logicTop ? t.logicReason(logicTop.name) : undefined,
      responseTop ? t.responseReason(responseTop.name) : undefined,
    ],
    responsiveness: [
      responseTop ? t.responseReason(responseTop.name) : undefined,
      evidenceTop ? t.evidenceReason(evidenceTop.name) : undefined,
      logicTop ? t.logicReason(logicTop.name) : undefined,
    ],
  } as const;
  const leaning = context.emphasis === "evidence"
    ? evidenceTop?.name ?? responseTop?.name ?? logicTop?.name ?? t.balanced
    : context.emphasis === "responsiveness"
      ? responseTop?.name ?? evidenceTop?.name ?? logicTop?.name ?? t.balanced
      : evidenceTop?.name ?? responseTop?.name ?? logicTop?.name ?? t.balanced;

  return {
    topic: project.summary.coreTopics[0] ?? project.tags[0] ?? project.title,
    viewpoints: project.participants.map((participant) => `${participant.name}: ${participant.stance || participant.role}`),
    arguments: argumentNodes.length > 0 ? argumentNodes.slice(0, 5).map((node) => node.title) : entryArguments,
    evidence: evidenceNodes.length > 0
      ? [...evidenceNodes.slice(0, 4).map((node) => node.title), ...attachmentEvidence].slice(0, 5)
      : [...entryEvidence, ...attachmentEvidence].slice(0, 5),
    conflicts: contestedNodes.length > 0 ? contestedNodes.slice(0, 4).map((node) => node.title) : entryConflicts,
    summary: [t.overview(project), attachmentSummary].filter(Boolean).join(" "),
    disputes: contestedNodes.length > 0 ? contestedNodes.slice(0, 4).map((node) => node.title) : entryConflicts,
    unresolvedQuestions: questionNodes.slice(0, 4).map((node) => node.title),
    evaluation: {
      leaning,
      favoredByEvidence: evidenceTop?.name ?? t.pending,
      favoredByResponsiveness: responseTop?.name ?? t.pending,
      favoredByLogic: logicTop?.name ?? t.pending,
      moreUnanswered: unansweredTop ? t.unansweredReason(unansweredTop.name) : t.pending,
      confidence: evidenceNodes.length > 0 ? t.confidenceMedium : t.confidenceLow,
      reasons: orderedReasons[context.emphasis].filter((value): value is string => Boolean(value)),
      improvementSuggestions: recommendations,
    },
    conclusion: conclusionNode?.title ?? t.fallbackConclusion,
    suggestions: recommendations,
    recommendations,
    followupQuestions:
      questionNodes.length > 0
        ? questionNodes.slice(0, 4).map((node) => node.title)
        : project.entries
            .filter((entry) => entry.kind === "question")
            .slice(0, 4)
            .map((entry) => entry.content),
  };
}

export function runRuleBasedAnalysis(project: DiscussionProject, context: AnalysisContext): AnalysisResponse {
  const timestamp = new Date().toISOString();
  const providerConfig = context.providerConfig ?? createProviderRuntimeMap().mock;
  const output = buildRuleBasedOutput(project, { ...context, providerConfig });
  const summary = createEmptySummary(context.locale);
  const entryCounts = countParticipantEntries(project.entries);
  const conclusionNode = project.nodes.find((node) => node.type === "conclusion");

  summary.overview = output.summary;
  summary.participantOverview = project.participants.map((participant) =>
    strings(context.locale).participantSummary(participant, entryCounts.get(participant.id) ?? 0),
  );
  summary.coreTopics = [...project.tags.slice(0, 3), ...output.unresolvedQuestions.slice(0, 2)].slice(0, 5);
  summary.majorClaims = project.nodes
    .filter((node) => node.type === "claim" || node.type === "clarification")
    .slice(0, 4)
    .map((node) => node.title);
  summary.keyEvidence = output.evidence;
  summary.majorRebuttals = project.nodes
    .filter((node) => node.type === "rebuttal")
    .slice(0, 4)
    .map((node) => node.title);
  summary.unresolvedQuestions = output.unresolvedQuestions;
  summary.disputes = output.disputes;
  summary.currentConclusion = conclusionNode?.title ?? strings(context.locale).fallbackConclusion;
  summary.nextSteps = project.nodes
    .filter((node) => node.type === "actionItem")
    .slice(0, 3)
    .map((node) => node.title);
  summary.suggestions = output.recommendations;
  summary.followupQuestions = output.followupQuestions;
  summary.evaluation = output.evaluation;

  const packet = buildOrchestrationPacket(project, { ...context, providerConfig }, "mock", "summarizeDiscussion");
  const orchestration = buildProviderTaskResult(
    "mock",
    "summarizeDiscussion",
    packet,
    output,
    localize(context.locale, {
      "zh-CN": "已完成基于规则的 AI 编排分析。",
      en: "Rule-based AI orchestration analysis completed.",
      ja: "ルールベースの AI オーケストレーション分析が完了しました。",
      fr: "L'analyse d'orchestration IA basée sur des règles est terminée.",
    }),
  );

  return {
    insights: {
      updatedAt: timestamp,
      items: buildInsights(project, context),
    },
    summary,
    providerSnapshot: createProviderSnapshot("mock", providerConfig.model, `mock-${context.emphasis}`, timestamp),
    orchestration,
  };
}

export function buildDisabledAnalysis(project: DiscussionProject, context: AnalysisContext): AnalysisResponse {
  const providerConfig = context.providerConfig ?? createProviderRuntimeMap().disabled;
  const output = buildAdapterScaffoldOutput(project, { ...context, providerConfig }, "disabled");
  const summary = createEmptySummary(context.locale);
  summary.overview = localize(context.locale, {
    "zh-CN": "当前已关闭自动 AI 分析，但讨论结构、导入导出流程和 provider 接口仍然可用。",
    en: "Automated AI analysis is disabled, while the discussion structure, import/export flow, and provider surface remain available.",
    ja: "自動 AI 分析は無効ですが、議論構造、インポート/エクスポート、provider インターフェースは引き続き利用できます。",
    fr: "L'analyse IA automatique est désactivée, mais la structure de discussion, l'import/export et la surface provider restent disponibles.",
  });
  summary.suggestions = output.suggestions;
  summary.followupQuestions = output.followupQuestions;
  summary.disputes = output.disputes;
  summary.unresolvedQuestions = output.unresolvedQuestions;
  summary.currentConclusion = output.conclusion;
  summary.evaluation = output.evaluation;

  const packet = buildOrchestrationPacket(project, { ...context, providerConfig }, "disabled", "summarizeDiscussion");
  const orchestration = buildProviderTaskResult(
    "disabled",
    "summarizeDiscussion",
    packet,
    output,
    localize(context.locale, {
      "zh-CN": "Provider 已禁用，返回本地离线分析。",
      en: "Provider disabled; local offline analysis returned.",
      ja: "provider が無効化されているため、ローカル分析を返しました。",
      ko: "Provider가 비활성화되어 로컬 오프라인 분석을 반환했습니다.",
      fr: "Provider désactivé ; une analyse locale de remplacement a été renvoyée.",
      ru: "Provider отключен; возвращен локальный офлайн-анализ.",
    }),
  );

  return {
    insights: createEmptyInsights(new Date().toISOString()),
    summary,
    providerSnapshot: createProviderSnapshot("disabled", providerConfig.model, "disabled"),
    orchestration,
  };
}



