import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";
import type { ObservePlexHintInput } from "#shared/plex-events/contract.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { publishCompensatedMedia } from "#automation/native-compensation/publication.ts";
import { createPlexBindingActivities } from "#automation/plex-binding/activities.ts";
import { observeMediaUpgradeCleanup } from "#automation/plex-binding/cleanup.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { watchInvocation } from "#automation/plex-events/runtime.ts";
import type { NativePlexContext } from "#migration/native-plex/producer.ts";
import { observePairedCompensationExecution } from "#migration/native-plex/compensation.ts";
import { observePairedArchiveCleanup } from "#migration/native-plex/archive.ts";

export function createPlexRuntimeFacets(
  context: MediaAutomationContext,
  hintsEnabled: () => Promise<boolean>,
) {
  return {
    plexWatch: {
      evaluateMediaRetention: (
        input: Parameters<MediaNetworkActivities["evaluateMediaRetention"]>[0],
        execution: PlexBindingExecution,
      ) =>
        watchInvocation(
          context,
          execution,
          hintsEnabled,
        ).evaluateMediaRetention(input),
      sweepMediaWork: (
        input: Parameters<MediaNetworkActivities["sweepMediaWork"]>[0],
        execution: PlexBindingExecution,
      ) =>
        watchInvocation(context, execution, hintsEnabled).sweepMediaWork(input),
      observePlexEventHint: (
        input: ObservePlexHintInput,
        execution: PlexBindingExecution,
      ) =>
        watchInvocation(context, execution, hintsEnabled).observePlexEventHint(
          input,
        ),
    },
    plexBinding: {
      ...createPlexBindingActivities(context),
      observeMediaUpgradeCleanup: (
        input: Parameters<
          MediaNetworkActivities["observeMediaUpgradeCleanup"]
        >[0],
        execution: PlexBindingExecution,
      ) => observeMediaUpgradeCleanup(context, input, execution),
      publishMediaToPlex: (
        input: Parameters<MediaNetworkActivities["publishMediaToPlex"]>[0],
        execution: PlexBindingExecution,
      ) =>
        createPublicationActivities(
          context,
          () => execution,
        ).publishMediaToPlex(input),
      publishRestoredMedia: (
        input: Parameters<MediaNetworkActivities["publishRestoredMedia"]>[0],
        execution: PlexBindingExecution,
      ) =>
        createPublicationActivities(
          context,
          () => execution,
        ).publishRestoredMedia(input),
      publishRolledBackMedia: (
        input: Parameters<MediaNetworkActivities["publishRolledBackMedia"]>[0],
        execution: PlexBindingExecution,
      ) =>
        createPublicationActivities(
          context,
          () => execution,
        ).publishRolledBackMedia(input),
      publishCompensatedMedia: (
        input: Parameters<typeof publishCompensatedMedia>[1],
        execution: PlexBindingExecution,
        compensation: NativeCompensationExecutionContext,
      ) => publishCompensatedMedia(context, input, compensation, execution),
      finalizeMediaAcquisition: (
        input: Parameters<
          MediaNetworkActivities["finalizeMediaAcquisition"]
        >[0],
        execution: PlexBindingExecution,
      ) =>
        createPublicationActivities({
          ...context,
          plexBindingExecution: () => execution,
        }).finalizeMediaAcquisition(input),
      deliverMediaNotification: (
        input: Parameters<
          MediaNetworkActivities["deliverMediaNotification"]
        >[0],
        execution: PlexBindingExecution,
      ) =>
        createNotificationActivities({
          ...context,
          plexBindingExecution: () => execution,
        }).deliverMediaNotification(input),
    },
  };
}

export function createNativePlexFacet(
  nativeContext: NativePlexContext,
  observeNative: (
    input: { planId: string; operationId: string },
    execution: PlexBindingExecution,
  ) => Promise<void>,
) {
  return {
    observeNativeRecovery: observeNative,
    observeNativeQuarantine: observeNative,
    observeNativeArchive: observeNative,
    observeNativeCompensation: observeNative,
    observeNativeCompensationExecution: (
      input: Parameters<typeof observePairedCompensationExecution>[1],
      execution: PlexBindingExecution,
    ) => observePairedCompensationExecution(nativeContext, input, execution),
    observeNativeArchiveCleanup: (
      input: Parameters<typeof observePairedArchiveCleanup>[1],
      execution: PlexBindingExecution,
    ) => observePairedArchiveCleanup(nativeContext, input, execution),
  };
}

export function createNativePlanObservers(
  observeNative: (
    input: { planId: string; operationId: string },
    execution: PlexBindingExecution,
  ) => Promise<void>,
  executionFactory: () => PlexBindingExecution,
) {
  return {
    observeNativeRecovery: (input: { planId: string; operationId: string }) =>
      observeNative(input, executionFactory()),
    observeNativeQuarantine: (input: { planId: string; operationId: string }) =>
      observeNative(input, executionFactory()),
    observeNativeArchive: (input: { planId: string; operationId: string }) =>
      observeNative(input, executionFactory()),
    observeNativeCompensation: (input: {
      planId: string;
      operationId: string;
    }) => observeNative(input, executionFactory()),
  };
}
