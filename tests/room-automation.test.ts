import { describe, expect, it } from "vitest";
import { automationAllowsTask } from "@/app/api/projects/[projectId]/ai/route";
import {
  appendSummaryHistory,
  evaluateAssistiveSummaryDecision,
  evaluateSummaryBatchQuality,
  getEffectiveSummaryAutomation,
  normalizeSummaryAutomationConfig,
  resolveAutoTriggeredTasks,
} from "@/lib/ai/summary-automation";
import { createProjectSkeleton } from "@/lib/data/repository";
import { createDefaultSettings } from "@/lib/factories";
import { AiTaskOutput } from "@/lib/types";

function createProjectWithEntries(count: number) {
  const settings = createDefaultSettings("zh-CN");
  const baseProject = createProjectSkeleton("zh-CN", "discussion", settings);
  baseProject.title = "课堂生成式 AI 讨论";
  baseProject.goal = "讨论课堂引入生成式 AI 的收益、风险与边界。";
  const participantId = baseProject.participants[0]?.id ?? "participant-1";

  return {
    ...baseProject,
    entries: Array.from({ length: count }, (_, index) => ({
      id: `entry-${index}`,
      participantId,
      ownerParticipantId: participantId,
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      content: `message ${index}`,
      tags: [],
      kind: "statement" as const,
      highlighted: false,
      linkedNodeIds: [],
      relatedEntryIds: [],
      source: "manual" as const,
      syncState: "synced" as const,
      roomId: baseProject.room.id,
      sessionId: baseProject.room.session.id,
    })),
  };
}

function createProjectWithContents(contents: string[]) {
  const project = createProjectWithEntries(0);
  const participantIds = project.participants.map((participant) => participant.id);

  return {
    ...project,
    entries: contents.map((content, index) => {
      const participantId = participantIds[index % Math.max(1, participantIds.length)] ?? "participant-1";
      return {
        id: `entry-content-${index}`,
        participantId,
        ownerParticipantId: participantId,
        occurredAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        content,
        tags: [],
        kind: content.endsWith("?") ? "question" as const : "statement" as const,
        highlighted: false,
        linkedNodeIds: [],
        relatedEntryIds: [],
        source: "manual" as const,
        syncState: "synced" as const,
        roomId: project.room.id,
        sessionId: project.room.session.id,
      };
    }),
  };
}

function createSummaryOutput(overrides: Partial<AiTaskOutput> = {}): AiTaskOutput {
  return {
    topic: "课堂生成式 AI 治理",
    viewpoints: ["教师希望提高反馈效率", "学生担心隐私和依赖风险"],
    arguments: ["生成式 AI 可以减少重复批改时间", "必须先建立引用和隐私边界"],
    evidence: ["试点数据表明反馈周期缩短了 30%"],
    conflicts: ["效率收益和学术诚信风险之间仍有分歧"],
    summary: "本轮讨论聚焦课堂生成式 AI 的使用边界：大家认可它能提升反馈效率，但也指出隐私、引用透明度和学术诚信风险需要先形成明确规则。",
    disputes: ["是否允许学生在形成初稿时使用 AI 仍未达成一致"],
    unresolvedQuestions: ["如何审计学生提交内容中的 AI 参与程度？"],
    evaluation: {
      leaning: "谨慎推进",
      favoredByEvidence: "试点数据支持反馈效率提升",
      favoredByResponsiveness: "双方都回应了隐私和诚信问题",
      favoredByLogic: "先定规则再扩大试点更连贯",
      moreUnanswered: "审计方式仍不明确",
      confidence: "medium",
      reasons: ["证据有限但方向明确"],
      improvementSuggestions: ["补充隐私评估"],
    },
    conclusion: "可以小范围试点，但要先制定引用、隐私和审计规则。",
    suggestions: ["整理试点规则草案"],
    recommendations: ["下次会议确认隐私评估负责人"],
    followupQuestions: ["哪些课程最适合先试点？"],
    ...overrides,
  };
}

