import {
  HallQueueFamilyIdSchema,
  HallRecordEvidenceSchema,
  HallRecordHolderSchema,
  HallRecordIdSchema,
  DiscordGuildIdSchema,
  classifyHallQueueFamily,
  compareHallCandidate,
  hallRecordValue,
  isHallEligibleMatch,
  type DiscordGuildId,
  type HallRecordHolder,
  type RawMatch,
} from "@scout-for-lol/data";
import { prisma, type Db } from "#src/database/index.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { parseProgressionJson } from "#src/progression/json.ts";
import { lockHallRecords } from "#src/progression/hall/baseline.ts";
import { hallSettingsFromRow } from "#src/progression/hall/settings.ts";
import {
  fetchProgressionMatches,
  type ProgressionMatchRow,
} from "#src/progression/progression-lake-reads.ts";

type TrackedAccount = {
  readonly id: number;
  readonly alias: string;
  readonly puuid: string;
  readonly createdTime: Date;
  readonly serverId: string;
  readonly player: { readonly id: number; readonly alias: string };
};

const HallBreakPayloadSchema = HallRecordEvidenceSchema.extend({
  queueFamilyId: HallQueueFamilyIdSchema,
  recordId: HallRecordIdSchema,
  holders: HallRecordHolderSchema.array(),
});
export const HallBreakOutboxPayloadSchema = HallBreakPayloadSchema.array();

function holderFor(account: TrackedAccount): HallRecordHolder {
  return HallRecordHolderSchema.parse({
    playerId: account.player.id,
    playerAlias: account.player.alias,
    accountId: account.id,
    accountAlias: account.alias,
    puuid: account.puuid,
  });
}

async function evaluateCandidate(
  tx: Db,
  options: {
    readonly guildId: string;
    readonly match: ProgressionMatchRow;
    readonly account: TrackedAccount;
    readonly enabledRecords: ReadonlySet<string>;
    readonly enabledFamilies: ReadonlySet<string>;
  },
): Promise<string[]> {
  if (!isHallEligibleMatch(options.match, options.account.createdTime)) {
    return [];
  }
  const family = classifyHallQueueFamily(options.match.queue);
  if (family === null || !options.enabledFamilies.has(family)) return [];
  const holder = holderFor(options.account);
  const brokenCellIds: string[] = [];
  for (const rawRecordId of options.enabledRecords) {
    const recordId = HallRecordIdSchema.parse(rawRecordId);
    const cell = await tx.hallRecordCell.findUnique({
      where: {
        guildId_queueFamilyId_recordId: {
          guildId: options.guildId,
          queueFamilyId: family,
          recordId,
        },
      },
    });
    if (cell?.baselineStatus !== "ready") continue;
    const value = hallRecordValue(options.match, recordId);
    const evidence = HallRecordEvidenceSchema.parse({
      matchId: options.match.match_id,
      gameEndAt: options.match.game_end_at,
      value,
      holder,
    });
    const comparison = compareHallCandidate(
      cell.currentValue,
      parseProgressionJson(cell.holdersJson, HallRecordHolderSchema.array()),
      parseProgressionJson(cell.evidenceJson, HallRecordEvidenceSchema.array()),
      { queueFamilyId: family, recordId, value, holder, evidence },
    );
    if (comparison.kind === "below") continue;
    await tx.hallRecordCell.update({
      where: { id: cell.id },
      data: {
        currentValue:
          comparison.kind === "break" ? comparison.value : cell.currentValue,
        holdersJson: JSON.stringify(comparison.holders),
        evidenceJson: JSON.stringify(comparison.evidence),
      },
    });
    if (comparison.kind === "break") brokenCellIds.push(cell.id);
  }
  return brokenCellIds;
}

