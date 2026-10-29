import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import * as fixtures from "@shepherdjerred/delivery/model-fixtures";
import {
  runDeployCommand,
  validateDeployCommand,
} from "#commands/deploy/deploy.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";
import { deployMachineCredential } from "#commands/deploy/forum.ts";
import {
  CatalogDocumentSchema,
  catalogRevision,
} from "@shepherdjerred/delivery/model-contract";
import { loadCatalogDocument } from "@shepherdjerred/ops-model/delivery-catalog/files.ts";

type Sent = { method: string; path: string; body: unknown };

/** A Delivery client answering each `METHOD path` from a fixture table. */
function delivery(answers: Record<string, unknown>) {
  const sent: Sent[] = [];
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const method = init?.method ?? "GET";
      const route = `${method} ${url.pathname.slice("/api/v1".length)}`;
      sent.push({
        method,
        path: route.slice(method.length + 1),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return Promise.resolve(
        route in answers
          ? Response.json(answers[route])
          : Response.json(
              { error: { code: "NOT_FOUND", message: route, requestId: "r" } },
              { status: 404 },
            ),
      );
    },
  });
  return { client, sent };
}

async function run(
  client: ReturnType<typeof delivery>["client"],
  command: string,
  args: string[],
) {
  const { values, positionals } = parseDeployArgs(args);
  return runDeployCommand(client, command, positionals, values);
}

const prod = encodeURIComponent(fixtures.PROD);
const environmentReads = {
  [`GET /environments/${prod}/selection`]: fixtures.selections.prod,
  [`GET /environments/${prod}/rollback-candidates`]:
    fixtures.rollbackCandidates.prod,
};

let directory = "";
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "deploy-model-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("model verbs refuse incomplete requests before credentials", () => {
  test.each([
    ["rebind", [fixtures.PROD], [], "--recipe, --configuration"],
    ["approve-plan", ["tofu-cloudflare-prod-7"], [], "--reason"],
    [
      "approve-plan",
      ["tofu-cloudflare-prod-7"],
      ["--machine", "--reason", "Reviewed"],
      "trusted human identity",
    ],
    ["approve-plan", [], ["--reason", "Reviewed"], "Invalid operands"],
    [
      "reject-plan",
      ["tofu-cloudflare-prod-7"],
      ["--machine", "--reason", "Unsafe"],
      "trusted human identity",
    ],
    ["retire", ["webring-legacy"], ["--reason", "Replaced"], "--machine"],
    ["retire", ["webring-legacy"], ["--machine"], "--reason"],
    ["catalog", ["apply"], ["--machine"], "deploy catalog reconcile"],
    ["catalog", ["reconcile"], ["--file", "catalog.json"], "--machine"],
    ["promote", [fixtures.BETA, fixtures.PROD], ["--override"], "--override"],
    [
      "attest",
      ["deployment-1"],
      ["--machine", "--evidence", "e.json"],
      "--stage",
    ],
    [
      "attest",
      ["deployment-1"],
      ["--machine", "--stage", "canary"],
      "--evidence",
    ],
    ["recover", ["scout-prod-37"], ["--machine"], "--expected-generation"],
    ["rollback", [fixtures.PROD], [], "Invalid operands"],
    ["monitor", [], [], "Invalid operands"],
  ])("deploy %s %j %j", (command, positionals, args, message) => {
    expect(() =>
      validateDeployCommand(command, positionals, parseDeployArgs(args).values),
    ).toThrow(message);
  });

  test("attestation uses the attestor credential the executor never holds; admin verbs use the admin one", () => {
    expect(deployMachineCredential("attest", ["deployment-1"])).toBe(
      "DELIVERY_ATTEST_TOKEN",
    );
    for (const command of ["retire", "catalog"])
      expect(deployMachineCredential(command, [])).toBe("DELIVERY_API_TOKEN");
  });
});

