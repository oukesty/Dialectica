import { createHttpProvider } from "@/lib/providers/http-provider";

export const openaiProvider = createHttpProvider("openai", "openai-responses");
