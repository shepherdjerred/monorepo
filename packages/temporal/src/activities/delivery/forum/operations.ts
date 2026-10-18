import { z } from "zod";
import {
  ArtifactAcquisitionSchema,
  ForumBaselineContextSchema,
  ForumBaselineIntentSchema,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";

/** Serial API-owned byte verification is independent of Woodpecker's availability. */
export async function qualifyDeliveryForumBundles() {
  const pending = await deliveryRequest(
    "forum/bundles/pending",
    z.object({ builds: z.array(z.object({ id: z.string() })) }),
  );
  for (const build of pending.builds.slice(0, 1))
    await deliveryRequest(
      `forum/bundles/${encodeURIComponent(build.id)}/qualify`,
      ArtifactAcquisitionSchema,
      {},
    );
}
export async function observeDeliveryForumBaseline(intentId: string) {
  const path = `forum/baselines/${encodeURIComponent(intentId)}`,
    context = await deliveryRequest(path, ForumBaselineContextSchema);
  if (context.intent.status !== "pending") return;
  await deliveryRequest(`${path}/complete`, ForumBaselineIntentSchema, {
    expectedEnvironmentGeneration: context.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: context.intent.snapshotFingerprint,
  });
}
export async function failDeliveryForumBaseline(intentId: string) {
  const path = `forum/baselines/${encodeURIComponent(intentId)}`,
    context = await deliveryRequest(path, ForumBaselineContextSchema);
  if (context.intent.status !== "pending") return;
  await deliveryRequest(`${path}/fail`, ForumBaselineIntentSchema, {
    message:
      "Independent original forum observation did not complete; no baseline or deployment was accepted. Inspect native provenance and authenticated observer capability before requesting another baseline.",
  });
}
