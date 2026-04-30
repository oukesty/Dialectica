export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import path from "node:path";
import { addAttachment, getCollaborationState, getUploadDirectory, sanitizeCollaborationStateForClient, sanitizeRoomAttachmentForClient, writeUploadedFile } from "@/lib/collaboration/store";
import fs from "node:fs";
import { getProject, getSettings, isAssistantSessionPendingDeletionError } from "@/lib/data/repository";
import { getProjectAccessState } from "@/lib/project-access";
import { AppLocale } from "@/lib/types";
import { isSafeHttpUrl, sanitizeOptionalText, sanitizePlainText } from "@/lib/utils";

const PROJECT_UPLOAD_LIMIT_MB = 200;
const SYSTEM_UPLOAD_LIMIT_MB = 500;

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSizeBytes(full);
      else try { total += fs.statSync(full).size; } catch { /* skip */ }
    }
  } catch { /* dir doesn't exist */ }
  return total;
}

function uploadsRootDir() {
  return path.resolve(process.cwd(), "data", "uploads");
}

function inferKind(mimeType: string, fileName: string) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.includes("pdf") || mimeType.includes("word") || mimeType.includes("text") || /\.(md|markdown|doc|docx|pdf|txt)$/i.test(fileName)) {
    return "document";
  }
  return "file";
}

function canExtractPreviewText(mimeType: string, fileName: string) {
  return mimeType.startsWith("text/")
    || /(json|xml|javascript|csv|yaml)/i.test(mimeType)
    || /\.(txt|md|markdown|json|csv|tsv|yaml|yml|xml|html|htm|css|js|jsx|ts|tsx)$/i.test(fileName);
}

function extractPreviewText(mimeType: string, fileName: string, bytes: Buffer) {
  if (!canExtractPreviewText(mimeType, fileName)) {
    return undefined;
  }

  const preview = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 24 * 1024))
    .replace(/\n{3,}/g, "\n\n");
  return sanitizePlainText(preview, 1800) || undefined;
}

function isAllowed(kind: ReturnType<typeof inferKind>, settings: Awaited<ReturnType<typeof getSettings>>) {
  if (kind === "document") return settings.uploadPreferences.allowDocuments;
  if (kind === "image") return settings.uploadPreferences.allowImages;
  if (kind === "video") return settings.uploadPreferences.allowVideos;
  return true;
}

