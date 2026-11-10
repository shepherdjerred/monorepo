import { Duration } from "cdk8s";
import { Probe, type ContainerProps } from "cdk8s-plus-31";

type HttpProbes = Pick<ContainerProps, "startup" | "liveness" | "readiness">;

/**
 * The kubelet probes of an HTTP service that exposes health endpoints on one
 * port.
 *
 * Liveness is checked every 30 seconds and readiness every 10, each failing
 * after three misses. A startup probe is added only when `startup` is given:
 * it polls every `periodSeconds` (5 by default) and gives the process
 * `failureThreshold` attempts before the kubelet restarts it, so the budget is
 * the product of the two. It probes the liveness path unless `path` says
 * otherwise.
 */
export function httpProbes(
  port: number,
  paths: {
    live: string;
    ready: string;
    startup?: {
      failureThreshold: number;
      periodSeconds?: number;
      path?: string;
    };
  },
): HttpProbes {
  const { startup } = paths;
  return {
    ...(startup === undefined
      ? {}
      : {
          startup: Probe.fromHttpGet(startup.path ?? paths.live, {
            port,
            periodSeconds: Duration.seconds(startup.periodSeconds ?? 5),
            failureThreshold: startup.failureThreshold,
          }),
        }),
    liveness: Probe.fromHttpGet(paths.live, {
      port,
      periodSeconds: Duration.seconds(30),
      failureThreshold: 3,
    }),
    readiness: Probe.fromHttpGet(paths.ready, {
      port,
      periodSeconds: Duration.seconds(10),
      failureThreshold: 3,
    }),
  };
}
