"use client";

import { useTransition, useState } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/primitives";
import { deleteDashboardProjectAction } from "@/components/dashboard/dashboard-actions";
import { AppLocale } from "@/lib/types";

export function DashboardProjectDeleteControl({
  locale,
  projectId,
}: {
  locale: AppLocale;
  projectId: string;
}) {
  const { t } = useI18n();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirmDelete = () => {
    startTransition(async () => {
      await deleteDashboardProjectAction(locale, projectId);
    });
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setConfirmOpen((current) => !current)}
        className="inline-flex items-center justify-center gap-2 rounded-[1rem] border border-rose-500/16 bg-rose-50/65 px-4 py-2.5 text-sm font-semibold text-rose-700/82 transition hover:border-rose-500/22 hover:bg-rose-100/70 dark:border-rose-400/16 dark:bg-rose-500/10 dark:text-rose-200/82 dark:hover:bg-rose-500/14"
      >
        <Trash2 className="h-4 w-4" />
        <span>{t("project.deleteProject")}</span>
      </button>
      {confirmOpen ? (
        <div className="rounded-xl border border-rose-500/16 bg-[color:var(--surface-strong)] p-4 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-rose-500/12 text-rose-700 dark:text-rose-200">
              <TriangleAlert className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-6 text-[color:var(--foreground)]">{t("project.deleteConfirm")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="danger" className="gap-2" onClick={confirmDelete} disabled={pending}>
                  <Trash2 className="h-4 w-4" />
                  {pending ? `${t("common.loading")}...` : t("common.delete")}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={pending}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
