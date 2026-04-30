export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createDefaultSettings, resolveProfileDisplayName } from "@/lib/factories";
import { sanitizeAvatarDataUrl, normalizeAvatarPreset } from "@/lib/avatar";
import { getSettings, saveSettings, saveSettingsPatch } from "@/lib/data/repository";
import { hasSettingsConflict, mergeDeep, SettingsPatch } from "@/lib/settings-update";
import { appendAuditLog } from "@/lib/audit";
import { LOCAL_IDENTITY_COOKIE } from "@/lib/local-identity";
import { isProviderModelSupported } from "@/lib/providers/provider-catalog";
import { APP_LOCALES, PROVIDER_IDS, type AppLocale, type AppSettings, type ProviderId } from "@/lib/types";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function resolveLocale(value: unknown): AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value)
    ? (value as AppLocale)
    : "zh-CN";
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

function findInvalidProviderModel(settingsLike: unknown): { providerId: ProviderId; model: string } | null {
  if (!settingsLike || typeof settingsLike !== "object") {
    return null;
  }

  const providerSection = (settingsLike as { provider?: { providers?: unknown } }).provider;
  const providers = providerSection && typeof providerSection === "object"
    ? (providerSection as { providers?: unknown }).providers
    : undefined;

  if (!providers || typeof providers !== "object") {
    return null;
  }

  for (const [providerId, config] of Object.entries(providers as Record<string, unknown>)) {
    if (!isProviderId(providerId) || !config || typeof config !== "object") {
      continue;
    }
    const model = typeof (config as { model?: unknown }).model === "string"
      ? (config as { model?: string }).model?.trim() ?? ""
      : "";
    if (model && !isProviderModelSupported(providerId, model)) {
      return { providerId, model };
    }
  }

  return null;
}

function invalidProviderModelResponse(locale: AppLocale, providerId: ProviderId, model: string) {
  return NextResponse.json({
    error: localize(locale, {
      "zh-CN": `${providerId} 不支持模型 ${model}。请只保存该 Provider 目录中的可用模型。`,
      en: `${providerId} does not support model ${model}. Save only models that belong to this provider.`,
      ja: `${providerId} はモデル ${model} をサポートしていません。この Provider に属するモデルだけを保存してください。`,
      ko: `${providerId} 공급자는 모델 ${model}을 지원하지 않습니다. 이 공급자 카탈로그에 속한 모델만 저장하세요.`,
      fr: `${providerId} ne prend pas en charge le modele ${model}. Enregistrez uniquement un modele appartenant a ce fournisseur.`,
      ru: `${providerId} не поддерживает модель ${model}. Сохраняйте только модели из каталога этого провайдера.`,
    }),
  }, { status: 400 });
}

