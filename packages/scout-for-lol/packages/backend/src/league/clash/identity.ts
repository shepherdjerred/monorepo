import { createHash } from "node:crypto";
import {
  ClashCupQueueSchema,
  RiotMatchIdSchema,
  parseQueueType,
  type RiotMatchId,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";

/**
 * How far Riot's published `gameStartTimestamp` may sit from the start Scout
 * recorded for the live game and still be the same game.
 *
 * Measured on the report lake (1,097 live-archived prematch games that Riot
 * also published under the same id): the Spectator `gameStartTime` precedes
 * Match-V5 `gameStartTimestamp` by 9 to 245 seconds, and the prematch archive
 * time lands between 227 seconds before and 1,405 seconds (23.4 minutes)
 * after it. A prematch with no Spectator start records the archive time, so
 * the window has to cover the archive gap: 30 minutes either side. A false
 * hit also needs the same ten team:champion pairs on the same platform.
 */
export const CLASH_ALIAS_WINDOW_MS = 30 * 60 * 1000;

export type ClashGameShape = {
  readonly platform: string;
  readonly queueId: number;
  readonly participants: readonly {
    readonly teamId: number;
    readonly championId: number;
  }[];
};

/**
 * The same hash for the live game and Riot's later publication of it:
 * platform, queue, and the ten `team:champion` pairs in sorted order. Null
 * for anything that is not a full Clash game, which never gets an identity.
 */
export function clashGameFingerprint(game: ClashGameShape): string | null {
  if (!ClashCupQueueSchema.safeParse(parseQueueType(game.queueId)).success)
    return null;
  if (
    game.participants.length !== 10 ||
    game.participants.some((participant) => participant.championId <= 0)
  )
    return null;
  const pairs = game.participants
    .map(
      (participant) =>
        `${participant.teamId.toString()}:${participant.championId.toString()}`,
    )
    .toSorted();
  return createHash("sha256")
    .update(
      [game.platform.toUpperCase(), game.queueId.toString(), ...pairs].join(
        "|",
      ),
    )
    .digest("hex");
}

export function clashCanonicalMatchId(identity: {
  platform: string;
  gameId: string;
}): RiotMatchId {
  return RiotMatchIdSchema.parse(`${identity.platform}_${identity.gameId}`);
}

function splitMatchId(matchId: string): { platform: string; gameId: string } {
  const separator = matchId.indexOf("_");
  if (separator <= 0) throw new Error(`Malformed match id ${matchId}`);
  return {
    platform: matchId.slice(0, separator),
    gameId: matchId.slice(separator + 1),
  };
}

/**
 * Record a live Clash game under its canonical id. The first writer's start
 * stands: a prematch archive and a client post-game describe the same game.
 */
export async function recordClashGameIdentity(
  game: ClashGameShape & { readonly gameId: string; readonly startAt: Date },
): Promise<void> {
  const fingerprint = clashGameFingerprint(game);
  if (fingerprint === null) return;
  const platform = game.platform.toUpperCase();
  await prisma.clashGameIdentity.upsert({
    where: { platform_gameId: { platform, gameId: game.gameId } },
    create: {
      platform,
      gameId: game.gameId,
      fingerprint,
      startAt: game.startAt,
    },
    update: {},
  });
}

export type ClashAliasDecision =
  | { readonly kind: "miss" }
  /** A canonical record exists: Riot's id is admitted as an alias only. */
  | { readonly kind: "alias-only"; readonly canonicalMatchId: RiotMatchId }
  /** Only the live game was seen: Riot's match is processed and aliased. */
  | {
      readonly kind: "alias-and-process";
      readonly canonicalMatchId: RiotMatchId;
    };

export function decideClashAlias(input: {
  candidate: { canonicalMatchId: RiotMatchId } | undefined;
  canonicalRecorded: boolean;
}): ClashAliasDecision {
  if (input.candidate === undefined) return { kind: "miss" };
  return input.canonicalRecorded
    ? { kind: "alias-only", canonicalMatchId: input.candidate.canonicalMatchId }
    : {
        kind: "alias-and-process",
        canonicalMatchId: input.candidate.canonicalMatchId,
      };
}

/**
 * Find and claim the live game a published Riot Clash match is. The nearest
 * unclaimed identity with the same fingerprint inside the window wins; one
 * already claimed by this Riot id is reused, so the claim is idempotent.
 */
export async function claimClashGameAlias(
  riotMatchId: RiotMatchId,
  game: ClashGameShape & { readonly startAt: Date },
): Promise<{ platform: string; gameId: string } | undefined> {
  const fingerprint = clashGameFingerprint(game);
  if (fingerprint === null) return undefined;
  const start = game.startAt.getTime();
  const candidates = await prisma.clashGameIdentity.findMany({
    where: {
      fingerprint,
      startAt: {
        gte: new Date(start - CLASH_ALIAS_WINDOW_MS),
        lte: new Date(start + CLASH_ALIAS_WINDOW_MS),
      },
      OR: [{ riotMatchId: null }, { riotMatchId }],
    },
  });
  const ranked = candidates
    .filter((row) => clashCanonicalMatchId(row) !== riotMatchId)
    .toSorted(
      (left, right) =>
        Number(right.riotMatchId === riotMatchId) -
          Number(left.riotMatchId === riotMatchId) ||
        Math.abs(left.startAt.getTime() - start) -
          Math.abs(right.startAt.getTime() - start),
    );
  for (const candidate of ranked) {
    const claimed = await prisma.clashGameIdentity.updateMany({
      where: {
        platform: candidate.platform,
        gameId: candidate.gameId,
        OR: [{ riotMatchId: null }, { riotMatchId }],
      },
      data: { riotMatchId },
    });
    if (claimed.count > 0)
      return { platform: candidate.platform, gameId: candidate.gameId };
  }
  return undefined;
}

/**
 * The canonical game id for each `(platform, gameId)`: a Riot alias maps to
 * the live game it was recorded against, anything else to itself.
 */
export async function canonicalClashGameIds(
  games: readonly { platform: string; gameId: string }[],
): Promise<Map<string, string>> {
  const canonical = new Map<string, string>();
  const aliasIds = [
    ...new Set(games.map((game) => `${game.platform}_${game.gameId}`)),
  ];
  for (let offset = 0; offset < aliasIds.length; offset += 500) {
    const rows = await prisma.clashGameIdentity.findMany({
      where: { riotMatchId: { in: aliasIds.slice(offset, offset + 500) } },
      select: { platform: true, gameId: true, riotMatchId: true },
    });
    for (const row of rows) {
      if (row.riotMatchId === null) continue;
      const alias = splitMatchId(row.riotMatchId);
      canonical.set(clashGameKey(alias), row.gameId);
    }
  }
  return canonical;
}

export async function canonicalClashGameId(game: {
  platform: string;
  gameId: string;
}): Promise<string> {
  const canonical = await canonicalClashGameIds([game]);
  return canonical.get(clashGameKey(game)) ?? game.gameId;
}

export function clashGameKey(game: {
  platform: string;
  gameId: string;
}): string {
  return `${game.platform}:${game.gameId}`;
}

/**
 * The match page for each canonical game: whichever id the pipeline
 * processed. A client-reported game is processed under the live id; a game
 * only Riot reported is processed under Riot's alias. With no processing
 * record (a lake backfill), the published id is the one the lake holds.
 */
export async function clashMatchPageIds(
  games: readonly { platform: string; gameId: string }[],
): Promise<Map<string, RiotMatchId>> {
  const pages = new Map<string, RiotMatchId>();
  if (games.length === 0) return pages;
  const unique = [
    ...new Map(games.map((game) => [clashGameKey(game), game])).values(),
  ];
  const identities = new Map<string, RiotMatchId>();
  for (let offset = 0; offset < unique.length; offset += 100) {
    const rows = await prisma.clashGameIdentity.findMany({
      where: {
        OR: unique.slice(offset, offset + 100),
        riotMatchId: { not: null },
      },
      select: { platform: true, gameId: true, riotMatchId: true },
    });
    for (const row of rows)
      if (row.riotMatchId !== null)
        identities.set(clashGameKey(row), row.riotMatchId);
  }
  const candidates = [
    ...unique.map((game) => clashCanonicalMatchId(game)),
    ...identities.values(),
  ];
  const observed = new Set<string>();
  for (let offset = 0; offset < candidates.length; offset += 500) {
    const rows = await prisma.matchObservation.findMany({
      where: { riotMatchId: { in: candidates.slice(offset, offset + 500) } },
      select: { riotMatchId: true },
    });
    for (const row of rows) observed.add(row.riotMatchId);
  }
  for (const game of unique) {
    const canonical = clashCanonicalMatchId(game);
    const alias = identities.get(clashGameKey(game));
    pages.set(
      clashGameKey(game),
      alias === undefined || observed.has(canonical) ? canonical : alias,
    );
  }
  return pages;
}

/** Whether the live game already has a canonical record (client evidence or a pipeline run). */
export async function clashCanonicalRecorded(
  matchId: RiotMatchId,
): Promise<boolean> {
  const [admission, observation] = await Promise.all([
    prisma.matchEvidenceAdmission.findUnique({
      where: { riotMatchId: matchId },
      select: { riotMatchId: true },
    }),
    prisma.matchObservation.findUnique({
      where: { riotMatchId: matchId },
      select: { riotMatchId: true },
    }),
  ]);
  return admission !== null || observation !== null;
}
