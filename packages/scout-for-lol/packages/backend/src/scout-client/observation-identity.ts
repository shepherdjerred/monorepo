import { z } from "zod";
import type { ScoutClientObservation } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import type { AuthenticatedScoutClient } from "./authentication.ts";
import {
  accountRouteFor,
  type IdentityMap,
  isLcuUuid,
  type LcuIdentity,
  lcuIdentitiesIn,
  lcuUuidsIn,
  learnIdentityAliases,
  translatePayloadIdentities,
} from "./identity-alias.ts";
/**
 * The observation as the server reads it: the observer and every payload
 * identity translated from League-client UUIDs to Riot PUUIDs.
 *
 * Everything that interprets an observation — the quarantine checks, lobby
 * binding, match conversion — reads this copy. The raw observation is what is
 * stored and digested, because it is the evidence and its digest is the
 * client's idempotency key.
 */
export function translateObservation(
  observation: ScoutClientObservation,
  identities: IdentityMap,
): ScoutClientObservation {
  if (identities.size === 0) return observation;
  return {
    ...observation,
    ...(observation.localPuuid === undefined
      ? {}
      : {
          localPuuid:
            identities.get(observation.localPuuid) ?? observation.localPuuid,
        }),
    // Translation only swaps string values, so the copy is still the JSON the
    // boundary schema accepted; re-validating states that rather than casting.
    payload: z
      .json()
      .parse(translatePayloadIdentities(observation.payload, identities)),
  };
}

export function observationUuids(
  observations: readonly ScoutClientObservation[],
): ReadonlySet<string> {
  const uuids = new Set<string>();
  for (const observation of observations) {
    if (observation.localPuuid !== undefined) uuids.add(observation.localPuuid);
    for (const uuid of lcuUuidsIn(observation.payload)) uuids.add(uuid);
  }
  return uuids;
}

/**
 * The observer's Riot ID from the newest profile this device has reported.
 *
 * The client sends its account profile only when it changes, so most batches
 * carry the observer's UUID with no Riot ID beside it. Earlier profiles are
 * stored whatever their disposition — every one was quarantined before
 * aliases existed — which is exactly what lets this resolve them now.
 */
async function storedObserverIdentity(
  deviceId: string,
  lcuUuid: string,
): Promise<LcuIdentity | undefined> {
  const profile = await prisma.scoutClientObservation.findFirst({
    where: {
      deviceId,
      kind: "account_profile",
      OR: [{ localLcuUuid: lcuUuid }, { localPuuid: lcuUuid }],
    },
    orderBy: { capturedAt: "desc" },
    select: { payload: true },
  });
  return profile === null
    ? undefined
    : lcuIdentitiesIn(profile.payload).find(
        (identity) => identity.lcuUuid === lcuUuid,
      );
}

/**
 * Learn an alias for every player this batch identifies in full, and for an
 * observer it names only by UUID.
 */
export async function learnBatchIdentities(
  device: AuthenticatedScoutClient,
  observations: readonly ScoutClientObservation[],
): Promise<void> {
  const observerUuids = new Set(
    observations.flatMap((observation) =>
      observation.localPuuid !== undefined && isLcuUuid(observation.localPuuid)
        ? [observation.localPuuid]
        : [],
    ),
  );
  const owned = await prisma.account.findMany({
    where: { player: { discordId: device.ownerId } },
    select: { puuid: true },
  });
  const options = {
    learnedFromDeviceId: device.deviceId,
    ownedPuuids: new Set<string>(owned.map((account) => account.puuid)),
    observerUuids,
  };
  const stated = new Set<string>();
  for (const observation of observations) {
    const identities = lcuIdentitiesIn(observation.payload);
    for (const identity of identities) stated.add(identity.lcuUuid);
    await learnIdentityAliases(identities, {
      ...options,
      route: accountRouteFor(observation.platformId),
    });
  }
  // An observer this batch names only by UUID: use the newest profile the
  // device reported earlier.
  for (const observer of observerUuids) {
    if (stated.has(observer)) continue;
    const identity = await storedObserverIdentity(device.deviceId, observer);
    if (identity !== undefined) {
      await learnIdentityAliases([identity], {
        ...options,
        route: accountRouteFor(undefined),
      });
    }
  }
}