function pendingDeletionResponse(locale: AppLocale) {
  return NextResponse.json({
    error: localize(locale, {
      "zh-CN": "当前工作区处于待清理状态，不能继续读取或上传附件。",
      en: "This workspace is pending deletion, so attachments can no longer be read or uploaded.",
      ja: "このワークスペースは削除待ちのため、添付ファイルの閲覧や追加はできません。",
      fr: "Cet espace de travail est en attente de suppression. Les pieces jointes ne peuvent plus etre lues ni ajoutees.",
    }),
  }, { status: 409 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const settings = await getSettings();
  const url = new URL(request.url);
  const locale = (url.searchParams.get("locale") ?? undefined) as AppLocale | undefined;
  let project;
  try {
    project = await getProject(projectId, locale);
  } catch (error) {
    if (isAssistantSessionPendingDeletionError(error)) {
      return pendingDeletionResponse(locale ?? settings.locale);
    }
    throw error;
  }
  const access = getProjectAccessState(project, settings);

  if (!access.canRead) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前身份无权查看这个房间的附件。",
        en: "Your current local profile cannot view this room's attachments.",
        ja: "現在のローカルプロフィールではこのルームの添付ファイルを表示できません。",
        fr: "Le profil local actuel ne peut pas consulter les pièces jointes de ce salon.",
      }),
    }, { status: 404 });
  }

  const collaboration = await getCollaborationState(project);
  return NextResponse.json({ attachments: collaboration.attachments.map(sanitizeRoomAttachmentForClient), sync: collaboration.sync });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const url = new URL(request.url);
  const settings = await getSettings();
  const locale = ((url.searchParams.get("locale") ?? undefined) as AppLocale | undefined) ?? settings.locale;
  let project;
  try {
    project = await getProject(projectId, locale);
  } catch (error) {
    if (isAssistantSessionPendingDeletionError(error)) {
      return pendingDeletionResponse(locale);
    }
    throw error;
  }
  const access = getProjectAccessState(project, settings);
  const contentType = request.headers.get("content-type") ?? "";
  const maxBytes = settings.uploadPreferences.maxUploadMb * 1024 * 1024;

  if (project.status === "archived" || project.metadata.archivedAt || project.metadata.pendingDeletionAt) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": "当前工作区处于归档或待清理状态，不能继续上传附件。",
        en: "This workspace is archived or pending deletion, so attachments can no longer be uploaded.",
        ja: "このワークスペースはアーカイブ済みまたは削除待ちのため、添付ファイルを追加できません。",
        fr: "Cet espace de travail est archive ou en attente de suppression. Vous ne pouvez plus y ajouter de pieces jointes.",
      }),
    }, { status: 409 });
  }

  if (!access.canUploadAttachments) {
    return NextResponse.json({
      error: localize(project.language, {
        "zh-CN": access.canJoinPublicRoom ? "请先加入这个公共房间，再上传附件。" : "当前身份没有可用的附件上传席位。",
        en: access.canJoinPublicRoom ? "Join this public room before uploading attachments." : "Your current identity cannot upload attachments to this room.",
        ja: access.canJoinPublicRoom ? "この公開ルームに参加してから添付ファイルをアップロードしてください。" : "現在のプロフィールではこのルームに添付ファイルをアップロードできません。",
        fr: access.canJoinPublicRoom ? "Rejoignez d'abord ce salon public avant d'envoyer des pièces jointes." : "Votre identité actuelle ne peut pas téléverser des pièces jointes dans ce salon.",
      }),
    }, { status: access.canJoinPublicRoom ? 409 : 403 });
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const note = sanitizeOptionalText(String(form.get("note") ?? ""), 240);
    const participantId = sanitizeOptionalText(String(form.get("participantId") ?? ""), 80);
    const externalUrl = sanitizeOptionalText(String(form.get("externalUrl") ?? ""), 512);

    if (!(file instanceof File)) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "缺少上传文件。",
          en: "Missing uploaded file.",
          ja: "アップロードファイルがありません。",
          fr: "Fichier televerse manquant.",
        }),
      }, { status: 400 });
    }

    if (participantId && !access.ownedParticipantIds.includes(participantId)) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "你只能以当前本地身份绑定的成员上传附件。",
          en: "You can only upload as participants bound to your current local profile.",
          ja: "現在のローカルプロフィールに紐づく参加者としてのみ添付ファイルをアップロードできます。",
          fr: "Vous ne pouvez téléverser qu'au nom des participants liés à votre profil local actuel.",
        }),
      }, { status: 403 });
    }

    if (externalUrl && !isSafeHttpUrl(externalUrl)) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "外部附件链接必须是有效的 http(s) 地址。",
          en: "External attachment URLs must be valid http(s) links.",
          ja: "外部添付 URL には有効な http(s) リンクを指定してください。",
          fr: "Les URL de pieces jointes externes doivent etre des liens http(s) valides.",
        }),
      }, { status: 400 });
    }

    const safeName = sanitizePlainText(file.name, 120);
    const kind = inferKind(file.type, safeName);
    if (!isAllowed(kind, settings)) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "当前设置未启用该类型附件上传。",
          en: "This attachment type is disabled in Settings.",
          ja: "この添付種別は設定で無効になっています。",
          fr: "Ce type de piece jointe est desactive dans les parametres.",
        }),
      }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    if (bytes.byteLength > maxBytes) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": `上传文件超出 ${settings.uploadPreferences.maxUploadMb} MB 限制。`,
          en: `The file exceeds the ${settings.uploadPreferences.maxUploadMb} MB upload limit.`,
          ja: `ファイルが ${settings.uploadPreferences.maxUploadMb} MB の上限を超えています。`,
          fr: `Le fichier depasse la limite de ${settings.uploadPreferences.maxUploadMb} Mo.`,
        }),
      }, { status: 413 });
    }

    // Project-total upload size limit
    const projectUploadDir = getUploadDirectory(projectId);
    const projectTotalBytes = dirSizeBytes(projectUploadDir) + bytes.byteLength;
    if (projectTotalBytes > PROJECT_UPLOAD_LIMIT_MB * 1024 * 1024) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": `该项目的附件总大小已超过 ${PROJECT_UPLOAD_LIMIT_MB} MB 限制，请清理旧附件后再上传。`,
          en: `This project's total attachments exceed the ${PROJECT_UPLOAD_LIMIT_MB} MB limit. Please remove old attachments before uploading.`,
          ja: `このプロジェクトの添付ファイル合計が ${PROJECT_UPLOAD_LIMIT_MB} MB の上限を超えています。古い添付を削除してからアップロードしてください。`,
          fr: `Les pieces jointes de ce projet depassent la limite de ${PROJECT_UPLOAD_LIMIT_MB} Mo. Supprimez d'anciens fichiers avant d'en ajouter.`,
        }),
      }, { status: 413 });
    }

    // System-wide upload size limit
    const systemTotalBytes = dirSizeBytes(uploadsRootDir()) + bytes.byteLength;
    if (systemTotalBytes > SYSTEM_UPLOAD_LIMIT_MB * 1024 * 1024) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": `系统附件总大小已超过 ${SYSTEM_UPLOAD_LIMIT_MB} MB 限制，请联系管理员清理空间。`,
          en: `System-wide attachment storage exceeds the ${SYSTEM_UPLOAD_LIMIT_MB} MB limit. Please contact an administrator to free space.`,
          ja: `システム全体の添付ファイルが ${SYSTEM_UPLOAD_LIMIT_MB} MB の上限を超えています。管理者に連絡して空き容量を確保してください。`,
          fr: `Le stockage total des pieces jointes depasse la limite de ${SYSTEM_UPLOAD_LIMIT_MB} Mo. Contactez un administrateur pour liberer de l'espace.`,
        }),
      }, { status: 413 });
    }

    if (!externalUrl && !settings.uploadPreferences.retainLocalFiles) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "当前设置禁止保留本地文件，请改用外部链接或开启本地保留。",
          en: "Local file retention is disabled. Use an external URL or enable local retention in Settings.",
          ja: "ローカルファイル保持は無効です。外部 URL を使うか、設定でローカル保持を有効にしてください。",
          fr: "La conservation locale est desactivee. Utilisez une URL externe ou activez-la dans les parametres.",
        }),
      }, { status: 409 });
    }

    const localPath = externalUrl ? undefined : await writeUploadedFile(projectId, safeName, bytes);
    const result = await addAttachment(project, {
      name: safeName,
      kind,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: bytes.byteLength,
      uploadedByParticipantId: participantId || access.ownedParticipantIds[0],
      storage: externalUrl ? "external" : "local",
      localPath,
      publicUrl: externalUrl || undefined,
      note,
      previewText: extractPreviewText(file.type || "application/octet-stream", safeName, bytes),
    });

    return NextResponse.json({ state: sanitizeCollaborationStateForClient(result.state), attachment: sanitizeRoomAttachmentForClient(result.attachment) }, { status: 201 });
  }

  const payload = (await request.json()) as {
    name: string;
    kind?: "document" | "image" | "video" | "file";
    mimeType?: string;
    sizeBytes?: number;
    uploadedByParticipantId?: string;
    publicUrl?: string;
    note?: string;
  };

  const safeName = sanitizePlainText(payload.name, 120);
  const participantId = sanitizeOptionalText(payload.uploadedByParticipantId, 80);
  const publicUrl = sanitizeOptionalText(payload.publicUrl, 512);
  const kind = payload.kind ?? inferKind(payload.mimeType ?? "", safeName);

  if (participantId && !access.ownedParticipantIds.includes(participantId)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "你只能以当前本地身份绑定的成员上传附件。",
        en: "You can only upload as participants bound to your current local profile.",
        ja: "現在のローカルプロフィールに紐づく参加者としてのみ添付ファイルをアップロードできます。",
        fr: "Vous ne pouvez téléverser qu'au nom des participants liés à votre profil local actuel.",
      }),
    }, { status: 403 });
  }

  if (publicUrl && !isSafeHttpUrl(publicUrl)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "外部附件链接必须是有效的 http(s) 地址。",
        en: "External attachment URLs must be valid http(s) links.",
        ja: "外部添付 URL には有効な http(s) リンクを指定してください。",
        fr: "Les URL de pieces jointes externes doivent etre des liens http(s) valides.",
      }),
    }, { status: 400 });
  }

  if (!publicUrl) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "元数据附件必须提供外部链接；本地文件请使用文件上传。",
        en: "Metadata attachments must include an external URL. Use file upload for local files.",
        ja: "メタデータ添付には外部 URL が必要です。ローカルファイルはファイルアップロードを使用してください。",
        ko: "메타데이터 첨부에는 외부 URL이 필요합니다. 로컬 파일은 파일 업로드를 사용하세요.",
        fr: "Les pieces jointes de metadonnees doivent inclure une URL externe. Utilisez le televersement de fichier pour les fichiers locaux.",
        ru: "Для вложений-метаданных требуется внешний URL. Для локальных файлов используйте загрузку файла.",
      }),
    }, { status: 400 });
  }

  if (!isAllowed(kind, settings)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "当前设置未启用该类型附件上传。",
        en: "This attachment type is disabled in Settings.",
        ja: "この添付種別は設定で無効になっています。",
        fr: "Ce type de piece jointe est desactive dans les parametres.",
      }),
    }, { status: 400 });
  }

  const result = await addAttachment(project, {
    name: safeName,
    kind,
    mimeType: payload.mimeType ?? "application/octet-stream",
    sizeBytes: payload.sizeBytes ?? 0,
    uploadedByParticipantId: participantId || access.ownedParticipantIds[0],
    storage: publicUrl ? "external" : "local",
    localPath: publicUrl ? undefined : path.join("data", "uploads", projectId, safeName),
    publicUrl: publicUrl || undefined,
    note: sanitizeOptionalText(payload.note, 240),
  });

  return NextResponse.json({ state: sanitizeCollaborationStateForClient(result.state), attachment: sanitizeRoomAttachmentForClient(result.attachment) }, { status: 201 });
}
