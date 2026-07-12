import type { Construct } from "constructs";
import { Probe } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com.ts";
import type { ProbeModule } from "./blackbox-modules.ts";

export type HttpProbeProps = {
  namespace: string;
  jobName: string;
  url: string;
  module: ProbeModule;
  labels?: Record<string, string>;
  interval?: string;
};

/**
 * Creates a Prometheus Operator `Probe` CR that has the blackbox-exporter
 * check one target on a schedule. Generalized from the per-site Probe
 * construction in `misc/s3-static-site.ts`. Only called internally by
 * `resources/monitoring/service-probes-chart.ts` — service files register
 * with `probe-registry.ts` instead of calling this directly.
 */
export function createHttpProbe(
  scope: Construct,
  id: string,
  props: HttpProbeProps,
) {
  return new Probe(scope, id, {
    metadata: {
      name: props.jobName,
      namespace: props.namespace,
      labels: { release: "prometheus" },
    },
    spec: {
      jobName: props.jobName,
      interval: props.interval ?? "60s",
      module: props.module,
      prober: {
        url: "prometheus-prometheus-blackbox-exporter.prometheus:9115",
      },
      targets: {
        staticConfig: {
          static: [props.url],
          labels: props.labels ?? {},
        },
      },
    },
  });
}
