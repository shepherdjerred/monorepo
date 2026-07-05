import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

function storageKey(tipId: string): string {
  return `@tasknotes/tip:${tipId}:dismissed`;
}

/**
 * Global kill switch, set by the __DEV__-only e2e-config deep link
 * (`tips=off`): first-run tip popovers appear on a delayed timer and can
 * swallow taps aimed at the controls beneath them, which makes UI tests
 * unbearably racy.
 */
export const TIPS_DISABLED_KEY = "@tasknotes/tips-disabled";

export function useTip(tipId: string): {
  visible: boolean;
  dismiss: () => void;
} {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      const [disabled, dismissed] = await Promise.all([
        AsyncStorage.getItem(TIPS_DISABLED_KEY),
        AsyncStorage.getItem(storageKey(tipId)),
      ]);
      if (cancelled) return;
      if (disabled !== "true" && dismissed !== "true") {
        timer = setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, 500);
      }
    }

    void check();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [tipId]);

  const dismiss = useCallback(() => {
    setVisible(false);
    void AsyncStorage.setItem(storageKey(tipId), "true");
  }, [tipId]);

  return { visible, dismiss };
}
