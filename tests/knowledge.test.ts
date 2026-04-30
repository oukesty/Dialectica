import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createProjectSkeleton } from "@/lib/data/repository";
import { createDefaultSettings } from "@/lib/factories";
import { extractKnowledgeSnapshot } from "@/lib/knowledge/extract";
import { canDeleteUserGraph } from "@/lib/knowledge/user-graphs";
import { canDeleteKnowledgeGraph, isProtectedSampleKnowledgeGraph, SAMPLE_USER_GRAPH_OWNER_ID } from "@/lib/knowledge/types";

function createKnowledgeFixtureProject(locale: "zh-CN" | "en") {
  const settings = createDefaultSettings(locale);
  const project = createProjectSkeleton(locale, "discussion", settings);
  const participantId = project.participants[0]?.id ?? "participant_fixture_1";
  const roomId = project.room.id;
  const sessionId = project.room.session.id;
  const now = new Date(Date.UTC(2026, 2, 14, locale === "zh-CN" ? 9 : 10, 0, 0)).toISOString();

  project.title =
    locale === "zh-CN"
      ? "生成式 AI 是否应正式进入学校与大学课堂"
      : "Should cities reduce private car dependence and prioritize public transit and walkable districts?";
  project.goal =
    locale === "zh-CN"
      ? "讨论课堂引入生成式 AI 的收益、风险与边界。"
      : "Evaluate whether cities should shift investment away from private cars toward transit and walkable neighborhoods.";
  project.summary.overview =
    locale === "zh-CN"
      ? "课堂引入生成式 AI 可以提升反馈速度，但诚信、公平与依赖问题仍未解决。"
      : "The transit shift could reduce congestion and emissions, but fairness and implementation readiness remain unresolved.";
  project.summary.currentConclusion =
    locale === "zh-CN" ? "可以有限引入，但必须有边界。"
      : "Cities should reduce car dependence only if transit capacity grows first.";
  project.summary.unresolvedQuestions =
    locale === "zh-CN"
      ? ["如何界定允许使用生成式 AI 的作业边界？"]
      : ["How should cities phase in restrictions before transit upgrades are complete?"];
  project.summary.participantOverview = [
    locale === "zh-CN" ? "林知遥主张以教学效率为导向试点引入。" : "Olivia Hart argues for a transit-first shift with phased implementation.",
  ];
  project.entries = [
    {
      id: "entry_fixture_1",
      participantId,
      ownerParticipantId: participantId,
      occurredAt: now,
      content:
        locale === "zh-CN"
          ? "如果学校明确边界，生成式 AI 可以用于反馈、结构梳理和辅助练习，但不能替代核心思考。"
          : "Cities can reduce car dependence if bus capacity, sidewalk safety, and pricing fairness improve together.",
      tags: [],
      kind: "statement",
      highlighted: false,
      linkedNodeIds: [],
      relatedEntryIds: [],
      source: "manual",
      syncState: "synced",
      roomId,
      sessionId,
    },
  ];
  project.nodes = [
    {
      id: "node_claim",
      title: locale === "zh-CN" ? "课堂可有限引入生成式 AI" : "Cities should reduce private car dependence",
      description: locale === "zh-CN" ? "引入应以边界清晰为前提。" : "The shift should happen with supporting infrastructure.",
      type: "claim",
      participantId,
      entryIds: ["entry_fixture_1"],
      stance: "support",
      strength: 4,
      status: "open",
    },
    {
      id: "node_evidence",
      title: locale === "zh-CN" ? "反馈效率提升" : "Transit access can improve equity",
      description: locale === "zh-CN" ? "教师可更快给出过程反馈。" : "Good transit reduces the burden on non-drivers.",
      type: "evidence",
      participantId,
      entryIds: ["entry_fixture_1"],
      stance: "support",
      strength: 3,
      status: "open",
    },
    {
      id: "node_risk",
      title: locale === "zh-CN" ? "学术诚信边界不清" : "Phasing may be unfair before upgrades land",
      description: locale === "zh-CN" ? "作业使用边界仍需规则。" : "Restrictions can burden commuters if transit is not ready.",
      type: "question",
      participantId,
      entryIds: ["entry_fixture_1"],
      stance: "ask",
      strength: 3,
      status: "open",
    },
    {
      id: "node_conclusion",
      title: locale === "zh-CN" ? "先试点再扩大" : "Pilot first, then scale",
      description: locale === "zh-CN" ? "应先以边界清晰的试点验证方案。" : "A pilot should validate readiness before wider rollout.",
      type: "conclusion",
      participantId,
      entryIds: ["entry_fixture_1"],
      stance: "support",
      strength: 4,
      status: "resolved",
    },
  ];
  project.relations = [
    {
      id: "rel_supports",
      sourceNodeId: "node_evidence",
      targetNodeId: "node_claim",
      type: "supports",
      note: locale === "zh-CN" ? "效率收益支撑试点引入。" : "Access improvements support the policy shift.",
    },
    {
      id: "rel_unresolved",
      sourceNodeId: "node_risk",
      targetNodeId: "node_claim",
      type: "asks",
      note: locale === "zh-CN" ? "诚信边界仍未解决。" : "Implementation fairness is still unresolved.",
    },
    {
      id: "rel_concludes",
      sourceNodeId: "node_claim",
      targetNodeId: "node_conclusion",
      type: "concludes",
      note: locale === "zh-CN" ? "形成先试点的阶段结论。" : "The discussion settles on piloting first.",
    },
  ];

  return project;
}

