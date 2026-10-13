import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  RegionSchema,
  regionToPlatformRoute,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";
import { storedRawArchiveDescriptor } from "#src/report-lake/durable-receipts.ts";
import { readArchivedMatchPayload } from "#src/report-lake/receipted-archive.ts";
import type { AuthenticatedScoutClient } from "#src/scout-client/authentication.ts";
import { readSelectedLocalCanonicalMatch } from "#src/scout-client/canonical-match.ts";
import { withRiotIdentities } from "#src/scout-client/identity-alias.ts";
import {
  selectReplayEvidence,
  type QualifiedReplayProvenance,
  type ReplayEvidence,
} from "./evidence-selection.ts";
import {
  parseObservedReplayProvenance,
  replayProvenanceFromMatch,
} from "./provenance.ts";

/** What a replay claims to be, before anything has vouched for it. */
export type ReplayClaimIdentity = {
  readonly gameId: string;
  /** Platform the replay names, when the client could recover it. */
  readonly platformId: string | null;
};

type OwnerAccount = {
  readonly puuid: LeaguePuuid;
  readonly region: string;
};

/** The Riot accounts the offering owner has registered with Scout. */
async function ownerAccounts(
  device: AuthenticatedScoutClient,
): Promise<readonly OwnerAccount[]> {
  return prisma.account.findMany({
    where: { player: { discordId: device.ownerId } },
    select: { puuid: true, region: true },
  });
}

/**
 * Evidence this owner's own devices reported for the game.
 *
 * Scoped to the owner rather than to one device. A device proves nothing its
 * owner has not already proven: an observation is only ACCEPTED when its
 * `localPuuid` is an account registered to the device owner, so narrowing
 * further to the one machine holding the file adds no identity fact. It only
 * stops a second machine, or a reinstall, from handing over a replay its owner
 * is plainly entitled to. Owner is the scope the quota and the advisory lock
 * already use.
 */
async function observedProvenance(
  claim: ReplayClaimIdentity,
  device: AuthenticatedScoutClient,
  accounts: readonly OwnerAccount[],
): Promise<ReplayEvidence[]> {
  const observedMatches = await prisma.scoutClientObservation.findMany({
    where: {
      device: { ownerId: device.ownerId },
      gameId: claim.gameId,
      ...(claim.platformId === null
        ? {}
        : {
            platformId: {
              equals: claim.platformId,
              mode: "insensitive" as const,
            },
          }),
      kind: "post_game",
      disposition: "ACCEPTED",
      localPuuid: { in: accounts.map((account) => account.puuid) },
    },
    select: {
      localPuuid: true,
      leaguePatch: true,
      payload: true,
      platformId: true,
    },
    orderBy: [{ capturedAt: "desc" }, { observationId: "asc" }],
  });
  const evidence: ReplayEvidence[] = [];
  for (const observedMatch of observedMatches) {
    if (observedMatch.localPuuid === null || observedMatch.platformId === null)
      continue;
    const provenance = parseObservedReplayProvenance({
      // The stored payload names players by League-client UUID; the observer
      // column already holds the translated Riot PUUID.
      payload: await withRiotIdentities(observedMatch.payload),
      localPuuid: observedMatch.localPuuid,
      leaguePatch: observedMatch.leaguePatch,
      requestedGameId: claim.gameId,
      requestedPlatformId: observedMatch.platformId,
    });
    if (provenance !== null)
      evidence.push({
        platformId: observedMatch.platformId.toUpperCase(),
        authority: "observed",
        provenance,
      });
  }
  return evidence;
}

async function readArchivedMatch(
  riotMatchId: RiotMatchId,
): Promise<RawMatch | null> {
  const descriptor = await storedRawArchiveDescriptor(
    prisma,
    riotMatchId,
    "match",
  );
  return descriptor === null
    ? null
    : await readArchivedMatchPayload(descriptor, riotMatchId);
}

/**
 * Evidence the server already holds, from Riot or from any paired client.
 *
 * The replay route carries a bare game id, so the platform has to be recovered
 * before a canonical match can be read. The client sends it when it knows it;
 * otherwise the owner's registered regions are the candidate set, bounded by
 * how many accounts one person has.
 */
async function archivedProvenance(
  claim: ReplayClaimIdentity,
  accounts: readonly OwnerAccount[],
): Promise<ReplayEvidence[]> {
  const platforms = new Set<string>();
  if (claim.platformId !== null) {
    platforms.add(claim.platformId.toUpperCase());
  }
  for (const account of claim.platformId === null ? accounts : []) {
    const region = RegionSchema.safeParse(account.region);
    if (region.success) platforms.add(regionToPlatformRoute(region.data));
  }
  const puuids = accounts.map((account) => account.puuid);
  const evidence: ReplayEvidence[] = [];
  for (const platform of platforms) {
    const riotMatchId = RiotMatchIdSchema.safeParse(
      `${platform}_${claim.gameId}`,
    );
    if (!riotMatchId.success) continue;
    const archived = await readArchivedMatch(riotMatchId.data);
    const match =
      archived ?? (await readSelectedLocalCanonicalMatch(riotMatchId.data));
    if (match === null) continue;
    const provenance = replayProvenanceFromMatch(match, puuids);
    if (provenance !== null)
      evidence.push({
        platformId: platform,
        authority: archived === null ? "observed" : "archived",
        provenance,
      });
  }
  return evidence;
}

/**
 * Independent client and archive attestations, resolved by qualified identity.
 *
 * A replay is only worth storing when something can attest to the game it
 * claims to be, because that attestation is what `validateReplayContainer`
 * compares the file against. Either side may supply it: this account's own
 * client observations, or a match the server already archived from Riot.
 * Requiring the uploading device to have witnessed the game refuses replays
 * for every game played before that device was paired, which is most of them.
 *
 * `null` means evidence is absent or ambiguous and remains retryable.
 */
export async function resolveReplayProvenance(
  claim: ReplayClaimIdentity,
  device: AuthenticatedScoutClient,
): Promise<QualifiedReplayProvenance | null> {
  const accounts = await ownerAccounts(device);
  const [observed, archived] = await Promise.all([
    observedProvenance(claim, device, accounts),
    archivedProvenance(claim, accounts),
  ]);
  return selectReplayEvidence([...observed, ...archived], claim.platformId);
}
