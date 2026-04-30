import type { Metadata } from "next";
import { ReactNode } from "react";
import { notFound } from "next/navigation";
import { I18nProvider } from "@/components/providers/i18n-provider";
import { AppShell } from "@/components/layout/app-shell";
import { getDictionary, isLocale } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const dictionary = await getDictionary(locale);
  return {
    title: `${dictionary.meta.appName} | ${dictionary.meta.tagline}`,
    description: dictionary.meta.description,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const dictionary = await getDictionary(locale);

  return (
    <I18nProvider dictionary={dictionary} locale={locale}>
      <AppShell locale={locale}>{children}</AppShell>
    </I18nProvider>
  );
}
