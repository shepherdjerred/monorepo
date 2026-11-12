import { Chart, type Size } from "cdk8s";
import {
  Deployment,
  Service,
  Volume,
  type ContainerProps,
  type ContainerResources,
  type DeploymentProps,
  type VolumeMount,
} from "cdk8s-plus-31";
import { Construct } from "constructs";
import {
  KubeNetworkPolicy,
  type NetworkPolicyEgressRule,
  type NetworkPolicyIngressRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import type { ServiceMonitor } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { httpProbes } from "./kubelet-probes.ts";

/** What the construct supplies for every container: its mounts. */
type OwnedContainerProps = "volumeMounts" | "resources";

/** A container whose resources are stated; BestEffort is never the default. */
type ContainerSpec = Omit<ContainerProps, OwnedContainerProps> & {
  resources: ContainerResources;
};

/** A container that runs to completion before the server starts. */
export type FirstPartyInitContainer = ContainerSpec & { name: string };

/**
 * The server container. Its name, `http` port and kubelet probes come from the
 * service's `name`, `port` and `probes`.
 */
export type FirstPartyServerContainer = Omit<
  ContainerSpec,
  "name" | "ports" | "startup" | "liveness" | "readiness"
>;

/**
 * A tailnet hostname. `id` is the `TailscaleIngress` construct id, which seeds
 * the Ingress name.
 */
export type FirstPartyTailscaleHost = { id: string; host: string };

/**
 * A NetworkPolicy of the service's namespace. `name` is both the construct id
 * and the resource name. The policy types are the directions it gives rules
 * for.
 */
export type FirstPartyNetworkPolicy = {
  name: string;
  /** `app` selects the service's pods; `namespace` selects every pod. */
  selects: "app" | "namespace";
  ingress?: NetworkPolicyIngressRule[];
  egress?: NetworkPolicyEgressRule[];
};

export type FirstPartyWebServiceProps = {
  /**
   * The application name: the Deployment's construct id, the server
   * container's name, the `app` pod and Service label, and the ServiceMonitor's
   * name.
   */
  name: string;
  /** The port the server listens on, exposed as `http`. */
  port: number;
  /** Health endpoints for the kubelet probes; see `httpProbes`. */
  probes: Parameters<typeof httpProbes>[1];
  /**
   * The containers. Called once the Deployment exists and before the data
   * claim, so a 1Password item or other resource created inside it renders
   * between the two, where the services that predate this construct have it.
   */
  containers: () => {
    init?: FirstPartyInitContainer[];
    server: FirstPartyServerContainer;
  };
  /**
   * Deployment settings beyond the single replica and the `app` pod label:
   * metadata labels, strategy, pod security context, service account.
   */
  deployment?: Omit<DeploymentProps, "replicas" | "podMetadata" | "containers">;
  /** ReplicaSets kept for rollback. Defaults to three. */
  revisionHistoryLimit?: number;
  /**
   * A claim on the NVMe pool mounted into every container at `path`, ahead of
   * `/tmp`. `id` is the claim's name.
   */
  data?: { id: string; storage: Size; path: string };
  /** An explicit Service name; without it cdk8s derives `<chart>-<name>-service`. */
  serviceName?: string;
  /**
   * Tailnet hostnames, rendered in order. They share one in-cluster blackbox
   * probe of the Service, which requests `probePath`.
   */
  tailscale?: { probePath: string; hosts: FirstPartyTailscaleHost[] };
  /** A public hostname through the Cloudflare tunnel. */
  cloudflare?: {
    /** The TunnelBinding's construct id. */
    id: string;
    fqdn: string;
    /** Path of the in-cluster and the public blackbox probe. */
    probePath: string;
  };
  /** The namespace's policies, rendered in order after the ingress. */
  policies: FirstPartyNetworkPolicy[];
};

/**
 * A first-party HTTP service: one Deployment with a single replica, its
 * Service and ServiceMonitor, the hosts it is reached on, and the
 * NetworkPolicies around it.
 *
 * Every container gets a writable emptyDir at `/tmp`, since the root
 * filesystem is read-only. Leave out `tailscale` and `cloudflare` for a
 * service only other workloads call.
 *
 * Resources are created in the given scope, not under this construct, so their
 * names do not carry its id: `id` only has to be unique in the chart.
 */
export class FirstPartyWebService extends Construct {
  readonly deployment: Deployment;
  readonly service: Service;
  readonly serviceMonitor: ServiceMonitor;
  readonly policies: KubeNetworkPolicy[];
  /** The data claim, when `data` is given. */
  readonly dataVolume?: ZfsNvmeVolume;

  constructor(scope: Construct, id: string, props: FirstPartyWebServiceProps) {
    super(scope, id);
    const { name, port } = props;
    const chart = Chart.of(scope);
    if (chart.namespace === undefined)
      throw new Error(`FirstPartyWebService(${id}) needs a namespaced chart`);
    const labels = { app: name };

    this.deployment = new Deployment(scope, name, {
      ...props.deployment,
      replicas: 1,
      podMetadata: { labels },
    });

    const containers = props.containers();

    const volumeMounts: VolumeMount[] = [];
    if (props.data !== undefined) {
      this.dataVolume = new ZfsNvmeVolume(scope, props.data.id, {
        storage: props.data.storage,
      });
      volumeMounts.push({
        path: props.data.path,
        volume: Volume.fromPersistentVolumeClaim(
          scope,
          `${props.data.id}-volume`,
          this.dataVolume.claim,
        ),
      });
    }
    volumeMounts.push({
      path: "/tmp",
      volume: Volume.fromEmptyDir(scope, `${name}-tmp`, "tmp"),
    });

    for (const init of containers.init ?? []) {
      this.deployment.addInitContainer(
        withCommonProps({ ...init, resources: init.resources, volumeMounts }),
      );
    }
    this.deployment.addContainer(
      withCommonProps({
        ...containers.server,
        resources: containers.server.resources,
        name,
        ports: [{ name: "http", number: port }],
        ...httpProbes(port, props.probes),
        volumeMounts,
      }),
    );
    setRevisionHistoryLimit(this.deployment, props.revisionHistoryLimit);

    this.service = new Service(scope, `${name}-service`, {
      metadata: {
        ...(props.serviceName === undefined ? {} : { name: props.serviceName }),
        labels,
      },
      selector: this.deployment,
      ports: [{ name: "http", port }],
    });
    this.serviceMonitor = createServiceMonitor(chart, {
      name,
      namespace: chart.namespace,
      port: "http",
      matchLabels: labels,
    });

    for (const { id: ingressId, host } of props.tailscale?.hosts ?? []) {
      new TailscaleIngress(scope, ingressId, {
        service: this.service,
        host,
        probePath: props.tailscale?.probePath,
      });
    }
    if (props.cloudflare !== undefined) {
      createCloudflareTunnelBinding(scope, props.cloudflare.id, {
        serviceName: this.service.name,
        fqdn: props.cloudflare.fqdn,
        port,
        probePath: props.cloudflare.probePath,
        publicProbePath: props.cloudflare.probePath,
      });
    }

    this.policies = props.policies.map(
      (policy) =>
        new KubeNetworkPolicy(scope, policy.name, {
          metadata: { name: policy.name },
          spec: {
            podSelector:
              policy.selects === "app" ? { matchLabels: { ...labels } } : {},
            policyTypes: [
              ...(policy.ingress === undefined ? [] : ["Ingress"]),
              ...(policy.egress === undefined ? [] : ["Egress"]),
            ],
            ingress: policy.ingress,
            egress: policy.egress,
          },
        }),
    );
  }
}
