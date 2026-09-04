import {
  COMPETITIVE_PROGRESSION_CATALOG,
  COMPETITIVE_PROGRESSION_CATALOG_VERSION,
  DEFAULT_HALL_QUEUE_FAMILIES,
  DEFAULT_HALL_RECORDS,
  HallQueueFamilyIdSchema,
  HallRecordIdSchema,
  HallSettingsSchema,
  type HallQueueFamilyId,
  type HallRecordId,
  type HallSettings,
  type DiscordGuildId,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  scoutHallBaselineWorkflowId,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";
import { parseProgressionJson } from "#src/progression/json.ts";

const QueueFamilyArraySchema = HallQueueFamilyIdSchema.array();
const RecordArraySchema = HallRecordIdSchema.array();

type HallSettingsRow = {
  readonly guildId: string;
  readonly catalogVersion: number;
  readonly channelId: string | null;
  readonly enabledQueueFamilies: string;
  readonly enabledRecords: string;
};

export type HallBaselineRequest = {
  readonly guildId: string;
  readonly revision: number;
  readonly workflowId: string;
  readonly reused: boolean;
};

export function defaultHallSettings(guildId: string): HallSettings {
  return HallSettingsSchema.parse({
    guildId,
    catalogVersion: COMPETITIVE_PROGRESSION_CATALOG_VERSION,
    channelId: null,
    enabledQueueFamilies: DEFAULT_HALL_QUEUE_FAMILIES,
    enabledRecords: DEFAULT_HALL_RECORDS,
  });
}

export function hallSettingsFromRow(row: HallSettingsRow): HallSettings {
  return HallSettingsSchema.parse({
    guildId: row.guildId,
    catalogVersion: row.catalogVersion,
    channelId: row.channelId,
    enabledQueueFamilies: parseProgressionJson(
      row.enabledQueueFamilies,
      QueueFamilyArraySchema,
    ),
    enabledRecords: parseProgressionJson(row.enabledRecords, RecordArraySchema),
  });
}

export async function getHallSettings(
  db: ExtendedPrismaClient,
  guildId: string,
): Promise<HallSettings> {
  const parsedGuildId = DiscordGuildIdSchema.parse(guildId);
  const row = await db.hallSettings.findUnique({
    where: { guildId: parsedGuildId },
  });
  return row === null ? defaultHallSettings(guildId) : hallSettingsFromRow(row);
}

function orderedQueueFamilies(
  values: readonly HallQueueFamilyId[],
): HallQueueFamilyId[] {
  const selected = new Set(values);
  return COMPETITIVE_PROGRESSION_CATALOG.hall.queueFamilies
    .filter((family) => selected.has(family.id))
    .map((family) => family.id);
}

function orderedRecords(values: readonly HallRecordId[]): HallRecordId[] {
  const selected = new Set(values);
  return COMPETITIVE_PROGRESSION_CATALOG.hall.records
    .filter((record) => selected.has(record.id))
    .map((record) => record.id);
}

function assertNoDuplicates(label: string, values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Hall settings contain duplicate ${label}`);
  }
}

function cellKey(queueFamilyId: string, recordId: string): string {
  return `${queueFamilyId}:${recordId}`;
}

function enabledCellKeys(settings: HallSettings): Set<string> {
  return new Set(
    settings.enabledQueueFamilies.flatMap((queueFamilyId) =>
      settings.enabledRecords.map((recordId) =>
        cellKey(queueFamilyId, recordId),
      ),
    ),
  );
}

async function createBaselineRun(
  tx: Db,
  options: {
    readonly guildId: DiscordGuildId;
    readonly actorDiscordId: string;
    readonly stage: ScoutStage;
    readonly cellKeys: ReadonlySet<string>;
    readonly reuseActive: boolean;
  },
): Promise<HallBaselineRequest | null> {
  if (options.cellKeys.size === 0) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-hall-baseline'), hashtext(${options.guildId}))`;
  if (options.reuseActive) {
    const active = await tx.hallBaselineRun.findFirst({
      where: { guildId: options.guildId, baselineState: "building" },
      orderBy: { revision: "desc" },
    });
    if (active !== null) {
      const activeCells = await tx.hallRecordCell.findMany({
        where: {
          guildId: options.guildId,
          baselineRevision: active.revision,
          baselineStatus: "building",
        },
        select: { queueFamilyId: true, recordId: true },
      });
      const activeCellKeys = new Set(
        activeCells.map((cell) => cellKey(cell.queueFamilyId, cell.recordId)),
      );
      if (
        activeCellKeys.size === options.cellKeys.size &&
        [...options.cellKeys].every((key) => activeCellKeys.has(key))
      ) {
        return {
          guildId: options.guildId,
          revision: active.revision,
          workflowId: active.workflowId,
          reused: true,
        };
      }
    }
  }
  const settings = await tx.hallSettings.update({
    where: { guildId: options.guildId },
    data: { baselineRevision: { increment: 1 } },
  });
  const revision = settings.baselineRevision;
  const enabled = hallSettingsFromRow(settings);
  for (const queueFamilyId of enabled.enabledQueueFamilies) {
    for (const recordId of enabled.enabledRecords) {
      if (!options.cellKeys.has(cellKey(queueFamilyId, recordId))) continue;
      await tx.hallRecordCell.upsert({
        where: {
          guildId_queueFamilyId_recordId: {
            guildId: options.guildId,
            queueFamilyId,
            recordId,
          },
        },
        create: {
          guildId: options.guildId,
          queueFamilyId,
          recordId,
          baselineRevision: revision,
          baselineStatus: "building",
          baselineStartedAt: new Date(),
        },
        update: {
          baselineRevision: revision,
          baselineStatus: "building",
          baselineStartedAt: new Date(),
          baselineCompletedAt: null,
          errorMessage: null,
        },
      });
    }
  }
  const workflowId = scoutHallBaselineWorkflowId(
    options.stage,
    options.guildId,
    revision,
  );
  await tx.hallBaselineRun.create({
    data: {
      guildId: options.guildId,
      revision,
      baselineState: "building",
      requestedByDiscordId: options.actorDiscordId,
      workflowId,
    },
  });
  return {
    guildId: options.guildId,
    revision,
    workflowId,
    reused: false,
  };
}

export async function updateHallSettings(
  db: ExtendedPrismaClient,
  options: {
    readonly settings: HallSettings;
    readonly actorDiscordId: string;
    readonly stage: ScoutStage;
  },
): Promise<{
  readonly settings: HallSettings;
  readonly baseline: HallBaselineRequest | null;
}> {
  const parsed = HallSettingsSchema.parse(options.settings);
  assertNoDuplicates("queue families", parsed.enabledQueueFamilies);
  assertNoDuplicates("records", parsed.enabledRecords);
  const normalized = HallSettingsSchema.parse({
    ...parsed,
    enabledQueueFamilies: orderedQueueFamilies(parsed.enabledQueueFamilies),
    enabledRecords: orderedRecords(parsed.enabledRecords),
  });
  return await db.$transaction(async (tx) => {
    const previousRow = await tx.hallSettings.findUnique({
      where: { guildId: normalized.guildId },
    });
    const previous =
      previousRow === null ? null : hallSettingsFromRow(previousRow);
    await tx.hallSettings.upsert({
      where: { guildId: normalized.guildId },
      create: {
        guildId: normalized.guildId,
        catalogVersion: normalized.catalogVersion,
        channelId: normalized.channelId,
        enabledQueueFamilies: JSON.stringify(normalized.enabledQueueFamilies),
        enabledRecords: JSON.stringify(normalized.enabledRecords),
        updatedByDiscordId: options.actorDiscordId,
      },
      update: {
        catalogVersion: normalized.catalogVersion,
        channelId: normalized.channelId,
        enabledQueueFamilies: JSON.stringify(normalized.enabledQueueFamilies),
        enabledRecords: JSON.stringify(normalized.enabledRecords),
        updatedByDiscordId: options.actorDiscordId,
      },
    });
    const currentKeys = enabledCellKeys(normalized);
    const previousKeys =
      previous === null ? new Set<string>() : enabledCellKeys(previous);
    const newlyEnabled = new Set(
      [...currentKeys].filter((key) => !previousKeys.has(key)),
    );
    const baseline = await createBaselineRun(tx, {
      guildId: normalized.guildId,
      actorDiscordId: options.actorDiscordId,
      stage: options.stage,
      cellKeys: newlyEnabled,
      reuseActive: false,
    });
    return { settings: normalized, baseline };
  });
}

export async function requestFullHallBaseline(
  db: ExtendedPrismaClient,
  options: {
    readonly guildId: string;
    readonly actorDiscordId: string;
    readonly stage: ScoutStage;
    readonly reuseActive?: boolean;
  },
): Promise<HallBaselineRequest> {
  const guildId = DiscordGuildIdSchema.parse(options.guildId);
  const request = await db.$transaction(async (tx) => {
    const existing = await tx.hallSettings.findUnique({
      where: { guildId },
    });
    if (existing === null) {
      const defaults = defaultHallSettings(guildId);
      await tx.hallSettings.create({
        data: {
          guildId,
          catalogVersion: defaults.catalogVersion,
          channelId: defaults.channelId,
          enabledQueueFamilies: JSON.stringify(defaults.enabledQueueFamilies),
          enabledRecords: JSON.stringify(defaults.enabledRecords),
          updatedByDiscordId: options.actorDiscordId,
        },
      });
    }
    const settings = await tx.hallSettings.findUniqueOrThrow({
      where: { guildId },
    });
    const parsed = hallSettingsFromRow(settings);
    return await createBaselineRun(tx, {
      guildId,
      actorDiscordId: options.actorDiscordId,
      stage: options.stage,
      cellKeys: enabledCellKeys(parsed),
      reuseActive: options.reuseActive ?? true,
    });
  });
  if (request === null) {
    throw new Error("Hall baseline requires at least one enabled cell");
  }
  return request;
}

export async function requestConfiguredFullHallBaseline(
  tx: Db,
  options: {
    readonly guildId: string;
    readonly actorDiscordId: string;
    readonly stage: ScoutStage;
    readonly reuseActive?: boolean;
  },
): Promise<HallBaselineRequest | null> {
  const guildId = DiscordGuildIdSchema.parse(options.guildId);
  const row = await tx.hallSettings.findUnique({ where: { guildId } });
  if (row === null) return null;
  return await createBaselineRun(tx, {
    guildId,
    actorDiscordId: options.actorDiscordId,
    stage: options.stage,
    cellKeys: enabledCellKeys(hallSettingsFromRow(row)),
    reuseActive: options.reuseActive ?? true,
  });
}
