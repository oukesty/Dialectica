import { buildOrchestrationPacket, buildProviderTaskResult } from "@/lib/ai/orchestration";
import { runRuleBasedAnalysis } from "@/lib/analysis/rule-based";
import { createProviderRuntimeMap } from "@/lib/factories";
import { getProviderDescriptor } from "@/lib/providers/provider-catalog";
import { AiProvider, AnalysisContext, ProviderConversationResult, ProviderConversationTurn } from "@/lib/types";

const descriptor = getProviderDescriptor("mock");

if (!descriptor) {
  throw new Error("Mock provider descriptor is missing.");
}

function localize(locale: AnalysisContext["locale"], values: Partial<Record<AnalysisContext["locale"], string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function getFallbackConfig() {
  return createProviderRuntimeMap().mock;
}

function splitMockStreamReply(text: string, chunkSize = 8) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
}

function waitForMockStreamTurn(signal: AbortSignal | undefined, timeoutMs = 48) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Mock stream aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Mock stream aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isSimpleGreeting(text: string) {
  const normalized = text.trim().toLowerCase();
  return /^(hi|hello|hey|yo|good morning|good afternoon|good evening)[.!。\s]*$/i.test(normalized)
    || /^(你好|您好|嗨|哈喽|早上好|下午好|晚上好)[。！!\s]*$/i.test(normalized)
    || /^(こんにちは|こんばんは|おはよう|안녕|안녕하세요|bonjour|salut|привет|здравствуйте)[.!。！\s]*$/i.test(normalized);
}

function isModelIdentityQuestion(text: string) {
  const normalized = text.trim().toLowerCase();
  return /(what|which).{0,24}(model|ai).{0,24}(are you|you are)/i.test(normalized)
    || /(你是|你的).{0,12}(什么|哪).{0,12}(模型|ai|人工智能)/i.test(normalized)
    || /(模型|model).{0,12}(是什么|哪一个|which|what)/i.test(normalized);
}

function isPlatformQuestion(text: string) {
  const normalized = text.trim().toLowerCase();
  return /(what|which).{0,20}(platform|app|workspace).{0,20}(are you|is this|run)/i.test(normalized)
    || /(platform|app|workspace).{0,20}(running|hosted|inside)/i.test(normalized)
    || /(你|这个).{0,12}(运行|所在|使用).{0,12}(平台|应用|工作区)/i.test(normalized)
    || /(平台|应用|工作区).{0,12}(是什么|是哪|叫什么)/i.test(normalized);
}

