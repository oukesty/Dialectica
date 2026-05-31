import { ProviderDescriptor, ProviderId, ProviderModelInputCapabilities, ProviderModelOption } from "@/lib/types";

const textOnlyDocumentInput: ProviderModelInputCapabilities = {
  text: true,
  image: false,
  document: true,
  video: false,
  audio: false,
};

const imageDocumentInput: ProviderModelInputCapabilities = {
  text: true,
  image: true,
  document: true,
  video: false,
  audio: false,
};

const fullMultimodalInput: ProviderModelInputCapabilities = {
  text: true,
  image: true,
  document: true,
  video: true,
  audio: true,
};

const imageOnlyInput: ProviderModelInputCapabilities = {
  text: true,
  image: true,
  document: false,
  video: false,
  audio: false,
};

const textOnlyInput: ProviderModelInputCapabilities = {
  text: true,
  image: false,
  document: false,
  video: false,
  audio: false,
};

const noInputSupport: ProviderModelInputCapabilities = {
  text: false,
  image: false,
  document: false,
  video: false,
  audio: false,
};

function withCapabilities(model: Omit<ProviderModelOption, "inputCapabilities">, inputCapabilities: ProviderModelInputCapabilities): ProviderModelOption {
  return {
    ...model,
    inputCapabilities,
  };
}

