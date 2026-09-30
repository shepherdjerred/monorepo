import { expect, test } from "vitest";
import { historyFromJSON } from "@temporalio/common/lib/proto-utils.js";
import { Worker } from "@temporalio/worker";
import { DeterminismViolationError } from "@temporalio/workflow";
import { z } from "zod";
import { SCOUT_V2_PREMATCH_OWNERSHIP_PATCH } from "./prematch-ownership-v2.ts";
import recordedPoll from "./fixtures/prod-prematch-poll.pre-ownership.json" with { type: "json" };

/**
 * A real production prematch poll, recorded before the ownership router,
 * replayed against this bundle.
 *
 * The fixture is a `scoutRealtimePollWorkflow` history fetched read-only from
 * the `prod` namespace (`temporal workflow show -o json`). It is the whole
 * pre-router generation: the UI interceptor's patch, one `pollRealtime`, and
 * the completion. Replaying it proves `patched` answers `false` for that
 * generation and the prematch arm goes straight to `pollRealtime`, exactly as
 * it did then; an unconditional router would schedule the ownership read
 * where the history recorded `pollRealtime` and fail here.
 */

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;

const FixtureSchema = z.object({
  events: z.array(
    z
      .object({
        activityTaskScheduledEventAttributes: z
          .object({ activityType: z.object({ name: z.string() }) })
          .optional(),
      })
      .loose(),
  ),
});

/** A fresh copy each time, so no test can see another's edits. */
function loadFixture(): unknown {
  const copy: unknown = structuredClone(recordedPoll);
  return copy;
}

test("a prematch poll recorded before the ownership router replays unchanged", async () => {
  const raw = loadFixture();
  const fixture = FixtureSchema.parse(raw);
  // The fixture is only a pre-router history if it scheduled exactly one
  // `pollRealtime` and never named the router's patch.
  expect(
    fixture.events.flatMap((event) =>
      event.activityTaskScheduledEventAttributes === undefined
        ? []
        : [event.activityTaskScheduledEventAttributes.activityType.name],
    ),
  ).toEqual(["pollRealtime"]);
  expect(JSON.stringify(raw)).not.toContain(SCOUT_V2_PREMATCH_OWNERSHIP_PATCH);

  await Worker.runReplayHistory({ workflowsPath }, historyFromJSON(raw));
}, 120_000);

test("the same history fails replay once its recorded command is changed", async () => {
  // The negative control: without it, a replay harness that silently accepted
  // anything would pass the test above for the wrong reason.
  const raw = loadFixture();
  const tampered: unknown = JSON.parse(
    JSON.stringify(raw).replace(
      '"activityType":{"name":"pollRealtime"}',
      '"activityType":{"name":"tamperedActivity"}',
    ),
  );
  expect(JSON.stringify(tampered)).toContain("tamperedActivity");

  await expect(
    Worker.runReplayHistory({ workflowsPath }, historyFromJSON(tampered)),
  ).rejects.toBeInstanceOf(DeterminismViolationError);
}, 120_000);

test("the router's patch id is the one recorded histories will name", () => {
  expect(SCOUT_V2_PREMATCH_OWNERSHIP_PATCH).toBe("scout-v2-prematch-ownership");
});
