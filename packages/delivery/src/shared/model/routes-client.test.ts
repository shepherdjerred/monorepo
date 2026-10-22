import { describe, expect, test } from "vitest";
import * as fixtures from "#testing/model-fixtures.ts";
import { createDeliveryClient, DeliveryClientError } from "#shared/client.ts";
import { CatalogDocumentSchema } from "./catalog-contract.ts";

type Sent = { method: string; url: string; body: unknown };

function client(response: unknown, status = 200) {
  const sent: Sent[] = [];
  const delivery = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: (input, init) => {
      sent.push({
        method: init?.method ?? "GET",
        url: input instanceof Request ? input.url : input.toString(),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return Promise.resolve(Response.json(response, { status }));
    },
  });
  return { delivery, sent };
}

const api = "https://delivery.invalid/api/v1";
const prod = encodeURIComponent(fixtures.PROD);
const rollback = {
  requestId: "request/rollback",
  environmentId: fixtures.PROD,
  expectedGeneration: 12,
  kind: "rollback" as const,
  selectionDeploymentId: "scout-prod-41",
};
const evidence = [{ kind: "attestation" as const, summary: "Canary passed" }];

type Route = [
  name: string,
  call: (delivery: ReturnType<typeof client>["delivery"]) => Promise<unknown>,
  path: string,
  body: unknown,
  response: unknown,
];
const table: Route[] = [
  [
    "createDeployment",
    (delivery) => delivery.createDeployment(rollback),
    "/deployments",
    rollback,
    fixtures.deployments.rollback43,
  ],
  [
    "rollbackCandidates",
    (delivery) => delivery.rollbackCandidates(fixtures.PROD),
    `/environments/${prod}/rollback-candidates`,
    null,
    fixtures.rollbackCandidates.prod,
  ],
  [
    "monitor",
    (delivery) => delivery.monitor(fixtures.PROD),
    `/environments/${prod}/monitor`,
    null,
    fixtures.monitors.prod,
  ],
  [
    "selection",
    (delivery) => delivery.selection(fixtures.PROD),
    `/environments/${prod}/selection`,
    null,
    fixtures.selections.prod,
  ],
  [
    "watchingMonitors",
    (delivery) => delivery.watchingMonitors(),
    "/monitors/watching",
    null,
    fixtures.watching,
  ],
  [
    "observeMonitor",
    (delivery) =>
      delivery.observeMonitor("scout-beta-17", {
        observedAt: fixtures.observation.observedAt,
        window: "6m",
        evidence: fixtures.observation.evidence,
      }),
    "/deployments/scout-beta-17/monitor/observations",
    {
      observedAt: fixtures.observation.observedAt,
      window: "6m",
      evidence: fixtures.observation.evidence,
    },
    fixtures.observation,
  ],
  [
    "approve",
    (delivery) =>
      delivery.approve("scout-prod-45", {
        decision: "approve",
        reason: "Reviewed the non-eligible set revision",
        override: true,
      }),
    "/deployments/scout-prod-45/approval",
    {
      decision: "approve",
      reason: "Reviewed the non-eligible set revision",
      override: true,
    },
    {
      ...fixtures.approvals.override,
      status: "granted",
      actor: fixtures.operator.id,
      reason: "Reviewed the non-eligible set revision",
      decidedAt: fixtures.approvals.override.createdAt,
    },
  ],
  [
    "createRecoveryIntent",
    (delivery) =>
      delivery.createRecoveryIntent("scout-prod-37", {
        requestId: "request/recovery",
        reason: "Re-read the sync operation now that ArgoCD finished",
        expectedGeneration: 11,
        step: "sync",
      }),
    "/deployments/scout-prod-37/recovery-intents",
    {
      requestId: "request/recovery",
      reason: "Re-read the sync operation now that ArgoCD finished",
      expectedGeneration: 11,
      step: "sync",
    },
    fixtures.recoveryIntents.pending,
  ],
  [
    "recoveryIntent",
    (delivery) => delivery.recoveryIntent(fixtures.recoveryIntents.pending.id),
    `/recovery-intents/${encodeURIComponent(fixtures.recoveryIntents.pending.id)}`,
    null,
    fixtures.recoveryIntents.pending,
  ],
  [
    "approvePlan",
    (delivery) =>
      delivery.approvePlan("tofu-cloudflare-prod-7", {
        planDigest: fixtures.savedPlan.planDigest,
        reason: "Two DNS records and one tunnel route, reviewed",
      }),
    "/deployments/tofu-cloudflare-prod-7/plan-approval",
    {
      planDigest: fixtures.savedPlan.planDigest,
      reason: "Two DNS records and one tunnel route, reviewed",
    },
    fixtures.attestedStage,
  ],
  [
    "attest",
    (delivery) =>
      delivery.attest("cluster-admission-prod-3", {
        stage: "canary",
        evidence,
      }),
    "/deployments/cluster-admission-prod-3/attestations",
    { stage: "canary", evidence },
    fixtures.attestedStage,
  ],
  [
    "catalog",
    (delivery) => delivery.catalog(),
    "/catalog",
    null,
    fixtures.catalog.state,
  ],
  [
    "retireService",
    (delivery) =>
      delivery.retireService("webring-legacy", {
        requestId: "request/retire",
        reason: "Replaced by the webring channel",
      }),
    "/services/webring-legacy/retire",
    { requestId: "request/retire", reason: "Replaced by the webring channel" },
    fixtures.retiredService,
  ],
  [
    "reconcileAfterRestore",
    (delivery) =>
      delivery.reconcileAfterRestore({ requestId: "request/restore" }),
    "/reconcile-after-restore",
    { requestId: "request/restore" },
    fixtures.restoreComparison,
  ],
];

