import assert from "node:assert/strict";
import type { historyToJSON } from "@temporalio/common/lib/proto-utils.js";

const files = new Set([
  "inspectAndStageMedia",
  "prepareSeriesPackPublication",
  "promoteMediaFiles",
  "stageSeriesPackMembersV1",
  "sealSeriesPackStagingV1",
  "prepareSeriesPackMembersPublicationV1",
  "sealSeriesPackPublicationIntentV1",
  "publishSeriesPackMembersV1",
  "sealSeriesPackPublicationOutcomeV1",
  "compensateSeriesPackMembersV1",
  "sealSeriesPackCompensationV1",
  "rollbackPublishedSeriesPackV1",
]);
const network = new Set([
  "reconcileMediaIntent",
  "publishRolledBackMedia",
  "submitMediaTorrent",
  "observeMediaAcquisition",
  "publishMediaToPlex",
  "finalizeMediaAcquisition",
  "finishMediaOperation",
]);

/** Validate actual scheduled Activities in the new feed and mature acquisition histories separately. */
export function assertSeriesPackRoleBudgets(
  history: Parameters<typeof historyToJSON>[0],
  feed: boolean,
) {
  let scheduled = 0;
  for (const event of history.events ?? []) {
    const activity = event.activityTaskScheduledEventAttributes;
    if (activity == null) continue;
    const name = activity.activityType?.name;
    assert.ok(
      typeof name === "string",
      "Actual pack history omitted its Activity identity",
    );
    if (feed) assertFeedActivity(activity, name);
    else assertAcquisitionActivity(activity, name);
    scheduled++;
  }
  assert.ok(scheduled > 0, "Actual pack history has no Activities");
}

type ScheduledActivity = NonNullable<
  NonNullable<
    Parameters<typeof historyToJSON>[0]["events"]
  >[number]["activityTaskScheduledEventAttributes"]
>;

function assertFeedActivity(activity: ScheduledActivity, name: string) {
  assert.ok(
    name === "matchSeriesPackFeedSource" || name === "finishMediaOperation",
    "Unknown feed Activity",
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
  assert.equal(Number(activity.heartbeatTimeout?.seconds?.toString()), 30);
  assert.equal(activity.retryPolicy?.maximumAttempts, 2);
  assert.equal(activity.taskQueue?.name, "media-network");
}

function assertAcquisitionActivity(activity: ScheduledActivity, name: string) {
  assert.ok(
    files.has(name) || network.has(name),
    "Unknown pack acquisition Activity",
  );
  assert.equal(
    Number(activity.startToCloseTimeout?.seconds?.toString()),
    files.has(name) ? 43_200 : 300,
  );
  assert.equal(
    Number(activity.scheduleToCloseTimeout?.seconds?.toString()),
    315_360_000,
  );
  assert.equal(
    activity.retryPolicy?.maximumAttempts,
    name === "submitMediaTorrent" ? 1 : 3,
  );
  assert.equal(
    activity.taskQueue?.name,
    files.has(name) ? "media-files" : "media-network",
  );
  if (files.has(name))
    assert.equal(Number(activity.heartbeatTimeout?.seconds?.toString()), 60);
}
