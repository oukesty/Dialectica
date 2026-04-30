export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProject, getSettings } from "@/lib/data/repository";
import { getCollaborationState, sanitizeCollaborationStateForClient } from "@/lib/collaboration/store";
import { getProjectAccessState } from "@/lib/project-access";
import { buildProjectSyncSignature } from "@/lib/project-sync";
import { AppLocale } from "@/lib/types";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as AppLocale | undefined;
  const knownVersion = Number(url.searchParams.get("sinceVersion") ?? Number.NaN);
  const knownProjectSync = url.searchParams.get("projectSync") ?? "";
  const hasKnownVersion = Number.isFinite(knownVersion);
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canRead) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前身份无权查看这个房间。",
        en: "Your current local profile cannot view this room.",
        ja: "現在のローカルプロフィールではこのルームを表示できません。",
        ko: "현재 로컬 프로필로는 이 방을 볼 수 없습니다.",
        fr: "Le profil local actuel ne peut pas consulter ce salon.",
        ru: "Текущий локальный профиль не может просматривать эту комнату.",
      }),
    }, { status: 404 });
  }

  const collaboration = sanitizeCollaborationStateForClient(await getCollaborationState(project));
  const safeCollaboration = access.canCreateInvites
    ? collaboration
    : {
        ...collaboration,
        invites: [],
      };
  const currentProjectSync = buildProjectSyncSignature(project);
  const collaborationChanged = !hasKnownVersion || knownVersion !== safeCollaboration.version;
  const projectChanged = !knownProjectSync || knownProjectSync !== currentProjectSync;

  if (hasKnownVersion && !collaborationChanged && !projectChanged) {
    return NextResponse.json({
      unchanged: true,
      collaborationVersion: safeCollaboration.version,
      projectSync: currentProjectSync,
    });
  }

  return NextResponse.json({
    collaboration: collaborationChanged ? safeCollaboration : undefined,
    project: projectChanged ? project : undefined,
    collaborationVersion: safeCollaboration.version,
    projectSync: currentProjectSync,
  });
}
