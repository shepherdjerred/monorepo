import { describe, expect, test } from "vitest";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  DeploymentDetailSchema,
  DeploymentSchema,
  EnvironmentSchema,
} from "@shepherdjerred/delivery/contract";
import { deliveryUrl } from "#lib/delivery/client.ts";
import {
  runDeployCommand,
  validateDeployCommand,
  waitForDeployment,
} from "#commands/deploy/deploy.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";

const createdAt = "2026-10-16T00:00:00.000Z";
const environment = EnvironmentSchema.parse({
  id: "arcade/prod",
  serviceId: "arcade",
  name: "production",
  application: "arcade",
  pipelineRevisionId: "pipeline:1",
  configurationRevision: "config:1",
  configuration: {},
  automatic: true,
  promotionSourceEnvironmentId: null,
  generation: 4,
  approvalRequired: false,
  desiredVersionSetRevisionId: null,
  observedVersionSetRevisionId: null,
  acceptedVersionSetRevisionId: null,
  observedAt: null,
  activeDeploymentId: null,
  createdAt,
});
const deployment = DeploymentSchema.parse({
  id: "deployment:1",
  requestId: "request:1",
  environmentId: environment.id,
  serviceId: "arcade",
  versionSetRevisionId: "arcade:1",
  pipelineRevisionId: "pipeline:1",
  configurationRevision: "config:1",
  configuration: {},
  expectedGeneration: 4,
  kind: "deploy",
  status: "queued",
  requestedBy: "operator",
  message: null,
  cancelRequested: false,
  recoveryRequired: false,
  createdAt,
  startedAt: null,
  finishedAt: null,
});

describe("delivery CLI", () => {
  test("rejects credentials and insecure remote URLs", () => {
    expect(() => deliveryUrl("https://operator:secret@example.com")).toThrow(
      "without credentials",
    );
    expect(() => deliveryUrl("http://example.com")).toThrow("HTTPS");
    expect(deliveryUrl("http://127.0.0.1:7353/")).toBe("http://127.0.0.1:7353");
  });
  test("validates explicit targets and approvals before credential resolution", () => {
    expect(() =>
      validateDeployCommand("start", [], parseDeployArgs([]).values),
    ).toThrow("Invalid operands");
    expect(() =>
      validateDeployCommand(
        "approve",
        ["deployment:1"],
        parseDeployArgs(["--machine", "--reason", "ready"]).values,
      ),
    ).toThrow("trusted human");
    expect(() =>
      validateDeployCommand(
        "approve",
        ["deployment:1"],
        parseDeployArgs([]).values,
      ),
    ).toThrow("--reason");
    expect(() => parseDeployArgs(["--token", "secret"])).toThrow();
  });
  test("start forwards exact target, revision, generation and idempotency key", async () => {
    const requests: { url: string; body: unknown; headers: Headers }[] = [];
    const client = createDeliveryClient({
      baseUrl: "https://delivery.invalid",
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        requests.push({
          url,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          headers: new Headers(init?.headers),
        });
        return Response.json(
          url.endsWith("overview")
            ? {
                environments: [environment],
                deployments: [],
                artifacts: [],
                versionSets: [],
              }
            : deployment,
        );
      },
    });
    const { values, positionals } = parseDeployArgs([
      "arcade/prod",
      "arcade:1",
      "--request-id",
      "request:exact",
    ]);
    const result = await runDeployCommand(client, "start", positionals, values);
    expect(result.exitCode).toBe(0);
    expect(requests[1]?.body).toEqual({
      requestId: "request:exact",
      environmentId: "arcade/prod",
      versionSetRevisionId: "arcade:1",
      expectedGeneration: 4,
      kind: "deploy",
    });
    expect(requests[1]?.headers.has("Tailscale-User-Login")).toBe(false);
  });
  test("wait deadline preserves pending status and returns distinct exit code", async () => {
    const detail = DeploymentDetailSchema.parse({
      deployment,
      environment,
      versionSet: {
        id: "arcade:1",
        serviceId: "arcade",
        revision: 1,
        baseRevisionId: null,
        components: {},
        createdAt,
      },
      pipeline: {
        id: "pipeline:1",
        definition: { kind: "manual", reason: "Test prerequisite" },
        createdAt,
      },
      stages: [],
      evidence: [],
      approvals: [],
    });
    const client = createDeliveryClient({
      baseUrl: "https://delivery.invalid",
      fetch: async () => Response.json(detail),
    });
    let now = 0;
    const result = await waitForDeployment(client, deployment.id, {
      timeoutMs: 100,
      intervalMs: 40,
      now: () => now,
      sleep: async (duration) => {
        now += duration;
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.result.deployment.status).toBe("queued");
    expect(now).toBe(100);
  });
  test("errors never interpolate a bearer credential", async () => {
    const client = createDeliveryClient({
      baseUrl: "https://delivery.invalid",
      headers: { Authorization: "Bearer test-sensitive-value" },
      fetch: async () =>
        Response.json(
          {
            error: {
              code: "FORBIDDEN",
              message: "Insufficient scope",
              requestId: "r:1",
            },
          },
          { status: 403 },
        ),
    });
    await expect(client.identity()).rejects.toThrow("Insufficient scope");
  });
  test("recovery requires an explicit external operation identity before credential resolution", () => {
    expect(() =>
      validateDeployCommand(
        "recover",
        ["deployment:1"],
        parseDeployArgs([]).values,
      ),
    ).toThrow("admin --machine");
    expect(() =>
      validateDeployCommand(
        "recover",
        ["deployment:1"],
        parseDeployArgs(["--machine"]).values,
      ),
    ).toThrow("--operation-id");
    expect(() =>
      validateDeployCommand(
        "recover",
        ["deployment:1"],
        parseDeployArgs([
          "--machine",
          "--operation-id",
          "not-a-uuid",
          "--reason",
          "Inspected operation directly",
        ]).values,
      ),
    ).toThrow();
  });
  test("recovery forwards the exact inspected operation and audit reason", async () => {
    const operationId = "22222222-2222-4222-8222-222222222222";
    let payload: unknown;
    const client = createDeliveryClient({
      baseUrl: "https://delivery.invalid",
      fetch: async (input, init) => {
        expect(input instanceof Request ? input.url : input.toString()).toBe(
          "https://delivery.invalid/api/v1/deployments/deployment%3A1/release-lock",
        );
        payload = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        return Response.json(deployment);
      },
    });
    const { values, positionals } = parseDeployArgs([
      deployment.id,
      "--machine",
      "--operation-id",
      operationId,
      "--reason",
      "Inspected exact operation directly while Temporal was unavailable",
    ]);
    const result = await runDeployCommand(
      client,
      "recover",
      positionals,
      values,
    );
    expect(result.exitCode).toBe(0);
    expect(payload).toEqual({ operationId, reason: values.reason });
  });
});