describe("rollback and rebind", () => {
  test("rollback names the deployment whose selection it restores", async () => {
    const { client, sent } = delivery({
      ...environmentReads,
      "POST /deployments": fixtures.deployments.rollback43,
    });
    const result = await run(client, "rollback", [
      fixtures.PROD,
      "scout-prod-41",
      "--request-id",
      "request/rollback",
    ]);
    expect(result).toEqual({
      result: fixtures.deployments.rollback43,
      exitCode: 0,
    });
    expect(sent.at(-1)).toEqual({
      method: "POST",
      path: "/deployments",
      body: {
        requestId: "request/rollback",
        environmentId: fixtures.PROD,
        expectedGeneration: 12,
        kind: "rollback",
        selectionDeploymentId: "scout-prod-41",
      },
    });
  });

  test("rollback refuses an excluded or unknown selection with the server's reason", async () => {
    const { client, sent } = delivery(environmentReads);
    await expect(
      run(client, "rollback", [fixtures.PROD, "scout-prod-38"]),
    ).rejects.toThrow("Step migrate-schema is a point of no return");
    await expect(
      run(client, "rollback", [fixtures.PROD, "scout-prod-12"]),
    ).rejects.toThrow("not a previously accepted selection");
    expect(sent.every((request) => request.method === "GET")).toBe(true);
  });

  test("rebind keeps the set revision and sends only the named coordinates", async () => {
    const { client, sent } = delivery({
      ...environmentReads,
      "POST /deployments": {
        ...fixtures.deployments.rollback43,
        kind: "rebind",
      },
    });
    await run(client, "rebind", [
      fixtures.PROD,
      "--configuration",
      "scout-prod-config/8",
      "--expected-generation",
      "12",
      "--request-id",
      "request/rebind",
    ]);
    expect(sent.at(-1)).toEqual({
      method: "POST",
      path: "/deployments",
      body: {
        requestId: "request/rebind",
        environmentId: fixtures.PROD,
        expectedGeneration: 12,
        kind: "rebind",
        configurationRevisionId: "scout-prod-config/8",
      },
    });
  });
});

describe("reads", () => {
  test.each([
    ["candidates", "rollback-candidates", fixtures.rollbackCandidates.prod],
    ["monitor", "monitor", fixtures.monitors.prod],
  ])("deploy %s reads the environment's %s", async (command, route, answer) => {
    const { client } = delivery({
      [`GET /environments/${prod}/${route}`]: answer,
    });
    expect(await run(client, command, [fixtures.PROD])).toEqual({
      result: answer,
      exitCode: 0,
    });
  });
});

describe("admin and operator verbs", () => {
  test("retire records the reason under an idempotent request", async () => {
    const { client, sent } = delivery({
      "POST /services/webring-legacy/retire": fixtures.retiredService,
    });
    const result = await run(client, "retire", [
      "webring-legacy",
      "--machine",
      "--reason",
      "Replaced by the webring channel",
      "--request-id",
      "request/retire",
    ]);
    expect(result.exitCode).toBe(0);
    expect(sent[0]?.body).toEqual({
      requestId: "request/retire",
      reason: "Replaced by the webring channel",
    });
  });

  test("catalog reconcile posts the parsed document and fails on a refusal", async () => {
    const file = path.join(directory, "catalog-document.json");
    await Bun.write(file, JSON.stringify(await fixtures.catalogDocument()));
    const args = ["reconcile", "--machine", "--file", file];
    const accepted = delivery({
      "POST /catalog/reconcile": fixtures.catalog.reconcile,
    });
    expect(await run(accepted.client, "catalog", args)).toEqual({
      result: fixtures.catalog.reconcile,
      exitCode: 0,
    });
    expect(accepted.sent[0]?.body).toMatchObject({
      services: expect.any(Array),
      environments: expect.any(Array),
    });
    const refused = delivery({
      "POST /catalog/reconcile": {
        ...fixtures.catalog.reconcile,
        refused: [{ id: "arcade/3", reason: "Recipe revisions are immutable" }],
      },
    });
    const refusal = await run(refused.client, "catalog", args);
    expect(refusal.exitCode).toBe(1);
  });

  test("catalog reconcile without --file sends the committed catalog and announces its revision", async () => {
    const committed = CatalogDocumentSchema.parse(await loadCatalogDocument());
    const { client, sent } = delivery({
      "POST /catalog/reconcile": fixtures.catalog.reconcile,
    });
    const notices: string[] = [];
    const { values, positionals } = parseDeployArgs(["reconcile", "--machine"]);
    const result = await runDeployCommand(client, "catalog", positionals, {
      ...values,
      catalogNotice: (revision) => notices.push(revision),
    });
    expect(result.exitCode).toBe(0);
    expect(notices).toEqual([await catalogRevision(committed)]);
    expect(sent.map((request) => request.path)).toEqual(["/catalog/reconcile"]);
    expect(
      await catalogRevision(CatalogDocumentSchema.parse(sent[0]?.body)),
    ).toBe(notices[0]);
  });

  test("attest sends the stage and every evidence entry of the file", async () => {
    const file = path.join(directory, "evidence.json");
    const evidence = [
      { kind: "attestation", summary: "Admission canary pod and claim bound" },
    ];
    await Bun.write(file, JSON.stringify(evidence));
    const { client, sent } = delivery({
      "POST /deployments/cluster-admission-prod-3/attestations":
        fixtures.attestedStage,
    });
    const result = await run(client, "attest", [
      "cluster-admission-prod-3",
      "--machine",
      "--stage",
      "canary",
      "--evidence",
      file,
    ]);
    expect(result).toEqual({ result: fixtures.attestedStage, exitCode: 0 });
    expect(sent[0]?.body).toEqual({ stage: "canary", evidence });
  });
});

