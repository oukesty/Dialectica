import { describe, expect, it } from "vitest";
import { createProviderRuntimeMap } from "@/lib/factories";
import { hasAvailableProviderApiKey, resolveProviderApiKey } from "@/lib/providers/runtime";

describe("provider runtime resolution", () => {
  it("treats environment keys as usable credentials", () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "env-key";

    try {
      const config = {
        ...createProviderRuntimeMap().openai,
        apiKey: "",
      };

      expect(hasAvailableProviderApiKey("openai", config, { preferServerKeys: true })).toBe(true);
      expect(resolveProviderApiKey("openai", { ...config, apiKey: "stored-key" }, { preferServerKeys: true })).toBe("env-key");
      expect(resolveProviderApiKey("openai", { ...config, apiKey: "stored-key" }, { preferServerKeys: false })).toBe("stored-key");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});
