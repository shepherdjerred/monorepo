import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  claimCapture,
  CaptureClaim,
  CapturePlan,
  captureClaimFile,
} from "./claim.ts";
import { digestFile, readJson, sha } from "#learning/preference/ledger.ts";
import { preferenceSchedule } from "#learning/preference/gate.ts";
import { verifyNativeCaptures } from "./verify.ts";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "rwf-native-claim-unit-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
function fixture(output: string) {
  const digest = sha("unit claim test; never a pilot, model or native capture");
  return {
    pilot: path.join(directory, "pilot"),
    evaluation: path.join(directory, "evaluation"),
    model: path.join(directory, "model"),
    output: path.join(directory, output),
    eligibility: {
      actor_sha256: digest,
      native_sha256: digest,
      files: [{ file: "unit", sha256: digest }],
    },
    inputs: {
      native: { unit: true },
      renderer: [{ file: "unit", sha256: digest }],
      artifacts: { actor: digest, manifest: digest },
    },
  };
}

test("one original collector claim survives a competing owner and a later fresh output", async () => {
  const first = fixture("first");
  await mkdir(first.pilot);
  const results = await Promise.allSettled([
    claimCapture(first),
    claimCapture(fixture("second")),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  const claim = CaptureClaim.parse(
    await readJson(captureClaimFile(first.pilot)),
  );
  const original = await digestFile(captureClaimFile(first.pilot));
  const planFile = path.join(claim.output, "plan.json");
  expect(await digestFile(planFile)).toBe(claim.plan_sha256);
  const plan = CapturePlan.parse(await readJson(planFile));
  expect(plan.schedule).toEqual(preferenceSchedule());
  expect(plan.retries).toBe(0);
  expect(plan.diagnostic).toBe(false);
  await expect(claimCapture(fixture("third"))).rejects.toThrow();
  expect(await digestFile(captureClaimFile(first.pilot))).toBe(original);
});

test("an existing output cannot be overwritten or consume a new pilot claim", async () => {
  const input = fixture("existing");
  await mkdir(input.pilot);
  await mkdir(input.output);
  await expect(claimCapture(input)).rejects.toThrow();
  await expect(readJson(captureClaimFile(input.pilot))).rejects.toThrow();
});

test("a failed original collection is refused before any blind-review artifacts are read", async () => {
  const input = fixture("failed");
  await mkdir(input.pilot);
  await claimCapture(input);
  await Bun.write(
    path.join(input.output, "failure.json"),
    "unit failure; never native evidence",
  );
  await expect(
    verifyNativeCaptures(
      input.pilot,
      input.eligibility,
      path.join(input.output, "captures.json"),
    ),
  ).rejects.toThrow("failed native collection");
});
