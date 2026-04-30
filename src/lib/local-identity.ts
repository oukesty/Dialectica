import { createScopedId } from "@/lib/utils";

export const LOCAL_IDENTITY_COOKIE = "dialectica-profile-id";
export const LOCAL_IDENTITY_STORAGE_KEY = "dialectica-local-identity";

export function createLocalIdentityId() {
  return createScopedId("profile", 16);
}

function trimIdentity(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export function readLocalIdentityCookie(cookieSource: string) {
  const needle = `${LOCAL_IDENTITY_COOKIE}=`;
  const value = cookieSource
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(needle));
  return value ? decodeURIComponent(value.slice(needle.length)).trim() : "";
}

export function resolvePreferredLocalIdentityId({
  storedIdentity,
  cookieIdentity,
  serverIdentityId,
}: {
  storedIdentity?: string | null;
  cookieIdentity?: string | null;
  serverIdentityId?: string | null;
}) {
  return trimIdentity(storedIdentity)
    || trimIdentity(cookieIdentity)
    || trimIdentity(serverIdentityId)
    || createLocalIdentityId();
}

export function getBrowserLocalIdentityId(serverIdentityId = "") {
  if (typeof window === "undefined") {
    return trimIdentity(serverIdentityId);
  }

  const storedIdentity = window.localStorage.getItem(LOCAL_IDENTITY_STORAGE_KEY);
  const cookieIdentity = typeof document !== "undefined" ? readLocalIdentityCookie(document.cookie) : "";
  return resolvePreferredLocalIdentityId({
    storedIdentity,
    cookieIdentity,
    serverIdentityId,
  });
}
