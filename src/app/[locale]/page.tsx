export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getDashboardData } from "@/lib/data/repository";
import { getKnowledgeHomepageSummary } from "@/lib/knowledge/service";
import { isLocale } from "@/lib/i18n";
import { DashboardPage } from "@/components/dashboard/dashboard-page";

export default async function LocaleHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const [data, knowledgeSummary] = await Promise.all([
    getDashboardData(locale),
    getKnowledgeHomepageSummary(locale),
  ]);
  return <DashboardPage locale={locale} projects={data.projects} settings={data.settings} knowledgeSummary={knowledgeSummary} />;
}


