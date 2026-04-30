import { describe, expect, it } from "vitest";
import { runRuleBasedAnalysis } from "@/lib/analysis/rule-based";
import { createDefaultSettings, createProviderRuntimeMap } from "@/lib/factories";
import { createProjectSkeleton } from "@/lib/data/repository";
import { importProject, projectToMarkdown, projectToText } from "@/lib/import-export";

function createFixtureProject(locale: "zh-CN" | "en", title: string, goal: string) {
  const settings = createDefaultSettings(locale);
  const project = createProjectSkeleton(locale, "discussion", settings);
  const participantId = project.participants[0]?.id ?? "participant_fixture_1";
  const participantIdB = project.participants[1]?.id ?? participantId;
  const roomId = project.room.id;
  const sessionId = project.room.session.id;
  const timestamp = new Date(Date.UTC(2026, 2, 14, locale === "zh-CN" ? 9 : 10, 0, 0)).toISOString();

  project.title = title;
  project.goal = goal;
  project.summary.overview =
    locale === "zh-CN"
      ? "课堂试用生成式 AI 既有教学效率收益，也存在诚信与依赖风险，仍处于边界待定的灰区。"
      : "Reducing private car dependence could improve access and emissions, but the rollout still hinges on fairness, timing, and local readiness.";
  project.entries = [
    {
      id: "entry_fixture_1",
      participantId,
      ownerParticipantId: participantId,
      occurredAt: timestamp,
      content:
        locale === "zh-CN"
          ? "今天的核心问题是，生成式 AI 是否应正式进入学校与大学课堂，以及边界该如何划定。"
          : "The city should reduce private car dependence only if transit capacity and walkable access improve in parallel.",
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
    {
      id: "entry_fixture_2",
      participantId: participantIdB,
      ownerParticipantId: participantIdB,
      occurredAt: new Date(Date.parse(timestamp) + 60_000).toISOString(),
      content:
        locale === "zh-CN"
          ? "教师需要证据证明生成式 AI 不会放大学习差距，否则政策会带来新的公平风险。"
          : "The city still needs evidence that transit improvements will reach outer districts before driving restrictions tighten.",
      tags: locale === "zh-CN" ? ["证据", "公平"] : ["evidence", "fairness"],
      kind: "response",
      highlighted: false,
      linkedNodeIds: [],
      relatedEntryIds: ["entry_fixture_1"],
      source: "manual",
      syncState: "synced",
      roomId,
      sessionId,
    },
    {
      id: "entry_fixture_3",
      participantId,
      ownerParticipantId: participantId,
      occurredAt: new Date(Date.parse(timestamp) + 120_000).toISOString(),
      content:
        locale === "zh-CN"
          ? "如果先做教师培训、作业边界和公开评估，课堂试点仍然值得推进。"
          : "A phased rollout with service guarantees and public metrics would make the transition more defensible.",
      tags: locale === "zh-CN" ? ["试点", "边界"] : ["pilot", "metrics"],
      kind: "summary",
      highlighted: true,
      linkedNodeIds: [],
      relatedEntryIds: ["entry_fixture_1", "entry_fixture_2"],
      source: "manual",
      syncState: "synced",
      roomId,
      sessionId,
    },
  ];
  project.nodes = [
    {
      id: "node_claim",
      title: locale === "zh-CN" ? "课堂可有限引入生成式 AI" : "Cities should reduce private car dependence in phases",
      description: locale === "zh-CN" ? "应以边界和培训为前提。" : "The shift should happen with transit guarantees.",
      type: "claim",
      participantId,
      entryIds: ["entry_fixture_1", "entry_fixture_3"],
      stance: "support",
      strength: 4,
      status: "contested",
    },
    {
      id: "node_evidence",
      title: locale === "zh-CN" ? "教师培训和评估可以控制风险" : "Service metrics can reduce rollout risk",
      description: locale === "zh-CN" ? "制度化边界可降低滥用。" : "Public metrics make phased rollout accountable.",
      type: "evidence",
      participantId,
      entryIds: ["entry_fixture_3"],
      stance: "support",
      strength: 3,
      status: "open",
    },
    {
      id: "node_rebuttal",
      title: locale === "zh-CN" ? "公平风险尚未解决" : "Outer-district fairness is still unresolved",
      description: locale === "zh-CN" ? "学生差距可能被放大。" : "Restrictions may outpace improvements in peripheral districts.",
      type: "rebuttal",
      participantId: participantIdB,
      entryIds: ["entry_fixture_2"],
      stance: "oppose",
      strength: 3,
      status: "open",
    },
    {
      id: "node_question",
      title: locale === "zh-CN" ? "课堂试点边界如何设定？" : "What service threshold should precede restrictions?",
      description: locale === "zh-CN" ? "需要明确允许使用的作业范围。" : "The city needs a visible threshold before tightening policy.",
      type: "question",
      participantId: participantIdB,
      entryIds: ["entry_fixture_2"],
      stance: "ask",
      strength: 3,
      status: "open",
    },
  ];
  project.relations = [
    {
      id: "rel_supports",
      sourceNodeId: "node_evidence",
      targetNodeId: "node_claim",
      type: "supports",
      note: locale === "zh-CN" ? "培训与评估支撑有限引入。" : "Metrics support a phased shift.",
    },
    {
      id: "rel_rebuts",
      sourceNodeId: "node_rebuttal",
      targetNodeId: "node_claim",
      type: "rebuts",
      note: locale === "zh-CN" ? "公平风险构成主要反驳。" : "Fairness concerns directly rebut the policy.",
    },
    {
      id: "rel_asks",
      sourceNodeId: "node_question",
      targetNodeId: "node_claim",
      type: "asks",
      note: locale === "zh-CN" ? "需要补充边界条件。" : "The rollout still needs a threshold definition.",
    },
  ];

  return project;
}

describe("rule-based analysis", () => {
  it("generates insights and summary for the Chinese sample", () => {
    const classroomSample = createFixtureProject("zh-CN", "生成式 AI 是否应正式进入学校与大学课堂", "讨论课堂引入生成式 AI 的收益、风险与边界。");

    const result = runRuleBasedAnalysis(classroomSample, {
      locale: "zh-CN",
      emphasis: "balanced",
      stage: "final-summary",
      goal: classroomSample.goal,
      providerConfig: createProviderRuntimeMap().mock,
      requestTimeoutMs: 30000,
      preferServerKeys: true,
      allowFallbackToScaffold: true,
    });

    expect(result.insights.items.length).toBeGreaterThan(0);
    expect(result.summary.majorClaims.length).toBeGreaterThan(0);
    expect(result.summary.currentConclusion.length).toBeGreaterThan(0);
    expect(result.providerSnapshot.providerId).toBe("mock");
  });

  it("generates an English evaluation payload for the English sample", () => {
    const urbanMobilitySample = createFixtureProject("en", "Should cities reduce private car dependence and prioritize public transit and walkable districts?", "Evaluate whether cities should shift investment away from private cars toward transit and walkable neighborhoods.");

    const result = runRuleBasedAnalysis(urbanMobilitySample, {
      locale: "en",
      emphasis: "responsiveness",
      stage: "evaluation",
      goal: urbanMobilitySample.goal,
      providerConfig: createProviderRuntimeMap().mock,
      requestTimeoutMs: 30000,
      preferServerKeys: true,
      allowFallbackToScaffold: true,
    });

    expect(result.summary.evaluation.leaning.length).toBeGreaterThan(0);
    expect(result.summary.majorRebuttals.length).toBeGreaterThan(0);
    expect(result.summary.majorRebuttals[0]?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("import and export", () => {
  it("imports a plain text transcript into a project", () => {
    const imported = importProject({
      format: "txt",
      locale: "en",
      content: [
        "Avery: We need to decide.",
        "Nadia: Remote-first improves focus.",
        "Marcus: Hybrid still helps onboarding.",
      ].join("\n"),
    });

    expect(imported.project.entries).toHaveLength(3);
    expect(imported.project.participants).toHaveLength(3);
  });

  it("exports markdown and text summaries", () => {
    const classroomSample = createFixtureProject("zh-CN", "生成式 AI 是否应正式进入学校与大学课堂", "讨论课堂引入生成式 AI 的收益、风险与边界。");
    const urbanMobilitySample = createFixtureProject("en", "Should cities reduce private car dependence and prioritize public transit and walkable districts?", "Evaluate whether cities should shift investment away from private cars toward transit and walkable neighborhoods.");

    const markdown = projectToMarkdown(urbanMobilitySample);
    const text = projectToText(classroomSample);

    expect(markdown).toContain("# Should cities reduce private car dependence and prioritize public transit and walkable districts?");
    expect(text).toContain("[2026-03-14T09:00:00.000Z]");
  });
});
