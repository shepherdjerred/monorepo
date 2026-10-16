import {
  regionToPlatformRoute,
  RawCurrentGameInfoSchema,
  type LeaguePuuid,
  type Region,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  isPolicyEnabled,
  isFeatureHardDisabled,
} from "#src/configuration/flags.ts";
import {
  parseLocalPrematch,
  parseLocalPrematchIdentities,
} from "./canonical/local-prematch.ts";
import { withRiotIdentities } from "./identity-alias.ts";
import { z } from "zod";

const PhaseSchema = z.object({
  resource: z.literal("gameflow_phase"),
  data: z.string(),
});

const SessionResourceSchema = z.object({
  resource: z.literal("gameflow_session"),
});

function clientSessionEnded(payload: unknown): boolean {
  const phase = PhaseSchema.safeParse(payload);
  return (
    phase.success &&
    phase.data.data !== "InProgress" &&
    phase.data.data !== "GameStart"
  );
}

/** Fresh, accepted evidence from the observer's device; ended sessions invalidate earlier ones. */
export async function readClientPrematchEvidence(
  puuid: LeaguePuuid,
  region: Region,
  now = new Date(),
) {
  if (isFeatureHardDisabled("scout_client_ingestion")) return null;
  const rows = await prisma.scoutClientObservation.findMany({
    where: {
      localPuuid: puuid,
      kind: "gameflow",
      disposition: "ACCEPTED",
      capturedAt: { gte: new Date(now.getTime() - 90_000), lte: now },
      platformId: regionToPlatformRoute(region),
    },
    orderBy: [{ capturedAt: "desc" }, { sequence: "desc" }],
    take: 20,
    select: {
      observationId: true,
      capturedAt: true,
      payload: true,
      gameId: true,
      device: { select: { ownerId: true } },
    },
  });
  for (const row of rows) {
    if (
      !(await isPolicyEnabled("scout_client_result_recovery", {
        user: row.device.ownerId,
      }))
    )
      continue;
    if (clientSessionEnded(row.payload)) return null;
    if (SessionResourceSchema.safeParse(row.payload).success) {
      if (row.gameId === null) return null;
      const payload = await withRiotIdentities(row.payload);
      const game = parseLocalPrematch(
        payload,
        puuid,
        regionToPlatformRoute(region),
        row.gameId,
      );
      const scoutClientEvidence = {
        observationId: row.observationId,
        capturedAt: row.capturedAt.toISOString(),
      };
      const identities = parseLocalPrematchIdentities(
        payload,
        puuid,
        regionToPlatformRoute(region),
        row.gameId,
      );
      return addPrematchProvenance(game, identities, scoutClientEvidence);
    }
  }
  return null;
}

function addPrematchProvenance(
  game: ReturnType<typeof parseLocalPrematch>,
  identities: ReturnType<typeof parseLocalPrematchIdentities>,
  scoutClientEvidence: { observationId: string; capturedAt: string },
) {
  return {
    game:
      game === null
        ? null
        : RawCurrentGameInfoSchema.parse({ ...game, scoutClientEvidence }),
    identities:
      identities === null ? null : { ...identities, scoutClientEvidence },
  };
}

export async function readClientPrematch(
  puuid: LeaguePuuid,
  region: Region,
  now = new Date(),
): Promise<RawCurrentGameInfo | null> {
  const evidence = await readClientPrematchEvidence(puuid, region, now);
  return evidence?.game ?? null;
}
