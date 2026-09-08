import { Duration } from "cdk8s";
import { Probe } from "cdk8s-plus-31";

const HEALTH_PORT = 9465;

export function temporalWorkerHealthProbes() {
  return {
    startup: Probe.fromHttpGet("/healthz", {
      port: HEALTH_PORT,
      periodSeconds: Duration.seconds(10),
      failureThreshold: 30,
    }),
    liveness: Probe.fromHttpGet("/healthz", {
      port: HEALTH_PORT,
      periodSeconds: Duration.seconds(30),
      failureThreshold: 3,
    }),
    readiness: Probe.fromHttpGet("/healthz", {
      port: HEALTH_PORT,
      periodSeconds: Duration.seconds(10),
      failureThreshold: 3,
    }),
  };
}
