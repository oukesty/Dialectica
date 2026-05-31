import { NextResponse } from "next/server";
import { z } from "zod";
import { bundledSampleProjectIds } from "@/data/samples";
import { buildProviderExecutionConfig, resolveRoomAiExecutionContext } from "@/lib/ai/execution";
import { appendSummaryHistory, evaluateAssistiveSummaryDecision, evaluateSummaryBatchQuality, getEffectiveSummaryAutomation, getSummaryProcessedEntryCount, type NormalizedSummaryAutomationMode } from "@/lib/ai/summary-automation";
import { appendCollaborationMessage, getCollaborationState, sanitizeCollaborationStateForClient, syncCollaborationState } from "@/lib/collaboration/store";
import { createProviderSnapshot } from "@/lib/factories";
import { getProject, getSettings, upsertProject } from "@/lib/data/repository";
import { recordEmailNotificationAttempt } from "@/lib/email-notifications";
import { getProjectAccessState } from "@/lib/project-access";
import { appendAuditLog } from "@/lib/audit";
import { appendNotification } from "@/lib/notifications";
import { getProvider } from "@/lib/providers/registry";
import { AppLocale, AiTask, AI_TASKS, DiscussionProject, OrchestrationStage, ProjectSummary, ProviderTaskResult } from "@/lib/types";
import { isLocale } from "@/lib/i18n";
import { createId, normalizeText } from "@/lib/utils";

const requestSchema = z.object({
  task: z.enum(AI_TASKS).optional().default("summarizeDiscussion"),
  locale: z.string().optional(),
  triggerSource: z.enum(["manual", "automation"]).optional().default("manual"),
});

function getStage(task: AiTask): OrchestrationStage {
  if (task === "evaluateDiscussion") return "evaluation";
  if (task === "generateFollowupQuestions") return "followup";
  return "final-summary";
}

function unique(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeText(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function localize<T>(locale: AppLocale, values: Partial<Record<AppLocale, T>> & { en: T }) {
  return values[locale] ?? values.en;
}

function canProviderRunTask(task: AiTask, provider: ReturnType<typeof getProvider>) {
  if (task === "summarizeDiscussion") return provider.descriptor.capabilities.summarizeDiscussion;
  if (task === "evaluateDiscussion") return provider.descriptor.capabilities.evaluateDiscussion;
  if (task === "generateFollowupQuestions") return provider.descriptor.capabilities.generateFollowupQuestions;
  if (task === "multiperspectiveSummary") return provider.descriptor.capabilities.multiperspectiveSummary;
  return provider.descriptor.capabilities.debateAnalysis;
}

function compactSummaryItems(values: string[], limit: number) {
  return unique(values)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 8)
    .slice(0, limit)
    .map((value) => value.length > 180 ? `${value.slice(0, 177).trim()}...` : value);
}

function buildStructuredSummaryOverview(output: ProviderTaskResult["output"], locale: AppLocale) {
  const labels = localize(locale, {
    "zh-CN": {
      focus: "本轮重点",
      conclusion: "已达成结论",
      risks: "争议 / 风险",
      actions: "行动项",
      open: "未解决问题",
    },
    en: {
      focus: "Key points",
      conclusion: "Conclusions",
      risks: "Disputes / risks",
      actions: "Action items",
      open: "Open questions",
    },
    ja: {
      focus: "要点",
      conclusion: "結論",
      risks: "争点 / リスク",
      actions: "アクション",
      open: "未解決事項",
    },
    ko: {
      focus: "핵심",
      conclusion: "결론",
      risks: "쟁점 / 위험",
      actions: "실행 항목",
      open: "미해결 질문",
    },
    fr: {
      focus: "Points cles",
      conclusion: "Conclusions",
      risks: "Desaccords / risques",
      actions: "Actions",
      open: "Questions ouvertes",
    },
    ru: {
      focus: "Ключевые пункты",
      conclusion: "Выводы",
      risks: "Споры / риски",
      actions: "Действия",
      open: "Открытые вопросы",
    },
  });
  const sections = [
    [labels.focus, compactSummaryItems([output.summary, ...output.arguments, ...output.evidence], 3)],
    [labels.conclusion, compactSummaryItems([output.conclusion], 1)],
    [labels.risks, compactSummaryItems([...output.disputes, ...output.conflicts], 3)],
    [labels.actions, compactSummaryItems(output.recommendations, 3)],
    [labels.open, compactSummaryItems(output.unresolvedQuestions, 3)],
  ] as const;
  return sections
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => `${label}: ${items.join("; ")}`)
    .join("\n");
}

