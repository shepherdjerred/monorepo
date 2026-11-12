import type { Size } from "cdk8s";
import {
  Deployment,
  Service,
  Volume,
  type DeploymentProps,
  type VolumeMount,
} from "cdk8s-plus-31";
import { Construct } from "constructs";
import type { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
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
import {
  createFirstPartyNetworkPolicies,
  namespacedChart,
  type FirstPartyContainerSpec,
  type FirstPartyNetworkPolicy,
} from "./workload-parts.ts";

/** A container; the construct supplies every container's mounts. */
type ContainerSpec = FirstPartyContainerSpec<"volumeMounts">;

/** A container that runs to completion before the server starts. */
export type FirstPartyInitContainer = ContainerSpec & { name: string };

/** A container that runs beside the server and states its own probes. */
export type FirstPartySidecarContainer = ContainerSpec & { name: string };

/**
 * The server container. Its `http` port and kubelet probes come from the
 * service's `port` and `probes`, and its name is the service's `name` unless
 * it states another.
 */
export type FirstPartyServerContainer = Omit<
  ContainerSpec,
  "name" | "ports" | "startup" | "liveness" | "readiness"
> & { name?: string };

/**
 * A tailnet hostname. `id` is the `TailscaleIngress` construct id, which seeds
 * the Ingress name.
 */
export type FirstPartyTailscaleHost = { id: string; host: string };

export type FirstPartyWebServiceProps = {
  /**
   * The application name: the Deployment's construct id, the server
   * container's default name, the `app` pod and Service label, and the
   * ServiceMonitor's name.
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
    /** Containers after the server, in order. */
    sidecars?: FirstPartySidecarContainer[];
  };
  /**
   * Deployment settings beyond the single replica: metadata labels, strategy,
   * pod security context, service account. `podMetadata` replaces the `app`
   * pod label, for a service whose pods carry more labels or, from before
   * this construct, none; without that label no policy can select the app.
   */
  deployment?: Omit<DeploymentProps, "replicas" | "containers">;
  /** ReplicaSets kept for rollback. Defaults to three. */
  revisionHistoryLimit?: number;
  /**
   * A claim on the NVMe pool mounted into every container at `path`, ahead of
   * `/tmp`. `id` is the claim's name.
   */
  data?: { id: string; storage: Size; path: string };
  /**
   * `false` leaves out the emptyDir at `/tmp`, for a service whose root
   * filesystem is writable.
   */
  tmp?: false;
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
 * Every container gets a writable emptyDir at `/tmp` unless `tmp` is `false`,
 * since the root filesystem is read-only. Leave out `tailscale` and `cloudflare` for a
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
    const { chart, namespace } = namespacedChart(
      scope,
      `FirstPartyWebService(${id})`,
    );
    const labels = { app: name };

    this.deployment = new Deployment(scope, name, {
      podMetadata: { labels },
      ...props.deployment,
      replicas: 1,
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
    if (props.tmp !== false)
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
        name: containers.server.name ?? name,
        ports: [{ name: "http", number: port }],
        ...httpProbes(port, props.probes),
        volumeMounts,
      }),
    );
    for (const sidecar of containers.sidecars ?? []) {
      this.deployment.addContainer(
        withCommonProps({
          ...sidecar,
          resources: sidecar.resources,
          volumeMounts,
        }),
      );
    }
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
      namespace,
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

    const { podMetadata } = props.deployment ?? {};
    const podsCarryApp =
      podMetadata === undefined || podMetadata.labels?.["app"] === name;
    this.policies = createFirstPartyNetworkPolicies(
      scope,
      props.policies,
      podsCarryApp ? labels : undefined,
    );
  }
}
