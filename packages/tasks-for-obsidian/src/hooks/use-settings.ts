import { useSettingsContext } from "../state/SettingsContext";

export function useSettings() {
  return useSettingsContext();
}
