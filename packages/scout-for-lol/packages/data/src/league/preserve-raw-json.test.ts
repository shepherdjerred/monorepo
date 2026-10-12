import { expect, test } from "vitest";
import { z } from "zod";
import { preserveRawJson } from "./preserve-raw-json.ts";
import { RawMatchSchema } from "./raw-match.schema.ts";
import { RawTimelineSchema } from "./raw-timeline.schema.ts";

test("validates known fields while retaining nested future fields, missing values and nulls", () => {
  const schema = preserveRawJson(
    z.strictObject({
      nested: z.strictObject({ id: z.number(), value: z.number().optional() }),
      rows: z.array(z.object({ name: z.string() })),
    }),
  );
  const raw = {
    nested: { id: 1, future: { values: [null, 3, 1] } },
    rows: [{ name: "one", extra: null }],
    unknown: true,
  };
  expect(schema.parse(raw)).toEqual(raw);
  expect(schema.safeParse({ ...raw, nested: { id: "broken" } }).success).toBe(
    false,
  );
  expect(raw).toHaveProperty("nested.future.values", [null, 3, 1]);
});

test("keeps every captured match field, including future nested participant data", async () => {
  const raw = await Bun.file(
    `${import.meta.dir}/../../../../testdata/rift.json`,
  ).json();
  raw.info.participants[0].futureRiotField = { nested: [null, { flag: true }] };
  raw.metadata.futureMetadata = "retained";
  expect(RawMatchSchema.parse(raw)).toEqual(raw);
});

test("timeline preserves future events, nested damage, frame stats, empty arrays and null first frames", () => {
  const raw = {
    metadata: {
      dataVersion: "2",
      matchId: "NA1_123",
      participants: ["account"],
      future: null,
    },
    info: {
      frameInterval: 60_000,
      gameId: 123,
      participants: [{ participantId: 1, puuid: "account" }],
      frames: [
        { timestamp: 0, participantFrames: null, events: [] },
        {
          timestamp: 60_000,
          participantFrames: {},
          events: [
            {
              timestamp: 12,
              type: "FUTURE_EVENT",
              damage: [{ magic: 10, future: null }],
            },
          ],
          futureStats: { precision: 0.125 },
        },
      ],
    },
  };
  expect(RawTimelineSchema.parse(raw)).toEqual(raw);
});
