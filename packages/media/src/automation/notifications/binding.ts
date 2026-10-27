import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { prepareBoundMediaCohort } from "#automation/retention/binding.ts";
import { retentionDeadline } from "#automation/retention/deadline.ts";
import { isReadiness } from "./readiness.ts";
import { eventMediaIds, type Delivery } from "./message.ts";
import { readMoviePublicationNoticeV4 } from "#shared/movie-editions/notifications-v4.ts";

export async function prepareNotificationBinding(
  context: Pick<MediaAutomationContext, "db" | "plexAccess">,
  delivery: Delivery,
  execution: Pick<
    PlexBindingExecution,
    "observed" | "expiresAtMs" | "assertActive"
  >,
) {
  if (readMoviePublicationNoticeV4(delivery.event.payload) !== null) return;
  if (
    !isReadiness(delivery.event.kind) &&
    delivery.event.kind !== "retention_warning"
  )
    return;
  const initial = plexBindingFreshness({ ...execution, guards: [execution] });
  const cohort = await prepareBoundMediaCohort(
    context,
    eventMediaIds(delivery),
    initial,
  );
  const freshness = await retentionDeadline(
    context.db,
    cohort.access,
    execution,
  );
  return { cohort, freshness, observed: execution.observed };
}
