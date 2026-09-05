import {
  COMPETITIVE_PROGRESSION_CATALOG,
  HallRecordEntrySchema,
  HallRecordEvidenceSchema,
  HallRecordHolderSchema,
  type HallRecordEntry,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { parseProgressionJson } from "#src/progression/json.ts";
import { getHallSettings } from "#src/progression/hall/settings.ts";

export async function getHall(
  db: ExtendedPrismaClient,
  guildId: string,
): Promise<{
  readonly settings: Awaited<ReturnType<typeof getHallSettings>>;
  readonly entries: HallRecordEntry[];
  readonly catalog: typeof COMPETITIVE_PROGRESSION_CATALOG;
}> {
  const settings = await getHallSettings(db, guildId);
  const cells = await db.hallRecordCell.findMany({
    where: {
      guildId,
      queueFamilyId: { in: settings.enabledQueueFamilies },
      recordId: { in: settings.enabledRecords },
    },
    orderBy: [{ queueFamilyId: "asc" }, { recordId: "asc" }],
  });
  return {
    settings,
    catalog: COMPETITIVE_PROGRESSION_CATALOG,
    entries: cells.map((cell) =>
      HallRecordEntrySchema.parse({
        queueFamilyId: cell.queueFamilyId,
        recordId: cell.recordId,
        baselineStatus: cell.baselineStatus,
        baselineValue: cell.baselineValue,
        currentValue: cell.currentValue,
        holders: parseProgressionJson(
          cell.holdersJson,
          HallRecordHolderSchema.array(),
        ),
        evidence: parseProgressionJson(
          cell.evidenceJson,
          HallRecordEvidenceSchema.array(),
        ),
        updatedAt: cell.updatedAt.toISOString(),
        errorMessage: cell.errorMessage,
      }),
    ),
  };
}
