import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@/lib/atomic-file";
import { APP_LOCALES } from "@/lib/types";
import type { AppLocale, DiscussionProject } from "@/lib/types";
import { createId, sanitizeOptionalText } from "@/lib/utils";

export type ProjectTemplateVisibility = "private" | "shared";

export type ProjectTemplatePayload = {
  title: string;
  description: string;
  goal: string;
  scenario: Exclude<DiscussionProject["scenario"], "ai-dialogue">;
  tags: string[];
  room: {
    title: string;
    goal: string;
    visibility: DiscussionProject["room"]["visibility"];
    joinMode?: DiscussionProject["room"]["joinMode"];
    automationMode?: NonNullable<DiscussionProject["room"]["aiAutomation"]>["mode"];
  };
};

export type BuiltinProjectTemplate = {
  id: string;
  title: string;
  description: string;
  goal: string;
  payload: ProjectTemplatePayload;
};

export type UserProjectTemplate = {
  id: string;
  ownerIdentityId: string;
  ownerDisplayName: string;
  visibility: ProjectTemplateVisibility;
  title: string;
  description: string;
  payload: ProjectTemplatePayload;
  createdAt: string;
  updatedAt: string;
};

const templateFile = path.join(process.cwd(), "data", "project-templates.json");

const TEMPLATE_IDS = [
  "blank",
  "ai-workbench",
  "discussion-brief",
  "research-notes",
  "product-review",
  "decision-analysis",
  "meeting-actions",
  "graph-exploration",
] as const;

type TemplateId = (typeof TEMPLATE_IDS)[number];

