export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { bundledSampleProjectIds } from "@/data/samples";
import { deleteCollaborationArtifacts, syncCollaborationState } from "@/lib/collaboration/store";
import { deleteProject, getProject, getSettings, upsertProject } from "@/lib/data/repository";
import { deleteProjectKnowledge } from "@/lib/knowledge/service";
import { removeProjectFromUserGraphs } from "@/lib/knowledge/user-graphs";
import { getProjectAccessState, isSharedProjectWorkspace, ProjectAccessState } from "@/lib/project-access";
import { hasProjectConflict, mergeProjectPatch, ProjectPatch } from "@/lib/project-update";
import { discussionProjectSchema } from "@/lib/schema";
import { appendAuditLog } from "@/lib/audit";
import { isLocale } from "@/lib/i18n";
import { AppLocale, DiscussionProject } from "@/lib/types";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function preserveRemoteProfileIdentity(currentProject: DiscussionProject, nextProject: DiscussionProject, localIdentityId: string) {
  const lockedParticipants = new Map(
    currentProject.participants
      .filter((participant) => participant.profileOwnerId && participant.profileOwnerId !== localIdentityId)
      .map((participant) => [participant.id, participant]),
  );

  return {
    ...nextProject,
    participants: nextProject.participants.map((participant) => {
      const locked = lockedParticipants.get(participant.id);
      if (!locked) return participant;
      return {
        ...participant,
        name: locked.name,
        profileOwnerId: locked.profileOwnerId,
        avatarLabel: locked.avatarLabel,
        avatarPreset: locked.avatarPreset,
        avatarImageDataUrl: locked.avatarImageDataUrl,
        bio: locked.bio,
      };
    }),
  } satisfies DiscussionProject;
}

function resolveProjectLocale(payload: unknown, fallback: AppLocale) {
  return ((payload as { language?: AppLocale } | undefined)?.language ?? fallback) as AppLocale;
}

function invalidProjectResponse(
  locale: AppLocale,
  error: { issues: Array<{ path: PropertyKey[]; message: string }> },
) {
  return NextResponse.json(
    {
      error: localize(locale, {
        "zh-CN": "项目数据结构无效，请检查标题、场景、参与者和讨论字段后重试。",
        en: "The project payload is invalid. Check the title, scenario, participants, and discussion fields, then try again.",
        ja: "プロジェクトデータが無効です。タイトル、シナリオ、参加者、議論フィールドを確認してから再試行してください。",
        ko: "프로젝트 데이터 구조가 올바르지 않습니다. 제목, 시나리오, 참여자, 토론 필드를 확인한 뒤 다시 시도해 주세요.",
        fr: "La structure du projet est invalide. Verifiez le titre, le scenario, les participants et les champs de discussion, puis reessayez.",
        ru: "Структура проекта недопустима. Проверьте заголовок, сценарий, участников и поля обсуждения и повторите попытку.",
      }),
      issues: error.issues.map((issue) => ({ path: issue.path.map((segment) => String(segment)).join("."), message: issue.message })),
    },
    { status: 400 },
  );
}

function aiDialogueProjectResponse(locale: AppLocale) {
  return NextResponse.json({
    error: localize(locale, {
      "zh-CN": "AI 工作台会话不属于项目系统，不能通过项目接口保存或修改。",
      en: "AI workspace sessions do not belong to the project system and cannot be saved through project APIs.",
      ja: "AI ワークスペース会話はプロジェクトシステムに属さないため、プロジェクト API では保存・更新できません。",
      ko: "AI 워크스페이스 세션은 프로젝트 시스템에 속하지 않으므로 프로젝트 API로 저장하거나 수정할 수 없습니다.",
      fr: "Les sessions de l'espace IA n'appartiennent pas au système de projets et ne peuvent pas être enregistrées via les API projet.",
      ru: "Сеансы AI Workspace не относятся к системе проектов и не могут сохраняться через API проектов.",
    }),
  }, { status: 400 });
}

