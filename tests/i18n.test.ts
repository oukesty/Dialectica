import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import ja from "@/locales/ja.json";
import ko from "@/locales/ko.json";
import ru from "@/locales/ru.json";
import zhCN from "@/locales/zh-CN.json";
import { createDefaultSettings, resolveProfileDisplayName } from "@/lib/factories";
import { resolveInitialLocaleFromAcceptLanguage } from "@/lib/i18n";
import { resolveGraphOutputLocale } from "@/lib/knowledge/user-graphs";
import { providerCatalog } from "@/lib/providers/provider-catalog";
import {
  bundledSampleKnowledgeGraphs,
  bundledSampleProjectIds,
  getBundledSampleKnowledgeProject,
  getLocalizedBundledSampleKnowledgeGraphs,
  localizeBundledProject,
  sampleProjects,
} from "@/data/samples";
import { APP_LOCALES, DISPLAY_LOCALE_ORDER, LOCALE_AUTONYMS } from "@/lib/types";

const EMPTY_SAMPLE_SUMMARY_OVERVIEW = {
  en: "No AI summary yet.",
  "zh-CN": "尚无 AI 总结。",
  ja: "AI要約はまだありません。",
  ko: "아직 AI 요약이 없습니다.",
  fr: "Aucun résumé IA pour le moment.",
  ru: "AI‑сводки пока нет.",
} satisfies Record<(typeof APP_LOCALES)[number], string>;

function collectPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]): string[] =>
    collectPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
}

