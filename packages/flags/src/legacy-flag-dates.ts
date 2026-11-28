import legacyFlagDatesJson from "./legacy-flag-dates.json" with { type: "json" };
import { z } from "zod";

const LegacyFlagDatesSchema = z.strictObject({
  $comment: z.string().min(1),
  computedAt: z.iso.datetime(),
  dates: z.record(
    z.string().min(1),
    z.strictObject({ date: z.iso.datetime(), onOrBefore: z.boolean() }),
  ),
});

export type LegacyFlagDate = {
  readonly date: Date;
  readonly onOrBefore: boolean;
};

/**
 * Frozen first-declared dates for keys that existed before the audit trail.
 * Generated once by `scripts/generate-legacy-flag-dates.ts`; never in CI.
 */
const legacyDates: ReadonlyMap<string, LegacyFlagDate> = new Map(
  Object.entries(LegacyFlagDatesSchema.parse(legacyFlagDatesJson).dates).map(
    ([key, value]) => [
      key,
      { date: new Date(value.date), onOrBefore: value.onOrBefore },
    ],
  ),
);

export function legacyFlagDate(key: string): LegacyFlagDate | undefined {
  return legacyDates.get(key);
}
