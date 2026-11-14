import type { PlaybackActivities } from "@shepherdjerred/media/playback";
import {
  watchCall,
  watchExecution,
} from "#activities/media/watch-execution.ts";

type Runtime = {
  playback: {
    reconcile: (
      signal?: AbortSignal,
    ) => Promise<{ observed: number; completed: number }>;
  };
  requestInterests: {
    reconcile: () => Promise<{ nextCursor: string | null; processed: number }>;
  };
};
export function createPlaybackWorkerActivities(
  load: () => Promise<Runtime>,
): PlaybackActivities {
  return {
    reconcileMediaPlayback: () =>
      watchCall(async () => {
        const execution = watchExecution();
        const runtime = await load();
        execution.assertActive();
        await execution.checkpoint();
        const result = await runtime.playback.reconcile(execution.signal);
        execution.assertActive();
        return result;
      }),
    reconcileMediaRequestInterests: () =>
      watchCall(async () => {
        const execution = watchExecution();
        const runtime = await load();
        execution.assertActive();
        await execution.checkpoint();
        const result = await runtime.requestInterests.reconcile();
        execution.assertActive();
        return result;
      }),
  };
}
