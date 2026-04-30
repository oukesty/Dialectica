"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  LOCAL_IDENTITY_COOKIE,
  LOCAL_IDENTITY_STORAGE_KEY,
  readLocalIdentityCookie,
  resolvePreferredLocalIdentityId,
} from "@/lib/local-identity";

export function LocalIdentitySync({
  serverIdentityId,
}: {
  serverIdentityId: string;
}) {
  const router = useRouter();
  const refreshed = useRef(false);

  useEffect(() => {
    const storedIdentity = window.localStorage.getItem(LOCAL_IDENTITY_STORAGE_KEY)?.trim() || "";
    const cookieIdentity = readLocalIdentityCookie(document.cookie);
    const nextIdentity = resolvePreferredLocalIdentityId({
      storedIdentity,
      cookieIdentity,
      serverIdentityId,
    });
    const hasStoredIdentity = Boolean(storedIdentity);
    const hasCookieIdentity = Boolean(cookieIdentity);

    if (!hasStoredIdentity || storedIdentity !== nextIdentity) {
      window.localStorage.setItem(LOCAL_IDENTITY_STORAGE_KEY, nextIdentity);
    }

    if (cookieIdentity !== nextIdentity) {
      document.cookie = `${LOCAL_IDENTITY_COOKIE}=${encodeURIComponent(nextIdentity)}; path=/; max-age=31536000; samesite=lax`;
    }

    const shouldRefreshServerTree = nextIdentity !== serverIdentityId && (!hasCookieIdentity || !hasStoredIdentity);
    if (shouldRefreshServerTree && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [router, serverIdentityId]);

  return null;
}