function withProfileDefaults(value: unknown): AppSettings {
  const payload = (value && typeof value === "object" ? value : {}) as Partial<AppSettings> & {
    profile?: Partial<AppSettings["profile"]>;
  };
  const locale = resolveLocale(payload.locale);
  const defaults = createDefaultSettings(locale);
  const nextDisplayName = typeof payload.profile?.displayName === "string" && payload.profile.displayName.trim()
    ? payload.profile.displayName.trim()
    : payload.profile?.displayName ?? defaults.profile.displayName;
  const resolvedDisplayName = resolveProfileDisplayName(
    locale,
    nextDisplayName,
    typeof payload.profile?.displayNameIsDefault === "boolean" ? payload.profile.displayNameIsDefault : undefined,
  );

  return {
    ...defaults,
    ...payload,
    locale,
    profile: {
      ...defaults.profile,
      ...payload.profile,
      displayName: resolvedDisplayName.displayName,
      displayNameIsDefault: resolvedDisplayName.displayNameIsDefault,
      avatarPreset: normalizeAvatarPreset(payload.profile?.avatarPreset, resolvedDisplayName.displayName || defaults.profile.displayName),
      avatarImageDataUrl: sanitizeAvatarDataUrl(payload.profile?.avatarImageDataUrl),
    },
  } as AppSettings;
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

export async function GET(request: NextRequest) {
  const requestedIdentityId = request.nextUrl.searchParams.get("identityId")?.trim() || undefined;
  const settings = withProfileDefaults(await getSettings({ includeSecrets: false, identityId: requestedIdentityId }));
  const response = NextResponse.json({ settings });
  const requestIdentityId = request.cookies.get(LOCAL_IDENTITY_COOKIE)?.value;
  return requestIdentityId === settings.profile.localIdentityId ? response : attachIdentityCookie(response, settings.profile.localIdentityId);
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await request.json();
    const nextSettings = withProfileDefaults(payload);
    const invalidProviderModel = findInvalidProviderModel(nextSettings);
    if (invalidProviderModel) {
      return invalidProviderModelResponse(nextSettings.locale, invalidProviderModel.providerId, invalidProviderModel.model);
    }
    const saved = withProfileDefaults(await saveSettings(nextSettings));
    void appendAuditLog({ action: "settings.update", actorId: saved.profile.localIdentityId, actorName: saved.profile.displayName, details: "Settings updated" });
    return attachIdentityCookie(NextResponse.json({ settings: saved }), saved.profile.localIdentityId);
  } catch {
    const settings = withProfileDefaults(await getSettings({ includeSecrets: false }));
    return NextResponse.json({
      error: localize(settings.locale, {
        "zh-CN": "设置数据无效，请检查后重试。",
        en: "The settings payload is invalid. Check the submitted fields and try again.",
        ja: "設定データが無効です。送信内容を確認して再試行してください。",
        fr: "Les paramètres envoyés sont invalides. Vérifiez les champs puis réessayez.",
      }),
    }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const rawPayload = await request.json();
    const payload = (rawPayload && typeof rawPayload === "object" && ("patch" in rawPayload || "base" in rawPayload))
      ? rawPayload as { patch?: SettingsPatch; base?: SettingsPatch }
      : { patch: rawPayload as SettingsPatch, base: undefined };
    const current = withProfileDefaults(await getSettings({ includeSecrets: false }));
    if (hasSettingsConflict(current, payload.patch, payload.base)) {
      return NextResponse.json({
        code: "conflict",
        error: localize(current.locale, {
          "zh-CN": "设置已在其他标签页或窗口中变更，请先刷新到最新状态后再重试。",
          en: "Settings changed in another tab or window. Refresh to the latest state and try again.",
          ja: "設定が別のタブまたはウィンドウで更新されました。最新状態に更新してから再試行してください。",
          fr: "Les reglages ont ete modifies dans un autre onglet ou une autre fenetre. Actualisez puis reessayez.",
        }),
        currentSettings: current,
      }, { status: 409 });
    }
    const merged = withProfileDefaults(mergeDeep<AppSettings>(current, payload.patch ?? {}));
    const invalidProviderModel = findInvalidProviderModel(merged);
    if (invalidProviderModel) {
      return invalidProviderModelResponse(merged.locale, invalidProviderModel.providerId, invalidProviderModel.model);
    }
    const saved = withProfileDefaults(await saveSettingsPatch(payload.patch ?? {}));
    void appendAuditLog({ action: "settings.patch", actorId: saved.profile.localIdentityId, actorName: saved.profile.displayName, details: "Settings patched" });
    return attachIdentityCookie(NextResponse.json({ settings: saved }), saved.profile.localIdentityId);
  } catch {
    const settings = withProfileDefaults(await getSettings({ includeSecrets: false }));
    return NextResponse.json({
      error: localize(settings.locale, {
        "zh-CN": "设置增量更新失败，请检查提交字段后重试。",
        en: "The settings patch is invalid. Check the submitted fields and try again.",
        ja: "設定の差分更新に失敗しました。送信した項目を確認して再試行してください。",
        fr: "La mise à jour partielle des paramètres a échoué. Vérifiez les champs envoyés puis réessayez.",
      }),
    }, { status: 400 });
  }
}
