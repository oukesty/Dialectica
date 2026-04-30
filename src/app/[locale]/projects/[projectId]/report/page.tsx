export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { ProjectReport } from "@/components/projects/project-report";
import { getProject, getSettings } from "@/lib/data/repository";
import { getProjectKnowledgeSnapshot } from "@/lib/knowledge/service";
import { isLocale } from "@/lib/i18n";
import { getProjectAccessState } from "@/lib/project-access";

export default async function ProjectReportPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const [project, settings, knowledge] = await Promise.all([
    getProject(projectId, locale),
    getSettings({ includeSecrets: false }),
    getProjectKnowledgeSnapshot(projectId, locale),
  ]);
  const access = getProjectAccessState(project, settings);
  if (!access.canRead) {
    notFound();
  }

  return <ProjectReport locale={locale} project={project} settings={settings} knowledge={knowledge} />;
}


