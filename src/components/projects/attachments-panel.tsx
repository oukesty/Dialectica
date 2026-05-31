"use client";

import { useCallback, useEffect, useState } from "react";
import { FileImage, FileText, Trash2, Video } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge, Button } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { AppLocale } from "@/lib/types";

type Attachment = {
  id: string;
  name: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  projectId: string;
  projectTitle: string;
  uploadedAt: string;
  uploadedByParticipantId?: string;
  storage: string;
  publicUrl?: string;
};

function kindIcon(kind: string) {
  if (kind === "image") return FileImage;
  if (kind === "video") return Video;
  return FileText;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsPanel({
  projectId,
  locale,
  canModerate = false,
  ownedParticipantIds = [],
}: {
  projectId: string;
  locale: AppLocale;
  canModerate?: boolean;
  ownedParticipantIds?: string[];
}) {
  const { t } = useI18n();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const readErrorMessage = useCallback(async (response: Response) => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error ?? t("errors.unexpected");
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/attachments");
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const data = (await res.json()) as { attachments: Attachment[] };
      setAttachments(data.attachments.filter((a) => a.projectId === projectId));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("project.attachmentsLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [projectId, readErrorMessage, t]);

  useEffect(() => { void load(); }, [load]);

  const canDeleteAttachment = (attachment: Attachment) => canModerate
    || Boolean(attachment.uploadedByParticipantId && ownedParticipantIds.includes(attachment.uploadedByParticipantId));

  const handleDelete = async (attId: string) => {
    if (!window.confirm(t("project.deleteAttachmentConfirm"))) return;
    setDeletingId(attId);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/attachments/${attId}?locale=${locale}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      setAttachments((prev) => prev.filter((a) => a.id !== attId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("errors.unexpected"));
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <p className="text-xs text-[color:var(--muted)]">{t("common.loading")}...</p>;

  if (loadError) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-rose-600 dark:text-rose-300">{loadError}</p>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => void load()}>{t("common.retry")}</Button>
      </div>
    );
  }

  if (attachments.length === 0) {
    return <p className="text-xs text-[color:var(--muted)]">{t("project.noAttachments")}</p>;
  }

  return (
    <div className="space-y-2">
      {message ? <p className="text-xs text-rose-600 dark:text-rose-300">{message}</p> : null}
      <p className="text-xs text-[color:var(--muted)]">{attachments.length} {t("project.collaborationPanel.attachments")}</p>
      {attachments.map((att) => {
        const Icon = kindIcon(att.kind);
        const href = att.publicUrl || `/api/projects/${att.projectId}/attachments/${att.id}`;
        return (
          <div key={att.id} className="flex items-start gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
            {att.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={href} alt={att.name} className="h-12 w-12 shrink-0 rounded-lg border border-[color:var(--border)] object-cover" loading="lazy" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)]">
                <Icon className="h-5 w-5 text-[color:var(--muted)]" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{att.name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--muted)]">
                <Badge>{att.kind}</Badge>
                <span>{formatSize(att.sizeBytes)}</span>
                <span>{formatDateTime(att.uploadedAt, locale)}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <a href={href} target="_blank" rel="noreferrer" className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-strong)] px-2 py-1 text-[10px] font-semibold transition hover:bg-[color:var(--surface-hover)]">{t("common.open")}</a>
              {canDeleteAttachment(att) ? (
                <button type="button" disabled={deletingId === att.id} onClick={() => void handleDelete(att.id)} className="rounded-lg border border-red-500/30 bg-red-500/10 p-1 text-red-500 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
