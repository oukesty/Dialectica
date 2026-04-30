export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProvider } from "@/lib/providers/registry";
import { getProviderDescriptor, isProviderModelSupported, normalizeProviderModel } from "@/lib/providers/provider-catalog";
import { providerRuntimeConfigSchema } from "@/lib/schema";
import { getSettings } from "@/lib/data/repository";
import { AppLocale, ProviderId, ProviderRuntimeConfig } from "@/lib/types";
import { isLocale } from "@/lib/i18n";

function localize(locale: AppLocale, values: Partial<Record<AppLocale, string>> & { en: string }) {
  return values[locale] ?? values.en;
}

function mergeRuntimeConfig(fallbackConfig: ProviderRuntimeConfig, incomingConfig: unknown, providerId: ProviderId) {
  const incoming = incomingConfig && typeof incomingConfig === "object"
    ? incomingConfig as Partial<ProviderRuntimeConfig>
    : {};
  const requestedApiKey = typeof incoming.apiKey === "string" ? incoming.apiKey.trim() : "";
  const shouldClearStoredKey = Boolean((incoming as Partial<ProviderRuntimeConfig>).clearStoredApiKey);
  const nextApiKey = requestedApiKey.length > 0
    ? requestedApiKey
    : shouldClearStoredKey
      ? ""
      : fallbackConfig.apiKey;

  return {
    ...fallbackConfig,
    ...incoming,
    apiKey: nextApiKey,
    providerId,
  };
}

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    providerId?: ProviderId;
    config?: unknown;
    locale?: string;
    preferServerKeys?: boolean;
    requestTimeoutMs?: number;
  };

  const settings = await getSettings();
  const providerId = payload.providerId ?? settings.provider.activeProviderId;
  const locale = isLocale(payload.locale ?? "") ? (payload.locale as AppLocale) : settings.locale;
  const fallbackConfig = settings.provider.providers[providerId];
  const config = providerRuntimeConfigSchema.parse(mergeRuntimeConfig(fallbackConfig, payload.config, providerId));

  const descriptor = getProviderDescriptor(providerId);
  const normalizedModel = normalizeProviderModel(providerId, config.model);
  if (config.model && !isProviderModelSupported(providerId, config.model)) {
    return NextResponse.json(
      {
        error: localize(locale, {
          "zh-CN": `${providerId} 不支持模型 ${config.model}。请选择该提供方目录中的可用模型。`,
          en: `${providerId} does not support model ${config.model}. Choose one of the models listed for this provider.`,
          ja: `${providerId} はモデル ${config.model} をサポートしていません。このプロバイダーのカタログにあるモデルを選択してください。`,
          fr: `${providerId} ne prend pas en charge le modèle ${config.model}. Choisissez un modèle présent dans le catalogue de ce fournisseur.`,
        }),
      },
      { status: 400 },
    );
  }

  if (providerId === "disabled") {
    return NextResponse.json({
      error: localize(locale, {
        "zh-CN": "当前处于已禁用适配状态。这个 Provider / 模式不能执行远程调用，因此没有可测试的远程连接。请切换到支持执行的 Provider。",
        en: "The disabled adapter state is active. This provider / mode cannot execute remote calls, so there is no remote connection to test. Switch to an execution-capable provider.",
        ja: "無効化アダプター状態です。この Provider / モードではリモート呼び出しを実行できないため、接続テスト対象がありません。実行可能な Provider に切り替えてください。",
        ko: "비활성화된 어댑터 상태입니다. 이 Provider / 모드는 원격 호출을 실행할 수 없으므로 테스트할 원격 연결이 없습니다. 실행 가능한 Provider로 전환하세요.",
        fr: "L etat d adaptateur desactive est actif. Ce provider / mode ne peut pas executer d appels distants ; il n y a donc aucune connexion distante a tester. Basculez vers un provider executable.",
        ru: "Активно состояние отключенного адаптера. Этот провайдер / режим не может выполнять удаленные вызовы, поэтому удаленное соединение для проверки отсутствует. Переключитесь на исполняемый провайдер.",
      }),
    }, { status: 409 });
  }

  const provider = getProvider(providerId);
  const rawResult = await provider.testConnection({
    ...config,
    mode: descriptor?.mode ?? config.mode,
    model: normalizedModel,
  }, {
    preferServerKeys: typeof payload.preferServerKeys === "boolean" ? payload.preferServerKeys : settings.provider.preferServerKeys,
    requestTimeoutMs: typeof payload.requestTimeoutMs === "number" ? payload.requestTimeoutMs : settings.provider.requestTimeoutMs,
  });
  const prefix = rawResult.ok
    ? localize(locale, {
        "zh-CN": `${providerId} 连接测试通过。`,
        en: `${providerId} connection test succeeded.`,
        ja: `${providerId} の接続テストに成功しました。`,
        fr: `Le test de connexion ${providerId} a réussi.`,
      })
    : localize(locale, {
        "zh-CN": `${providerId} 连接测试未通过。`,
        en: `${providerId} connection test failed.`,
        ja: `${providerId} の接続テストに失敗しました。`,
        fr: `Le test de connexion ${providerId} a échoué.`,
      });
  const message = rawResult.message ? `${prefix} ${rawResult.message}` : prefix;

  return NextResponse.json({
    result: {
      ...rawResult,
      message,
    },
  });
}
