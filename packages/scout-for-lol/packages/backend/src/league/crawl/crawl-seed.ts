import type { RiotMatchId } from "@scout-for-lol/data";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import {
  CRAWL_SEED_OBSERVATIONS_PER_TICK,
  crawlLookbackStart,
} from "./crawl-config.ts";
import { parseCrawlMatchEnvelope } from "./crawl-records.ts";
import type {
  CrawlObjectStore,
  CrawlStore,
  NewFrontierPlayer,
} from "./crawl-store.ts";

/** The platform a Riot match id was played on: `NA1_123` is `NA1`. */
export function platformOfMatchId(matchId: RiotMatchId): string {
  const [platform] = matchId.split("_");
  return PlatformRouteSchema.parse(platform);
}

/**
 * Seed the frontier from the participants of tracked matches processed since
 * the last pass. A tracked match is a `MatchObservation` with a stored raw
 * match object; its ten participants enter at depth 0. Only matches inside the
 * 28-day lookback seed, and the cursor advances past every observation read.
 */
export async function seedFromTrackedMatches(
  deps: { store: CrawlStore; objects: CrawlObjectStore },
  now: Date,
): Promise<{ observations: number; admitted: number; erased: number }> {
  const cursor = await deps.store.seedCursor(now);
  const observations = await deps.store.observationsAfter(
    cursor,
    crawlLookbackStart(now),
    CRAWL_SEED_OBSERVATIONS_PER_TICK,
  );
  const players: NewFrontierPlayer[] = [];
  for (const observation of observations) {
    const envelope = parseCrawlMatchEnvelope(
      JSON.parse(await deps.objects.readText(observation.matchObjectKey)),
    );
    const platformRoute = platformOfMatchId(observation.riotMatchId);
    for (const participant of envelope.info.participants) {
      players.push({
        puuid: participant.puuid,
        platformRoute,
        depth: 0,
        seedMatchId: observation.riotMatchId,
      });
    }
  }
  const { admitted, erased } = await deps.store.admit(players, now);
  const last = observations.at(-1);
  if (last !== undefined) {
    await deps.store.advanceSeedCursor({
      observedAt: last.observedAt,
      matchId: last.riotMatchId,
    });
  }
  return { observations: observations.length, admitted, erased };
}
