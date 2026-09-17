import { Duration } from "cdk8s";
import { Probe } from "cdk8s-plus-31";

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
      periodSeconds: Duration.seconds(10),
      failureThreshold: 240,
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
