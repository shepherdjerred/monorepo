import type {
  NativeRecoveryNetworkActivities,
  NativeQuarantineNetworkActivities,
} from "@shepherdjerred/media/automation";
import type { NativeArchiveNetworkActivities } from "@shepherdjerred/media/native-archive";
import type { NativeCompensationNetworkActivities } from "@shepherdjerred/media/native-compensation";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import { mediaCall } from "./call.ts";
import { archiveCall } from "./archive-execution.ts";
import { compensationCall } from "./compensation-execution.ts";
import { plexBindingExecution } from "./plex-binding-execution.ts";

type Reviews = Pick<NativeRecoveryNetworkActivities, "observeNativeRecovery"> &
  Pick<NativeQuarantineNetworkActivities, "observeNativeQuarantine"> &
  Pick<NativeArchiveNetworkActivities, "observeNativeArchive"> &
  Pick<NativeCompensationNetworkActivities, "observeNativeCompensation">;
type Runtime = {
  nativePlex: {
    [K in keyof Reviews]: (
      input: Parameters<Reviews[K]>[0],
      execution: PlexBindingExecution,
    ) => ReturnType<Reviews[K]>;
  };
};

/** Capture original SDK/proof clocks before lazy configuration; retain each public failure category. */
export function createNativePlexReviewActivities(
  load: () => Promise<Runtime>,
): Reviews {
  const invoke = async (
    name: keyof Reviews,
    input: Parameters<Reviews[keyof Reviews]>[0],
    execution: PlexBindingExecution,
  ) => {
    execution.assertActive();
    const runtime = await load();
    execution.assertActive();
    await runtime.nativePlex[name](input, execution);
    execution.assertActive();
  };
  return {
    observeNativeRecovery: (input) =>
      mediaCall(() =>
        invoke("observeNativeRecovery", input, plexBindingExecution()),
      ),
    observeNativeQuarantine: (input) =>
      mediaCall(() =>
        invoke("observeNativeQuarantine", input, plexBindingExecution()),
      ),
    observeNativeArchive: (input) =>
      archiveCall((archive) => {
        const binding = plexBindingExecution();
        return invoke("observeNativeArchive", input, {
          ...binding,
          assertActive: () => {
            archive.assertActive();
            binding.assertActive();
          },
          checkpoint: archive.checkpoint,
        });
      }),
    observeNativeCompensation: (input) =>
      compensationCall((compensation) => {
        const binding = plexBindingExecution();
        return invoke("observeNativeCompensation", input, {
          ...binding,
          assertActive: () => {
            compensation.assertActive();
            binding.assertActive();
          },
          checkpoint: () => compensation.checkpoint("native-plex"),
        });
      }),
  };
}

type CompensationExecution =
  NativeCompensationNetworkActivities["observeNativeCompensationExecution"];
export function createNativePlexCompensationExecution(
  load: () => Promise<{
    nativePlex: {
      observeNativeCompensationExecution: (
        input: Parameters<CompensationExecution>[0],
        execution: PlexBindingExecution,
      ) => ReturnType<CompensationExecution>;
    };
  }>,
): CompensationExecution {
  return (input) =>
    compensationCall(async (compensation) => {
      const binding = plexBindingExecution();
      const execution = {
        ...binding,
        assertActive: () => {
          compensation.assertActive();
          binding.assertActive();
        },
        checkpoint: () => compensation.checkpoint("native-plex"),
      };
      execution.assertActive();
      const runtime = await load();
      execution.assertActive();
      const result =
        await runtime.nativePlex.observeNativeCompensationExecution(
          input,
          execution,
        );
      execution.assertActive();
      return result;
    });
}

type ArchiveCleanup =
  NativeArchiveNetworkActivities["observeNativeArchiveCleanup"];
export function createNativePlexArchiveCleanup(
  load: () => Promise<{
    nativePlex: {
      observeNativeArchiveCleanup: (
        input: Parameters<ArchiveCleanup>[0],
        execution: PlexBindingExecution,
      ) => ReturnType<ArchiveCleanup>;
    };
  }>,
): ArchiveCleanup {
  return (input) =>
    archiveCall(async (archive) => {
      const binding = plexBindingExecution();
      const execution = {
        ...binding,
        assertActive: () => {
          archive.assertActive();
          binding.assertActive();
        },
        checkpoint: archive.checkpoint,
      };
      execution.assertActive();
      const runtime = await load();
      execution.assertActive();
      const result = await runtime.nativePlex.observeNativeArchiveCleanup(
        input,
        execution,
      );
      execution.assertActive();
      return result;
    });
}
