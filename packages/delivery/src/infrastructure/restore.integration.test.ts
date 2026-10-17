import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import {
  seedDelivery,
  testExecutor,
  testOperator,
  testPublisher,
} from "#testing/seed.ts";
import { createApp } from "#server/app.ts";
import { DeploymentSchema } from "#shared/contract.ts";
import { Delivery } from "./delivery.ts";

async function command(argv: string[]) {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0)
    throw new Error(`${argv[0] ?? "PostgreSQL tool"} failed: ${stderr}`);
  return stdout;
}

test("database dump and independent restore preserve immutable state, outbox, evidence and ownership", async () => {
  const source = await createTestDatabase();
  const destination = await createTestDatabase();
  const directory = await mkdtemp(path.join(tmpdir(), "delivery-dump-"));
  try {
    const delivery = new Delivery(source.database);
    const fixture = await seedDelivery(delivery);
    const ambiguous = await delivery.createDeployment(
      {
        requestId: "restore/ambiguous",
        environmentId: fixture.environment.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: 0,
        kind: "deploy",
      },
      testOperator,
    );
    await delivery.claim(ambiguous.id, testExecutor);
    await delivery.stage(
      ambiguous.id,
      {
        key: "reconcile",
        status: "running",
        operationId: "operation/restore",
        message: "External response lost",
        evidence: [
          {
            kind: "preflight",
            summary: "Exact artifact and source preflight passed",
          },
        ],
      },
      testExecutor,
    );
    await delivery.finish(
      ambiguous.id,
      {
        status: "failed",
        message: "External operation requires inspection",
        recoveryRequired: true,
        evidence: [],
      },
      testExecutor,
    );
    const archive = await delivery.publish(
      {
        requestId: "restore/archive",
        serviceId: "arcade",
        sourceRevision: "a".repeat(40),
        ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/2",
        verifiedAt: new Date().toISOString(),
        artifacts: [
          {
            id: "archive/restore",
            component: "site",
            kind: "archive",
            uri: "s3://delivery-artifacts/sites/arcade/fixture.tar",
            digest: `sha256:${"c".repeat(64)}`,
            version: "build-2",
          },
        ],
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: 2 },
    );
    await delivery.qualify(archive.buildId, "verified", testExecutor);
    await delivery.registerPipeline(
      "restore/site",
      {
        kind: "static-site",
        archiveComponent: "site",
        bucket: "delivery-backup-test",
        immutablePrefixes: [],
        extraExcludes: [],
        entrypoints: ["index.html"],
        verification: { url: "https://arcade.sjer.red", expectedStatus: 200 },
      },
      testOperator,
    );
    await delivery.registerEnvironment(
      {
        id: "arcade/site",
        serviceId: "arcade",
        name: "site",
        pipelineRevisionId: "restore/site",
        configurationRevision: "restore/config",
        configuration: { marker: "preserved" },
        automatic: false,
      },
      testOperator,
    );
    const revisions = await delivery.versions("arcade");
    const revision = revisions[0];
    if (revision === undefined)
      throw new Error("Expected immutable archive version");
    const request = {
      requestId: "restore/queued",
      environmentId: "arcade/site",
      versionSetRevisionId: revision.id,
      expectedGeneration: 0,
      kind: "deploy" as const,
    };
    const queued = await delivery.createDeployment(request, testOperator);
    const archivePath = path.join(directory, "delivery.dump");
    await command([
      "pg_dump",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      source.url,
      "--file",
      archivePath,
    ]);
    await command([
      "pg_restore",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      destination.url,
      archivePath,
    ]);
    const restored = new Delivery(destination.database);
    const retained = await restored.detail(ambiguous.id);
    expect(retained.deployment.recoveryRequired).toBe(true);
    expect(retained.environment.activeDeploymentId).toBe(ambiguous.id);
    expect(retained.evidence).toHaveLength(1);
    expect(retained.versionSet.components["server"]?.digest).toBe(
      fixture.versionSet.components["server"]?.digest,
    );
    expect(await destination.database.applicationLock.count()).toBe(1);
    expect(await destination.database.audit.count()).toBe(
      await source.database.audit.count(),
    );
    const pending = await restored.pending();
    expect(pending.deployments.map((entry) => entry.id)).toEqual([queued.id]);
    const app = createApp({
      delivery: restored,
      ciOrigin: "https://woodpecker.sjer.red",
      ciRepositoryId: 1,
      qualifyBuild: async () => "pending",
      peerAddress: () => "127.0.0.1",
      config: {
        publicOrigin: "http://delivery.test",
        machineCredentials: [],
        writesEnabled: async () => true,
        enabledEnvironments: async () => ["arcade/site"],
        operatorLogins: async () => [testOperator.id],
        trustedProxyAddresses: async () => ["127.0.0.1"],
      },
    });
    const response = await app.request("/api/v1/deployments", {
      method: "POST",
      headers: {
        "Tailscale-User-Login": testOperator.id,
        Origin: "http://delivery.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(201);
    const raw: unknown = await response.json();
    expect(DeploymentSchema.parse(raw).id).toBe(queued.id);
    expect(await destination.database.deployment.count()).toBe(2);
    expect(await destination.database.outbox.count()).toBe(2);
    const queuedDetail = await restored.detail(queued.id);
    expect(queuedDetail.deployment.configuration).toEqual({
      marker: "preserved",
    });
  } finally {
    await Promise.all([source.close(), destination.close()]);
    await rm(directory, { recursive: true });
  }
}, 60_000);
