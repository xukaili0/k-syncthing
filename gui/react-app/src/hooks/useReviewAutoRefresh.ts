import { useEffect } from "react";

type ReviewAutoRefreshOptions = {
  enabled: boolean;
  paused?: boolean;
  intervalSeconds: number;
  onInitialRefresh: () => Promise<void>;
  onIntervalRefresh: () => Promise<void>;
};

export function useReviewAutoRefresh({
  enabled,
  paused = false,
  intervalSeconds,
  onInitialRefresh,
  onIntervalRefresh,
}: ReviewAutoRefreshOptions) {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let running = false;
    const run = async (refresh: () => Promise<void>) => {
      if (cancelled || running || document.visibilityState === "hidden") return;
      running = true;
      try {
        await refresh();
      } finally {
        running = false;
      }
    };

    void run(onInitialRefresh);
    if (paused) return () => {
      cancelled = true;
    };

    const handle = window.setInterval(() => {
      void run(onIntervalRefresh);
    }, Math.max(1, intervalSeconds) * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void run(onIntervalRefresh);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, intervalSeconds, onInitialRefresh, onIntervalRefresh, paused]);
}
