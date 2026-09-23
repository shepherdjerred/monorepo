import { z } from "zod";
import {
  ScoutClientObservationQuarantineReasonSchema,
  type ScoutClientObservation,
  type ScoutClientObservationBatch,
  type ScoutClientObservationQuarantineReason,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { Prisma } from "#generated/prisma/client/index.js";
import {
  IsoInstantSchema,
  type RiotMatchId,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import configuration from "#src/configuration.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { signalScoutClientMatchDispatchV2 } from "#src/temporal/starts-v2.ts";
import {
  ScoutClientMatchDispatchBatchV2Schema,
  type ScoutClientMatchDispatchItemV2,
} from "@scout-for-lol/temporal/workflow-contracts-v2";
import type { AuthenticatedScoutClient } from "./authentication.ts";
import {
  LOCAL_CANONICAL_DELAY_MS,
  parseLocalCanonicalMatch,
} from "./canonical-match.ts";
import { reconcileProcessedClientBinding } from "./late-binding.ts";
import { observedPostGameMatchId } from "./lobby-payload.ts";
import {
  bindObservedLobby,
  bindObservedMatch,
  projectObservedGameState,
} from "./lobby-binding.ts";

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });

export class ScoutClientObservationConflict extends Error {}

export function nextScoutClientObservationSequence(
  maximumSequence: bigint | null,
): number {
  const nextSequence = (maximumSequence ?? 0n) + 1n;
  if (nextSequence > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Scout Client device sequence is exhausted");
  }
  return Number(nextSequence);
}

type Receipt = {
  readonly observationId: string;
  readonly outcome: "accepted" | "already_accepted" | "quarantined";
  readonly quarantineReason?: ScoutClientObservationQuarantineReason;
};

type ObservationAttestation = {
  readonly verifiedPuuids: ReadonlySet<string>;
  readonly acceptedAppVersions: ReadonlySet<string>;
};

const PLAYER_SNAPSHOT_KINDS = new Set([
  "account_profile",
  "champion_mastery",
  "challenges",
  "clash",
]);

function observationResource(payload: unknown): string | null {
  return payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !("resource" in payload) ||
    typeof payload.resource !== "string" ||
    payload.resource.length === 0 ||
    payload.resource.length > 80
    ? null
    : payload.resource;
}

async function projectPlayerSnapshot(
  observation: ScoutClientObservation,
  receipt: Receipt,
): Promise<void> {
  if (
    receipt.outcome === "quarantined" ||
    observation.localPuuid === undefined ||
    !PLAYER_SNAPSHOT_KINDS.has(observation.kind)
  ) {
    return;
  }
  const resource = observationResource(observation.payload);
  if (resource === null) return;
  const capturedAt = new Date(observation.capturedAt);
  await prisma.$executeRaw`
    INSERT INTO "ScoutClientPlayerSnapshot"
      ("localPuuid", "resource", "kind", "observationId", "capturedAt", "updatedAt")
    VALUES
      (${observation.localPuuid}, ${resource}, ${observation.kind}, ${observation.observationId}, ${capturedAt}, NOW())
    ON CONFLICT ("localPuuid", "resource") DO UPDATE SET
      "kind" = EXCLUDED."kind",
      "observationId" = EXCLUDED."observationId",
      "capturedAt" = EXCLUDED."capturedAt",
      "updatedAt" = NOW()
    WHERE EXCLUDED."capturedAt" >= "ScoutClientPlayerSnapshot"."capturedAt"
  `;
}

function bodyDigest(observation: ScoutClientObservation): string {
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(observation))
    .digest("hex");
}

function payloadContainsPuuid(payload: unknown, puuid: string): boolean {
  if (payload === puuid) return true;
  return Array.isArray(payload)
    ? payload.some((value) => payloadContainsPuuid(value, puuid))
    : payload !== null &&
        typeof payload === "object" &&
        Object.entries(payload).some(
          ([key, value]) =>
            ((key === "puuid" || key === "summonerPuuid") && value === puuid) ||
            payloadContainsPuuid(value, puuid),
        );
}

