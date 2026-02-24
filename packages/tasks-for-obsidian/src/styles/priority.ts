import { StyleSheet } from "react-native";
import type { Priority } from "../domain/priority";
import { PRIORITY_COLORS } from "../domain/priority";

export const priorityStyles = StyleSheet.create({
  highest: { color: PRIORITY_COLORS.highest },
  high: { color: PRIORITY_COLORS.high },
  medium: { color: PRIORITY_COLORS.medium },
  normal: { color: PRIORITY_COLORS.normal },
  low: { color: PRIORITY_COLORS.low },
  none: { color: PRIORITY_COLORS.none },
});

export function getPriorityStyle(priority: Priority) {
  return priorityStyles[priority];
}
