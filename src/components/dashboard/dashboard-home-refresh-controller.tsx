"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function DashboardHomeRefreshController({
  intervalMs = 360000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    let timer = 0;
    let idleHandle = 0;
    lastRefreshRef.current = Date.now();

    const runRefresh = () => {
      lastRefreshRef.current = Date.now();
      startTransition(() => {
        router.refresh();
      });
    };

    const requestRefresh = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(() => runRefresh(), { timeout: 1200 }) as unknown as number;
        return;
      }
      runRefresh();
    };

    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!document.hidden) {
          requestRefresh();
        }
        schedule();
      }, intervalMs);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden && Date.now() - lastRefreshRef.current >= intervalMs) {
        requestRefresh();
      }
    };

    schedule();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(timer);
      if (typeof window.cancelIdleCallback === "function" && idleHandle) {
        window.cancelIdleCallback(idleHandle as unknown as number);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs, router]);

  return null;
}
