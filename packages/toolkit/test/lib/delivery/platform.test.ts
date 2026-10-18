import { expect, test } from "vitest";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  DeploymentSchema,
  PlatformRecoveryIntentSchema,
} from "@shepherdjerred/delivery/contract";
import {
  validateDeployCommand,
  runDeployCommand,
} from "#commands/deploy/deploy.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";

test("platform requests require explicit file input before credential resolution", () => {
  expect(() =>
    validateDeployCommand("platform", ["request"], parseDeployArgs([]).values),
  ).toThrow("explicit --file");
  expect(() =>
    validateDeployCommand(
      "platform",
      ["apply", "latest"],
      parseDeployArgs(["--machine"]).values,
    ),
  ).toThrow("Invalid operands");
});

test("infrastructure recovery and controller commands reject missing admin boundaries before resolving credentials", () => {
  expect(() =>
    validateDeployCommand(
      "platform",
      ["control-plane"],
      parseDeployArgs(["--file", "reviewed.json"]).values,
    ),
  ).toThrow("--machine");
  expect(() =>
    validateDeployCommand(
      "platform",
      ["recover", "failed"],
      parseDeployArgs([
        "--machine",
        "--reason",
        "Inspect the exact original state independently",
      ]).values,
    ),
  ).toThrow();
  expect(() =>
    validateDeployCommand(
      "platform",
      ["recovery-approve", "intent"],
      parseDeployArgs([
        "--machine",
        "--plan-fingerprint",
        "a".repeat(64),
        "--decision",
        "approved",
        "--reason",
        "Review exact plan",
      ]).values,
    ),
  ).toThrow("human identity");
  expect(() =>
    validateDeployCommand(
      "platform",
      ["recovery-approve", "intent"],
      parseDeployArgs([
        "--plan-fingerprint",
        "a".repeat(64),
        "--decision",
        "approved",
        "--reason",
        "Review exact plan",
      ]).values,
    ),
  ).not.toThrow();
});

test("human recovery approval forwards only exact plan fingerprint and decision", async () => {
  const expected = {
    planFingerprint: "a".repeat(64),
    decision: "approved",
    reason: "Review exact saved plan and state",
  };
  let calls = 0;
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: async (url, init) => {
      calls++;
      expect(url instanceof Request ? url.url : url.toString()).toBe(
        "https://delivery.invalid/api/v1/platform-recovery/recovery%2Foriginal/approve",
      );
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify(expected));
      expect(new Headers(init?.headers).get("Origin")).toBe(
        "https://delivery.invalid",
      );
      return Response.json(
        PlatformRecoveryIntentSchema.parse({
          id: "recovery/original",
          deploymentId: "failed-source",
          requestedBy: "admin",
          reason: "Inspect the original independently",
          expectedEnvironmentGeneration: 3,
          snapshotFingerprint: "b".repeat(64),
          status: "pending",
          workflowId: "delivery-platform-recovery/recovery/original",
          submittedAt: null,
          message: null,
          createdAt: new Date().toISOString(),
          finishedAt: null,
        }),
      );
    },
  });
  const options = parseDeployArgs([
    "--plan-fingerprint",
    expected.planFingerprint,
    "--decision",
    expected.decision,
    "--reason",
    expected.reason,
  ]).values;
  const result = await runDeployCommand(
    client,
    "platform",
    ["recovery-approve", "recovery/original"],
    options,
  );
  expect(result.exitCode).toBe(0);
  expect(calls).toBe(1);
});

test("platform request forwards only the reviewed exact saved plan identity and generation", async () => {
  const filePath = `/tmp/delivery-platform-${crypto.randomUUID()}.json`;
  const file = Bun.file(filePath);
  const input = {
    kind: "tofu-apply",
    requestId: "reviewed-apply",
    environmentId: "gitops/tofu:openai",
    expectedGeneration: 8,
    planDeploymentId: "original-saved-plan",
  };
  await file.write(JSON.stringify(input));
  let count = 0;
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: async (url, init) => {
      count++;
      expect(url instanceof Request ? url.url : url.toString()).toBe(
        "https://delivery.invalid/api/v1/platform/deployments",
      );
      expect(init?.method).toBe("POST");
      if (typeof init?.body !== "string")
        throw new TypeError("Expected structured request JSON");
      expect(JSON.parse(init.body)).toEqual(input);
      return Response.json(
        DeploymentSchema.parse({
          ...input,
          id: "platform-apply",
          serviceId: "gitops",
          versionSetRevisionId: "anchor",
          pipelineRevisionId: "reviewed-stack",
          configurationRevision: "reviewed-config",
          configuration: {},
          status: "awaiting_approval",
          requestedBy: "admin",
          message: null,
          cancelRequested: false,
          recoveryRequired: false,
          createdAt: new Date().toISOString(),
          startedAt: null,
          finishedAt: null,
        }),
      );
    },
  });
  try {
    const options = parseDeployArgs(["--machine", "--file", filePath]).values;
    const result = await runDeployCommand(
      client,
      "platform",
      ["request"],
      options,
    );
    expect(result).toMatchObject({
      result: { id: "platform-apply", status: "awaiting_approval" },
      exitCode: 0,
    });
    expect(count).toBe(1);
    await file.write(
      JSON.stringify({ ...input, encryptedPlan: { ciphertext: "forbidden" } }),
    );
    await expect(
      runDeployCommand(client, "platform", ["request"], options),
    ).rejects.toThrow();
    expect(count).toBe(1);
  } finally {
    await file.delete();
  }
});
