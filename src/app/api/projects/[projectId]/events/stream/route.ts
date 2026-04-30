export const dynamic = "force-dynamic";

import { getProject, getSettings } from "@/lib/data/repository";
import { getProjectAccessState } from "@/lib/project-access";
import { getCollaborationState } from "@/lib/collaboration/store";
import { buildCollaborationSyncSignature } from "@/lib/project-sync";
import { isLocale } from "@/lib/i18n";
import { AppLocale } from "@/lib/types";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

/**
 * SSE endpoint for real-time collaboration updates.
 * Client connects via EventSource, receives newline-delimited events.
 * Falls back to polling if connection drops.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const requestedLocale = url.searchParams.get("locale") ?? "";
  const locale: AppLocale = isLocale(requestedLocale) ? requestedLocale : settings.locale;
  const project = await getProject(projectId, locale);
  if (!project) {
    return new Response(localize(locale, {
      "zh-CN": "项目不存在。",
      en: "Project not found.",
      ja: "プロジェクトが見つかりません。",
      ko: "프로젝트를 찾을 수 없습니다.",
      fr: "Projet introuvable.",
      ru: "Проект не найден.",
    }), { status: 404 });
  }

  const access = getProjectAccessState(project, settings);
  if (!access.canRead) {
    return new Response(localize(project.language, {
      "zh-CN": "当前身份无权查看这个房间流。",
      en: "Your current local profile cannot view this room stream.",
      ja: "現在のローカルプロフィールではこのルームストリームを表示できません。",
      ko: "현재 로컬 프로필로는 이 방 스트림을 볼 수 없습니다.",
      fr: "Votre profil local actuel ne peut pas consulter ce flux de salon.",
      ru: "Текущий локальный профиль не может просматривать поток этой комнаты.",
    }), { status: 403 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ projectId, timestamp: new Date().toISOString() })}\n\n`));

      let lastSignature = "";

      // Poll for changes and push via SSE
      const check = async () => {
        if (closed) return;
        try {
          const freshProject = await getProject(projectId, locale);
          if (!freshProject) return;
          const state = await getCollaborationState(freshProject);
          const signature = buildCollaborationSyncSignature(state);
          if (signature !== lastSignature) {
            lastSignature = signature;
            controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify({
              version: state?.version ?? 0,
              eventCount: state?.events.length ?? 0,
              presenceCount: state?.presence.filter((p) => p.active).length ?? 0,
              timestamp: new Date().toISOString(),
            })}\n\n`));
          }
          // Heartbeat every check
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          // Ignore check errors, keep connection alive
        }
      };

      // Check every 3 seconds (faster than polling default of 8s)
      intervalId = setInterval(() => void check(), 3000);

      // Initial check
      void check();
    },
    cancel() {
      closed = true;
      if (intervalId) clearInterval(intervalId);
    },
  });

  // Listen for client disconnect
  request.signal.addEventListener("abort", () => {
    closed = true;
    if (intervalId) clearInterval(intervalId);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
