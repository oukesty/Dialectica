import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDefaultSettings } from "@/lib/factories";
import { normalizeProviderModel } from "@/lib/providers/provider-catalog";
import { resolveProfileAvatar, sanitizeAvatarDataUrl } from "@/lib/avatar";
import { createLocalIdentityId } from "@/lib/local-identity";
import { normalizeAvatarLabel } from "@/lib/utils";

const expectedProviderAvatarFiles = {
  claude: "claude.jpg",
  deepseek: "deepseek.png",
  disabled: "disabled.jpg",
  doubao: "doubao.jpg",
  gemini: "gemini.jpg",
  grok: "grok.jpg",
  openai: "openai.jpg",
  qwen: "qwen.jpg",
} as const;

describe("profile defaults", () => {
  it("creates settings with a stable avatar preset", () => {
    const settings = createDefaultSettings("en");

    expect(settings.profile.displayName.length).toBeGreaterThan(0);
    expect(settings.profile.avatarPreset).toBeDefined();
    expect(settings.profile.avatarImageDataUrl).toBe("");
  });

  it("includes usable workspace and collaboration defaults", () => {
    const settings = createDefaultSettings("en");

    expect(settings.discussionPreferences.defaultWorkspaceTab).toBe("capture");
    expect(settings.discussionPreferences.singleUserAutoSummaryThreshold).toBe(20);
    expect(settings.discussionPreferences.multiUserAutoSummaryThreshold).toBe(20);
    expect(settings.discussionPreferences.assistiveSummaryThreshold).toBe(15);
    expect(settings.discussionPreferences.latestAiHistoryMode).toBe("latest-only");
    expect(settings.provider.autoSummary).toBe(true);
    expect(settings.provider.autoEvaluation).toBe(false);
    expect(settings.provider.enableStreaming).toBe(true);
    expect(settings.collaborationPreferences.eventHistoryLimit).toBeGreaterThanOrEqual(10);
  });

  it("sanitizes unsafe avatar data urls", () => {
    expect(sanitizeAvatarDataUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeAvatarDataUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("resolves profile avatars with a fallback preset", () => {
    const avatar = resolveProfileAvatar({
      localIdentityId: "identity_avatar_test",
      displayName: "Avatar QA",
      displayNameIsDefault: false,
      avatarPreset: "aurora",
      avatarImageDataUrl: "",
    });

    expect(avatar.preset).toBe("aurora");
    expect(avatar.label.length).toBeGreaterThan(0);
  });

  it("normalizes avatar labels so fallback avatars never render question marks", () => {
    expect(normalizeAvatarLabel("?")).toBe("");
    expect(normalizeAvatarLabel("??")).toBe("");
    expect(normalizeAvatarLabel("AL")).toBe("AL");
  });

  it("falls back when crypto.randomUUID is unavailable", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });

    try {
      const settings = createDefaultSettings("en");
      const localIdentityId = createLocalIdentityId();

      expect(settings.profile.localIdentityId.slice(0, 8)).toBe("profile_");
      expect(settings.profile.localIdentityId.length).toBeGreaterThan(8);
      expect(localIdentityId.slice(0, 8)).toBe("profile_");
      expect(localIdentityId.length).toBeGreaterThan(8);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "crypto", originalDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "crypto");
      }
    }
  });
});

describe("provider model normalization", () => {
  it("falls back to the provider's recommended model when a mismatched model is supplied", () => {
    expect(normalizeProviderModel("openai", "gemini-2.5-pro")).toBe("gpt-5.4");
    expect(normalizeProviderModel("gemini", "gpt-5.2")).toBe("gemini-2.5-pro");
  });
});

describe("provider avatar resources", () => {
  it("maps every shipped provider reply avatar and the disabled state in assistant and workspace surfaces", () => {
    const assistantSource = readFileSync(path.join(process.cwd(), "src", "components", "assistant", "assistant-workspace.tsx"), "utf8");
    const collaborationSource = readFileSync(path.join(process.cwd(), "src", "components", "projects", "project-collaboration-panel.tsx"), "utf8");

    for (const [providerId, fileName] of Object.entries(expectedProviderAvatarFiles)) {
      const publicPath = path.join(process.cwd(), "public", "ai-avatars", fileName);
      const sourceLine = `${providerId}: "/ai-avatars/${fileName}"`;

      expect(existsSync(publicPath), `${fileName} should exist in public/ai-avatars`).toBe(true);
      expect(assistantSource).toContain(sourceLine);
      expect(collaborationSource).toContain(sourceLine);
    }
  });
});


