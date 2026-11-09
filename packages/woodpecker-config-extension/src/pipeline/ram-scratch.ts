import { BROWSER_TIER, TURBO_VERIFY_TIER } from "./tiers.ts";

const LABEL = "ci.sjer.red/ram-scratch";
const TMP = { name: "ci-ram-tmp", path: "/woodpecker/tmp" } as const;

/**
 * Admission and pipeline generation share these bounded, disposable profiles.
 *
 * Each one moves its lane's TMPDIR (and verify's private Gradle home) from the
 * workflow's ZFS volume into tmpfs, and reserves the whole tmpfs allowance on
 * top of the lane's own measured tier. tmpfs pages count against the pod's
 * memory, so a full scratch volume can never push the process past its tier.
 * Checkout, dependency trees and reports stay on the workflow volume.
 *
 * Verify qualified at a 24.1 GiB observed peak with no OOM under its 36Gi
 * limit. The browser lane peaks below 3 GiB; Scout's test PostgreSQL cluster
 * and browser profiles are its TMPDIR writers.
 *
 * The extended tier is the same Turbo graph running the heavier suites alone
 * (every integration suite boots a private PostgreSQL cluster under TMPDIR),
 * so it reuses verify's allowance under its own key: the homelab admission
 * policy mounts tmpfs only for the exact step key a profile names.
 */
const VERIFY_SCRATCH = {
  label: LABEL,
  volumes: [
    { ...TMP, size: "8Gi" },
    { name: "ci-ram-gradle", path: "/woodpecker/gradle", size: "4Gi" },
  ],
  resources: {
    ...TURBO_VERIFY_TIER,
    memoryRequest: "30Gi",
    memoryLimit: "36Gi",
  },
} as const;

export const RAM_SCRATCH_PROFILES = {
  verify: {
    ...VERIFY_SCRATCH,
    stepKey: "verify",
    profile: "verify-v1",
  },
  "verify-extended": {
    ...VERIFY_SCRATCH,
    stepKey: "verify-extended",
    profile: "verify-extended-v1",
  },
  "playwright-e2e": {
    label: LABEL,
    stepKey: "playwright-e2e",
    profile: "browser-v1",
    volumes: [{ ...TMP, size: "4Gi" }],
    resources: {
      ...BROWSER_TIER,
      memoryRequest: "10Gi",
      memoryLimit: "16Gi",
    },
  },
} as const;
export type RamScratchProfile =
  (typeof RAM_SCRATCH_PROFILES)[keyof typeof RAM_SCRATCH_PROFILES];

/** The verify profile, which owner benchmarks also use. */
export const RAM_SCRATCH = RAM_SCRATCH_PROFILES.verify;

export function ramScratchProfile(
  stepKey: string,
): RamScratchProfile | undefined {
  return Object.values(RAM_SCRATCH_PROFILES).find(
    (profile) => profile.stepKey === stepKey,
  );
}