const builtinText: Record<AppLocale, Record<TemplateId, { title: string; description: string; goal: string }>> = {
  "zh-CN": {
    blank: { title: "空白项目", description: "从干净结构开始，自行补充目标、讨论和材料。", goal: "从空白结构开始整理一个新项目。" },
    "ai-workbench": { title: "AI 对话工作台", description: "为单人 AI 对话、问题拆解和后续整理准备轻量结构。", goal: "围绕一个开放问题进行 AI 对话与思路沉淀。" },
    "discussion-brief": { title: "项目讨论整理", description: "整理目标、分歧、证据、结论和下一步。", goal: "把项目讨论沉淀为清晰结论和行动项。" },
    "research-notes": { title: "研究资料整理", description: "汇总资料线索、证据、未解问题和引用方向。", goal: "把研究材料整理成可复用的知识线索。" },
    "product-review": { title: "产品/功能评审", description: "记录需求、用户反馈、风险、取舍和改进项。", goal: "评审产品或功能方案并形成可执行建议。" },
    "decision-analysis": { title: "决策分析", description: "比较选项、条件、风险、收益和判断依据。", goal: "围绕一个决策形成结构化判断。" },
    "meeting-actions": { title: "会议纪要与行动项", description: "记录议题、结论、责任人和待跟进事项。", goal: "把会议内容整理成纪要和行动清单。" },
    "graph-exploration": { title: "知识图谱探索", description: "为概念、证据、问题和关系预留清晰结构。", goal: "围绕主题整理可进入知识图谱的关键内容。" },
  },
  en: {
    blank: { title: "Blank project", description: "Start from a clean structure and add goals, discussion, and material yourself.", goal: "Start a new project from a clean structure." },
    "ai-workbench": { title: "AI chat workspace", description: "A light structure for one-person AI dialogue, question framing, and follow-up notes.", goal: "Explore an open question through AI dialogue and reusable notes." },
    "discussion-brief": { title: "Project discussion brief", description: "Organize goals, disagreements, evidence, conclusions, and next steps.", goal: "Turn a project discussion into clear conclusions and actions." },
    "research-notes": { title: "Research notes", description: "Collect source leads, evidence, open questions, and citation directions.", goal: "Organize research material into reusable knowledge leads." },
    "product-review": { title: "Product / feature review", description: "Capture requirements, feedback, risks, trade-offs, and improvements.", goal: "Review a product or feature plan and produce actionable recommendations." },
    "decision-analysis": { title: "Decision analysis", description: "Compare options, conditions, risks, benefits, and evidence.", goal: "Build a structured judgment around a decision." },
    "meeting-actions": { title: "Meeting notes and actions", description: "Track agenda, decisions, owners, and follow-ups.", goal: "Turn meeting content into notes and action items." },
    "graph-exploration": { title: "Knowledge graph exploration", description: "Reserve structure for concepts, evidence, questions, and relationships.", goal: "Organize key content that can later enter a knowledge graph." },
  },
  ja: {
    blank: { title: "空白プロジェクト", description: "まっさらな構造から、目的・議論・資料を自分で追加します。", goal: "空白構造から新しいプロジェクトを整理する。" },
    "ai-workbench": { title: "AI 対話ワークスペース", description: "一人での AI 対話、問いの整理、後続メモ向けの軽い構造です。", goal: "開いた問いを AI 対話で掘り下げ、思考を残す。" },
    "discussion-brief": { title: "プロジェクト議論整理", description: "目的、相違点、証拠、結論、次の一手を整理します。", goal: "プロジェクト議論を明確な結論と行動に変える。" },
    "research-notes": { title: "研究資料整理", description: "資料の手がかり、証拠、未解決点、引用方向をまとめます。", goal: "研究材料を再利用しやすい知識の手がかりに整理する。" },
    "product-review": { title: "製品 / 機能レビュー", description: "要件、フィードバック、リスク、判断、改善点を記録します。", goal: "製品または機能案を評価し、実行可能な提案にする。" },
    "decision-analysis": { title: "意思決定分析", description: "選択肢、条件、リスク、利益、根拠を比較します。", goal: "一つの判断に向けて構造化された検討を作る。" },
    "meeting-actions": { title: "議事録とアクション", description: "議題、決定、担当者、フォローアップを記録します。", goal: "会議内容を議事録と行動項目に整理する。" },
    "graph-exploration": { title: "知識グラフ探索", description: "概念、証拠、問い、関係を整理するための構造です。", goal: "知識グラフ化しやすい重要内容を整理する。" },
  },
  ko: {
    blank: { title: "빈 프로젝트", description: "깨끗한 구조에서 목표, 토론, 자료를 직접 채웁니다.", goal: "새 프로젝트를 빈 구조에서 정리합니다." },
    "ai-workbench": { title: "AI 대화 작업공간", description: "개인 AI 대화, 질문 정리, 후속 메모를 위한 가벼운 구조입니다.", goal: "열린 질문을 AI 대화로 탐색하고 생각을 남깁니다." },
    "discussion-brief": { title: "프로젝트 토론 정리", description: "목표, 이견, 증거, 결론, 다음 단계를 정리합니다.", goal: "프로젝트 토론을 명확한 결론과 행동으로 정리합니다." },
    "research-notes": { title: "연구 자료 정리", description: "자료 단서, 증거, 미해결 질문, 인용 방향을 모읍니다.", goal: "연구 자료를 재사용 가능한 지식 단서로 정리합니다." },
    "product-review": { title: "제품 / 기능 리뷰", description: "요구사항, 피드백, 위험, 절충, 개선점을 기록합니다.", goal: "제품 또는 기능안을 검토하고 실행 가능한 제안을 만듭니다." },
    "decision-analysis": { title: "의사결정 분석", description: "선택지, 조건, 위험, 이점, 근거를 비교합니다.", goal: "하나의 결정을 위한 구조화된 판단을 만듭니다." },
    "meeting-actions": { title: "회의록과 액션", description: "안건, 결정, 담당자, 후속 조치를 기록합니다.", goal: "회의 내용을 회의록과 행동 항목으로 정리합니다." },
    "graph-exploration": { title: "지식 그래프 탐색", description: "개념, 증거, 질문, 관계를 정리할 구조를 준비합니다.", goal: "지식 그래프로 확장할 핵심 내용을 정리합니다." },
  },
  fr: {
    blank: { title: "Projet vide", description: "Partez d'une structure propre et ajoutez objectifs, discussion et matériaux.", goal: "Démarrer un nouveau projet depuis une structure vide." },
    "ai-workbench": { title: "Espace de chat IA", description: "Structure légère pour dialogue IA individuel, cadrage des questions et notes.", goal: "Explorer une question ouverte par dialogue IA et notes réutilisables." },
    "discussion-brief": { title: "Synthèse de discussion", description: "Organisez objectifs, désaccords, preuves, conclusions et suites.", goal: "Transformer une discussion de projet en conclusions et actions claires." },
    "research-notes": { title: "Notes de recherche", description: "Rassemblez pistes, preuves, questions ouvertes et directions de citation.", goal: "Organiser les matériaux de recherche en pistes de connaissance réutilisables." },
    "product-review": { title: "Revue produit / fonction", description: "Capturez besoins, retours, risques, arbitrages et améliorations.", goal: "Évaluer un produit ou une fonction et produire des recommandations actionnables." },
    "decision-analysis": { title: "Analyse de décision", description: "Comparez options, conditions, risques, bénéfices et preuves.", goal: "Construire un jugement structuré autour d'une décision." },
    "meeting-actions": { title: "Notes et actions", description: "Suivez ordre du jour, décisions, responsables et suites.", goal: "Transformer une réunion en notes et actions." },
    "graph-exploration": { title: "Exploration graphe", description: "Préparez concepts, preuves, questions et relations.", goal: "Organiser les éléments clés qui pourront entrer dans un graphe." },
  },
  ru: {
    blank: { title: "Пустой проект", description: "Начните с чистой структуры и добавьте цель, обсуждение и материалы.", goal: "Начать новый проект с чистой структуры." },
    "ai-workbench": { title: "AI-чат", description: "Легкая структура для личного AI-диалога, вопросов и заметок.", goal: "Исследовать открытый вопрос через AI-диалог и заметки." },
    "discussion-brief": { title: "Сводка обсуждения", description: "Упорядочьте цели, разногласия, доказательства, выводы и шаги.", goal: "Превратить обсуждение проекта в ясные выводы и действия." },
    "research-notes": { title: "Исследовательские заметки", description: "Соберите источники, доказательства, вопросы и направления цитирования.", goal: "Организовать материалы исследования в повторно используемые знания." },
    "product-review": { title: "Обзор продукта / функции", description: "Зафиксируйте требования, отзывы, риски, компромиссы и улучшения.", goal: "Оценить продукт или функцию и получить практические рекомендации." },
    "decision-analysis": { title: "Анализ решения", description: "Сравните варианты, условия, риски, пользу и доказательства.", goal: "Сформировать структурированное суждение для решения." },
    "meeting-actions": { title: "Заметки и действия", description: "Отследите повестку, решения, ответственных и дальнейшие шаги.", goal: "Превратить встречу в заметки и список действий." },
    "graph-exploration": { title: "Исследование графа", description: "Подготовьте структуру для понятий, доказательств, вопросов и связей.", goal: "Организовать ключевой материал для будущего графа знаний." },
  },
};

