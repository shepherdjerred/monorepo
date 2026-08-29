import { proxyActivities } from "@temporalio/workflow";
import type { FetcherActivities } from "#activities/fetcher.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { getFirestoreManifestUrl, fetchAndUploadManifest } =
  proxyActivities<FetcherActivities>({
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    startToCloseTimeout: "2 minutes",
  });

export async function fetchSkillCappedManifest(): Promise<void> {
  const url = await getFirestoreManifestUrl();
  await fetchAndUploadManifest(url);
}