describe("locale dictionaries", () => {
  it("share the same translation key shape across all six languages", () => {
    const baseline = collectPaths(en).sort();
    expect(collectPaths(zhCN).sort()).toEqual(baseline);
    expect(collectPaths(ja).sort()).toEqual(baseline);
    expect(collectPaths(ko).sort()).toEqual(baseline);
    expect(collectPaths(fr).sort()).toEqual(baseline);
    expect(collectPaths(ru).sort()).toEqual(baseline);
  });

  it("explains automatic and assistive summary modes as different behaviors", () => {
    expect(en.roomAi.modeBasicHint).toContain("saves a summary");
    expect(en.roomAi.modeAssistiveHint).toContain("saves a summary only when");
    expect(en.settings.assistiveSummaryThresholdHint).toContain("multi-user only");
    expect(zhCN.roomAi.modeBasicHint).toContain("自动生成并保存总结");
    expect(zhCN.roomAi.modeAssistiveHint).toContain("低信号批次");
  });

  it("ships two protected bundled sample projects with four graph views plus one cross-project graph", () => {
    expect(sampleProjects).toHaveLength(2);
    expect([...bundledSampleProjectIds].sort()).toEqual(sampleProjects.map((project) => project.id).sort());
    expect(sampleProjects.every((project) => project.metadata.isSample)).toBe(true);
    expect(bundledSampleKnowledgeGraphs).toHaveLength(9);
    for (const project of sampleProjects) {
      const projectGraphs = bundledSampleKnowledgeGraphs.filter((graph) => graph.sourceProjectIds.length === 1 && graph.sourceProjectIds.includes(project.id));
      expect(projectGraphs.filter((graph) => graph.graphMode === "2d")).toHaveLength(2);
      expect(projectGraphs.filter((graph) => graph.graphMode === "3d")).toHaveLength(2);
      expect(projectGraphs.every((graph) => graph.visibility === "public" && graph.status === "ready")).toBe(true);
    }
    const crossGraph = bundledSampleKnowledgeGraphs.find((graph) => graph.id === "sample_cross_civic_heat_resilience_governance");
    expect(crossGraph?.graphMode).toBe("both");
    expect(crossGraph?.sourceProjectIds.sort()).toEqual(sampleProjects.map((project) => project.id).sort());
    expect(crossGraph?.nodes.length).toBeGreaterThanOrEqual(10);
    expect(crossGraph?.relations.length).toBeGreaterThanOrEqual(10);
  });

  it("keeps the collaboration live feed shell stable when bundled samples include real events", () => {
    const panelSource = readFileSync("src/components/projects/project-collaboration-panel.tsx", "utf8");
    const assistantSource = readFileSync("src/components/assistant/assistant-workspace.tsx", "utf8");

    expect(panelSource).not.toContain("visibleEvents.length <= 4");
    expect(panelSource).not.toContain("h-[56rem] xl:h-[60rem] 2xl:h-[66rem]");
    expect(panelSource).toContain("xl:max-h-[52rem]");
    expect(assistantSource).toContain("feedEvents.slice(-visibleEventCount)");
    expect(assistantSource).toContain("visibleFeedEvents.map");
    expect(panelSource).toContain("visibleEvents.slice(-visibleEventCount)");
    expect(panelSource).toContain("renderedVisibleEvents.map");
    expect(panelSource).toContain("state?.events.length ?? visibleEvents.length");
    expect(panelSource).toContain("setNicknames(previousNicknames)");
    expect(panelSource).toContain("onProjectChange?.(baseProject)");
  });

  it("keeps message windowing in the UI layer instead of the assistant context source", () => {
    const conversationSource = readFileSync("src/lib/ai/assistant-conversation.ts", "utf8");

    expect(conversationSource).toContain("let events = collaboration.events");
    expect(conversationSource).not.toContain("visibleFeedEvents");
    expect(conversationSource).not.toContain("renderedVisibleEvents");
  });

  it("localizes bundled sample content across all six locales without changing graph structure", () => {
    const baselineGraphs = getLocalizedBundledSampleKnowledgeGraphs("zh-CN");
    for (const locale of APP_LOCALES) {
      const localizedProjects = sampleProjects.map((project) => localizeBundledProject(project, locale));
      const localizedKnowledgeProjects = sampleProjects.map((project) => getBundledSampleKnowledgeProject(project.id, locale));
      expect(localizedProjects).toHaveLength(2);
      expect(localizedProjects.every((project) => project.language === locale)).toBe(true);
      expect(localizedProjects.every((project) => project.participants.length === 5)).toBe(true);
      expect(localizedProjects.every((project) => project.entries.length === 10)).toBe(true);
      expect(localizedProjects.every((project) => new Set(project.entries.filter((entry) => entry.source !== "system").map((entry) => entry.participantId)).size >= 5)).toBe(true);
      expect(localizedProjects.every((project) => project.entries.every((entry) => entry.content.trim().length > 20))).toBe(true);
      expect(localizedProjects.every((project) => project.entries.some((entry) => entry.source === "system" && entry.kind === "summary"))).toBe(true);
      expect(localizedProjects.every((project) => project.nodes.length === 0)).toBe(true);
      expect(localizedProjects.every((project) => project.relations.length === 0)).toBe(true);
      expect(localizedProjects.every((project) => project.insights.items.length === 0)).toBe(true);
      expect(localizedProjects.every((project) => project.room.visibility === "private")).toBe(true);
      expect(localizedProjects.every((project) => project.room.joinMode === "open")).toBe(true);
      expect(localizedProjects.every((project) => project.room.aiAutomation?.mode === "off")).toBe(true);
      expect(localizedProjects.every((project) => (project.summary.history?.length ?? 0) === 1)).toBe(true);
      expect(localizedProjects.every((project) => project.summary.history?.[0]?.overview === project.summary.overview)).toBe(true);
      expect(localizedProjects.every((project) => (project.summary.history?.[0]?.overview.trim().length ?? 0) > 180)).toBe(true);
      expect(localizedProjects.every((project) => project.summary.overview !== EMPTY_SAMPLE_SUMMARY_OVERVIEW[locale])).toBe(true);
      expect(localizedProjects.every((project) => project.summary.overview.trim().length > 20)).toBe(true);
      expect(localizedProjects.every((project) => project.description.trim().length > 20)).toBe(true);
      expect(localizedProjects.every((project) => project.goal.trim().length > 20)).toBe(true);
      expect(localizedProjects.every((project) => project.room.session.title.trim().length > 8)).toBe(true);
      expect(localizedProjects.every((project) => project.room.session.goal.trim().length > 20)).toBe(true);
      expect(localizedProjects.every((project) => project.tags.length >= 4)).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.intro.trim().length)).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.sections.length === 4)).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.sections.every((section) => section.title.trim().length > 0 && section.body.trim().length > 20))).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.discussionExcerpts.length === 3)).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.discussionExcerpts.every((excerpt) => excerpt.speaker.trim().length > 0 && excerpt.role.trim().length > 0 && excerpt.body.trim().length > 20))).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.aiInterventions.length === 2)).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.aiInterventions.every((intervention) => intervention.title.trim().length > 0 && intervention.body.trim().length > 20))).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.systemStages.length === 2)).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.systemStages.every((stage) => stage.title.trim().length > 0 && stage.body.trim().length > 20))).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.graphEvidence.title.trim().length && project.metadata.samplePresentation.graphEvidence.body.trim().length > 20)).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.graphHighlights.length === 2)).toBe(true);
      expect(localizedProjects.every((project) => project.metadata.samplePresentation?.graphHighlights.every((highlight) => highlight.title.trim().length > 0 && highlight.body.trim().length > 20))).toBe(true);
      expect(localizedKnowledgeProjects.every(Boolean)).toBe(true);
      expect(localizedKnowledgeProjects.every((project) => project!.language === locale)).toBe(true);
      expect(localizedKnowledgeProjects.every((project) => project!.participants.length === 5)).toBe(true);
      expect(localizedKnowledgeProjects.every((project) => project!.entries.length >= 10)).toBe(true);
      expect(localizedKnowledgeProjects.every((project) => project!.nodes.length >= 13)).toBe(true);
      expect(localizedKnowledgeProjects.every((project) => project!.relations.length >= 10)).toBe(true);
      expect(localizedKnowledgeProjects.every((project) => (project!.summary.history?.length ?? 0) > 0)).toBe(true);

      const localizedGraphs = getLocalizedBundledSampleKnowledgeGraphs(locale);
      expect(localizedGraphs.map((graph) => graph.id)).toEqual(baselineGraphs.map((graph) => graph.id));
      for (const graph of localizedGraphs) {
        const baseline = baselineGraphs.find((candidate) => candidate.id === graph.id);
        expect(baseline).toBeDefined();
        expect(graph.locale).toBe(locale);
        expect(graph.nodes).toHaveLength(baseline!.nodes.length);
        expect(graph.relations).toHaveLength(baseline!.relations.length);
        expect(graph.nodes.every((node) => node.provenance.projectLocale === locale)).toBe(true);
      }
    }

    expect(getBundledSampleKnowledgeProject(sampleProjects[0]!.id, "en")!.participants[0]?.name).toBe("Maya Carter");
    expect(getBundledSampleKnowledgeProject(sampleProjects[0]!.id, "ja")!.participants[0]?.name).toBe("森川真央");
    expect(getBundledSampleKnowledgeProject(sampleProjects[1]!.id, "ko")!.participants[0]?.name).toBe("한지우");
    expect(getBundledSampleKnowledgeProject(sampleProjects[1]!.id, "fr")!.participants[0]?.name).toBe("Claire Martin");
    expect(getBundledSampleKnowledgeProject(sampleProjects[1]!.id, "ru")!.participants[0]?.name).toBe("Елена Шэнь");

    for (const locale of ["en", "fr", "ru"] as const) {
      const strings = [
        ...sampleProjects.flatMap((project) => collectStrings(localizeBundledProject(project, locale))),
        ...sampleProjects.flatMap((project) => collectStrings(getBundledSampleKnowledgeProject(project.id, locale))),
        ...getLocalizedBundledSampleKnowledgeGraphs(locale).flatMap(collectStrings),
      ];
      const visibleStrings = strings.filter((value) => !/^(civic|heat|sample|room|session|project|event|summary|presence|conn|rule|mock|public|private|active|ready|zh-CN|en|fr|ru|ja|ko|2d|3d|basic|assistive|off|manual|system|bundled|local)/i.test(value));
      expect(visibleStrings.filter((value) => /[\u4e00-\u9fff]/u.test(value))).toEqual([]);
    }

    const userProject = {
      ...sampleProjects[0]!,
      id: "user_created_project",
      title: "用户自建中文项目",
      description: "用户自己写的项目描述不会被界面语言切换改写。",
      goal: "用户自己写的讨论目标保持原文。",
      tags: ["用户标签", "原文保留"],
      entries: [
        {
          ...sampleProjects[0]!.entries[0]!,
          id: "user_entry_1",
          content: "用户自己输入的消息不会被自动翻译。",
          tags: ["用户消息标签"],
        },
      ],
      summary: {
        ...sampleProjects[0]!.summary,
        overview: "用户自己生成的总结不会被自动改写。",
      },
      room: {
        ...sampleProjects[0]!.room,
        session: {
          ...sampleProjects[0]!.room.session,
          title: "用户房间标题",
          goal: "用户房间目标保持原文。",
        },
      },
      metadata: {
        ...sampleProjects[0]!.metadata,
        isSample: false,
        source: "user-created",
        sampleKey: undefined,
      },
    };
    const localizedUserProject = localizeBundledProject(userProject, "en");
    expect(localizedUserProject).toBe(userProject);
    expect(localizedUserProject.title).toBe("用户自建中文项目");
    expect(localizedUserProject.description).toBe("用户自己写的项目描述不会被界面语言切换改写。");
    expect(localizedUserProject.goal).toBe("用户自己写的讨论目标保持原文。");
    expect(localizedUserProject.tags).toEqual(["用户标签", "原文保留"]);
    expect(localizedUserProject.entries[0]?.content).toBe("用户自己输入的消息不会被自动翻译。");
    expect(localizedUserProject.entries[0]?.tags).toEqual(["用户消息标签"]);
    expect(localizedUserProject.summary.overview).toBe("用户自己生成的总结不会被自动改写。");
    expect(localizedUserProject.room.session.title).toBe("用户房间标题");
    expect(localizedUserProject.room.session.goal).toBe("用户房间目标保持原文。");
  });

  it("ships disabled adapter and no-executable-model copy across all six locales", () => {
    const dictionaries = { en, "zh-CN": zhCN, ja, ko, fr, ru };

    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      expect(dictionary.settings.disabledAdapterNoModel.trim(), `${locale} settings.disabledAdapterNoModel`).not.toBe("");
      expect(dictionary.providersCatalog.disabled.label.trim(), `${locale} providersCatalog.disabled.label`).not.toBe("");
      expect(dictionary.providersCatalog.disabled.description.trim(), `${locale} providersCatalog.disabled.description`).not.toBe("");
      expect(dictionary.assistant.noSavedKeyBody.trim(), `${locale} assistant.noSavedKeyBody`).not.toBe("");
    }
  });

  it("keeps the published six-language display order for settings and graph language options", () => {
    expect(DISPLAY_LOCALE_ORDER).toEqual(["en", "zh-CN", "ja", "ko", "fr", "ru"]);
  });

  it("uses stable autonyms for locale selectors across all interfaces", () => {
    expect(LOCALE_AUTONYMS).toEqual({
      en: "English",
      "zh-CN": "中文",
      ja: "日本語",
      ko: "한국어",
      fr: "Français",
      ru: "Русский",
    });
  });
});