const templateScenarios: Record<TemplateId, ProjectTemplatePayload["scenario"]> = {
  blank: "discussion",
  "ai-workbench": "discussion",
  "discussion-brief": "discussion",
  "research-notes": "document-driven-discussion",
  "product-review": "discussion",
  "decision-analysis": "negotiation",
  "meeting-actions": "meeting",
  "graph-exploration": "document-driven-discussion",
};

function normalizeTemplateScenario(value: unknown): ProjectTemplatePayload["scenario"] {
  return value === "debate" || value === "discussion" || value === "meeting" || value === "negotiation" || value === "document-driven-discussion"
    ? value
    : "discussion";
}

function normalizeVisibility(value: unknown): ProjectTemplateVisibility {
  return value === "shared" ? "shared" : "private";
}

function sanitizeTemplatePayload(raw: unknown): ProjectTemplatePayload {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const room = input.room && typeof input.room === "object" ? input.room as Record<string, unknown> : {};
  const goal = sanitizeOptionalText(typeof input.goal === "string" ? input.goal : undefined, 600) || "";
  const title = sanitizeOptionalText(typeof input.title === "string" ? input.title : undefined, 160) || "";
  return {
    title,
    description: sanitizeOptionalText(typeof input.description === "string" ? input.description : undefined, 800) || "",
    goal,
    scenario: normalizeTemplateScenario(input.scenario),
    tags: (Array.isArray(input.tags) ? input.tags : [])
      .map((tag) => sanitizeOptionalText(typeof tag === "string" ? tag : undefined, 40))
      .filter((tag): tag is string => Boolean(tag))
      .slice(0, 16),
    room: {
      title: sanitizeOptionalText(typeof room.title === "string" ? room.title : undefined, 160) || title,
      goal: sanitizeOptionalText(typeof room.goal === "string" ? room.goal : undefined, 600) || goal,
      visibility: room.visibility === "public" || room.visibility === "invite" ? room.visibility : "private",
      joinMode: room.joinMode === "approval" ? "approval" : "open",
      automationMode: room.automationMode === "assistive" || room.automationMode === "basic" || room.automationMode === "auto" || room.automationMode === "manual" ? room.automationMode : "off",
    },
  };
}

