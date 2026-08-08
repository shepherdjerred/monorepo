import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

// The main-branch image pipeline updates this pin after the change merges.
// This seed is the last worker image without maintenance role support.
export const PRE_MAINTENANCE_WORKER_IMAGE =
  "2.0.0-8036@sha256:47a1d29da71b5571ffa9465797b75aa79f12276af8633e69d4be9068decea291";

export const MAINTENANCE_IMAGE_READY =
  versions["shepherdjerred/temporal-worker"] !== PRE_MAINTENANCE_WORKER_IMAGE;
