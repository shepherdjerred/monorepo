import { useEffect, useRef } from "react";
import { AppState } from "react-native";

export function useAppState(onForeground: () => void) {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (/inactive|background/.test(appState.current) && next === "active") {
        onForeground();
      }
      appState.current = next;
    });
    return () => {
      sub.remove();
    };
  }, [onForeground]);
}
