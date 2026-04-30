import { createHttpProvider } from "@/lib/providers/http-provider";

export const grokProvider = createHttpProvider("grok", "openai-chat");
