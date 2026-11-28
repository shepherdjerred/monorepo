import { describe, expect, test } from "vitest";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  DeploymentDetailSchema,
  DeploymentSchema,
  EnvironmentSchema,
} from "@shepherdjerred/delivery/contract";
import * as fixtures from "@shepherdjerred/delivery/model-fixtures";
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
  declaredConfigurationId: "config:1",
  automatic: true,
  promotionSourceEnvironmentId: null,
  generation: 4,
  role: "durable",
  lifecycle: "active",
  approvalPolicy: "none",
  acceptedDeploymentId: null,
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
  configurationId: "config:1",
  catalogRevision: "test-catalog",
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
const detail = DeploymentDetailSchema.parse({
  deployment,
  environment,
  versionSet: {
    id: "arcade:1",
    serviceId: "arcade",
    revision: 1,
    baseRevisionId: null,
    lineage: "0".repeat(64),
    orderKey: "0000000001.0000000000",
    components: {},
    createdAt,
  },
  pipeline: {
    id: "pipeline:1",
    definition: { kind: "manual", reason: "Test prerequisite" },
    createdAt,
  },
  configuration: { id: "config:1", content: {} },
  stages: [],
  evidence: [],
});

/** A client that records each request and answers from `respond`. */
function recordingClient(respond: (url: string) => unknown) {
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
      return Response.json(respond(url));
    },
  });
  return { client, requests };
}

/** A thunk validating `deploy recover deployment:1` with these arguments. */
function recover(args: string[]) {
  return () =>
    validateDeployCommand(
      "recover",
      ["deployment:1"],
      parseDeployArgs(args).values,
    );
}

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
    const { client, requests } = recordingClient((url) =>
      url.endsWith("selection")
        ? {
            ...fixtures.selections.beta,
            accepted: null,
            acceptedDeploymentId: null,
            bindingGeneration: 4,
          }
        : url.endsWith("/environments/arcade%2Fprod")
          ? fixtures.environmentDetails.beta
          : deployment,
    );
    const { values, positionals } = parseDeployArgs([
      "arcade/prod",
      "arcade:1",
      "--request-id",
      "request:exact",
    ]);
    const result = await runDeployCommand(client, "start", positionals, values);
    expect(result.exitCode).toBe(0);
    expect(requests[2]?.body).toEqual({
      requestId: "request:exact",
      environmentId: "arcade/prod",
      versionSetRevisionId: "arcade:1",
      expectedGeneration: 4,
      kind: "deploy",
    });
    expect(requests[2]?.headers.has("Tailscale-User-Login")).toBe(false);
  });
  test("wait deadline preserves pending status and returns distinct exit code", async () => {
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
});

