import { expect, test } from "vitest";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  WorkerVersionSchema,
  workerHostSpecification,
} from "@shepherdjerred/delivery/contract";
import {
  runDeployCommand,
  validateDeployCommand,
} from "#commands/deploy/deploy.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";

const worker = WorkerVersionSchema.parse({
  id: "worker:retained",
  environmentId: "temporal/prod",
  buildId: "a".repeat(40),
  sourceRevision: "a".repeat(40),
  artifactId: "artifact:original",
  artifactBuildId: "build:original",
  image: `docker.io/shepherdjerred/temporal-worker@sha256:${"d".repeat(64)}`,
  digest: `sha256:${"d".repeat(64)}`,
  introducedByDeploymentId: "deployment:original",
  host: workerHostSpecification("central"),
  replicas: 1,
  generation: 4,
  retiredAt: null,
});

test("worker commands reject incomplete targets and non-admin adoption before resolving credentials", () => {
  expect(() =>
    validateDeployCommand(
      "workers",
      ["retire", "temporal/prod"],
      parseDeployArgs([]).values,
    ),
  ).toThrow("Use deploy workers");
  expect(() =>
    validateDeployCommand(
      "workers",
      ["adopt"],
      parseDeployArgs(["--file", "reviewed.json"]).values,
    ),
  ).toThrow("admin --machine");
  expect(() =>
    validateDeployCommand(
      "workers",
      ["retire", "temporal/prod", worker.id],
      parseDeployArgs(["--expected-worker-generation", "-1"]).values,
    ),
  ).toThrow();
});

test("worker pool inspection returns exact original provenance without mutation", async () => {
  const requests: string[] = [];
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: async (input, init) => {
      requests.push(input instanceof Request ? input.url : input.toString());
      expect(init?.method).not.toBe("POST");
      return Response.json({
        environmentId: worker.environmentId,
        generation: 8,
        versions: [worker],
      });
    },
  });
  const result = await runDeployCommand(
    client,
    "workers",
    ["list", worker.environmentId],
    parseDeployArgs([]).values,
  );
  expect(result.result).toMatchObject({ versions: [worker] });
  expect(requests).toEqual([
    "https://delivery.invalid/api/v1/environments/temporal%2Fprod/workers",
  ]);
});

test("admin adoption forwards the reviewed original artifact reference and rejects arbitrary host settings", async () => {
  const filePath = `/tmp/delivery-worker-adopt-${crypto.randomUUID()}.json`;
  const file = Bun.file(filePath);
  const input = {
    requestId: "adopt:original",
    environmentId: worker.environmentId,
    expectedGeneration: 8,
    artifactId: worker.artifactId,
    introducedByDeploymentId: worker.introducedByDeploymentId,
    target: "central",
  };
  let payload: unknown;
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: async (url, init) => {
      expect(url instanceof Request ? url.url : url.toString()).toBe(
        "https://delivery.invalid/api/v1/workers",
      );
      payload = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return Response.json(worker);
    },
  });
  try {
    await Bun.write(file, JSON.stringify(input));
    const options = parseDeployArgs(["--machine", "--file", filePath]).values;
    await runDeployCommand(client, "workers", ["adopt"], options);
    expect(payload).toEqual(input);
    payload = undefined;
    await Bun.write(
      file,
      JSON.stringify({ ...input, host: { command: ["unreviewed"] } }),
    );
    await expect(
      runDeployCommand(client, "workers", ["adopt"], options),
    ).rejects.toThrow();
    expect(payload).toBeUndefined();
  } finally {
    await file.delete();
  }
});

test("retirement forwards explicit identity and both generations without caller drain proof", async () => {
  let payload: unknown;
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/workers"))
        return Response.json({
          environmentId: worker.environmentId,
          generation: 8,
          versions: [worker],
        });
      expect(url).toBe(
        "https://delivery.invalid/api/v1/workers/worker%3Aretained/retire",
      );
      payload = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return Response.json({
        id: "deployment:retirement",
        requestId: "request:exact",
        environmentId: worker.environmentId,
        serviceId: "temporal",
        versionSetRevisionId: "version:accepted",
        pipelineRevisionId: "pipeline:accepted",
        configurationId: "config:accepted",
        catalogRevision: "test-catalog",
        expectedGeneration: 7,
        kind: "retire-host",
        status: "queued",
        requestedBy: "operator",
        message: null,
        cancelRequested: false,
        recoveryRequired: false,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
      });
    },
  });
  const notices: string[] = [];
  const options = parseDeployArgs([
    "--request-id",
    "request:exact",
    "--expected-generation",
    "7",
    "--expected-worker-generation",
    "3",
  ]).values;
  await runDeployCommand(
    client,
    "workers",
    ["retire", worker.environmentId, worker.id],
    {
      ...options,
      requestNotice: (id) => {
        notices.push(id);
      },
    },
  );
  expect(payload).toEqual({
    requestId: "request:exact",
    expectedEnvironmentGeneration: 7,
    expectedWorkerGeneration: 3,
  });
  expect(notices).toEqual(["request:exact"]);
});

