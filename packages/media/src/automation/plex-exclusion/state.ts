import { z } from "zod";
import type { Prisma, PlexExclusionRun } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { PlexExclusionOperation } from "#shared/plex-exclusion.ts";
import {
  PlexExclusionEvidenceSchema,
  PlexScanObservationSchema,
} from "#shared/plex-exclusion.ts";
import { ProbeJournalSchema } from "#filesystem/plex-exclusion-state.ts";

const ScanSchema = z.object({
  requestedAt: z.iso.datetime(),
  activityId: z.string().nullable(),
  first: PlexScanObservationSchema.nullable(),
  second: PlexScanObservationSchema.nullable(),
  state: z.enum(["sending", "waiting", "verified", "intervention"]),
  reason: z.string().nullable(),
});
export const RunJournalSchema = z.object({
  recoveryStartedAt: z.iso.datetime().optional(),
  cleanupReview: z
    .record(
      z.string().regex(/^\d+$/u),
      z.object({
        paths: z.array(z.string()).max(100),
        allPartsMatchProbes: z.boolean(),
      }),
    )
    .optional(),
  files: ProbeJournalSchema.optional(),
  scan: ScanSchema.optional(),
  cleanupScan: ScanSchema.optional(),
  evidence: PlexExclusionEvidenceSchema.optional(),
  reason: z.string().nullable().optional(),
  topologyCheckedAt: z.iso.datetime().optional(),
});
export type RunJournal = z.infer<typeof RunJournalSchema>;

/** All callers lock runtime before run, and both before filesystem locks or final network effects. */
export async function lockedRun<T>(
  db: Database,
  input: PlexExclusionOperation,
  action: (tx: Prisma.TransactionClient, run: PlexExclusionRun) => Promise<T>,
): Promise<T> {
  return await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "PlexExclusionRun" WHERE id = ${input.runId} FOR UPDATE`;
      const run = await tx.plexExclusionRun.findUniqueOrThrow({
        where: { id: input.runId },
      });
      await assertRunAuthority(tx, run, input.operationId);
      return await action(tx, run);
    },
    { timeout: 60_000 },
  );
}

export async function assertRunAuthority(
  tx: Prisma.TransactionClient,
  run: PlexExclusionRun,
  operationId: string,
): Promise<void> {
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const owner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: run.ownerId },
  });
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  if (
    runtime.mode !== "observe" ||
    runtime.recoveryEpoch !== run.recoveryEpoch ||
    runtime.version !== run.runtimeVersion ||
    owner.role !== "owner" ||
    operation.userId !== owner.id ||
    operation.targetId !== run.id ||
    ![
      "plex_exclusion_prepare",
      "plex_exclusion_execute",
      "plex_exclusion_recover",
    ].includes(operation.kind)
  )
    throw new Error("Plex exclusion execution authority changed");
  if (
    (await tx.acquisitionAttempt.count({
      where: {
        state: {
          in: [
            "submitting",
            "submission_unknown",
            "inspecting",
            "importing",
            "publishing",
          ],
        },
      },
    })) !== 0
  )
    throw new Error("Plex exclusion requires quiescent acquisition effects");
}

export async function saveRun(
  tx: Prisma.TransactionClient,
  runId: string,
  journal: RunJournal,
  state: string,
): Promise<void> {
  await tx.plexExclusionRun.update({
    where: { id: runId },
    data: { journal, state, version: { increment: 1 } },
  });
}
