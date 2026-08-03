import { expect, test } from "bun:test";
import { resolveControllerCommit } from "@shepherdjerred/pr-fleet-controller/src/controller-metadata.ts";

test("records the controller source revision independently of the managed checkout", async () => {
  const controllerCommit = await resolveControllerCommit();
  expect(controllerCommit).toMatch(/^[0-9a-f]{40}$/);
});
