"use client";

import { createContext, ReactNode, useContext, useMemo } from "react";
import { AppLocale } from "@/lib/types";
import { Dictionary, getNestedValue } from "@/lib/i18n";

interface I18nContextValue {
  locale: AppLocale;
  dictionary: Dictionary;
  t: (path: string, params?: Record<string, string>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({
  children,
  dictionary,
  locale,
}: {
  children: ReactNode;
  dictionary: Dictionary;
  locale: AppLocale;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dictionary,
      t(path, params) {
        const found = getNestedValue(dictionary, path);
        if (typeof found !== "string") {
          return path;
        }
        if (!params) {
          return found;
        }
        return Object.entries(params).reduce(
          (value, [key, replacement]) => value.replaceAll('{' + key + '}', replacement),
          found,
        );
      },
    }),
    [dictionary, locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider.");
  }
  return context;
}

