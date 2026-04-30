import { clsx } from "clsx";

function randomHex(byteLength: number) {
  const safeLength = Math.max(1, byteLength);
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(safeLength);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return Array.from({ length: safeLength }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
}

export function cn(...values: Array<string | false | null | undefined>) {
  return clsx(values);
}

export function createId(prefix: string) {
  const unique = typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replace(/-/g, "")
    : randomHex(16);
  return `${prefix}_${unique.slice(0, 12)}`;
}

export function createScopedId(prefix: string, length = 16) {
  const safeLength = Math.max(6, Math.floor(length));
  const unique = typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replace(/-/g, "")
    : randomHex(Math.ceil(safeLength / 2));
  return `${prefix}_${unique.slice(0, safeLength)}`;
}
export function createSecureToken(length = 12) {
  return randomHex(length).slice(0, length * 2);
}

export function normalizeAvatarLabel(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[?？\uFFFD]/g, "")
    .trim()
    .slice(0, 2);
}

export function pickInitials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "DL";
  }
  if (parts.length === 1) {
    return normalizeAvatarLabel(parts[0].slice(0, 1).toUpperCase()) || "DL";
  }
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return normalizeAvatarLabel(initials) || "DL";
}

export function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizePlainText(value: string, maxLength = 4000) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeOptionalText(value: string | undefined, maxLength = 4000) {
  if (!value) return "";
  return sanitizePlainText(value, maxLength);
}

export function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || createId("slug");
}