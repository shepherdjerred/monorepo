import { expect, test } from "vitest";
import {
  runDeployCommand,
  validateDeployCommand,
} from "#commands/deploy/deploy.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";

const removed =
  /Minecraft recovery was removed. Releases restart the retained volume/u;

test("Minecraft recovery commands are refused before any request", async () => {
  expect(() =>
    validateDeployCommand(
      "minecraft",
      ["recover", "deployment:failed"],
      parseDeployArgs(["--machine", "--reason", "no restore"]).values,
    ),
  ).toThrow(removed);
  const client = createDeliveryClient({
    baseUrl: "https://delivery.invalid",
    fetch: () => {
      throw new Error("recovery must not call delivery");
    },
  });
  await expect(
    runDeployCommand(client, "minecraft", ["recover", "deployment:failed"], {
      ...parseDeployArgs(["--reason", "no restore"]).values,
    }),
  ).rejects.toThrow(removed);
});
