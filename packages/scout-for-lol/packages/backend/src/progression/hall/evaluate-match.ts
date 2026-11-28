import {
  DiscordGuildIdSchema,
  HallRecordIdSchema,
  QueueTypeSchema,
  classifyHallQueueFamily,
  isHallEligibleMatch,
  matchCoverageOf,
  type CanonicalMatch,
  type DiscordGuildId,
  type HallQueueFamilyId,
  type HallRecordHolder,
  type HallRecordId,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  LeaguePuuidSchema,
  type LeaguePuuid,
} from "@scout-for-lol/domain/identity/league-account.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type Db } from "#src/database/index.ts";
import { flattenMatch } from "#src/report-lake/flatten.ts";
import { lockHallRecords } from "./baseline.ts";
import { announceHallRecordBreak } from "./break-announcement.ts";
import {
  HallBreakPayloadSchema,
  type HallBreakPayload,
} from "./break-payload.ts";
import { calculateHallStandings } from "./history.ts";
import {
  addHallCandidate,
  hallCandidateFor,
  hallCellKey,
  hallHolderFor,
  hallRankingsColumns,
  hallRankScore,
  hallStandingsFromCell,
  legacyHallStandings,
  type HallMatchRow,
  type HallStandings,
} from "./rankings.ts";
import { hallSettingsFromRow } from "./settings.ts";

type HallMatch = {
  readonly matchId: RiotMatchId;
  readonly gameEndMs: number;
  readonly family: HallQueueFamilyId;
  readonly rows: ReadonlyMap<LeaguePuuid, HallMatchRow>;
};

type HallEntrant = {
  readonly row: HallMatchRow;
  readonly holder: HallRecordHolder;
};

type ReadyHallCell = {
  readonly id: string;
  readonly recordId: HallRecordId;
  readonly baselineRevision: number;
  readonly currentValue: number | null;
  readonly evidenceJson: string;
  readonly standings: HallStandings | null;
};

/** Use the projection's scoring inputs without waiting for projection I/O. */
function hallMatchFrom(match: CanonicalMatch): HallMatch | null {
  if (matchCoverageOf(match.metadata) === "history") {
    return null;
  }
  const flattened = flattenMatch(match);
  const queueValue = flattened[0]?.queue;
  if (queueValue === null || queueValue === undefined) {
    return null;
  }
  const queue = QueueTypeSchema.parse(queueValue);
  const family = classifyHallQueueFamily(queue);
  if (family === null) {
    return null;
  }

  const matchId = match.metadata.matchId;
  const gameEndMs = match.info.gameEndTimestamp;
  const gameEndAt = new Date(gameEndMs).toISOString();
  const rows = new Map<LeaguePuuid, HallMatchRow>();
  for (const row of flattened) {
    if (row.puuid === null) {
      continue;
    }
    rows.set(LeaguePuuidSchema.parse(row.puuid), {
      ...row,
      match_id: matchId,
      game_end_at: gameEndAt,
      queue,
    });
  }
  return { matchId, gameEndMs, family, rows };
}

async function applyHallCell(
  tx: Db,
  cell: ReadyHallCell,
  options: {
    readonly before: HallStandings;
    readonly entrants: readonly HallEntrant[];
    readonly match: HallMatch;
  },
): Promise<HallBreakPayload | null> {
  const { before, entrants, match } = options;
  let after = before;
  for (const { row, holder } of entrants) {
    after = addHallCandidate(
      after,
      hallCandidateFor(row, holder, match.family, cell.recordId),
    );
  }
  if (after === before && cell.standings !== null) {
    return null;
  }
  const write = await tx.hallRecordCell.updateMany({
    where: {
      id: cell.id,
      baselineRevision: cell.baselineRevision,
      baselineStatus: "ready",
    },
    data: hallRankingsColumns(after, cell.baselineRevision),
  });
  if (write.count === 0) {
    return null;
  }
  const previous = before[0];
  const top = after[0];
  if (
    previous === undefined ||
    top === undefined ||
    top.value <= previous.value
  ) {
    return null;
  }

  const newEvidence = top.evidence[0];
  if (newEvidence?.matchId !== match.matchId) {
    throw new Error(
      `Broken Hall cell ${cell.id} has no evidence for ${match.matchId}`,
    );
  }
  return HallBreakPayloadSchema.parse({
    ...newEvidence,
    queueFamilyId: match.family,
    recordId: cell.recordId,
    holders: hallRankScore(top).holders,
    previous: hallRankScore(previous),
    standings: after.map((rank) => hallRankScore(rank)),
  });
}

