/**
 * Cluster-wide cap on concurrently-running CI workflows.
 *
 * Direct successor to `BUILDKITE_MAX_IN_FLIGHT`, sized during the 2026-07 CI
 * freeze incident response. Woodpecker enforces it per agent via
 * `WOODPECKER_MAX_WORKFLOWS` rather than through a controller-side scheduler,
 * so a single agent replica makes this the cluster-wide bound.
 */
export const WOODPECKER_MAX_WORKFLOWS = 24;

/** Public origin GitHub reaches for webhooks and OAuth callbacks. */
export const WOODPECKER_PUBLIC_HOST = "https://woodpecker.sjer.red";

/** Port the server serves HTTP (web UI, webhooks, OAuth) on. */
export const WOODPECKER_HTTP_PORT = 8000;

/** Port agents reach the server's gRPC endpoint on. */
export const WOODPECKER_GRPC_PORT = 9000;