export function observationQuarantineReason(
  observation: ScoutClientObservation,
  verifiedPuuids: ReadonlySet<string>,
  acceptedAppVersions: ReadonlySet<string>,
  now: Date,
): ScoutClientObservationQuarantineReason | null {
  if (!acceptedAppVersions.has(observation.appVersion)) {
    return "unverified_app_version";
  }
  if (
    new Date(observation.capturedAt).getTime() >
    now.getTime() + 5 * 60 * 1000
  ) {
    return "future_timestamp";
  }
  if (
    observation.localPuuid !== undefined &&
    !verifiedPuuids.has(observation.localPuuid)
  ) {
    return "unverified_local_puuid";
  }
  const participantKinds = new Set(["lobby", "champ_select", "post_game"]);
  if (participantKinds.has(observation.kind)) {
    if (observation.localPuuid === undefined) {
      return "missing_observer_puuid";
    }
    if (!payloadContainsPuuid(observation.payload, observation.localPuuid)) {
      return "observer_puuid_not_in_payload";
    }
  }
  return observation.kind === "post_game" && observation.gameId === undefined
    ? "missing_post_game_id"
    : null;
}

async function createObservation(
  device: AuthenticatedScoutClient,
  observation: ScoutClientObservation,
  attestation: ObservationAttestation,
  now: Date,
): Promise<Receipt> {
  const digest = bodyDigest(observation);
  const existing = await prisma.scoutClientObservation.findUnique({
    where: { observationId: observation.observationId },
    select: {
      deviceId: true,
      bodyDigest: true,
      disposition: true,
      quarantineReason: true,
    },
  });
  if (existing !== null) {
    if (
      existing.deviceId !== device.deviceId ||
      existing.bodyDigest !== digest
    ) {
      throw new ScoutClientObservationConflict(
        "observation id was reused with different content",
      );
    }
    const quarantineReason =
      existing.disposition === "QUARANTINED"
        ? ScoutClientObservationQuarantineReasonSchema.parse(
            existing.quarantineReason,
          )
        : undefined;
    return {
      observationId: observation.observationId,
      outcome:
        existing.disposition === "QUARANTINED"
          ? "quarantined"
          : "already_accepted",
      ...(quarantineReason === undefined ? {} : { quarantineReason }),
    };
  }

  const reason = observationQuarantineReason(
    observation,
    attestation.verifiedPuuids,
    attestation.acceptedAppVersions,
    now,
  );
  try {
    await prisma.scoutClientObservation.create({
      data: {
        observationId: observation.observationId,
        deviceId: device.deviceId,
        sequence: BigInt(observation.sequence),
        capturedAt: new Date(observation.capturedAt),
        protocolVersion: observation.protocolVersion,
        schemaVersion: observation.schemaVersion,
        appVersion: observation.appVersion,
        kind: observation.kind,
        leaguePatch: observation.leaguePatch ?? null,
        platformId: observation.platformId ?? null,
        localPuuid: observation.localPuuid ?? null,
        lobbyId: observation.lobbyId ?? null,
        gameId: observation.gameId ?? null,
        payload: observation.payload ?? Prisma.JsonNull,
        bodyDigest: digest,
        disposition: reason === null ? "ACCEPTED" : "QUARANTINED",
        quarantineReason: reason,
      },
    });
  } catch (error) {
    if (UniqueViolationSchema.safeParse(error).success) {
      throw new ScoutClientObservationConflict(
        "device sequence was reused with different content",
      );
    }
    throw error;
  }
  return {
    observationId: observation.observationId,
    outcome: reason === null ? "accepted" : "quarantined",
    ...(reason === null ? {} : { quarantineReason: reason }),
  };
}

export async function ingestObservationBatch(
  device: AuthenticatedScoutClient,
  batch: ScoutClientObservationBatch,
  now = new Date(),
): Promise<readonly Receipt[]> {
  const localPuuids = [
    ...new Set(
      batch.observations.flatMap((observation) =>
        observation.localPuuid === undefined ? [] : [observation.localPuuid],
      ),
    ),
  ];
  const [ownedAccounts, authenticatedVersions] = await Promise.all([
    prisma.account.findMany({
      where: {
        puuid: { in: localPuuids },
        player: { discordId: device.ownerId },
      },
      select: { puuid: true },
    }),
    prisma.scoutClientDeviceVersion.findMany({
      where: { deviceId: device.deviceId },
      select: { appVersion: true },
    }),
  ]);
  const verifiedPuuids = new Set(ownedAccounts.map((account) => account.puuid));
  const acceptedAppVersions = new Set(
    authenticatedVersions.map((version) => version.appVersion),
  );
  const attestation = { verifiedPuuids, acceptedAppVersions };
  const receipts: Receipt[] = [];
  for (const observation of batch.observations) {
    const receipt = await createObservation(
      device,
      observation,
      attestation,
      now,
    );
    await projectPlayerSnapshot(observation, receipt);
    if (receipt.outcome !== "quarantined") {
      await bindObservedLobby(observation);
      await bindObservedMatch(observation);
      await projectObservedGameState(observation);
    }
    receipts.push(receipt);
  }
  await prisma.scoutClientDevice.update({
    where: { id: device.deviceId },
    data: { lastSeenAt: now },
  });
  return receipts;
}

