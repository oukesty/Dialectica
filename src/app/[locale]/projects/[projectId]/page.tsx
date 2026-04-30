export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { getProject, getSettings } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import { getProjectAccessState } from "@/lib/project-access";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const [project, settings] = await Promise.all([getProject(projectId, locale), getSettings({ includeSecrets: false })]);
  const access = getProjectAccessState(project, settings);
  if (!access.canRead) {
    notFound();
  }

  return <ProjectWorkspace locale={locale} initialProject={project} settings={settings} />;
}