export function getBuiltinStarterTemplates(locale: AppLocale): BuiltinProjectTemplate[] {
  const text = builtinText[locale] ?? builtinText.en;
  return TEMPLATE_IDS.map((id) => {
    const copy = text[id];
    const payload = sanitizeTemplatePayload({
      title: copy.title,
      description: copy.description,
      goal: copy.goal,
      scenario: templateScenarios[id],
      tags: [],
      room: {
        title: copy.title,
        goal: copy.goal,
        visibility: "private",
        joinMode: "open",
        automationMode: "off",
      },
    });
    return { id, ...copy, payload };
  });
}

export function projectToTemplatePayload(project: DiscussionProject): ProjectTemplatePayload {
  return sanitizeTemplatePayload({
    title: project.title,
    description: project.description,
    goal: project.goal,
    scenario: project.scenario,
    tags: project.tags,
    room: {
      title: project.room.session.title,
      goal: project.room.session.goal,
      visibility: project.room.visibility,
      joinMode: project.room.joinMode,
      automationMode: project.room.aiAutomation?.mode ?? "off",
    },
  });
}

export function applyProjectTemplatePayload(project: DiscussionProject, payload: ProjectTemplatePayload): DiscussionProject {
  const clean = sanitizeTemplatePayload(payload);
  return {
    ...project,
    title: clean.title || project.title,
    description: clean.description,
    goal: clean.goal,
    scenario: clean.scenario,
    tags: clean.tags,
    room: {
      ...project.room,
      visibility: clean.room.visibility,
      joinMode: clean.room.joinMode,
      session: {
        ...project.room.session,
        title: clean.room.title || clean.title || project.room.session.title,
        goal: clean.room.goal || clean.goal,
      },
      aiAutomation: {
        ...project.room.aiAutomation,
        mode: clean.room.automationMode ?? "off",
        summaryLastProcessedEntryCount: 0,
      },
    },
  };
}