test("host-only baseline forwards independent worker artifacts separately from full-app version provenance", async () => {
  const filePath = `/tmp/delivery-worker-baseline-${crypto.randomUUID()}.json`;
  const file = Bun.file(filePath);
  const input = {
    requestId: "baseline:original",
    environmentId: worker.environmentId,
    expectedGeneration: 8,
    versionSetRevisionId: "app:newer-activity-image",
    kind: "adopt-worker",
    workerBaseline: {
      artifactIds: [worker.artifactId],
      candidateArtifactId: worker.artifactId,
    },
  };
  const requests: unknown[] = [];
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: async (url, init) => {
      expect(url instanceof Request ? url.url : url.toString()).toBe(
        "https://delivery.invalid/api/v1/deployments",
      );
      requests.push(
        typeof init?.body === "string" ? JSON.parse(init.body) : null,
      );
      return Response.json({
        id: "baseline:deployment",
        ...input,
        serviceId: "temporal",
        pipelineRevisionId: "pipeline:reviewed",
        configurationId: "config:reviewed",
        catalogRevision: "test-catalog",
        status: "queued",
        requestedBy: "admin",
        message: null,
        cancelRequested: false,
        recoveryRequired: false,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
      });
    },
  });
  try {
    await Bun.write(file, JSON.stringify(input));
    const options = parseDeployArgs(["--machine", "--file", filePath]).values;
    await runDeployCommand(client, "workers", ["baseline"], options);
    expect(requests).toEqual([input]);
    await Bun.write(
      file,
      JSON.stringify({ ...input, kind: "deploy", workerBaseline: undefined }),
    );
    await expect(
      runDeployCommand(client, "workers", ["baseline"], options),
    ).rejects.toThrow("kind adopt-worker");
    expect(requests).toHaveLength(1);
  } finally {
    await file.delete();
  }
});

test("worker recovery intent requires reviewed generation and admin authority before forwarding exact idempotent inputs", async () => {
  expect(() =>
    validateDeployCommand(
      "workers",
      ["recover", "deployment:failed"],
      parseDeployArgs([]).values,
    ),
  ).toThrow("admin --machine");
  expect(() =>
    validateDeployCommand(
      "workers",
      ["recover", "deployment:failed"],
      parseDeployArgs(["--machine"]).values,
    ),
  ).toThrow("--expected-generation");
  let payload: unknown;
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: async (url, init) => {
      expect(url instanceof Request ? url.url : url.toString()).toBe(
        "https://delivery.invalid/api/v1/deployments/deployment%3Afailed/worker-recovery",
      );
      payload = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return Response.json({
        id: "inspect:exact",
        deploymentId: "deployment:failed",
        requestedBy: "admin",
        reason:
          "Independent settled-state recovery after source Workflow outage",
        expectedEnvironmentGeneration: 8,
        snapshotFingerprint: "a".repeat(64),
        poolFingerprint: "b".repeat(64),
        status: "pending",
        workflowId: "delivery-worker-recovery/inspect:exact",
        submittedAt: null,
        message: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      });
    },
  });
  const options = parseDeployArgs([
    "--machine",
    "--request-id",
    "inspect:exact",
    "--expected-generation",
    "8",
    "--reason",
    "Independent settled-state recovery after source Workflow outage",
  ]).values;
  const result = await runDeployCommand(
    client,
    "workers",
    ["recover", "deployment:failed"],
    options,
  );
  expect(result.exitCode).toBe(0);
  expect(payload).toEqual({
    requestId: "inspect:exact",
    expectedEnvironmentGeneration: 8,
    reason: options.reason,
  });
});
