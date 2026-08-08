import { expect, test } from "bun:test";
import { buildPrState } from "@shepherdjerred/pr-fleet-controller/src/fleet-logic.ts";
import { FleetStore } from "@shepherdjerred/pr-fleet-controller/src/state.ts";
import { releaseSetupResources } from "@shepherdjerred/pr-fleet-controller/src/worker-setup-tool.ts";
import { evidence, identity } from "./fixtures.ts";

function setupState() {
  const pr = identity(76);
  return buildPrState(
    { identity: pr, evidence: evidence(pr), stackId: "pr-76" },
    {
      previous: undefined,
      pausedReason: undefined,
      model: "openai/gpt-5.6-terra",
    },
  ).state;
}

test("scratch cleanup failure cannot leak setup or heavy leases", async () => {
  const pr = setupState();
  const store = new FleetStore(1);
  store.requestLease(pr, "setup");
  store.requestLease(pr, "heavy");
  const cleanupError = new Error("scratch volume unavailable");

  await expect(
    releaseSetupResources({
      store,
      pr,
      miseScratchDirectory: "/tmp/pr-fleet-mise-test",
      setupFailed: false,
      removeScratchDirectory: () => Promise.reject(cleanupError),
    }),
  ).rejects.toBe(cleanupError);

  expect(store.setupOwner).toBeNull();
  expect(store.heavyOwners.has(pr.identity.number)).toBe(false);
});

test("scratch cleanup failure does not mask the setup failure", async () => {
  const pr = setupState();
  const store = new FleetStore(1);
  store.requestLease(pr, "setup");
  store.requestLease(pr, "heavy");

  await expect(
    releaseSetupResources({
      store,
      pr,
      miseScratchDirectory: "/tmp/pr-fleet-mise-test",
      setupFailed: true,
      removeScratchDirectory: () =>
        Promise.reject(new Error("scratch volume unavailable")),
    }),
  ).resolves.toBeUndefined();

  expect(store.setupOwner).toBeNull();
  expect(store.heavyOwners.has(pr.identity.number)).toBe(false);
});
