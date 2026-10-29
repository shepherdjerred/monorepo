import assert from "node:assert/strict";
import type { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { z } from "zod";

const PayloadCandidate = z.object({
  metadata: z.object({ encoding: z.unknown() }),
});
const Payload = z.object({
  metadata: z.object({ encoding: z.string() }),
  data: z.string().optional(),
});

/** SDK history proves the actual caller's budgets, not just mock Activity defaults. */
export function assertScopedMovieActivityBudgets(
  history: Parameters<typeof historyToJSON>[0],
) {
  let scheduled = 0;
  const fileMethods = new Set([
    "inspectAndStageMovieV4",
    "promoteMovieFilesV4",
    "installMovieSubtitlesV4",
  ]);
  const quotaMethods = new Set([
    "submitMovieTorrentV4",
    "findMovieSubtitlesV4",
  ]);
  for (const event of history.events ?? []) {
    const activity = event.activityTaskScheduledEventAttributes;
    if (activity === null || activity === undefined) continue;
    const name = activity.activityType?.name;
    assert.ok(
      typeof name === "string",
      "Movie history omitted its Activity identity",
    );
    assert.equal(
      Number(activity.startToCloseTimeout?.seconds?.toString()),
      120,
    );
    assert.equal(
      Number(activity.scheduleToCloseTimeout?.seconds?.toString()),
      180,
    );
    assert.equal(
      Number(activity.scheduleToStartTimeout?.seconds?.toString()),
      30,
    );
    assert.equal(
      activity.retryPolicy?.maximumAttempts,
      quotaMethods.has(name) ? 1 : 2,
    );
    assert.equal(
      activity.taskQueue?.name,
      fileMethods.has(name) ? "media-files" : "media-network",
    );
    if (fileMethods.has(name))
      assert.equal(Number(activity.heartbeatTimeout?.seconds?.toString()), 30);
    scheduled++;
  }
  assert.ok(
    scheduled > 0,
    "Movie history must contain actual scheduled Activities",
  );
}

/** Retention keeps the mature observation/Files budgets; acquisition validation stays separate. */
export function assertScopedMovieRetentionActivityBudgets(
  history: Parameters<typeof historyToJSON>[0],
  phase: "retention" | "warning" = "retention",
) {
  const seen = new Set<string>();
  for (const event of history.events ?? []) {
    const activity = event.activityTaskScheduledEventAttributes;
    if (activity == null) continue;
    seen.add(assertRetentionScheduledActivity(activity));
  }
  const required =
    phase === "retention"
      ? [
          "evaluateMovieRetentionV4",
          "quarantineMovieFilesV4",
          "purgeMovieFilesV4",
          "completeMovieRemovalV4",
          "finishMediaOperation",
        ]
      : ["deliverMediaNotification", "finishMediaOperation"];
  for (const name of required)
    assert.ok(seen.has(name), `Retention history omitted ${name}`);
}

type RetentionScheduledActivity = NonNullable<
  NonNullable<
    Parameters<typeof historyToJSON>[0]["events"]
  >[number]["activityTaskScheduledEventAttributes"]
>;

function assertRetentionScheduledActivity(
  activity: RetentionScheduledActivity,
) {
  const name = activity.activityType?.name;
  assert.ok(typeof name === "string", "Retention Activity identity missing");
  const attempt = Number(activity.startToCloseTimeout?.seconds?.toString());
  const expected = retentionActivitySpec(name, attempt);
  assert.equal(
    Number(activity.scheduleToCloseTimeout?.seconds?.toString()),
    315_360_000,
  );
  assert.equal(activity.retryPolicy?.maximumAttempts, expected.attempts);
  assert.equal(
    activity.taskQueue?.name,
    expected.files ? "media-files" : "media-network",
  );
  if (expected.files)
    assert.equal(Number(activity.heartbeatTimeout?.seconds?.toString()), 60);
  return name;
}

function retentionActivitySpec(name: string, attempt: number) {
  const files =
    name === "quarantineMovieFilesV4" || name === "purgeMovieFilesV4";
  const evaluate = name === "evaluateMovieRetentionV4";
  assert.ok(
    files ||
      evaluate ||
      name === "completeMovieRemovalV4" ||
      name === "finishMediaOperation" ||
      name === "deliverMediaNotification",
    "Unexpected retention Activity",
  );
  if (files) assert.equal(attempt, 43_200);
  else if (evaluate)
    assert.ok(
      attempt === 300 || attempt === 45,
      "Retention evaluation must retain its ordinary or refresh attempt",
    );
  else assert.equal(attempt, 300);
  return {
    files,
    attempts:
      files || attempt === 45 || name === "deliverMediaNotification" ? 1 : 3,
  };
}

/** Restoration has distinct Files identity but retains the established scoped two/three-minute SDK budgets. */
export function assertScopedMovieRestoreActivityBudgets(
  history: Parameters<typeof historyToJSON>[0],
  phase: "restore" | "notice" | "watch" = "restore",
) {
  if (phase === "notice") {
    assertScopedMovieRetentionActivityBudgets(history, "warning");
    return;
  }
  if (phase === "watch") {
    assertScopedMovieActivityBudgets(history);
    return;
  }
  const seen = new Set<string>();
  for (const event of history.events ?? []) {
    const activity = event.activityTaskScheduledEventAttributes;
    if (activity == null) continue;
    seen.add(assertRestoreScheduledActivity(activity));
  }
  for (const name of [
    "restoreMovieFilesV4",
    "publishRestoredMovieToPlexV4",
    "finalizeMovieRestorationV4",
    "finishMediaOperation",
  ])
    assert.ok(seen.has(name), `Restoration history omitted ${name}`);
}

function assertRestoreScheduledActivity(activity: RetentionScheduledActivity) {
  const name = activity.activityType?.name;
  assert.ok(typeof name === "string", "Restore Activity identity missing");
  assert.ok(
    [
      "restoreMovieFilesV4",
      "publishRestoredMovieToPlexV4",
      "finalizeMovieRestorationV4",
      "finishMediaOperation",
    ].includes(name),
    "Unexpected restore Activity",
  );
  assert.equal(Number(activity.startToCloseTimeout?.seconds?.toString()), 120);
  assert.equal(
    Number(activity.scheduleToCloseTimeout?.seconds?.toString()),
    180,
  );
  assert.equal(
    Number(activity.scheduleToStartTimeout?.seconds?.toString()),
    30,
  );
  assert.equal(activity.retryPolicy?.maximumAttempts, 2);
  assert.equal(
    activity.taskQueue?.name,
    name === "restoreMovieFilesV4" ? "media-files" : "media-network",
  );
  if (name === "restoreMovieFilesV4")
    assert.equal(Number(activity.heartbeatTimeout?.seconds?.toString()), 30);
  return name;
}

/** Inspect actual payload bytes; searching protobuf JSON alone cannot detect encoded private inputs. */
export function assertPrivateHistory(
  history: string,
  privateValues: readonly string[],
) {
  const decoded: string[] = [];
  collectPayloads(JSON.parse(history), decoded);
  assert.ok(decoded.length > 0, "History must contain actual JSON payloads");
  for (const payload of decoded)
    for (const value of privateValues)
      assert.ok(
        !payload.includes(value),
        "Workflow payload contains private input",
      );
}

function collectPayloads(value: unknown, decoded: string[]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) collectPayloads(child, decoded);
    return;
  }
  if (PayloadCandidate.safeParse(value).success) {
    const payload = Payload.parse(value);
    const encoding = Buffer.from(payload.metadata.encoding, "base64").toString(
      "utf8",
    );
    assert.ok(
      encoding === "json/plain" || encoding === "binary/null",
      "History contains an unexpected binary payload",
    );
    if (encoding === "json/plain") {
      assert.ok(
        payload.data !== undefined,
        "JSON history payload bytes are missing",
      );
      decoded.push(
        JSON.stringify(
          JSON.parse(Buffer.from(payload.data, "base64").toString("utf8")),
        ),
      );
    }
  }
  for (const child of Object.values(value)) collectPayloads(child, decoded);
}