function preserveRestrictedRoomAutomation(
  currentProject: DiscussionProject,
  nextProject: DiscussionProject,
  access: ProjectAccessState,
) {
  if (access.canManageAutomation) {
    return nextProject;
  }

  return {
    ...nextProject,
    room: {
      ...nextProject.room,
      autoSummary: currentProject.room.autoSummary,
      autoEvaluation: currentProject.room.autoEvaluation,
      aiAutomation: currentProject.room.aiAutomation,
    },
  } satisfies DiscussionProject;
}

async function saveProjectUpdate(
  currentProject: DiscussionProject,
  nextProject: DiscussionProject,
  settings: Awaited<ReturnType<typeof getSettings>>,
  access: ProjectAccessState,
) {
  const protectedPayload = preserveRestrictedRoomAutomation(
    currentProject,
    preserveRemoteProfileIdentity(currentProject, nextProject, settings.profile.localIdentityId),
    access,
  );
  if (protectedPayload.scenario === "ai-dialogue") {
    return aiDialogueProjectResponse(protectedPayload.language);
  }
  const saved = await upsertProject(protectedPayload, protectedPayload.language);
  await syncCollaborationState(saved);
  return NextResponse.json({ project: saved, access: getProjectAccessState(saved, settings) });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as AppLocale | undefined;
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canRead) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前身份无权查看这个项目。",
        en: "Your current local profile cannot view this project.",
        ja: "現在のローカルプロフィールではこのプロジェクトを表示できません。",
        ko: "현재 로컬 프로필로는 이 프로젝트를 볼 수 없습니다.",
        fr: "Le profil local actuel ne peut pas consulter ce projet.",
        ru: "Текущий локальный профиль не может просматривать этот проект.",
      }),
    }, { status: 404 });
  }

  return NextResponse.json({ project, access });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const requestedLocale = isLocale(url.searchParams.get("locale") ?? "")
    ? (url.searchParams.get("locale") as AppLocale)
    : undefined;
  const currentProject = await getProject(projectId, requestedLocale ?? settings.locale);
  const access = getProjectAccessState(currentProject, settings);

  if (bundledSampleProjectIds.has(projectId)) {
    return NextResponse.json({
      error: localize(currentProject.language, {
        "zh-CN": "示例工作区是只读的，不能保存修改。",
        en: "Sample workspaces are read-only and cannot be saved.",
        ja: "サンプルワークスペースは読み取り専用のため、変更を保存できません。",
        ko: "샘플 워크스페이스는 읽기 전용이므로 변경 내용을 저장할 수 없습니다.",
        fr: "Les espaces d'exemple sont en lecture seule et ne peuvent pas être enregistrés.",
        ru: "Примеры рабочих пространств доступны только для чтения и не могут быть сохранены.",
      }),
    }, { status: 403 });
  }

  if (!access.canEditWorkspace) {
    return NextResponse.json({
      error: localize(currentProject.language, {
        "zh-CN": "只有当前项目主持人或协作者可以修改这个工作区。",
        en: "Only the current project host or facilitator can edit this workspace.",
        ja: "現在のプロジェクトホストまたは進行役のみがこのワークスペースを編集できます。",
        ko: "현재 프로젝트 호스트 또는 진행자만 이 워크스페이스를 수정할 수 있습니다.",
        fr: "Seuls l'hôte actuel du projet ou le facilitateur peuvent modifier cet espace de travail.",
        ru: "Только текущий владелец проекта или фасилитатор может редактировать это рабочее пространство.",
      }),
    }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({
      error: localize(currentProject.language, {
        "zh-CN": "项目请求内容无效，请检查后重试。",
        en: "The project request body is invalid. Check the submitted JSON and try again.",
        ja: "プロジェクト要求の内容が無効です。送信した JSON を確認して再試行してください。",
        ko: "프로젝트 요청 본문이 올바르지 않습니다. 제출한 JSON 을 확인한 뒤 다시 시도해 주세요.",
        fr: "Le contenu de la requête projet est invalide. Vérifiez le JSON envoyé puis réessayez.",
        ru: "Тело запроса проекта недопустимо. Проверьте отправленный JSON и повторите попытку.",
      }),
    }, { status: 400 });
  }

  const parsed = discussionProjectSchema.safeParse({ ...(payload as object), id: projectId });
  const locale = parsed.success ? parsed.data.language : resolveProjectLocale(payload, currentProject.language);

  if (!parsed.success) {
    return invalidProjectResponse(locale, parsed.error);
  }

  return saveProjectUpdate(currentProject, parsed.data, settings, access);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const requestedLocale = isLocale(url.searchParams.get("locale") ?? "")
    ? (url.searchParams.get("locale") as AppLocale)
    : undefined;
  const currentProject = await getProject(projectId, requestedLocale ?? settings.locale);
  const access = getProjectAccessState(currentProject, settings);

  if (bundledSampleProjectIds.has(projectId)) {
    return NextResponse.json({
      error: localize(currentProject.language, {
        "zh-CN": "示例工作区是只读的，不能保存修改。",
        en: "Sample workspaces are read-only and cannot be saved.",
        ja: "サンプルワークスペースは読み取り専用のため、変更を保存できません。",
        ko: "샘플 워크스페이스는 읽기 전용이므로 변경 내용을 저장할 수 없습니다.",
        fr: "Les espaces d'exemple sont en lecture seule et ne peuvent pas être enregistrés.",
        ru: "Примеры рабочих пространств доступны только для чтения и не могут быть сохранены.",
      }),
    }, { status: 403 });
  }

  if (!access.canEditWorkspace) {
    return NextResponse.json({
      error: localize(currentProject.language, {
        "zh-CN": "只有当前项目主持人或协作者可以修改这个工作区。",
        en: "Only the current project host or facilitator can edit this workspace.",
        ja: "現在のプロジェクトホストまたは進行役のみがこのワークスペースを編集できます。",
        ko: "현재 프로젝트 호스트 또는 진행자만 이 워크스페이스를 수정할 수 있습니다.",
        fr: "Seuls l'hôte actuel du projet ou le facilitateur peuvent modifier cet espace de travail.",
        ru: "Только текущий владелец проекта или фасилитатор может редактировать это рабочее пространство.",
      }),
    }, { status: 403 });
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return NextResponse.json({
      error: localize(currentProject.language, {
        "zh-CN": "项目增量请求无效，请检查后重试。",
        en: "The project patch body is invalid. Check the submitted JSON and try again.",
        ja: "プロジェクト差分リクエストが無効です。送信した JSON を確認して再試行してください。",
        ko: "프로젝트 증분 요청이 올바르지 않습니다. 제출한 JSON 을 확인한 뒤 다시 시도해 주세요.",
        fr: "Le contenu de la requete partielle projet est invalide. Verifiez le JSON envoye puis reessayez.",
        ru: "Тело частичного обновления проекта недопустимо. Проверьте отправленный JSON и повторите попытку.",
      }),
    }, { status: 400 });
  }

  const payload = (rawPayload && typeof rawPayload === "object" && ("patch" in rawPayload || "base" in rawPayload))
    ? rawPayload as { patch?: ProjectPatch; base?: ProjectPatch }
    : { patch: rawPayload as ProjectPatch, base: undefined };

  if (hasProjectConflict(currentProject, payload.patch, payload.base)) {
    return NextResponse.json({
      code: "conflict",
      error: localize(currentProject.language, {
        "zh-CN": "项目已在其他标签页或窗口中变更，请先刷新到最新状态后再重试。",
        en: "Project changed in another tab or window. Refresh to the latest state and try again.",
        ja: "プロジェクトが別のタブまたはウィンドウで更新されました。最新状態に更新してから再試行してください。",
        ko: "프로젝트가 다른 탭 또는 창에서 변경되었습니다. 최신 상태로 새로고침한 뒤 다시 시도해 주세요.",
        fr: "Le projet a ete modifie dans un autre onglet ou une autre fenetre. Actualisez puis reessayez.",
        ru: "Проект был изменён в другой вкладке или окне. Обновите состояние и повторите попытку.",
      }),
      currentProject,
    }, { status: 409 });
  }

  const mergedProject = mergeProjectPatch(currentProject, payload.patch ?? {});
  const parsed = discussionProjectSchema.safeParse({ ...mergedProject, id: projectId });
  const locale = parsed.success ? parsed.data.language : resolveProjectLocale(mergedProject, currentProject.language);

  if (!parsed.success) {
    return invalidProjectResponse(locale, parsed.error);
  }

  return saveProjectUpdate(currentProject, parsed.data, settings, access);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const url = new URL(request.url);
  const settings = await getSettings();
  const locale = ((url.searchParams.get("locale") ?? undefined) as AppLocale | undefined) ?? settings.locale;

  if (bundledSampleProjectIds.has(projectId)) {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": "示例项目受保护，不能被删除。",
          en: "Sample projects are protected and cannot be deleted.",
          ja: "サンプルプロジェクトは保護されているため削除できません。",
          ko: "샘플 프로젝트는 보호되어 있어 삭제할 수 없습니다.",
          fr: "Les projets d'exemple sont protégés et ne peuvent pas être supprimés.",
          ru: "Проекты-примеры защищены и не могут быть удалены.",
        }),
      },
      { status: 403 },
    );
  }
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);
  if (!access.canEditWorkspace) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "只有当前项目主持人或协作者可以删除这个工作区。",
        en: "Only the current project host or facilitator can delete this workspace.",
        ja: "現在のプロジェクトホストまたは進行役のみがこのワークスペースを削除できます。",
        ko: "현재 프로젝트 호스트 또는 진행자만 이 워크스페이스를 삭제할 수 있습니다.",
        fr: "Seuls l'hôte actuel du projet ou le facilitateur peuvent supprimer cet espace de travail.",
        ru: "Только текущий владелец проекта или фасилитатор может удалить это рабочее пространство.",
      }),
    }, { status: 403 });
  }

  if (isSharedProjectWorkspace(project)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "公开项目或多人协作项目不能在这里直接删除，否则会影响所有加入者。请先改为单人私有副本，或使用更安全的后续处理流程。",
        en: "Public or multi-user workspaces cannot be deleted here because that would affect every participant. Convert it to a private single-user copy or use a safer follow-up workflow first.",
        ja: "公開プロジェクトや複数人ワークスペースは、参加者全員に影響するためここから直接削除できません。先に非公開の単独コピーにするか、より安全な後続フローを利用してください。",
        ko: "공개 프로젝트나 다중 사용자 워크스페이스는 모든 참여자에게 영향을 주므로 여기서 직접 삭제할 수 없습니다. 먼저 비공개 단일 사용자 사본으로 바꾸거나 더 안전한 후속 절차를 사용해 주세요.",
        fr: "Les espaces publics ou collaboratifs ne peuvent pas etre supprimes ici, car cela affecterait tous les participants. Créez d'abord une copie privee a utilisateur unique ou utilisez un flux plus sur.",
        ru: "Публичные или многопользовательские рабочие пространства нельзя удалять здесь, потому что это затронет всех участников. Сначала создайте приватную одиночную копию или используйте более безопасный сценарий.",
      }),
    }, { status: 409 });
  }

  void appendAuditLog({ action: "project.delete", actorId: settings.profile.localIdentityId, actorName: settings.profile.displayName, projectId, details: `Deleted project "${project.title}"` });
  await deleteProject(projectId);
  await Promise.all([
    deleteCollaborationArtifacts(projectId),
    deleteProjectKnowledge(projectId),
    removeProjectFromUserGraphs(projectId),
  ]);

  return new NextResponse(null, { status: 204 });
}
