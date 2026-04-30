/**
 * Client-side SSE stream parser for AI responses.
 * Handles OpenAI, Anthropic, and Gemini SSE formats.
 */

export interface StreamChunk {
  type: "content" | "reasoning" | "done" | "error";
  text: string;
  aiTriggeredTasks?: string[];
}

export interface StreamRequestPayload {
  projectId: string;
  message: string;
  attachmentIds?: string[];
  identityId?: string;
  surface?: "assistant-workspace" | "project-workspace";
  locale?: string;
  regenerate?: boolean;
  replaceAssistantEventId?: string;
}

function streamFallbackError(locale?: string) {
  if (locale === "zh-CN") return "AI 流式响应失败，请重试。";
  if (locale === "ja") return "AI のストリーミング応答に失敗しました。再試行してください。";
  if (locale === "ko") return "AI 스트리밍 응답에 실패했습니다. 다시 시도하세요.";
  if (locale === "fr") return "La reponse IA en streaming a echoue. Reessayez.";
  if (locale === "ru") return "Потоковый ответ ИИ не удался. Повторите попытку.";
  return "AI streaming response failed. Please try again.";
}

/**
 * Parse a single SSE `data:` line into a StreamChunk.
 * Supports: OpenAI chat/completions, OpenAI responses, Anthropic messages, Gemini.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parseSSEData(data: string, _provider: string): StreamChunk | null {
  if (data === "[DONE]") return { type: "done", text: "" };

  try {
    const json = JSON.parse(data);

    if (
      (json.type === "content" || json.type === "reasoning" || json.type === "done" || json.type === "error")
      && typeof json.text === "string"
    ) {
      return json as StreamChunk;
    }

    // OpenAI chat/completions format (also DeepSeek, Grok, Doubao, Qwen)
    if (json.choices?.[0]?.delta) {
      const delta = json.choices[0].delta;
      if (delta.reasoning_content) return { type: "reasoning", text: delta.reasoning_content };
      if (delta.content) return { type: "content", text: delta.content };
      return null;
    }

    // OpenAI Responses API format
    if (json.type === "response.output_text.delta" && json.delta) {
      return { type: "content", text: json.delta };
    }
    if (json.type === "response.completed" || json.type === "response.done") {
      return { type: "done", text: "" };
    }

    // Anthropic Messages format
    if (json.type === "content_block_delta" && json.delta?.text) {
      return { type: "content", text: json.delta.text };
    }
    if (json.type === "message_stop") {
      return { type: "done", text: "" };
    }

    // Gemini format
    if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
      return { type: "content", text: json.candidates[0].content.parts[0].text };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Consume an SSE stream from the streaming assistant endpoint.
 * Calls onChunk for each text chunk received.
 * Returns an abort function.
 */
export function consumeStream(
  payload: StreamRequestPayload,
  provider: string,
  onChunk: (chunk: StreamChunk) => void,
  onError: (error: string) => void,
  onComplete: (chunk?: StreamChunk) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(`/api/projects/${payload.projectId}/assistant/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: payload.message,
          attachmentIds: payload.attachmentIds ?? [],
          identityId: payload.identityId,
          surface: payload.surface,
          locale: payload.locale,
          regenerate: payload.regenerate ?? false,
          replaceAssistantEventId: payload.replaceAssistantEventId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: streamFallbackError(payload.locale) }));
        onError(err.error || `${streamFallbackError(payload.locale)} HTTP ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) { onError(streamFallbackError(payload.locale)); return; }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data) continue;
            const chunk = parseSSEData(data, provider);
            if (chunk) {
              if (chunk.type === "done") { onComplete(chunk); return; }
              if (chunk.type === "error") { onError(chunk.text); return; }
              onChunk(chunk);
            }
          }
        }
      }

      onComplete();
    } catch (err) {
      if (controller.signal.aborted) return;
      onError(err instanceof Error ? err.message : streamFallbackError(payload.locale));
    }
  })();

  return () => controller.abort();
}
