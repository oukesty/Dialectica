import { AnalysisContext, ProviderId, ProviderRuntimeConfig } from "@/lib/types";

const envKeyMap: Record<ProviderId, string[]> = {
  mock: [],
  disabled: [],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  grok: ["XAI_API_KEY", "GROK_API_KEY"],
  claude: ["ANTHROPIC_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  doubao: ["ARK_API_KEY", "DOUBAO_API_KEY", "VOLCENGINE_API_KEY"],
  qwen: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
};

const defaultBaseUrls: Record<ProviderId, string> = {
  mock: "local://mock",
  disabled: "local://disabled",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  grok: "https://api.x.ai/v1",
  claude: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function resolveProviderApiKey(
  providerId: ProviderId,
  config: Pick<ProviderRuntimeConfig, "apiKey">,
  context?: Pick<AnalysisContext, "preferServerKeys">,
) {
  const configured = config.apiKey.trim();
  const envValue = envKeyMap[providerId].map((name) => process.env[name]?.trim()).find(Boolean) ?? "";

  if (context?.preferServerKeys === false) {
    return configured || envValue;
  }

  return envValue || configured;
}

export function hasAvailableProviderApiKey(
  providerId: ProviderId,
  config: Pick<ProviderRuntimeConfig, "apiKey">,
  context?: Pick<AnalysisContext, "preferServerKeys">,
) {
  return providerId === "mock" || providerId === "disabled" || Boolean(resolveProviderApiKey(providerId, config, context));
}

export function resolveProviderBaseUrl(providerId: ProviderId, config: Pick<ProviderRuntimeConfig, "baseUrl">) {
  return trimTrailingSlash(config.baseUrl.trim() || defaultBaseUrls[providerId]);
}
