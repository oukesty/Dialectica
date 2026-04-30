import { createHttpProvider } from "@/lib/providers/http-provider";

export const geminiProvider = createHttpProvider("gemini", "gemini-generate");
