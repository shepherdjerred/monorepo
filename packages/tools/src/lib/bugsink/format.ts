import type { BugsinkIssueLevel } from "./types.ts";

export function getLevelEmoji(level: BugsinkIssueLevel): string {
  switch (level) {
    case "fatal":
      return "\uD83D\uDCA5";
    case "error":
      return "\uD83D\uDD34";
    case "warning":
      return "\uD83D\uDFE1";
    case "info":
      return "\uD83D\uDD35";
    case "debug":
      return "\u26AA";
  }
}
