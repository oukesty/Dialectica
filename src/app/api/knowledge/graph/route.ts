export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSettings } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import { buildKnowledgeGraph } from "@/lib/knowledge/service";
import { KNOWLEDGE_CATEGORIES, KnowledgeCategory } from "@/lib/knowledge/types";

function parseProjectIds(value?: string | null) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean);
}

export async function GET(request: Request) {
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as typeof settings.locale) : settings.locale;
  const rawCategory = url.searchParams.get("category") ?? undefined;
  const category = rawCategory && KNOWLEDGE_CATEGORIES.includes(rawCategory as KnowledgeCategory)
    ? (rawCategory as KnowledgeCategory)
    : undefined;
  const scopeMode = url.searchParams.get("scopeMode") === "project" ? "project" : url.searchParams.get("scopeMode") === "cross-project" ? "cross-project" : undefined;
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const projectIds = parseProjectIds(url.searchParams.get("projectIds"));

  const graph = await buildKnowledgeGraph({
    locale,
    query: url.searchParams.get("query") ?? undefined,
    topic: url.searchParams.get("topic") ?? undefined,
    category,
    projectId: scopeMode === "cross-project" ? undefined : projectId,
    projectIds: projectIds && projectIds.length > 0 ? projectIds : undefined,
    scopeMode,
  });

  return NextResponse.json({ graph });
}