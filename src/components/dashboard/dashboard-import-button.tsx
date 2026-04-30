"use client";

import { startTransition, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/primitives";
import type { AppLocale } from "@/lib/types";

function detectFormat(fileName: string) {
  if (fileName.endsWith(".json")) return "json";
  if (fileName.endsWith(".md") || fileName.endsWith(".markdown")) return "markdown";
  return "txt";
}

export function DashboardImportButton({
  locale,
  className = "",
  variant = "ghost",
}: {
  locale: AppLocale;
  className?: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button variant={variant} className={className} onClick={() => inputRef.current?.click()}>
        <FileUp className="h-4 w-4" />
        {importing ? `${t("common.loading")}...` : t("nav.importProject")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".json,.txt,.md,.markdown"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }

          setError(null);
          setImporting(true);
          startTransition(async () => {
            try {
              const content = await file.text();
              const format = detectFormat(file.name);
              const response = await fetch("/api/projects/import", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ format, content, locale }),
              });

              if (!response.ok) {
                throw new Error(t("errors.importFailed"));
              }

              const data = (await response.json()) as { project: { id: string } };
              router.push(`/${locale}/projects/${data.project.id}`);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : t("errors.importFailed"));
            } finally {
              setImporting(false);
              if (event.target) {
                event.target.value = "";
              }
            }
          });
        }}
      />
      {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}
