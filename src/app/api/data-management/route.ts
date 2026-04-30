export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { LOCAL_IDENTITY_COOKIE } from "@/lib/local-identity";
import { buildFullBackupPayload, buildRestoreSettings, parseFullBackupPayload } from "@/lib/data-management";
import {
  createProject,
  getSettings,
  isReservedProjectIdError,
  listProjectsForFullBackup,
  purgeStoredBundledSampleCopies,
  readStoredProjectSnapshot,
  restoreStoredProjectSnapshots,
  saveSettings,
} from "@/lib/data/repository";
import { AppLocale, DiscussionProject } from "@/lib/types";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function attachIdentityCookie(response: NextResponse, identityId: string) {
  response.cookies.set({
    name: LOCAL_IDENTITY_COOKIE,
    value: identityId,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

type RestoreProjectSnapshot = {
  projectId: string;
  project: DiscussionProject | null;
};

async function snapshotRestoreTargets(projects: DiscussionProject[]): Promise<RestoreProjectSnapshot[]> {
  const uniqueProjectIds = [...new Set(projects.map((project) => project.id))];
  return Promise.all(
    uniqueProjectIds.map(async (projectId) => ({
      projectId,
      project: await readStoredProjectSnapshot(projectId),
    })),
  );
}

async function rollbackRestoreState(
  previousSettings: Awaited<ReturnType<typeof getSettings>>,
  projectSnapshots: RestoreProjectSnapshot[],
  options: { restoreSettings: boolean },
) {
  if (options.restoreSettings) {
    await saveSettings(previousSettings);
  }
  await restoreStoredProjectSnapshots(projectSnapshots);
}

export async function GET() {
  const settings = await getSettings({ includeSecrets: false });
  const projects = await listProjectsForFullBackup();
  const backup = buildFullBackupPayload(settings, projects);

  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="dialectica-backup-${Date.now()}.json"`,
    },
  });
}

export async function POST(request: NextRequest) {
  const currentSettings = await getSettings();
  const locale = currentSettings.locale;

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "备份文件内容无效，请检查后重试。",
        en: "The backup payload is invalid. Check the uploaded content and try again.",
        ja: "バックアップ内容が無効です。アップロードした内容を確認して再試行してください。",
        fr: "Le contenu de la sauvegarde est invalide. Verifiez le fichier televerse puis reessayez.",
      }),
    }, { status: 400 });
  }

  let parsedBackup;
  try {
    parsedBackup = parseFullBackupPayload(rawPayload);
  } catch (error) {
    const message = error instanceof Error && error.message === "unsupported-backup-version"
      ? localize(locale, {
          "zh-CN": "该备份版本过旧，当前版本无法直接恢复。",
          en: "This backup version is too old to restore directly.",
          ja: "このバックアップのバージョンは古すぎるため、現在のバージョンでは直接復元できません。",
          fr: "Cette version de sauvegarde est trop ancienne pour etre restauree directement.",
        })
      : localize(locale, {
          "zh-CN": "备份文件结构无效，请重新导出后再试。",
          en: "The backup structure is invalid. Export a fresh backup and try again.",
          ja: "バックアップ構造が無効です。新しいバックアップを再度エクスポートしてからお試しください。",
          fr: "La structure de la sauvegarde est invalide. Reexportez une sauvegarde recente puis reessayez.",
        });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (parsedBackup.invalidProjectCount > 0 || (!parsedBackup.settings && parsedBackup.projects.length === 0)) {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "该备份文件不包含可恢复的完整项目数据，请重新导出后再试。",
        en: "This backup does not contain complete restorable project data. Export a fresh backup and try again.",
        ja: "このバックアップには復元可能な完全なプロジェクトデータが含まれていません。最新のバックアップを再度エクスポートしてください。",
        fr: "Cette sauvegarde ne contient pas de donnees de projet completes pouvant etre restaurees. Reexportez une sauvegarde recente puis reessayez.",
      }),
    }, { status: 400 });
  }

  const restoredSettings = buildRestoreSettings(currentSettings, parsedBackup.settings);
  const restoreSnapshots = await snapshotRestoreTargets(parsedBackup.projects);
  const shouldRestoreSettings = Boolean(parsedBackup.settings);
  let savedSettings = currentSettings;

  try {
    if (shouldRestoreSettings) {
      savedSettings = await saveSettings(restoredSettings);
    }

    for (const project of parsedBackup.projects) {
      await createProject(project, project.language, { settingsOverride: restoredSettings });
    }

    await purgeStoredBundledSampleCopies();
  } catch (error) {
    try {
      await rollbackRestoreState(currentSettings, restoreSnapshots, { restoreSettings: shouldRestoreSettings });
    } catch {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "恢复过程中出现异常，且自动回滚未能完整完成。请重新检查当前数据后再重试。",
          en: "Restore failed and automatic rollback could not complete cleanly. Please verify the current data before trying again.",
          ja: "復元中に異常が発生し、自動ロールバックも完全には完了できませんでした。現在のデータを確認してから再試行してください。",
          fr: "La restauration a echoue et le retour automatique n'a pas pu se terminer correctement. Verifiez les donnees actuelles avant de reessayer.",
        }),
      }, { status: 500 });
    }

    if (isReservedProjectIdError(error)) {
      return NextResponse.json({
        error: localize(locale, {
          "zh-CN": "备份中包含受保护的示例项目，已阻止写入无效数据。",
          en: "The backup contains protected sample projects, so invalid stored copies were blocked.",
          ja: "バックアップに保護されたサンプルプロジェクトが含まれていたため、無効な保存コピーを防止しました。",
          fr: "La sauvegarde contient des projets d'exemple proteges. Les copies invalides ont ete bloquees.",
        }),
      }, { status: 400 });
    }

    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "恢复未完成，系统已回滚本次导入对设置和项目的更改。请检查备份内容后重试。",
        en: "Restore did not complete. Dialectica rolled back the settings and project changes from this import. Please review the backup and try again.",
        ja: "復元は完了しませんでした。このインポートで加えた設定とプロジェクトの変更はロールバックされました。バックアップ内容を確認して再試行してください。",
        fr: "La restauration n'a pas abouti. Dialectica a annule les modifications de parametres et de projets de cette importation. Verifiez la sauvegarde puis reessayez.",
      }),
    }, { status: 500 });
  }

  const response = NextResponse.json({
    importedProjectCount: parsedBackup.projects.length,
    skippedSampleProjectIds: parsedBackup.skippedSampleProjectIds,
    settingsRestored: Boolean(parsedBackup.settings),
  });
  return attachIdentityCookie(response, savedSettings.profile.localIdentityId);
}
