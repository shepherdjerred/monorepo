import { z } from "zod";
import { match } from "ts-pattern";

export type QueueType = z.infer<typeof QueueTypeSchema>;
export const QueueTypeSchema = z.enum([
  "solo",
  "flex",
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

// Most queue IDs come from Riot's queues.json. Queue 3200 is currently absent
// from that file, but live Spectator payloads report it for ARAM: Mayhem games
// on Howling Abyss.
export function parseQueueType(input: number): QueueType | undefined {
  return match(input)
    .returnType<QueueType | undefined>()
    .with(0, () => "custom")
    .with(420, () => "solo")
    .with(400, () => "draft pick")
    .with(440, () => "flex")
    .with(450, () => "aram")
    .with(700, () => "clash")
    .with(720, () => "aram clash")
    .with(480, () => "swiftplay")
    .with(490, () => "quickplay")
    .with(900, () => "arurf")
    .with(ARENA_QUEUE_ID, () => "arena")
    .with(2300, () => "brawl")
    .with(2400, () => "aram mayhem")
    .with(3200, () => "aram mayhem")
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

export function resolveQueueTypeFromGame(
  queueId: number,
  gameMode: string,
): QueueType | undefined {
  if (isArenaQueueOrMode(queueId, gameMode)) {
    return "arena";
  }
  return parseQueueType(queueId);
}

export function queueTypeToDisplayString(queueType: QueueType): string {
  return match(queueType)
    .returnType<string>()
    .with("solo", () => "ranked solo")
    .with("flex", () => "ranked flex")
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
