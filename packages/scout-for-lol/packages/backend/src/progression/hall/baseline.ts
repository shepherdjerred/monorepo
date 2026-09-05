import {
  DiscordGuildIdSchema,
  HallQueueFamilyIdSchema,
  HallRecordEvidenceSchema,
  HallRecordHolderSchema,
  HallRecordIdSchema,
  classifyHallQueueFamily,
  compareHallCandidate,
  hallRecordValue,
  isHallEligibleMatch,
  type DiscordGuildId,
  type HallRecordEvidence,
  type HallRecordHolder,
  type HallRecordId,
} from "@scout-for-lol/data";
import type { ScoutHallBaselineInput } from "@scout-for-lol/temporal";
import { prisma, type Db } from "#src/database/index.ts";
import { hallBaselineDuration } from "#src/metrics/progression.ts";
import {
  fetchProgressionMatches,
  type ProgressionMatchCursor,
  type ProgressionMatchRow,
} from "#src/progression/progression-lake-reads.ts";

const PAGE_SIZE = 10_000;

export async function lockHallRecords(
  tx: Pick<Db, "$executeRaw">,
  guildId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-hall-records'), hashtext(${guildId}))`;
}

type TrackedAccount = {
  readonly id: number;
  readonly alias: string;
  readonly puuid: string;
  readonly createdTime: Date;
  readonly player: { readonly id: number; readonly alias: string };
};

type BaselineValue = {
  readonly value: number;
  readonly holders: HallRecordHolder[];
  readonly evidence: HallRecordEvidence[];
};

function cellKey(queueFamilyId: string, recordId: string): string {
  return `${queueFamilyId}:${recordId}`;
}

function holderFor(account: TrackedAccount): HallRecordHolder {
  return HallRecordHolderSchema.parse({
    playerId: account.player.id,
    playerAlias: account.player.alias,
    accountId: account.id,
    accountAlias: account.alias,
    puuid: account.puuid,
  });
}

function evidenceFor(
  match: ProgressionMatchRow,
  value: number,
  holder: HallRecordHolder,
): HallRecordEvidence {
  return HallRecordEvidenceSchema.parse({
    matchId: match.match_id,
    gameEndAt: match.game_end_at,
    value,
    holder,
  });
}

function considerMatch(
  values: Map<string, BaselineValue>,
  match: ProgressionMatchRow,
  account: TrackedAccount,
  catalog: {
    readonly targetCellKeys: ReadonlySet<string>;
    readonly recordIds: readonly HallRecordId[];
  },
): void {
  if (!isHallEligibleMatch(match, account.createdTime)) return;
  const family = classifyHallQueueFamily(match.queue);
  if (family === null) return;
  const holder = holderFor(account);
  for (const recordId of catalog.recordIds) {
    const key = cellKey(family, recordId);
    if (!catalog.targetCellKeys.has(key)) continue;
    const value = hallRecordValue(match, recordId);
    const candidateEvidence = evidenceFor(match, value, holder);
    const current = values.get(key);
    const comparison = compareHallCandidate(
      current?.value ?? null,
      current?.holders ?? [],
      current?.evidence ?? [],
      {
        queueFamilyId: family,
        recordId,
        value,
        holder,
        evidence: candidateEvidence,
      },
    );
    if (comparison.kind === "below") continue;
    values.set(key, {
      value: comparison.kind === "break" ? comparison.value : value,
      holders: comparison.holders,
      evidence: comparison.evidence,
    });
  }
}

function nextCursor(
  rows: readonly ProgressionMatchRow[],
): ProgressionMatchCursor {
  const last = rows.at(-1);
  if (last === undefined) throw new Error("Cannot advance an empty Hall page");
  return {
    gameEndMs: last.game_end_ms,
    matchId: last.match_id,
    puuid: last.puuid,
  };
}

async function calculateBaseline(
  accounts: readonly TrackedAccount[],
  targetCellKeys: ReadonlySet<string>,
  recordIds: readonly HallRecordId[],
  onProgress: ((rows: number) => void) | undefined,
): Promise<Map<string, BaselineValue>> {
  const earliest = accounts.reduce(
    (minimum, account) =>
      new Date(Math.min(account.createdTime.getTime(), minimum.getTime())),
    accounts[0]?.createdTime ?? new Date(),
  );
  const byPuuid = new Map(accounts.map((account) => [account.puuid, account]));
  const values = new Map<string, BaselineValue>();
  let cursor: ProgressionMatchCursor | undefined;
  let processed = 0;
  for (;;) {
    const rows = await fetchProgressionMatches({
      puuids: [...byPuuid.keys()],
      startAt: earliest,
      ...(cursor === undefined ? {} : { cursor }),
      limit: PAGE_SIZE,
    });
    for (const match of rows) {
      const account = byPuuid.get(match.puuid);
      if (account === undefined) {
        throw new Error(`Hall lake returned unrequested PUUID ${match.puuid}`);
      }
      considerMatch(values, match, account, { targetCellKeys, recordIds });
    }
    processed += rows.length;
    onProgress?.(processed);
    if (rows.length < PAGE_SIZE) return values;
    cursor = nextCursor(rows);
  }
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
  const keys = new Set(
    cells.map((cell) =>
      cellKey(
        HallQueueFamilyIdSchema.parse(cell.queueFamilyId),
        HallRecordIdSchema.parse(cell.recordId),
      ),
    ),
  );
  const recordIds = [
    ...new Set(cells.map((cell) => HallRecordIdSchema.parse(cell.recordId))),
  ];
  const values = await calculateBaseline(accounts, keys, recordIds, onProgress);
  const completedAt = new Date();
  for (const cell of cells) {
    const value = values.get(cellKey(cell.queueFamilyId, cell.recordId));
    await tx.hallRecordCell.updateMany({
      where: {
        id: cell.id,
        baselineRevision: input.revision,
        baselineStatus: "building",
      },
      data: {
        baselineStatus: "ready",
        baselineValue: value?.value ?? null,
        currentValue: value?.value ?? null,
        holdersJson: JSON.stringify(value?.holders ?? []),
        evidenceJson: JSON.stringify(value?.evidence ?? []),
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
