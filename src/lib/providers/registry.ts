import { claudeProvider } from "@/lib/providers/claude-provider";
import { deepseekProvider } from "@/lib/providers/deepseek-provider";
import { disabledProvider } from "@/lib/providers/disabled-provider";
import { doubaoProvider } from "@/lib/providers/doubao-provider";
import { geminiProvider } from "@/lib/providers/gemini-provider";
import { grokProvider } from "@/lib/providers/grok-provider";
import { mockProvider } from "@/lib/providers/mock-provider";
import { openaiProvider } from "@/lib/providers/openai-provider";
import { qwenProvider } from "@/lib/providers/qwen-provider";
import { AiProvider, ProviderId } from "@/lib/types";

const providers = new Map<ProviderId, AiProvider>([
  ["mock", mockProvider],
  ["disabled", disabledProvider],
  ["openai", openaiProvider],
  ["gemini", geminiProvider],
  ["grok", grokProvider],
  ["claude", claudeProvider],
  ["deepseek", deepseekProvider],
  ["doubao", doubaoProvider],
  ["qwen", qwenProvider],
]);

export function getProvider(providerId: ProviderId) {
  return providers.get(providerId) ?? disabledProvider;
}

