import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type { NativeCompensationNetworkActivities } from "@shepherdjerred/media/native-compensation";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import {
  compensationCall,
  type compensationExecution,
} from "./compensation-execution.ts";
import { plexBindingCall } from "./plex-binding-execution.ts";

type Publications = Pick<
  MediaNetworkActivities,
  "publishMediaToPlex" | "publishRestoredMedia" | "publishRolledBackMedia"
>;
type Runtime = {
  plexBinding: {
    [K in keyof Publications]: (
      input: Parameters<Publications[K]>[0],
      execution: PlexBindingExecution,
    ) => ReturnType<Publications[K]>;
  };
};

/** The original proof window starts before the first lazy/configuration await. */
export function createPlexPublicationActivities(
  load: () => Promise<Runtime>,
): Publications {
  return {
    publishMediaToPlex: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.plexBinding.publishMediaToPlex(input, execution);
      }),
    publishRestoredMedia: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.plexBinding.publishRestoredMedia(input, execution);
      }),
    publishRolledBackMedia: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.plexBinding.publishRolledBackMedia(input, execution);
      }),
  };
}

type Compensated =
  NativeCompensationNetworkActivities["publishCompensatedMedia"];
type CompensatedRuntime = {
  plexBinding: {
    publishCompensatedMedia: (
      input: Parameters<Compensated>[0],
      execution: PlexBindingExecution,
      compensation: ReturnType<typeof compensationExecution>,
    ) => ReturnType<Compensated>;
  };
};

export function createPlexCompensatedPublication(
  load: () => Promise<CompensatedRuntime>,
): Compensated {
  return (input) =>
    plexBindingCall((binding) =>
      compensationCall(async (compensation) => {
        const runtime = await load();
        binding.assertActive();
        compensation.assertActive();
        return runtime.plexBinding.publishCompensatedMedia(
          input,
          binding,
          compensation,
        );
      }),
    );
}
