import { expect } from "vitest";
import type { historyToJSON } from "@temporalio/common/lib/proto-utils.js";

export function assertSeriesPackRollbackActivities(
  history: Parameters<typeof historyToJSON>[0],
) {
  const activities =
    history.events?.flatMap((event) => {
      const name =
        event.activityTaskScheduledEventAttributes?.activityType?.name;
      return name == null ? [] : [name];
    }) ?? [];
  for (const name of [
    "stageSeriesPackMembersV1",
    "prepareSeriesPackMembersPublicationV1",
    "publishSeriesPackMembersV1",
  ])
    expect(activities.filter((activity) => activity === name)).toHaveLength(6);
  expect(
    activities.filter((name) => name === "rollbackPublishedSeriesPackV1"),
  ).toHaveLength(1);
  expect(activities).not.toContain("rollbackMediaPromotion");
}
