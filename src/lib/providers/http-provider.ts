import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildAdapterScaffoldOutput, buildOrchestrationPacket, buildProviderTaskResult } from "@/lib/ai/orchestration";
import { createEmptyInsights, createEmptySummary, createProviderSnapshot } from "@/lib/factories";
import { getProviderDescriptor } from "@/lib/providers/provider-catalog";
import { resolveProviderApiKey, resolveProviderBaseUrl } from "@/lib/providers/runtime";
import {
  AiProvider,
  AiTask,
  AiTaskOutput,
  AnalysisContext,
  DiscussionProject,
  ProviderConnectionContext,
  ProviderConnectionResult,
  ProviderConversationResult,
  ProviderConversationStreamChunk,
  ProviderConversationTurn,
  ProviderId,
  ProviderRuntimeConfig,
  ProviderTaskResult,
} from "@/lib/types";

type AdapterKind = "openai-responses" | "openai-chat" | "anthropic-messages" | "gemini-generate";

function localize(locale: AnalysisContext["locale"], values: Partial<Record<AnalysisContext["locale"], string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, suffix: string) {
  return `${trimTrailingSlash(baseUrl)}/${suffix.replace(/^\/+/, "")}`;
}

function timeoutMs(context: Pick<AnalysisContext, "requestTimeoutMs">) {
  return Math.max(1000, Math.min(context.requestTimeoutMs || 30000, 120000));
}

async function fetchJson(url: string, init: RequestInit, timeout: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    let json: unknown = undefined;

    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    return { response, text, json };
  } finally {
    clearTimeout(timer);
  }
}

function extractTextFromUnknownPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  if (Array.isArray(record.output)) {
    const collected = record.output.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const text = (part as Record<string, unknown>).text;
        return typeof text === "string" ? [text] : [];
      });
    });

    if (collected.length > 0) {
      return collected.join("\n");
    }
  }

  if (Array.isArray(record.content)) {
    const collected = record.content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    });

    if (collected.length > 0) {
      return collected.join("\n");
    }
  }

  if (Array.isArray(record.choices) && record.choices[0] && typeof record.choices[0] === "object") {
    const message = (record.choices[0] as Record<string, unknown>).message;
    if (message && typeof message === "object") {
      const msg = message as Record<string, unknown>;
      // DeepSeek reasoner: include reasoning_content before the main content
      const reasoningContent = typeof msg.reasoning_content === "string" ? msg.reasoning_content : "";
      const content = msg.content;
      if (typeof content === "string") {
        return reasoningContent ? `${reasoningContent}\n\n${content}` : content;
      }
      if (Array.isArray(content)) {
        const collected = content.flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? [text] : [];
        });
        if (collected.length > 0) {
          const main = collected.join("\n");
          return reasoningContent ? `${reasoningContent}\n\n${main}` : main;
        }
      }
      // Fallback: if only reasoning_content exists (no regular content)
      if (reasoningContent) return reasoningContent;
    }
  }

  if (Array.isArray(record.candidates) && record.candidates[0] && typeof record.candidates[0] === "object") {
    const content = (record.candidates[0] as Record<string, unknown>).content;
    if (content && typeof content === "object") {
      const parts = (content as Record<string, unknown>).parts;
      if (Array.isArray(parts)) {
        const collected = parts.flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? [text] : [];
        });
        if (collected.length > 0) {
          return collected.join("\n");
        }
      }
    }
  }

  return "";
}

function extractConversationPartsFromUnknownPayload(payload: unknown): { reply: string; reasoning?: string } {
  if (!payload || typeof payload !== "object") {
    return { reply: "" };
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.choices) && record.choices[0] && typeof record.choices[0] === "object") {
    const message = (record.choices[0] as Record<string, unknown>).message;
    if (message && typeof message === "object") {
      const msg = message as Record<string, unknown>;
      const reasoning = typeof msg.reasoning_content === "string" ? msg.reasoning_content.trim() : "";
      const content = msg.content;

      if (typeof content === "string") {
        return {
          reply: content.trim(),
          reasoning: reasoning || undefined,
        };
      }

      if (Array.isArray(content)) {
        const main = content.flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? [text] : [];
        }).join("\n").trim();

        return {
          reply: main,
          reasoning: reasoning || undefined,
        };
      }

      if (reasoning) {
        return { reply: "", reasoning };
      }
    }
  }

  return { reply: extractTextFromUnknownPayload(payload).trim() };
}

function extractJsonObject(rawText: string) {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? rawText;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) {
    return undefined;
  }

  try {
    return JSON.parse(candidate.slice(first, last + 1)) as Partial<AiTaskOutput>;
  } catch {
    return undefined;
  }
}

