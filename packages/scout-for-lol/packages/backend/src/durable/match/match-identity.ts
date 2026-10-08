import {
  IsoInstantSchema,
  type IsoInstant,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  PlatformRouteSchema,
  type PlatformRoute,
} from "@scout-for-lol/domain/identity/routes.ts";

/**
 * Identity conversions into the durable tables' branded values. Every
 * conversion parses rather than casts.
 */

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
