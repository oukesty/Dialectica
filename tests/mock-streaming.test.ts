import { describe, expect, it } from "vitest";
import { createDefaultSettings, createProviderRuntimeMap } from "@/lib/factories";
import { createProjectSkeleton } from "@/lib/data/repository";
import { mockProvider } from "@/lib/providers/mock-provider";
import { getProviderDescriptor } from "@/lib/providers/provider-catalog";
import { AnalysisContext } from "@/lib/types";

function createStreamingProject() {
  const settings = createDefaultSettings("zh-CN");
  const project = createProjectSkeleton("zh-CN", "discussion", settings);

  project.title = "生成式 AI 是否应正式进入学校与大学课堂";
  project.goal = "讨论课堂引入生成式 AI 的收益、风险与边界。";
  project.summary.overview = "讨论聚焦在课堂效率、学术诚信和教师负担之间的平衡。";

  return project;
}

function createMockConversationContext(project = createStreamingProject()): AnalysisContext {
  return {
    locale: project.language,
    emphasis: "balanced",
    stage: "capture",
    goal: project.goal,
    providerConfig: createProviderRuntimeMap().mock,
    requestTimeoutMs: 30_000,
    preferServerKeys: true,
    allowFallbackToScaffold: true,
    enableStreaming: true,
  };
}

describe("mock conversation streaming", () => {
  it("advertises streaming support in the provider catalog", () => {
    expect(getProviderDescriptor("mock")?.capabilities.streaming).toBe(true);
  });

  it("yields multiple chunks so the UI can render typing output", async () => {
    const project = createStreamingProject();
    const stream = await mockProvider.streamConversation!(
      project,
      createMockConversationContext(project),
      {
        prompt: "请继续说明这个讨论的核心分歧。",
        history: [{ role: "user", content: "请继续说明这个讨论的核心分歧。" }],
      },
    );

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.type === "content")).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join("")).toContain("核心");
  });

  it("keeps ordinary greetings and model identity questions natural in mock chat", async () => {
    const project = createStreamingProject();
    const greeting = await mockProvider.respondInConversation!(
      project,
      createMockConversationContext(project),
      {
        prompt: "你好",
        history: [{ role: "user", content: "你好" }],
      },
    );
    expect(greeting.reply).not.toContain("围绕");
    expect(greeting.reply).not.toContain("上下文");

    const identity = await mockProvider.respondInConversation!(
      project,
      createMockConversationContext(project),
      {
        prompt: "你是什么模型？",
        history: [{ role: "user", content: "你是什么模型？" }],
      },
    );
    expect(identity.reply).not.toContain("through Dialectica using provider");
    expect(identity.reply).not.toContain("使用 provider");
  });

  it("uses platform background only when the user asks about the platform", async () => {
    const project = createStreamingProject();
    const reply = await mockProvider.respondInConversation!(
      project,
      createMockConversationContext(project),
      {
        prompt: "你运行在什么平台？",
        history: [{ role: "user", content: "你运行在什么平台？" }],
      },
    );

    expect(reply.reply).toContain("Dialectica");
    expect(reply.reply).toContain("AI 对话");
    expect(reply.reply).not.toContain("AI-ready platform");
    expect(reply.reply).not.toContain("必须");
  });

  it("stops streaming when the request is aborted", async () => {
    const controller = new AbortController();
    const project = createStreamingProject();
    const stream = await mockProvider.streamConversation!(
      project,
      createMockConversationContext(project),
      {
        prompt: "请继续说明这个讨论的核心分歧。",
        history: [{ role: "user", content: "请继续说明这个讨论的核心分歧。" }],
        signal: controller.signal,
      },
    );

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
      controller.abort();
    }

    expect(chunks.length).toBe(1);
  });
});
