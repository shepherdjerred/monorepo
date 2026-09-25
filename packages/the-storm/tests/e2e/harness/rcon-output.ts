import { z } from "zod";

// Console output is an untyped boundary: every assertion on it goes through a
// schema so a changed server message fails with the exact text it received.
function line<T extends z.ZodType>(pattern: RegExp, shape: T) {
  return z
    .string()
    .transform((text, context): unknown => {
      const match = pattern.exec(text.trim());
      if (match === null) {
        context.addIssue({
          code: "custom",
          message: `expected ${pattern.toString()}, got ${JSON.stringify(text)}`,
        });
        return z.NEVER;
      }
      return match.groups ?? {};
    })
    .pipe(shape);
}

export const ListOutputSchema = line(
  /^There are (?<online>\d+) of a max of (?<max>\d+) players online: ?(?<names>.*)$/u,
  z.object({
    online: z.coerce.number().int(),
    max: z.coerce.number().int(),
    names: z
      .string()
      .transform((names) => (names === "" ? [] : names.split(", "))),
  }),
);

// 26.x replaced day-time queries with timelines: `time query day`.
export const DayTimelineOutputSchema = line(
  /^Timeline minecraft:day is at (?<ticks>\d+) tick\(s\)$/u,
  z.object({ ticks: z.coerce.number().int().nonnegative() }),
);

export const ClearCountOutputSchema = line(
  /^Found (?<count>\d+) matching item\(s\) on player (?<player>\w+)$/u,
  z.object({ count: z.coerce.number().int(), player: z.string() }),
);

export const ExecuteTestOutputSchema = z
  .enum(["Test passed", "Test failed"])
  .transform((result) => result === "Test passed");

export const EntityPosOutputSchema = line(
  /^(?<entity>\w+) has the following entity data: \[(?<x>-?[\d.]+)d, (?<y>-?[\d.]+)d, (?<z>-?[\d.]+)d\]$/u,
  z.object({
    entity: z.string(),
    x: z.coerce.number(),
    y: z.coerce.number(),
    z: z.coerce.number(),
  }),
);
