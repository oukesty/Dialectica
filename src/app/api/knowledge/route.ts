export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { isLocale } from "@/lib/i18n";
import { getSettings } from "@/lib/data/repository";
import { listKnowledgeNodes } from "@/lib/knowledge/service";
import { KNOWLEDGE_CATEGORIES, KnowledgeCategory } from "@/lib/knowledge/types";

export async function GET(request: Request) {
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as typeof settings.locale) : settings.locale;
  const rawCategory = url.searchParams.get("category") ?? undefined;
  const category = rawCategory && KNOWLEDGE_CATEGORIES.includes(rawCategory as KnowledgeCategory)
    ? (rawCategory as KnowledgeCategory)
    : undefined;

  const nodes = await listKnowledgeNodes({
    locale,
    query: url.searchParams.get("query") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    topic: url.searchParams.get("topic") ?? undefined,
    category,
    projectId: url.searchParams.get("projectId") ?? undefined,
  });

  return NextResponse.json({ nodes });
}
