import { BROWSER_TIER, MEDIUM_TIER, TURBO_VERIFY_TIER } from "./tiers.ts";

const LABEL = "ci.sjer.red/ram-scratch";
const TMP = { name: "ci-ram-tmp", path: "/woodpecker/tmp" } as const;

/**
 * Admission and pipeline generation share these bounded, disposable profiles.
 *
 * Each one moves its lane's TMPDIR (and verify's private Gradle home) from the
 * workflow's ZFS volume into tmpfs. tmpfs pages count against the container's
 * memory, so each profile adds its whole tmpfs allowance to the lane's memory
 * limit: a full scratch volume can never squeeze the process below its tier's
 * limit. The request stays the lane's tier, which is measured with the tmpfs
 * pages included, so Kueue reserves what the lane really uses rather than
 * every byte it could. Checkout, dependency trees and reports stay on the
 * workflow volume.
 *
 * Verify peaked at 35.9 GiB over 14 days to 2026-11-26 (p90 19.7 GiB) with no
 * OOM under its 36Gi limit. The browser lane peaks at 4.4 GiB; Scout's test
 * PostgreSQL cluster and browser profiles are its TMPDIR writers.
 *
 * `tofu-validate` fills TMPDIR with the per-run OpenTofu plugin cache: every
 * stack's `init` links its providers from it, so each pinned provider binary is
 * written there once. Initializing all of them fills about 1.5 GiB (measured
 * by running every stack's `init -lockfile=readonly` against one cache;
 * `hashicorp/aws` alone is about 0.7 GiB), and the bindings generator's
 * temporary work directory adds about 0.2 GiB while it runs. 4Gi leaves room
 * for a provider bump. Without scratch those binaries are written to every
 * workspace's ZFS volume, about 1.7 of the step's 2.9 GB.
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
    // The tier's 24Gi limit plus 12Gi of tmpfs.
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
      // The tier's 12Gi limit plus 4Gi of tmpfs.
      memoryLimit: "16Gi",
    },
  },
  "tofu-validate": {
    label: LABEL,
    stepKey: "tofu-validate",
    profile: "tofu-v1",
    volumes: [{ ...TMP, size: "4Gi" }],
    resources: {
      ...MEDIUM_TIER,
      // The tier's 12Gi limit plus 4Gi of tmpfs.
      memoryLimit: "16Gi",
    },
  },
} as const;
export type RamScratchProfile =
  (typeof RAM_SCRATCH_PROFILES)[keyof typeof RAM_SCRATCH_PROFILES];

/**
 * Steps whose pods request their profile. The homelab admission policy is
 * generated from every profile above, but a live guard (`failurePolicy: Fail`)
 * denies a pod carrying a profile it has not synced yet, and Delivery ships this
 * package independently of ArgoCD. A profile therefore lands here only in a
 * later change, once ArgoCD has synced the policy that admits it.
 */
const REQUESTING_STEP_KEYS: ReadonlySet<string> = new Set([
  "verify",
  "verify-extended",
  "playwright-e2e",
]);

/** The verify profile, which owner benchmarks also use. */
export const RAM_SCRATCH = RAM_SCRATCH_PROFILES.verify;

export function ramScratchProfile(
  stepKey: string,
): RamScratchProfile | undefined {
  return REQUESTING_STEP_KEYS.has(stepKey)
    ? Object.values(RAM_SCRATCH_PROFILES).find(
        (profile) => profile.stepKey === stepKey,
      )
    : undefined;
}
