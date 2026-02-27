import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

function storageKey(tipId: string): string {
  return `@tasknotes/tip:${tipId}:dismissed`;
}

export function useTip(tipId: string): { visible: boolean; dismiss: () => void } {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      const dismissed = await AsyncStorage.getItem(storageKey(tipId));
      if (cancelled) return;
      if (dismissed !== "true") {
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