describe("deploy approvals, list and transient wait retries", () => {
  test("wait retries transient 503 UNAVAILABLE, PAUSED, gateway and network errors within timeout", async () => {
    let attempt = 0;
    const client = createDeliveryClient({
      baseUrl: "https://delivery.invalid",
      fetch: () => {
        attempt++;
        if (attempt === 1) {
          return Promise.resolve(
            Response.json(
              {
                error: {
                  code: "UNAVAILABLE",
                  message:
                    "Operator authorization snapshot is temporarily unavailable",
                  requestId: "r:1",
                },
              },
              { status: 503 },
            ),
          );
        }
        if (attempt === 2) {
          return Promise.reject(new TypeError("fetch failed"));
        }
        if (attempt === 3) {
          return Promise.resolve(new Response("Bad Gateway", { status: 502 }));
        }
        return Promise.resolve(
          Response.json({
            ...detail,
            deployment: { ...detail.deployment, status: "succeeded" },
          }),
        );
      },
    });
    let now = 0;
    const result = await waitForDeployment(client, deployment.id, {
      timeoutMs: 200,
      intervalMs: 40,
      now: () => now,
      sleep: (duration) => {
        now += duration;
        return Promise.resolve();
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.result.deployment.status).toBe("succeeded");
    expect(attempt).toBe(4);
    expect(now).toBe(120);
  });

  test("wait fails immediately on genuine 403 FORBIDDEN without retrying", async () => {
    let calls = 0;
    const client = createDeliveryClient({
      baseUrl: "https://delivery.invalid",
      fetch: () => {
        calls++;
        return Promise.resolve(
          Response.json(
            {
              error: {
                code: "FORBIDDEN",
                message: "Operator identity is not authorized",
                requestId: "r:2",
              },
            },
            { status: 403 },
          ),
        );
      },
    });
    await expect(
      waitForDeployment(client, deployment.id, {
        timeoutMs: 200,
        intervalMs: 40,
      }),
    ).rejects.toThrow("Operator identity is not authorized");
    expect(calls).toBe(1);
  });

  test("approvals and list expose the approvals queue and filtered deployment pages", async () => {
    const page = {
      items: [{ ...deployment, versionSetRevision: 1 }],
      nextCursor: "cursor:2",
    };
    const { client, requests } = recordingClient((url) =>
      url.endsWith("/approvals") ? fixtures.approvalQueue : page,
    );

    const approvalsResult = await runDeployCommand(
      client,
      "approvals",
      [],
      parseDeployArgs([]).values,
    );
    expect(approvalsResult).toEqual({
      result: fixtures.approvalQueue,
      exitCode: 0,
    });

    const positionalArgs = parseDeployArgs([
      "scout-for-lol/prod",
      "--status",
      "awaiting_approval",
      "--cursor",
      "cursor:1",
    ]);
    const listResult = await runDeployCommand(
      client,
      "list",
      positionalArgs.positionals,
      positionalArgs.values,
    );
    expect(listResult).toEqual({ result: page, exitCode: 0 });

    const flagArgs = parseDeployArgs([
      "--environment",
      "arcade/prod",
      "--service",
      "arcade",
    ]);
    await runDeployCommand(
      client,
      "list",
      flagArgs.positionals,
      flagArgs.values,
    );

    expect(requests.map((entry) => entry.url)).toEqual([
      "https://delivery.invalid/api/v1/approvals",
      "https://delivery.invalid/api/v1/deployments?cursor=cursor%3A1&environmentId=scout-for-lol%2Fprod&status=awaiting_approval",
      "https://delivery.invalid/api/v1/deployments?serviceId=arcade&environmentId=arcade%2Fprod",
    ]);

    expect(() =>
      validateDeployCommand(
        "list",
        ["arcade/prod"],
        parseDeployArgs(["--environment", "arcade/prod"]).values,
      ),
    ).toThrow("either a positional ENVIRONMENT or --environment");
    expect(() =>
      validateDeployCommand(
        "status",
        [],
        parseDeployArgs(["--environment", "arcade/prod"]).values,
      ),
    ).toThrow("apply to deploy list");
    expect(() =>
      validateDeployCommand(
        "list",
        [],
        parseDeployArgs(["--status", "invalid"]).values,
      ),
    ).toThrow();
  });
});

describe("deploy recover (4.15)", () => {
  test("a recovery intent names the generation and reason before credential resolution", () => {
    expect(recover([])).toThrow("--machine");
    expect(recover(["--machine"])).toThrow("--expected-generation");
    expect(
      recover([
        "--machine",
        "--expected-generation",
        "11",
        "--reason",
        "short",
      ]),
    ).toThrow();
    expect(
      recover([
        "--machine",
        "--expected-generation",
        "11",
        "--reason",
        "Inspected exact operation directly while Temporal was unavailable",
        "--operation-id",
        "not-a-uuid",
      ]),
    ).toThrow();
  });
  test("recover --operation-id opens the intent, then settles it with the exact inspected operation", async () => {
    const operationId = "22222222-2222-4222-8222-222222222222";
    const { client, requests } = recordingClient((url) =>
      url.endsWith("/settle") ? deployment : fixtures.recoveryIntents.pending,
    );
    const { values, positionals } = parseDeployArgs([
      deployment.id,
      "--machine",
      "--expected-generation",
      "11",
      "--operation-id",
      operationId,
      "--request-id",
      "recovery/1",
      "--reason",
      "Inspected exact operation directly while Temporal was unavailable",
    ]);
    const result = await runDeployCommand(
      client,
      "recover",
      positionals,
      values,
    );
    expect(result).toEqual({ result: deployment, exitCode: 0 });
    expect(requests.map((request) => request.url)).toEqual([
      `https://delivery.invalid/api/v1/deployments/${encodeURIComponent(deployment.id)}/recovery-intents`,
      `https://delivery.invalid/api/v1/recovery-intents/${encodeURIComponent(fixtures.recoveryIntents.pending.id)}/settle`,
    ]);
    // Settling reads back an Argo operation; any other kind opens nothing.
    expect(requests[0]?.body).toMatchObject({ expectedKind: "argo" });
    expect(requests[1]?.body).toEqual({ operationId, reason: values.reason });
  });
  test("recover creates one recovery intent for the named sub-step", async () => {
    let payload: unknown;
    const client = createDeliveryClient({
      baseUrl: "https://delivery.invalid",
      fetch: async (input, init) => {
        expect(input instanceof Request ? input.url : input.toString()).toBe(
          "https://delivery.invalid/api/v1/deployments/scout-prod-37/recovery-intents",
        );
        payload = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        return Response.json(fixtures.recoveryIntents.pending);
      },
    });
    const { values, positionals } = parseDeployArgs([
      "scout-prod-37",
      "--machine",
      "--expected-generation",
      "11",
      "--step",
      "sync",
      "--request-id",
      "request/recovery",
      "--reason",
      "Re-read the sync operation now that ArgoCD finished operation 7",
    ]);
    const result = await runDeployCommand(
      client,
      "recover",
      positionals,
      values,
    );
    expect(result).toEqual({
      result: fixtures.recoveryIntents.pending,
      exitCode: 0,
    });
    expect(payload).toEqual({
      requestId: "request/recovery",
      reason: values.reason,
      expectedGeneration: 11,
      step: "sync",
    });
  });
});