function postGameDeliveryMode(
  observation: ScoutClientObservation,
): ScoutClientMatchDispatchItemV2["deliveryMode"] | null {
  const resource = observationResource(observation.payload);
  if (resource === "post_game") return "live";
  return /^match_history_game:\d{1,32}$/u.test(resource ?? "")
    ? "silent-backfill"
    : null;
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
): readonly ScoutClientMatchDispatchItemV2[] {
  const accepted = new Set(
    receipts
      .filter((receipt) => receipt.outcome !== "quarantined")
      .map((receipt) => receipt.observationId),
  );
  const readyAt = IsoInstantSchema.parse(
    new Date(now.getTime() + LOCAL_CANONICAL_DELAY_MS).toISOString(),
  );
  const starts = new Map<string, ScoutClientMatchDispatchItemV2>();
  for (const observation of batch.observations) {
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
    const deliveryMode = postGameDeliveryMode(observation);
    if (deliveryMode === null) continue;
    const sourcePuuid = LeaguePuuidSchema.parse(observation.localPuuid);
    const match = parseLocalCanonicalMatch(parsed.data, {
      observationId: observation.observationId,
      platformId: observation.platformId,
      localPuuid: observation.localPuuid,
      payload: observation.payload,
      bodyDigest: bodyDigest(observation),
    });
    if (match === null) continue;
    const candidate: ScoutClientMatchDispatchItemV2 = {
      riotMatchId: parsed.data,
      sourcePuuid,
      deliveryMode,
      gameEndTimestamp: match.info.gameEndTimestamp,
      readyAt,
      completionTargets: [],
    };
    const existing = starts.get(parsed.data);
    if (existing === undefined || deliveryMode === "live") {
      starts.set(parsed.data, candidate);
    }
  }
  return [...starts.values()].sort(
    (left, right) =>
      left.gameEndTimestamp - right.gameEndTimestamp ||
      left.riotMatchId.localeCompare(right.riotMatchId),
  );
}

/**
 * Select accepted live match identities independently of whether their local
 * payload is complete enough to promote as canonical match data. Binding uses
 * exact roster and match identity evidence, so a late partial observation can
 * still change already-processed Custom and duel projections.
 */
export function acceptedClientBindingMatchIds(
  batch: ScoutClientObservationBatch,
  receipts: readonly Receipt[],
): readonly RiotMatchId[] {
  const accepted = new Set(
    receipts
      .filter((receipt) => receipt.outcome !== "quarantined")
      .map((receipt) => receipt.observationId),
  );
  const matchIds = new Set<RiotMatchId>();
  for (const observation of batch.observations) {
    if (!accepted.has(observation.observationId)) continue;
    const matchId = observedPostGameMatchId(observation);
    if (matchId !== null) matchIds.add(RiotMatchIdSchema.parse(matchId));
  }
  return [...matchIds].sort((left, right) => left.localeCompare(right));
}

/**
 * Durably enqueue accepted native matches behind the same serialized ordering
 * contract as Riot discovery. Failure is returned to the client so its outbox
 * retries the already-idempotent observation and signal together.
 */
export async function startAcceptedClientMatches(
  batch: ScoutClientObservationBatch,
  receipts: readonly Receipt[],
): Promise<void> {
  const starts = acceptedClientMatchDispatches(batch, receipts);
  if (starts.length > 0) {
    const supervisor = currentScoutTemporalSupervisor();
    if (supervisor === undefined) {
      throw new Error(
        "Temporal is unavailable; native match start was not accepted",
      );
    }
    await signalScoutClientMatchDispatchV2(
      supervisor.client(),
      configuration.environment,
      ScoutClientMatchDispatchBatchV2Schema.parse(starts),
    );
  }
  for (const riotMatchId of acceptedClientBindingMatchIds(batch, receipts)) {
    // A binding can arrive after Riot's run has already passed the Custom and
    // duel stages. Once a durable observation exists, replay only those
    // binding-dependent, idempotent projectors; otherwise the newly started or
    // still-running match Workflow will observe the binding itself.
    await reconcileProcessedClientBinding(riotMatchId);
  }
}
