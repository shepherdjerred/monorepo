import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createScoutTemporalActivityGroups } from "#src/temporal/activities.ts";
import { registeredActivities } from "#src/temporal/connected-runtime.ts";
import routedBundle from "./routed-bundle-56f22c5.activities.json" with { type: "json" };

/**
 * Every Activity a still-routed Workflow bundle can schedule must resolve on
 * this image's Activity workers, on the queue that bundle schedules it on.
 *
 * Beta routes Workflow tasks to the Worker Deployment build 56f22c5, which
 * predates the v1 deletion and the generation rename, while its Activity
 * workers run this image. The fixture is that build's own registration, read
 * from its `connected-runtime.ts` queue groups and its V2 queue-class table.
 * Replace it with the oldest still-routed build whenever routing moves.
 */
const RoutedBundleSchema = z.strictObject({
  revision: z.string(),
  activitiesByQueue: z.strictObject({
    realtime: z.array(z.string()),
    interactive: z.array(z.string()),
    background: z.array(z.string()),
    lake: z.array(z.string()),
  }),
});

const routed = RoutedBundleSchema.parse(routedBundle);
const registered = registeredActivities(createScoutTemporalActivityGroups());

describe(`Activities the routed ${routed.revision.slice(0, 7)} bundle schedules`, () => {
  test.each(["realtime", "interactive", "background", "lake"] as const)(
    "are all registered on %s",
    (queue) => {
      const onQueue = Object.keys(registered[queue]);
      expect(
        routed.activitiesByQueue[queue].filter(
          (name) => !onQueue.includes(name),
        ),
      ).toEqual([]);
    },
  );
});
