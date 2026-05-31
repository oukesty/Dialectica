"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, Button } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { AppLocale } from "@/lib/types";

type AuditEntry = { id: string; timestamp: string; action: string; actorName: string; details: string };

const ACTION_TONES: Record<string, "default" | "accent" | "success" | "danger"> = {
  "project.create": "success",
  "project.delete": "danger",
  "room.archive": "danger",
  "room.kick": "danger",
  "room.setRole": "accent",
  "room.join": "success",
  "settings.update": "default",
  "message.send": "default",
};

export function AuditLogPanel({ projectId, locale }: { projectId: string; locale: AppLocale }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const readErrorMessage = useCallback(async (response: Response) => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error ?? t("project.auditLoadFailed");
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/audit?projectId=${projectId}`);
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const data = (await res.json()) as { entries: AuditEntry[] };
      setEntries(data.entries);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("project.auditLoadFailed"));
    }
    finally { setLoading(false); }
  }, [projectId, readErrorMessage, t]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-xs text-[color:var(--muted)]">{t("common.loading")}...</p>;

  if (loadError) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-rose-600 dark:text-rose-300">{loadError}</p>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => void load()}>{t("common.retry")}</Button>
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className="text-xs text-[color:var(--muted)]">{t("project.noAuditEntries")}</p>;
  }

  return (
    <div className="max-h-72 space-y-1.5 overflow-y-auto">
      {entries.map((e) => (
        <div key={e.id} className="flex items-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={ACTION_TONES[e.action] ?? "default"}>{e.action}</Badge>
              <span className="font-semibold">{e.actorName}</span>
            </div>
            <p className="mt-0.5 text-[color:var(--muted)]">{e.details}</p>
          </div>
          <span className="shrink-0 text-[10px] text-[color:var(--muted)]">{formatDateTime(e.timestamp, locale)}</span>
        </div>
      ))}
    </div>
  );
}
