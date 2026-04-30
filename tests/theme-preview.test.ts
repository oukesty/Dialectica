import { describe, expect, it } from "vitest";
import { applyAppearanceSettings, defaultCustomTheme, themeStorageKeys } from "@/lib/theme";

function createDomHarness() {
  const styleMap = new Map<string, string>();
  const classSet = new Set<string>();
  const storage = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty(name: string, value: string) {
        styleMap.set(name, value);
      },
      removeProperty(name: string) {
        styleMap.delete(name);
      },
    },
    classList: {
      toggle(name: string, force?: boolean) {
        const shouldEnable = typeof force === "boolean" ? force : !classSet.has(name);
        if (shouldEnable) {
          classSet.add(name);
        } else {
          classSet.delete(name);
        }
      },
      contains(name: string) {
        return classSet.has(name);
      },
    },
  };

  return {
    root,
    styleMap,
    classSet,
    storage,
    windowValue: {
      matchMedia: () => ({ matches: false }),
      localStorage: {
        setItem(key: string, value: string) {
          storage.set(key, value);
        },
        getItem(key: string) {
          return storage.get(key) ?? null;
        },
      },
    },
  };
}

describe("appearance preview persistence", () => {
  it("updates the document for preview without writing storage", () => {
    const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    const originalDocument = (globalThis as typeof globalThis & { document?: unknown }).document;
    const harness = createDomHarness();

    Object.defineProperty(globalThis, "window", { configurable: true, value: harness.windowValue });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { documentElement: harness.root },
    });

    try {
      applyAppearanceSettings({
        theme: "dark",
        preset: "midnight",
        reduceMotion: true,
        customTheme: defaultCustomTheme,
        persist: false,
      });

      expect(harness.root.classList.contains("dark")).toBe(true);
      expect(harness.root.dataset.themePreset).toBe("midnight");
      expect(harness.root.dataset.motion).toBe("reduce");
      expect(harness.storage.size).toBe(0);
    } finally {
      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      }
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, "document");
      } else {
        Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
      }
    }
  });

  it("writes storage only for persisted appearance changes", () => {
    const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    const originalDocument = (globalThis as typeof globalThis & { document?: unknown }).document;
    const harness = createDomHarness();

    Object.defineProperty(globalThis, "window", { configurable: true, value: harness.windowValue });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { documentElement: harness.root },
    });

    try {
      applyAppearanceSettings({
        theme: "light",
        preset: "dialectica",
        reduceMotion: false,
        customTheme: defaultCustomTheme,
        persist: true,
      });

      expect(harness.storage.get(themeStorageKeys.theme)).toBe("light");
      expect(harness.storage.get(themeStorageKeys.preset)).toBe("dialectica");
      expect(harness.storage.get(themeStorageKeys.motion)).toBe("false");
      expect(harness.storage.get(themeStorageKeys.custom)).toContain("primary");
    } finally {
      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      }
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, "document");
      } else {
        Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
      }
    }
  });
});
