/** Read-only inventory of source-defined, report-registered, and live schedules. */
import { Client, Connection } from "@temporalio/client";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";
import { SCHEDULES } from "#schedules/schedule-definitions.ts";
import { DYNAMIC_AGENT_TASK_MEMO_KEY } from "#shared/agent-task-identifiers.ts";
import { REPORT_SCHEDULE_REGISTRY } from "#shared/report-registry.ts";

const DEFAULT_TEMPORAL_ADDRESS =
  "temporal-server.temporal.svc.cluster.local:7233";

type LiveScheduleInventory = {
  scheduleId: string;
  paused: boolean;
  dynamicAgentTask: boolean;
  sourceDefined: boolean;
  reportRegistered: boolean;
  memo: Record<string, unknown> | undefined;
};

async function main(): Promise<void> {
  const connection = await Connection.connect(
    temporalConnectionOptions({
      environment: Bun.env,
      defaultAddress: DEFAULT_TEMPORAL_ADDRESS,
    }),
  );
  const client = new Client({ connection });
  const sourceById = new Map(
    SCHEDULES.map((schedule) => [schedule.id, schedule]),
  );
  const reportIds = new Set(
    REPORT_SCHEDULE_REGISTRY.map((registration) => registration.scheduleId),
  );
  const live: LiveScheduleInventory[] = [];

  for await (const schedule of client.schedule.list()) {
    live.push({
      scheduleId: schedule.scheduleId,
      paused: schedule.state.paused,
      dynamicAgentTask: schedule.memo?.[DYNAMIC_AGENT_TASK_MEMO_KEY] === true,
      sourceDefined: sourceById.has(schedule.scheduleId),
      reportRegistered: reportIds.has(schedule.scheduleId),
      memo: schedule.memo,
    });
  }

  live.sort((left, right) => left.scheduleId.localeCompare(right.scheduleId));
  const liveIds = new Set(live.map((schedule) => schedule.scheduleId));
  const sourceOnly = SCHEDULES.filter(
    (schedule) => !liveIds.has(schedule.id),
  ).map((schedule) => ({
    scheduleId: schedule.id,
    workflowType: schedule.workflowType,
    reportRegistered: reportIds.has(schedule.id),
  }));
  const liveOnly = live.filter((schedule) => !schedule.sourceDefined);

  console.warn(
    JSON.stringify(
      { observedAt: new Date().toISOString(), live, liveOnly, sourceOnly },
      undefined,
      2,
    ),
  );
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
})();
