"use client";

import { useEffect, useState } from "react";

/**
 * Acquires a Screen Wake Lock while `active` is true so mobile phones
 * do not dim or lock mid-conversation. Gracefully no-ops if unsupported.
 */
export function useWakeLock(active: boolean): boolean {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const requestLock = async () => {
      try {
        const wl = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await wl.release();
          return;
        }
        sentinel = wl;
        setLocked(true);
        wl.addEventListener("release", () => {
          if (!cancelled) setLocked(false);
        });
      } catch {
        if (!cancelled) setLocked(false);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        void requestLock();
      }
    };

    void requestLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      setLocked(false);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (sentinel) {
        void sentinel.release().catch(() => {});
      }
    };
  }, [active]);

  return active && locked;
}
