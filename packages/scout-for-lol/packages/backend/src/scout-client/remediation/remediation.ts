import { type DiscordAccountId, type RawMatch } from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type {
  ArtifactKind,
  LakeArtifactKind,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import type { RemediationDeps } from "./deps.ts";
import type { Db } from "#src/database/index.ts";
import { carriesClientTimeline } from "#src/scout-client/canonical-match.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import {
  lakeStagingReceiptKind,
  rawArchiveReceiptKind,
  storedRawArchiveDescriptor,
} from "#src/report-lake/durable-receipts.ts";

/**
 * Remediation for data a Scout desktop client uploaded.
 *
 * Every upload is attributable: a signed-in user approved the pairing that
 * issued the device token, every observation names its device, and a stored
 * match names its source observation. This module turns that attribution into
 * a plan (read-only) and an executor (idempotent, rerunnable) so an operator
 * can undo what one owner's or one device's uploads left behind.
 */

export type RemediationScope =
  | { readonly kind: "owner"; readonly ownerId: DiscordAccountId }
  | { readonly kind: "device"; readonly deviceId: string };

export type RemediationAction =
  /** Riot has the match: replace the client-derived artifacts with Riot's. */
  | "rederive"
  /** Riot does not have it: remove the client-derived artifacts. */
  | "delete"
  /**
   * Riot's result is stored, but a client timeline rides with it: replace the
   * timeline with Riot's, or remove it when Riot has none.
   */
  | "timeline"
  /** Nothing client-derived was stored; only raw observations remain. */
  | "observations-only";

export type RemediationMatch = {
  readonly matchId: RiotMatchId;
  readonly action: RemediationAction;
  readonly observationIds: readonly string[];
  /** The match's canonical selection row points at this scope's upload. */
  readonly clientSelected: boolean;
  /**
   * A timeline is archived and this scope uploaded a bundle that carries one.
   * It can be true while the result is Riot's: a client timeline fills in
   * when Riot has none.
   */
  readonly clientTimeline: boolean;
  /** Archive receipts that exist for the match today. */
  readonly archived: {
    readonly match: boolean;
    readonly timeline: boolean;
    readonly clientBundle: boolean;
  };
  /** Accepted post-game uploads for the same game from other devices. */
  readonly otherSuppliers: number;
};

export type RemediationPrematchSnapshot = {
  readonly matchId: RiotMatchId;
  readonly observationId: string;
};

export type RemediationDevice = {
  readonly id: string;
  readonly ownerId: string;
  readonly deviceName: string;
  readonly deviceState: string;
};

export type RemediationPlan = {
  readonly scope: RemediationScope;
  readonly devices: readonly RemediationDevice[];
  /** Devices that are still ACTIVE and will be revoked. */
  readonly revokeDeviceIds: readonly string[];
  readonly matches: readonly RemediationMatch[];
  /** Prematch (gameflow) observation ids. */
  readonly prematchObservationIds: readonly string[];
  /** Canonical prematch snapshots that were derived from this scope's uploads. */
  readonly prematchSnapshots: readonly RemediationPrematchSnapshot[];
  /** Every raw observation that will be deleted, by kind. */
  readonly observationCounts: Readonly<Record<string, number>>;
  readonly observationTotal: number;
  /** Identity aliases learned from these devices. */
  readonly aliasCount: number;
};

export type RiotMatchOracle = {
  /** Whether Riot returns the match. Unexpected failures must throw. */
  readonly hasMatch: (matchId: RiotMatchId) => Promise<boolean>;
  /**
   * The gameflow observation an archived canonical prematch snapshot was
   * derived from, or null when Riot's spectator data supplied it.
   */
  readonly prematchSourceObservation: (
    matchId: RiotMatchId,
  ) => Promise<string | null>;
};

const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "match",
  "timeline",
  "client_bundle",
];

async function scopedDevices(
  db: Db,
  scope: RemediationScope,
): Promise<RemediationDevice[]> {
  const rows = await db.scoutClientDevice.findMany({
    where:
      scope.kind === "owner"
        ? { ownerId: scope.ownerId }
        : { id: scope.deviceId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.ownerId,
    deviceName: row.deviceName,
    deviceState: row.deviceState,
  }));
}

