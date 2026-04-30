export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { bundledSampleProjectIds } from "@/data/samples";
import { getProject, getSettings } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import {
  canManageUserGraph,
  createUserGraph,
  deleteUserGraph,
  generateUserGraphContent,
  getUserGraph,
  listUserGraphs,
  resolveGraphOutputLocale,
} from "@/lib/knowledge/user-graphs";
import { isProtectedSampleKnowledgeGraph } from "@/lib/knowledge/types";
import { appendNotification } from "@/lib/notifications";
import { getProjectAccessState } from "@/lib/project-access";
import { AppLocale } from "@/lib/types";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional().default(""),
  sourceProjectIds: z.array(z.string()).min(1).max(20),
  graphMode: z.enum(["2d", "3d", "both"]).optional(),
  visibility: z.enum(["private", "public"]).optional().default("private"),
  locale: z.string().optional(),
});

const bulkDeleteSchema = z.object({
  action: z.enum(["delete-versions", "keep-latest"]),
  graphIds: z.array(z.string().min(1).max(120)).min(1).max(100),
  keepGraphId: z.string().min(1).max(120).optional(),
});

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function GET(request: Request) {
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "")
    ? (url.searchParams.get("locale") as AppLocale)
    : settings.locale;
  const graphs = await listUserGraphs({
    identityId: settings.profile.localIdentityId,
    displayName: settings.profile.displayName,
  }, locale);
  return NextResponse.json({ graphs });
}

