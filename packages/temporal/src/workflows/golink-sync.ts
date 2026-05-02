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

/**
 * Tailscale identity assigned to the temporal-worker pod (via the
 * `tag:tagged-devices` ACL tag). golink uses this string verbatim as the
 * `Owner` field on any link the worker creates. Manually-created links use
 * an email-shaped owner like `shepherdjerred@gmail.com` and must NOT be
 * touched by this sync — golink would 403 the update with
 * `cannot update link owned by "<other-owner>"`.
 */
const BOT_OWNER = "tagged-devices";

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

  // Step 3: Create or update missing/stale links — but only for entries
  // we own. A user-curated link (e.g. `go/temporal -> temporal-ui`) must
  // be left alone; trying to overwrite it just produces a 403 every run.
  let created = 0;
  let skippedOwnership = 0;
  for (const [short, long] of expectedLinks) {
    const existing = existingLinks.find((link) => link.short === short);
    if (existing !== undefined && existing.owner !== BOT_OWNER) {
      skippedOwnership++;
      continue;
    }
    if (existing?.long !== long) {
      await createOrUpdateGolink(golinkUrl, short, long);
      created++;
    }
  }

  // Step 4: Delete stale links pointing to our tailnet — only delete
  // links we own. golink rejects deletes from non-owners with the same
  // 403 as updates.
  let deleted = 0;
  for (const link of existingLinks) {
    if (
      link.owner === BOT_OWNER &&
      link.long.includes(tailnetDomain) &&
      !expectedLinks.has(link.short)
    ) {
      await deleteStaleGolink(golinkUrl, link.short);
      deleted++;
    }
  }

  console.warn(
    `Golink sync complete: ${String(created)} created/updated, ${String(deleted)} deleted, ${String(skippedOwnership)} skipped (different owner)`,
  );
}
