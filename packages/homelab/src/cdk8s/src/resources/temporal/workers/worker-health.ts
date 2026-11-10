import { httpProbes } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/kubelet-probes.ts";

const HEALTH_PORT = 9465;

export function temporalWorkerHealthProbes() {
  return {
    ...httpProbes(HEALTH_PORT, {
      live: "/healthz",
      ready: "/healthz",
      startup: { failureThreshold: 30, periodSeconds: 10 },
    }),
  };
}
