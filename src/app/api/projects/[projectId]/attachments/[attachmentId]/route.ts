export const dynamic = "force-dynamic";

import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { deleteAttachment, getCollaborationState, sanitizeCollaborationStateForClient } from "@/lib/collaboration/store";
import { getProject, getSettings } from "@/lib/data/repository";
import { getProjectAccessState } from "@/lib/project-access";
import { AppLocale } from "@/lib/types";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function resolveAttachmentPath(projectId: string, localPath: string) {
  const uploadRoot = path.resolve(process.cwd(), "data", "uploads", projectId);
  const resolved = path.isAbsolute(localPath)
    ? path.resolve(localPath)
    : path.resolve(process.cwd(), localPath);

  if (!resolved.startsWith(uploadRoot)) {
    return null;
  }

  return resolved;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; attachmentId: string }> },
) {
  const { projectId, attachmentId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as AppLocale | undefined;
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canRead) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前身份无权读取这个房间的附件。",
        en: "Your current local profile cannot open attachments from this room.",
        ja: "現在のローカルプロフィールではこのルームの添付ファイルを開けません。",
        fr: "Le profil local actuel ne peut pas ouvrir les pièces jointes de ce salon.",
      }),
    }, { status: 404 });
  }

  const collaboration = await getCollaborationState(project);
  const attachment = collaboration.attachments.find((candidate) => candidate.id === attachmentId);
  if (!attachment) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "附件不存在。",
        en: "Attachment not found.",
        ja: "添付ファイルが見つかりません。",
        fr: "Pièce jointe introuvable.",
      }),
    }, { status: 404 });
  }

  if (attachment.storage === "external" && attachment.publicUrl) {
    return NextResponse.redirect(attachment.publicUrl, 307);
  }

  if (!attachment.localPath) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "该附件没有可用的本地文件路径。",
        en: "This attachment does not have an available local file path.",
        ja: "この添付ファイルには利用可能なローカルパスがありません。",
        fr: "Cette pièce jointe n'a pas de chemin local disponible.",
      }),
    }, { status: 404 });
  }

  const resolvedPath = resolveAttachmentPath(projectId, attachment.localPath);
  if (!resolvedPath) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "附件路径不安全，已拒绝访问。",
        en: "The attachment path is unsafe and was rejected.",
        ja: "添付ファイルのパスが安全ではないため拒否されました。",
        fr: "Le chemin de la pièce jointe est considéré comme dangereux et a été rejeté.",
      }),
    }, { status: 403 });
  }

  try {
    const bytes = await readFile(resolvedPath);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.name)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "附件文件不存在或无法读取。",
        en: "The attachment file is missing or unreadable.",
        ja: "添付ファイルが存在しないか読み取れません。",
        fr: "Le fichier joint est manquant ou illisible.",
      }),
    }, { status: 404 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string; attachmentId: string }> },
) {
  const { projectId, attachmentId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as AppLocale | undefined;
  const project = await getProject(projectId, locale);
  const access = getProjectAccessState(project, settings);

  if (!access.canRead) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前身份无权管理这个房间的附件。",
        en: "Your current local profile cannot manage attachments in this room.",
        ja: "現在のローカルプロフィールではこのルームの添付ファイルを管理できません。",
        fr: "Le profil local actuel ne peut pas gérer les pièces jointes de ce salon.",
      }),
    }, { status: 404 });
  }

  const collaboration = await getCollaborationState(project);
  const attachment = collaboration.attachments.find((candidate) => candidate.id === attachmentId);
  if (!attachment) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "附件不存在。",
        en: "Attachment not found.",
        ja: "添付ファイルが見つかりません。",
        fr: "Pièce jointe introuvable.",
      }),
    }, { status: 404 });
  }

  const uploadedByParticipantId = attachment.uploadedByParticipantId;
  const canDelete = access.canManageRoom
    || (typeof uploadedByParticipantId === "string" && access.ownedParticipantIds.includes(uploadedByParticipantId));
  if (!canDelete) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "你只能删除自己上传的附件，或由房间管理者删除其他附件。",
        en: "You can only delete your own attachments unless you manage this room.",
        ja: "自分がアップロードした添付ファイル、またはルーム管理者として他の添付ファイルのみ削除できます。",
        fr: "Vous ne pouvez supprimer que vos propres pièces jointes, sauf si vous gérez ce salon.",
      }),
    }, { status: 403 });
  }

  const deleted = await deleteAttachment(project, attachmentId);
  if (!deleted) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "附件不存在。",
        en: "Attachment not found.",
        ja: "添付ファイルが見つかりません。",
        fr: "Pièce jointe introuvable.",
      }),
    }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    deletedAttachmentId: attachmentId,
    state: sanitizeCollaborationStateForClient(deleted.state),
  });
}
