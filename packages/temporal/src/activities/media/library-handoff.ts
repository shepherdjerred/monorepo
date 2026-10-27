import type {
  LibraryHandoffFileActivities,
  LibraryHandoffNetworkActivities,
} from "@shepherdjerred/media/automation";
import type {
  createMediaFileRuntime,
  createMediaNetworkRuntime,
} from "@shepherdjerred/media/automation/network";
import { plexBindingCall } from "./plex-binding-execution.ts";
import { compensationCall } from "./compensation-execution.ts";
import { mediaCall } from "./call.ts";

export function createLibraryHandoffNetworkActivities(
  load: () => Promise<
    Pick<
      Awaited<ReturnType<typeof createMediaNetworkRuntime>>,
      "libraryHandoff"
    >
  >,
): LibraryHandoffNetworkActivities {
  return {
    plannedLibraryPlexEdits: (input) =>
      mediaCall(async () => {
        const runtime = await load();
        return runtime.libraryHandoff.plannedEdits(input);
      }),
    protectLibraryHandoff: (input) =>
      mediaCall(async () => {
        const runtime = await load();
        await runtime.libraryHandoff.protect(input);
      }),
    editLibraryPlexEdition: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.libraryHandoff.edit(input, execution);
      }),
  };
}

export function createLibraryHandoffFileActivities(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaFileRuntime>>, "libraryHandoff">
  >,
): LibraryHandoffFileActivities {
  return {
    prepareLibraryPlexEditFile: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return runtime.libraryHandoff.prepareEditFile(input, {
          ...sdk,
          observed,
          checkpoint: () => sdk.checkpoint("library-plex-file-proof"),
        });
      });
    },
  };
}
