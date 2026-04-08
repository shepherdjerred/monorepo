import { proxyActivities } from "@temporalio/workflow";
import type { FetcherActivities } from "#activities/fetcher.ts";

const { getFirestoreManifestUrl, fetchManifestJson, uploadToS3 } =
  proxyActivities<FetcherActivities>({
    startToCloseTimeout: "2 minutes",
  });

export async function fetchSkillCappedManifest(): Promise<void> {
  const url = await getFirestoreManifestUrl();
  const jsonString = await fetchManifestJson(url);
  await uploadToS3(jsonString);
}
