/**
 * Retained drainage stub on `TASK_QUEUES.INFRA` so pre-retirement histories or
 * in-flight retries settle without Kubernetes RBAC or a live `bugsink` pod.
 */
export const bugsinkHousekeepingActivities = {
  runBugsinkHousekeeping(): Promise<string> {
    return Promise.resolve(
      "retired: Bugsink replaced by @shepherdjerred/errors",
    );
  },
};

export type BugsinkHousekeepingActivities =
  typeof bugsinkHousekeepingActivities;
