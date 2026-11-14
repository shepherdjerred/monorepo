import type { QualityGuideActivities } from "@shepherdjerred/media/quality-guide";
import type { createMediaNetworkRuntime } from "@shepherdjerred/media/automation/network";
import { Context } from "@temporalio/activity";
import { mediaCall } from "#activities/media/call.ts";

export function createQualityGuideWorkerActivities(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaNetworkRuntime>>, "qualityGuide">
  >,
): QualityGuideActivities {
  return {
    refreshMediaQualityGuides: () =>
      mediaCall(async () => {
        const runtime = await load();
        return runtime.qualityGuide.refreshMediaQualityGuides(
          Context.current().cancellationSignal,
        );
      }),
  };
}