async function evaluateGuild(
  guildId: DiscordGuildId,
  matchId: string,
  matchesByPuuid: ReadonlyMap<string, ProgressionMatchRow>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockHallRecords(tx, guildId);
    const accounts = await tx.account.findMany({
      where: {
        serverId: guildId,
        puuid: { in: [...matchesByPuuid.keys()] },
      },
      include: { player: true },
    });
    const settingsRow = await tx.hallSettings.findUnique({
      where: { guildId },
    });
    if (settingsRow === null) return;
    const settings = hallSettingsFromRow(settingsRow);
    const brokenCellIds = new Set<string>();
    for (const account of accounts) {
      const match = matchesByPuuid.get(account.puuid);
      if (match === undefined) continue;
      const broken = await evaluateCandidate(tx, {
        guildId,
        match,
        account,
        enabledRecords: new Set(settings.enabledRecords),
        enabledFamilies: new Set(settings.enabledQueueFamilies),
      });
      for (const cellId of broken) brokenCellIds.add(cellId);
    }
    if (brokenCellIds.size === 0 || settings.channelId === null) return;
    const cells = await tx.hallRecordCell.findMany({
      where: { id: { in: [...brokenCellIds] } },
    });
    const payload = cells.map((cell) => {
      const evidence = parseProgressionJson(
        cell.evidenceJson,
        HallRecordEvidenceSchema.array(),
      );
      const primaryEvidence = evidence[0];
      if (primaryEvidence === undefined) {
        throw new Error(`Broken Hall cell ${cell.id} has no evidence`);
      }
      return HallBreakPayloadSchema.parse({
        ...primaryEvidence,
        queueFamilyId: cell.queueFamilyId,
        recordId: cell.recordId,
        holders: parseProgressionJson(
          cell.holdersJson,
          HallRecordHolderSchema.array(),
        ),
      });
    });
    await tx.hallRecordBreakOutbox.upsert({
      where: { guildId_matchId: { guildId, matchId } },
      create: {
        guildId,
        matchId,
        channelId: settings.channelId,
        payloadJson: JSON.stringify(payload),
      },
      update: {
        channelId: settings.channelId,
        payloadJson: JSON.stringify(payload),
      },
    });
  });
}

/** Evaluate one durably ingested match before account cursors advance. */
export async function evaluateHallMatch(matchData: RawMatch): Promise<void> {
  const matchId = matchData.metadata.matchId;
  const participantPuuids = matchData.metadata.participants;
  const accounts = await prisma.account.findMany({
    where: { puuid: { in: participantPuuids } },
    include: { player: true },
  });
  if (accounts.length === 0) return;
  const enabledGuildIds = new Set<DiscordGuildId>();
  for (const account of accounts) {
    const guildId = DiscordGuildIdSchema.parse(account.serverId);
    if (
      await isPolicyEnabled("hall_of_fame_enabled", {
        server: guildId,
      })
    ) {
      enabledGuildIds.add(guildId);
    }
  }
  if (enabledGuildIds.size === 0) return;
  const configuredGuildIds = new Set<DiscordGuildId>();
  for (const guildId of enabledGuildIds) {
    const settingsRow = await prisma.hallSettings.findUnique({
      where: { guildId },
    });
    if (settingsRow !== null) configuredGuildIds.add(guildId);
  }
  if (configuredGuildIds.size === 0) return;
  const earliest = accounts.reduce(
    (minimum, account) =>
      new Date(Math.min(account.createdTime.getTime(), minimum.getTime())),
    accounts[0]?.createdTime ?? new Date(),
  );
  const rows = await fetchProgressionMatches({
    puuids: participantPuuids,
    startAt: earliest,
    matchId,
  });
  const byPuuid = new Map(rows.map((row) => [row.puuid, row]));
  const guildIds = new Set<DiscordGuildId>();
  for (const account of accounts) {
    const row = byPuuid.get(account.puuid);
    if (row === undefined) continue;
    const guildId = DiscordGuildIdSchema.parse(account.serverId);
    if (configuredGuildIds.has(guildId)) guildIds.add(guildId);
  }
  for (const guildId of guildIds) {
    await evaluateGuild(guildId, matchId, byPuuid);
  }
}