function normalizeOutput(rawText: string, fallback: AiTaskOutput): AiTaskOutput {
  const parsed = extractJsonObject(rawText);
  if (!parsed) {
    return {
      ...fallback,
      summary: rawText.trim() || fallback.summary,
    };
  }

  return {
    topic: typeof parsed.topic === "string" && parsed.topic.trim() ? parsed.topic.trim() : fallback.topic,
    viewpoints: Array.isArray(parsed.viewpoints)
      ? parsed.viewpoints.filter((item): item is string => typeof item === "string")
      : fallback.viewpoints,
    arguments: Array.isArray(parsed.arguments)
      ? parsed.arguments.filter((item): item is string => typeof item === "string")
      : fallback.arguments,
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((item): item is string => typeof item === "string")
      : fallback.evidence,
    conflicts: Array.isArray(parsed.conflicts)
      ? parsed.conflicts.filter((item): item is string => typeof item === "string")
      : fallback.conflicts,
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : fallback.summary,
    disputes: Array.isArray(parsed.disputes)
      ? parsed.disputes.filter((item): item is string => typeof item === "string")
      : fallback.disputes,
    unresolvedQuestions: Array.isArray(parsed.unresolvedQuestions)
      ? parsed.unresolvedQuestions.filter((item): item is string => typeof item === "string")
      : fallback.unresolvedQuestions,
    evaluation: parsed.evaluation && typeof parsed.evaluation === "object"
      ? {
          ...fallback.evaluation,
          ...parsed.evaluation,
        }
      : fallback.evaluation,
    conclusion: typeof parsed.conclusion === "string" && parsed.conclusion.trim() ? parsed.conclusion.trim() : fallback.conclusion,
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((item): item is string => typeof item === "string")
      : fallback.suggestions,
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((item): item is string => typeof item === "string")
      : fallback.recommendations,
    followupQuestions: Array.isArray(parsed.followupQuestions)
      ? parsed.followupQuestions.filter((item): item is string => typeof item === "string")
      : fallback.followupQuestions,
  };
}

function buildPrompt(project: DiscussionProject, context: AnalysisContext, providerId: ProviderId, task: AiTask) {
  const packet = buildOrchestrationPacket(project, context, providerId, task);
  const taskInstructions: Partial<Record<AiTask, string>> = {
    summarizeDiscussion: "Create a dense structured summary for the current batch. Prioritize new core claims, decisions, conflicts, risks, action items, unresolved questions, and repeated multi-participant themes. Ignore greetings, acknowledgements, repetition, and low-value system noise. Do not copy long passages.",
    evaluateDiscussion: "Focus on evidence quality, responsiveness, logic continuity, and unresolved objections.",
    generateFollowupQuestions: "Focus on unresolved tensions, missing evidence, and clarifying questions.",
    multiperspectiveSummary: "Analyze from multiple perspectives: objective, subjective, humanitarian, and meeting-minutes. Return a 'perspectives' array with {label, summary} for each perspective.",
    debateAnalysis: "Structure as a debate analysis with pro arguments, con arguments, and neutral observations. Return a 'debatePoints' object with {pro: [], con: [], neutral: []}.",
  };
  const taskInstruction = taskInstructions[task] ?? "Focus on the discussion overview, disputes, unresolved questions, and next steps.";

  // Auto-switch language based on project language or user preference
  const langNames: Record<string, string> = {
    en: "English",
    "zh-CN": "Chinese (Simplified)",
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    ru: "Russian",
  };
  const responseLang = context.replyLanguage && context.replyLanguage !== "auto"
    ? langNames[context.replyLanguage] ?? "English"
    : langNames[project.language] ?? "English";
  const langDirective = `Respond in ${responseLang}. All text values in the JSON must be in ${responseLang}.`;

  const system = `${packet.instructions.system} ${taskInstruction} ${langDirective} Return only valid JSON.`;
  const user = [
    packet.instructions.user,
    "Required JSON shape:",
    JSON.stringify(
      {
        topic: "string",
        viewpoints: ["string"],
        arguments: ["string"],
        evidence: ["string"],
        conflicts: ["string"],
        summary: "string",
        disputes: ["string"],
        unresolvedQuestions: ["string"],
        evaluation: {
          leaning: "string",
          favoredByEvidence: "string",
          favoredByResponsiveness: "string",
          favoredByLogic: "string",
          moreUnanswered: "string",
          confidence: "string",
          reasons: ["string"],
          improvementSuggestions: ["string"],
        },
        conclusion: "string",
        suggestions: ["string"],
        recommendations: ["string"],
        followupQuestions: ["string"],
      },
      null,
      2,
    ),
  ].join("\n\n");

  return { packet, system, user };
}

