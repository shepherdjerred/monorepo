import { z } from "zod";
import {
  type ScoutClientObservation,
  type ScoutClientObservationBatch,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { Prisma } from "#generated/prisma/client/index.js";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import configuration from "#src/configuration.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { startScoutMatchProcessingV2 } from "#src/temporal/starts-v2.ts";
import type { AuthenticatedScoutClient } from "./authentication.ts";
import {
  bindObservedLobby,
  projectObservedGameState,
} from "./lobby-binding.ts";

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });

export class ScoutClientObservationConflict extends Error {}

type Receipt = {
  readonly observationId: string;
  readonly outcome: "accepted" | "already_accepted" | "quarantined";
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
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !("resource" in payload) ||
    typeof payload.resource !== "string" ||
    payload.resource.length === 0 ||
    payload.resource.length > 80
  ) {
    return null;
  }
  return payload.resource;
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
  if (Array.isArray(payload)) {
    return payload.some((value) => payloadContainsPuuid(value, puuid));
  }
  if (payload === null || typeof payload !== "object") return false;
  return Object.entries(payload).some(
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
): string | null {
  if (!acceptedAppVersions.has(observation.appVersion)) {
    return "observation app version has not authenticated for this device";
  }
  if (
    new Date(observation.capturedAt).getTime() >
    now.getTime() + 5 * 60 * 1000
  ) {
    return "observation timestamp is more than five minutes in the future";
  }
  if (
    observation.localPuuid !== undefined &&
    !verifiedPuuids.has(observation.localPuuid)
  ) {
    return "local PUUID is not linked to the paired Scout user";
  }
  const participantKinds = new Set(["lobby", "champ_select", "post_game"]);
  if (participantKinds.has(observation.kind)) {
    if (observation.localPuuid === undefined) {
      return "participant observation has no local PUUID";
    }
    if (!payloadContainsPuuid(observation.payload, observation.localPuuid)) {
      return "observer PUUID does not appear in the participant payload";
    }
  }
  if (observation.kind === "post_game" && observation.gameId === undefined) {
    return "post-game observation has no game ID";
  }
  return null;
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
    select: { deviceId: true, bodyDigest: true, disposition: true },
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
    return {
      observationId: observation.observationId,
      outcome:
        existing.disposition === "QUARANTINED"
          ? "quarantined"
          : "already_accepted",
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
 * Hand every accepted native post-game observation to the same durable match
 * pipeline used by Riot discovery. Failure is returned to the client so its
 * outbox retries the already-idempotent observation and start together.
 */
export async function startAcceptedClientMatches(
  batch: ScoutClientObservationBatch,
  receipts: readonly Receipt[],
): Promise<void> {
  const accepted = new Set(
    receipts
      .filter((receipt) => receipt.outcome !== "quarantined")
      .map((receipt) => receipt.observationId),
  );
  const starts = new Map<
    string,
    {
      riotMatchId: ReturnType<typeof RiotMatchIdSchema.parse>;
      sourcePuuid: ReturnType<typeof LeaguePuuidSchema.parse>;
    }
  >();
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
    starts.set(parsed.data, {
      riotMatchId: parsed.data,
      sourcePuuid: LeaguePuuidSchema.parse(observation.localPuuid),
    });
  }
  if (starts.size === 0) return;
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    throw new Error(
      "Temporal is unavailable; native match start was not accepted",
    );
  }
  for (const start of starts.values()) {
    await startScoutMatchProcessingV2(supervisor.client(), {
      stage: configuration.environment,
      riotMatchId: start.riotMatchId,
      sourcePuuid: start.sourcePuuid,
      deliveryMode: "live",
    });
  }
}
