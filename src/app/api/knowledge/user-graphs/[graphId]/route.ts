export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSettings } from "@/lib/data/repository";
import { canManageUserGraph, deleteUserGraph, getUserGraph, updateUserGraph } from "@/lib/knowledge/user-graphs";
import { isProtectedSampleKnowledgeGraph } from "@/lib/knowledge/types";
import { isLocale } from "@/lib/i18n";
import { AppLocale } from "@/lib/types";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ graphId: string }> },
) {
  const { graphId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "")
    ? (url.searchParams.get("locale") as AppLocale)
    : settings.locale;
  const viewer = {
    identityId: settings.profile.localIdentityId,
    displayName: settings.profile.displayName,
  };
  const graph = await getUserGraph(graphId, viewer, locale);
  if (!graph) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "图谱不存在，或你当前没有访问权限。",
        en: "The graph was not found or you do not have access to it.",
        ja: "グラフが見つからないか、現在のアカウントにはアクセス権がありません。",
        ko: "그래프를 찾을 수 없거나 현재 계정에 접근 권한이 없습니다.",
        fr: "Le graphe est introuvable ou vous n'y avez pas acces.",
        ru: "Граф не найден или у вас нет к нему доступа.",
      }),
    }, { status: 404 });
  }
  return NextResponse.json({ graph });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ graphId: string }> },
) {
  const { graphId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "")
    ? (url.searchParams.get("locale") as AppLocale)
    : settings.locale;
  const viewer = {
    identityId: settings.profile.localIdentityId,
    displayName: settings.profile.displayName,
  };
  const existing = await getUserGraph(graphId, viewer);
  if (!existing || !await canManageUserGraph(existing, viewer)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "图谱不存在，或它不属于你当前的账号。",
        en: "The graph was not found or is not owned by your current account.",
        ja: "グラフが見つからないか、現在のアカウントが所有していません。",
        ko: "그래프를 찾을 수 없거나 현재 계정이 소유한 그래프가 아닙니다.",
        fr: "Le graphe est introuvable ou n'appartient pas a votre compte actuel.",
        ru: "Граф не найден или не принадлежит текущей учётной записи.",
      }),
    }, { status: 404 });
  }

  const body = (await request.json()) as { title?: string; description?: string; visibility?: "private" | "public" };
  const updated = await updateUserGraph(graphId, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
  });

  if (!updated) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "更新图谱失败，请稍后重试。",
        en: "Failed to update the graph. Please try again later.",
        ja: "グラフを更新できませんでした。しばらくしてから再試行してください。",
        ko: "그래프를 업데이트하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        fr: "Impossible de mettre a jour le graphe. Reessayez plus tard.",
        ru: "Не удалось обновить граф. Повторите попытку позже.",
      }),
    }, { status: 500 });
  }
  return NextResponse.json({ graph: updated });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ graphId: string }> },
) {
  const { graphId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "")
    ? (url.searchParams.get("locale") as AppLocale)
    : settings.locale;
  const viewer = {
    identityId: settings.profile.localIdentityId,
    displayName: settings.profile.displayName,
  };
  const graph = await getUserGraph(graphId, viewer);
  if (!graph) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "图谱不存在，或你当前没有访问权限。",
        en: "The graph was not found or you do not have access to it.",
        ja: "グラフが見つからないか、現在のアカウントにはアクセス権がありません。",
        ko: "그래프를 찾을 수 없거나 현재 계정에 접근 권한이 없습니다.",
        fr: "Le graphe est introuvable ou vous n'y avez pas acces.",
        ru: "Граф не найден или у вас нет к нему доступа.",
      }),
    }, { status: 404 });
  }
  if (isProtectedSampleKnowledgeGraph(graph)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "示例图谱受保护，不能删除。",
        en: "Sample graphs are protected and cannot be deleted.",
        ja: "サンプルグラフは保護されているため削除できません。",
        ko: "샘플 그래프는 보호되어 있어 삭제할 수 없습니다.",
        fr: "Les graphes d'exemple sont proteges et ne peuvent pas etre supprimes.",
        ru: "Графы-примеры защищены и не могут быть удалены.",
      }),
    }, { status: 403 });
  }
  if (!await canManageUserGraph(graph, viewer)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "只能删除你自己创建的图谱。",
        en: "You can only delete graphs that you created.",
        ja: "削除できるのは自分で作成したグラフだけです。",
        ko: "직접 생성한 그래프만 삭제할 수 있습니다.",
        fr: "Vous ne pouvez supprimer que les graphes que vous avez crees.",
        ru: "Удалять можно только те графы, которые создали вы сами.",
      }),
    }, { status: 403 });
  }
  const ok = await deleteUserGraph(graphId, viewer);
  if (!ok) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "删除图谱失败，请重试。",
        en: "Failed to delete the graph. Please retry.",
        ja: "グラフを削除できませんでした。再試行してください。",
        ko: "그래프를 삭제하지 못했습니다. 다시 시도해 주세요.",
        fr: "Impossible de supprimer le graphe. Reessayez.",
        ru: "Не удалось удалить граф. Повторите попытку.",
      }),
    }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