export function buildConversationPrompt(
  project: DiscussionProject,
  context: AnalysisContext,
  providerId: ProviderId,
  options: { prompt: string; history: ProviderConversationTurn[] },
) {
  const packet = buildOrchestrationPacket(project, context, providerId, "summarizeDiscussion");
  if (context.goal === "Return JSON knowledge graph") {
    return {
      packet,
      system: "You are a JSON-only knowledge graph extraction API. Return exactly one valid JSON object and nothing else.",
      user: options.prompt,
    };
  }
  const recentTurns = options.history.slice(-10).map((turn) => `${turn.role === "assistant" ? "Assistant" : "User"}: ${turn.content}`).join("\n\n");
  const attachmentLines = (context.attachmentContext?.items ?? [])
    .slice(0, 6)
    .map((attachment) => {
      const parts = [attachment.name, attachment.kind, attachment.mimeType];
      if (attachment.note) parts.push(attachment.note);
      if (attachment.previewText) parts.push(`preview: ${attachment.previewText}`);
      if (attachment.publicUrl) parts.push(`url: ${attachment.publicUrl}`);
      return parts.join(" | ");
    })
    .join("\n");
  const langInstruction = context.replyLanguage && context.replyLanguage !== "auto"
    ? `Reply in ${context.replyLanguage === "zh-CN" ? "Chinese (Simplified)" : context.replyLanguage === "ja" ? "Japanese" : context.replyLanguage === "ko" ? "Korean" : context.replyLanguage === "fr" ? "French" : context.replyLanguage === "ru" ? "Russian" : "English"}.`
    : `Reply in the same language as the user's message.`;
  const roleMap: Record<string, string> = {
    assistant: "a helpful discussion assistant",
    moderator: "a meeting moderator who keeps discussions on track",
    "note-taker": "a note-taker who captures key points and action items",
    "debate-judge": "a debate judge who evaluates arguments fairly",
  };
  const lengthMap: Record<string, string> = {
    brief: "Keep responses concise (2-3 sentences).",
    standard: "Provide moderately detailed responses.",
    detailed: "Provide thorough, comprehensive responses.",
  };
  const isSingleUserChat = project.scenario === "ai-dialogue" && project.participants.length <= 1;
  const assistantSurface = context.assistantSurface
    ?? (isSingleUserChat ? "assistant-workspace" : "project-workspace");
  const isPlainAssistantWorkspaceChat = isSingleUserChat && assistantSurface === "assistant-workspace";
  const assistantWorkspaceBoundaryInstruction = "This is an ordinary one-to-one chat. Do not volunteer the platform name, provider, model, project title, project goal, host role, or workspace metadata. Mention them only when the user explicitly asks about the platform, model/provider, current workspace, project, or when that detail is directly necessary to answer.";
  const collaborativeBoundaryInstruction = "Keep the collaboration context lightweight. Use the project, participants, and discussion history when they help the user, but do not turn ordinary replies into product introductions. Mention the platform, provider, or model only when the user asks or when it is directly necessary.";
  const modelIdentityBoundaryInstruction = "If the user asks what model you are, answer naturally and briefly according to the model/provider's own response style. Do not invent a different model identity, hidden system details, or platform-specific claims; avoid forcing a platform-branded template.";
  const platformBackgroundInstruction = "Platform background, only if the user explicitly asks about the platform or workspace: Dialectica is the local-first workspace hosting this chat. It supports AI conversation, collaborative discussion, automatic summaries, knowledge organization, and 2D/3D knowledge graphs. Use this as optional context, not as a required script or marketing pitch.";
  const system = isSingleUserChat
    ? (assistantSurface === "project-workspace"
      ? [
          `You are an AI assistant helping inside the project workspace "${project.title}".`,
          `Current project goal: ${context.goal || project.goal}.`,
          "Use the workspace context when it is helpful, but keep your tone natural rather than formulaic.",
          "Do not claim to be the user, do not use the user's name as your own identity, and do not pretend to speak on the user's behalf unless the user explicitly asks you to draft text for them.",
          collaborativeBoundaryInstruction,
          modelIdentityBoundaryInstruction,
          platformBackgroundInstruction,
          langInstruction,
          lengthMap[context.responseLength ?? "standard"] ?? lengthMap.standard,
          context.focusTopics ? `Focus especially on: ${context.focusTopics}.` : "",
          "Do not return JSON. Return the assistant reply text only.",
        ].filter(Boolean).join(" ")
      : [
          "You are a helpful AI assistant in a one-to-one chat.",
          "Speak naturally, clearly, and helpfully.",
          "If the user is only greeting you or making small talk, reply briefly and naturally instead of turning the conversation into a structured task.",
          "For a simple greeting, do not introduce the platform, propose a workflow, or assign the user a discussion topic unless they ask.",
          "Do not proactively assign a project theme, discussion frame, or platform workflow unless the user asks for one.",
          "Do not claim to be the user, do not use the user's name as your own identity, and do not pretend to speak on the user's behalf unless the user explicitly asks you to draft text for them.",
          assistantWorkspaceBoundaryInstruction,
          modelIdentityBoundaryInstruction,
          platformBackgroundInstruction,
          langInstruction,
          lengthMap[context.responseLength ?? "standard"] ?? lengthMap.standard,
          context.focusTopics ? `Focus especially on: ${context.focusTopics}.` : "",
          "Do not return JSON. Return the assistant reply text only.",
        ].filter(Boolean).join(" "))
    : assistantSurface === "room-facilitator"
      ? [
          `You are an AI facilitator assisting a collaborative room for the project "${project.title}".`,
          `Project goal: ${context.goal || project.goal}.`,
          "Support the discussion with concise summaries, clarifications, and useful follow-up when helpful.",
          "Do not impersonate the host, any participant, or the user.",
          collaborativeBoundaryInstruction,
          modelIdentityBoundaryInstruction,
          platformBackgroundInstruction,
          langInstruction,
          lengthMap[context.responseLength ?? "standard"] ?? lengthMap.standard,
          context.focusTopics ? `Focus especially on: ${context.focusTopics}.` : "",
          "Do not return JSON. Return the assistant reply text only.",
        ].filter(Boolean).join(" ")
    : [
        `You are ${roleMap[context.aiRole ?? "assistant"] ?? "a helpful discussion assistant"} inside the collaborative project "${project.title}".`,
        `Discussion goal: ${context.goal || project.goal}.`,
        `Participants: ${project.participants.map((p) => p.name).join(", ")}.`,
        "Support the discussion naturally with clarification, synthesis, and useful follow-up when it helps.",
        "Do not impersonate the user or any participant.",
        collaborativeBoundaryInstruction,
        modelIdentityBoundaryInstruction,
        platformBackgroundInstruction,
        langInstruction,
        lengthMap[context.responseLength ?? "standard"] ?? lengthMap.standard,
        context.focusTopics ? `Focus especially on: ${context.focusTopics}.` : "",
        context.autoTagging ? "When relevant, suggest topic tags at the end of your reply in the format [tags: tag1, tag2]." : "",
        "Use the existing project context, attachments, and recent turns when they matter.",
        "Do not return JSON. Return the assistant reply text only.",
      ].filter(Boolean).join(" ");
  const user = [
    isPlainAssistantWorkspaceChat ? "" : packet.instructions.user,
    recentTurns ? `Recent conversation:\n${recentTurns}` : "",
    attachmentLines ? `Attachment context:\n${attachmentLines}` : "",
    `Latest user request:\n${options.prompt}`,
  ].filter(Boolean).join("\n\n");

  return { packet, system, user };
}

type OpenAiResponsesInput = Array<{
  role: "system" | "user";
  content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" }>;
}>;