describe("start, promote and recovery reads", () => {
  test("start realises the kind the server reports for the recipe it freezes", async () => {
    for (const kind of ["deploy", "operator-run", "channel-publish"] as const) {
      const { client, sent } = delivery({
        [`GET /environments/${prod}/selection`]: fixtures.selections.prod,
        [`GET /environments/${prod}`]: {
          ...fixtures.environmentDetails.prod,
          releaseKind: kind,
        },
        "POST /deployments": fixtures.deployments.rollback43,
      });
      await run(client, "start", [
        fixtures.PROD,
        "scout-for-lol:r42",
        "--request-id",
        "request/start",
      ]);
      expect(sent.at(-1)?.body).toEqual({
        requestId: "request/start",
        environmentId: fixtures.PROD,
        expectedGeneration: 12,
        kind,
        versionSetRevisionId: "scout-for-lol:r42",
      });
    }
  });

  test("before the first acceptance, a v1 manual pipeline is deployed, not run by its normalised kind", async () => {
    // The view normalises a declared manual pipeline to an operator-run
    // recipe; admission reads the stored kind and accepts only a deploy,
    // which is what the server reports.
    expect(fixtures.environmentDetails.prod.pipeline.definition.kind).toBe(
      "manual",
    );
    const { client, sent } = delivery({
      [`GET /environments/${prod}/selection`]: {
        ...fixtures.selections.prod,
        accepted: null,
        acceptedDeploymentId: null,
        declared: {
          ...fixtures.selections.prod.declared,
          recipeKind: "operator-run",
        },
      },
      [`GET /environments/${prod}`]: fixtures.environmentDetails.prod,
      "POST /deployments": fixtures.deployments.rollback43,
    });
    await run(client, "start", [
      fixtures.PROD,
      "scout-for-lol:r42",
      "--request-id",
      "request/start",
    ]);
    expect(sent.at(-1)?.body).toMatchObject({ kind: "deploy" });
  });

  test("promote takes the source's accepted selection without naming a set revision", async () => {
    const { client, sent } = delivery({
      [`GET /environments/${prod}/selection`]: fixtures.selections.prod,
      [`GET /environments/${encodeURIComponent(fixtures.BETA)}/selection`]:
        fixtures.selections.beta,
      "POST /deployments": fixtures.deployments.pending44,
    });
    await run(client, "promote", [
      fixtures.BETA,
      fixtures.PROD,
      "--request-id",
      "request/promote",
    ]);
    expect(sent.at(-1)?.body).toEqual({
      requestId: "request/promote",
      environmentId: fixtures.PROD,
      expectedGeneration: 12,
      kind: "promote",
      sourceEnvironmentId: fixtures.BETA,
    });
  });

  test("recovery reads one unified intent", async () => {
    const intent = fixtures.recoveryIntents.failed;
    const { client } = delivery({
      [`GET /recovery-intents/${encodeURIComponent(intent.id)}`]: intent,
    });
    expect(await run(client, "recovery", [intent.id])).toEqual({
      result: intent,
      exitCode: 0,
    });
  });
});