function matchIdOf(row: {
  gameId: string | null;
  platformId: string | null;
}): RiotMatchId | null {
  if (row.gameId === null || row.platformId === null) return null;
  const parsed = RiotMatchIdSchema.safeParse(
    `${row.platformId.toUpperCase()}_${row.gameId}`,
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Read everything the scope supplied and decide what happens to it. Writes
 * nothing; the only outside call is `oracle.hasMatch`, for matches whose
 * stored artifacts came from the client.
 */
export async function buildRemediationPlan(
  db: Db,
  scope: RemediationScope,
  oracle: RiotMatchOracle,
): Promise<RemediationPlan> {
  const devices = await scopedDevices(db, scope);
  const deviceIds = devices.map((device) => device.id);
  const observations = await db.scoutClientObservation.findMany({
    where: { deviceId: { in: deviceIds } },
    select: {
      observationId: true,
      kind: true,
      gameId: true,
      platformId: true,
      disposition: true,
      payload: true,
    },
    orderBy: { observationId: "asc" },
  });

  const observationCounts: Record<string, number> = {};
  for (const row of observations) {
    observationCounts[row.kind] = (observationCounts[row.kind] ?? 0) + 1;
  }

  const matches = await planMatches(db, observations, deviceIds, oracle);
  const prematchSnapshots = await planPrematchSnapshots(
    db,
    observations,
    oracle,
  );

  return {
    scope,
    devices,
    revokeDeviceIds: devices
      .filter((device) => device.deviceState === "ACTIVE")
      .map((device) => device.id),
    matches,
    prematchSnapshots,
    prematchObservationIds: observations
      .filter((row) => row.kind === "gameflow")
      .map((row) => row.observationId),
    observationCounts,
    observationTotal: observations.length,
    aliasCount: await db.leagueIdentityAlias.count({
      where: { learnedFromDeviceId: { in: deviceIds } },
    }),
  };
}

type ScopedObservation = {
  readonly observationId: string;
  readonly kind: string;
  readonly gameId: string | null;
  readonly platformId: string | null;
  readonly payload: unknown;
};

async function planMatches(
  db: Db,
  observations: readonly ScopedObservation[],
  deviceIds: readonly string[],
  oracle: RiotMatchOracle,
): Promise<RemediationMatch[]> {
  const byMatch = new Map<RiotMatchId, string[]>();
  const timelineSuppliers = new Set<RiotMatchId>();
  for (const row of observations) {
    if (row.kind !== "post_game") continue;
    const matchId = matchIdOf(row);
    if (matchId === null) continue;
    byMatch.set(matchId, [...(byMatch.get(matchId) ?? []), row.observationId]);
    if (carriesClientTimeline(row.payload)) timelineSuppliers.add(matchId);
  }
  const matches: RemediationMatch[] = [];
  for (const [matchId, observationIds] of byMatch) {
    const canonical = await db.scoutClientCanonicalMatch.findUnique({
      where: { riotMatchId: matchId },
      select: { sourceObservationId: true },
    });
    // The bundle receipt is match-wide: it archives the SELECTED observation,
    // whoever supplied the other observations. The result is this scope's
    // only when the selection row names one of this scope's uploads.
    const clientSelected =
      canonical !== null &&
      observations.some(
        (row) => row.observationId === canonical.sourceObservationId,
      );
    const archived = {
      match: await hasReceipt(db, matchId, "match"),
      timeline: await hasReceipt(db, matchId, "timeline"),
      clientBundle: await hasReceipt(db, matchId, "client_bundle"),
    };
    const clientTimeline = archived.timeline && timelineSuppliers.has(matchId);
    matches.push({
      matchId,
      action: await actionFor(clientSelected, clientTimeline, matchId, oracle),
      observationIds,
      clientSelected,
      clientTimeline,
      archived,
      otherSuppliers: await db.scoutClientObservation.count({
        where: {
          kind: "post_game",
          disposition: "ACCEPTED",
          gameId: matchId.slice(matchId.indexOf("_") + 1),
          platformId: { equals: platformRouteOf(matchId), mode: "insensitive" },
          deviceId: { notIn: [...deviceIds] },
        },
      }),
    });
  }
  return matches;
}

async function planPrematchSnapshots(
  db: Db,
  observations: readonly ScopedObservation[],
  oracle: RiotMatchOracle,
): Promise<RemediationPrematchSnapshot[]> {
  const gameflow = observations.filter((row) => row.kind === "gameflow");
  const scoped = new Set(gameflow.map((row) => row.observationId));
  const matchIds = new Set<RiotMatchId>();
  for (const row of gameflow) {
    const matchId = matchIdOf(row);
    if (matchId !== null) matchIds.add(matchId);
  }
  const snapshots: RemediationPrematchSnapshot[] = [];
  for (const matchId of matchIds) {
    if (!(await hasReceipt(db, matchId, "prematch"))) continue;
    const source = await oracle.prematchSourceObservation(matchId);
    if (source !== null && scoped.has(source)) {
      snapshots.push({ matchId, observationId: source });
    }
  }
  return snapshots;
}

async function actionFor(
  clientSelected: boolean,
  clientTimeline: boolean,
  matchId: RiotMatchId,
  oracle: RiotMatchOracle,
): Promise<RemediationAction> {
  if (clientSelected) {
    return (await oracle.hasMatch(matchId)) ? "rederive" : "delete";
  }
  return clientTimeline ? "timeline" : "observations-only";
}

async function hasReceipt(
  db: Db,
  matchId: RiotMatchId,
  kind: ArtifactKind,
): Promise<boolean> {
  return (
    (await db.matchProcessingReceipt.count({
      where: { riotMatchId: matchId, kind: rawArchiveReceiptKind(kind) },
    })) > 0
  );
}

/** A plan with nothing left to do: a rerun after a complete apply. */
export function isPlanEmpty(plan: RemediationPlan): boolean {
  return (
    plan.revokeDeviceIds.length === 0 &&
    plan.matches.every((match) => match.action === "observations-only") &&
    plan.prematchSnapshots.length === 0 &&
    plan.observationTotal === 0 &&
    plan.aliasCount === 0
  );
}

async function trackedAliasesFor(db: Db, match: RawMatch): Promise<string[]> {
  const accounts = await db.account.findMany({
    where: { puuid: { in: match.metadata.participants } },
    select: { alias: true },
  });
  return [...new Set(accounts.map((account) => account.alias))];
}

/**
 * Remove a match's client-derived archive: the objects first, then the
 * receipts that name them. A crash between the two leaves a receipt for a
 * missing object, which the next run deletes again.
 */
async function removeClientArtifacts(
  db: Db,
  deps: RemediationDeps,
  matchId: RiotMatchId,
): Promise<void> {
  for (const kind of ARTIFACT_KINDS) {
    const descriptor = await storedRawArchiveDescriptor(db, matchId, kind);
    if (descriptor !== null) await deps.objects.delete(descriptor.key);
  }
  await db.matchProcessingReceipt.deleteMany({
    where: {
      riotMatchId: matchId,
      kind: {
        in: [
          ...ARTIFACT_KINDS.map((kind) => rawArchiveReceiptKind(kind)),
          lakeStagingReceiptKind("match"),
          lakeStagingReceiptKind("timeline"),
        ],
      },
    },
  });
}

/** Canonical prematch snapshots derived from the scope's gameflow uploads. */
async function removePrematchSnapshots(
  db: Db,
  deps: RemediationDeps,
  plan: RemediationPlan,
): Promise<void> {
  for (const snapshot of plan.prematchSnapshots) {
    await removeArtifacts(db, deps, {
      matchId: snapshot.matchId,
      kinds: ["prematch"],
      staged: ["prematch"],
    });
  }
}

/** Remove one artifact kind's object and the receipts that name it. */
async function removeArtifacts(
  db: Db,
  deps: RemediationDeps,
  target: {
    readonly matchId: RiotMatchId;
    readonly kinds: readonly ArtifactKind[];
    readonly staged: readonly LakeArtifactKind[];
  },
): Promise<void> {
  const { matchId, kinds, staged } = target;
  for (const kind of kinds) {
    const descriptor = await storedRawArchiveDescriptor(db, matchId, kind);
    if (descriptor !== null) await deps.objects.delete(descriptor.key);
  }
  await db.matchProcessingReceipt.deleteMany({
    where: {
      riotMatchId: matchId,
      kind: {
        in: [
          ...kinds.map((kind) => rawArchiveReceiptKind(kind)),
          ...staged.map((kind) => lakeStagingReceiptKind(kind)),
        ],
      },
    },
  });
}

/**
 * Replace a client timeline that sits beside Riot's result. Riot's copy is
 * fetched first so a Riot failure changes nothing; with none, the client
 * timeline is simply removed. The lake rebuild drops its projection.
 */
async function replaceClientTimeline(
  db: Db,
  deps: RemediationDeps,
  matchId: RiotMatchId,
): Promise<void> {
  const timeline = await deps.riot.fetchTimeline(matchId);
  const match =
    timeline === undefined ? undefined : await deps.riot.fetchMatch(matchId);
  await removeArtifacts(db, deps, {
    matchId,
    kinds: ["timeline"],
    staged: ["timeline"],
  });
  if (timeline === undefined || match === undefined) return;
  await deps.ingestTimeline(
    timeline,
    await trackedAliasesFor(db, match),
    new Date(match.info.gameCreation),
  );
}

async function rederiveMatch(
  db: Db,
  deps: RemediationDeps,
  matchId: RiotMatchId,
): Promise<void> {
  // Fetch before deleting anything: if Riot fails now, nothing has changed.
  const match = await deps.riot.fetchMatch(matchId);
  if (match === undefined) {
    throw new Error(
      `Riot no longer returns ${matchId}; rerun to plan it as a delete`,
    );
  }
  const timeline = await deps.riot.fetchTimeline(matchId);
  await removeClientArtifacts(db, deps, matchId);
  const aliases = await trackedAliasesFor(db, match);
  await deps.ingestMatch(match, aliases);
  if (timeline !== undefined) {
    await deps.ingestTimeline(
      timeline,
      aliases,
      new Date(match.info.gameCreation),
    );
  }
  // The selection row goes last: while it exists a rerun still sees the
  // match as client-derived and repeats the steps above.
  await db.scoutClientCanonicalMatch.deleteMany({
    where: { riotMatchId: matchId },
  });
}

async function deleteMatch(
  db: Db,
  deps: RemediationDeps,
  matchId: RiotMatchId,
): Promise<void> {
  await removeClientArtifacts(db, deps, matchId);
  await db.scoutClientCanonicalMatch.deleteMany({
    where: { riotMatchId: matchId },
  });
}

async function deleteObservations(
  db: Db,
  deps: RemediationDeps,
  deviceIds: readonly string[],
): Promise<void> {
  const deviceFilter = { deviceId: { in: [...deviceIds] } };
  const archived = await db.scoutClientObservation.findMany({
    where: { ...deviceFilter, rawArchiveKey: { not: null } },
    select: { rawArchiveKey: true },
  });
  for (const row of archived) {
    if (row.rawArchiveKey !== null)
      await deps.objects.delete(row.rawArchiveKey);
  }
  const owned = { observation: deviceFilter };
  await db.scoutClientGameResult.deleteMany({ where: owned });
  await db.scoutClientPlayerSnapshot.deleteMany({ where: owned });
  await db.scoutClientClashEntity.deleteMany({ where: owned });
  await db.scoutClientCanonicalMatch.deleteMany({
    where: { sourceObservation: deviceFilter },
  });
  await db.scoutClientObservation.deleteMany({ where: deviceFilter });
  await db.leagueIdentityAlias.deleteMany({
    where: { learnedFromDeviceId: { in: [...deviceIds] } },
  });
}

/**
 * Carry out a plan. Every step is idempotent and ordered so that an
 * interrupted run is finished by running the script again:
 * revoke, then per-match artifacts, then raw evidence, then refreshes.
 */
export async function applyRemediationPlan(
  db: Db,
  plan: RemediationPlan,
  deps: RemediationDeps,
): Promise<void> {
  const log = (line: string): void => {
    deps.log?.(line);
  };
  const owners = new Map(plan.devices.map((d) => [d.id, d.ownerId]));
  for (const deviceId of plan.revokeDeviceIds) {
    const ownerId = owners.get(deviceId);
    if (ownerId === undefined) throw new Error(`Unknown device ${deviceId}`);
    await deps.revokeDevice(deviceId, ownerId);
    log(`revoked device ${deviceId}`);
  }
  for (const match of plan.matches) {
    if (match.action === "rederive")
      await rederiveMatch(db, deps, match.matchId);
    if (match.action === "delete") await deleteMatch(db, deps, match.matchId);
    if (match.action === "timeline")
      await replaceClientTimeline(db, deps, match.matchId);
    log(`${match.action} ${match.matchId}`);
  }
  await removePrematchSnapshots(db, deps, plan);
  if (plan.prematchSnapshots.length > 0) log("removed canonical prematch");
  await deleteObservations(
    db,
    deps,
    plan.devices.map((device) => device.id),
  );
  log("deleted raw observations and learned aliases");
  await deps.refresh.rebuildLake();
  log("report lake rebuilt");
  await deps.refresh.refreshHallOfFame();
  log("Hall of Fame refreshed");
  await deps.refresh.refreshCompetitions();
  log("competitions refreshed");
}