function looksLikeRemoteUrl(value?: string) {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function toAbsoluteAttachmentPath(localPath: string) {
  return path.isAbsolute(localPath) ? path.resolve(localPath) : path.resolve(process.cwd(), localPath);
}

async function buildOpenAiImageContent(context: AnalysisContext) {
  const items = context.attachmentContext?.items ?? [];
  const images = items.filter((attachment) => attachment.kind === "image").slice(0, 4);
  const content: Array<{ type: "input_image"; image_url: string; detail: "auto" }> = [];

  for (const attachment of images) {
    if (attachment.storage === "local" && attachment.localPath) {
      try {
        const bytes = await readFile(toAbsoluteAttachmentPath(attachment.localPath));
        const mimeType = attachment.mimeType || "image/png";
        content.push({
          type: "input_image",
          image_url: `data:${mimeType};base64,${bytes.toString("base64")}`,
          detail: "auto",
        });
      } catch {
        continue;
      }
      continue;
    }

    if (attachment.storage === "external" && looksLikeRemoteUrl(attachment.publicUrl)) {
      content.push({
        type: "input_image",
        image_url: attachment.publicUrl!,
        detail: "auto",
      });
    }
  }

  return content;
}

export async function buildOpenAiResponsesInput(context: AnalysisContext, prompt: { system: string; user: string }): Promise<OpenAiResponsesInput> {
  const userContent: OpenAiResponsesInput[number]["content"] = [
    { type: "input_text", text: prompt.user },
    ...(await buildOpenAiImageContent(context)),
  ];

  return [
    {
      role: "system",
      content: [{ type: "input_text", text: prompt.system }],
    },
    {
      role: "user",
      content: userContent,
    },
  ];
}
function buildFailureResult(
  providerId: ProviderId,
  task: AiTask,
  packet: ReturnType<typeof buildOrchestrationPacket>,
  fallback: AiTaskOutput,
  message: string,
  allowFallbackToScaffold: boolean,
): ProviderTaskResult {
  return {
    ok: false,
    providerId,
    task,
    generatedAt: new Date().toISOString(),
    message,
    packet,
    output: allowFallbackToScaffold
      ? {
          ...fallback,
          summary: message,
          suggestions: fallback.suggestions.length > 0 ? fallback.suggestions : [message],
        }
      : {
          ...fallback,
          summary: message,
          disputes: [],
          unresolvedQuestions: [],
          suggestions: [message],
          followupQuestions: [],
        },
  };
}

function buildLocalizedMissingKeyMessage(providerId: ProviderId, locale: AnalysisContext["locale"]) {
  return localize(locale, {
    "zh-CN": `${providerId} 已切换到真实 HTTP 适配层，但当前没有可用的服务端或已保存 API Key。`,
    en: `${providerId} is wired to a real HTTP adapter, but no server-side or saved API key is available yet.`,
    ja: `${providerId} は実際の HTTP アダプターに接続されていますが、利用可能なサーバー側または保存済みの API キーがまだありません。`,
    fr: `${providerId} utilise maintenant un adaptateur HTTP réel, mais aucune clé API côté serveur ou enregistrée n'est encore disponible.`,
  });
}

async function buildClaudeContent(context: AnalysisContext, text: string): Promise<string | unknown[]> {
  const items = context.attachmentContext?.items ?? [];
  const images = items.filter((a) => a.kind === "image").slice(0, 4);
  if (images.length === 0) return text;
  const content: unknown[] = [{ type: "text", text }];
  for (const img of images) {
    if (img.storage === "local" && img.localPath) {
      try {
        const bytes = await readFile(toAbsoluteAttachmentPath(img.localPath));
        content.push({
          type: "image",
          source: { type: "base64", media_type: img.mimeType || "image/png", data: bytes.toString("base64") },
        });
      } catch { continue; }
    }
  }
  return content;
}

async function buildGeminiParts(context: AnalysisContext, text: string): Promise<unknown[]> {
  const items = context.attachmentContext?.items ?? [];
  const images = items.filter((a) => a.kind === "image").slice(0, 4);
  const parts: unknown[] = [{ text }];
  for (const img of images) {
    if (img.storage === "local" && img.localPath) {
      try {
        const bytes = await readFile(toAbsoluteAttachmentPath(img.localPath));
        parts.push({ inline_data: { mime_type: img.mimeType || "image/png", data: bytes.toString("base64") } });
      } catch { continue; }
    }
  }
  return parts;
}

function buildLocalizedHttpError(providerId: ProviderId, locale: AnalysisContext["locale"], detail: string) {
  return localize(locale, {
    "zh-CN": `${providerId} 真实接口调用失败：${detail}`,
    en: `${providerId} HTTP call failed: ${detail}`,
    ja: `${providerId} の HTTP 呼び出しに失敗しました: ${detail}`,
    fr: `L'appel HTTP ${providerId} a échoué : ${detail}`,
  });
}

async function invokeVendor(
  kind: AdapterKind,
  providerId: ProviderId,
  model: string,
  apiKey: string,
  baseUrl: string,
  context: AnalysisContext,
  prompt: { system: string; user: string },
) {
  const timeout = timeoutMs(context);

  if (kind === "gemini-generate") {
    const url = `${trimTrailingSlash(baseUrl)}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetchJson(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: "user", parts: await buildGeminiParts(context, prompt.user) }],
          generationConfig: {
            temperature: context.providerConfig.temperature,
            responseMimeType: "application/json",
          },
        }),
      },
      timeout,
    );

    return {
      ok: response.response.ok,
      detail: response.response.ok ? extractTextFromUnknownPayload(response.json) || response.text : response.text,
      status: response.response.status,
    };
  }

  if (kind === "anthropic-messages") {
    const response = await fetchJson(
      joinUrl(baseUrl, "messages"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          system: prompt.system,
          messages: [{ role: "user", content: await buildClaudeContent(context, prompt.user) }],
        }),
      },
      timeout,
    );

    return {
      ok: response.response.ok,
      detail: response.response.ok ? extractTextFromUnknownPayload(response.json) || response.text : response.text,
      status: response.response.status,
    };
  }

  if (kind === "openai-responses") {
    const oaiHeaders: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    if (context.providerConfig.organization) oaiHeaders["OpenAI-Organization"] = context.providerConfig.organization;
    const response = await fetchJson(
      joinUrl(baseUrl, "responses"),
      {
        method: "POST",
        headers: oaiHeaders,
        body: JSON.stringify({
          model,
          input: await buildOpenAiResponsesInput(context, prompt),
          max_output_tokens: 1200,
        }),
      },
      timeout,
    );

    return {
      ok: response.response.ok,
      detail: response.response.ok ? extractTextFromUnknownPayload(response.json) || response.text : response.text,
      status: response.response.status,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (providerId === "qwen") {
    headers["X-DashScope-SSE"] = String(context.providerConfig.streaming && context.providerConfig.enabled);
  }

  // DeepSeek Reasoner: no system role, no response_format, no temperature
  const isReasonerModel = model.includes("reasoner");
  const analysisMessages = isReasonerModel
    ? [{ role: "user" as const, content: `${prompt.system}\n\n${prompt.user}` }]
    : [
        { role: "system" as const, content: prompt.system },
        { role: "user" as const, content: prompt.user },
      ];
  const chatCompletionsBody: Record<string, unknown> = {
    model,
    messages: analysisMessages,
  };
  if (!isReasonerModel) {
    chatCompletionsBody.temperature = context.providerConfig.temperature;
    chatCompletionsBody.response_format = { type: "json_object" };
  }

  const response = await fetchJson(
    joinUrl(baseUrl, "chat/completions"),
    {
      method: "POST",
      headers,
      body: JSON.stringify(chatCompletionsBody),
    },
    timeout,
  );

  return {
    ok: response.response.ok,
    detail: response.response.ok ? extractTextFromUnknownPayload(response.json) || response.text : response.text,
    status: response.response.status,
  };
}

/**
 * Build user content for chat/completions endpoints (Grok, Doubao, Qwen, DeepSeek).
 * Uses OpenAI-compatible multipart content format: [{type:"text",...}, {type:"image_url",...}]
 * Falls back to plain string if no images are attached.
 */
async function buildChatCompletionsUserContent(
  context: AnalysisContext,
  text: string,
): Promise<string | Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }>> {
  const items = context.attachmentContext?.items ?? [];
  const images = items.filter((a) => a.kind === "image").slice(0, 4);
  if (images.length === 0) return text;

  const parts: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [
    { type: "text", text },
  ];

  for (const img of images) {
    if (img.storage === "local" && img.localPath) {
      try {
        const bytes = await readFile(toAbsoluteAttachmentPath(img.localPath));
        const mimeType = img.mimeType || "image/png";
        parts.push({
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${bytes.toString("base64")}`, detail: "auto" },
        });
      } catch { continue; }
    } else if (img.storage === "external" && looksLikeRemoteUrl(img.publicUrl)) {
      parts.push({
        type: "image_url",
        image_url: { url: img.publicUrl!, detail: "auto" },
      });
    }
  }

  return parts.length === 1 ? text : parts;
}

