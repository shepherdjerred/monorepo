import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type IsoInstant,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  PlatformRouteSchema,
  type PlatformRoute,
} from "@scout-for-lol/domain/identity/routes.ts";

/**
 * Identity conversions between the v1 pipeline's loose values and the durable
 * tables' branded ones.
 *
 * v1's `MatchId` is an unvalidated branded string and its instants are `Date`s;
 * the durable tables take {@link RiotMatchId} and {@link IsoInstant}. Every
 * conversion here parses rather than casts, and every call sits inside the
 * dual-write fail-open boundary, so a v1 value that cannot be a durable
 * identity is recorded as a parity failure instead of breaking the pipeline.
 */

export function toRiotMatchId(value: string): RiotMatchId {
  return RiotMatchIdSchema.parse(value);
}

/**
 * The platform prefix of a Riot match id. `MatchObservationRecordSchema` also
 * cross-checks the two, so a route derived any other way would be rejected —
 * deriving it from the id is the only way they can agree by construction.
 */
export function platformRouteOf(matchId: RiotMatchId): PlatformRoute {
  const [platform] = matchId.split("_");
  return PlatformRouteSchema.parse(platform);
}

export function toIsoInstant(value: Date): IsoInstant {
  return IsoInstantSchema.parse(value.toISOString());
}

/** Riot reports game creation as epoch milliseconds. */
export function isoInstantFromEpochMs(epochMs: number): IsoInstant {
  return toIsoInstant(new Date(epochMs));
}
