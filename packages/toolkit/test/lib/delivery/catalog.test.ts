import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import {
  runDeployCommand,
  validateDeployCommand,
} from "#commands/deploy/deploy.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";
import { deployMachineCredential } from "#commands/deploy/forum.ts";

test("exact qualification resolves only execute capability and cannot accept caller-provided verdicts", async () => {
  expect(deployMachineCredential("qualify", ["build/1"])).toBe(
    "DELIVERY_EXECUTOR_TOKEN",
  );
  expect(deployMachineCredential("artifact", [])).toBe("DELIVERY_API_TOKEN");
  expect(() =>
    validateDeployCommand("qualify", ["build/1"], parseDeployArgs([]).values),
  ).toThrow("scoped --machine");
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: async (input, init) => {
      expect(input instanceof Request ? input.url : input.toString()).toBe(
        "https://delivery.invalid/api/v1/builds/build%2F1/qualify",
      );
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe("{}");
      return Response.json({ status: "pending" });
    },
  });
  expect(
    await runDeployCommand(
      client,
      "qualify",
      ["build/1"],
      parseDeployArgs(["--machine"]).values,
    ),
  ).toEqual({ result: { status: "pending" }, exitCode: 0 });
});

test("qualified-exact lookup preserves original artifact/build/source identity and propagates missing proof", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "delivery-artifact-command-"),
  );
  try {
    const file = path.join(directory, "query.json");
    const query = {
      serviceId: "temporal",
      component: "image:temporal-worker",
      kind: "image",
      digest: `sha256:${"a".repeat(64)}`,
      version: "2.0.0-42",
      originKind: "first-party",
    };
    await Bun.write(file, JSON.stringify(query));
    const original = ArtifactVersionSchema.parse({
      serviceId: query.serviceId,
      component: query.component,
      kind: query.kind,
      digest: query.digest,
      version: query.version,
      id: "original/image/42",
      uri: "docker.io/shepherdjerred/temporal-worker",
      buildId: "original/build/42",
      sourceRevision: "a".repeat(40),
      createdAt: new Date().toISOString(),
      origin: { kind: "first-party" },
    });
    const options = parseDeployArgs(["--file", file, "--machine"]).values;
    const client = createDeliveryClient({
      baseUrl: "https://delivery.invalid",
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        expect(url.pathname).toBe("/api/v1/artifacts/qualified-exact");
        expect(Object.fromEntries(url.searchParams)).toEqual(query);
        expect(init?.method).toBe("GET");
        return Response.json(original);
      },
    });
    expect(await runDeployCommand(client, "artifact", [], options)).toEqual({
      result: original,
      exitCode: 0,
    });
    const missing = createDeliveryClient({
      baseUrl: "https://delivery.invalid",
      fetch: () =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: "NOT_FOUND",
                message: "No original qualified artifact",
                requestId: "lookup/1",
              },
            },
            { status: 404 },
          ),
        ),
    });
    await expect(
      runDeployCommand(missing, "artifact", [], options),
    ).rejects.toThrow("No original qualified artifact");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
