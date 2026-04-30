"use client";

import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { DashboardProjectSummary } from "@/lib/types";

export function DashboardBatchExport({ projects }: { projects: DashboardProjectSummary[] }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (projects.length === 0) return null;

  const readErrorMessage = async (response: Response) => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error ?? t("errors.unexpected");
  };

  const handleExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/projects/batch-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: projects.map((p) => p.id) }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dialectica-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleExport}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-3 py-2 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
      >
        {busy ? "..." : t("dashboard.batchExport")}
      </button>
      {message ? <p className="text-xs text-rose-600 dark:text-rose-300">{message}</p> : null}
    </div>
  );
}