function extractStreamChunk(json: unknown): ProviderConversationStreamChunk | null {
  if (!json || typeof json !== "object") {
    return null;
  }

  const payload = json as Record<string, unknown>;
  if (Array.isArray(payload.choices) && payload.choices[0] && typeof payload.choices[0] === "object") {
    const delta = (payload.choices[0] as Record<string, unknown>).delta;
    if (delta && typeof delta === "object") {
      const reasoning = (delta as Record<string, unknown>).reasoning_content;
      if (typeof reasoning === "string" && reasoning) {
        return { type: "reasoning", text: reasoning };
      }
      const content = (delta as Record<string, unknown>).content;
      if (typeof content === "string" && content) {
        return { type: "content", text: content };
      }
    }
  }

  if (payload.type === "response.output_text.delta" && typeof payload.delta === "string" && payload.delta) {
    return { type: "content", text: payload.delta };
  }

  if (payload.type === "content_block_delta" && payload.delta && typeof payload.delta === "object") {
    const text = (payload.delta as Record<string, unknown>).text;
    if (typeof text === "string" && text) {
      return { type: "content", text };
    }
  }

  if (Array.isArray(payload.candidates) && payload.candidates[0] && typeof payload.candidates[0] === "object") {
    const content = (payload.candidates[0] as Record<string, unknown>).content;
    const parts = content && typeof content === "object"
      ? (content as Record<string, unknown>).parts
      : undefined;
    const text = Array.isArray(parts) && parts[0] && typeof parts[0] === "object"
      ? (parts[0] as Record<string, unknown>).text
      : undefined;
    if (typeof text === "string" && text) {
      return { type: "content", text };
    }
  }

  return null;
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ProviderConversationStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      const error = parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)
        ? (parsed as Record<string, unknown>).error
        : undefined;
      if (typeof error === "string" && error) {
        throw new Error(error);
      }
      if (error && typeof error === "object" && "message" in (error as Record<string, unknown>)) {
        const message = (error as Record<string, unknown>).message;
        throw new Error(typeof message === "string" ? message : "Streaming error");
      }

      const chunk = extractStreamChunk(parsed);
      if (chunk) {
        yield chunk;
      }
    }
  }
}

