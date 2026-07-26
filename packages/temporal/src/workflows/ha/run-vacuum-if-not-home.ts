import { ApplicationFailure } from "@temporalio/workflow";
import {
  everyoneAway,
  sendNotification,
  setOutcome,
  startEligibleVacuums,
  VACUUMS,
  verifyStartedVacuums,
} from "./util.ts";

export async function runVacuumIfNotHome(): Promise<void> {
  if (!(await everyoneAway())) {
    console.warn("Someone is home, skipping vacuum");
    await setOutcome("skipped", "someone-home");
    return;
  }

  const { active, started } = await startEligibleVacuums();

  if (started.length === 0) {
    if (active.length !== VACUUMS.length) {
      throw ApplicationFailure.nonRetryable(
        `Vacuum fleet classification is incomplete: ${String(active.length)} of ${String(VACUUMS.length)} units are active`,
        "VacuumFleetClassificationError",
      );
    }
    // startEligibleVacuums fails on anomalous states, so reaching this branch
    // proves every unit is already cleaning/returning. This benign reason is
    // allow-listed for this workflow in the monitoring rules (temporal.ts).
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
  await verifyStartedVacuums(started, {
    delaySeconds: 3 * 60,
    retries: 3,
    retryDelaySeconds: 60,
  });
  await setOutcome("executed", "started");
}
