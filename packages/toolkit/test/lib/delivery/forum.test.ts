import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import { deployMachineCredential } from "#commands/deploy/forum.ts";
import {
  runDeployCommand,
  validateDeployCommand,
} from "#commands/deploy/deploy.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";

test("forum publication uses the publisher capability, baseline uses admin, and malformed commands fail before credentials", () => {
  expect(deployMachineCredential("forum", ["publish"])).toBe(
    "DELIVERY_PUBLISHER_TOKEN",
  );
  expect(deployMachineCredential("forum", ["baseline"])).toBe(
    "DELIVERY_API_TOKEN",
  );
  for (const [operands, args] of [
    [["publish"], []],
    [["baseline"], ["--file", "baseline.json"]],
    [["inspect"], []],
  ] as const)
    expect(() =>
      validateDeployCommand(
        "forum",
        [...operands],
        parseDeployArgs([...args]).values,
      ),
    ).toThrow();
});
test("baseline forwards only reviewed admin intent and preserves native proof as server-owned", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "forum-command-"));
  try {
    const file = path.join(directory, "baseline.json"),
      input = {
        requestId: "forum/original",
        environmentId: "storm-forum/prod",
        expectedEnvironmentGeneration: 7,
        imageArtifactId: "original-image",
        bundleArtifactId: "original-bundle",
        reason: "Independently observe the exact installed original forum",
      };
    await Bun.write(file, JSON.stringify(input));
    const client = createDeliveryClient({
      baseUrl: "https://delivery.invalid",
      fetch: async (url, init) => {
        expect(url instanceof Request ? url.url : url.toString()).toBe(
          "https://delivery.invalid/api/v1/forum/baselines",
        );
        expect(
          typeof init?.body === "string" ? JSON.parse(init.body) : null,
        ).toEqual(input);
        return Response.json({
          id: input.requestId,
          ...input,
          requestedBy: "operator",
          pipelineRevisionId: "storm-forum/1",
          configurationRevision: "storm-forum/1",
          snapshotFingerprint: "a".repeat(64),
          status: "pending",
          workflowId: `delivery-forum-baseline/${input.requestId}`,
          submittedAt: null,
          proof: null,
          message: null,
          createdAt: new Date().toISOString(),
          finishedAt: null,
        });
      },
    });
    const result = await runDeployCommand(
      client,
      "forum",
      ["baseline"],
      parseDeployArgs(["--machine", "--file", file]).values,
    );
    expect(result.exitCode).toBe(0);
    expect(result.result).toMatchObject({ status: "pending", proof: null });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
