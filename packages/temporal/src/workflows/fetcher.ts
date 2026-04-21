import { proxyActivities } from "@temporalio/workflow";
import type { FetcherActivities } from "#activities/fetcher.ts";

const { getFirestoreManifestUrl, fetchAndUploadManifest } =
  proxyActivities<FetcherActivities>({
    startToCloseTimeout: "2 minutes",
  });

export async function fetchSkillCappedManifest(): Promise<void> {
  const url = await getFirestoreManifestUrl();
  await fetchAndUploadManifest(url);
}
