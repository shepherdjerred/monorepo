import { expect, test } from "vitest";
import { historyFromJSON } from "@temporalio/common/lib/proto-utils.js";
import { Worker } from "@temporalio/worker";
import { DeterminismViolationError } from "@temporalio/workflow";
import { z } from "zod";
import { SCOUT_PREMATCH_DELIVERY_PATCH } from "#src/workflows/prematch.ts";
import recordedGame from "./fixtures/dev-prematch-game.pre-delivery.json" with { type: "json" };

/**
 * A per-game prematch history recorded before the delivery patch, replayed
 * against this bundle.
 *
 * The fixture was recorded by running the pre-patch Workflow source in the
 * time-skipping test environment against the prematch Activity stubs, and
 * fetching its history, so it carries that generation's Workflow and Activity
 * type names. It is the whole pre-patch generation: the capture, the fan-out
 * plan, and the completion, with no markets Activity and no child start.
 *
 * Replaying it proves `patched` answers `false` for that generation, so an
 * open execution recorded before the deploy completes exactly as its own
 * code wrote it. An unconditional markets Activity or child start would be
 * scheduled where the history recorded the completion and fail here.
 */

const workflowsPath = new URL("index.ts", import.meta.url).pathname;

const FixtureSchema = z.object({
  events: z.array(
    z
      .object({
        eventType: z.string(),
        activityTaskScheduledEventAttributes: z
          .object({ activityType: z.object({ name: z.string() }) })
          .optional(),
      })
      .loose(),
  ),
});

function loadFixture(): unknown {
  const copy: unknown = structuredClone(recordedGame);
  return copy;
}

test("a prematch game recorded before the delivery patch replays unchanged", async () => {
  const raw = loadFixture();
  const fixture = FixtureSchema.parse(raw);
  expect(
    fixture.events.flatMap((event) =>
      event.activityTaskScheduledEventAttributes === undefined
        ? []
        : [event.activityTaskScheduledEventAttributes.activityType.name],
    ),
  ).toEqual(["archivePrematchSnapshotV2", "planPrematchFanOutV2"]);
  expect(JSON.stringify(raw)).not.toContain(SCOUT_PREMATCH_DELIVERY_PATCH);
  expect(JSON.stringify(raw)).not.toContain("START_CHILD_WORKFLOW");

  await Worker.runReplayHistory({ workflowsPath }, historyFromJSON(raw));
}, 120_000);

test("the same history fails replay once its recorded command is changed", async () => {
  // The negative control: a harness that accepted anything would pass the
  // test above for the wrong reason.
  const tampered: unknown = JSON.parse(
    JSON.stringify(loadFixture()).replace(
      '"name":"planPrematchFanOutV2"',
      '"name":"tamperedActivity"',
    ),
  );
  expect(JSON.stringify(tampered)).toContain("tamperedActivity");

  await expect(
    Worker.runReplayHistory({ workflowsPath }, historyFromJSON(tampered)),
  ).rejects.toBeInstanceOf(DeterminismViolationError);
}, 120_000);
