import { z } from "zod";
import {
  HallQueueFamilyIdSchema,
  HallRecordEvidenceSchema,
  HallRecordHolderSchema,
  HallRecordIdSchema,
} from "@scout-for-lol/data";
import { RETIRED_HALL_RECORD_IDS } from "#src/progression/hall/legacy-record-ids.ts";

/**
 * One broken Hall of Fame record, as a record-break announcement carries it.
 *
 * The `hall-record-break` intent carries an array of these inside its
 * announcement envelope. Kept in its own module, beside neither the evaluator
 * that writes it nor the reader, so the evaluator can import the codec without
 * the codec importing the evaluator back.
 */
export const LegacyHallBreakPayloadSchema = HallRecordEvidenceSchema.extend({
  queueFamilyId: HallQueueFamilyIdSchema,
  recordId: HallRecordIdSchema,
  holders: HallRecordHolderSchema.array(),
});

export type LegacyHallBreakPayload = z.infer<
  typeof LegacyHallBreakPayloadSchema
>;

export const HallBreakScoreSchema = z.strictObject({
  value: z.number(),
  holders: HallRecordHolderSchema.array().min(1),
});

export type HallBreakScore = z.infer<typeof HallBreakScoreSchema>;

export const HallBreakPayloadSchema = LegacyHallBreakPayloadSchema.extend({
  previous: HallBreakScoreSchema,
  standings: HallBreakScoreSchema.array().min(1).max(3),
}).refine(
  ({ value, holders, previous, standings }) => {
    const [leader] = standings;
    return (
      leader?.value === value &&
      Bun.deepEquals(leader.holders, holders) &&
      previous.value < value &&
      standings.every((score, index) => {
        const higher = standings[index - 1];
        return higher === undefined || higher.value > score.value;
      })
    );
  },
  {
    message:
      "Hall standings must descend from the new record above the previous record",
  },
);

export type HallBreakPayload = z.infer<typeof HallBreakPayloadSchema>;

const RecordIdFieldSchema = z.object({ recordId: z.unknown() }).partial();

/**
 * Drop every stored entry naming a record id retired by a catalog rename (see
 * {@link RETIRED_HALL_RECORD_IDS}) before the entries are validated.
 *
 * An announcement minted before such a rename would otherwise be rejected by the
 * narrowed record-id enum forever. Only the known renames are dropped; any
 * other unrecognized id still reaches the schema and fails loudly.
 */
export function dropRetiredHallRecordIds(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.filter((entry) => {
    const parsed = RecordIdFieldSchema.safeParse(entry);
    if (!parsed.success) return true;
    const recordId = parsed.data.recordId;
    return (
      typeof recordId !== "string" || !RETIRED_HALL_RECORD_IDS.has(recordId)
    );
  });
}

/**
 * The broken records of one announcement, with retired record ids dropped.
 * An empty result means every record the announcement named has since been
 * retired, and there is nothing left worth telling anyone.
 */
export const HallBreakRecordsSchema = z.preprocess(
  dropRetiredHallRecordIds,
  HallBreakPayloadSchema.array().max(25),
);

export const LegacyHallBreakRecordsSchema = z.preprocess(
  dropRetiredHallRecordIds,
  LegacyHallBreakPayloadSchema.array(),
);
