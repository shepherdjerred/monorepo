import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { PlexBindingActivities } from "#shared/plex-binding/activities.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createSeedingActivities } from "#automation/seeding.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { matchProviderFeedSourceV1 } from "#automation/feeds/matching.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";
import { expandCatalogCoverage } from "#automation/reconciliation/library-series.ts";
import { createCatalogActivities } from "#automation/reconciliation/catalog.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { cleanupSubtitleBrowser } from "#automation/subtitle-browser-lifecycle.ts";
import { IntegrationError } from "#integrations/http.ts";

type LifecycleActivities = Pick<
  MediaNetworkActivities,
  "evaluateMediaRetention" | "deliverMediaNotification" | "findMediaSubtitles"
>;

/** The same registration table serves the actual Network runtime and local system sandbox. */
export function createMediaNetworkActivities(
  context: MediaAutomationContext,
  lifecycle: LifecycleActivities,
): Omit<
  MediaNetworkActivities,
  keyof PlexBindingActivities | "observeMediaUpgradeCleanup"
> {
  const outbox = createOutboxActivities(context.db, context.startWorkflow);
  return {
    ...createAcquisitionActivities(context),
    ...createPublicationActivities(context),
    ...createSeedingActivities(context),
    ...createSweepActivities(context),
    matchProviderFeedSource: (input) =>
      matchProviderFeedSourceV1(context, input),
    ...createCoverageActivities(context),
    expandCatalogRequests: (input) => expandCatalogCoverage(context, input),
    ...createCatalogActivities(context),
    ...outbox,
    async finishMediaOperation(input) {
      try {
        await cleanupSubtitleBrowser(
          context,
          input.operationId,
          input.reason ?? input.status,
        );
      } catch (error) {
        if (
          !(error instanceof IntegrationError) ||
          error.kind !== "outcome-unknown"
        )
          throw error;
        await outbox.finishMediaOperation({
          ...input,
          status: "reconciling",
          reason: "subtitle_browser_cleanup_requires_review",
        });
        return;
      }
      await outbox.finishMediaOperation(input);
    },
    ...lifecycle,
  };
}
