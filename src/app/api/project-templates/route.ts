export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getProject, getSettings } from "@/lib/data/repository";
import { getProjectAccessState } from "@/lib/project-access";
import {
  deleteProjectTemplate,
  listVisibleProjectTemplates,
  projectToTemplatePayload,
  saveProjectTemplate,
  updateProjectTemplate,
  type ProjectTemplateVisibility,
} from "@/lib/project-templates";
import { APP_LOCALES } from "@/lib/types";
import type { AppLocale } from "@/lib/types";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function resolveLocale(value: unknown): AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value) ? value as AppLocale : "en";
}

function normalizeVisibility(value: unknown): ProjectTemplateVisibility {
  return value === "shared" ? "shared" : "private";
}

function templateError(locale: AppLocale, status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function GET() {
  const settings = await getSettings({ includeSecrets: false });
  const templates = await listVisibleProjectTemplates(settings.profile.localIdentityId);
  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const settings = await getSettings({ includeSecrets: false });
  const locale = resolveLocale(settings.locale);
  try {
    const payload = await request.json();
    const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
    const project = projectId ? await getProject(projectId, locale) : null;
    if (!project || project.metadata.isSample) {
      return templateError(locale, 403, localize(locale, {
        "zh-CN": "示例项目不能保存为自定义模板。",
        en: "Bundled sample projects cannot be saved as custom templates.",
        ja: "同梱サンプルはカスタムテンプレートとして保存できません。",
        ko: "번들 예시는 사용자 템플릿으로 저장할 수 없습니다.",
        fr: "Les exemples intégrés ne peuvent pas être enregistrés comme modèles personnalisés.",
        ru: "Встроенные примеры нельзя сохранить как пользовательские шаблоны.",
      }));
    }
    const access = getProjectAccessState(project, settings);
    if (!access.canRead) {
      return templateError(locale, 403, localize(locale, {
        "zh-CN": "你没有权限读取这个项目，无法保存为模板。",
        en: "You do not have permission to read this project, so it cannot be saved as a template.",
        ja: "このプロジェクトを読む権限がないため、テンプレートとして保存できません。",
        ko: "이 프로젝트를 읽을 권한이 없어 템플릿으로 저장할 수 없습니다.",
        fr: "Vous n'avez pas l'autorisation de lire ce projet. Il ne peut donc pas être enregistré comme modèle.",
        ru: "У вас нет прав на чтение этого проекта, поэтому его нельзя сохранить как шаблон.",
      }));
    }

    const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : project.title;
    const description = typeof payload.description === "string" ? payload.description.trim() : project.description;
    const template = await saveProjectTemplate({
      ownerIdentityId: settings.profile.localIdentityId,
      ownerDisplayName: settings.profile.displayName,
      visibility: normalizeVisibility(payload.visibility),
      title,
      description,
      payload: projectToTemplatePayload(project),
    });
    return NextResponse.json({ template });
  } catch (error) {
    const message = error instanceof Error && error.message === "forbidden"
      ? localize(locale, {
          "zh-CN": "你没有权限保存这个模板。",
          en: "You do not have permission to save this template.",
          ja: "このテンプレートを保存する権限がありません。",
          ko: "이 템플릿을 저장할 권한이 없습니다.",
          fr: "Vous n'avez pas l'autorisation d'enregistrer ce modèle.",
          ru: "У вас нет прав для сохранения этого шаблона.",
        })
      : localize(locale, {
          "zh-CN": "模板保存失败，请稍后重试。",
          en: "Template save failed. Try again later.",
          ja: "テンプレートの保存に失敗しました。しばらくしてから再試行してください。",
          ko: "템플릿 저장에 실패했습니다. 잠시 후 다시 시도하세요.",
          fr: "L'enregistrement du modèle a échoué. Réessayez plus tard.",
          ru: "Не удалось сохранить шаблон. Повторите попытку позже.",
        });
    return templateError(locale, 400, message);
  }
}

export async function PATCH(request: NextRequest) {
  const settings = await getSettings({ includeSecrets: false });
  const locale = resolveLocale(settings.locale);
  try {
    const payload = await request.json();
    const templateId = typeof payload.templateId === "string" ? payload.templateId : "";
    const template = await updateProjectTemplate(settings.profile.localIdentityId, templateId, {
      title: typeof payload.title === "string" ? payload.title : undefined,
      description: typeof payload.description === "string" ? payload.description : undefined,
      visibility: normalizeVisibility(payload.visibility),
    });
    if (!template) {
      return templateError(locale, 404, localize(locale, {
        "zh-CN": "没有找到这个模板。",
        en: "Template not found.",
        ja: "テンプレートが見つかりません。",
        ko: "템플릿을 찾을 수 없습니다.",
        fr: "Modèle introuvable.",
        ru: "Шаблон не найден.",
      }));
    }
    return NextResponse.json({ template });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "forbidden";
    return templateError(locale, forbidden ? 403 : 400, forbidden
      ? localize(locale, {
          "zh-CN": "只能编辑自己保存的模板。",
          en: "You can edit only templates you saved.",
          ja: "編集できるのは自分が保存したテンプレートだけです。",
          ko: "직접 저장한 템플릿만 편집할 수 있습니다.",
          fr: "Vous ne pouvez modifier que les modèles que vous avez enregistrés.",
          ru: "Можно редактировать только свои шаблоны.",
        })
      : localize(locale, {
          "zh-CN": "模板更新失败，请检查后重试。",
          en: "Template update failed. Check the fields and try again.",
          ja: "テンプレートの更新に失敗しました。内容を確認して再試行してください。",
          ko: "템플릿 업데이트에 실패했습니다. 항목을 확인하고 다시 시도하세요.",
          fr: "La mise à jour du modèle a échoué. Vérifiez les champs puis réessayez.",
          ru: "Не удалось обновить шаблон. Проверьте поля и повторите попытку.",
        }));
  }
}

export async function DELETE(request: NextRequest) {
  const settings = await getSettings({ includeSecrets: false });
  const locale = resolveLocale(settings.locale);
  try {
    const payload = await request.json();
    const templateId = typeof payload.templateId === "string" ? payload.templateId : "";
    const deleted = await deleteProjectTemplate(settings.profile.localIdentityId, templateId);
    if (!deleted) {
      return templateError(locale, 404, localize(locale, {
        "zh-CN": "没有找到这个模板。",
        en: "Template not found.",
        ja: "テンプレートが見つかりません。",
        ko: "템플릿을 찾을 수 없습니다.",
        fr: "Modèle introuvable.",
        ru: "Шаблон не найден.",
      }));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "forbidden";
    return templateError(locale, forbidden ? 403 : 400, forbidden
      ? localize(locale, {
          "zh-CN": "只能删除自己保存的模板。",
          en: "You can delete only templates you saved.",
          ja: "削除できるのは自分が保存したテンプレートだけです。",
          ko: "직접 저장한 템플릿만 삭제할 수 있습니다.",
          fr: "Vous ne pouvez supprimer que les modèles que vous avez enregistrés.",
          ru: "Можно удалять только свои шаблоны.",
        })
      : localize(locale, {
          "zh-CN": "模板删除失败，请稍后重试。",
          en: "Template deletion failed. Try again later.",
          ja: "テンプレートの削除に失敗しました。しばらくしてから再試行してください。",
          ko: "템플릿 삭제에 실패했습니다. 잠시 후 다시 시도하세요.",
          fr: "La suppression du modèle a échoué. Réessayez plus tard.",
          ru: "Не удалось удалить шаблон. Повторите попытку позже.",
        }));
  }
}
