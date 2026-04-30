export const SHORTCUT_SETTINGS_UPDATED_EVENT = "dialectica:settings-updated";

export const shortcutDefinitions = [
  { action: "globalSearch", defaultKeys: "Ctrl+K", label: "shortcuts.globalSearch" },
  { action: "newProject", defaultKeys: "Ctrl+N", label: "shortcuts.newProject" },
  { action: "search", defaultKeys: "Ctrl+F", label: "shortcuts.search" },
  { action: "help", defaultKeys: "Ctrl+/", label: "shortcuts.help" },
  { action: "close", defaultKeys: "Esc", label: "shortcuts.close" },
] as const;

export type ShortcutAction = typeof shortcutDefinitions[number]["action"];

export type ShortcutEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

type ParsedShortcut = {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
};

const defaultShortcutByAction = new Map<ShortcutAction, string>(
  shortcutDefinitions.map((shortcut) => [shortcut.action, shortcut.defaultKeys]),
);

function normalizeKey(input: string) {
  const key = input.trim();
  if (!key) return "";
  const lower = key.toLowerCase();
  if (lower === "esc") return "escape";
  if (lower === "space") return " ";
  if (lower === "slash") return "/";
  return lower.length === 1 ? lower : lower;
}

export function parseShortcutCombo(input: string | undefined): ParsedShortcut | null {
  if (!input) return null;
  const parts = input.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let ctrl = false;
  let alt = false;
  let shift = false;
  let key = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control" || lower === "cmd" || lower === "meta" || lower === "⌘") {
      ctrl = true;
      continue;
    }
    if (lower === "alt" || lower === "option") {
      alt = true;
      continue;
    }
    if (lower === "shift") {
      shift = true;
      continue;
    }
    key = normalizeKey(part);
  }

  return key ? { key, ctrl, alt, shift } : null;
}

export function getShortcutForAction(action: ShortcutAction, customShortcuts?: Record<string, string>) {
  const custom = parseShortcutCombo(customShortcuts?.[action]);
  if (custom) return customShortcuts?.[action] ?? defaultShortcutByAction.get(action) ?? "";
  return defaultShortcutByAction.get(action) ?? "";
}

export function matchesShortcut(event: ShortcutEventLike, shortcut: string | undefined) {
  const parsed = parseShortcutCombo(shortcut);
  if (!parsed) return false;

  const eventKey = normalizeKey(event.key);
  const eventHasCtrl = Boolean(event.ctrlKey || event.metaKey);
  const eventHasAlt = Boolean(event.altKey);
  const eventHasShift = Boolean(event.shiftKey);

  return parsed.key === eventKey
    && parsed.ctrl === eventHasCtrl
    && parsed.alt === eventHasAlt
    && parsed.shift === eventHasShift;
}

export function matchesShortcutAction(
  event: ShortcutEventLike,
  action: ShortcutAction,
  customShortcuts?: Record<string, string>,
) {
  return matchesShortcut(event, getShortcutForAction(action, customShortcuts));
}
