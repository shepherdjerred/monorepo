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
  "classic",
  "classic aram mayhem",
  "brawl",
  "aram mayhem",
  "normal",
  "draft pick",
  "easy doom bots",
  "normal doom bots",
  "hard doom bots",
  "custom",
  "tournament",
]);

const ARENA_QUEUE_ID = 1700;
const ARENA_GAME_MODE = "CHERRY";

export const ClassicQueueTypeSchema = z.enum([
  "classic",
  "classic aram mayhem",
]);

export function isClassicQueueType(queueType: QueueType | undefined): boolean {
  return ClassicQueueTypeSchema.safeParse(queueType).success;
}

// Most queue IDs come from Riot's queues.json. Some are absent from that file
// but show up in live Spectator payloads: 3200/3220 for ARAM: Mayhem on Howling
// Abyss, and 710 — the revived premade "Ranked 5s" queue on Summoner's Rift,
// which Riot's published queues.json still labels as the long-defunct original.
//
// Arena churns its queue ID between reworks (1700 was the original Soul Fighter
// launch; 1750 and 1740 appeared around mid-2026 — 1740 observed live with an
// 18-player CHERRY lobby). Both map to "arena"
// here, but the durable classifier is `resolveQueueTypeFromGame` below, which
// keys off `gameMode === "CHERRY"` and is immune to the next ID change.
export function parseQueueType(input: number): QueueType | undefined {
  return (
    match(input)
      .returnType<QueueType | undefined>()
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
      .with(1740, () => "arena")
      .with(1750, () => "arena")
      .with(2300, () => "brawl")
      .with(3260, () => "classic")
      .with(3262, () => "classic")
      .with(4310, () => "classic")
      .with(2400, () => "aram mayhem")
      .with(2450, () => "classic aram mayhem")
      .with(3200, () => "aram mayhem")
      .with(3220, () => "aram mayhem")
      .with(3270, () => "aram mayhem")
      .with(3280, () => "classic aram mayhem")
      // Ids 0, 3100 and 3130 are ad-hoc ids Riot attaches to user lobbies
      // (3130 was once mapped to easy doom bots). They say nothing by
      // themselves; `classifyGame` requires the custom game type.
      .with(0, 3100, 3130, (): QueueType | undefined => undefined)
      .with(1900, () => "urf")
      // Doom Bots ids per the game-client queue catalog (CommunityDragon):
      // 4250/4251/4252 = "Veigar's Evil!" (Trial 1, the introductory tier),
      // 4240/4241/4242 = "Veigar's Curse!" (Trial 2), 4220 = "Doom Bots -
      // Hard", 4260/4261/4262 = "Veigar's Doom!" (Trial 3). None observed in
      // the match lake yet; team-size variants (4200-4210) stay unmapped and
      // surface via the queue-windows watcher when played.
      .with(4250, () => "easy doom bots")
      .with(4251, () => "easy doom bots")
      .with(4252, () => "easy doom bots")
      .with(4240, () => "normal doom bots")
      .with(4241, () => "normal doom bots")
      .with(4242, () => "normal doom bots")
      .with(4220, () => "hard doom bots")
      .with(4260, () => "hard doom bots")
      .with(4261, () => "hard doom bots")
      .with(4262, () => "hard doom bots")
      .otherwise((): QueueType | undefined => {
        console.error(`unknown queue type: ${input.toString()}`);
        return;
      })
  );
}

export function isArenaQueueOrMode(queueId: number, gameMode: string): boolean {
  return parseQueueType(queueId) === "arena" || gameMode === ARENA_GAME_MODE;
}

// Custom and tutorial games surface as `gameType: "CUSTOM"` (Spectator V5) or
// `"CUSTOM_GAME"` (Match V5). Riot's game type is custom for user lobbies,
// Practice Tool, tournament-code games and live Clash alike, so it is only one
// input to `classifyGame`, never a label on its own.
export function isRiotCustomGameType(gameType: string | undefined): boolean {
  return gameType?.toUpperCase().startsWith("CUSTOM") ?? false;
}

const PRACTICE_TOOL_GAME_MODE = "PRACTICETOOL";

export type GameClassificationInput = {
  readonly queueId: number;
  readonly gameMode: string;
  readonly gameType?: string | undefined;
  /** Match V5 `info.tournamentCode`; empty or absent for ordinary games. */
  readonly tournamentCode?: string | null | undefined;
};

export type GameClassification =
  | { readonly kind: "queue"; readonly queue: QueueType }
  | {
      readonly kind: "unknown";
      readonly queueId: number;
      readonly gameMode: string;
      readonly gameType: string | undefined;
    };

/**
 * Classify a game from Riot's queue id, game mode, game type and tournament
 * code. An unrecognised game is `unknown` and is never relabelled as another
 * type: `custom` means a lobby a user created in League (Riot game type is
 * custom, not Clash, no tournament code, not Practice Tool).
 */
