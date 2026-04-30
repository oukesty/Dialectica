import { notFound } from "next/navigation";
import { KnowledgeNodeDetailView } from "@/components/knowledge/knowledge-node-detail";
import { getKnowledgeNodeDetail } from "@/lib/knowledge/service";
import { isLocale } from "@/lib/i18n";

function resolveNodeId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function KnowledgeNodePage({
  params,
}: {
  params: Promise<{ locale: string; nodeId: string }>;
}) {
  const { locale, nodeId } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const detail = await getKnowledgeNodeDetail(resolveNodeId(nodeId), locale);
  if (!detail) {
    notFound();
  }

  return <KnowledgeNodeDetailView locale={locale} detail={detail} />;
}