export async function POST(request: Request) {
  const settings = await getSettings();
  const rawBody = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(rawBody);

  if (!parsed.success) {
    const rawLocale = typeof rawBody === "object" && rawBody !== null && "locale" in rawBody
      ? String((rawBody as { locale?: unknown }).locale ?? "")
      : "";
    const interfaceLocale: AppLocale = isLocale(rawLocale)
      ? rawLocale
      : settings.locale;
    return NextResponse.json({
      error: localize(interfaceLocale, {
        "zh-CN": "图谱创建请求无效，请检查标题、来源项目和语言设置后重试。",
        en: "The graph creation request is invalid. Check the title, source projects, and language setting, then try again.",
        ja: "グラフ作成リクエストが無効です。タイトル、ソースプロジェクト、言語設定を確認して再試行してください。",
        ko: "그래프 생성 요청이 올바르지 않습니다. 제목, 원본 프로젝트, 언어 설정을 확인한 뒤 다시 시도하세요.",
        fr: "La requete de creation du graphe est invalide. Verifiez le titre, les projets sources et la langue, puis reessayez.",
        ru: "Запрос на создание графа недействителен. Проверьте название, исходные проекты и язык, затем повторите попытку.",
      }),
      issues: parsed.error.issues,
    }, { status: 400 });
  }

  const { title, description, sourceProjectIds, visibility } = parsed.data;
  const graphMode = parsed.data.graphMode ?? settings.knowledgePreferences.defaultGraphMode ?? "both";
  const interfaceLocale: AppLocale = isLocale(parsed.data.locale ?? "") ? (parsed.data.locale as AppLocale) : settings.locale;
  const graphLocale = resolveGraphOutputLocale(interfaceLocale, settings);

  const projectTitles: string[] = [];
  for (const projectId of sourceProjectIds) {
    let project;
    try {
      project = await getProject(projectId, graphLocale);
    } catch {
      return NextResponse.json({
        error: localize(interfaceLocale, {
          "zh-CN": `找不到来源项目「${projectId}」，无法创建知识图谱。`,
          en: `Source project "${projectId}" was not found, so the graph cannot be created.`,
          ja: `ソースプロジェクト「${projectId}」が見つからないため、グラフを作成できません。`,
          ko: `소스 프로젝트 "${projectId}"를 찾을 수 없어 그래프를 만들 수 없습니다.`,
          fr: `Le projet source « ${projectId} » est introuvable ; le graphe ne peut pas etre cree.`,
          ru: `Исходный проект "${projectId}" не найден, поэтому граф нельзя создать.`,
        }),
      }, { status: 404 });
    }
    if (project.metadata.isSample || bundledSampleProjectIds.has(projectId)) {
      return NextResponse.json({
        error: localize(interfaceLocale, {
          "zh-CN": `示例项目「${project.title}」不能生成知识图谱。请基于你自己的项目创建图谱。`,
          en: `Sample project "${project.title}" cannot generate a knowledge graph. Create one from your own project instead.`,
          ja: `サンプルプロジェクト「${project.title}」から知識グラフは生成できません。自分のプロジェクトから作成してください。`,
          ko: `샘플 프로젝트 "${project.title}"에서는 지식 그래프를 생성할 수 없습니다. 직접 만든 프로젝트에서 그래프를 만들어 주세요.`,
          fr: `Le projet d'exemple « ${project.title} » ne peut pas generer de graphe. Utilisez plutot votre propre projet.`,
          ru: `Для примера "${project.title}" нельзя создать граф знаний. Создайте граф на основе собственного проекта.`,
        }),
      }, { status: 409 });
    }

    const access = getProjectAccessState(project, settings);
    if (!access.canRead || !access.canRunAiTasks) {
      return NextResponse.json({
        error: localize(interfaceLocale, {
          "zh-CN": `当前身份无权基于「${project.title}」生成知识图谱。`,
          en: `Your current local profile cannot generate a knowledge graph from "${project.title}".`,
          ja: `現在のローカルプロフィールでは「${project.title}」から知識グラフを生成できません。`,
          ko: `현재 로컬 프로필로는 "${project.title}"에서 지식 그래프를 생성할 수 없습니다.`,
          fr: `Votre profil local actuel ne peut pas generer de graphe depuis « ${project.title} ».`,
          ru: `Текущий локальный профиль не может создать граф знаний из "${project.title}".`,
        }),
      }, { status: 403 });
    }

    projectTitles.push(project.title);
  }

  const graph = await createUserGraph({
    ownerIdentityId: settings.profile.localIdentityId,
    ownerDisplayName: settings.profile.displayName,
    title,
    description,
    sourceProjectIds,
    sourceProjectTitles: projectTitles,
    locale: graphLocale,
    graphMode,
    visibility,
  });

  void appendNotification(settings.profile.localIdentityId, {
    type: "ai_summary",
    title: interfaceLocale === "zh-CN" ? "图谱正在生成中" : interfaceLocale === "ja" ? "グラフを生成中" : interfaceLocale === "ko" ? "그래프 생성 중" : interfaceLocale === "fr" ? "Generation du graphe en cours" : interfaceLocale === "ru" ? "Граф создаётся" : "Graph generation in progress",
    body: interfaceLocale === "zh-CN"
      ? `知识图谱「${title}」已加入生成队列，完成后会自动更新。`
      : interfaceLocale === "ja"
        ? `知識グラフ「${title}」の生成を開始しました。完了後に自動で更新されます。`
        : interfaceLocale === "ko"
          ? `지식 그래프 "${title}" 생성이 시작되었습니다. 완료되면 자동으로 갱신됩니다.`
        : interfaceLocale === "fr"
          ? `Le graphe de connaissances « ${title} » est en cours de generation. Il se mettra a jour automatiquement une fois pret.`
          : interfaceLocale === "ru"
            ? `Граф знаний "${title}" поставлен в очередь на создание и обновится автоматически после завершения.`
            : `Knowledge graph "${title}" is being generated and will update automatically once ready.`,
    href: `/${interfaceLocale}/knowledge/graph?graphId=${graph.id}&projectIds=${sourceProjectIds.join(",")}${sourceProjectIds.length === 1 ? `&projectId=${sourceProjectIds[0]}&scopeMode=project` : "&scopeMode=cross-project"}`,
  });

  // Fire-and-forget: generate graph content in background.
  void generateUserGraphContent(graph.id, graphLocale, settings).then((result) => {
    if (result) {
      void appendNotification(settings.profile.localIdentityId, {
        type: "ai_summary",
        title: interfaceLocale === "zh-CN" ? "图谱生成完成" : interfaceLocale === "ja" ? "グラフ生成完了" : interfaceLocale === "ko" ? "그래프 생성 완료" : interfaceLocale === "fr" ? "Graphe genere" : interfaceLocale === "ru" ? "Граф создан" : "Graph generated",
        body: interfaceLocale === "zh-CN"
          ? `知识图谱「${title}」已生成完成：${result.stats.nodeCount} 个节点，${result.stats.relationCount} 条关系。`
          : interfaceLocale === "ja"
            ? `知識グラフ「${title}」が完成しました：${result.stats.nodeCount} ノード、${result.stats.relationCount} 関係。`
            : interfaceLocale === "ko"
              ? `지식 그래프 "${title}" 생성이 완료되었습니다: 노드 ${result.stats.nodeCount}개, 관계 ${result.stats.relationCount}개.`
            : interfaceLocale === "fr"
              ? `Le graphe de connaissances « ${title} » est pret : ${result.stats.nodeCount} noeuds, ${result.stats.relationCount} relations.`
            : interfaceLocale === "ru"
              ? `Граф знаний "${title}" готов: ${result.stats.nodeCount} узлов, ${result.stats.relationCount} связей.`
              : `Knowledge graph "${title}" is ready: ${result.stats.nodeCount} nodes, ${result.stats.relationCount} relations.`,
        href: `/${interfaceLocale}/knowledge/graph?graphId=${graph.id}&projectIds=${sourceProjectIds.join(",")}${sourceProjectIds.length === 1 ? `&projectId=${sourceProjectIds[0]}&scopeMode=project` : "&scopeMode=cross-project"}`,
      });
    }
  });

  return NextResponse.json({ graph }, { status: 201 });
}

