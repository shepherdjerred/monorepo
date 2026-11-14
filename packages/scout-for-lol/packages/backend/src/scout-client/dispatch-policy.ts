import {
  projectPostGameOutcome,
  riotWithholdsMatchResult,
  type QueueType,
  type RawMatch,
  type ScoutClientObservation,
  type ScoutClientObservationBatch,
  type ScoutClientPostGameOutcome,
} from "@scout-for-lol/data";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type { ScoutClientMatchDispatchItem } from "@scout-for-lol/temporal/workflow-contracts";
import { LOCAL_CANONICAL_DELAY_MS } from "#src/evidence/source-grace.ts";
import { parseLocalCanonicalMatch } from "./canonical-match.ts";
import { unconvertedConversion } from "./canonical/end-of-game-result.ts";
import type { IdentityMap } from "./identity-alias.ts";
import { translateObservation } from "./observation-identity.ts";
import { gameKindOf } from "./telemetry/capture-metrics.ts";

type Receipt = {
  readonly observationId: string;
  readonly outcome: "accepted" | "already_accepted" | "quarantined";
};

const LIVE_COMPLETION_WINDOW_MS = 15 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Delayed outbox delivery and historical recovery must not announce old games. */
export function postGameDeliveryMode(
  observation: ScoutClientObservation,
  gameEndTimestamp: number,
  now: Date,
): "live" | "silent-backfill" | null {
  const payload = observation.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const resource = payload["resource"];
  if (typeof resource !== "string") return null;
  if (gameEndTimestamp > now.getTime() + FUTURE_TOLERANCE_MS) return null;
  if (
    resource === "post_game_timeline" ||
    /^match_history_game:\d{1,32}$/u.test(resource)
  )
    return "silent-backfill";
  if (resource !== "post_game") return null;
  return Math.min(gameEndTimestamp, Date.parse(observation.capturedAt)) <
    now.getTime() - LIVE_COMPLETION_WINDOW_MS
    ? "silent-backfill"
    : "live";
}

export function bodyDigest(observation: ScoutClientObservation): string {
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(observation))
    .digest("hex");
}

/**
 * Select only complete, identity-consistent local matches for dispatch.
 * Match-history discoveries are backfills even when the LCU happened to
 * return enough fields to promote them; only an observed end-of-game bundle
 * is a live completion.
 */
export function acceptedClientMatchDispatches(
  batch: ScoutClientObservationBatch,
  receipts: readonly Receipt[],
  now = new Date(),
  identities: IdentityMap = new Map(),
): readonly ScoutClientMatchDispatchItem[] {
  return evaluateClientPostGames(batch, receipts, now, identities).dispatches;
}

export type PostGameEvaluation = {
  readonly observationId: string;
  readonly outcome: ScoutClientPostGameOutcome;
  readonly gameKind: QueueType | "unknown";
};

export function evaluateClientPostGames(
  batch: ScoutClientObservationBatch,
  receipts: readonly Receipt[],
  now: Date,
  identities: IdentityMap,
): {
  readonly dispatches: readonly ScoutClientMatchDispatchItem[];
  readonly evaluations: readonly PostGameEvaluation[];
  readonly games: ReadonlyMap<string, RawMatch["info"]>;
} {
  const evaluations: PostGameEvaluation[] = [];
  const games = new Map<string, RawMatch["info"]>();
  const accepted = new Set(
    receipts
      .filter((receipt) => receipt.outcome !== "quarantined")
      .map((receipt) => receipt.observationId),
  );
  // Riot gets first refusal for two minutes — except on a game it will never
  // publish, a custom or a never-published queue, which is ready at once.
  const riotFirstReadyAt = IsoInstantSchema.parse(
    new Date(now.getTime() + LOCAL_CANONICAL_DELAY_MS).toISOString(),
  );
  const immediatelyReadyAt = IsoInstantSchema.parse(now.toISOString());
  const starts = new Map<string, ScoutClientMatchDispatchItem>();
  for (const raw of batch.observations) {
    const observation = translateObservation(raw, identities);
    if (
      observation.kind !== "post_game" ||
      !accepted.has(observation.observationId) ||
      observation.platformId === undefined ||
      observation.gameId === undefined ||
      observation.localPuuid === undefined
    ) {
      continue;
    }
    const parsed = RiotMatchIdSchema.safeParse(
      `${observation.platformId.toUpperCase()}_${observation.gameId}`,
    );
    if (!parsed.success) continue;
    const sourcePuuid = LeaguePuuidSchema.parse(observation.localPuuid);
    const match = parseLocalCanonicalMatch(
      parsed.data,
      {
        observationId: observation.observationId,
        platformId: observation.platformId,
        localPuuid: observation.localPuuid,
        payload: raw.payload,
        bodyDigest: bodyDigest(raw),
      },
      identities,
    );
    if (match === null) {
      evaluations.push({
        observationId: observation.observationId,
        outcome: projectPostGameOutcome({
          identityResolved: true,
          conversion: unconvertedConversion(raw.payload),
          deliveryMode: null,
        }),
        gameKind: "unknown",
      });
      continue;
    }
    const deliveryMode = postGameDeliveryMode(
      observation,
      match.info.gameEndTimestamp,
      now,
    );
    evaluations.push({
      observationId: observation.observationId,
      outcome: projectPostGameOutcome({
        identityResolved: true,
        conversion: "complete",
        deliveryMode,
      }),
      gameKind: gameKindOf(match.info),
    });
    if (deliveryMode === null) continue;
    const candidate: ScoutClientMatchDispatchItem = {
      riotMatchId: parsed.data,
      sourcePuuid,
      deliveryMode,
      gameEndTimestamp: match.info.gameEndTimestamp,
      readyAt: riotWithholdsMatchResult(match.info)
        ? immediatelyReadyAt
        : riotFirstReadyAt,
      completionTargets: [],
      orderingAssured: false,
    };
    const existing = starts.get(parsed.data);
    if (existing === undefined || deliveryMode === "live") {
      starts.set(parsed.data, candidate);
      games.set(parsed.data, match.info);
    }
  }
  const dispatches = [...starts.values()].sort(
    (left, right) =>
      left.gameEndTimestamp - right.gameEndTimestamp ||
      left.riotMatchId.localeCompare(right.riotMatchId),
  );
  return { dispatches, evaluations, games };
}
