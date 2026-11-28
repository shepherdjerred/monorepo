import {
  DiscordGuildIdSchema,
  HallQueueFamilyIdSchema,
  HallRecordIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { ScoutHallBaselineInput } from "@scout-for-lol/temporal";
import { prisma, type Db } from "#src/database/index.ts";
import { hallBaselineDuration } from "#src/metrics/progression.ts";
import { calculateHallStandings } from "./history.ts";
import { hallCellKey, hallRankingsColumns } from "./rankings.ts";

export async function lockHallRecords(
  tx: Pick<Db, "$executeRaw">,
  guildId: DiscordGuildId,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-hall-records'), hashtext(${guildId}))`;
}

async function markBaselineFailed(
  input: ScoutHallBaselineInput,
  error: unknown,
): Promise<void> {
  const guildId = DiscordGuildIdSchema.parse(input.guildId);
  const message = error instanceof Error ? error.message : String(error);
  await prisma.$transaction([
    prisma.hallRecordCell.updateMany({
      where: {
        guildId,
        baselineRevision: input.revision,
        baselineStatus: "building",
      },
      data: {
        baselineStatus: "failed",
        errorMessage: message,
        baselineCompletedAt: new Date(),
      },
    }),
    prisma.hallBaselineRun.updateMany({
      where: {
        guildId,
        revision: input.revision,
        baselineState: "building",
      },
      data: {
        baselineState: "failed",
        errorMessage: message,
        completedAt: new Date(),
      },
    }),
  ]);
}

async function calculateAndPersistBaseline(
  tx: Db,
  input: ScoutHallBaselineInput,
  guildId: DiscordGuildId,
  onProgress: ((rows: number) => void) | undefined,
): Promise<boolean> {
  await lockHallRecords(tx, guildId);
  const run = await tx.hallBaselineRun.findUnique({
    where: {
      guildId_revision: { guildId, revision: input.revision },
    },
  });
  if (run === null) throw new Error("Hall baseline run is missing");
  if (run.baselineState === "ready") return false;
  await tx.hallBaselineRun.update({
    where: { id: run.id },
    data: {
      baselineState: "building",
      startedAt: run.startedAt ?? new Date(),
      errorMessage: null,
    },
  });
  await tx.hallRecordCell.updateMany({
    where: {
      guildId,
      baselineRevision: input.revision,
      baselineStatus: "failed",
    },
    data: { baselineStatus: "building", errorMessage: null },
  });
  const cells = await tx.hallRecordCell.findMany({
    where: {
      guildId,
      baselineRevision: input.revision,
      baselineStatus: "building",
    },
  });
  const accounts = await tx.account.findMany({
    where: { serverId: guildId },
    include: { player: true },
  });
  const targetCellKeys = new Set(
    cells.map((cell) =>
      hallCellKey(
        HallQueueFamilyIdSchema.parse(cell.queueFamilyId),
        HallRecordIdSchema.parse(cell.recordId),
      ),
    ),
  );
  const recordIds = [
    ...new Set(cells.map((cell) => HallRecordIdSchema.parse(cell.recordId))),
  ];
  const values = await calculateHallStandings({
    accounts,
    targetCellKeys,
    recordIds,
    onProgress,
  });
  const completedAt = new Date();
  for (const cell of cells) {
    const standings =
      values.get(hallCellKey(cell.queueFamilyId, cell.recordId)) ?? [];
    const rankings = hallRankingsColumns(standings, input.revision);
    await tx.hallRecordCell.updateMany({
      where: {
        id: cell.id,
        baselineRevision: input.revision,
        baselineStatus: "building",
      },
      data: {
        baselineStatus: "ready",
        baselineValue: rankings.currentValue,
        ...rankings,
        errorMessage: null,
        baselineCompletedAt: completedAt,
      },
    });
  }
  await tx.hallBaselineRun.updateMany({
    where: { id: run.id, baselineState: "building" },
    data: { baselineState: "ready", completedAt, errorMessage: null },
  });
  return true;
}

export async function runHallBaseline(
  input: ScoutHallBaselineInput,
  onProgress?: (rows: number) => void,
): Promise<void> {
  const startedAt = Date.now();
  const guildId = DiscordGuildIdSchema.parse(input.guildId);
  try {
    const completed = await prisma.$transaction(
      async (tx) =>
        await calculateAndPersistBaseline(tx, input, guildId, onProgress),
      { maxWait: 60_000, timeout: 60 * 60 * 1000 },
    );
    if (!completed) return;
    hallBaselineDuration.observe(
      { status: "ready" },
      (Date.now() - startedAt) / 1000,
    );
  } catch (error) {
    await markBaselineFailed(input, error);
    hallBaselineDuration.observe(
      { status: "failed" },
      (Date.now() - startedAt) / 1000,
    );
    throw error;
  }
}
