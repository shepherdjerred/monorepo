import {
  everyoneAway,
  sendNotification,
  setOutcome,
  startEligibleVacuums,
  VACUUMS,
  verifyState,
} from "./util.ts";

export async function runVacuumIfNotHome(): Promise<void> {
  if (!(await everyoneAway())) {
    console.warn("Someone is home, skipping vacuum");
    await setOutcome("skipped", "someone-home");
    return;
  }

  const started = await startEligibleVacuums();

  if (started.length === 0) {
    // Nothing to start — every unit is already cleaning/returning. This is a
    // benign gate skip: the "all-units-active" reason is allow-listed for this
    // workflow in the monitoring rules (temporal.ts) so it never pages.
    console.warn("All vacuums already active, skipping");
    await setOutcome("skipped", "all-units-active");
    return;
  }

  await sendNotification(
    "Vacuum Started",
    `The vacuums have started cleaning since no one is home (${String(started.length)} of ${String(VACUUMS.length)} floors).`,
  );

  // Verify the started units concurrently. A sequential 3× verify (~18 min of
  // sleep) would exceed the schedules' 15-minute workflowExecutionTimeout and
  // break register-schedules.test.ts (WORKFLOW_MAX_SLEEP_MS = 7m); running them
  // in parallel keeps the total sleep budget at ~one unit's worth (~6 min).
  await Promise.all(
    started.map((vacuum) =>
      verifyState(
        vacuum,
        (state) => state === "cleaning" || state === "returning",
        { delaySeconds: 3 * 60, retries: 3, retryDelaySeconds: 60 },
      ),
    ),
  );
  await setOutcome("executed", "started");
}
