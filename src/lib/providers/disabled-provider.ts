import { buildDisabledAnalysis } from "@/lib/analysis/rule-based";
import { getProviderDescriptor } from "@/lib/providers/provider-catalog";
import { AiProvider, AnalysisContext, ProviderConversationResult } from "@/lib/types";

const descriptor = getProviderDescriptor("disabled");

if (!descriptor) {
  throw new Error("Disabled provider descriptor is missing.");
}

function localize(locale: AnalysisContext["locale"], values: Partial<Record<AnalysisContext["locale"], string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export const disabledProvider: AiProvider = {
  descriptor,
  async testConnection() {
    return {
      ok: false,
      providerId: "disabled",
      checkedAt: new Date().toISOString(),
      message: "Disabled adapter state is active; remote execution is unavailable until you switch to an executable provider.",
    };
  },
  async summarizeDiscussion(project, context) {
    const result = buildDisabledAnalysis(project, context).orchestration;
    return {
      ...result,
      message: localize(context.locale, {
        "zh-CN": "当前处于已禁用适配状态，不会尝试任何远程模型调用。",
        en: "The disabled adapter state is active, so no remote model call will be attempted.",
        ja: "無効化アダプター状態のため、外部モデル呼び出しは行われません。",
        ko: "비활성화된 어댑터 상태이므로 원격 모델 호출은 시도되지 않습니다.",
        fr: "L etat d adaptateur desactive est actif ; aucun appel de modele distant ne sera tente.",
        ru: "Активно состояние отключенного адаптера, поэтому удаленный вызов модели выполняться не будет.",
      }),
    };
  },
  async evaluateDiscussion(project, context) {
    const result = buildDisabledAnalysis(project, context).orchestration;
    return {
      ...result,
      message: localize(context.locale, {
        "zh-CN": "当前处于已禁用适配状态，仅返回本地评估草案。",
        en: "The disabled adapter state is active, so only a local offline evaluation is returned.",
        ja: "無効化アダプター状態のため、ローカル評価のみを返します。",
        ko: "비활성화된 어댑터 상태이므로 로컬 평가만 반환됩니다.",
        fr: "L etat d adaptateur desactive est actif ; seule une evaluation locale de substitution est renvoyee.",
        ru: "Активно состояние отключенного адаптера, поэтому возвращается только локальная черновая оценка.",
      }),
    };
  },
  async generateFollowupQuestions(project, context) {
    const result = buildDisabledAnalysis(project, context).orchestration;
    return {
      ...result,
      message: localize(context.locale, {
        "zh-CN": "当前处于已禁用适配状态，仅返回本地追问草案。",
        en: "The disabled adapter state is active, so only local offline follow-up questions are returned.",
        ja: "無効化アダプター状態のため、ローカルの追問のみを返します。",
        ko: "비활성화된 어댑터 상태이므로 로컬 후속 질문만 반환됩니다.",
        fr: "L etat d adaptateur desactive est actif ; seules des questions de suivi locales de substitution sont renvoyees.",
        ru: "Активно состояние отключенного адаптера, поэтому возвращаются только локальные черновые уточняющие вопросы.",
      }),
    };
  },
  async multiperspectiveSummary(project, context) {
    const result = buildDisabledAnalysis(project, context).orchestration;
    return {
      ...result,
      message: localize(context.locale, {
        "zh-CN": "当前处于已禁用适配状态，仅返回本地多视角摘要草案。",
        en: "The disabled adapter state is active, so only a local offline multi-perspective summary is returned.",
        ja: "無効化アダプター状態のため、ローカルの多視点サマリーのみを返します。",
        ko: "비활성화된 어댑터 상태이므로 로컬 다중 관점 요약만 반환됩니다.",
        fr: "L etat d adaptateur desactive est actif ; seul un resume multi-perspectives local est renvoye.",
        ru: "Активно состояние отключенного адаптера, поэтому возвращается только локальный черновик многоперспективного резюме.",
      }),
    };
  },
  async debateAnalysis(project, context) {
    const result = buildDisabledAnalysis(project, context).orchestration;
    return {
      ...result,
      message: localize(context.locale, {
        "zh-CN": "当前处于已禁用适配状态，仅返回本地辩论分析草案。",
        en: "The disabled adapter state is active, so only a local offline debate analysis is returned.",
        ja: "無効化アダプター状態のため、ローカルのディベート分析のみを返します。",
        ko: "비활성화된 어댑터 상태이므로 로컬 토론 분석만 반환됩니다.",
        fr: "L etat d adaptateur desactive est actif ; seule une analyse de debat locale est renvoyee.",
        ru: "Активно состояние отключенного адаптера, поэтому возвращается только локальный черновик анализа дебатов.",
      }),
    };
  },
  async respondInConversation(_project, context): Promise<ProviderConversationResult> {
    return {
      ok: false,
      providerId: "disabled",
      model: context.providerConfig.model,
      generatedAt: new Date().toISOString(),
      message: localize(context.locale, {
        "zh-CN": "当前处于已禁用适配状态，不会发起任何远程或本地 AI 对话调用。",
        en: "The disabled adapter state is active, so no remote or local AI conversation call will be attempted.",
        ja: "無効化アダプター状態のため、外部またはローカルの AI 対話呼び出しは行われません。",
        ko: "비활성화된 어댑터 상태이므로 원격 또는 로컬 AI 대화 호출은 시도되지 않습니다.",
        fr: "L etat d adaptateur desactive est actif ; aucun appel de conversation IA local ou distant ne sera tente.",
        ru: "Активно состояние отключенного адаптера, поэтому ни локальный, ни удаленный AI-вызов диалога не будет выполнен.",
      }),
      reply: localize(context.locale, {
        "zh-CN": "当前 Provider / 模式不支持远程执行，所以个人 AI 工作台无法执行。请先在设置中切换到支持执行的 Provider。",
        en: "The current provider / mode cannot execute remote AI calls, so the personal AI workspace is unavailable. Switch to an execution-capable provider in Settings.",
        ja: "現在の Provider / モードではリモート実行できないため、個人 AI ワークスペースは利用できません。Settings で実行可能な Provider に切り替えてください。",
        ko: "현재 Provider / 모드는 원격 AI 실행을 지원하지 않아 개인 AI 워크스페이스를 사용할 수 없습니다. 설정에서 실행 가능한 Provider로 전환하세요.",
        fr: "Le provider / mode actuel ne permet pas l execution distante de l IA, donc l espace IA personnel est indisponible. Basculez vers un provider executable dans les reglages.",
        ru: "Текущий провайдер / режим не поддерживает удаленное AI-выполнение, поэтому персональное AI-пространство недоступно. Переключитесь в настройках на исполняемый провайдер.",
      }),
    };
  },
  async analyze(project, context) {
    return buildDisabledAnalysis(project, context);
  },
};