describe("plan approval", () => {
  test("approve-plan approves the deployment's own saved plan by its digest", async () => {
    const { client, sent } = delivery({
      "GET /deployments/tofu-cloudflare-prod-7": fixtures.planWaiting,
      "POST /deployments/tofu-cloudflare-prod-7/plan-approval":
        fixtures.attestedStage,
    });
    const result = await run(client, "approve-plan", [
      "tofu-cloudflare-prod-7",
      "--reason",
      "  Two DNS records and one tunnel route, reviewed  ",
    ]);
    expect(result).toEqual({ result: fixtures.attestedStage, exitCode: 0 });
    expect(sent.at(-1)).toEqual({
      method: "POST",
      path: "/deployments/tofu-cloudflare-prod-7/plan-approval",
      body: {
        decision: "approved",
        planDigest: fixtures.savedPlan.planDigest,
        reason: "Two DNS records and one tunnel route, reviewed",
      },
    });
  });

  test("reject-plan rejects that same saved plan by its digest", async () => {
    const { client, sent } = delivery({
      "GET /deployments/tofu-cloudflare-prod-7": fixtures.planWaiting,
      "POST /deployments/tofu-cloudflare-prod-7/plan-approval":
        fixtures.attestedStage,
    });
    await run(client, "reject-plan", [
      "tofu-cloudflare-prod-7",
      "--reason",
      "Deletes the apex record",
    ]);
    expect(sent.at(-1)?.body).toEqual({
      decision: "rejected",
      planDigest: fixtures.savedPlan.planDigest,
      reason: "Deletes the apex record",
    });
  });

  test("a repeated reject-plan after a lost response names the digest the decision bound", async () => {
    const [planned] = fixtures.planWaiting.stages;
    if (planned === undefined) throw new Error("The fixture has a plan stage");
    // The rejection committed: the saved plan is gone and the approve step settled.
    const rejected = {
      ...fixtures.planWaiting,
      savedPlan: null,
      stages: [
        ...fixtures.planWaiting.stages,
        {
          ...planned,
          id: "stage-approve-plan",
          key: "approve/plan",
          status: "failed",
          operationId: fixtures.savedPlan.planDigest,
          message: "Rejected by operator",
        },
      ],
    };
    const { client, sent } = delivery({
      "GET /deployments/tofu-cloudflare-prod-7": rejected,
      "POST /deployments/tofu-cloudflare-prod-7/plan-approval":
        fixtures.attestedStage,
    });
    await run(client, "reject-plan", [
      "tofu-cloudflare-prod-7",
      "--reason",
      "Deletes the apex record",
    ]);
    expect(sent.at(-1)?.body).toEqual({
      decision: "rejected",
      planDigest: fixtures.savedPlan.planDigest,
      reason: "Deletes the apex record",
    });
  });

  test("approve-plan refuses a deployment with no saved plan before sending", async () => {
    const { client, sent } = delivery({
      "GET /deployments/scout-prod-43": fixtures.deploymentDetails[0],
    });
    await expect(
      run(client, "approve-plan", ["scout-prod-43", "--reason", "Reviewed"]),
    ).rejects.toThrow("has no saved plan to decide");
    expect(sent.every((request) => request.method === "GET")).toBe(true);
  });
});

describe("override approvals", () => {
  test("start --override asks for the approval a non-eligible deploy needs", async () => {
    const { client, sent } = delivery({
      [`GET /environments/${prod}/selection`]: fixtures.selections.prod,
      [`GET /environments/${prod}`]: fixtures.environmentDetails.prod,
      "POST /deployments": fixtures.deployments.override45,
    });
    await run(client, "start", [
      fixtures.PROD,
      "scout-for-lol:r40",
      "--override",
      "--request-id",
      "request/override",
    ]);
    expect(sent.at(-1)?.body).toMatchObject({ kind: "deploy", override: true });
    const operated = delivery({
      [`GET /environments/${prod}/selection`]: fixtures.selections.prod,
      [`GET /environments/${prod}`]: {
        ...fixtures.environmentDetails.prod,
        releaseKind: "operator-run",
      },
    });
    await expect(
      run(operated.client, "start", [
        fixtures.PROD,
        "scout-for-lol:r40",
        "--override",
      ]),
    ).rejects.toThrow("Only a deploy takes an override");
  });

  test("approve --override decides the override approval", async () => {
    const { client, sent } = delivery({
      "POST /deployments/scout-prod-45/approval": fixtures.approvals.override,
    });
    await run(client, "approve", [
      "scout-prod-45",
      "--override",
      "--reason",
      "Reviewed the ineligible set revision",
    ]);
    expect(sent[0]?.body).toEqual({
      decision: "approve",
      reason: "Reviewed the ineligible set revision",
      override: true,
    });
  });
});
