import type { Delivery } from "#infrastructure/delivery.ts";
import {
  seedForum,
  baselineProof,
  qualifyForumReleaseFixture,
} from "#infrastructure/forum/fixtures.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";

/** Shared genuine API/PG fixture with synthetic native observations, never used by production. */
export async function seedBrowserForum(delivery: Delivery) {
  await seedForum(delivery);
  const baseline = await delivery.requestForumBaseline(
    {
      requestId: "browser/forum/original",
      environmentId: "storm-forum/prod",
      expectedEnvironmentGeneration: 0,
      imageArtifactId: "forum-image",
      bundleArtifactId: "forum-bundle",
      reason:
        "Independently inspect original licensed installation before the first upgrade",
    },
    testOperator,
  );
  await delivery.completeForumBaseline(
    baseline.id,
    {
      expectedEnvironmentGeneration: 0,
      snapshotFingerprint: baseline.snapshotFingerprint,
    },
    testExecutor,
    (context) => Promise.resolve(baselineProof(context)),
  );
  const version = await qualifyForumReleaseFixture(
    delivery,
    "browser/forum/ci",
  );
  return delivery.createDeployment(
    {
      requestId: "browser/forum/first-upgrade",
      environmentId: "storm-forum/prod",
      versionSetRevisionId: version.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
}
