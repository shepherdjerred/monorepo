import type { SubtitleMaintenanceActivitiesV1 } from "@shepherdjerred/media/subtitle-maintenance";
import type { createMediaNetworkRuntime } from "@shepherdjerred/media/automation/network";
import { plexBindingCall } from "#activities/media/plex-binding-execution.ts";

export function createSubtitleMaintenanceWorkerActivitiesV1(
  load: () => Promise<
    Pick<
      Awaited<ReturnType<typeof createMediaNetworkRuntime>>,
      "subtitleMaintenance"
    >
  >,
): SubtitleMaintenanceActivitiesV1 {
  return {
    listSubtitleMaintenanceV1: (input) =>
      plexBindingCall(async () => {
        const runtime = await load();
        return runtime.subtitleMaintenance.listSubtitleMaintenanceV1(input);
      }),
    prepareSubtitleMaintenanceV1: (input) =>
      plexBindingCall(async () => {
        const runtime = await load();
        return runtime.subtitleMaintenance.prepareSubtitleMaintenanceV1(input);
      }),
    beginAutomaticSubtitleReplacementV1: (input) =>
      plexBindingCall(async () => {
        const runtime = await load();
        return runtime.subtitleMaintenance.beginAutomaticSubtitleReplacementV1(
          input,
        );
      }),
    approveAutomaticSubtitleReplacementV1: (input) =>
      plexBindingCall(async () => {
        const runtime = await load();
        return runtime.subtitleMaintenance.approveAutomaticSubtitleReplacementV1(
          input,
        );
      }),
  };
}