export const providerCatalog: ProviderDescriptor[] = [
  {
    id: "mock",
    label: "Mock Rule Engine",
    vendor: "Dialectica",
    mode: "mock",
    description: "Deterministic local analysis for offline validation, smoke tests, guided walkthroughs, and local assistant drafts.",
    website: "",
    implementationStage: "local",
    models: [
      withCapabilities({ id: "rule-balanced-v1", label: "Rule Balanced v1", status: "stable", recommended: true }, textOnlyDocumentInput),
      withCapabilities({ id: "rule-evidence-v1", label: "Rule Evidence v1", status: "stable" }, textOnlyDocumentInput),
      withCapabilities({ id: "rule-responsiveness-v1", label: "Rule Responsiveness v1", status: "stable" }, textOnlyDocumentInput),
    ],
    regions: ["local"],
    capabilities: {
      realtimeCapture: true,
      streaming: true,
      testConnection: true,
      summarizeDiscussion: true,
      evaluateDiscussion: true,
      generateFollowupQuestions: true,
      multiperspectiveSummary: true,
      debateAnalysis: true,
      chatConversation: true,
    },
  },
  {
    id: "disabled",
    label: "Disabled Adapter",
    vendor: "Dialectica",
    mode: "disabled",
    description: "Keeps the orchestration surface visible while intentionally disabling automated model execution.",
    website: "",
    implementationStage: "local",
    models: [withCapabilities({ id: "disabled", label: "Disabled", status: "stable", recommended: true }, noInputSupport)],
    regions: ["local"],
    capabilities: {
      realtimeCapture: false,
      streaming: false,
      testConnection: true,
      summarizeDiscussion: false,
      evaluateDiscussion: false,
      generateFollowupQuestions: false,
      multiperspectiveSummary: false,
      debateAnalysis: false,
      chatConversation: false,
    },
  },
  {
    id: "openai",
    label: "OpenAI",
    vendor: "OpenAI",
    mode: "api",
    description: "Sample provider configuration with default OpenAI model IDs. Model availability and naming may change; refer to official provider documentation.",
    website: "https://platform.openai.com/docs/models",
    implementationStage: "http",
    models: [
      withCapabilities({ id: "gpt-5.4", label: "GPT-5.4", status: "stable", recommended: true }, imageDocumentInput),
      withCapabilities({ id: "gpt-5.4-mini", label: "GPT-5.4 mini", status: "stable" }, imageDocumentInput),
      withCapabilities({ id: "gpt-5.4-nano", label: "GPT-5.4 nano", status: "stable" }, imageDocumentInput),
      withCapabilities({ id: "gpt-5", label: "GPT-5", status: "stable" }, imageDocumentInput),
      withCapabilities({ id: "gpt-5-mini", label: "GPT-5 mini", status: "stable" }, imageDocumentInput),
      withCapabilities({ id: "gpt-5-nano", label: "GPT-5 nano", status: "stable" }, imageDocumentInput),
      withCapabilities({ id: "gpt-4.1", label: "GPT-4.1", status: "stable" }, imageDocumentInput),
      withCapabilities({ id: "gpt-4.1-mini", label: "GPT-4.1 mini", status: "stable" }, imageDocumentInput),
      withCapabilities({ id: "gpt-4.1-nano", label: "GPT-4.1 nano", status: "stable" }, imageDocumentInput),
      withCapabilities({ id: "o3", label: "o3", status: "stable" }, imageDocumentInput),
      withCapabilities({ id: "o4-mini", label: "o4-mini", status: "stable" }, imageDocumentInput),
    ],
    regions: ["global"],
    capabilities: {
      realtimeCapture: true,
      streaming: true,
      testConnection: true,
      summarizeDiscussion: true,
      evaluateDiscussion: true,
      generateFollowupQuestions: true,
      multiperspectiveSummary: true,
      debateAnalysis: true,
      chatConversation: true,
    },
  },
  {
    id: "gemini",
    label: "Gemini",
    vendor: "Google",
    mode: "api",
    description: "Sample provider configuration with default Gemini model IDs. Model availability and naming may change; refer to official provider documentation.",
    website: "https://ai.google.dev/gemini-api/docs/models",
    implementationStage: "http",
    models: [
      withCapabilities({ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", status: "stable", recommended: true }, fullMultimodalInput),
      withCapabilities({ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", status: "stable" }, fullMultimodalInput),
      withCapabilities({ id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", status: "stable" }, fullMultimodalInput),
      withCapabilities({ id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", status: "preview" }, fullMultimodalInput),
      withCapabilities({ id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", status: "preview" }, fullMultimodalInput),
      withCapabilities({ id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite Preview", status: "preview" }, fullMultimodalInput),
    ],
    regions: ["global"],
    capabilities: {
      realtimeCapture: true,
      streaming: true,
      testConnection: true,
      summarizeDiscussion: true,
      evaluateDiscussion: true,
      generateFollowupQuestions: true,
      multiperspectiveSummary: true,
      debateAnalysis: true,
      chatConversation: true,
    },
  },
  {
    id: "grok",
    label: "Grok",
    vendor: "xAI",
    mode: "api",
    description: "Sample provider configuration with default xAI model IDs. Model availability and naming may change; refer to official provider documentation.",
    website: "https://docs.x.ai/docs/models",
    implementationStage: "http",
    models: [
      withCapabilities({ id: "grok-4.20-beta-latest", label: "Grok 4.20 Reasoning", status: "beta", recommended: true }, imageOnlyInput),
      withCapabilities({ id: "grok-4.20-beta-latest-non-reasoning", label: "Grok 4.20 Non-Reasoning", status: "beta" }, imageOnlyInput),
      withCapabilities({ id: "grok-4-1", label: "Grok 4.1", status: "stable" }, imageOnlyInput),
      withCapabilities({ id: "grok-4-1-fast", label: "Grok 4.1 Fast", status: "stable" }, imageOnlyInput),
    ],
    regions: ["global"],
    capabilities: {
      realtimeCapture: true,
      streaming: true,
      testConnection: true,
      summarizeDiscussion: true,
      evaluateDiscussion: true,
      generateFollowupQuestions: true,
      multiperspectiveSummary: true,
      debateAnalysis: true,
      chatConversation: true,
    },
  },
  {
    id: "claude",
    label: "Claude",
    vendor: "Anthropic",
    mode: "api",
    description: "Sample provider configuration with default Claude model IDs. Model availability and naming may change; refer to official provider documentation.",
    website: "https://docs.anthropic.com/en/docs/about-claude/models/all-models",
    implementationStage: "http",
    models: [
      withCapabilities({ id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", status: "stable", recommended: true }, imageDocumentInput),
      withCapabilities({ id: "claude-opus-4-6", label: "Claude Opus 4.6", status: "stable" }, imageDocumentInput),
      withCapabilities({ id: "claude-haiku-4-5", label: "Claude Haiku 4.5", status: "stable" }, imageDocumentInput),
    ],
    regions: ["global"],
    capabilities: {
      realtimeCapture: true,
      streaming: true,
      testConnection: true,
      summarizeDiscussion: true,
      evaluateDiscussion: true,
      generateFollowupQuestions: true,
      multiperspectiveSummary: true,
      debateAnalysis: true,
      chatConversation: true,
    },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    vendor: "DeepSeek",
    mode: "api",
    description: "Sample provider configuration with default DeepSeek chat and reasoner model IDs. Model availability and naming may change; refer to official provider documentation.",
    website: "https://api-docs.deepseek.com/quick_start/pricing",
    implementationStage: "http",
    models: [
      withCapabilities({ id: "deepseek-chat", label: "DeepSeek Chat", status: "stable", recommended: true }, textOnlyInput),
      withCapabilities({ id: "deepseek-reasoner", label: "DeepSeek Reasoner", status: "stable" }, textOnlyInput),
    ],
    regions: ["global", "cn"],
    capabilities: {
      realtimeCapture: true,
      streaming: true,
      testConnection: true,
      summarizeDiscussion: true,
      evaluateDiscussion: true,
      generateFollowupQuestions: true,
      multiperspectiveSummary: true,
      debateAnalysis: true,
      chatConversation: true,
    },
  },
  {
    id: "doubao",
    label: "Doubao",
    vendor: "ByteDance Volcano Engine",
    mode: "api",
    description: "Sample provider configuration with default Doubao aliases and custom Ark endpoint IDs. Model availability and naming may change; refer to official provider documentation.",
    website: "https://www.volcengine.com/docs/82379/1330310",
    implementationStage: "http",
    models: [
      withCapabilities({ id: "doubao-seed-1-6-vision", label: "Doubao Seed 1.6 Vision", status: "stable", recommended: true }, imageOnlyInput),
      withCapabilities({ id: "doubao-pro", label: "Doubao Pro", status: "stable" }, textOnlyInput),
      withCapabilities({ id: "doubao-lite", label: "Doubao Lite", status: "stable" }, textOnlyInput),
      withCapabilities({ id: "ep-custom-ark-endpoint", label: "Custom Ark Endpoint ID", status: "experimental", notes: "Use this only when your team has a private Ark deployment or endpoint alias." }, textOnlyInput),
    ],
    regions: ["cn"],
    capabilities: {
      realtimeCapture: true,
      streaming: true,
      testConnection: true,
      summarizeDiscussion: true,
      evaluateDiscussion: true,
      generateFollowupQuestions: true,
      multiperspectiveSummary: true,
      debateAnalysis: true,
      chatConversation: true,
    },
  },
  {
    id: "qwen",
    label: "Qwen",
    vendor: "Alibaba Cloud",
    mode: "api",
    description: "Sample provider configuration with default Qwen / Model Studio aliases. Model availability and naming may change; refer to official provider documentation.",
    website: "https://www.alibabacloud.com/help/en/model-studio/getting-started/models",
    implementationStage: "http",
    models: [
      withCapabilities({ id: "qwen3.5-plus", label: "Qwen3.5 Plus", status: "stable", recommended: true }, imageOnlyInput),
      withCapabilities({ id: "qwen3.5-flash", label: "Qwen3.5 Flash", status: "stable" }, imageOnlyInput),
      withCapabilities({ id: "qwen3-max", label: "Qwen3 Max", status: "stable" }, textOnlyInput),
    ],
    regions: ["cn", "global"],
    capabilities: {
      realtimeCapture: true,
      streaming: true,
      testConnection: true,
      summarizeDiscussion: true,
      evaluateDiscussion: true,
      generateFollowupQuestions: true,
      multiperspectiveSummary: true,
      debateAnalysis: true,
      chatConversation: true,
    },
  },
];

export function getProviderDescriptor(providerId: ProviderId) {
  return providerCatalog.find((descriptor) => descriptor.id === providerId);
}

export function getProviderModel(providerId: ProviderId, modelId: string): ProviderModelOption | undefined {
  return getProviderDescriptor(providerId)?.models.find((model) => model.id === modelId);
}

export function getRecommendedProviderModel(providerId: ProviderId) {
  const descriptor = getProviderDescriptor(providerId);
  return descriptor?.models.find((model) => model.recommended)?.id ?? descriptor?.models[0]?.id ?? "";
}

export function getProviderModelInputCapabilities(providerId: ProviderId, modelId?: string) {
  const requestedModelId = typeof modelId === "string" ? modelId.trim() : "";
  const resolvedModelId = requestedModelId || getRecommendedProviderModel(providerId);
  const capabilities = getProviderModel(providerId, resolvedModelId)?.inputCapabilities;
  if (capabilities) {
    return capabilities;
  }
  return requestedModelId ? noInputSupport : textOnlyDocumentInput;
}

export function getImplementedConversationInputCapabilities(providerId: ProviderId, modelId?: string) {
  const capabilities = getProviderModelInputCapabilities(providerId, modelId);
  return {
    ...capabilities,
    video: false,
    audio: false,
  };
}

export function isProviderModelSupported(providerId: ProviderId, modelId: string) {
  return Boolean(getProviderModel(providerId, modelId));
}

export function normalizeProviderModel(providerId: ProviderId, modelId?: string) {
  return modelId && isProviderModelSupported(providerId, modelId)
    ? modelId
    : getRecommendedProviderModel(providerId);
}
