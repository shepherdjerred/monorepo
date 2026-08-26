import { Context } from "@temporalio/activity";
import type { ScoutTemporalActivityGroups } from "./supervisor.ts";
import { MY_SERVER } from "#src/configuration/flags.ts";
import { heartbeatWhile } from "./activity-runtime.ts";

type WeeklyParlayAction = Parameters<
  ScoutTemporalActivityGroups["background"]["invokeScoutWeeklyParlayAction"]
>[0];
type WeeklyParlayResult = Awaited<
  ReturnType<
    ScoutTemporalActivityGroups["background"]["invokeScoutWeeklyParlayAction"]
  >
>;

export async function invokeWeeklyParlayAction(
  action: WeeklyParlayAction,
): Promise<WeeklyParlayResult> {
  const result = await heartbeatWhile(
    {
      kind: "weekly-parlay",
      action: action.action,
      periodKey: action.periodKey,
      phase: "running",
    },
    async () => {
      const { runWeeklyParlayControlAction } =
        await import("#src/betting/weekly-parlay-control.ts");
      return await runWeeklyParlayControlAction(action, {
        serverId: MY_SERVER,
        signal: Context.current().cancellationSignal,
      });
    },
  );
  Context.current().heartbeat({
    kind: "weekly-parlay",
    action: action.action,
    periodKey: action.periodKey,
    phase: result.status,
  });
  return result;
}
