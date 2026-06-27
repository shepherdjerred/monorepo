import { z } from "zod";
import { match } from "ts-pattern";

export type QueueType = z.infer<typeof QueueTypeSchema>;
export const QueueTypeSchema = z.enum([
  "solo",
  "flex",
  "ranked 5s",
  "clash",
  "aram clash",
  "aram",
  "arurf",
  "urf",
  "quickplay",
  "swiftplay",
  "arena",
  "brawl",
  "aram mayhem",
  "draft pick",
  "easy doom bots",
  "normal doom bots",
  "hard doom bots",
  "custom",
]);

const ARENA_QUEUE_ID = 1700;
const ARENA_GAME_MODE = "CHERRY";

// Most queue IDs come from Riot's queues.json. Some are absent from that file
// but show up in live Spectator payloads: 3200/3220 for ARAM: Mayhem on Howling
// Abyss, and 710 — the revived premade "Ranked 5s" queue on Summoner's Rift,
// which Riot's published queues.json still labels as the long-defunct original.
export function parseQueueType(input: number): QueueType | undefined {
  return match(input)
    .returnType<QueueType | undefined>()
    .with(0, () => "custom")
    .with(420, () => "solo")
    .with(400, () => "draft pick")
    .with(440, () => "flex")
    .with(450, () => "aram")
    .with(700, () => "clash")
    .with(710, () => "ranked 5s")
    .with(720, () => "aram clash")
    .with(480, () => "swiftplay")
    .with(490, () => "quickplay")
    .with(900, () => "arurf")
    .with(ARENA_QUEUE_ID, () => "arena")
    .with(2300, () => "brawl")
    .with(2400, () => "aram mayhem")
    .with(3200, () => "aram mayhem")
    .with(3220, () => "aram mayhem")
    .with(3270, () => "aram mayhem")
    .with(3100, () => "custom")
    .with(1900, () => "urf")
    .with(3130, () => "easy doom bots")
    .with(4220, () => "normal doom bots")
    .with(4250, () => "hard doom bots")
    .otherwise((): QueueType | undefined => {
      console.error(`unknown queue type: ${input.toString()}`);
      return;
    });
}

export function isArenaQueueOrMode(queueId: number, gameMode: string): boolean {
  return queueId === ARENA_QUEUE_ID || gameMode === ARENA_GAME_MODE;
}

// Custom and tutorial games surface as `gameType: "CUSTOM"` (Spectator V5) or
// `"CUSTOM_GAME"` (Match V5). Riot does not publish a stable queue ID for these,
// so live payloads carry ad-hoc values (e.g. 3110 for a custom Summoner's Rift
// draft) that are absent from queues.json and therefore unmapped by
// `parseQueueType`. Detect them by game type instead.
function isCustomGameType(gameType: string | undefined): boolean {
  return gameType?.toUpperCase().startsWith("CUSTOM") ?? false;
}

export function resolveQueueTypeFromGame(
  queueId: number,
  gameMode: string,
  gameType?: string,
): QueueType | undefined {
  if (isArenaQueueOrMode(queueId, gameMode)) {
    return "arena";
  }
  const mapped = parseQueueType(queueId);
  if (mapped !== undefined) {
    return mapped;
  }
  // Unknown queue ID: only treat as "custom" when the payload says so. A
  // genuinely-new ranked/normal queue still resolves to undefined (unchanged
  // behavior for callers that don't pass gameType).
  if (isCustomGameType(gameType)) {
    return "custom";
  }
  return undefined;
}

export function queueTypeToDisplayString(queueType: QueueType): string {
  return match(queueType)
    .returnType<string>()
    .with("solo", () => "ranked solo")
    .with("flex", () => "ranked flex")
    .with("ranked 5s", () => "ranked 5s")
    .with("clash", () => "clash")
    .with("aram clash", () => "ARAM clash")
    .with("aram", () => "ARAM")
    .with("arurf", () => "ARURF")
    .with("urf", () => "URF")
    .with("arena", () => "arena")
    .with("brawl", () => "brawl")
    .with("aram mayhem", () => "ARAM mayhem")
    .with("easy doom bots", () => "doom bots")
    .with("normal doom bots", () => "doom bots")
    .with("hard doom bots", () => "doom bots")
    .with("custom", () => "custom")
    .with("draft pick", () => "draft pick")
    .with("quickplay", () => "quickplay")
    .with("swiftplay", () => "swiftplay")
    .exhaustive();
}