function buildMergedSummary(project: DiscussionProject, taskResult: ProviderTaskResult, locale: AppLocale): ProjectSummary {
  const overview = buildStructuredSummaryOverview(taskResult.output, locale) || taskResult.output.summary || project.summary.overview;
  return {
    ...project.summary,
    overview,
    participantOverview: compactSummaryItems([...taskResult.output.viewpoints, ...project.summary.participantOverview], 8),
    coreTopics: unique([taskResult.output.topic, ...project.summary.coreTopics]).slice(0, 6),
    majorClaims: compactSummaryItems([...taskResult.output.arguments, ...project.summary.majorClaims], 8),
    keyEvidence: compactSummaryItems([...taskResult.output.evidence, ...project.summary.keyEvidence], 8),
    majorRebuttals: compactSummaryItems([...taskResult.output.conflicts, ...project.summary.majorRebuttals], 8),
    unresolvedQuestions: compactSummaryItems([...taskResult.output.unresolvedQuestions, ...project.summary.unresolvedQuestions], 8),
    disputes: compactSummaryItems([...taskResult.output.disputes, ...taskResult.output.conflicts, ...project.summary.disputes], 8),
    currentConclusion: taskResult.output.conclusion || project.summary.currentConclusion,
    nextSteps: compactSummaryItems([...taskResult.output.recommendations, ...project.summary.nextSteps], 8),
    suggestions: compactSummaryItems([...taskResult.output.suggestions, ...taskResult.output.recommendations, ...project.summary.suggestions], 8),
    followupQuestions: compactSummaryItems([...taskResult.output.followupQuestions, ...project.summary.followupQuestions], 8),
    evaluation: project.summary.evaluation,
  };
}

function hasUsableSummaryResult(taskResult: ProviderTaskResult) {
  const summary = taskResult.output.summary.trim();
  if (!taskResult.ok || !summary) return false;
  const normalized = normalizeText(`${summary} ${taskResult.message}`);
  return ![
    "setup preview",
    "no api key",
    "save credentials",
    "接入预览",
    "配置模型与密钥",
    "服务端或已保存 api key",
  ].some((phrase) => normalized.includes(normalizeText(phrase)));
}

function resolveAttachmentContextUrl(request: Request, projectId: string, attachment: { id: string; publicUrl?: string; storage: "local" | "external" }) {
  if (attachment.publicUrl) {
    return attachment.publicUrl;
  }

  if (attachment.storage === "local") {
    const url = new URL(request.url);
    return `${url.origin}/api/projects/${projectId}/attachments/${attachment.id}`;
  }

  return undefined;
}

function buildAiFeedMessage(task: AiTask, locale: AppLocale, summary: string, extra: string[]) {
  const prefix = task === "evaluateDiscussion"
    ? {
        "zh-CN": "AI 评估",
        en: "AI evaluation",
        ja: "AI 評価",
        ko: "AI 평가",
        fr: "Évaluation IA",
        ru: "AI-оценка",
      }
    : task === "generateFollowupQuestions"
      ? {
          "zh-CN": "AI 跟进问题",
          en: "AI follow-up questions",
          ja: "AI フォローアップ質問",
          ko: "AI 후속 질문",
          fr: "Questions de suivi IA",
          ru: "Последующие вопросы ИИ",
        }
      : {
          "zh-CN": "AI 总结",
          en: "AI summary",
          ja: "AI 要約",
          ko: "AI 요약",
          fr: "Résumé IA",
          ru: "AI-сводка",
        };
  const label = localize(locale, prefix);
  return `${label}: ${summary}${extra.length > 0 ? `\n\n- ${extra.join("\n- ")}` : ""}`;
}

