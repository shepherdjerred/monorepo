import { expect, test } from "vitest";
import { prepareNormalAccountAfterProof } from "./readiness";

function preparation() {
  const calls: string[] = [];
  let launchTime = 0;
  const profiles: unknown[] = [];
  const status = {
    capturedAt: new Date(Date.now() + 1000).toISOString(),
    accountStage: "credentials",
    accountBusy: false,
    profiles,
  };
  const steps = {
    verifyProofs: async () => {
      calls.push("proofs");
    },
    launchNormalIos: async () => {
      calls.push("normal-ios-launch");
    },
    awaitPublication: async (launchedAt: number) => {
      calls.push("fresh-publication");
      launchTime = launchedAt;
    },
    validateAccount: async () => {
      calls.push("canonical-account-validation");
      return status;
    },
  };
  return { calls, steps, status, launchTime: () => launchTime };
}

test("only successful paired proofs lead to one normal launch and validated readiness", async () => {
  const fixture = preparation();
  const before = Date.now();
  await expect(prepareNormalAccountAfterProof(fixture.steps)).resolves.toEqual({
    capturedAt: fixture.status.capturedAt,
  });
  expect(fixture.calls).toEqual([
    "proofs",
    "normal-ios-launch",
    "fresh-publication",
    "canonical-account-validation",
  ]);
  expect(fixture.launchTime()).toBeGreaterThanOrEqual(before);
  expect(fixture.launchTime()).toBeLessThanOrEqual(Date.now());
});

test("failed paired proof verification performs no launch or readiness work", async () => {
  const fixture = preparation();
  fixture.steps.verifyProofs = () => Promise.reject(new Error("proof"));
  await expect(prepareNormalAccountAfterProof(fixture.steps)).rejects.toThrow();
  expect(fixture.calls).toEqual([]);
});

test("a launch or publication failure stops without retrying or validating an old owner", async () => {
  for (const stage of ["launchNormalIos", "awaitPublication"] as const) {
    const fixture = preparation();
    fixture.steps[stage] = () => Promise.reject(new Error(stage));
    await expect(
      prepareNormalAccountAfterProof(fixture.steps),
    ).rejects.toThrow();
    expect(fixture.calls).toEqual(
      stage === "launchNormalIos"
        ? ["proofs"]
        : ["proofs", "normal-ios-launch"],
    );
  }
});

test("canonical account validation failures cannot report normal readiness", async () => {
  const fixture = preparation();
  fixture.steps.validateAccount = () => Promise.reject(new Error("authority"));
  await expect(prepareNormalAccountAfterProof(fixture.steps)).rejects.toThrow();
  expect(fixture.calls).toEqual([
    "proofs",
    "normal-ios-launch",
    "fresh-publication",
  ]);
});

test("verification, busy, existing-profile and pre-launch publications remain inadmissible", async () => {
  for (const invalid of [
    { accountStage: "verification" },
    { accountBusy: true },
    { profiles: [{}] },
    { capturedAt: new Date(0).toISOString() },
  ]) {
    const fixture = preparation();
    Object.assign(fixture.status, invalid);
    await expect(
      prepareNormalAccountAfterProof(fixture.steps),
    ).rejects.toThrow();
    expect(
      fixture.calls.filter((call) => call === "normal-ios-launch"),
    ).toHaveLength(1);
  }
});
