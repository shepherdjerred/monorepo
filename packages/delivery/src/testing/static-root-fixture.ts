import type { Database } from "#infrastructure/database.ts";
import type { Deployment } from "#shared/contract.ts";
import { platformFixture } from "./platform-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "./seed.ts";
import {
  requestTestPlan,
  checkpointTestPlan,
  finishTestPlatform,
  testApply,
} from "./platform-execution.ts";

export async function staticRootFixture(database: Database) {
  const platform = await platformFixture(database),
    delivery = platform.delivery;
  const environmentId = "static-sites/sjer-red";
  await delivery.registerPipeline(
    "site/pipeline",
    {
      kind: "static-site",
      bucket: "sjer-red",
      archiveComponent: "site:sjer-red",
      immutablePrefixes: [],
      extraExcludes: [],
      entrypoints: ["index.html"],
      verification: { url: "https://sjer.red", expectedStatus: 200 },
    },
    testOperator,
  );
  await delivery.registerEnvironment(
    {
      id: environmentId,
      serviceId: "static-sites",
      name: "sjer-red",
      pipelineRevisionId: "site/pipeline",
      configurationRevision: "site/1",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
  async function publishSite(number: number) {
    const artifactId = `site/archive/${String(number)}`;
    const build = await delivery.publish(
      {
        requestId: `site/publish/${String(number)}`,
        serviceId: "static-sites",
        sourceRevision: number.toString(16).padEnd(40, "0"),
        ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
        verifiedAt: new Date().toISOString(),
        artifacts: [
          {
            id: artifactId,
            kind: "archive",
            component: "site:sjer-red",
            uri: `s3://delivery-artifacts/sites/sjer-red/${number.toString(16).padStart(64, "0")}.tar`,
            digest: `sha256:${number.toString(16).padStart(64, "0")}`,
            version: `2.0.0-${String(number)}`,
          },
        ],
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: number },
    );
    await delivery.qualify(build.buildId, "verified", testExecutor);
    const version = await database.versionSet.findFirstOrThrow({
      where: { qualifiedBuildId: build.buildId },
    });
    return { artifactId, versionId: version.id };
  }
  async function publishRoot(number: number, artifactId: string) {
    return delivery.publish(
      {
        requestId: `site/root/${String(number)}`,
        serviceId: "gitops",
        sourceRevision: number.toString(16).padEnd(40, "0"),
        ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
        verifiedAt: new Date().toISOString(),
        artifacts: [],
        retainedArtifactIds: [platform.rootArtifacts.apps],
        platformChanges: {
          root: true,
          rootArtifacts: platform.rootArtifacts,
          tofuStacks: ["seaweedfs", "tailscale", "arr"],
          sites: [{ environmentId, artifactId }],
        },
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: number },
    );
  }
  async function rootIntent(sourceBuildId: string) {
    const env = await database.environment.findUniqueOrThrow({
      where: { id: platform.rootEnvironment.id },
    });
    return delivery.createPlatformDeployment(
      {
        kind: "root-release",
        requestId: crypto.randomUUID(),
        environmentId: env.id,
        expectedGeneration: env.generation,
        sourceBuildId,
      },
      testOperator,
    );
  }
  async function acceptRoot(sourceBuildId: string) {
    for (const stack of ["seaweedfs", "tailscale", "arr"]) {
      const plan = await requestTestPlan(delivery, sourceBuildId, stack),
        saved = await checkpointTestPlan(delivery, plan);
      await finishTestPlatform(delivery, plan, saved);
      const apply = await testApply(delivery, plan);
      await delivery.claim(apply.id, testExecutor);
      await finishTestPlatform(delivery, apply);
    }
    const root = await rootIntent(sourceBuildId);
    await delivery.claim(root.id, testExecutor);
    await finishTestPlatform(delivery, root);
    return root;
  }
  async function siteIntent(
    versionId: string,
    kind: "deploy" | "rollback" = "deploy",
  ) {
    const env = await database.environment.findUniqueOrThrow({
      where: { id: environmentId },
    });
    return delivery.createDeployment(
      {
        kind,
        requestId: crypto.randomUUID(),
        environmentId,
        expectedGeneration: env.generation,
        versionSetRevisionId: versionId,
      },
      testOperator,
    );
  }
  async function acceptSite(site: Deployment) {
    await delivery.finish(
      site.id,
      {
        status: "succeeded",
        message: "Exact original archive bytes independently verified",
        observedRevisionId: site.versionSetRevisionId,
        recoveryRequired: false,
        evidence: [
          {
            kind: "reconciliation",
            summary: "Native archive activation finished",
          },
          {
            kind: "acceptance",
            summary: "Public entrypoints match archive SHA",
          },
        ],
      },
      testExecutor,
    );
  }
  const baseline = await publishSite(10),
    source = await publishRoot(1000, baseline.artifactId);
  await delivery.qualify(source.buildId, "verified", testExecutor);
  const root = await acceptRoot(source.buildId),
    site = await siteIntent(baseline.versionId);
  await delivery.claim(site.id, testExecutor);
  await acceptSite(site);
  return {
    ...platform,
    environmentId,
    baseline,
    root,
    site,
    publishSite,
    publishRoot,
    rootIntent,
    acceptRoot,
    siteIntent,
    acceptSite,
  };
}
