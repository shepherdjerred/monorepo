import {
  PlatformRouteSchema,
  RegionSchema,
  regionToPlatformRoute,
  type ScoutClientObservation,
} from "@scout-for-lol/data";
import type { z } from "zod";
import type { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";

/** Resolve missing transport metadata only from the verified observer's accounts. */
export function withObserverPlatform(
  observation: ScoutClientObservation,
  accounts: readonly {
    readonly puuid: z.input<typeof LeaguePuuidSchema>;
    readonly region: string;
  }[],
): ScoutClientObservation {
  const stated = PlatformRouteSchema.safeParse(
    observation.platformId?.toUpperCase(),
  );
  if (observation.platformId !== undefined) {
    return stated.success
      ? { ...observation, platformId: stated.data }
      : observation;
  }
  const platforms = new Set(
    accounts.flatMap((account) => {
      if (account.puuid !== observation.localPuuid) return [];
      const region = RegionSchema.parse(account.region);
      return [regionToPlatformRoute(region)];
    }),
  );
  const platform = platforms.size === 1 ? [...platforms][0] : undefined;
  return platform === undefined
    ? observation
    : { ...observation, platformId: platform };
}
