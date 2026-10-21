import { forumBundlePolicyDigest } from "@shepherdjerred/ops-model/forum-bundle-digest.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { replicateProducedArtifacts } from "#testing/replication.ts";
import { ForumBaselineProofSchema } from "#shared/forum-contract.ts";
import type { ForumBaselineContext } from "#shared/contract.ts";

export async function qualifyForumReleaseFixture(
  delivery: Delivery,
  requestId: string,
) {
  const publication = await delivery.publish(
    {
      requestId,
      serviceId: "storm-forum",
      sourceRevision: "a".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/10",
      verifiedAt: new Date().toISOString(),
      artifacts: [],
      retainedArtifactIds: ["forum-image", "forum-chart", "forum-bundle"],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 10 },
  );
  await delivery.qualify(publication.buildId, "verified", testExecutor);
  const [selected] = await delivery.versions("storm-forum");
  if (selected === undefined)
    throw new Error("Qualified forum fixture release missing");
  return selected;
}

/** Explicit synthetic fixtures, only imported by tests and the disposable browser harness. */
export async function seedForum(delivery: Delivery) {
  const publication = await delivery.publish(
    {
      requestId: "forum-ci",
      serviceId: "storm-forum",
      sourceRevision: "a".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/9",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "forum-image",
          kind: "image",
          component: "image:storm-forum",
          uri: "docker.io/shepherdjerred/storm-forum",
          digest: `sha256:${"a".repeat(64)}`,
          runtimeDigests: [`sha256:${"b".repeat(64)}`],
          version: "1.0.0",
        },
        {
          id: "forum-chart",
          kind: "chart",
          component: "chart:storm-forum",
          uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/storm-forum-1.0.0.tgz",
          digest: `sha256:${"c".repeat(64)}`,
          version: "1.0.0",
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 9 },
  );
  await delivery.qualify(publication.buildId, "verified", testExecutor);
  const acquired = await delivery.publishForumBundle(
    {
      requestId: "forum-license",
      serviceId: "storm-forum",
      artifact: {
        id: "forum-bundle",
        kind: "archive",
        component: "archive:forum-bundle",
        uri: `s3://storm-forum-releases/releases/${"d".repeat(64)}.zip`,
        digest: `sha256:${"d".repeat(64)}`,
        version: forumBundlePolicy.xenforoVersion,
        origin: {
          kind: "licensed-bundle",
          manifestDigest: forumBundlePolicyDigest(),
          xenforoVersion: forumBundlePolicy.xenforoVersion,
          producerSourceRevision: "e".repeat(40),
        },
      },
    },
    testPublisher,
  );
  await replicateProducedArtifacts(delivery, acquired.buildId);
  await delivery.qualifyForumBundle(acquired.buildId, testExecutor, () =>
    Promise.resolve(),
  );
  await delivery.registerPipeline(
    "storm-forum/1",
    {
      kind: "argocd",
      application: "storm-forum",
      namespace: "storm-forum",
      chartName: "storm-forum",
      chartComponent: "chart:storm-forum",
      chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
      parameters: {},
      artifactParameters: { "delivery.image": "image:storm-forum" },
      forumRelease: {
        imageComponent: "image:storm-forum",
        bundleComponent: "archive:forum-bundle",
      },
    },
    testOperator,
  );
  const environment = await delivery.registerEnvironment(
    {
      id: "storm-forum/prod",
      serviceId: "storm-forum",
      name: "prod",
      application: "storm-forum",
      pipelineRevisionId: "storm-forum/1",
      configurationRevision: "storm-forum/1",
      configuration: {
        "forum.xenforoVersion": forumBundlePolicy.xenforoVersion,
      },
      automatic: true,
    },
    testOperator,
  );
  return { acquired, environment };
}

export function baselineProof(context: ForumBaselineContext) {
  return ForumBaselineProofSchema.parse({
    environmentId: context.environment.id,
    observedAt: new Date().toISOString(),
    application: {
      name: "storm-forum",
      uid: "app-uid",
      resourceVersion: "10",
      sourceFingerprint: "f".repeat(64),
    },
    runtimeImage: `${context.image.uri}@${context.image.digest}`,
    imageArtifactId: context.image.id,
    bundleArtifactId: context.bundle.id,
    bundleDigest: context.bundle.digest,
    storage: ["storm-forum-files", "storm-forum-database"].map((name) => ({
      name,
      uid: `${name}-uid`,
      resourceVersion: "10",
      volumeName: `${name}-pv`,
      specFingerprint: "e".repeat(64),
    })),
    runtime: {
      schemaVersion: 1,
      state: "installed",
      xenforoVersion: context.bundle.version,
      bundleSha256: context.bundle.digest.slice(7),
      maintenance: false,
      releaseLock: false,
    },
    pods: [
      {
        name: "storm-forum-web-abc",
        uid: "pod-uid",
        resourceVersion: "11",
        imageId: `${context.image.uri}@sha256:${"b".repeat(64)}`,
        workloadUid: "deployment-uid",
      },
    ],
    releaseJob: {
      name: "storm-forum-release-abcdef",
      uid: "job-uid",
      resourceVersion: "12",
      specFingerprint: "c".repeat(64),
      completedAt: "2026-10-16T10:00:00Z",
    },
  });
}
