import type { PagerDutyIncidentStatus } from "./types.ts";

export function getStatusEmoji(status: PagerDutyIncidentStatus): string {
  switch (status) {
    case "triggered":
      return "\u{1F534}";
    case "acknowledged":
      return "\u{1F7E1}";
    case "resolved":
      return "\u{1F7E2}";
  }
}