async function invokeVendorConversationStream(
  kind: AdapterKind,
  providerId: ProviderId,
  model: string,
  apiKey: string,
  baseUrl: string,
  context: AnalysisContext,
  prompt: { system: string; user: string },
  signal?: AbortSignal,
) {
  const timeout = timeoutMs(context);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    if (kind === "gemini-generate") {
      const upstream = await fetch(
        `${trimTrailingSlash(baseUrl)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: await buildGeminiParts(context, prompt.user) }],
            generationConfig: { temperature: context.providerConfig.temperature },
          }),
          cache: "no-store",
          signal: controller.signal,
        },
      );

      if (!upstream.ok || !upstream.body) {
        throw new Error(`HTTP ${upstream.status}`);
      }

      return parseSseStream(upstream.body);
    }

    if (kind === "anthropic-messages") {
      const upstream = await fetch(joinUrl(baseUrl, "messages"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1600,
          stream: true,
          system: prompt.system,
          messages: [{ role: "user", content: await buildClaudeContent(context, prompt.user) }],
        }),
        cache: "no-store",
        signal: controller.signal,
      });

      if (!upstream.ok || !upstream.body) {
        throw new Error(`HTTP ${upstream.status}`);
      }

      return parseSseStream(upstream.body);
    }

    if (kind === "openai-responses") {
      const oaiHeaders: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
      if (context.providerConfig.organization) oaiHeaders["OpenAI-Organization"] = context.providerConfig.organization;
      const upstream = await fetch(joinUrl(baseUrl, "responses"), {
        method: "POST",
        headers: oaiHeaders,
        body: JSON.stringify({
          model,
          stream: true,
          input: await buildOpenAiResponsesInput(context, prompt),
          max_output_tokens: 1600,
        }),
        cache: "no-store",
        signal: controller.signal,
      });

      if (!upstream.ok || !upstream.body) {
        throw new Error(`HTTP ${upstream.status}`);
      }

      return parseSseStream(upstream.body);
    }

    const userContent = await buildChatCompletionsUserContent(context, prompt.user);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    if (context.providerConfig.organization) {
      headers["OpenAI-Organization"] = context.providerConfig.organization;
    }

    const convIsReasoner = model.includes("reasoner");
    const convMessages = convIsReasoner
      ? [{ role: "user" as const, content: typeof userContent === "string" ? `${prompt.system}\n\n${userContent}` : userContent }]
      : [
          { role: "system" as const, content: prompt.system },
          { role: "user" as const, content: userContent },
        ];
    const convBody: Record<string, unknown> = {
      model,
      stream: true,
      messages: convMessages,
    };
    if (!convIsReasoner) {
      convBody.temperature = context.providerConfig.temperature;
    }

    const upstream = await fetch(joinUrl(baseUrl, "chat/completions"), {
      method: "POST",
      headers,
      body: JSON.stringify(convBody),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
      throw new Error(`HTTP ${upstream.status}`);
    }

    return parseSseStream(upstream.body);
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener("abort", abortFromCaller);
    }
  }
}

async function invokeVendorConversation(
  kind: AdapterKind,
  _providerId: ProviderId,
  model: string,
  apiKey: string,
  baseUrl: string,
  context: AnalysisContext,
  prompt: { system: string; user: string },
): Promise<{ ok: boolean; detail: string; status: number; reasoning?: string }> {
  const timeout = timeoutMs(context);

  if (kind === "gemini-generate") {
    const url = `${trimTrailingSlash(baseUrl)}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetchJson(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: "user", parts: await buildGeminiParts(context, prompt.user) }],
          generationConfig: {
            temperature: context.providerConfig.temperature,
          },
        }),
      },
      timeout,
    );

    return {
      ok: response.response.ok,
      detail: response.response.ok ? extractTextFromUnknownPayload(response.json) || response.text : response.text,
      status: response.response.status,
    };
  }

  if (kind === "anthropic-messages") {
    const response = await fetchJson(
      joinUrl(baseUrl, "messages"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1600,
          system: prompt.system,
          messages: [{ role: "user", content: await buildClaudeContent(context, prompt.user) }],
        }),
      },
      timeout,
    );

    return {
      ok: response.response.ok,
      detail: response.response.ok ? extractTextFromUnknownPayload(response.json) || response.text : response.text,
      status: response.response.status,
    };
  }

  if (kind === "openai-responses") {
    const oaiHeaders: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    if (context.providerConfig.organization) oaiHeaders["OpenAI-Organization"] = context.providerConfig.organization;
    const response = await fetchJson(
      joinUrl(baseUrl, "responses"),
      {
        method: "POST",
        headers: oaiHeaders,
        body: JSON.stringify({
          model,
          input: await buildOpenAiResponsesInput(context, prompt),
          max_output_tokens: 1600,
        }),
      },
      timeout,
    );

    return {
      ok: response.response.ok,
      detail: response.response.ok ? extractTextFromUnknownPayload(response.json) || response.text : response.text,
      status: response.response.status,
    };
  }

  // Build user content with images for chat/completions (OpenAI-compatible format)
  const userContent = await buildChatCompletionsUserContent(context, prompt.user);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (context.providerConfig.organization) {
    headers["OpenAI-Organization"] = context.providerConfig.organization;
  }

  // When streaming is enabled, request stream and collect chunks
  const useStreaming = Boolean(context.enableStreaming);

  // DeepSeek Reasoner: no system role, no temperature
  const convIsReasoner = model.includes("reasoner");
  const convMessages = convIsReasoner
    ? [{ role: "user" as const, content: typeof userContent === "string" ? `${prompt.system}\n\n${userContent}` : userContent }]
    : [
        { role: "system" as const, content: prompt.system },
        { role: "user" as const, content: userContent },
      ];
  const convBody: Record<string, unknown> = {
    model,
    stream: useStreaming,
    messages: convMessages,
  };
  if (!convIsReasoner) {
    convBody.temperature = context.providerConfig.temperature;
  }

  const response = await fetchJson(
    joinUrl(baseUrl, "chat/completions"),
    {
      method: "POST",
      headers,
      body: JSON.stringify(convBody),
    },
    timeout,
  );

  const conversationParts = response.response.ok
    ? extractConversationPartsFromUnknownPayload(response.json)
    : { reply: response.text, reasoning: undefined };

  return {
    ok: response.response.ok,
    detail: response.response.ok ? (conversationParts.reply || response.text) : response.text,
    reasoning: response.response.ok ? conversationParts.reasoning : undefined,
    status: response.response.status,
  };
}
function mergeIntoSummary(base: ReturnType<typeof createEmptySummary>, output: AiTaskOutput) {
  return {
    ...base,
    overview: output.summary,
    coreTopics: output.topic ? [output.topic, ...base.coreTopics].slice(0, 5) : base.coreTopics,
    majorClaims: output.arguments.length > 0 ? output.arguments.slice(0, 5) : base.majorClaims,
    keyEvidence: output.evidence.length > 0 ? output.evidence.slice(0, 5) : base.keyEvidence,
    disputes: output.disputes,
    unresolvedQuestions: output.unresolvedQuestions,
    currentConclusion: output.conclusion || base.currentConclusion,
    suggestions: output.recommendations.length > 0 ? output.recommendations : output.suggestions,
    followupQuestions: output.followupQuestions,
    evaluation: output.evaluation,
  };
}

