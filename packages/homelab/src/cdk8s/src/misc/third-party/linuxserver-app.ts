import type { Size } from "cdk8s";
import {
  Deployment,
  DeploymentStrategy,
  Service,
  Volume,
  type ContainerProps,
  type ContainerResources,
  type DeploymentProps,
  type EnvValue,
  type PersistentVolumeClaim,
  type VolumeMount,
} from "cdk8s-plus-31";
import { Construct } from "constructs";
import {
  KubeNetworkPolicy,
  type NetworkPolicyEgressRule,
  type NetworkPolicyIngressRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { setRevisionHistoryLimit } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  linuxServerPod,
  withCommonLinuxServerProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/linux-server.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import {
  TailscaleIngress,
  type TailscaleProxyClass,
} from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";

/**
 * A claim on the NVMe pool the app owns, mounted at `path`. `claim` is the
 * claim's name; `volumeId` is the construct id of its pod volume.
 */
export type LinuxServerOwnedClaim = {
  claim: string;
  volumeId: string;
  storage: Size;
  path: string;
};

/** A claim another construct owns (a media library), mounted at `path`. */
export type LinuxServerSharedMount = {
  volumeId: string;
  claim: PersistentVolumeClaim;
  path: string;
};

/**
 * A NetworkPolicy selecting every pod of the app's namespace. `name` is both
 * the construct id and the resource name. The policy types are the directions
 * it gives rules for.
 */
export type LinuxServerNetworkPolicy = {
  name: string;
  ingress?: NetworkPolicyIngressRule[];
  egress?: NetworkPolicyEgressRule[];
};

/** What an app adds beyond its own and shared claims; see `extend`. */
export type LinuxServerAppExtension = {
  /** Containers that run to completion before the app starts, as given. */
  init?: ContainerProps[];
  /** Mounts of the app container, between its own claims and the shared ones. */
  volumeMounts?: VolumeMount[];
  /** Environment of the app container, over PUID, PGID and TZ. */
  envVariables?: Record<string, EnvValue>;
};

export type LinuxServerAppProps = {
  /**
   * The application name: the Deployment's construct id, and the stem of the
   * Service (`<name>-service`) and Tailscale ingress
   * (`<name>-tailscale-ingress`) ids.
   */
  name: string;
  /** The full image reference. */
  image: string;
  /** The port the web UI listens on: the container port and the Service port. */
  port: number;
  /** Requests and limits; `{}` is the visible BestEffort opt-in. */
  resources: ContainerResources;
  /**
   * Whether mounted volumes are group-owned by the LinuxServer group. It
   * changes ownership of existing data on the next rollout, so each app states
   * what it has today.
   */
  fsGroup: boolean;
  /** The app's own claims, created and mounted in order. The first is its config. */
  claims: LinuxServerOwnedClaim[];
  /** Claims owned elsewhere, mounted in order after everything else. */
  sharedMounts?: LinuxServerSharedMount[];
  /** Pod labels and annotations. */
  podMetadata?: DeploymentProps["podMetadata"];
  /**
   * Kubelet probes of the app container. Without them it has only the TCP
   * startup probe cdk8s-plus gives a container with a port.
   */
  probes?: Pick<ContainerProps, "startup" | "liveness" | "readiness">;
  /** ReplicaSets kept for rollback. Defaults to three. */
  revisionHistoryLimit?: number;
  /**
   * Whatever the app has beyond the common shape. Called with the pod volumes
   * of `claims`, in order, once the claims exist, so a resource created inside
   * it renders between the claims and the Service.
   */
  extend?: (claimVolumes: Volume[]) => LinuxServerAppExtension;
  /** The tailnet hostname the Service is reached on. */
  tailscale?: { host: string; proxyClass?: TailscaleProxyClass };
  /** The namespace's policies, rendered in order after the ingress. */
  policies?: LinuxServerNetworkPolicy[];
};

/**
 * A LinuxServer.io app: one Deployment with a single replica that is recreated
 * on rollout (its config claim is ReadWriteOnce), the claims it owns, its
 * Service, and the tailnet host and NetworkPolicies around it.
 *
 * The container starts as root with a writable filesystem and drops to
 * PUID/PGID itself; see `withCommonLinuxServerProps` and `linuxServerPod`.
 *
 * Resources are created in the given scope, not under this construct, so their
 * names do not carry its id: `id` only has to be unique in the chart.
 */
export class LinuxServerApp extends Construct {
  readonly deployment: Deployment;
  readonly service: Service;
  /** The owned claims, in the order of `claims`. */
  readonly claims: ZfsNvmeVolume[];
  readonly policies: KubeNetworkPolicy[];

  constructor(scope: Construct, id: string, props: LinuxServerAppProps) {
    super(scope, id);
    const { name, port } = props;

    this.deployment = new Deployment(scope, name, {
      replicas: 1,
      strategy: DeploymentStrategy.recreate(),
      ...(props.podMetadata === undefined
        ? {}
        : { podMetadata: props.podMetadata }),
      ...linuxServerPod({ fsGroup: props.fsGroup }),
    });

    const owned = props.claims.map(({ claim, volumeId, storage, path }) => {
      const nvme = new ZfsNvmeVolume(scope, claim, { storage });
      const volume = Volume.fromPersistentVolumeClaim(
        scope,
        volumeId,
        nvme.claim,
      );
      return { nvme, volume, path };
    });
    this.claims = owned.map(({ nvme }) => nvme);

    const extension = props.extend?.(owned.map(({ volume }) => volume)) ?? {};
    for (const init of extension.init ?? []) {
      this.deployment.addInitContainer(init);
    }

    this.deployment.addContainer(
      withCommonLinuxServerProps({
        image: props.image,
        portNumber: port,
        ...props.probes,
        ...(extension.envVariables === undefined
          ? {}
          : { envVariables: extension.envVariables }),
        volumeMounts: [
          ...owned.map(({ path, volume }) => ({ path, volume })),
          ...(extension.volumeMounts ?? []),
          ...(props.sharedMounts ?? []).map(({ volumeId, claim, path }) => ({
            path,
            volume: Volume.fromPersistentVolumeClaim(scope, volumeId, claim),
          })),
        ],
        resources: props.resources,
      }),
    );
    setRevisionHistoryLimit(this.deployment, props.revisionHistoryLimit);

    this.service = new Service(scope, `${name}-service`, {
      selector: this.deployment,
      ports: [{ port }],
    });

    if (props.tailscale !== undefined) {
      new TailscaleIngress(scope, `${name}-tailscale-ingress`, {
        service: this.service,
        host: props.tailscale.host,
        ...(props.tailscale.proxyClass === undefined
          ? {}
          : { proxyClass: props.tailscale.proxyClass }),
      });
    }

    this.policies = (props.policies ?? []).map(
      (policy) =>
        new KubeNetworkPolicy(scope, policy.name, {
          metadata: { name: policy.name },
          spec: {
            podSelector: {},
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
