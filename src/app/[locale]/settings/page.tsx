export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { SettingsPage } from "@/components/settings/settings-page";
import { getSettings } from "@/lib/data/repository";
import { isLocale } from "@/lib/i18n";

export default async function SettingsRoute({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const settings = await getSettings({ includeSecrets: false });
  return <SettingsPage locale={locale} initialSettings={settings} />;
}



