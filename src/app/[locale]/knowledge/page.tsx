import { notFound, redirect } from "next/navigation";
import { KnowledgeHub } from "@/components/knowledge/knowledge-hub";
import { getSettings } from "@/lib/data/repository";
import { getKnowledgeOverview, listKnowledgeNodes } from "@/lib/knowledge/service";
import { isLocale } from "@/lib/i18n";

export default async function KnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { locale } = await params;
  const { projectId } = await searchParams;
  if (!isLocale(locale)) {
    notFound();
  }

  const settings = await getSettings({ includeSecrets: false });
  if (!projectId && settings.knowledgePreferences.defaultView === "graph") {
    redirect('/' + locale + '/knowledge/graph');
  }

  const [overview, nodes] = await Promise.all([
    getKnowledgeOverview(locale),
    listKnowledgeNodes({ locale, projectId }),
  ]);

  return (
    <KnowledgeHub
      locale={locale}
      overview={overview}
      nodes={nodes}
      initialProjectId={projectId}
      defaultGraphMode={settings.knowledgePreferences.defaultGraphMode ?? "both"}
    />
  );
}

