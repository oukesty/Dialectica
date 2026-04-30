import { describe, expect, it } from "vitest";
import { getShortcutForAction, matchesShortcutAction, shortcutDefinitions } from "@/lib/keyboard-shortcuts";

describe("keyboard shortcuts", () => {
  it("matches every settings-exposed shortcut action with defaults", () => {
    const actions = shortcutDefinitions.map((shortcut) => shortcut.action);
    expect(actions).toEqual(["globalSearch", "newProject", "search", "help", "close"]);

    expect(matchesShortcutAction({ key: "k", ctrlKey: true }, "globalSearch")).toBe(true);
    expect(matchesShortcutAction({ key: "n", ctrlKey: true }, "newProject")).toBe(true);
    expect(matchesShortcutAction({ key: "f", ctrlKey: true }, "search")).toBe(true);
    expect(matchesShortcutAction({ key: "/", ctrlKey: true }, "help")).toBe(true);
    expect(matchesShortcutAction({ key: "Escape" }, "close")).toBe(true);
  });

  it("uses custom shortcuts for all actions and disables the replaced default", () => {
    const customShortcuts = {
      globalSearch: "Ctrl+Shift+K",
      newProject: "Alt+N",
      search: "Ctrl+Shift+F",
      help: "Alt+/",
      close: "Ctrl+.",
    };

    expect(matchesShortcutAction({ key: "K", ctrlKey: true, shiftKey: true }, "globalSearch", customShortcuts)).toBe(true);
    expect(matchesShortcutAction({ key: "k", ctrlKey: true }, "globalSearch", customShortcuts)).toBe(false);
    expect(matchesShortcutAction({ key: "N", altKey: true }, "newProject", customShortcuts)).toBe(true);
    expect(matchesShortcutAction({ key: "F", ctrlKey: true, shiftKey: true }, "search", customShortcuts)).toBe(true);
    expect(matchesShortcutAction({ key: "/", altKey: true }, "help", customShortcuts)).toBe(true);
    expect(matchesShortcutAction({ key: ".", ctrlKey: true }, "close", customShortcuts)).toBe(true);
  });

  it("falls back to defaults when a custom shortcut is empty or malformed", () => {
    const customShortcuts = {
      globalSearch: "",
      close: "Ctrl+",
    };

    expect(getShortcutForAction("globalSearch", customShortcuts)).toBe("Ctrl+K");
    expect(matchesShortcutAction({ key: "k", ctrlKey: true }, "globalSearch", customShortcuts)).toBe(true);
    expect(getShortcutForAction("close", customShortcuts)).toBe("Esc");
    expect(matchesShortcutAction({ key: "Escape" }, "close", customShortcuts)).toBe(true);
  });
});
