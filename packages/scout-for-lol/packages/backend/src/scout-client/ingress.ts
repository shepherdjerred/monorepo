import { z } from "zod";
import {
  ScoutClientObservationQuarantineReasonSchema,
  type ScoutClientObservation,
  type ScoutClientObservationBatch,
  type ScoutClientObservationQuarantineReason,
  withoutScoutClientCredentials,
} from "@scout-for-lol/data";
import {
  recordPostGameOutcome,
  recordStoredObservation,
} from "./telemetry/capture-metrics.ts";
import { prisma } from "#src/database/index.ts";
import { withoutShadowedClashGames } from "#src/league/clash/alias.ts";
import { Prisma } from "#generated/prisma/client/index.js";
import configuration from "#src/configuration.ts";
import {
  isPolicyEnabled,
  isFeatureHardDisabled,
} from "#src/configuration/flags.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { signalScoutClientMatchDispatch } from "#src/temporal/pipeline-starts.ts";
import { ScoutClientMatchDispatchBatchSchema } from "@scout-for-lol/temporal/workflow-contracts";
import type { AuthenticatedScoutClient } from "./authentication.ts";
import { isLcuUuid, readIdentityAliases } from "./identity-alias.ts";
import {
  learnBatchIdentities,
  observationUuids,
  translateObservation,
} from "./observation-identity.ts";
import { observationQuarantineReason } from "./quarantine/observation-quarantine.ts";
import { reconcileProcessedClientBinding } from "./late-binding.ts";
import { withObserverPlatform } from "./platform-context.ts";
import { projectClashEntity } from "./clash-entities.ts";
import { projectClientGameResult } from "./game-results.ts";
import {
  acceptedObservationPlatforms,
  acceptedClientBindingMatchIds,
} from "./accepted-observations.ts";
import { bodyDigest, evaluateClientPostGames } from "./dispatch-policy.ts";
import {
  admitMatchEvidence,
  admittedDeliveryMode,
} from "#src/evidence/admission.ts";
import { receivedObservationEnvelope } from "./archive/envelope.ts";
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
  const nextSequence = maximumSequence === null ? 1n : maximumSequence + 1n;
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

/** The observer UUID the client sent, kept when it was a League-client UUID. */
function sentLcuUuid(raw: ScoutClientObservation): string | null {
  return raw.localPuuid !== undefined && isLcuUuid(raw.localPuuid)
    ? raw.localPuuid
    : null;
}

/** An observation as sent (stored, digested) and as read (translated). */
type ReceivedObservation = {
  /** Exactly as the client sent it: the idempotency digest covers this. */
  readonly sent: ScoutClientObservation;
  /** As sent, minus credential-named keys: what is stored. */
  readonly raw: ScoutClientObservation;
  /** Raw evidence with player identities translated: what every check reads. */
  readonly observation: ScoutClientObservation;
};

