import { z } from "zod";
import type { BackendProbeDescriptor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { selectorMatches, type Fleet, type FleetService } from "./fleet.ts";
import {
  podsLabelled,
  podsOf,
  policiesAllow,
  policiesSelecting,
  type Pods,
} from "./network-reachability.ts";

/**
 * Probe-port admission: every port in the probe registry is reachable by
 * whoever the registration says connects to it.
 *
 * A port is registered by the Tailscale Ingress or Cloudflare TunnelBinding
 * that exposes it (`misc/probes/probe-registry.ts`), and blackbox-exporter
 * then probes it from the `prometheus` namespace. A NetworkPolicy that selects
 * the backing pods without admitting those peers on that port turns the probe
 * red or the route dead while every manifest still renders.
 */

export const TailscaleIngressSchema = z.looseObject({
  spec: z.looseObject({
    ingressClassName: z.literal("tailscale"),
    defaultBackend: z.looseObject({
      service: z.looseObject({
        name: z.string(),
        port: z.looseObject({ number: z.number() }),
      }),
    }),
  }),
});

/**
 * The proxy pods the Tailscale operator serves one Ingress from. They run in
 * the `tailscale` namespace and the operator labels them after the Ingress.
 */
export function tailscaleProxyPods(namespace: string, ingress: string): Pods {
  return podsLabelled("tailscale", {
    "tailscale.com/managed": "true",
    "tailscale.com/parent-resource": ingress,
    "tailscale.com/parent-resource-ns": namespace,
    "tailscale.com/parent-resource-type": "ingress",
  });
}

const TunnelBindingSchema = z.looseObject({
  subjects: z.array(z.looseObject({ name: z.string() })),
});

type ProbeSource = {
  /** What the allowlist key calls the source. */
  name: "prometheus" | "tailscale" | "cloudflare-operator-system";
  pods: Pods;
};

/**
 * Who connects to a probed port: blackbox-exporter always, plus each ingress
 * path that registered it. A Tailscale Ingress is served by a proxy pod the
 * operator labels after the Ingress. The cluster tunnel's cloudflared pods
 * run beside their operator in `cloudflare-operator-system`. They and
 * blackbox-exporter are deployed by upstream charts, so they are known by
 * namespace alone and a policy that narrows them by pod label does not count
 * as admitting them.
 */
function probeSources(
  fleet: Fleet,
  probe: BackendProbeDescriptor,
): ProbeSource[] {
  const inNamespace = fleet.objects.filter(
    (object) => object.metadata.namespace === probe.namespace,
  );
  const tailscale = inNamespace
    .filter((object) => object.kind === "Ingress")
    .filter((object) => {
      const { service } =
        TailscaleIngressSchema.parse(object).spec.defaultBackend;
      return (
        service.name === probe.serviceName && service.port.number === probe.port
      );
    })
    .map((ingress) => ({
      name: "tailscale" as const,
      pods: tailscaleProxyPods(probe.namespace, ingress.metadata.name),
    }));
  // A TunnelBinding names a Service, not a port: the probe carries the port
  // it was declared with.
  const cloudflare = inNamespace
    .filter((object) => object.kind === "TunnelBinding")
    .filter((object) =>
      TunnelBindingSchema.parse(object).subjects.some(
        (subject) => subject.name === probe.serviceName,
      ),
    )
    .map(() => ({
      name: "cloudflare-operator-system" as const,
      pods: podsLabelled("cloudflare-operator-system"),
    }));
  if (tailscale.length === 0 && cloudflare.length === 0)
    throw new Error(
      `Probe ${probe.namespace}/${probe.serviceName}:${String(probe.port)} is registered but no Tailscale Ingress or TunnelBinding exposes it`,
    );
  return [
    { name: "prometheus", pods: podsLabelled("prometheus") },
    ...tailscale,
    ...cloudflare,
  ];
}

export type ServicePortTarget = {
  /** The pods behind the port, when a synthesized workload backs it. */
  pods: Pods | undefined;
  /** The pod port the Service port forwards to. */
  port: number | string;
};

/**
 * The pods and pod port behind a Service port, for a probe or any other
 * route to it. A Service an upstream chart renders is not visible to
 * synthesis, and neither are the pods of a synthesized Service that no
 * synthesized workload backs; for those the Service port stands in for the
 * pod port.
 */
export function servicePortTargets(
  fleet: Fleet,
  probe: Pick<BackendProbeDescriptor, "namespace" | "serviceName" | "port">,
): ServicePortTarget[] {
  const service = fleet.services.find(
    (candidate) =>
      candidate.namespace === probe.namespace &&
      candidate.name === probe.serviceName,
  );
  if (service === undefined) return [{ pods: undefined, port: probe.port }];
  const port = targetPortOf(service, probe.port);
  const { selector } = service;
  const workloads =
    selector === undefined
      ? []
      : fleet.workloads.filter(
          (workload) =>
            workload.namespace === service.namespace &&
            !workload.hostNetwork &&
            selectorMatches({ matchLabels: selector }, workload.podLabels),
        );
  return workloads.length === 0
    ? [{ pods: undefined, port }]
    : workloads.map((workload) => ({ pods: podsOf(workload), port }));
}

function targetPortOf(service: FleetService, port: number): number | string {
  const servicePort = service.ports.find(
    (candidate) => candidate.port === port,
  );
  if (servicePort === undefined)
    throw new Error(
      `${service.namespace}/${service.name}:${String(port)} is a probe or Ingress target, but the Service does not expose that port`,
    );
  return servicePort.targetPort ?? port;
}

/**
 * Registered probe ports a NetworkPolicy closes to one of their sources, as
 * `<namespace>/<service>:<port> from <source namespace>`.
 *
 * Pods no Ingress policy selects accept every connection and are the existing
 * policy-coverage rules' concern, so they are not reported again here. Pods
 * synthesis cannot see have unknown labels, so only a policy that selects
 * every pod of their namespace is known to select them.
 */
export function probePortsNotAdmitted(fleet: Fleet): string[] {
  return fleet.backendProbes.flatMap((probe) => {
    const sources = probeSources(fleet, probe);
    const closed = new Set<string>();
    for (const { pods, port } of servicePortTargets(fleet, probe)) {
      const destination = pods ?? podsLabelled(probe.namespace);
      const policies = policiesSelecting(fleet, "Ingress", destination);
      if (policies.length === 0) continue;
      for (const source of sources) {
        const connection = {
          peer: source.pods,
          port: { protocol: "TCP", port, endPort: undefined },
          destination,
        };
        if (!policiesAllow(policies, "Ingress", connection))
          closed.add(source.name);
      }
    }
    return [...closed].map(
      (source) =>
        `${probe.namespace}/${probe.serviceName}:${String(probe.port)} from ${source}`,
    );
  });
}
