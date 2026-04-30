export const dynamic = "force-dynamic";

import { AssistantConversationError, finalizeAssistantConversation, prepareAssistantConversation } from "@/lib/ai/assistant-conversation";
import { resolveAutoTriggeredTasks } from "@/lib/ai/summary-automation";
import { getProvider } from "@/lib/providers/registry";
import { ProviderConversationResult, ProviderConversationStreamChunk } from "@/lib/types";

function encodeSse(value: Record<string, unknown>) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const rawPayload = await request.json().catch(() => null);

  try {
    const prepared = await prepareAssistantConversation(projectId, request, rawPayload);
    const provider = getProvider(prepared.providerId);
    const model = prepared.conversationContext.providerConfig.model;
    const canUseStreaming = Boolean(prepared.conversationContext.enableStreaming && provider.streamConversation);

    if (!canUseStreaming) {
      const conversation = await provider.respondInConversation(
        prepared.projectWithMessage,
        prepared.conversationContext,
        prepared.conversationOptions,
      );

      if (!conversation.ok) {
        const finalized = await finalizeAssistantConversation(prepared, conversation);
        return new Response(JSON.stringify({
          error: conversation.message,
          conversation,
          project: finalized.project,
          collaboration: finalized.collaboration,
          roomAiConfig: finalized.roomAiConfig,
        }), { status: 409, headers: { "Content-Type": "application/json" } });
      }

      const finalized = await finalizeAssistantConversation(prepared, conversation, {
        aiMetadata: conversation.reasoning?.trim() ? { reasoning: conversation.reasoning.trim() } : undefined,
      });
      const aiTriggeredTasks = resolveAutoTriggeredTasks(finalized.project);
      return new Response(
        `${conversation.reasoning?.trim() ? encodeSse({ type: "reasoning", text: conversation.reasoning.trim() }) : ""}${conversation.reply ? encodeSse({ type: "content", text: conversation.reply }) : ""}${encodeSse({ type: "done", text: "", aiTriggeredTasks })}`,
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Provider": prepared.providerId,
            "X-Model": model,
          },
        },
      );
    }

    const providerStream = await provider.streamConversation!(
      prepared.projectWithMessage,
      prepared.conversationContext,
      {
        ...prepared.conversationOptions,
        signal: request.signal,
      },
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let collectedContent = "";
        let collectedReasoning = "";
        let closed = false;
        const closeStream = () => {
          if (closed) return;
          closed = true;
          controller.close();
        };

        try {
          for await (const chunk of providerStream) {
            if (request.signal.aborted) {
              closeStream();
              return;
            }
            if (chunk.type === "reasoning") {
              collectedReasoning += chunk.text;
            } else if (chunk.type === "content") {
              collectedContent += chunk.text;
            }

            controller.enqueue(encoder.encode(encodeSse({ type: chunk.type, text: chunk.text })));
          }

          if (request.signal.aborted) {
            closeStream();
            return;
          }

          const conversation: ProviderConversationResult = {
            ok: true,
            providerId: prepared.providerId,
            model,
            generatedAt: new Date().toISOString(),
            message: `${prepared.providerId} streaming conversation completed.`,
            reply: collectedContent.trim(),
          };

          const finalized = await finalizeAssistantConversation(prepared, conversation, {
            aiMetadata: collectedReasoning.trim() ? { reasoning: collectedReasoning.trim() } : undefined,
          });
          const aiTriggeredTasks = resolveAutoTriggeredTasks(finalized.project);
          controller.enqueue(encoder.encode(encodeSse({ type: "done", text: "", aiTriggeredTasks })));
        } catch (error) {
          if (request.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
            closeStream();
            return;
          }
          const message = error instanceof Error ? error.message : "Stream error";
          await finalizeAssistantConversation(prepared, {
            ok: false,
            providerId: prepared.providerId,
            model,
            generatedAt: new Date().toISOString(),
            message,
            reply: "",
          });
          controller.enqueue(encoder.encode(encodeSse({ type: "error", text: message })));
        } finally {
          closeStream();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Provider": prepared.providerId,
        "X-Model": model,
      },
    });
  } catch (error) {
    if (error instanceof AssistantConversationError) {
      return new Response(JSON.stringify(error.body), {
        status: error.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Stream error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