function buildMockGreetingReply(locale: AnalysisContext["locale"]) {
  const variants = {
    "zh-CN": ["你好！想聊点什么？", "嗨，我在。你想从哪里开始？", "你好。有什么想法或问题，直接说就好。"],
    en: ["Hi! What would you like to talk about?", "Hey, I’m here. Where should we start?", "Hello. Send me whatever you want to work through."],
    ja: ["こんにちは。何から話しましょうか？", "はい、います。どこから始めますか？"],
    ko: ["안녕하세요. 무엇부터 이야기해 볼까요?", "네, 여기 있어요. 어디서부터 시작할까요?"],
    fr: ["Bonjour. De quoi voulez-vous parler ?", "Salut, je suis là. Par où commence-t-on ?"],
    ru: ["Привет. О чём хотите поговорить?", "Я здесь. С чего начнём?"],
  } satisfies Record<AnalysisContext["locale"], string[]>;
  const candidates = variants[locale] ?? variants.en;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function buildMockConversationReply(locale: AnalysisContext["locale"], prompt: string, history: ProviderConversationTurn[], attachmentPreview?: string) {
  const latestAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content;
  const latestUser = [...history].reverse().find((turn) => turn.role === "user")?.content ?? prompt;
  const trimmedPrompt = prompt.trim() || latestUser.trim();
  const attachmentNote = attachmentPreview ? attachmentPreview.slice(0, 120) : "";

  if (isSimpleGreeting(trimmedPrompt)) {
    return buildMockGreetingReply(locale);
  }

  if (isModelIdentityQuestion(trimmedPrompt)) {
    return localize(locale, {
      "zh-CN": "我是本地 mock 对话适配器，用来验证聊天流程；切换到真实提供方后，会由对应模型按自己的方式回答。",
      en: "I’m the local mock chat adapter used to validate the chat flow. When you switch to a live provider, that model can answer in its own style.",
      ja: "私はチャット動作を検証するためのローカル mock アダプターです。実際のプロバイダーに切り替えると、そのモデル自身の応答になります。",
      ko: "저는 채팅 흐름 검증용 로컬 mock 어댑터입니다. 실제 제공업체로 전환하면 해당 모델이 자신의 방식으로 답합니다.",
      fr: "Je suis l'adaptateur de conversation mock local utilisé pour vérifier le flux de chat. Avec un fournisseur réel, le modèle répondra dans son propre style.",
      ru: "Я локальный mock-адаптер для проверки чата. При переключении на реального поставщика модель будет отвечать в собственном стиле.",
    });
  }

  if (isPlatformQuestion(trimmedPrompt)) {
    return localize(locale, {
      "zh-CN": "这段对话运行在 Dialectica 工作区里。它提供 AI 对话、协作讨论、自动总结、知识整理和 2D/3D 知识图谱；我会只在你问到平台时才使用这些背景。",
      en: "This chat is running inside the Dialectica workspace. It supports AI conversation, collaborative discussion, automatic summaries, knowledge organization, and 2D/3D knowledge graphs; I use that background only when it is relevant.",
      ja: "このチャットは Dialectica ワークスペース内で動いています。AI 対話、共同議論、自動要約、知識整理、2D/3D 知識グラフを支援しますが、この背景は必要なときだけ使います。",
      ko: "이 대화는 Dialectica 작업공간 안에서 실행되고 있습니다. AI 대화, 협업 토론, 자동 요약, 지식 정리, 2D/3D 지식 그래프를 지원하며, 관련 있을 때만 이 배경을 사용합니다.",
      fr: "Cette conversation s'exécute dans l'espace de travail Dialectica. Il prend en charge la conversation IA, la discussion collaborative, les résumés automatiques, l'organisation des connaissances et les graphes 2D/3D ; je n'utilise ce contexte que lorsqu'il est pertinent.",
      ru: "Этот чат работает в рабочем пространстве Dialectica. Оно поддерживает AI-диалоги, совместные обсуждения, автообобщения, организацию знаний и 2D/3D-графы; я использую этот контекст только когда он уместен.",
    });
  }

  if (locale === "zh-CN") {
    return `${trimmedPrompt ? `我先围绕“${trimmedPrompt.slice(0, 120)}”继续。` : "我先继续当前对话。"}目前这是本地 mock 对话回复，所以我会优先整理上下文、指出关键信息缺口，并给出下一步建议。${attachmentNote ? `\n\n附件内容摘录：${attachmentNote}` : ""}${latestAssistant ? `\n\n上一轮 AI 输出：${latestAssistant.slice(0, 160)}` : ""}`;
  }
  if (locale === "ja") {
    return `${trimmedPrompt ? `まず「${trimmedPrompt.slice(0, 120)}」を軸に続けます。` : "現在の対話を続けます。"}これはローカル mock 応答なので、文脈整理と次の確認ポイントを優先して返します。${attachmentNote ? `\n\n添付内容: ${attachmentNote}` : ""}${latestAssistant ? `\n\n前回の AI 出力: ${latestAssistant.slice(0, 160)}` : ""}`;
  }
  if (locale === "ko") {
    return `${trimmedPrompt ? `우선 "${trimmedPrompt.slice(0, 120)}"을 중심으로 이어가겠습니다.` : "현재 대화를 이어가겠습니다."} 이것은 로컬 mock 응답이므로 맥락 정리와 다음 확인 포인트를 우선해서 답변합니다.${attachmentNote ? `\n\n첨부 내용: ${attachmentNote}` : ""}${latestAssistant ? `\n\n이전 AI 응답: ${latestAssistant.slice(0, 160)}` : ""}`;
  }
  if (locale === "fr") {
    return `${trimmedPrompt ? `Je poursuis d'abord autour de « ${trimmedPrompt.slice(0, 120)} ». ` : "Je poursuis d'abord cette conversation. "}Comme il s'agit d'une réponse mock locale, je privilégie la remise en contexte, les angles manquants et la prochaine étape utile.${attachmentNote ? `\n\nExtrait de la piece jointe : ${attachmentNote}` : ""}${latestAssistant ? `\n\nDernière réponse IA : ${latestAssistant.slice(0, 160)}` : ""}`;
  }
  if (locale === "ru") {
    return `${trimmedPrompt ? `Сначала продолжу вокруг «${trimmedPrompt.slice(0, 120)}». ` : "Сначала продолжу текущий разговор. "}Это локальный mock-ответ, поэтому я прежде всего удерживаю контекст, отмечаю пробелы и предлагаю следующий полезный шаг.${attachmentNote ? `\n\nФрагмент вложения: ${attachmentNote}` : ""}${latestAssistant ? `\n\nПредыдущий ответ ИИ: ${latestAssistant.slice(0, 160)}` : ""}`;
  }
  return `${trimmedPrompt ? `I’ll continue from “${trimmedPrompt.slice(0, 120)}.” ` : "I’ll continue the current conversation. "}This is a local mock reply, so I’m prioritizing context framing, missing evidence, and a practical next step.${attachmentNote ? `\n\nAttachment excerpt: ${attachmentNote}` : ""}${latestAssistant ? `\n\nPrevious AI reply: ${latestAssistant.slice(0, 160)}` : ""}`;
}

function extractMockGraphConversation(prompt: string) {
  const jsonConversation = prompt.match(/"conversation":"([\s\S]*?)"\s*}/);
  if (jsonConversation?.[1]) {
    return jsonConversation[1].replace(/\\n/g, "\n").replace(/\\"/g, "\"");
  }
  const plainConversation = prompt.match(/Conversation:\s*([\s\S]*?)\n\s*\{/i);
  return plainConversation?.[1]?.trim() ?? prompt;
}

function compactMockGraphLabel(text: string, fallback: string) {
  const cleaned = text
    .replace(/\[[^\]]+\]:/g, "")
    .replace(/[{}[\]"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  const words = cleaned.split(/\s+/).slice(0, 7).join(" ");
  return words.replace(/[.,;:!?。！？]+$/g, "") || fallback;
}

function buildMockKnowledgeGraphReply(prompt: string) {
  const conversation = extractMockGraphConversation(prompt);
  const sentences = conversation
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((item) => item.replace(/\[[^\]]+\]:/g, "").trim())
    .filter((item) => item.length >= 16);
  const first = sentences[0] ?? conversation.slice(0, 220);
  const second = sentences.find((item) => item !== first) ?? first;
  return JSON.stringify({
    nodes: [
      {
        id: "n1",
        label: compactMockGraphLabel(first, "Primary discussion evidence"),
        type: "evidence",
        description: first.slice(0, 260),
      },
      {
        id: "n2",
        label: compactMockGraphLabel(second, "Follow-up decision requirement"),
        type: "recommendation",
        description: second === first
          ? `Confirm the decision path implied by: ${first.slice(0, 220)}`
          : second.slice(0, 260),
      },
    ],
    relations: [
      {
        source: "n1",
        target: "n2",
        label: "source evidence informs the next decision",
        type: "supports",
      },
    ],
  });
}

export const mockProvider: AiProvider = {
  descriptor,
  async testConnection() {
    return {
      ok: true,
      providerId: "mock",
      checkedAt: new Date().toISOString(),
      message: "Mock provider is available for local validation.",
    };
  },
  async summarizeDiscussion(project, context) {
    return runRuleBasedAnalysis(project, context).orchestration;
  },
  async evaluateDiscussion(project, context) {
    const result = runRuleBasedAnalysis(project, context);
    const packet = buildOrchestrationPacket(project, context, "mock", "evaluateDiscussion");
    return buildProviderTaskResult(
      "mock",
      "evaluateDiscussion",
      packet,
      result.orchestration.output,
      localize(context.locale, {
        "zh-CN": "Mock 提供方已完成本地评估。",
        en: "Mock provider evaluation completed.",
        ja: "Mock プロバイダーによるローカル評価が完了しました。",
        ko: "Mock 제공자의 로컬 평가가 완료되었습니다.",
        fr: "L'évaluation locale du fournisseur mock est terminée.",
        ru: "Локальная оценка mock-провайдера завершена.",
      }),
    );
  },
  async generateFollowupQuestions(project, context) {
    const result = runRuleBasedAnalysis(project, context);
    const packet = buildOrchestrationPacket(project, context, "mock", "generateFollowupQuestions");
    return buildProviderTaskResult(
      "mock",
      "generateFollowupQuestions",
      packet,
      result.orchestration.output,
      localize(context.locale, {
        "zh-CN": "Mock 提供方已完成后续问题生成。",
        en: "Mock provider follow-up generation completed.",
        ja: "Mock プロバイダーによるフォローアップ質問生成が完了しました。",
        ko: "Mock 제공자의 후속 질문 생성이 완료되었습니다.",
        fr: "La génération de questions de suivi par le fournisseur mock est terminée.",
        ru: "Генерация последующих вопросов mock-провайдером завершена.",
      }),
    );
  },
  async multiperspectiveSummary(project, context) {
    const result = runRuleBasedAnalysis(project, context);
    const packet = buildOrchestrationPacket(project, context, "mock", "multiperspectiveSummary");
    return buildProviderTaskResult(
      "mock",
      "multiperspectiveSummary",
      packet,
      result.orchestration.output,
      localize(context.locale, {
        "zh-CN": "Mock 多视角摘要已完成。",
        en: "Mock multi-perspective summary completed.",
        ja: "Mock 多視点サマリーが完了しました。",
        ko: "Mock 다중 관점 요약이 완료되었습니다.",
        fr: "Le résumé multi-perspectives mock est terminé.",
        ru: "Mock-многоперспективное резюме завершено.",
      }),
    );
  },
  async debateAnalysis(project, context) {
    const result = runRuleBasedAnalysis(project, context);
    const packet = buildOrchestrationPacket(project, context, "mock", "debateAnalysis");
    return buildProviderTaskResult(
      "mock",
      "debateAnalysis",
      packet,
      result.orchestration.output,
      localize(context.locale, {
        "zh-CN": "Mock 辩论分析已完成。",
        en: "Mock debate analysis completed.",
        ja: "Mock ディベート分析が完了しました。",
        ko: "Mock 토론 분석이 완료되었습니다.",
        fr: "L'analyse de débat mock est terminée.",
        ru: "Mock-анализ дебатов завершён.",
      }),
    );
  },
  async respondInConversation(_project, context, options): Promise<ProviderConversationResult> {
    const reply = context.goal === "Return JSON knowledge graph"
      ? buildMockKnowledgeGraphReply(options.prompt)
      : buildMockConversationReply(context.locale, options.prompt, options.history, context.attachmentContext?.items.find((item) => item.previewText)?.previewText);
    return {
      ok: true,
      providerId: "mock",
      model: context.providerConfig.model || getFallbackConfig().model,
      generatedAt: new Date().toISOString(),
      message: localize(context.locale, {
        "zh-CN": "Mock 提供方已返回本地对话回复。",
        en: "Mock provider returned a local conversation reply.",
        ja: "Mock プロバイダーがローカル対話返信を返しました。",
        ko: "Mock 제공자가 로컬 대화 응답을 반환했습니다.",
        fr: "Le fournisseur mock a renvoyé une réponse de conversation locale.",
        ru: "Mock-провайдер вернул локальный ответ в диалоге.",
      }),
      reply,
    };
  },
  async streamConversation(_project, context, options) {
    const reply = buildMockConversationReply(
      context.locale,
      options.prompt,
      options.history,
      context.attachmentContext?.items.find((item) => item.previewText)?.previewText,
    );
    async function* chunks() {
      if (!reply) {
        return;
      }

      const replyChunks = splitMockStreamReply(reply);
      for (let index = 0; index < replyChunks.length; index += 1) {
        if (options.signal?.aborted) {
          return;
        }

        if (index > 0) {
          try {
            await waitForMockStreamTurn(options.signal);
          } catch {
            return;
          }
        }

        yield { type: "content" as const, text: replyChunks[index] };
      }
    }
    return chunks();
  },
  async analyze(project, context) {
    return runRuleBasedAnalysis(project, {
      ...context,
      providerConfig: context.providerConfig ?? getFallbackConfig(),
    });
  },
};
