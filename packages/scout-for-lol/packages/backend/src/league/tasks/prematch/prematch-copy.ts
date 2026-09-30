import type {
  PlayerConfigEntry,
  QueueType,
} from "@scout-for-lol/data/index.ts";
import { queueTypeToDisplayString } from "@scout-for-lol/data/index.ts";

export function formatPlayerList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0] ?? ""} and ${names[1] ?? ""}`;
  const allButLast = names.slice(0, -1).join(", ");
  const last = names.at(-1) ?? "";
  return `${allButLast}, and ${last}`;
}

/**
 * Plain-text message paired with the loading-screen image.
 * Mirrors post-match's `formatGameCompletionMessage`: short, unformatted content
 * that renders above the image embed.
 */
export function formatPrematchMessage(
  trackedPlayers: PlayerConfigEntry[],
  queueType: QueueType | undefined,
  gameMode: string,
  clashSurfaceEnabled = false,
): string {
  const queueName = queueType ? queueTypeToDisplayString(queueType) : gameMode;
  const clash =
    clashSurfaceEnabled &&
    (queueType === "clash" || queueType === "aram clash");
  const noun = clash ? "match" : "game";
  const article =
    queueName === "arena" || queueName === "ARAM Clash" ? "an" : "a";
  const aliases = trackedPlayers
    .map((p) => p.alias)
    .filter((alias) => alias.trim().length > 0);
  if (aliases.length === 0) {
    return clash ? `${queueName} match started` : `Game started: ${queueName}`;
  }
  return `${formatPlayerList(aliases)} started ${article} ${queueName} ${noun}`;
}
