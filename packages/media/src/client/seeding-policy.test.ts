import { test, expect } from "vitest";
import { readSeedingPolicy } from "./seeding-policy.tsx";

test("typed private inputs preserve ratio/time combination and verified evidence", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    policyKind: "private",
    policyRatio: "1.5",
    policySeconds: "604800",
    policyCombination: "all",
    policyEvidence: "Tracker rules checked for the current account",
    policyVerified: "on",
    policySizeRule: "on",
    policySecondsPerGiB: "3600",
    policySizeMinimum: "86400",
    policySizeMaximum: "1209600",
  }))
    form.set(key, value);
  expect(readSeedingPolicy(form)).toEqual({
    kind: "private",
    verified: true,
    evidence: "Tracker rules checked for the current account",
    ratio: 1.5,
    minimumSeconds: 604_800,
    combination: "all",
    sizeRule: {
      secondsPerGiB: 3600,
      minimumSeconds: 86_400,
      maximumSeconds: 1_209_600,
    },
  });
  form.set("policySizeMaximum", "1");
  expect(() => readSeedingPolicy(form)).toThrow();
});
test("unknown policy needs no hidden private values; unchecked verification cannot authorize cleanup", () => {
  const form = new FormData();
  form.set("policyKind", "unknown");
  expect(readSeedingPolicy(form)).toEqual({ kind: "unknown" });
  for (const [key, value] of Object.entries({
    policyKind: "privatehd",
    policyRatio: "",
    policyEvidence: "Awaiting confirmation of tracker rules",
  }))
    form.set(key, value);
  expect(readSeedingPolicy(form)).toMatchObject({
    kind: "privatehd",
    ratio: null,
    verified: false,
  });
});
