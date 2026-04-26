import { proxyActivities } from "@temporalio/workflow";
import type { GolinkSyncActivities } from "#activities/golink-sync.ts";

const {
  listTailscaleIngresses,
  getExistingGolinks,
  createOrUpdateGolink,
  deleteStaleGolink,
} = proxyActivities<GolinkSyncActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    maximumAttempts: 5,
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "30s",
  },
});

export async function syncGolinks(): Promise<void> {
  const tailnetDomain = "tailnet-1a49.ts.net";
  const golinkUrl = `https://go.${tailnetDomain}`;

  // Step 1: Get desired state from K8s ingresses
  const ingresses = await listTailscaleIngresses();

  if (ingresses.length === 0) {
    console.warn("No Tailscale ingresses found");
    return;
  }

  // Build expected links: hostname -> short name
  const expectedLinks = new Map<string, string>();
  for (const hostname of ingresses) {
    const short = hostname.replace(`.${tailnetDomain}`, "");
    const long = `https://${hostname}/`;
    expectedLinks.set(short, long);
  }

  // Step 2: Get current state from golink
  const existingLinks = await getExistingGolinks(golinkUrl);

  // Step 3: Create or update missing/stale links
  let created = 0;
  for (const [short, long] of expectedLinks) {
    const existing = existingLinks.find((link) => link.short === short);
    if (existing?.long !== long) {
      await createOrUpdateGolink(golinkUrl, short, long);
      created++;
    }
  }

  // Step 4: Delete stale links pointing to our tailnet
  let deleted = 0;
  for (const link of existingLinks) {
    if (link.long.includes(tailnetDomain) && !expectedLinks.has(link.short)) {
      await deleteStaleGolink(golinkUrl, link.short);
      deleted++;
    }
  }

  console.warn(
    `Golink sync complete: ${String(created)} created/updated, ${String(deleted)} deleted`,
  );
}
