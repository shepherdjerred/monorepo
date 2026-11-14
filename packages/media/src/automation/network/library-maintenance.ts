import type { MediaAutomationContext } from "#automation/context.ts";
import type { mediaBehaviorConfig } from "#infrastructure/config.ts";
import { TrashGuideClient } from "#integrations/trash-guide/client.ts";
import { qualityGuideActivities } from "#automation/quality-guide/activities.ts";
import { subtitleMaintenanceActivitiesV1 } from "#automation/subtitle-maintenance/activities.ts";

export function createLibraryMaintenanceFacets(
  context: MediaAutomationContext,
  behavior: ReturnType<typeof mediaBehaviorConfig>,
) {
  return {
    qualityGuide: qualityGuideActivities(context.db, new TrashGuideClient()),
    subtitleMaintenance: subtitleMaintenanceActivitiesV1(context, async () => {
      const setting = await behavior.get("subtitleMaintenanceEnabled");
      return setting.value;
    }),
  };
}
