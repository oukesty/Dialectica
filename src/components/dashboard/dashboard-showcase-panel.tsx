import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, Panel } from "@/components/ui/primitives";
import type { ShowcaseBlueprint } from "@/data/samples";
import { dictionaries, getNestedValue } from "@/lib/i18n";
import type { AppLocale } from "@/lib/types";

function translate(locale: AppLocale, path: string, params?: Record<string, string>) {
  const dictionary = dictionaries[locale] ?? dictionaries.en;
  const found = getNestedValue(dictionary, path);
  if (typeof found !== "string") {
    return path;
  }
  if (!params) {
    return found;
  }
  return Object.entries(params).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, replacement),
    found,
  );
}

export function DashboardShowcasePanel({
  locale,
  showcase,
}: {
  locale: AppLocale;
  showcase?: ShowcaseBlueprint;
}) {
  const t = (path: string, params?: Record<string, string>) => translate(locale, path, params);

  return (
    <Panel className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--brand-solid)]">{t("dashboard.actionSampleTitle")}</p>
          <h2 className="font-display text-xl font-semibold leading-snug tracking-tight">{showcase?.title}</h2>
        </div>
        {showcase ? <Badge>{t(`scenario.${showcase.scenario}`)}</Badge> : null}
      </div>
      <p className="text-sm leading-relaxed text-[color:var(--muted)]">{showcase?.body}</p>
      <div className="space-y-2">
        {showcase?.supportingPoints.map((point, idx) => (
          <div key={point} className="flex items-start gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-4 py-3 text-sm leading-relaxed">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-soft)] text-[10px] font-bold text-[color:var(--brand-ink)]">{idx + 1}</span>
            <span className="text-[color:var(--muted)]">{point}</span>
          </div>
        ))}
      </div>
      <Link prefetch={false} href={`/${locale}/projects/new`} className="group inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--brand-solid)] transition-colors duration-200 hover:text-[color:var(--brand-ink)]">
        {t("newProject.useTemplate")}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    </Panel>
  );
}
