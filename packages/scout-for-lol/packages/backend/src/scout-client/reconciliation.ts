import {
  revalidateClientObservation,
  type RecoveryObservationRow,
} from "./revalidation.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { projectClientGameResult } from "./game-results.ts";
import { projectClashEntity } from "./clash-entities.ts";
import { startAcceptedClientMatches } from "./ingress.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";

const RECOVERY_VERSION = 1;

/** One bounded page, driven by the existing Temporal reconciliation activity. */
export async function reconcileAcceptedClientEvidence(
  now = new Date(),
): Promise<number> {
  if (!(await isPolicyEnabled("scout_client_result_recovery", {}))) return 0;
  const rows = await prisma.scoutClientObservation.findMany({
    where: {
      disposition: { in: ["ACCEPTED", "QUARANTINED"] },
      kind: { in: ["post_game", "clash"] },
      OR: [
        { recoveryVersion: { lt: RECOVERY_VERSION } },
        {
          recoveryComplete: false,
          recoveryAttemptAt: { lt: new Date(now.getTime() - 5 * 60 * 1000) },
        },
      ],
    },
    orderBy: [
      { recoveryAttemptAt: { sort: "asc", nulls: "first" } },
      { observationId: "asc" },
    ],
    take: 50,
    include: { device: { select: { ownerId: true } } },
  });
  const failures: unknown[] = [];
  for (const row of rows) {
    // Checkpoint the attempt before work so a failing row cannot starve a page.
    await prisma.scoutClientObservation.update({
      where: { observationId: row.observationId },
      data: {
        recoveryVersion: RECOVERY_VERSION,
        recoveryAttemptAt: now,
        recoveryComplete: false,
      },
    });
    try {
      await recoverRow(row, now);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "Client evidence reconciliation failed; attempts remain retryable",
    );
  return rows.length;
}

async function recoverRow(
  row: RecoveryObservationRow,
  now: Date,
): Promise<void> {
  if (
    !(await isPolicyEnabled("scout_client_result_recovery", {
      user: row.device.ownerId,
    }))
  )
    return;
  const observation = await revalidateClientObservation(row, now);
  if (observation === null) return;
  if (row.platformId === null && observation.platformId !== undefined) {
    // Derived routing metadata, as ingress writes it; raw payload and digest stay intact.
    await prisma.scoutClientObservation.update({
      where: { observationId: row.observationId },
      data: { platformId: observation.platformId },
    });
  }
  await projectClashEntity(observation);
  await projectClientGameResult(observation);
  await startAcceptedClientMatches({ observations: [observation] }, [
    { observationId: row.observationId, outcome: "already_accepted" },
  ]);
  const matchId = RiotMatchIdSchema.safeParse(
    `${observation.platformId ?? ""}_${observation.gameId ?? ""}`,
  );
  const result =
    row.kind === "post_game" && matchId.success
      ? await prisma.scoutClientGameResult.findFirst({
          where: {
            riotMatchId: matchId.data,
            observerPuuid: LeaguePuuidSchema.parse(observation.localPuuid),
            observation: {
              device: { ownerId: row.device.ownerId },
              disposition: "ACCEPTED",
            },
          },
          select: { observationId: true },
        })
      : null;
  await prisma.scoutClientObservation.update({
    where: { observationId: row.observationId },
    data: {
      recoveryVersion: RECOVERY_VERSION,
      recoveryAttemptAt: now,
      recoveryComplete: row.kind === "clash" || result !== null,
    },
  });
}