async function readTemplateStore(): Promise<UserProjectTemplate[]> {
  try {
    const raw = await readFile(templateFile, "utf-8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.templates) ? parsed.templates : [];
    const seen = new Set<string>();
    return list.flatMap((item: unknown, index: number) => {
      const input = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const id = sanitizeOptionalText(typeof input.id === "string" ? input.id : undefined, 100) || createId("template");
      if (seen.has(id)) return [];
      seen.add(id);
      const ownerIdentityId = sanitizeOptionalText(typeof input.ownerIdentityId === "string" ? input.ownerIdentityId : undefined, 120);
      if (!ownerIdentityId) return [];
      const title = sanitizeOptionalText(typeof input.title === "string" ? input.title : undefined, 160) || `Template ${index + 1}`;
      const createdAt = sanitizeOptionalText(typeof input.createdAt === "string" ? input.createdAt : undefined, 80) || new Date().toISOString();
      return [{
        id,
        ownerIdentityId,
        ownerDisplayName: sanitizeOptionalText(typeof input.ownerDisplayName === "string" ? input.ownerDisplayName : undefined, 120) || "",
        visibility: normalizeVisibility(input.visibility),
        title,
        description: sanitizeOptionalText(typeof input.description === "string" ? input.description : undefined, 800) || "",
        payload: sanitizeTemplatePayload(input.payload),
        createdAt,
        updatedAt: sanitizeOptionalText(typeof input.updatedAt === "string" ? input.updatedAt : undefined, 80) || createdAt,
      } satisfies UserProjectTemplate];
    }).slice(0, 200);
  } catch {
    return [];
  }
}

async function writeTemplateStore(templates: UserProjectTemplate[]) {
  await mkdir(path.dirname(templateFile), { recursive: true });
  await writeFileAtomic(templateFile, `${JSON.stringify({ templates }, null, 2)}\n`, "utf-8");
}

export async function listVisibleProjectTemplates(identityId: string): Promise<UserProjectTemplate[]> {
  const currentIdentityId = sanitizeOptionalText(identityId, 120) || "";
  const templates = await readTemplateStore();
  return templates
    .filter((template) => template.visibility === "shared" || template.ownerIdentityId === currentIdentityId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveProjectTemplate(input: {
  ownerIdentityId: string;
  ownerDisplayName: string;
  title: string;
  description: string;
  visibility: ProjectTemplateVisibility;
  payload: ProjectTemplatePayload;
}) {
  const ownerIdentityId = sanitizeOptionalText(input.ownerIdentityId, 120);
  if (!ownerIdentityId) throw new Error("missing-owner");
  const now = new Date().toISOString();
  const template: UserProjectTemplate = {
    id: createId("template"),
    ownerIdentityId,
    ownerDisplayName: sanitizeOptionalText(input.ownerDisplayName, 120) || "",
    visibility: normalizeVisibility(input.visibility),
    title: sanitizeOptionalText(input.title, 160) || "Untitled template",
    description: sanitizeOptionalText(input.description, 800) || "",
    payload: sanitizeTemplatePayload(input.payload),
    createdAt: now,
    updatedAt: now,
  };
  const templates = await readTemplateStore();
  await writeTemplateStore([template, ...templates].slice(0, 200));
  return template;
}

export async function updateProjectTemplate(identityId: string, templateId: string, patch: Partial<Pick<UserProjectTemplate, "title" | "description" | "visibility">>) {
  const templates = await readTemplateStore();
  const index = templates.findIndex((template) => template.id === templateId);
  if (index === -1) return null;
  if (templates[index].ownerIdentityId !== identityId) throw new Error("forbidden");
  const next = {
    ...templates[index],
    title: sanitizeOptionalText(patch.title, 160) || templates[index].title,
    description: typeof patch.description === "string" ? sanitizeOptionalText(patch.description, 800) || "" : templates[index].description,
    visibility: patch.visibility ? normalizeVisibility(patch.visibility) : templates[index].visibility,
    updatedAt: new Date().toISOString(),
  };
  templates[index] = next;
  await writeTemplateStore(templates);
  return next;
}

export async function deleteProjectTemplate(identityId: string, templateId: string) {
  const templates = await readTemplateStore();
  const target = templates.find((template) => template.id === templateId);
  if (!target) return false;
  if (target.ownerIdentityId !== identityId) throw new Error("forbidden");
  await writeTemplateStore(templates.filter((template) => template.id !== templateId));
  return true;
}

export function assertBuiltinTemplateLocalesComplete() {
  for (const locale of APP_LOCALES) {
    for (const id of TEMPLATE_IDS) {
      const item = builtinText[locale]?.[id];
      if (!item?.title || !item.description || !item.goal) {
        throw new Error(`Missing starter template copy: ${locale}.${id}`);
      }
    }
  }
  return true;
}
