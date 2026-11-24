import { expect, test } from "vitest";
import { prGateSteps } from "#src/pipeline/lanes/pr-gates.ts";
import { completionStep } from "#src/pipeline/completion.ts";
import { TEST_IMAGES } from "./identity.ts";

test("trusted policy image runs checkout-free completion while PR gates omit codex-review-gate", () => {
  const image = `docker.io/shepherdjerred/woodpecker-config-extension@sha256:${"c".repeat(64)}`;
  const gates = prGateSteps(TEST_IMAGES);
  expect(gates.map((step) => step.key)).toEqual(["pr-dryrun"]);
  expect(
    gates.find((step) => step.key === "codex-review-gate"),
  ).toBeUndefined();
  const [dryRun] = gates;
  if (dryRun === undefined) throw new Error("missing pr-dryrun");
  const complete = completionStep([dryRun], image, "/app");
  expect(complete.image).toBe(image);
  expect(complete.commands[0]).toBe("cd /app");
  expect(complete.skipClone).toBe(true);
});