export function automationAllowsTask(project: DiscussionProject, task: AiTask) {
  const automation = getEffectiveSummaryAutomation(project);
  return task === "summarizeDiscussion" && automation.mode !== "off";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const rawPayload = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(rawPayload);

  if (!parsed.success) {
    const settings = await getSettings();
    const rawLocale = typeof rawPayload === "object" && rawPayload !== null && "locale" in rawPayload
      ? String((rawPayload as { locale?: unknown }).locale ?? "")
      : "";
    const locale: AppLocale = isLocale(rawLocale) ? rawLocale : settings.locale;
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "AI 任务请求无效，请刷新页面后重试。",
        en: "The AI task request is invalid. Refresh the page and try again.",
        ja: "AI タスクリクエストが無効です。ページを更新して再試行してください。",
        ko: "AI 작업 요청이 올바르지 않습니다. 페이지를 새로고침한 뒤 다시 시도하세요.",
        fr: "La requete de tache IA est invalide. Actualisez la page puis reessayez.",
        ru: "Запрос задачи ИИ недействителен. Обновите страницу и повторите попытку.",
      }),
      issues: parsed.error.issues,
    }, { status: 400 });
  }

  const payload = parsed.data;
  const settings = await getSettings();
  const requestedLocale = isLocale(payload.locale ?? "") ? (payload.locale as AppLocale) : undefined;
  const project: DiscussionProject = await getProject(projectId, requestedLocale ?? settings.locale);
  const locale = requestedLocale ?? project.language;
  const access = getProjectAccessState(project, settings);
  const task = payload.task;
  const triggerSource = payload.triggerSource;

  if (bundledSampleProjectIds.has(projectId) && task === "summarizeDiscussion") {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": "示例工作区不能运行总结任务。",
          en: "Sample workspaces cannot run summary tasks.",
          ja: "サンプルワークスペースでは要約タスクを実行できません。",
          ko: "샘플 워크스페이스에서는 요약 작업을 실행할 수 없습니다.",
          fr: "Les espaces d'exemple ne peuvent pas lancer de tâches de résumé.",
          ru: "В примерах рабочих пространств нельзя запускать задачи сводки.",
        }),
      },
      { status: 403 },
    );
  }

  if (triggerSource === "manual" && !access.canRunAiTasks) {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": access.canJoinPublicRoom ? "请先加入这个公共房间，再发起项目级 AI 分析。" : "当前身份不能对这个项目执行 AI 分析。",
          en: access.canJoinPublicRoom ? "Join this public room before running project-level AI analysis." : "Your current identity cannot run AI analysis for this project.",
          ja: access.canJoinPublicRoom ? "この公開ルームに参加してから、プロジェクトレベルの AI 分析を実行してください。" : "現在のプロフィールではこのプロジェクトの AI 分析を実行できません。",
          fr: access.canJoinPublicRoom ? "Rejoignez d'abord ce salon public avant de lancer une analyse IA au niveau du projet." : "Votre identité actuelle ne peut pas lancer l'analyse IA de ce projet.",
        }),
      },
      { status: access.canJoinPublicRoom ? 409 : 403 },
    );
  }

  if (triggerSource === "automation" && !automationAllowsTask(project, task)) {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": "当前房间没有为这个自动化任务开放触发权限。",
          en: "This room is not configured to trigger that automation task.",
          ja: "このルームではその自動化タスクを実行する設定になっていません。",
          fr: "Ce salon n'est pas configuré pour declencher cette tache automatique.",
        }),
      },
      { status: 409 },
    );
  }

  const collaborationState = await getCollaborationState(project);
  const roomAiConfig = project.room.aiConfig;
  const execution = await resolveRoomAiExecutionContext(project, settings);
  const controllerLabel = execution.currentIdentityControlsSoloRoom
    ? settings.profile.displayName
    : execution.controllerParticipant?.name
      ?? localize(locale, {
        "zh-CN": "房间主持人",
        en: "room host",
        ja: "ルームホスト",
        fr: "hôte du salon",
      });
  const executionSettings = execution.executionSettings;

  if (!executionSettings) {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": `这个房间当前绑定的是 ${controllerLabel} 的 AI 配置，但本地没有找到对应的已保存设置。请让房主重新保存该房间的 AI 配置。`,
          en: `This room is currently bound to ${controllerLabel}'s AI configuration, but Dialectica could not load that saved profile locally. Ask the host to save the room AI configuration again.`,
          ja: `このルームは現在 ${controllerLabel} の AI 設定に紐づいていますが、対応する保存済みプロフィールをローカルで読み込めませんでした。ホストにルーム AI 設定を再保存してもらってください。`,
          fr: `Ce salon utilise actuellement la configuration IA de ${controllerLabel}, mais Dialectica n'a pas trouvé le profil enregistré correspondant en local. Demandez à l'hôte de réenregistrer la configuration IA du salon.`,
        }),
      },
      { status: 409 },
    );
  }

  const summaryHistoryRetention = {
    mode: executionSettings.discussionPreferences.summaryHistoryRetentionMode,
    limit: executionSettings.discussionPreferences.summaryHistoryRetentionLimit,
  } as const;

  const providerId = execution.providerId;
  const providerConfig = execution.providerConfig;
  const normalizedModel = execution.normalizedModel;

  if (!providerConfig) {
    return NextResponse.json({ error: localize(locale, {
      "zh-CN": "当前房间缺少可用的 AI Provider 配置。",
      en: "This room does not have a usable AI provider configuration.",
      ja: "このルームには利用可能な AI プロバイダー設定がありません。",
      fr: "Ce salon ne dispose pas d'une configuration IA exploitable.",
    }) }, { status: 409 });
  }

  if (!execution.modelSupported) {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": `${providerId} 不支持模型 ${execution.requestedModel}。请由房主在设置页保存该提供方目录中的有效模型。`,
          en: `${providerId} does not support model ${execution.requestedModel}. Ask the room host to save a valid model for this provider in Settings.`,
          ja: `${providerId} はモデル ${execution.requestedModel} をサポートしていません。ルームホストに Settings で有効なモデルを保存してもらってください。`,
          fr: `${providerId} ne prend pas en charge le modèle ${execution.requestedModel}. Demandez à l'hôte du salon d'enregistrer un modèle valide pour ce fournisseur dans les réglages.`,
        }),
      },
      { status: 400 },
    );
  }

  const provider = getProvider(providerId);
  if (!canProviderRunTask(task, provider)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": `${providerId} 当前未实现 ${task} 能力，请切换到支持该任务的模型或 provider。`,
        en: `${providerId} does not currently support the ${task} task. Switch to a provider/model that supports it.`,
        ja: `${providerId} は現在 ${task} タスクに対応していません。対応している provider / model に切り替えてください。`,
        fr: `${providerId} ne prend pas actuellement en charge la tâche ${task}. Basculez vers un provider / modèle compatible.`,
      }),
    }, { status: 409 });
  }

  const baseContext = {
    locale,
    emphasis: executionSettings.provider.mockEmphasis,
    stage: getStage(task),
    goal: project.goal,
    providerConfig: buildProviderExecutionConfig(providerId, providerConfig, normalizedModel),
    requestTimeoutMs: executionSettings.provider.requestTimeoutMs,
    preferServerKeys: executionSettings.provider.preferServerKeys,
    allowFallbackToScaffold: executionSettings.provider.allowFallbackToScaffold,
    attachmentContext: {
      total: collaborationState.attachments.length,
      items: collaborationState.attachments.slice(0, 8).map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        note: attachment.note,
        previewText: attachment.previewText,
        uploadedAt: attachment.uploadedAt,
        uploadedByParticipantId: attachment.uploadedByParticipantId,
        storage: attachment.storage,
        localPath: attachment.localPath,
        publicUrl: resolveAttachmentContextUrl(request, project.id, attachment),
      })),
    },
  };

  const normalizedAutomation = getEffectiveSummaryAutomation(project);
  const totalEntryCount = project.entries.length;
  const previouslyProcessedEntryCount = getSummaryProcessedEntryCount(project);
  const pendingSummaryEntries = project.entries.slice(previouslyProcessedEntryCount);

  const nextInsights = project.insights;
  let nextProviderSnapshot = project.providerSnapshot;
  let taskResult: ProviderTaskResult;
  let mergedSummary = project.summary;
  let shouldAppendFeedMessage = true;
  let automationDecision: {
    mode: NormalizedSummaryAutomationMode;
    summarized: boolean;
    thresholdUsed?: number;
    nextThreshold?: number;
    pendingEntryCount: number;
    rationale?: string;
  } | null = null;
  let nextAutomation = {
    mode: normalizedAutomation.mode,
    summaryThreshold: normalizedAutomation.summaryThreshold,
    summaryCurrentThreshold: normalizedAutomation.summaryCurrentThreshold,
    summaryLastProcessedEntryCount: normalizedAutomation.summaryLastProcessedEntryCount,
    autoReplyThreshold: normalizedAutomation.summaryThreshold,
    permissions: {
      facilitatorCanManage: project.room.aiAutomation?.permissions?.facilitatorCanManage ?? false,
      facilitatorCanTrigger: project.room.aiAutomation?.permissions?.facilitatorCanTrigger ?? false,
    },
  };

  if (task === "summarizeDiscussion") {
    taskResult = await provider.summarizeDiscussion(project, { ...baseContext, stage: "final-summary" });
    if (!hasUsableSummaryResult(taskResult)) {
      const errorMessage = localize(locale, {
        "zh-CN": `AI 总结失败，未保存新的总结。${taskResult.message}`,
        en: `AI summary failed, so no new summary was saved. ${taskResult.message}`,
        ja: `AI 要約に失敗したため、新しい要約は保存されませんでした。${taskResult.message}`,
        ko: `AI 요약에 실패하여 새 요약을 저장하지 않았습니다. ${taskResult.message}`,
        fr: `Le resume IA a echoue ; aucun nouveau resume n'a ete enregistre. ${taskResult.message}`,
        ru: `Сводка ИИ не удалась, новая сводка не сохранена. ${taskResult.message}`,
      });
      void appendAuditLog({
        action: "ai.summarizeDiscussion.failed",
        actorId: executionSettings.profile.localIdentityId,
        actorName: executionSettings.profile.displayName,
        projectId,
        details: `AI task "summarizeDiscussion" failed via ${providerId}/${normalizedModel}; no summary was saved.`,
      });
      return NextResponse.json({
        error: errorMessage,
        providerId,
        task,
        taskResult: {
          ok: taskResult.ok,
          message: taskResult.message,
        },
      }, { status: 502 });
    }
    nextProviderSnapshot = createProviderSnapshot(
      providerId,
      normalizedModel,
      triggerSource === "automation" ? "summary-auto" : "summary-live",
      taskResult.generatedAt,
    );
    const baseSummary = buildMergedSummary(project, taskResult, locale);
    const thresholdUsed = triggerSource === "automation"
      ? normalizedAutomation.mode === "assistive"
        ? normalizedAutomation.summaryCurrentThreshold
        : normalizedAutomation.summaryThreshold
      : undefined;
    const basicSummaryDecision = triggerSource === "automation" && normalizedAutomation.mode === "basic"
      ? evaluateSummaryBatchQuality({
          pendingEntries: pendingSummaryEntries,
          output: taskResult.output,
          previousSummary: project.summary,
          mode: "basic",
        })
      : null;

    nextAutomation = {
      ...nextAutomation,
      summaryLastProcessedEntryCount: totalEntryCount,
      summaryCurrentThreshold: normalizedAutomation.mode === "assistive"
        ? normalizedAutomation.summaryCurrentThreshold
        : normalizedAutomation.summaryThreshold,
    };

    if (triggerSource === "automation" && normalizedAutomation.mode === "assistive") {
      const assistiveDecision = evaluateAssistiveSummaryDecision({
        baseThreshold: normalizedAutomation.summaryThreshold,
        currentThreshold: normalizedAutomation.summaryCurrentThreshold,
        pendingEntries: pendingSummaryEntries,
        output: taskResult.output,
        previousSummary: project.summary,
      });

      nextAutomation = {
        ...nextAutomation,
        summaryCurrentThreshold: assistiveDecision.nextThreshold,
      };

      automationDecision = {
        mode: "assistive",
        summarized: assistiveDecision.shouldPersistSummary,
        thresholdUsed,
        nextThreshold: assistiveDecision.nextThreshold,
        pendingEntryCount: pendingSummaryEntries.length,
        rationale: assistiveDecision.rationale,
      };

      if (assistiveDecision.shouldPersistSummary) {
        mergedSummary = {
          ...baseSummary,
          history: appendSummaryHistory(project.summary.history, {
            id: createId("summary"),
            createdAt: taskResult.generatedAt,
            trigger: "auto-assistive",
            providerId,
            model: normalizedModel,
            thresholdUsed,
            nextThreshold: assistiveDecision.nextThreshold,
            throughEntryCount: totalEntryCount,
            overview: baseSummary.overview,
            currentConclusion: baseSummary.currentConclusion,
            nextSteps: baseSummary.nextSteps,
          }, summaryHistoryRetention),
        };
      } else {
        mergedSummary = project.summary;
        shouldAppendFeedMessage = false;
      }
    } else if (triggerSource === "automation" && normalizedAutomation.mode === "basic" && basicSummaryDecision && !basicSummaryDecision.shouldPersistSummary) {
      mergedSummary = project.summary;
      shouldAppendFeedMessage = false;
      automationDecision = {
        mode: "basic",
        summarized: false,
        thresholdUsed,
        nextThreshold: nextAutomation.summaryCurrentThreshold,
        pendingEntryCount: pendingSummaryEntries.length,
        rationale: basicSummaryDecision.rationale,
      };
    } else {
      const trigger: "auto-basic" | "manual" = triggerSource === "automation" ? "auto-basic" : "manual";
      mergedSummary = {
        ...baseSummary,
        history: appendSummaryHistory(project.summary.history, {
          id: createId("summary"),
          createdAt: taskResult.generatedAt,
          trigger,
          providerId,
          model: normalizedModel,
          thresholdUsed,
          nextThreshold: normalizedAutomation.mode === "assistive" ? normalizedAutomation.summaryCurrentThreshold : normalizedAutomation.summaryThreshold,
          throughEntryCount: totalEntryCount,
          overview: baseSummary.overview,
          currentConclusion: baseSummary.currentConclusion,
          nextSteps: baseSummary.nextSteps,
        }, summaryHistoryRetention),
      };
      automationDecision = triggerSource === "automation"
        ? {
            mode: normalizedAutomation.mode === "assistive" ? "assistive" : "basic",
            summarized: true,
            thresholdUsed,
            nextThreshold: nextAutomation.summaryCurrentThreshold,
            pendingEntryCount: pendingSummaryEntries.length,
            rationale: basicSummaryDecision?.rationale,
          }
        : null;
    }
  } else if (task === "evaluateDiscussion") {
    taskResult = await provider.evaluateDiscussion(project, { ...baseContext, stage: "evaluation" });
    nextProviderSnapshot = createProviderSnapshot(providerId, normalizedModel, "evaluation-live", taskResult.generatedAt);
    mergedSummary = {
      ...project.summary,
      coreTopics: unique([taskResult.output.topic, ...project.summary.coreTopics]).slice(0, 5),
      majorClaims: taskResult.output.arguments.length > 0 ? taskResult.output.arguments.slice(0, 5) : project.summary.majorClaims,
      keyEvidence: taskResult.output.evidence.length > 0 ? taskResult.output.evidence.slice(0, 5) : project.summary.keyEvidence,
      disputes: unique([...project.summary.disputes, ...taskResult.output.disputes]),
      unresolvedQuestions: unique([...project.summary.unresolvedQuestions, ...taskResult.output.unresolvedQuestions]),
      currentConclusion: taskResult.output.conclusion || project.summary.currentConclusion,
      suggestions: unique([...project.summary.suggestions, ...taskResult.output.recommendations, ...taskResult.output.suggestions]),
      nextSteps: unique([...project.summary.nextSteps, ...taskResult.output.recommendations]),
      evaluation: taskResult.output.evaluation,
    };
  } else {
    taskResult = task === "generateFollowupQuestions"
      ? await provider.generateFollowupQuestions(project, { ...baseContext, stage: "followup" })
      : task === "multiperspectiveSummary"
        ? await provider.multiperspectiveSummary(project, { ...baseContext, stage: "final-summary" })
        : await provider.debateAnalysis(project, { ...baseContext, stage: "final-summary" });
    nextProviderSnapshot = createProviderSnapshot(
      providerId,
      normalizedModel,
      task === "generateFollowupQuestions"
        ? "followup-live"
        : task === "multiperspectiveSummary"
          ? "multiperspective-live"
          : "debate-live",
      taskResult.generatedAt,
    );
    mergedSummary = {
      ...project.summary,
      coreTopics: unique([taskResult.output.topic, ...project.summary.coreTopics]).slice(0, 5),
      disputes: unique([...project.summary.disputes, ...taskResult.output.disputes]),
      unresolvedQuestions: unique([...project.summary.unresolvedQuestions, ...taskResult.output.unresolvedQuestions]),
      currentConclusion: taskResult.output.conclusion || project.summary.currentConclusion,
      suggestions: unique([...project.summary.suggestions, ...taskResult.output.suggestions]),
      nextSteps: unique([...project.summary.nextSteps, ...taskResult.output.recommendations]),
      followupQuestions: task === "generateFollowupQuestions"
        ? unique([...project.summary.followupQuestions, ...taskResult.output.followupQuestions])
        : project.summary.followupQuestions,
    };
  }

  const savedProject = await upsertProject(
    {
      ...project,
      insights: nextInsights,
      summary: mergedSummary,
      providerSnapshot: nextProviderSnapshot,
      room: {
        ...project.room,
        aiAutomation: nextAutomation,
        aiConfig: {
          ...project.room.aiConfig,
          providerId,
          model: normalizedModel,
          ownerIdentityId: roomAiConfig.ownerIdentityId ?? executionSettings.profile.localIdentityId,
          ownerParticipantId: execution.controllerParticipant?.id ?? roomAiConfig.ownerParticipantId,
        },
      },
    },
    locale,
    { skipAutoAnalyze: true, settingsOverride: executionSettings },
  );
  await syncCollaborationState(savedProject);
  const summarySkipped = task === "summarizeDiscussion" && !shouldAppendFeedMessage;
  void appendAuditLog({
    action: summarySkipped ? `ai.${task}.skipped` : `ai.${task}`,
    actorId: executionSettings.profile.localIdentityId,
    actorName: executionSettings.profile.displayName,
    projectId,
    details: summarySkipped
      ? `AI task "${task}" evaluated a low-signal batch via ${providerId}/${normalizedModel} and skipped persistence.`
      : `AI task "${task}" via ${providerId}/${normalizedModel}`,
  });
  if (!summarySkipped) {
    void appendNotification(executionSettings.profile.localIdentityId, {
      type: "ai_summary",
      title: `AI ${task}`,
      body: `AI completed "${task}" for project`,
      projectId,
      href: `/${locale}/projects/${projectId}`,
    });
  }
  if (!summarySkipped && executionSettings.emailNotifications?.enabled && executionSettings.emailNotifications?.onAiSummary) {
    void recordEmailNotificationAttempt(executionSettings.profile.localIdentityId, executionSettings, {
      title: localize(locale, {
        "zh-CN": "邮件通知未发送：AI 总结",
        en: "Email notification not sent: AI summary",
        ja: "メール通知は未送信：AI 要約",
        ko: "이메일 알림 미전송: AI 요약",
        fr: "Notification e-mail non envoyee : resume IA",
        ru: "Email-уведомление не отправлено: сводка ИИ",
      }),
      body: localize(locale, {
        "zh-CN": `AI 已完成 ${task}。当前未配置外部邮件 Provider，因此不会向 ${executionSettings.emailNotifications.emailAddress || "收件人"} 发送真实邮件。`,
        en: `AI completed ${task}. No external email provider is configured, so no real email was sent to ${executionSettings.emailNotifications.emailAddress || "the recipient"}.`,
        ja: `AI が ${task} を完了しました。外部メール Provider が未設定のため、${executionSettings.emailNotifications.emailAddress || "受信者"} へ実際のメールは送信されません。`,
        ko: `AI가 ${task} 작업을 완료했습니다. 외부 이메일 Provider가 설정되어 있지 않아 ${executionSettings.emailNotifications.emailAddress || "수신자"}에게 실제 이메일은 전송되지 않았습니다.`,
        fr: `L'IA a termine ${task}. Aucun Provider e-mail externe n'est configure ; aucun e-mail reel n'a ete envoye a ${executionSettings.emailNotifications.emailAddress || "le destinataire"}.`,
        ru: `ИИ завершил ${task}. Внешний email-провайдер не настроен, поэтому настоящее письмо на ${executionSettings.emailNotifications.emailAddress || "адрес получателя"} не отправлялось.`,
      }),
      projectId,
    });
  }

  const collaboration = shouldAppendFeedMessage
    ? await appendCollaborationMessage(savedProject, {
        type: "system",
        actorType: "ai",
        aiTask: task,
        message: buildAiFeedMessage(
          task,
          locale,
          task === "summarizeDiscussion" ? mergedSummary.overview : taskResult.output.summary,
          task === "generateFollowupQuestions"
            ? taskResult.output.followupQuestions.slice(0, 3)
            : task === "evaluateDiscussion"
              ? taskResult.output.evaluation.reasons.slice(0, 3)
              : taskResult.output.recommendations.slice(0, 3),
        ),
        metadata: {
          providerId,
          model: savedProject.providerSnapshot.model,
          controllerIdentityId: savedProject.room.aiConfig.ownerIdentityId ?? "",
          triggerSource,
          ...(automationDecision ? {
            automationMode: automationDecision.mode,
            summarized: String(automationDecision.summarized),
            thresholdUsed: automationDecision.thresholdUsed ? String(automationDecision.thresholdUsed) : "",
            nextThreshold: automationDecision.nextThreshold ? String(automationDecision.nextThreshold) : "",
          } : {}),
        },
      })
    : await getCollaborationState(savedProject);

  return NextResponse.json({
    providerId,
    task,
    roomAiConfig: savedProject.room.aiConfig,
    project: savedProject,
    analysis: {
      insights: savedProject.insights,
      summary: mergedSummary,
      providerSnapshot: savedProject.providerSnapshot,
    },
    taskResult,
    automationDecision,
    collaboration: sanitizeCollaborationStateForClient(collaboration),
    knowledge: null,
  });
}
