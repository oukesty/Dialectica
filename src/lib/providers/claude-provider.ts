import { createHttpProvider } from "@/lib/providers/http-provider";

export const claudeProvider = createHttpProvider("claude", "anthropic-messages");
