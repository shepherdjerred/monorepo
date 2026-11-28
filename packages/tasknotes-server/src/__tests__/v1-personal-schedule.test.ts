import { expect, test } from "vitest";
import { RecurrenceBasis } from "../protocol/generated.ts";
import { computeNextOccurrence } from "@shepherdjerred/facet-protocol/recurrence";

test("keeps the local hour across DST and skips past scheduled occurrences", () => {
  const input = {
    rule: "FREQ=DAILY;INTERVAL=3",
    dueDatetime: "2026-03-06T17:00:00Z",
    dueTimezone: "America/Los_Angeles",
    completedAt: new Date("2026-03-10T20:00:00Z"),
  };
  expect(computeNextOccurrence(input)).toMatchObject({
    nextDate: new Date("2026-03-12T16:00:00Z"),
  });
  expect(
    computeNextOccurrence({ ...input, basis: RecurrenceBasis.Completion }),
  ).toMatchObject({ nextDate: new Date("2026-03-13T16:00:00Z") });
});