async function createObservation(
  device: AuthenticatedScoutClient,
  { sent, raw, observation }: ReceivedObservation,
  attestation: ObservationAttestation,
  now: Date,
): Promise<Receipt> {
  // The digest covers what was sent, so a client retrying an observation
  // stored before credentials were stripped still matches its first copy.
  const digest = bodyDigest(sent);
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
        localLcuUuid: sentLcuUuid(raw),
        lobbyId: observation.lobbyId ?? null,
        gameId: observation.gameId ?? null,
        payload: raw.payload ?? Prisma.JsonNull,
        rawEnvelope: receivedObservationEnvelope(raw),
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
  recordStoredObservation(observation, reason);
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
  if (isFeatureHardDisabled("scout_client_ingestion"))
    throw new Error("Scout Client ingestion is disabled in production");
  await learnBatchIdentities(device, batch.observations);
  const identities = await readIdentityAliases(
    observationUuids(batch.observations),
  );
  // An older client sends the League client's chat passwords and JWTs; none
  // of it is stored or read past this point.
  const stripped = batch.observations.map((observation) =>
    withoutScoutClientCredentials(observation),
  );
  const translated = stripped.map((observation) =>
    translateObservation(observation, identities),
  );
  const localPuuids = [
    ...new Set(
      translated.flatMap((observation) =>
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
      select: { puuid: true, region: true },
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
  const recoverResults = await isPolicyEnabled("scout_client_result_recovery", {
    user: device.ownerId,
  });
  for (const [index, sent] of batch.observations.entries()) {
    const raw = stripped[index] ?? withoutScoutClientCredentials(sent);
    const observation = withObserverPlatform(
      translated[index] ?? raw,
      ownedAccounts,
    );
    const receipt = await createObservation(
      device,
      { sent, raw, observation },
      attestation,
      now,
    );
    await projectPlayerSnapshot(observation, receipt);
    if (receipt.outcome !== "quarantined") {
      await projectClashEntity(observation);
      if (recoverResults) await projectClientGameResult(observation);
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

/**
 * Durably enqueue accepted native matches behind the same serialized ordering
 * contract as Riot discovery. Failure is returned to the client so its outbox
 * retries the already-idempotent observation and signal together.
 */
export async function startAcceptedClientMatches(
  batch: ScoutClientObservationBatch,
  receipts: readonly Receipt[],
): Promise<void> {
  if (isFeatureHardDisabled("scout_client_ingestion")) return;
  const platforms = await acceptedObservationPlatforms(
    receipts
      .filter((receipt) => receipt.outcome !== "quarantined")
      .map((receipt) => receipt.observationId),
  );
  const contextualBatch = {
    observations: batch.observations.map((observation) => {
      const platformId = platforms.get(observation.observationId);
      return platformId == null ? observation : { ...observation, platformId };
    }),
  };
  // Ingest has already learned every alias this batch can teach.
  const {
    dispatches: evaluated,
    evaluations,
    games,
  } = evaluateClientPostGames(
    contextualBatch,
    receipts,
    new Date(),
    await readIdentityAliases(observationUuids(batch.observations)),
  );
  // Only a first acceptance counts: reconciliation and client retries replay
  // this path with `already_accepted` receipts for observations counted before.
  const fresh = new Set(
    receipts
      .filter((receipt) => receipt.outcome === "accepted")
      .map((receipt) => receipt.observationId),
  );
  for (const evaluation of evaluations) {
    if (fresh.has(evaluation.observationId))
      recordPostGameOutcome(evaluation.outcome, evaluation.gameKind);
  }
  const dispatches = await withoutShadowedClashGames(evaluated, games);
  const admitted = await Promise.all(
    dispatches.map(async (item) => {
      const policy = await admitMatchEvidence({
        matchId: item.riotMatchId,
        completedAt: item.gameEndTimestamp,
        historical: item.deliveryMode === "silent-backfill",
      });
      return {
        ...item,
        deliveryMode: admittedDeliveryMode(policy, item.deliveryMode),
      };
    }),
  );
  // Admission is the durable background job. Historical capture/report work
  // never enters or holds the ordered live-effects serializer.
  const starts = admitted.filter((item) => item.deliveryMode === "live");
  if (starts.length > 0) {
    const supervisor = currentScoutTemporalSupervisor();
    if (supervisor === undefined) {
      throw new Error(
        "Temporal is unavailable; native match start was not accepted",
      );
    }
    await signalScoutClientMatchDispatch(
      supervisor.client(),
      configuration.environment,
      ScoutClientMatchDispatchBatchSchema.parse(starts),
    );
  }
  for (const riotMatchId of acceptedClientBindingMatchIds(
    contextualBatch,
    receipts,
  )) {
    // A binding can arrive after Riot's run has already passed the Custom and
    // duel stages. Once a durable observation exists, replay only those
    // binding-dependent, idempotent projectors; otherwise the newly started or
    // still-running match Workflow will observe the binding itself.
    await reconcileProcessedClientBinding(riotMatchId);
  }
}