export function classifyGame(
  game: GameClassificationInput,
): GameClassification {
  const queue = classifyQueue(game);
  return queue === undefined
    ? {
        kind: "unknown",
        queueId: game.queueId,
        gameMode: game.gameMode,
        gameType: game.gameType,
      }
    : { kind: "queue", queue };
}

function classifyQueue(game: GameClassificationInput): QueueType | undefined {
  const { queueId, gameMode, gameType, tournamentCode } = game;
  if (gameMode === "JADE") return "classic";
  if (gameMode === "KIWI_JADE" || gameMode === "CLASSIC ARAM MAYHEM") {
    return "classic aram mayhem";
  }
  if (isArenaQueueOrMode(queueId, gameMode)) return "arena";
  // Live Clash arrives with a custom game type; the queue id decides.
  if (queueId === 700) return "clash";
  if (queueId === 720) return "aram clash";
  if (gameMode === PRACTICE_TOOL_GAME_MODE) return undefined;
  if (
    tournamentCode !== undefined &&
    tournamentCode !== null &&
    tournamentCode !== ""
  ) {
    return "tournament";
  }
  const mapped = parseQueueType(queueId);
  if (mapped !== undefined) {
    return mapped === "classic" && !isClassicAssetMode(queueId, gameMode)
      ? "normal"
      : mapped;
  }
  return isRiotCustomGameType(gameType) ? "custom" : undefined;
}

/**
 * The queue of a classified game, or undefined when the game is unknown.
 * Callers that must tell users about an unknown game use `classifyGame`.
 */
export function resolveQueueTypeFromGame(
  queueId: number,
  gameMode: string,
  gameType?: string,
  tournamentCode?: string | null,
): QueueType | undefined {
  const classification = classifyGame({
    queueId,
    gameMode,
    gameType,
    tournamentCode,
  });
  return classification.kind === "queue" ? classification.queue : undefined;
}

/**
 * Whether the roster may legitimately hold fewer than ten players: custom
 * lobbies and tournament games pick any team size.
 */
export function mayHavePartialRoster(queue: QueueType | undefined): boolean {
  return queue === "custom" || queue === "tournament";
}

/**
 * Riot reuses the `classic` queue type for ordinary Summoner's Rift queues.
 * Only the JADE family uses the dedicated Classic champion/art catalog;
 * ordinary CLASSIC payloads must stay on normal League assets.
 */
export function isClassicAssetMode(queueId: number, gameMode: string): boolean {
  return (
    gameMode === "JADE" ||
    gameMode === "KIWI_JADE" ||
    gameMode === "CLASSIC ARAM MAYHEM" ||
    queueId === 4310 ||
    queueId === 2450 ||
    queueId === 3280
  );
}

export function queueTypeToDisplayString(queueType: QueueType): string {
  return match(queueType)
    .returnType<string>()
    .with("solo", () => "ranked solo")
    .with("flex", () => "ranked flex")
    .with("ranked 5s", () => "ranked 5s")
    .with("clash", () => "Clash")
    .with("aram clash", () => "ARAM Clash")
    .with("aram", () => "ARAM")
    .with("arurf", () => "ARURF")
    .with("urf", () => "URF")
    .with("arena", () => "arena")
    .with("classic", () => "League Classic")
    .with("classic aram mayhem", () => "Classic ARAM Mayhem")
    .with("brawl", () => "brawl")
    .with("aram mayhem", () => "ARAM: Mayhem")
    .with("normal", () => "Normal")
    .with("easy doom bots", () => "Easy Doom Bots")
    .with("normal doom bots", () => "Normal Doom Bots")
    .with("hard doom bots", () => "Hard Doom Bots")
    .with("custom", () => "custom")
    .with("tournament", () => "tournament")
    .with("draft pick", () => "draft pick")
    .with("quickplay", () => "quickplay")
    .with("swiftplay", () => "swiftplay")
    .exhaustive();
}

/**
 * The three Doom Bots difficulties present as ONE mode to users. Pickers and
 * filter summaries collapse the trio into a single "Doom Bots" entry; the
 * distinct per-difficulty names above remain for match-specific displays.
 */
export const DOOM_BOTS_QUEUES: readonly QueueType[] = [
  "easy doom bots",
  "normal doom bots",
  "hard doom bots",
];

const DOOM_BOTS_GROUP_LABEL = "Doom Bots";

/**
 * Display labels for a queue list, collapsing the full Doom Bots trio into a
 * single "Doom Bots" label (partial selections keep the per-difficulty names).
 * Order follows the input; the collapsed label sits at the first trio member.
 */
export function queueDisplayLabels(queues: readonly QueueType[]): string[] {
  const hasAllDoomBots = DOOM_BOTS_QUEUES.every((queue) =>
    queues.includes(queue),
  );
  const labels: string[] = [];
  for (const queue of queues) {
    if (hasAllDoomBots && DOOM_BOTS_QUEUES.includes(queue)) {
      if (!labels.includes(DOOM_BOTS_GROUP_LABEL)) {
        labels.push(DOOM_BOTS_GROUP_LABEL);
      }
      continue;
    }
    labels.push(queueTypeToDisplayString(queue));
  }
  return labels;
}
