import { TURBO_VERIFY_TIER } from "./tiers.ts";

/** Admission and pipeline generation share this bounded, disposable profile. */
export const RAM_SCRATCH = {
  label: "ci.sjer.red/ram-scratch",
  profile: "verify-v1",
  volumes: [
    { name: "ci-ram-tmp", path: "/woodpecker/tmp", size: "8Gi" },
    { name: "ci-ram-gradle", path: "/woodpecker/gradle", size: "4Gi" },
  ],
  resources: {
    ...TURBO_VERIFY_TIER,
    memoryRequest: "30Gi",
    memoryLimit: "36Gi",
  },
} as const;
