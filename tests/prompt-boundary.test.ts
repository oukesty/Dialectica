import { describe, expect, it } from "vitest";
import { buildOrchestrationPacket } from "@/lib/ai/orchestration";
import { createProjectSkeleton } from "@/lib/data/repository";
import { createDefaultSettings, createProviderRuntimeMap } from "@/lib/factories";
import { buildConversationPrompt } from "@/lib/providers/http-provider";
import { AnalysisContext, DiscussionProject } from "@/lib/types";

function createContext(project: DiscussionProject, overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  return {
    locale: project.language,
    replyLanguage: "auto",
    assistantSurface: "assistant-workspace",
    aiRole: "assistant",
    responseLength: "standard",
    focusTopics: "",
    autoTagging: false,
    emphasis: "balanced",
    stage: "capture",
    goal: project.goal,
    providerConfig: createProviderRuntimeMap().deepseek,
    requestTimeoutMs: 30_000,
    preferServerKeys: true,
    allowFallbackToScaffold: false,
    attachmentContext: { total: 0, items: [] },
    ...overrides,
  };
}

function createAssistantChatProject() {
  const settings = createDefaultSettings("zh-CN");
  settings.provider.activeProviderId = "deepseek";
  const project = createProjectSkeleton("zh-CN", "ai-dialogue", settings);
  project.title = "个人 AI 工作台";
  project.goal = "沉淀一个关于人与 AI 多轮对话的项目目标。";
  project.participants[0] = {
    ...project.participants[0],
    name: "我",
    collaborationRole: "host",
    stance: "主持个人 AI 对话",
  };
  return project;
}

function createCollaborativeProject() {
  const project = createProjectSkeleton("en", "discussion", createDefaultSettings("en"));
  project.title = "City AI service pilot";
  project.goal = "Define service boundaries, escalation thresholds, and public feedback loops.";
  project.participants = [
    {
      ...project.participants[0],
      id: "participant_host",
      name: "Maya",
      role: "moderator",
      collaborationRole: "host",
      stance: "Keeps the pilot scoped and accountable.",
    },
    {
      ...project.participants[0],
      id: "participant_observer",
      name: "Noah",
      role: "observer",
      collaborationRole: "observer",
      stance: "Checks accessibility and public communication risks.",
    },
  ];
  return project;
}

describe("AI prompt context boundaries", () => {
  it("keeps ordinary assistant-workspace chat free of project and host context", () => {
    const project = createAssistantChatProject();
    const prompt = buildConversationPrompt(project, createContext(project), "deepseek", {
      prompt: "你好",
      history: [{ role: "user", content: "你好" }],
    });

    expect(prompt.system).toContain("one-to-one chat");
    expect(prompt.system).toContain("Do not volunteer the platform name, provider, model, project title, project goal, host role, or workspace metadata");
    expect(prompt.system).toContain("answer naturally and briefly according to the model/provider's own response style");
    expect(prompt.system).toContain("Platform background, only if the user explicitly asks about the platform or workspace");
    expect(prompt.system).toContain("Use this as optional context, not as a required script or marketing pitch");
    expect(prompt.system).not.toContain("responding through Dialectica using provider");
    expect(prompt.system).not.toContain("For a simple greeting, reply exactly");
    expect(prompt.system).not.toContain("你好，有什么可以帮你");
    expect(prompt.system).not.toContain("AI-ready platform");
    expect(prompt.system).not.toContain(`project workspace "${project.title}"`);
    expect(prompt.system).not.toContain(project.goal);

    expect(prompt.user).toContain("Latest user request:\n你好");
    expect(prompt.user).not.toContain("Project goal:");
    expect(prompt.user).not.toContain("Scenario:");
    expect(prompt.user).not.toContain("Participants:");
    expect(prompt.user).not.toContain(project.goal);
    expect(prompt.user).not.toContain("主持个人 AI 对话");
  });

  it("gives platform background without forcing a platform introduction template", () => {
    const project = createAssistantChatProject();
    const prompt = buildConversationPrompt(project, createContext(project), "deepseek", {
      prompt: "你运行在什么平台？",
      history: [{ role: "user", content: "你运行在什么平台？" }],
    });

    expect(prompt.system).toContain("Dialectica is the local-first workspace hosting this chat");
    expect(prompt.system).toContain("AI conversation, collaborative discussion, automatic summaries, knowledge organization, and 2D/3D knowledge graphs");
    expect(prompt.system).toContain("optional context");
    expect(prompt.system).not.toContain("You must say");
    expect(prompt.system).not.toContain("Always introduce Dialectica");
    expect(prompt.system).not.toContain("AI-ready platform");
  });

  it("keeps collaborative workspace prompts lightweight while preserving project context", () => {
    const project = createCollaborativeProject();
    const prompt = buildConversationPrompt(project, createContext(project, { assistantSurface: "project-workspace" }), "deepseek", {
      prompt: "Please summarize the current disagreement.",
      history: [{ role: "user", content: "Please summarize the current disagreement." }],
    });

    expect(prompt.system).toContain(`collaborative project "${project.title}"`);
    expect(prompt.system).toContain("Keep the collaboration context lightweight");
    expect(prompt.system).toContain("Mention the platform, provider, or model only when the user asks");
    expect(prompt.system).not.toContain("You are running on Dialectica");
    expect(prompt.system).not.toContain("AI-ready platform");

    expect(prompt.user).toContain(`Project goal: ${project.goal}`);
    expect(prompt.user).toContain("Participants:");
    expect(prompt.user).toContain("Maya");
    expect(prompt.user).toContain("Noah");
    expect(prompt.user).toContain("Latest user request:");
  });

  it("keeps room facilitator prompts collaborative without becoming platform promotion", () => {
    const project = createCollaborativeProject();
    const prompt = buildConversationPrompt(project, createContext(project, { assistantSurface: "room-facilitator" }), "deepseek", {
      prompt: "Help the room identify next steps.",
      history: [{ role: "user", content: "Help the room identify next steps." }],
    });

    expect(prompt.system).toContain(`collaborative room for the project "${project.title}"`);
    expect(prompt.system).toContain("Support the discussion with concise summaries");
    expect(prompt.system).toContain("do not turn ordinary replies into product introductions");
    expect(prompt.system).not.toContain("You are running on Dialectica");
    expect(prompt.system).not.toContain("AI-ready platform");
    expect(prompt.user).toContain(`Project goal: ${project.goal}`);
  });

  it("keeps structured AI task orchestration project-aware", () => {
    const project = createCollaborativeProject();
    const packet = buildOrchestrationPacket(project, createContext(project, { assistantSurface: "project-workspace" }), "deepseek", "summarizeDiscussion");

    expect(packet.instructions.system).toContain("structured multi-party");
    expect(packet.instructions.user).toContain(`Project goal: ${project.goal}`);
    expect(packet.instructions.user).toContain("Participants:");
    expect(packet.participants.map((participant) => participant.name)).toEqual(["Maya", "Noah"]);
  });
});
