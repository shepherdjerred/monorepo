import { useEffect, useRef } from "react";
import { AppState } from "react-native";

export function useAppState(onForeground: () => void) {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        onForeground();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [onForeground]);
}
