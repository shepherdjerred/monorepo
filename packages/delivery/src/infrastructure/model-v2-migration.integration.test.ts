import { afterEach, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { createTestDatabase } from "#testing/postgres.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";

/** The last v1 migration: WP1 added retained, attested and replicated artifacts. */
const LAST_V1 = "20261021000000_retained_attested_replicated_artifacts";
const V2 = "20261022000000_model_v2";

type Cluster = Awaited<ReturnType<typeof createTestDatabase>>;
const clusters: Cluster[] = [];
afterEach(async () => {
  for (const cluster of clusters.splice(0)) await cluster.close();
});

async function v1Cluster() {
  const cluster = await createTestDatabase({ through: LAST_V1 });
  clusters.push(cluster);
  expect(cluster.applied.at(-1)).toBe(LAST_V1);
  return cluster;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** A representative v1 record: ordinary, approval-gated, platform and worker history. */
async function seedV1(cluster: Cluster) {
  const sql = (statement: string) =>
    cluster.database.$executeRawUnsafe(statement);
  await sql(`INSERT INTO "Build" ("id","requestId","serviceId","sourceRevision","sourceKind","ciUrl","verifiedAt","status","repositoryId","pipelineNumber","createdAt") VALUES
    ('build-1','ci/1/1/arcade','arcade','${"a".repeat(40)}','ci','https://woodpecker.sjer.red/repos/1/pipeline/1','2026-10-01T00:00:00Z','verified',1,1,'2026-10-01T00:00:00Z'),
    ('build-2','ci/1/2/arcade','arcade','${"b".repeat(40)}','ci','https://woodpecker.sjer.red/repos/1/pipeline/2','2026-10-02T00:00:00Z','verified',1,2,'2026-10-02T00:00:00Z'),
    ('build-3','ci/1/3/scout','scout-for-lol','${"c".repeat(40)}','ci','https://woodpecker.sjer.red/repos/1/pipeline/3','2026-10-03T00:00:00Z','verified',1,3,'2026-10-03T00:00:00Z'),
    ('build-4','acquire/minecraft','minecraft','${"d".repeat(40)}','upstream',NULL,'2026-10-04T00:00:00Z','verified',NULL,NULL,'2026-10-04T00:00:00Z'),
    ('build-5','ci/1/5/gitops','gitops','${"e".repeat(40)}','ci','https://woodpecker.sjer.red/repos/1/pipeline/5','2026-10-05T00:00:00Z','verified',1,5,'2026-10-05T00:00:00Z'),
    ('build-6','forum/bundle/1','storm-forum','${"f".repeat(40)}','attested',NULL,'2026-10-06T00:00:00Z','verified',NULL,NULL,'2026-10-06T00:00:00Z'),
    ('build-7','acquire/minecraft-server','minecraft','${"9".repeat(40)}','upstream',NULL,'2026-10-07T00:00:00Z','verified',1,7,'2026-10-07T00:00:00Z')`);
  await sql(`INSERT INTO "Artifact" ("id","buildId","component","kind","uri","digest","version","origin") VALUES
    ('art-image-1','build-1','image:arcade','image','docker.io/shepherdjerred/arcade','sha256:${"1".repeat(64)}','1.0.0','{"kind":"first-party"}'),
    ('art-chart-1','build-1','chart:arcade','chart','https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.0.0.tgz','sha256:${"2".repeat(64)}','1.0.0','{"kind":"first-party"}'),
    ('art-image-2','build-2','image:arcade','image','docker.io/shepherdjerred/arcade','sha256:${"3".repeat(64)}','1.0.1','{"kind":"first-party"}'),
    ('art-scout-image','build-3','image:scout-for-lol','image','docker.io/shepherdjerred/scout-for-lol','sha256:${"4".repeat(64)}','2.0.0','{"kind":"first-party"}'),
    ('art-scout-chart','build-3','chart:scout-for-lol','chart','https://chartmuseum.tailnet-1a49.ts.net/charts/scout-for-lol-2.0.0.tgz','sha256:${"5".repeat(64)}','2.0.0','{"kind":"first-party"}'),
    ('art-scout-site','build-3','archive:scout-frontend','archive','s3://delivery-artifacts/sites/scout/${"6".repeat(64)}.tar','sha256:${"6".repeat(64)}','2.0.0','{"kind":"first-party"}'),
    ('art-minecraft-chart','build-4','chart:minecraft','chart','https://chartmuseum.tailnet-1a49.ts.net/charts/minecraft-4.0.0.tgz','sha256:${"7".repeat(64)}','4.0.0','{"kind":"upstream","repository":"https://itzg.github.io/minecraft-server-charts/","name":"minecraft","version":"4.0.0","checksum":"sha256:${"7".repeat(64)}"}'),
    ('art-apps-chart','build-5','chart:apps','chart','https://chartmuseum.tailnet-1a49.ts.net/charts/apps-2.0.0-5.tgz','sha256:${"8".repeat(64)}','2.0.0-5','{"kind":"first-party"}'),
    ('art-forum-bundle','build-6','archive:forum-bundle','archive','s3://storm-forum-releases/releases/${"a".repeat(64)}.zip','sha256:${"a".repeat(64)}','2.3.4','{"kind":"licensed-bundle","manifestDigest":"sha256:${"b".repeat(64)}","xenforoVersion":"2.3.4","producerSourceRevision":"${"f".repeat(40)}"}'),
    ('art-minecraft-server','build-7','image:minecraft-server','image','ghcr.io/itzg/minecraft-server','sha256:${"c".repeat(64)}','2026.10.0','{"kind":"upstream","repository":"https://ghcr.io","name":"minecraft-server","version":"2026.10.0","checksum":"sha256:${"c".repeat(64)}"}')`);
  // WP1 columns: chart content identity and the off-cluster replica receipt.
  await sql(
    `UPDATE "Artifact" SET "contentFingerprint" = 'sha256:${"d".repeat(64)}', "replication" = '{"store":"r2","key":"charts/arcade-1.0.0.tgz","digest":"sha256:${"2".repeat(64)}","replicatedAt":"2026-10-01T00:00:00.000Z"}' WHERE "id" = 'art-chart-1'`,
  );
  await sql(`INSERT INTO "BuildArtifactSelection" ("buildId","component","artifactId") VALUES
    ('build-1','image:arcade','art-image-1'),('build-1','chart:arcade','art-chart-1'),
    ('build-2','image:arcade','art-image-2'),('build-2','chart:arcade','art-chart-1'),
    ('build-3','image:scout-for-lol','art-scout-image'),('build-3','chart:scout-for-lol','art-scout-chart'),('build-3','archive:scout-frontend','art-scout-site'),
    ('build-4','chart:minecraft','art-minecraft-chart'),('build-5','chart:apps','art-apps-chart'),
    ('build-6','archive:forum-bundle','art-forum-bundle'),('build-7','image:minecraft-server','art-minecraft-server')`);
  await sql(`INSERT INTO "VersionSet" ("id","qualifiedBuildId","serviceId","revision","baseRevisionId") VALUES
    ('set-1','build-1','arcade',1,NULL),
    ('set-2','build-2','arcade',2,'set-1'),
    ('set-manual',NULL,'arcade',3,NULL),
    ('set-scout','build-3','scout-for-lol',1,NULL),
    ('set-forum','build-6','storm-forum',1,NULL)`);
  await sql(`INSERT INTO "VersionSetEntry" ("revisionId","component","artifactId") VALUES
    ('set-1','image:arcade','art-image-1'),('set-1','chart:arcade','art-chart-1'),
    ('set-2','image:arcade','art-image-2'),('set-2','chart:arcade','art-chart-1'),
    ('set-manual','image:arcade','art-image-1'),('set-manual','chart:arcade','art-chart-1'),
    ('set-scout','image:scout-for-lol','art-scout-image'),('set-scout','chart:scout-for-lol','art-scout-chart'),('set-scout','archive:scout-frontend','art-scout-site'),
    ('set-forum','archive:forum-bundle','art-forum-bundle')`);
  await sql(`INSERT INTO "Pipeline" ("id","definition") VALUES
    ('arcade/1','{"kind":"argocd","application":"arcade","chartRepository":"https://chartmuseum.tailnet-1a49.ts.net","chartName":"arcade","chartComponent":"chart:arcade","parameters":{},"artifactParameters":{"image.ref":"image:arcade"},"namespace":"arcade"}'),
    ('scout-prod/1','{"kind":"argocd","application":"scout-for-lol-prod","chartRepository":"https://chartmuseum.tailnet-1a49.ts.net","chartName":"scout-for-lol","chartComponent":"chart:scout-for-lol","parameters":{},"artifactParameters":{},"namespace":"scout-for-lol-prod"}'),
    ('gitops-root/1','{"kind":"root-release","runnerImage":"docker.io/shepherdjerred/ci-base@sha256:${"9".repeat(64)}"}')`);
  await sql(`INSERT INTO "Environment" ("id","serviceId","name","application","pipelineRevisionId","configurationRevision","configuration","automatic","promotionSourceEnvironmentId","generation","desiredVersionSetRevisionId","observedVersionSetRevisionId","acceptedVersionSetRevisionId","activeDeploymentId") VALUES
    ('arcade/prod','arcade','prod','arcade','arcade/1','arcade-config/1','{"replicas":"2"}',true,NULL,3,'set-2','set-2','set-2',NULL),
    ('scout-for-lol/prod','scout-for-lol','prod','scout-for-lol-prod','scout-prod/1','scout-config/1','{}',false,NULL,1,NULL,NULL,NULL,NULL),
    ('gitops/root','gitops','root',NULL,'gitops-root/1','root-config/1','{}',false,NULL,2,NULL,NULL,NULL,NULL)`);
  await sql(`INSERT INTO "Deployment" ("id","requestId","environmentId","serviceId","versionSetRevisionId","previousAcceptedVersionSetRevisionId","previousAcceptedConfiguration","pipelineRevisionId","configurationRevision","configuration","expectedGeneration","kind","automatic","status","requestedBy","message","createdAt","startedAt","finishedAt","recoveryRequired") VALUES
    ('dep-1','deploy/1','arcade/prod','arcade','set-1',NULL,NULL,'arcade/1','arcade-config/1','{"replicas":"2"}',0,'deploy',true,'succeeded','executor','Release accepted','2026-10-01T01:00:00Z','2026-10-01T01:01:00Z','2026-10-01T01:05:00Z',false),
    ('dep-2','deploy/2','arcade/prod','arcade','set-2','set-1','{"replicas":"2"}','arcade/1','arcade-config/1','{"replicas":"2"}',1,'deploy',true,'succeeded','executor','Release accepted','2026-10-02T01:00:00Z','2026-10-02T01:01:00Z','2026-10-02T01:05:00Z',false),
    ('dep-3','rollback/3','arcade/prod','arcade','set-1','set-2','{"replicas":"2"}','arcade/1','arcade-config/1','{"replicas":"2"}',2,'rollback',false,'failed','operator@example.com','Deployment stopped','2026-10-03T01:00:00Z','2026-10-03T01:01:00Z','2026-10-03T01:05:00Z',false),
    ('dep-4','deploy/4','scout-for-lol/prod','scout-for-lol','set-scout',NULL,NULL,'scout-prod/1','scout-config/1','{}',1,'deploy',false,'canceled','operator@example.com','Rejected','2026-10-04T01:00:00Z',NULL,'2026-10-04T01:10:00Z',false),
    ('dep-5','deploy/5','arcade/prod','arcade','set-2','set-2','{"replicas":"2"}','arcade/1','arcade-config/1','{"replicas":"2"}',3,'deploy',false,'canceled','operator@example.com','Canceled before execution','2026-10-05T01:00:00Z',NULL,'2026-10-05T01:01:00Z',false)`);
  await sql(`INSERT INTO "Deployment" ("id","requestId","environmentId","serviceId","versionSetRevisionId","pipelineRevisionId","configurationRevision","configuration","expectedGeneration","kind","status","requestedBy","createdAt","finishedAt","platformSnapshot","platformSourceBuildId") VALUES
    ('dep-root','root/1','gitops/root','gitops','set-1','gitops-root/1','root-config/1','{}',1,'root-release','succeeded','operator@example.com','2026-10-05T02:00:00Z','2026-10-05T02:30:00Z','{"kind":"root-release","charts":[]}','build-5')`);
  await sql(
    `UPDATE "Environment" SET "acceptedPlatformDeploymentId" = 'dep-root' WHERE "id" = 'gitops/root'`,
  );
  await sql(`INSERT INTO "Deployment" ("id","requestId","environmentId","serviceId","versionSetRevisionId","pipelineRevisionId","configurationRevision","configuration","expectedGeneration","kind","status","requestedBy","createdAt","finishedAt","workerSnapshot") VALUES
    ('dep-retire','retire/1','arcade/prod','arcade','set-2','arcade/1','arcade-config/1','{"replicas":"2"}',2,'retire-worker','failed','operator@example.com','2026-10-04T03:00:00Z','2026-10-04T03:10:00Z','{"workerOperation":"retire"}')`);
  await sql(`INSERT INTO "Approval" ("id","deploymentId","decision","reason","actor") VALUES
    ('approval-1','dep-2','approve','Reviewed the release','operator@example.com'),
    ('approval-2','dep-4','reject','Not this one','operator@example.com')`);
  await sql(
    `INSERT INTO "Evidence" ("id","deploymentId","kind","summary","operationId") VALUES ('dep-2/finish/0','dep-2','acceptance','All configured release acceptance checks passed','op-2')`,
  );
  await sql(
    `INSERT INTO "Stage" ("id","deploymentId","key","status","operationId","message","updatedAt") VALUES ('stage-1','dep-2','reconcile','succeeded','op-2','reconcile: succeeded','2026-10-02T01:04:00Z')`,
  );
  await sql(`INSERT INTO "WorkerRecoveryIntent" ("id","deploymentId","requestedBy","reason","expectedEnvironmentGeneration","snapshotFingerprint","poolFingerprint","status","workflowId","message","createdAt","finishedAt") VALUES
    ('worker-intent-1','dep-retire','operator@example.com','Inspect the retirement after the executor restarted unexpectedly',2,'${"a".repeat(64)}','${"b".repeat(64)}','succeeded','delivery-worker-recovery/worker-intent-1','Independently settled','2026-10-04T04:00:00Z','2026-10-04T04:05:00Z')`);
  await sql(`INSERT INTO "ContentRecoveryIntent" ("id","deploymentId","targetKind","requestedBy","reason","expectedEnvironmentGeneration","snapshotFingerprint","status","nativeReceipts","dispatchBarrier","barrierRestoredAt","message","createdAt","finishedAt") VALUES
    ('content-intent-1','dep-3','static-site','operator@example.com','Inspect the failed rollback archive activation independently',2,'${"c".repeat(64)}','failed','[{"action":"original"}]','{"adapter":"control-plane-dispatch-barrier/v1"}','2026-10-03T05:00:00Z','Inspection failed','2026-10-03T04:00:00Z','2026-10-03T04:30:00Z')`);
  await sql(
    `INSERT INTO "ImportedSnapshot" ("id","requestId","serviceId","capturedAt","source","components","evidence") VALUES ('import-1','import/1','arcade','2026-09-01T00:00:00Z','argocd','{}','legacy')`,
  );
}

type Database = Cluster["database"];

async function expectServices(db: Database) {
  const services = await db.service.findMany({ orderBy: { id: "asc" } });
  expect(services.map((service) => service.id)).toEqual([
    "arcade",
    "gitops",
    "minecraft",
    "scout-for-lol",
    "storm-forum",
  ]);
  const arcade = services.find((service) => service.id === "arcade");
  expect(arcade?.components).toEqual([
    { name: "chart:arcade", producer: "first-party" },
    { name: "image:arcade", producer: "first-party" },
  ]);
  expect(arcade?.lineage).toBe(sha256("chart:arcade\nimage:arcade"));
  expect(arcade?.catalogRevision).toBe("v1-backfill");
  expect(
    services.find((service) => service.id === "minecraft")?.components,
  ).toEqual([
    { name: "chart:minecraft", producer: "acquisition" },
    { name: "image:minecraft-server", producer: "acquisition" },
  ]);
  return services;
}

async function expectEnvironments(db: Database) {
  const configurations = await db.configuration.findMany({
    orderBy: { id: "asc" },
  });
  expect(configurations.map((row) => [row.id, row.content])).toEqual([
    ["arcade-config/1", { replicas: "2" }],
    ["root-config/1", {}],
    ["scout-config/1", {}],
  ]);
  const arcadeProd = await db.environment.findUniqueOrThrow({
    where: { id: "arcade/prod" },
  });
  expect(arcadeProd).toMatchObject({
    declaredConfigurationId: "arcade-config/1",
    acceptedDeploymentId: "dep-2",
    acceptedVersionSetRevisionId: "set-2",
    role: "durable",
    lifecycle: "active",
    approvalPolicy: "none",
  });
  expect(
    await db.environment.findUniqueOrThrow({
      where: { id: "scout-for-lol/prod" },
    }),
  ).toMatchObject({ approvalPolicy: "required", acceptedDeploymentId: null });
  expect(
    await db.environment.findUniqueOrThrow({ where: { id: "gitops/root" } }),
  ).toMatchObject({ acceptedDeploymentId: "dep-root" });
}

async function expectSetRevisions(db: Database, lineages: Map<string, string>) {
  const sets = await db.versionSet.findMany({
    orderBy: [{ revision: "asc" }, { id: "asc" }],
  });
  expect(
    sets.map((set) => [
      set.id,
      set.lineage === lineages.get(set.serviceId),
      set.orderMajor,
      set.orderMinor,
    ]),
  ).toEqual([
    ["set-1", true, 1, 0],
    // Attested: the highest major key the service composed before it, then
    // its registration sequence (B4).
    ["set-forum", true, 0, 6],
    ["set-scout", true, 3, 0],
    ["set-2", true, 2, 0],
    ["set-manual", true, null, null],
  ]);
}

async function expectDeployments(db: Database) {
  const deployments = await db.deployment.findMany({ orderBy: { id: "asc" } });
  for (const row of deployments) {
    expect(row.catalogRevision).toBe("v1-backfill");
    expect(row.configurationId).toMatch(/-config\/1$/u);
  }
  const byId = new Map(deployments.map((row) => [row.id, row]));
  expect(byId.get("dep-retire")?.kind).toBe("retire-host");
  expect(byId.get("dep-3")?.restoredDeploymentId).toBe("dep-1");
  expect(byId.get("dep-2")?.monitorState).toBe("unmonitored");
  expect(byId.get("dep-2")?.monitorSettledAt?.toISOString()).toBe(
    "2026-10-02T01:05:00.000Z",
  );
  expect(byId.get("dep-1")?.monitorState).toBeNull();
}

async function expectApprovals(db: Database) {
  const approvals = await db.approval.findMany({
    orderBy: { deploymentId: "asc" },
  });
  expect(
    approvals.map((row) => [
      row.deploymentId,
      row.status,
      row.actor,
      row.override,
      row.decidedAt !== null,
    ]),
  ).toEqual([
    ["dep-2", "granted", "operator@example.com", false, true],
    ["dep-4", "rejected", "operator@example.com", false, true],
  ]);
  expect(approvals[0]?.boundFingerprint).toBe(
    sha256("set-2\narcade/1\narcade-config/1"),
  );
  expect(approvals[1]?.boundFingerprint).toBe(
    sha256("set-scout\nscout-prod/1\nscout-config/1"),
  );
}

async function expectArtifacts(db: Database) {
  const artifacts = await db.artifact.findMany({ orderBy: { id: "asc" } });
  expect(
    Object.fromEntries(artifacts.map((row) => [row.id, row.store])),
  ).toEqual({
    "art-apps-chart": "chartmuseum",
    "art-chart-1": "chartmuseum",
    "art-forum-bundle": "storm-forum-releases",
    "art-image-1": "docker-hub",
    "art-image-2": "docker-hub",
    "art-minecraft-chart": "chartmuseum",
    "art-minecraft-server": "upstream-image-registry",
    "art-scout-chart": "chartmuseum",
    "art-scout-image": "docker-hub",
    "art-scout-site": "delivery-artifacts",
  });
  // WP1's columns carry through untouched.
  expect(artifacts.find((row) => row.id === "art-chart-1")).toMatchObject({
    contentFingerprint: `sha256:${"d".repeat(64)}`,
    replication: { store: "r2", key: "charts/arcade-1.0.0.tgz" },
  });
  const builds = await db.build.findMany({ orderBy: { id: "asc" } });
  expect(builds.map((row) => row.registrationSequence)).toEqual([
    1, 2, 3, 4, 5, 6, 7,
  ]);
}

async function expectIntents(db: Database) {
  const intents = await db.recoveryIntent.findMany({ orderBy: { id: "asc" } });
  expect(
    intents.map((row) => [
      row.id,
      row.kind,
      row.deploymentId,
      row.sequence,
      row.status,
    ]),
  ).toEqual([
    ["content-intent-1", "content", "dep-3", 1, "failed"],
    ["worker-intent-1", "worker", "dep-retire", 1, "succeeded"],
  ]);
  expect(intents[0]).toMatchObject({
    detail: {
      targetKind: "static-site",
      nativeReceipts: [{ action: "original" }],
    },
    evidence: [],
    fingerprint: `sha256:${"c".repeat(64)}`,
    barrier: { adapter: "control-plane-dispatch-barrier/v1" },
  });
  expect(intents[0]?.barrierRestoredAt).not.toBeNull();
  expect(intents[1]).toMatchObject({
    detail: { poolFingerprint: "b".repeat(64) },
    workflowId: "delivery-worker-recovery/worker-intent-1",
  });
}

async function expectTables(db: Database) {
  expect(await db.targetLock.count()).toBe(0);
  expect(await db.platformLock.count()).toBe(0);
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  const names = tables.map((row) => row.table_name);
  for (const dropped of [
    "ApplicationLock",
    "ImportedSnapshot",
    "WorkerRecoveryIntent",
    "MinecraftRecoveryIntent",
    "PlatformRecoveryIntent",
    "ContentRecoveryIntent",
  ])
    expect(names).not.toContain(dropped);
  for (const created of [
    "Service",
    "Configuration",
    "TargetLock",
    "RecoveryIntent",
    "PrerequisiteEdge",
    "MonitorObservation",
    "ComponentReference",
    "ForumBaselineIntent",
  ])
    expect(names).toContain(created);
}

describe("model_v2 migration", () => {
  test("backfills services, configurations, selections, approvals, locks and intents from a v1 record", async () => {
    const cluster = await v1Cluster();
    await seedV1(cluster);
    await cluster.migrate();
    expect(cluster.applied.at(-1)).toBe(V2);
    const db = cluster.database;
    const services = await expectServices(db);
    await expectEnvironments(db);
    await expectSetRevisions(
      db,
      new Map(services.map((service) => [service.id, service.lineage])),
    );
    await expectDeployments(db);
    await expectApprovals(db);
    await expectArtifacts(db);
    await expectIntents(db);
    await expectTables(db);
  }, 120_000);

  test("moves upstream origin keys to the per-service form and leaves bundle keys alone", async () => {
    const cluster = await v1Cluster();
    await seedV1(cluster);
    // v1 keyed an upstream origin without its acquiring service.
    const v1Key = (origin: Record<string, string>) =>
      fingerprint({
        kind: origin["kind"],
        repository: origin["repository"],
        name: origin["name"],
        version: origin["version"],
      });
    const upstream = await cluster.database.$queryRawUnsafe<
      { id: string; origin: Record<string, string> }[]
    >(
      `SELECT "id", "origin" FROM "Artifact" WHERE "origin"->>'kind' = 'upstream' ORDER BY "id"`,
    );
    expect(upstream.map((row) => row.id)).toEqual([
      "art-minecraft-chart",
      "art-minecraft-server",
    ]);
    for (const row of upstream)
      await cluster.database.$executeRawUnsafe(
        `UPDATE "Artifact" SET "originKey" = '${v1Key(row.origin)}' WHERE "id" = '${row.id}'`,
      );
    const bundleKey = "f".repeat(64);
    await cluster.database.$executeRawUnsafe(
      `UPDATE "Artifact" SET "originKey" = '${bundleKey}' WHERE "id" = 'art-forum-bundle'`,
    );
    await cluster.migrate();
    const migrated = await cluster.database.artifact.findMany({
      where: { originKey: { not: null } },
      orderBy: { id: "asc" },
    });
    // The key `acquireUpstreamArtifact` looks up for the same acquisition.
    expect(migrated.map((row) => [row.id, row.originKey])).toEqual([
      ["art-forum-bundle", bundleKey],
      ...upstream.map((row) => [
        row.id,
        fingerprint({
          serviceId: "minecraft",
          kind: row.origin["kind"],
          repository: row.origin["repository"],
          name: row.origin["name"],
          version: row.origin["version"],
        }),
      ]),
    ]);
  }, 120_000);

  test("refuses an accepted set revision without a succeeded deployment", async () => {
    const cluster = await v1Cluster();
    await seedV1(cluster);
    await cluster.database.$executeRawUnsafe(
      `UPDATE "Environment" SET "acceptedVersionSetRevisionId" = 'set-manual' WHERE "id" = 'arcade/prod'`,
    );
    await expect(cluster.migrate()).rejects.toThrow(
      /accepted set revision without a matching succeeded deployment in arcade\/prod/u,
    );
  }, 120_000);

  test("refuses a configuration label carrying two contents", async () => {
    const cluster = await v1Cluster();
    await seedV1(cluster);
    await cluster.database.$executeRawUnsafe(
      `UPDATE "Deployment" SET "configuration" = '{"replicas":"3"}' WHERE "id" = 'dep-1'`,
    );
    await expect(cluster.migrate()).rejects.toThrow(
      /configuration label carries two contents: arcade-config\/1/u,
    );
  }, 120_000);

  test("refuses an artifact outside every registered store", async () => {
    const cluster = await v1Cluster();
    await seedV1(cluster);
    await cluster.database.$executeRawUnsafe(
      `UPDATE "Artifact" SET "uri" = 'ghcr.io/example/arcade' WHERE "id" = 'art-image-2'`,
    );
    await expect(cluster.migrate()).rejects.toThrow(
      /artifact URI outside every registered store: ghcr\.io\/example\/arcade/u,
    );
  }, 120_000);

  test("refuses while a recovery or baseline intent is unsettled", async () => {
    const cluster = await v1Cluster();
    await seedV1(cluster);
    await cluster.database.$executeRawUnsafe(
      `UPDATE "WorkerRecoveryIntent" SET "status" = 'pending' WHERE "id" = 'worker-intent-1'`,
    );
    await cluster.database.$executeRawUnsafe(
      `UPDATE "ContentRecoveryIntent" SET "barrierRestoredAt" = NULL WHERE "id" = 'content-intent-1'`,
    );
    await expect(cluster.migrate()).rejects.toThrow(
      /recovery or baseline intents are unsettled or hold an unrestored barrier: content-intent-1, worker-intent-1/u,
    );
  }, 120_000);

  test("refuses while a deployment is pending, owned or recovery-required", async () => {
    const cluster = await v1Cluster();
    await seedV1(cluster);
    await cluster.database.$executeRawUnsafe(
      `UPDATE "Deployment" SET "recoveryRequired" = true WHERE "id" = 'dep-3'`,
    );
    await cluster.database.$executeRawUnsafe(
      `UPDATE "Deployment" SET "status" = 'queued', "finishedAt" = NULL WHERE "id" = 'dep-5'`,
    );
    await expect(cluster.migrate()).rejects.toThrow(
      /deployments are pending, owned or recovery-required; cancel or settle them first: dep-3, dep-5/u,
    );
  }, 120_000);
});