describe("model routes", () => {
  test.each(
    table.map(([name, call, path, body, response]) => ({
      name,
      call,
      path,
      body,
      response,
    })),
  )(
    "$name sends its exact request and validates the response",
    async (route) => {
      const { delivery, sent } = client(route.response);
      await expect(route.call(delivery)).resolves.toEqual(route.response);
      expect(sent).toEqual([
        {
          method: route.body === null ? "GET" : "POST",
          url: `${api}${route.path}`,
          body: route.body,
        },
      ]);
    },
  );

  test("reconcileCatalog posts the validated catalog document", async () => {
    const document = await fixtures.catalogDocument();
    const { delivery, sent } = client(fixtures.catalog.reconcile);
    await expect(delivery.reconcileCatalog(document)).resolves.toEqual(
      fixtures.catalog.reconcile,
    );
    expect(sent[0]?.url).toBe(`${api}/catalog/reconcile`);
    expect(sent[0]?.body).toEqual(
      structuredClone(CatalogDocumentSchema.parse(document)),
    );
  });

  test("the deployment detail carries selection, previous and restored deployments", async () => {
    const detail = fixtures.deploymentDetails[0];
    const { delivery } = client(detail);
    const read = await delivery.deployment("scout-prod-43");
    expect(read.deployment.selection?.versionSetRevisionId).toBe(
      "scout-for-lol:r41",
    );
    expect(read.deployment.previousAcceptedDeploymentId).toBe("scout-prod-42");
    expect(read.deployment.restoredDeploymentId).toBe("scout-prod-41");
    expect(read.approval?.status).toBe("granted");
  });

  test("refuses a malformed request before it reaches the network", () => {
    const { delivery, sent } = client(fixtures.deployments.rollback43);
    expect(() =>
      delivery.createDeployment({
        ...rollback,
        selectionDeploymentId: undefined,
      }),
    ).toThrow("rollback names the deployment whose selection it restores");
    expect(() =>
      delivery.createDeployment({
        requestId: "request/rebind",
        environmentId: fixtures.PROD,
        expectedGeneration: 12,
        kind: "rebind",
      }),
    ).toThrow("rebind names at least one");
    expect(() =>
      delivery.attest("cluster-admission-prod-3", {
        stage: "canary",
        evidence: [],
      }),
    ).toThrow();
    expect(sent).toEqual([]);
  });

  test("rejects a response that breaks the contract", async () => {
    const { monitor: _declared, ...status } = fixtures.monitors.prod;
    await expect(
      client(status).delivery.monitor(fixtures.PROD),
    ).rejects.toThrow();
    const ineligible = fixtures.rollbackCandidates.prod.candidates[2];
    await expect(
      client({
        candidates: [{ ...ineligible, reason: null }],
      }).delivery.rollbackCandidates(fixtures.PROD),
    ).rejects.toThrow("An excluded rollback candidate states its reason");
  });

  test("surfaces the server's refusal with its code", async () => {
    const { delivery } = client(
      {
        error: {
          code: "CONFLICT",
          message: "Expected generation 12, found 13",
          requestId: "r:1",
        },
      },
      409,
    );
    const failure = delivery.createDeployment(rollback);
    await expect(failure).rejects.toBeInstanceOf(DeliveryClientError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });
});
