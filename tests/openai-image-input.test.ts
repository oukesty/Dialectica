import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildOpenAiResponsesInput } from "@/lib/providers/http-provider";
import type { AnalysisContext } from "@/lib/types";
import { describe, expect, test } from "vitest";

describe("openai image input", () => {
  test("converts local image attachments into input_image payload items", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dialectica-openai-image-"));
    const imagePath = path.join(tempDir, "sample.png");

    try {
      await writeFile(imagePath, Buffer.from("fake-image-binary"));
      const expectedDataUrl = `data:image/png;base64,${Buffer.from("fake-image-binary").toString("base64")}`;
      const context: AnalysisContext = {
        locale: "en",
        emphasis: "balanced",
        stage: "capture",
        goal: "Inspect the attached image.",
        providerConfig: {
          providerId: "openai",
          enabled: true,
          mode: "api",
          model: "gpt-5.4",
          apiKey: "TEST_FAKE_OPENAI_KEY_DO_NOT_USE",
          baseUrl: "https://api.openai.com/v1",
          organization: "",
          notes: "",
          streaming: true,
          temperature: 0.2,
          testState: "idle",
        },
        requestTimeoutMs: 30000,
        preferServerKeys: false,
        allowFallbackToScaffold: false,
        attachmentContext: {
          total: 1,
          items: [{
            id: "att_local_image",
            name: "sample.png",
            kind: "image",
            mimeType: "image/png",
            note: "Screenshot",
            uploadedAt: new Date().toISOString(),
            storage: "local",
            localPath: imagePath,
          }],
        },
      };
      const input = await buildOpenAiResponsesInput(context, {
        system: "You are a vision assistant.",
        user: "Describe the image.",
      });

      expect(input[1].content.length).toBe(2);
      expect(input[1].content[1]).toEqual({
        type: "input_image",
        image_url: expectedDataUrl,
        detail: "auto",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
