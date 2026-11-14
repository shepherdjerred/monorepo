import {
  RiotMatchIdSchema,
  type RawMatch,
  type RiotMatchId,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  CLASH_ALIAS_ADMISSION_REASON,
  admitClashAlias,
} from "#src/evidence/admission.ts";
import {
  claimClashClientProcessing,
  claimClashGameAlias,
  clashCanonicalMatchId,
  clashGameFingerprint,
  decideClashAlias,
  type ClashAliasDecision,
  type ClashGameShape,
} from "#src/league/clash/identity.ts";
import { mergeClashAliasSightings } from "#src/league/clash/sighting.ts";

/**
 * Decide what Riot discovery does with a published match that has no
 * admission yet. Anything but a full Clash game is a miss. A Clash game whose
 * fingerprint matches a live game near its start is recorded as that game's
 * alias; if the live game already has a canonical record, Riot's id is
 * admitted as an alias only and must not be processed again.
 */
export async function resolveRiotClashDiscovery(
  match: RawMatch,
  now = new Date(),
): Promise<ClashAliasDecision> {
  const game = {
    platform: match.info.platformId,
    queueId: match.info.queueId,
    participants: match.info.participants,
    startAt: new Date(match.info.gameStartTimestamp),
  };
  if (clashGameFingerprint(game) === null) return { kind: "miss" };
  const riotMatchId = RiotMatchIdSchema.parse(match.metadata.matchId);
  const claimed = await claimClashGameAlias(riotMatchId, game, {
    claimProcessing: true,
  });
  const decision = decideClashAlias({
    riotMatchId,
    candidate:
      claimed === undefined
        ? undefined
        : {
            canonicalMatchId: clashCanonicalMatchId(claimed),
            processingMatchId: claimed.processingMatchId,
          },
  });
  if (decision.kind === "alias-only")
    await admitClashAlias({
      matchId: riotMatchId,
      completedAt: match.info.gameEndTimestamp,
      discoveredAt: now,
    });
  if (decision.kind !== "miss") await mergeClashAliasSightings(riotMatchId);
  return decision;
}

/**
 * Drop from a discovery page every Riot id that is only an alias of a Clash
 * game Scout already reported: ids settled as aliases on an earlier pass,
 * and unadmitted Clash matches whose live game has a canonical record now.
 */
export async function withoutClashAliases<
  T extends { readonly matchId: RiotMatchId },
>(
  intents: readonly T[],
  matches: ReadonlyMap<RiotMatchId, RawMatch>,
  settled: ReadonlyMap<RiotMatchId, unknown>,
  now = new Date(),
): Promise<T[]> {
  const pending = intents.filter((intent) => !settled.has(intent.matchId));
  const admissions =
    pending.length === 0
      ? []
      : await prisma.matchEvidenceAdmission.findMany({
          where: { riotMatchId: { in: pending.map((row) => row.matchId) } },
          select: { riotMatchId: true },
        });
  const admitted = new Set(admissions.map((row) => row.riotMatchId));
  const kept: T[] = [];
  for (const intent of pending) {
    const match = matches.get(intent.matchId);
    if (match !== undefined && !admitted.has(intent.matchId)) {
      const decision = await resolveRiotClashDiscovery(match, now);
      if (decision.kind === "alias-only") continue;
    }
    kept.push(intent);
  }
  return kept;
}

/**
 * A live Clash game gets its canonical identity when the client reports it,
 * and the client claims processing for the live id. If Riot's alias won that
 * claim, Riot's report stands and the client's copy is kept as evidence
 * without starting a second run.
 */
export async function withoutShadowedClashGames<
  D extends { readonly riotMatchId: RiotMatchId },
>(
  dispatches: readonly D[],
  games: ReadonlyMap<
    string,
    Omit<ClashGameShape, "platform"> & { readonly gameStartTimestamp: number }
  >,
): Promise<D[]> {
  const kept: D[] = [];
  for (const dispatch of dispatches) {
    const game = games.get(dispatch.riotMatchId);
    if (game === undefined)
      throw new Error(`Dispatch ${dispatch.riotMatchId} has no parsed game`);
    const separator = dispatch.riotMatchId.indexOf("_");
    const owns = await claimClashClientProcessing({
      platform: dispatch.riotMatchId.slice(0, separator),
      gameId: dispatch.riotMatchId.slice(separator + 1),
      queueId: game.queueId,
      participants: game.participants,
      startAt: new Date(game.gameStartTimestamp),
    });
    if (owns) kept.push(dispatch);
  }
  return kept;
}

/** Riot ids discovery already settled as alias-only Clash games, with completion. */
export async function clashAliasAdmissions(
  matchIds: readonly RiotMatchId[],
): Promise<Map<RiotMatchId, Date | null>> {
  const rows =
    matchIds.length === 0
      ? []
      : await prisma.matchEvidenceAdmission.findMany({
          where: {
            riotMatchId: { in: [...matchIds] },
            reason: CLASH_ALIAS_ADMISSION_REASON,
          },
          select: { riotMatchId: true, completedAt: true },
        });
  return new Map(rows.map((row) => [row.riotMatchId, row.completedAt]));
}
