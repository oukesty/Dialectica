export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProject, getSettings } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import { deleteKnowledgeNode, findKnowledgeNodeMutationTarget, getKnowledgeNodeDetail, updateKnowledgeNode } from "@/lib/knowledge/service";
import { getProjectAccessState } from "@/lib/project-access";
import { AppLocale } from "@/lib/types";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function resolveNodeId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function authorizeNodeMutation(nodeId: string, locale: AppLocale) {
  const settings = await getSettings();
  const target = await findKnowledgeNodeMutationTarget(nodeId, locale);
  if (!target) {
    return {
      response: NextResponse.json({ error: localize(locale, {
        "zh-CN": "知识节点不存在。",
        en: "Knowledge node not found.",
        ja: "知識ノードが見つかりません。",
        fr: "Noeud de connaissance introuvable.",
      }) }, { status: 404 }),
    };
  }

  let project;
  try {
    project = await getProject(target.projectId, target.locale);
  } catch {
    return {
      response: NextResponse.json({ error: localize(locale, {
        "zh-CN": "知识节点所属项目不存在。",
        en: "The source project for this knowledge node was not found.",
        ja: "この知識ノードの元プロジェクトが見つかりません。",
        fr: "Le projet source de ce nœud de connaissance est introuvable.",
      }) }, { status: 404 }),
    };
  }

  const access = getProjectAccessState(project, settings);
  if (target.isProtectedSample || access.isProtectedSample || !access.canEditWorkspace) {
    return {
      response: NextResponse.json({ error: localize(project.language, {
        "zh-CN": "当前身份无权修改这个项目的知识节点。",
        en: "Your current local profile cannot modify knowledge nodes for this project.",
        ja: "現在のローカルプロフィールでは、このプロジェクトの知識ノードを変更できません。",
        ko: "현재 로컬 프로필로는 이 프로젝트의 지식 노드를 수정할 수 없습니다.",
        fr: "Votre profil local actuel ne peut pas modifier les nœuds de connaissance de ce projet.",
        ru: "Текущий локальный профиль не может изменять узлы знаний этого проекта.",
      }) }, { status: 403 }),
    };
  }

  return { target };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ nodeId: string }> },
) {
  const { nodeId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as AppLocale) : settings.locale;
  const detail = await getKnowledgeNodeDetail(resolveNodeId(nodeId), locale);
  if (!detail) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "知识节点不存在。",
        en: "Knowledge node not found.",
        ja: "知識ノードが見つかりません。",
        fr: "Nœud de connaissance introuvable.",
      }),
    }, { status: 404 });
  }
  return NextResponse.json({ detail });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ nodeId: string }> },
) {
  const { nodeId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as AppLocale) : settings.locale;
  const body = (await request.json()) as { title?: string; summary?: string; type?: string };
  const authorization = await authorizeNodeMutation(resolveNodeId(nodeId), locale);
  if ("response" in authorization) return authorization.response;
  const ok = await updateKnowledgeNode(authorization.target.nodeId, authorization.target.locale, body);
  if (!ok) {
    return NextResponse.json({ error: localize(locale, {
      "zh-CN": "知识节点不存在。", en: "Knowledge node not found.",
      ja: "知識ノードが見つかりません。", fr: "Noeud de connaissance introuvable.",
    }) }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ nodeId: string }> },
) {
  const { nodeId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as AppLocale) : settings.locale;
  const authorization = await authorizeNodeMutation(resolveNodeId(nodeId), locale);
  if ("response" in authorization) return authorization.response;
  const ok = await deleteKnowledgeNode(authorization.target.nodeId, authorization.target.locale);
  if (!ok) {
    return NextResponse.json({ error: localize(locale, {
      "zh-CN": "知识节点不存在。", en: "Knowledge node not found.",
      ja: "知識ノードが見つかりません。", fr: "Noeud de connaissance introuvable.",
    }) }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
