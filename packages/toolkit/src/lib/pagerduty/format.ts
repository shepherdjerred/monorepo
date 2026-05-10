import type { PagerDutyIncidentStatus } from "./types.ts";

export function getStatusEmoji(status: PagerDutyIncidentStatus): string {
  switch (status) {
    case "triggered":
      return "\uD83D\uDD34";
    case "acknowledged":
      return "\uD83D\uDFE1";
    case "resolved":
      return "\uD83D\uDFE2";
  }
}
