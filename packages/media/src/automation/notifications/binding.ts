import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { prepareBoundMediaCohort } from "#automation/retention/binding.ts";
import { retentionDeadline } from "#automation/retention/deadline.ts";
import { isReadiness } from "./readiness.ts";
import { eventMediaIds, type Delivery } from "./message.ts";
import { readMovieNoticeV4 } from "#shared/movie-editions/notifications-v4.ts";
import { readMovieRetentionWarningV4 } from "#shared/movie-editions/retention-v4.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { MediaError } from "#application/errors.ts";
import { readMovieRemovalNoticeV4 } from "#shared/movie-editions/removal-v4.ts";
import { readMovieInterventionNoticeV4 } from "#shared/movie-editions/intervention/v4.ts";

export async function prepareNotificationBinding(
  context: Pick<MediaAutomationContext, "db" | "plexAccess">,
  delivery: Delivery,
  execution: Pick<
    PlexBindingExecution,
    "observed" | "expiresAtMs" | "assertActive"
  >,
  invocationBudget?: PublicationAuthorityReadBudget,
) {
  if (readMovieInterventionNoticeV4(delivery.event.payload) !== null) return;
  if (readMovieNoticeV4(delivery.event.payload) !== null) return;
  if (readMovieRemovalNoticeV4(delivery.event.payload) !== null) return;
  if (
    !isReadiness(delivery.event.kind) &&
    delivery.event.kind !== "retention_warning"
  )
    return;
  const initial = plexBindingFreshness({ ...execution, guards: [execution] });
  const warning = readMovieRetentionWarningV4(delivery.event.payload);
  if (
    warning !== null &&
    (delivery.event.kind !== "retention_warning" ||
      delivery.event.mediaId !== warning.scope.mediaId ||
      delivery.recoveryEpoch !== warning.recoveryEpoch)
  )
    throw new Error("Movie retention warning lost its event scope");
  const budget =
    warning === null
      ? undefined
      : (invocationBudget ?? new PublicationAuthorityReadBudget());
  const cohort = await prepareBoundMediaCohort(
    context,
    eventMediaIds(delivery),
    { ...initial, ...(budget === undefined ? {} : { budget }) },
    warning?.scope,
  );
  const freshness = await retentionDeadline(
    context.db,
    cohort.access,
    execution,
  );
  return {
    cohort,
    freshness,
    observed: execution.observed,
    ...(budget === undefined ? {} : { budget }),
  };
}

/** Scoped warnings retain their captured access across claim and final send. */
export async function assertNotificationBindingConfiguration(
  context: Pick<
    MediaAutomationContext,
    "db" | "plexAccess" | "serverMachineId" | "permittedSections"
  >,
  binding: Awaited<ReturnType<typeof prepareNotificationBinding>>,
) {
  const scope = binding?.cohort.movieScope;
  if (scope === undefined || binding === undefined) return;
  binding.freshness.assertActive();
  const choices = await networkMovieAccess(context, [scope.mediaId]).catch(
    (error: unknown) => {
      binding.freshness.assertActive();
      if (
        error instanceof MediaError &&
        error.code === "plex_scope_unconfigured"
      )
        throw new PlexBindingProtection("wrong_section");
      throw error;
    },
  );
  const access = await context.plexAccess("movie");
  binding.freshness.assertActive();
  if (
    choices === undefined ||
    identityHash([access]) !== identityHash(binding.cohort.access) ||
    choices.serverMachineId !== access.serverMachineId ||
    choices.movieSectionId !== access.sectionId
  )
    throw new PlexBindingProtection("wrong_section");
}