async function evaluateGuild(
  tx: Db,
  guildId: DiscordGuildId,
  match: HallMatch,
): Promise<void> {
  await lockHallRecords(tx, guildId);
  const settingsRow = await tx.hallSettings.findUnique({ where: { guildId } });
  if (settingsRow === null) {
    return;
  }
  const settings = hallSettingsFromRow(settingsRow);
  if (!settings.enabledQueueFamilies.includes(match.family)) {
    return;
  }

  const rows = await tx.hallRecordCell.findMany({
    where: {
      guildId,
      queueFamilyId: match.family,
      recordId: { in: settings.enabledRecords },
      baselineStatus: "ready",
    },
    orderBy: { recordId: "asc" },
  });
  if (rows.length === 0) {
    return;
  }
  const cells = rows.map((row): ReadyHallCell => ({
    ...row,
    recordId: HallRecordIdSchema.parse(row.recordId),
    standings: hallStandingsFromCell(row),
  }));
  const unseeded = cells.filter((cell) => cell.standings === null);
  const accounts = await tx.account.findMany({
    where: {
      serverId: guildId,
      ...(unseeded.length === 0
        ? { puuid: { in: [...match.rows.keys()] } }
        : {}),
    },
    include: { player: true },
    orderBy: { id: "asc" },
  });
  const entrants = accounts.flatMap((account): HallEntrant[] => {
    const row = match.rows.get(account.puuid);
    return row === undefined || !isHallEligibleMatch(row, account.createdTime)
      ? []
      : [{ row, holder: hallHolderFor(account) }];
  });
  if (entrants.length === 0) {
    return;
  }

  // Initialize old ready cells from prior games only, so the incoming match
  // can still break the record. Keep the committed #1 if the lake lags it.
  const initial = new Map(
    unseeded.map((cell) => [
      hallCellKey(match.family, cell.recordId),
      legacyHallStandings(cell),
    ]),
  );
  const seeded = await calculateHallStandings({
    accounts,
    before: match,
    recordIds: unseeded.map((cell) => cell.recordId),
    targetCellKeys: new Set(initial.keys()),
    initial,
  });
  const records: HallBreakPayload[] = [];
  for (const cell of cells) {
    const key = hallCellKey(match.family, cell.recordId);
    const before = cell.standings ?? seeded.get(key);
    if (before === undefined) {
      throw new Error(`Missing Hall standings for ${cell.id}`);
    }
    const record = await applyHallCell(tx, cell, { before, entrants, match });
    if (record !== null) {
      records.push(record);
    }
  }
  if (records.length === 0 || settings.channelId === null) {
    return;
  }
  await announceHallRecordBreak(tx, {
    guildId,
    matchId: match.matchId,
    channelId: settings.channelId,
    records,
    now: new Date(),
  });
}

/** Evaluate one durably ingested match before account cursors advance. */
export async function evaluateHallMatch(
  matchData: CanonicalMatch,
): Promise<void> {
  const match = hallMatchFrom(matchData);
  if (match === null || match.rows.size === 0) {
    return;
  }
  const accounts = await prisma.account.findMany({
    where: { puuid: { in: [...match.rows.keys()] } },
    select: { serverId: true },
    distinct: ["serverId"],
  });
  for (const account of accounts) {
    const guildId = DiscordGuildIdSchema.parse(account.serverId);
    if (!(await isPolicyEnabled("hall_of_fame_enabled", { server: guildId }))) {
      continue;
    }

    // A one-time history seed may need longer than Prisma's default
    // transaction timeout. Keep it bounded by the realtime Activity budget.
    await prisma.$transaction(
      async (tx) => {
        await evaluateGuild(tx, guildId, match);
      },
      {
        timeout: 60_000,
      },
    );
  }
}