export function createHttpProvider(providerId: Exclude<ProviderId, "mock" | "disabled">, kind: AdapterKind): AiProvider {
  const descriptor = getProviderDescriptor(providerId);
  if (!descriptor) {
    throw new Error(`Missing provider descriptor for ${providerId}.`);
  }

  const resolvedDescriptor = descriptor;

  async function runTask(task: AiTask, project: DiscussionProject, context: AnalysisContext): Promise<ProviderTaskResult> {
    const prompt = buildPrompt(project, context, providerId, task);
    const fallback = buildAdapterScaffoldOutput(project, context, providerId);
    const apiKey = resolveProviderApiKey(providerId, context.providerConfig, context);
    const model = context.providerConfig.model || resolvedDescriptor.models[0]?.id || "";
    const baseUrl = resolveProviderBaseUrl(providerId, context.providerConfig);

    if (!apiKey) {
      return buildFailureResult(
        providerId,
        task,
        prompt.packet,
        fallback,
        buildLocalizedMissingKeyMessage(providerId, context.locale),
        context.allowFallbackToScaffold,
      );
    }

    try {
      const result = await invokeVendor(kind, providerId, model, apiKey, baseUrl, context, prompt);
      if (!result.ok) {
        return buildFailureResult(
          providerId,
          task,
          prompt.packet,
          fallback,
          buildLocalizedHttpError(providerId, context.locale, `HTTP ${result.status}`),
          context.allowFallbackToScaffold,
        );
      }

      const output = normalizeOutput(result.detail, fallback);
      return buildProviderTaskResult(
        providerId,
        task,
        prompt.packet,
        output,
        localize(context.locale, {
          "zh-CN": `${resolvedDescriptor.vendor} 已返回真实 HTTP 响应。`,
          en: `${resolvedDescriptor.vendor} returned a live HTTP response.`,
          ja: `${resolvedDescriptor.vendor} から実際の HTTP 応答が返されました。`,
          fr: `${resolvedDescriptor.vendor} a renvoyé une réponse HTTP réelle.`,
        }),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return buildFailureResult(
        providerId,
        task,
        prompt.packet,
        fallback,
        buildLocalizedHttpError(providerId, context.locale, detail),
        context.allowFallbackToScaffold,
      );
    }
  }

  async function testConnection(config: ProviderRuntimeConfig, connectionContext: ProviderConnectionContext = {}): Promise<ProviderConnectionResult> {
    const pseudoContext: AnalysisContext = {
      locale: "en",
      emphasis: "balanced",
      stage: "capture",
      goal: "Verify provider connectivity",
      providerConfig: {
        ...config,
        model: config.model || resolvedDescriptor.models[0]?.id || "",
      },
      requestTimeoutMs: connectionContext.requestTimeoutMs ?? 15000,
      preferServerKeys: connectionContext.preferServerKeys ?? true,
      allowFallbackToScaffold: false,
    };

    const apiKey = resolveProviderApiKey(providerId, pseudoContext.providerConfig, pseudoContext);
    if (!apiKey) {
      return {
        ok: false,
        providerId,
        checkedAt: new Date().toISOString(),
        message: "No API key is configured for this provider.",
      };
    }

    try {
      const probe = await invokeVendor(
        kind,
        providerId,
        pseudoContext.providerConfig.model,
        apiKey,
        resolveProviderBaseUrl(providerId, pseudoContext.providerConfig),
        pseudoContext,
        {
          system: "Reply with a short JSON object like {\"summary\":\"OK\",\"disputes\":[],\"unresolvedQuestions\":[],\"evaluation\":{\"leaning\":\"OK\",\"favoredByEvidence\":\"OK\",\"favoredByResponsiveness\":\"OK\",\"favoredByLogic\":\"OK\",\"moreUnanswered\":\"OK\",\"confidence\":\"high\",\"reasons\":[],\"improvementSuggestions\":[]},\"suggestions\":[],\"followupQuestions\":[] }.",
          user: "Return the JSON object now.",
        },
      );

      return {
        ok: probe.ok,
        providerId,
        checkedAt: new Date().toISOString(),
        message: probe.ok
          ? `${resolvedDescriptor.vendor} responded successfully.`
          : `${resolvedDescriptor.vendor} returned HTTP ${probe.status}.`,
      };
    } catch (error) {
      return {
        ok: false,
        providerId,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    descriptor: resolvedDescriptor,
    testConnection,
    summarizeDiscussion(project, context) {
      return runTask("summarizeDiscussion", project, context);
    },
    evaluateDiscussion(project, context) {
      return runTask("evaluateDiscussion", project, context);
    },
    generateFollowupQuestions(project, context) {
      return runTask("generateFollowupQuestions", project, context);
    },
    multiperspectiveSummary(project, context) {
      return runTask("multiperspectiveSummary", project, context);
    },
    debateAnalysis(project, context) {
      return runTask("debateAnalysis", project, context);
    },
    async respondInConversation(project, context, options): Promise<ProviderConversationResult> {
      const prompt = buildConversationPrompt(project, context, providerId, options);
      const apiKey = resolveProviderApiKey(providerId, context.providerConfig, context);
      const model = context.providerConfig.model || resolvedDescriptor.models[0]?.id || "";
      const baseUrl = resolveProviderBaseUrl(providerId, context.providerConfig);

      if (!apiKey) {
        return {
          ok: false,
          providerId,
          model,
          generatedAt: new Date().toISOString(),
          message: buildLocalizedMissingKeyMessage(providerId, context.locale),
          reply: localize(context.locale, {
            "zh-CN": `当前 ${resolvedDescriptor.vendor} 没有可用的 API Key，先在设置中保存凭据后再继续个人 AI 对话。`,
            en: `No ${resolvedDescriptor.vendor} API key is available yet. Save credentials in Settings before continuing the personal AI conversation.`,
            ja: `${resolvedDescriptor.vendor} で利用できる API キーがまだありません。個人 AI 対話を続ける前に Settings で認証情報を保存してください。`,
            fr: `Aucune clé API ${resolvedDescriptor.vendor} n'est disponible pour le moment. Enregistrez les identifiants dans Settings avant de poursuivre la conversation IA personnelle.`,
          }),
        };
      }

      try {
        const result = await invokeVendorConversation(kind, providerId, model, apiKey, baseUrl, context, prompt);
        if (!result.ok) {
          return {
            ok: false,
            providerId,
            model,
            generatedAt: new Date().toISOString(),
            message: buildLocalizedHttpError(providerId, context.locale, `HTTP ${result.status}`),
            reply: localize(context.locale, {
              "zh-CN": `${resolvedDescriptor.vendor} 当前未能完成对话调用，请稍后重试或检查该提供方配置。`,
              en: `${resolvedDescriptor.vendor} could not complete the chat call right now. Try again or review the provider configuration.`,
              ja: `${resolvedDescriptor.vendor} は現在対話呼び出しを完了できませんでした。再試行するか、プロバイダー設定を確認してください。`,
              fr: `${resolvedDescriptor.vendor} n'a pas pu terminer l'appel de conversation pour le moment. Reessayez ou verifiez la configuration du fournisseur.`,
            }),
          };
        }

        return {
          ok: true,
          providerId,
          model,
          generatedAt: new Date().toISOString(),
          message: localize(context.locale, {
            "zh-CN": `${resolvedDescriptor.vendor} 已返回实时对话响应。`,
            en: `${resolvedDescriptor.vendor} returned a live conversation response.`,
            ja: `${resolvedDescriptor.vendor} がリアルタイム対話応答を返しました。`,
            fr: `${resolvedDescriptor.vendor} a renvoye une reponse de conversation en direct.`,
          }),
          reply: result.detail.trim(),
          reasoning: result.reasoning?.trim() || undefined,
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          providerId,
          model,
          generatedAt: new Date().toISOString(),
          message: buildLocalizedHttpError(providerId, context.locale, detail),
          reply: localize(context.locale, {
            "zh-CN": `${resolvedDescriptor.vendor} 对话调用失败，请稍后重试。`,
            en: `${resolvedDescriptor.vendor} conversation call failed. Please try again shortly.`,
            ja: `${resolvedDescriptor.vendor} の対話呼び出しに失敗しました。しばらくしてからもう一度お試しください。`,
            fr: `L'appel de conversation ${resolvedDescriptor.vendor} a echoue. Veuillez reessayer dans un instant.`,
          }),
        };
      }
    },
    async streamConversation(project, context, options) {
      const prompt = buildConversationPrompt(project, context, providerId, options);
      const apiKey = resolveProviderApiKey(providerId, context.providerConfig, context);
      const model = context.providerConfig.model || resolvedDescriptor.models[0]?.id || "";
      const baseUrl = resolveProviderBaseUrl(providerId, context.providerConfig);

      if (!apiKey) {
        throw new Error(buildLocalizedMissingKeyMessage(providerId, context.locale));
      }

      return invokeVendorConversationStream(kind, providerId, model, apiKey, baseUrl, context, prompt, options.signal);
    },
    async analyze(project, context) {
      const result = await runTask("summarizeDiscussion", project, context);
      const summary = mergeIntoSummary(createEmptySummary(context.locale), result.output);

      return {
        insights: createEmptyInsights(new Date().toISOString()),
        summary,
        providerSnapshot: createProviderSnapshot(
          providerId,
          context.providerConfig.model,
          result.ok ? "http-live" : context.allowFallbackToScaffold ? "http-fallback" : "http-error",
        ),
        orchestration: result,
      };
    },
  } satisfies AiProvider;
}