export async function DELETE(request: Request) {
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "")
    ? (url.searchParams.get("locale") as AppLocale)
    : settings.locale;
  const parsed = bulkDeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "图谱批量删除请求无效，请刷新后重试。",
        en: "The graph bulk-delete request is invalid. Refresh and try again.",
        ja: "グラフの一括削除リクエストが無効です。更新して再試行してください。",
        ko: "그래프 일괄 삭제 요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요.",
        fr: "La requete de suppression groupée du graphe est invalide. Actualisez puis reessayez.",
        ru: "Запрос на массовое удаление графов недействителен. Обновите страницу и повторите попытку.",
      }),
      issues: parsed.error.issues,
    }, { status: 400 });
  }

  const viewer = {
    identityId: settings.profile.localIdentityId,
    displayName: settings.profile.displayName,
  };
  const uniqueGraphIds = Array.from(new Set(parsed.data.graphIds));
  const deleteIds = parsed.data.action === "keep-latest"
    ? uniqueGraphIds.filter((graphId) => graphId !== parsed.data.keepGraphId)
    : uniqueGraphIds;

  if (parsed.data.action === "keep-latest" && (!parsed.data.keepGraphId || deleteIds.length === 0)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "只保留最新版本请求缺少要保留的图谱版本。",
        en: "The keep-latest request is missing the graph version to keep.",
        ja: "最新のみ保持するリクエストに、保持するグラフバージョンがありません。",
        ko: "최신 버전만 남기는 요청에 보존할 그래프 버전이 없습니다.",
        fr: "La requete « conserver le plus recent » ne precise pas la version de graphe a garder.",
        ru: "В запросе «оставить только последнюю» не указана версия графа, которую нужно сохранить.",
      }),
    }, { status: 400 });
  }

  const graphs = [];
  for (const graphId of uniqueGraphIds) {
    const graph = await getUserGraph(graphId, viewer, locale);
    if (!graph) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "某个图谱版本不存在，或你当前没有访问权限。未删除任何版本。",
          en: "One graph version was not found or is not accessible. No versions were deleted.",
          ja: "一部のグラフバージョンが見つからないかアクセスできません。どのバージョンも削除されていません。",
          ko: "일부 그래프 버전을 찾을 수 없거나 접근할 수 없습니다. 어떤 버전도 삭제하지 않았습니다.",
          fr: "Une version du graphe est introuvable ou inaccessible. Aucune version n'a ete supprimee.",
          ru: "Одна из версий графа не найдена или недоступна. Ни одна версия не была удалена.",
        }),
      }, { status: 404 });
    }
    if (isProtectedSampleKnowledgeGraph(graph)) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "示例图谱受保护，不能参与批量删除。",
          en: "Sample graphs are protected and cannot be included in bulk deletion.",
          ja: "サンプルグラフは保護されているため、一括削除には含められません。",
          ko: "샘플 그래프는 보호되어 있어 일괄 삭제에 포함할 수 없습니다.",
          fr: "Les graphes d'exemple sont proteges et ne peuvent pas etre inclus dans une suppression groupée.",
          ru: "Графы-примеры защищены и не могут участвовать в массовом удалении.",
        }),
      }, { status: 403 });
    }
    if (!await canManageUserGraph(graph, viewer)) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "只能批量删除你自己创建的图谱版本。未删除任何版本。",
          en: "You can only bulk-delete graph versions you created. No versions were deleted.",
          ja: "一括削除できるのは自分で作成したグラフバージョンだけです。どのバージョンも削除されていません。",
          ko: "직접 생성한 그래프 버전만 일괄 삭제할 수 있습니다. 어떤 버전도 삭제하지 않았습니다.",
          fr: "Vous ne pouvez supprimer en lot que les versions de graphe que vous avez creees. Aucune version n'a ete supprimee.",
          ru: "Массово удалять можно только созданные вами версии графа. Ни одна версия не была удалена.",
        }),
      }, { status: 403 });
    }
    graphs.push(graph);
  }

  const deletedIds: string[] = [];
  for (const graphId of deleteIds) {
    const ok = await deleteUserGraph(graphId, viewer);
    if (!ok) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "批量删除图谱时失败。请刷新列表后重试。",
          en: "Bulk graph deletion failed. Refresh the list and try again.",
          ja: "グラフの一括削除に失敗しました。リストを更新して再試行してください。",
          ko: "그래프 일괄 삭제에 실패했습니다. 목록을 새로고침한 뒤 다시 시도하세요.",
          fr: "La suppression groupée du graphe a echoue. Actualisez la liste puis reessayez.",
          ru: "Массовое удаление графов не удалось. Обновите список и повторите попытку.",
        }),
        deletedIds,
      }, { status: 500 });
    }
    deletedIds.push(graphId);
  }

  return NextResponse.json({
    ok: true,
    action: parsed.data.action,
    deletedIds,
    keptGraphId: parsed.data.action === "keep-latest" ? parsed.data.keepGraphId : undefined,
    checkedCount: graphs.length,
  });
}
