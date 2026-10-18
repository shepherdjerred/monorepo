import { expect, test } from "vitest";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  runDeployCommand,
  validateDeployCommand,
} from "#commands/deploy/deploy.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";

test("Minecraft recovery rejects missing targets, admin authority, generation and reason before credentials", () => {
  for (const [positionals, args, error] of [
    [["recover"], [], "Invalid operands"],
    [["recover", "deployment:failed"], [], "admin --machine"],
    [["recover", "deployment:failed"], ["--machine"], "--expected-generation"],
  ] as const)
    expect(() =>
      validateDeployCommand(
        "minecraft",
        [...positionals],
        parseDeployArgs([...args]).values,
      ),
    ).toThrow(error);
  expect(() =>
    validateDeployCommand(
      "minecraft",
      ["recover", "deployment:failed"],
      parseDeployArgs([
        "--machine",
        "--expected-generation",
        "-1",
        "--reason",
        "Inspect original source before selecting another candidate",
      ]).values,
    ),
  ).toThrow();
});

test("Minecraft recovery forwards only admin intent and reviewed environment generation, never caller observations", async () => {
  const notices: string[] = [];
  let payload: unknown;
  const reason = "Inspect original source before selecting another candidate";
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: async (url, init) => {
      expect(url instanceof Request ? url.url : url.toString()).toBe(
        "https://delivery.invalid/api/v1/deployments/deployment%3Afailed/minecraft-recovery",
      );
      expect(init?.method).toBe("POST");
      payload = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return Response.json({
        id: "recover:original",
        deploymentId: "deployment:failed",
        requestedBy: "admin",
        reason,
        expectedEnvironmentGeneration: 8,
        snapshotFingerprint: "a".repeat(64),
        controllerReceipt: null,
        status: "pending",
        workflowId: "delivery-minecraft-recovery/recover:original",
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
    "recover:original",
    "--expected-generation",
    "8",
    "--reason",
    reason,
  ]).values;
  const result = await runDeployCommand(
    client,
    "minecraft",
    ["recover", "deployment:failed"],
    {
      ...options,
      requestNotice: (id) => {
        notices.push(id);
      },
    },
  );
  expect(result.exitCode).toBe(0);
  expect(result.result).toMatchObject({
    status: "pending",
    controllerReceipt: null,
  });
  expect(payload).toEqual({
    requestId: "recover:original",
    expectedEnvironmentGeneration: 8,
    reason,
  });
  expect(notices).toEqual(["recover:original"]);
});
