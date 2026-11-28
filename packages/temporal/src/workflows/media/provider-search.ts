import { continueAsNew, patched, sleep } from "@temporalio/workflow";
import type {
  MediaNetworkActivities,
  MediaReconcileOperation,
  MediaWorkflowResult,
} from "@shepherdjerred/media/automation";

type Result = Awaited<
  ReturnType<MediaNetworkActivities["reconcileMediaIntent"]>
>;

/** Never reinterpret an already recorded legacy activity outcome during replay. */
export function waitForEpisodeProviders(
  input: MediaReconcileOperation,
  result: Result,
) {
  return result.status === "waiting" &&
    result.reason === "provider_deferred" &&
    patched("media-progressive-episode-search-v1")
    ? resumeEpisodeSearch(input, result)
    : null;
}

async function resumeEpisodeSearch(
  input: MediaReconcileOperation,
  result: Result,
) {
  const { retryAfterSeconds, providerSearchProgress } = result;
  if (
    retryAfterSeconds === undefined ||
    providerSearchProgress === undefined ||
    retryAfterSeconds <= 0 ||
    !Number.isSafeInteger(retryAfterSeconds)
  )
    throw new Error("Episode provider deferral lost its deadline or progress");
  await sleep(retryAfterSeconds * 1000);
  return continueAsNew<
    (input: MediaReconcileOperation) => Promise<MediaWorkflowResult>
  >({
    ...input,
    providerSearchProgress,
  });
}
