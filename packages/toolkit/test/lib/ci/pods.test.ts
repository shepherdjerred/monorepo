import { expect, test } from "vitest";
import { CiPodListSchema, summarizeCiPods } from "#lib/ci/pods.ts";

test("pod attribution uses the workflow task and pod UID, not just the commit", () => {
  const list = CiPodListSchema.parse({
    items: [1, 2].map((id) => ({
      metadata: {
        name: `wp-${String(id)}`,
        uid: `uid-${String(id)}`,
        creationTimestamp: "2026-10-08T00:00:00Z",
        labels: {
          "woodpecker-ci.org/task-uuid": String(id),
          "ci.sjer.red/commit": "same-sha",
        },
      },
      spec: { schedulingGates: [{ name: "kueue.x-k8s.io/admission" }] },
    })),
  });
  const pods = summarizeCiPods(list, Date.parse("2026-10-08T00:01:00Z"));
  expect(pods.map((pod) => pod.taskId)).toEqual(["1", "2"]);
  expect(pods.map((pod) => pod.podUid)).toEqual(["uid-1", "uid-2"]);
  expect(pods[0]?.waitingReason).toBe("admission");
  expect(pods[0]?.startupSeconds).toBeNull();
  expect(pods[0]?.ageSeconds).toBe(60);
});

test("startup records container start and ignores unrelated maintenance pods", () => {
  const metadata = {
    name: "wp-1",
    uid: "uid-1",
    creationTimestamp: "2026-10-08T00:00:00Z",
  };
  const list = CiPodListSchema.parse({
    items: [
      { metadata, spec: {} },
      {
        metadata: {
          ...metadata,
          labels: { "woodpecker-ci.org/task-uuid": "10" },
        },
        spec: {},
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "wp-1",
              restartCount: 0,
              state: { running: { startedAt: "2026-10-08T00:00:30Z" } },
            },
          ],
        },
      },
    ],
  });
  const pods = summarizeCiPods(list, Date.parse("2026-10-08T00:01:00Z"));
  expect(pods).toHaveLength(1);
  expect(pods[0]?.startupSeconds).toBe(30);
  expect(pods[0]?.waitingReason).toBeNull();
});
