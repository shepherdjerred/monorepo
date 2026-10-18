import { expect, test } from "vitest";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  validateDeployCommand,
  runDeployCommand,
} from "#commands/deploy/deploy.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";

test("fixed TRMNL repair requires explicit admin and generation before credential resolution", () => {
  expect(() =>
    validateDeployCommand(
      "trmnl",
      ["repair", "failed"],
      parseDeployArgs([]).values,
    ),
  ).toThrow("admin --machine");
  expect(() =>
    validateDeployCommand(
      "trmnl",
      ["repair", "failed"],
      parseDeployArgs([
        "--machine",
        "--reason",
        "Repair frozen bundle after source execution has stopped",
      ]).values,
    ),
  ).toThrow();
});
test("TRMNL repair forwards only the failed identity, reason and generation", async () => {
  let received: unknown;
  const client = createDeliveryClient({
    baseUrl: "http://delivery.test",
    fetch: async (url, init) => {
      if (typeof init?.body !== "string")
        throw new TypeError("Expected JSON request body");
      received = {
        url: url instanceof Request ? url.url : url.toString(),
        body: JSON.parse(init.body) as unknown,
      };
      return Response.json(
        {
          error: {
            code: "CONFLICT",
            message: "Exact source lock changed",
            requestId: "repair/http",
          },
        },
        { status: 409 },
      );
    },
  });
  const values = parseDeployArgs([
    "--machine",
    "--request-id",
    "repair/exact",
    "--expected-generation",
    "7",
    "--reason",
    "Repair frozen bundle after source execution has stopped",
  ]).values;
  await expect(
    runDeployCommand(client, "trmnl", ["repair", "failed/original"], values),
  ).rejects.toThrow("Exact source lock changed");
  expect(received).toEqual({
    url: "http://delivery.test/api/v1/deployments/failed%2Foriginal/trmnl-repair",
    body: {
      requestId: "repair/exact",
      expectedEnvironmentGeneration: 7,
      reason: values.reason,
    },
  });
});