describe("provider catalog", () => {
  it("contains all mainstream provider scaffolds required by Phase 2", () => {
    expect(providerCatalog.map((provider) => provider.id)).toEqual([
      "mock",
      "disabled",
      "openai",
      "gemini",
      "grok",
      "claude",
      "deepseek",
      "doubao",
      "qwen",
    ]);
  });
});

describe("initial locale resolution", () => {
  it("maps supported system languages to supported app locales", () => {
    expect(resolveInitialLocaleFromAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh-CN");
    expect(resolveInitialLocaleFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(resolveInitialLocaleFromAcceptLanguage("ja-JP,ja;q=0.9,en;q=0.8")).toBe("ja");
    expect(resolveInitialLocaleFromAcceptLanguage("ko-KR,ko;q=0.9,en;q=0.8")).toBe("ko");
    expect(resolveInitialLocaleFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(resolveInitialLocaleFromAcceptLanguage("ru-RU,ru;q=0.9,en;q=0.8")).toBe("ru");
  });

  it("falls back to English for unsupported or missing system languages", () => {
    expect(resolveInitialLocaleFromAcceptLanguage("de-DE,de;q=0.9")).toBe("en");
    expect(resolveInitialLocaleFromAcceptLanguage("")).toBe("en");
    expect(resolveInitialLocaleFromAcceptLanguage()).toBe("en");
  });
});

describe("default profile display names", () => {
  it("uses first-person localized defaults across all six languages", () => {
    expect(createDefaultSettings("en").profile.displayName).toBe("Me");
    expect(createDefaultSettings("zh-CN").profile.displayName).toBe("我");
    expect(createDefaultSettings("ja").profile.displayName).toBe("私");
    expect(createDefaultSettings("ko").profile.displayName).toBe("나");
    expect(createDefaultSettings("fr").profile.displayName).toBe("Moi");
    expect(createDefaultSettings("ru").profile.displayName).toBe("Я");
  });

  it("migrates legacy defaults but preserves explicit custom names", () => {
    expect(resolveProfileDisplayName("fr", "Local Host", undefined)).toEqual({
      displayName: "Moi",
      displayNameIsDefault: true,
    });

    expect(resolveProfileDisplayName("ko", "Avery", undefined)).toEqual({
      displayName: "Avery",
      displayNameIsDefault: false,
    });

    expect(resolveProfileDisplayName("ja", "Me", false)).toEqual({
      displayName: "Me",
      displayNameIsDefault: false,
    });
  });
});

describe("graph output locale resolution", () => {
  const baseKnowledgePreferences = {
    autoExtractOnSave: true,
    autoExtractAfterAiTask: true,
    includeAttachmentsAsEvidence: true,
    includeUnresolvedQuestions: true,
    autoGenerateGraphLinks: true,
    defaultView: "hub" as const,
  };

  it("prefers explicit graph language over interface locale", () => {
    expect(resolveGraphOutputLocale("zh-CN", {
      locale: "zh-CN",
      knowledgePreferences: { ...baseKnowledgePreferences, graphOutputLanguage: "ko" },
    })).toBe("ko");

    expect(resolveGraphOutputLocale("en", {
      locale: "en",
      knowledgePreferences: { ...baseKnowledgePreferences, graphOutputLanguage: "ru" },
    })).toBe("ru");
  });

  it("falls back to interface locale and then English", () => {
    expect(resolveGraphOutputLocale("ja", {
      locale: "en",
      knowledgePreferences: { ...baseKnowledgePreferences, graphOutputLanguage: "auto" },
    })).toBe("ja");

    expect(resolveGraphOutputLocale(undefined, {
      locale: "ru",
      knowledgePreferences: { ...baseKnowledgePreferences, graphOutputLanguage: "auto" },
    })).toBe("ru");

    expect(resolveGraphOutputLocale("ko", {
      locale: "en",
      knowledgePreferences: { ...baseKnowledgePreferences, graphOutputLanguage: "auto" },
    })).toBe("ko");

    expect(resolveGraphOutputLocale(undefined, null)).toBe("en");
  });
});

