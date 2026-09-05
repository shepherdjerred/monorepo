import { z } from "zod";
import catalogJson from "#competitive-progression-catalog" with { type: "json" };
import { QueueTypeSchema } from "#src/model/core/state.ts";

export const HallQueueFamilyIdSchema = z.enum([
  "ranked_sr",
  "unranked_sr",
  "aram",
  "sr_clash",
  "aram_clash",
  "urf",
  "arena",
  "brawl",
  "classic_sr",
  "aram_mayhem",
  "classic_aram_mayhem",
  "doom_bots_easy",
  "doom_bots_normal",
  "doom_bots_hard",
]);
export type HallQueueFamilyId = z.infer<typeof HallQueueFamilyIdSchema>;

export const HallRecordIdSchema = z.enum([
  "kills",
  "assists",
  "largest_multikill",
  "champion_damage",
  "champion_damage_per_minute",
  "damage_taken",
  "damage_mitigated",
  "cs",
  "cs_per_minute",
  "gold_earned",
  "teammate_healing",
  "vision_score",
  "wards_cleared",
  "objective_damage",
  "turret_damage",
  "crowd_control_time",
  "longest_life",
  "total_time_dead",
]);
export type HallRecordId = z.infer<typeof HallRecordIdSchema>;

export const HallQueueFamilyDefinitionSchema = z.strictObject({
  id: HallQueueFamilyIdSchema,
  label: z.string().min(1),
  defaultEnabled: z.boolean(),
  queues: z.array(QueueTypeSchema).min(1),
});

export const HallRecordDefinitionSchema = z.strictObject({
  id: HallRecordIdSchema,
  label: z.string().min(1),
  unit: z.string().min(1),
  precision: z.number().int().min(0).max(6),
});

export const CompetitiveProgressionCatalogSchema = z.strictObject({
  version: z.literal(1),
  hall: z.strictObject({
    queueFamilies: z.array(HallQueueFamilyDefinitionSchema).min(1),
    records: z.array(HallRecordDefinitionSchema).min(1),
  }),
});

function assertUniqueCatalogValues(
  label: string,
  values: readonly string[],
): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Competitive progression catalog has duplicate ${label}`);
  }
}

const parsedCatalog = CompetitiveProgressionCatalogSchema.parse(catalogJson);
assertUniqueCatalogValues(
  "Hall queue-family ids",
  parsedCatalog.hall.queueFamilies.map((family) => family.id),
);
assertUniqueCatalogValues(
  "Hall record ids",
  parsedCatalog.hall.records.map((record) => record.id),
);
assertUniqueCatalogValues(
  "Hall queue assignments",
  parsedCatalog.hall.queueFamilies.flatMap((family) => family.queues),
);

export const COMPETITIVE_PROGRESSION_CATALOG = parsedCatalog;
export const COMPETITIVE_PROGRESSION_CATALOG_VERSION = parsedCatalog.version;

export const DEFAULT_HALL_QUEUE_FAMILIES = parsedCatalog.hall.queueFamilies
  .filter((family) => family.defaultEnabled)
  .map((family) => family.id);

export const DEFAULT_HALL_RECORDS = parsedCatalog.hall.records.map(
  (record) => record.id,
);

export function hallRecordDefinition(recordId: HallRecordId) {
  const definition = parsedCatalog.hall.records.find(
    (record) => record.id === recordId,
  );
  if (definition === undefined) {
    throw new Error(`Hall record catalog is missing ${recordId}`);
  }
  return definition;
}