describe("knowledge extraction", () => {
  it("extracts reusable nodes and relations from a Chinese discussion fixture", () => {
    const snapshot = extractKnowledgeSnapshot(createKnowledgeFixtureProject("zh-CN"), [], createDefaultSettings());

    expect(snapshot.stats.nodeCount).toBeGreaterThan(5);
    expect(snapshot.stats.relationCount).toBeGreaterThan(3);
    expect(snapshot.analysis.primaryTopic.length).toBeGreaterThan(0);
    expect(snapshot.nodes.some((node) => node.type === "project")).toBe(true);
    expect(snapshot.nodes.some((node) => node.type === "argument" || node.type === "evidence")).toBe(true);
    expect(snapshot.relations.some((relation) => relation.type === "derived_from" || relation.type === "supports")).toBe(true);
  });

  it("includes unresolved questions and graph links when graph generation is explicitly enabled", () => {
    const settings = createDefaultSettings();
    settings.knowledgePreferences.autoGenerateGraphLinks = true;
    const snapshot = extractKnowledgeSnapshot(createKnowledgeFixtureProject("en"), [], settings, {
      generateGraphLinks: true,
    });

    expect(snapshot.analysis.unresolvedQuestions.length).toBeGreaterThan(0);
    expect(snapshot.nodes.some((node) => node.type === "conflict")).toBe(true);
    expect(snapshot.relations.some((relation) => relation.type === "unresolved_with")).toBe(true);
  });

  it("uses the requested interface locale for knowledge output instead of the project's stored language", () => {
    const settings = createDefaultSettings("zh-CN");
    const englishProject = createKnowledgeFixtureProject("en");

    const snapshot = extractKnowledgeSnapshot(englishProject, [], settings, {
      locale: "zh-CN",
      generateGraphLinks: true,
    });
    const generatedLocalizedRelation = snapshot.relations.find((relation) => relation.type === "unresolved_with");

    expect(snapshot.locale).toBe("zh-CN");
    expect(snapshot.nodes[0]?.provenance.projectLocale).toBe("zh-CN");
    expect(generatedLocalizedRelation?.note.includes("未解决")).toBe(true);
    expect(generatedLocalizedRelation?.note.includes("unresolved thread")).toBe(false);
  });

  it("filters low-signal chatter while keeping key conclusions, evidence, and actions", () => {
    const settings = createDefaultSettings("en");
    const project = createProjectSkeleton("en", "discussion", settings);
    const participantId = project.participants[0].id;
    const roomId = project.room.id;
    const sessionId = project.room.session.id;
    const now = new Date().toISOString();

    project.title = "Beta launch planning";
    project.description = "Decide whether to launch the beta in June and what must happen first.";
    project.tags = ["beta launch", "onboarding", "thanks"];
    project.summary.overview = "The team is deciding whether to move ahead with a June beta launch.";
    project.summary.coreTopics = ["beta launch", "pilot signups", "thanks"];
    project.summary.currentConclusion = "Proceed with a June beta launch.";
    project.summary.nextSteps = ["Prepare an onboarding checklist."];

    const createEntry = (id: string, content: string) => ({
      id,
      participantId,
      ownerParticipantId: participantId,
      occurredAt: now,
      content,
      tags: [],
      kind: "statement" as const,
      highlighted: false,
      linkedNodeIds: [],
      relatedEntryIds: [],
      source: "manual" as const,
      syncState: "synced" as const,
      roomId,
      sessionId,
    });

    project.entries = [
      createEntry("entry_ok", "Okay"),
      createEntry("entry_thanks", "Thanks"),
      createEntry("entry_goal", "We should launch the beta in June if onboarding is ready."),
      createEntry("entry_evidence", "Pilot signups exceeded the target by 40 percent."),
      createEntry("entry_conclusion", "We should proceed with the June beta launch."),
      createEntry("entry_action", "Prepare the onboarding checklist before launch."),
    ];

    project.nodes = [
      {
        id: "node_ok",
        title: "Okay",
        description: "Okay",
        type: "clarification",
        participantId,
        entryIds: ["entry_ok"],
        stance: "",
        strength: 0,
        status: "open",
      },
      {
        id: "node_thanks",
        title: "Thanks",
        description: "Thanks for the update",
        type: "clarification",
        participantId,
        entryIds: ["entry_thanks"],
        stance: "",
        strength: 0,
        status: "open",
      },
      {
        id: "node_goal",
        title: "Launch beta in June",
        description: "The team wants to launch the beta in June.",
        type: "claim",
        participantId,
        entryIds: ["entry_goal"],
        stance: "support",
        strength: 3,
        status: "open",
      },
      {
        id: "node_evidence",
        title: "Pilot signups exceeded target",
        description: "Pilot signups exceeded the target by 40 percent.",
        type: "evidence",
        participantId,
        entryIds: ["entry_evidence"],
        stance: "support",
        strength: 4,
        status: "open",
      },
      {
        id: "node_conclusion",
        title: "Proceed with June beta launch",
        description: "The team should proceed with the June beta launch.",
        type: "conclusion",
        participantId,
        entryIds: ["entry_conclusion"],
        stance: "support",
        strength: 5,
        status: "resolved",
      },
      {
        id: "node_action",
        title: "Prepare onboarding checklist",
        description: "Create the onboarding checklist before launch.",
        type: "actionItem",
        participantId,
        entryIds: ["entry_action"],
        stance: "support",
        strength: 4,
        status: "open",
      },
    ];

    project.relations = [
      {
        id: "rel_supports",
        sourceNodeId: "node_evidence",
        targetNodeId: "node_conclusion",
        type: "supports",
        note: "Evidence supports the launch decision.",
      },
      {
        id: "rel_concludes",
        sourceNodeId: "node_conclusion",
        targetNodeId: "node_action",
        type: "concludes",
        note: "The conclusion leads to the next action.",
      },
      {
        id: "rel_noise",
        sourceNodeId: "node_ok",
        targetNodeId: "node_thanks",
        type: "clarifies",
        note: "Acknowledge the previous message.",
      },
    ];

    const snapshot = extractKnowledgeSnapshot(project, [], settings, { generateGraphLinks: true });
    const titles = snapshot.nodes.map((node) => node.title);

    expect(titles).toContain("Proceed with June beta launch");
    expect(titles).toContain("Pilot signups exceeded target");
    expect(titles).toContain("Prepare onboarding checklist");
    expect(titles).not.toContain("Okay");
    expect(titles).not.toContain("Thanks");
    expect(titles).not.toContain("thanks");
    expect(snapshot.relations.some((relation) => relation.type === "supports")).toBe(true);
    expect(snapshot.stats.relationCount).toBeGreaterThan(0);
  });

  it("allows deleting only user-owned graphs", () => {
    expect(canDeleteUserGraph({ ownerIdentityId: "identity_user_1", ownerDisplayName: "User 1", sourceProjectIds: ["project_custom"] }, "identity_user_1")).toBe(true);
    expect(canDeleteUserGraph({ ownerIdentityId: "identity_user_1", ownerDisplayName: "User 1", sourceProjectIds: ["project_custom"] }, "identity_user_2")).toBe(false);
    expect(isProtectedSampleKnowledgeGraph({ ownerIdentityId: SAMPLE_USER_GRAPH_OWNER_ID, sourceProjectIds: ["project_custom"] })).toBe(false);
    expect(isProtectedSampleKnowledgeGraph({
      ownerIdentityId: SAMPLE_USER_GRAPH_OWNER_ID,
      sourceProjectIds: ["sample_civic_ai_room", "sample_heat_resilience_research"],
    })).toBe(true);
    expect(canDeleteKnowledgeGraph(
      {
        ownerIdentityId: "profile_legacy_owner",
        ownerDisplayName: "本地主持人",
        sourceProjectIds: ["project_custom"],
      },
      "profile_current_user",
      {
        currentDisplayName: "本地主持人",
        ownerProfileExists: false,
      },
    )).toBe(true);
  });

  it("keeps graph drag input on document listeners instead of pointer capture", () => {
    const twoDSource = readFileSync("src/components/knowledge/knowledge-graph-view.tsx", "utf8");
    const threeDSource = readFileSync("src/components/knowledge/knowledge-graph-3d-view.tsx", "utf8");
    const cssSource = readFileSync("src/app/globals.css", "utf8");

    expect(twoDSource).not.toContain("setPointerCapture");
    expect(twoDSource).not.toContain("releasePointerCapture");
    expect(threeDSource).not.toContain("setPointerCapture");
    expect(threeDSource).not.toContain("releasePointerCapture");
    expect(twoDSource).toContain("ownerDocument.addEventListener(\"pointermove\"");
    expect(threeDSource).toContain("ownerDocument.addEventListener(\"pointermove\"");
    expect(cssSource).toContain("[data-graph-viewport][data-graph-dragging=\"true\"]");
  });

  it("uses provider-backed AI for cross-graph analysis instead of local stitching", () => {
    const source = readFileSync("src/app/api/knowledge/user-graphs/analyze/route.ts", "utf8");

    expect(source).toContain("provider.respondInConversation");
    expect(source).toContain("allowFallbackToScaffold: false");
    expect(source).toContain("Every generated node must cite at least one source node id");
    expect(source).not.toContain("Build topic/concept index per graph");
    expect(source).not.toContain("Do not simply stitch every source graph together");
  });
});