describe("room summary automation rules", () => {
  it("maps the legacy auto mode into the new basic summary mode", () => {
    const normalized = normalizeSummaryAutomationConfig({
      mode: "auto",
      autoReplyThreshold: 30,
      permissions: {
        facilitatorCanManage: false,
        facilitatorCanTrigger: false,
      },
    });

    expect(normalized.mode).toBe("basic");
    expect(normalized.summaryThreshold).toBe(30);
    expect(normalized.summaryCurrentThreshold).toBe(30);
  });

  it("triggers only summarizeDiscussion in basic mode once the fixed threshold is reached", () => {
    const project = {
      ...createProjectWithEntries(20),
      room: {
        ...createProjectWithEntries(20).room,
        aiAutomation: {
          mode: "basic" as const,
          summaryThreshold: 10,
          summaryCurrentThreshold: 10,
          summaryLastProcessedEntryCount: 10,
          permissions: {
            facilitatorCanManage: false,
            facilitatorCanTrigger: false,
          },
        },
      },
    };

    expect(resolveAutoTriggeredTasks(project)).toEqual(["summarizeDiscussion"]);
  });

  it("uses the current assistive threshold rather than evaluating every new message", () => {
    const project = {
      ...createProjectWithEntries(29),
      room: {
        ...createProjectWithEntries(29).room,
        aiAutomation: {
          mode: "assistive" as const,
          summaryThreshold: 20,
          summaryCurrentThreshold: 15,
          summaryLastProcessedEntryCount: 14,
          permissions: {
            facilitatorCanManage: false,
            facilitatorCanTrigger: false,
          },
        },
      },
    };

    expect(resolveAutoTriggeredTasks(project)).toEqual(["summarizeDiscussion"]);
  });

  it("downgrades stale assistive automation to basic behavior for single-user projects", () => {
    const baseProject = createProjectWithEntries(20);
    const project = {
      ...baseProject,
      scenario: "ai-dialogue" as const,
      participants: baseProject.participants.slice(0, 1),
      room: {
        ...baseProject.room,
        aiAutomation: {
          mode: "assistive" as const,
          summaryThreshold: 30,
          summaryCurrentThreshold: 10,
          summaryLastProcessedEntryCount: 0,
          permissions: {
            facilitatorCanManage: false,
            facilitatorCanTrigger: false,
          },
        },
      },
    };

    expect(getEffectiveSummaryAutomation(project).mode).toBe("basic");
    expect(resolveAutoTriggeredTasks(project)).toEqual([]);
  });

  it("keeps explicit off mode off instead of resurrecting automation from defaults", () => {
    const project = {
      ...createProjectWithEntries(40),
      room: {
        ...createProjectWithEntries(40).room,
        aiAutomation: {
          mode: "off" as const,
          summaryThreshold: 20,
          summaryCurrentThreshold: 20,
          summaryLastProcessedEntryCount: 0,
          permissions: {
            facilitatorCanManage: false,
            facilitatorCanTrigger: false,
          },
        },
      },
    };

    expect(resolveAutoTriggeredTasks(project)).toEqual([]);
    expect(automationAllowsTask(project, "summarizeDiscussion")).toBe(false);
  });

  it("only allows automated summaries and blocks automated evaluation/follow-up tasks", () => {
    const baseProject = createProjectWithEntries(5);
    const project = {
      ...baseProject,
      room: {
        ...baseProject.room,
        aiAutomation: {
          mode: "assistive" as const,
          summaryThreshold: 20,
          summaryCurrentThreshold: 20,
          summaryLastProcessedEntryCount: 0,
          permissions: {
            facilitatorCanManage: false,
            facilitatorCanTrigger: false,
          },
        },
      },
    };

    expect(automationAllowsTask(project, "summarizeDiscussion")).toBe(true);
    expect(automationAllowsTask(project, "evaluateDiscussion")).toBe(false);
    expect(automationAllowsTask(project, "generateFollowupQuestions")).toBe(false);
  });

  it("keeps linear summary history without trimming older entries", () => {
    const history = Array.from({ length: 25 }, (_, index) => ({
      id: `summary-${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      trigger: "manual" as const,
      providerId: "mock" as const,
      model: "rule-balanced-v1",
      throughEntryCount: index + 1,
      overview: `overview ${index}`,
      currentConclusion: "",
      nextSteps: [],
    }));

    const nextHistory = appendSummaryHistory(history, {
      id: "summary-25",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 25)).toISOString(),
      trigger: "auto-basic" as const,
      providerId: "mock" as const,
      model: "rule-balanced-v1",
      throughEntryCount: 26,
      overview: "overview 25",
      currentConclusion: "",
      nextSteps: [],
    });

    expect(nextHistory).toHaveLength(26);
    expect(nextHistory[0]?.id).toBe("summary-0");
    expect(nextHistory.at(-1)?.id).toBe("summary-25");
  });

  it("drops only the oldest summaries when capped retention is enabled", () => {
    const history = Array.from({ length: 5 }, (_, index) => ({
      id: `summary-${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      trigger: "manual" as const,
      providerId: "mock" as const,
      model: "rule-balanced-v1",
      throughEntryCount: index + 1,
      overview: `overview ${index}`,
      currentConclusion: "",
      nextSteps: [],
    }));

    const nextHistory = appendSummaryHistory(history, {
      id: "summary-5",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 5)).toISOString(),
      trigger: "auto-basic" as const,
      providerId: "mock" as const,
      model: "rule-balanced-v1",
      throughEntryCount: 6,
      overview: "overview 5",
      currentConclusion: "",
      nextSteps: [],
    }, {
      mode: "capped",
      limit: 3,
    });

    expect(nextHistory.map((entry) => entry.id)).toEqual(["summary-3", "summary-4", "summary-5"]);
  });

  it("skips low-value automatic summary batches even when the provider returns structured text", () => {
    const project = createProjectWithContents(["好的", "收到", "thanks", "sounds good"]);
    const decision = evaluateSummaryBatchQuality({
      pendingEntries: project.entries,
      output: createSummaryOutput(),
      previousSummary: project.summary,
      mode: "basic",
    });

    expect(decision.shouldPersistSummary).toBe(false);
    expect(decision.rationale).toBe("low-signal-batch");
  });

  it("persists high-signal automatic summary batches and rejects near-duplicates", () => {
    const project = createProjectWithContents([
      "因为试点数据表明反馈周期缩短 30%，我建议继续保留 AI 反馈工具。",
      "但是隐私风险没有解决，必须先明确学生数据是否会进入外部模型。",
      "下一步应该由教务组整理引用规范，并在下次会议确认审计方式。",
    ]);
    const output = createSummaryOutput();

    expect(evaluateSummaryBatchQuality({
      pendingEntries: project.entries,
      output,
      previousSummary: project.summary,
      mode: "basic",
    }).shouldPersistSummary).toBe(true);

    const duplicateDecision = evaluateSummaryBatchQuality({
      pendingEntries: project.entries,
      output,
      previousSummary: {
        ...project.summary,
        overview: output.summary,
      },
      mode: "basic",
    });
    expect(duplicateDecision.shouldPersistSummary).toBe(false);
    expect(duplicateDecision.rationale).toBe("duplicate-summary");
  });

  it("makes assistive mode stricter than basic mode and adjusts the next threshold", () => {
    const lowSignalProject = createProjectWithContents(["ok", "thanks", "好的", "收到"]);
    const highSignalProject = createProjectWithContents([
      "因为预算已经超出 15%，我建议先冻结非必要采购。",
      "我不同意完全冻结，关键供应商延期会带来交付风险。",
      "下一步必须让财务给出三种预算方案，并标出对上线日期的影响。",
      "还有一个未解决问题：客户是否接受分阶段上线？",
    ]);

    const lowDecision = evaluateAssistiveSummaryDecision({
      baseThreshold: 20,
      currentThreshold: 20,
      pendingEntries: lowSignalProject.entries,
      output: createSummaryOutput(),
      previousSummary: lowSignalProject.summary,
    });
    const highDecision = evaluateAssistiveSummaryDecision({
      baseThreshold: 20,
      currentThreshold: 20,
      pendingEntries: highSignalProject.entries,
      output: createSummaryOutput({
        evidence: ["预算表显示已超支 15%", "供应链排期显示延期会影响上线"],
        unresolvedQuestions: ["客户是否接受分阶段上线？", "冻结采购会影响哪些供应商？"],
        recommendations: ["财务准备三种预算方案", "项目经理确认客户分阶段上线意愿"],
      }),
      previousSummary: highSignalProject.summary,
    });

    expect(lowDecision.shouldPersistSummary).toBe(false);
    expect(lowDecision.nextThreshold).toBeGreaterThan(20);
    expect(highDecision.shouldPersistSummary).toBe(true);
    expect(highDecision.nextThreshold <= 20).toBe(true);
  });
});
