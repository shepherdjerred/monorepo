import { Duration, Size } from "cdk8s";
import { Cpu, Probe, Protocol } from "cdk8s-plus-31";
import {
  SCOUT_STARTUP_PROBE_PERIOD_SECONDS,
  SCOUT_STARTUP_PROBE_FAILURE_THRESHOLD,
} from "@shepherdjerred/homelab/cdk8s/src/scout-release-budgets.ts";

/** The port every Scout runtime role serves its HTTP surface on. */
export const SCOUT_HTTP_PORT = 3000;

/**
 * The probe set shared by every Scout runtime role.
 *
 * Identical across roles on purpose, and not an accident of copying: `/ping`,
 * `/livez` and `/healthz` are the `admin` HTTP surface, which
 * `backend/src/http/admin-server.ts` binds on the same port as the full server
 * precisely so a probe definition does not have to know which role it is
 * pointed at. The generous startup budget covers a cold report-lake fold.
 */
export function scoutRuntimeProbes() {
  return {
    startup: Probe.fromHttpGet("/ping", {
      port: SCOUT_HTTP_PORT,
      periodSeconds: Duration.seconds(SCOUT_STARTUP_PROBE_PERIOD_SECONDS),
      failureThreshold: SCOUT_STARTUP_PROBE_FAILURE_THRESHOLD,
    }),
    liveness: Probe.fromHttpGet("/livez", {
      port: SCOUT_HTTP_PORT,
      periodSeconds: Duration.seconds(30),
      failureThreshold: 3,
    }),
    readiness: Probe.fromHttpGet("/healthz", {
      port: SCOUT_HTTP_PORT,
      periodSeconds: Duration.seconds(30),
      failureThreshold: 3,
    }),
  };
}

/** Shared admin surface, with voice memory reserved only by its owning role. */
export function scoutAdminRoleContainerBase(
  imageVersion: string,
  role: "gateway" | "activity-worker",
) {
  return {
    image: `ghcr.io/shepherdjerred/scout-for-lol:${imageVersion}`,
    ports: [{ name: "port-3000", number: 3000, protocol: Protocol.TCP }],
    securityContext: {
      ensureNonRoot: false,
      readOnlyRootFilesystem: false,
    },
    resources: {
      cpu: { request: Cpu.millis(50) },
      memory: {
        request: Size.gibibytes(role === "gateway" ? 3 : 2),
        limit: Size.gibibytes(8),
      },
    },
    ...scoutRuntimeProbes(),
  };
}
