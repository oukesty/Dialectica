import { notFound } from "next/navigation";
import { NewProjectForm } from "@/components/projects/new-project-form";
import { createProjectSkeleton, getSettings } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";
import { listVisibleProjectTemplates } from "@/lib/project-templates";

export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const settings = await getSettings({ includeSecrets: false });
  const project = createProjectSkeleton(locale, settings.defaultScenario, settings);
  const customTemplates = await listVisibleProjectTemplates(settings.profile.localIdentityId);

  return (
    <NewProjectForm
      locale={locale}
      initialProject={project}
      currentIdentityId={settings.profile.localIdentityId}
      customTemplates={customTemplates}
    />
  );
}
