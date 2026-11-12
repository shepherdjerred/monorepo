import type { Size } from "cdk8s";
import {
  Deployment,
  DeploymentStrategy,
  Service,
  Volume,
  type Container,
  type DeploymentProps,
} from "cdk8s-plus-31";
import { Construct } from "constructs";
import type { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import type { ServiceMonitor } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com.ts";
import {
  setDeploymentPriorityClass,
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import {
  createFirstPartyNetworkPolicies,
  namespacedChart,
  type FirstPartyContainerSpec,
  type FirstPartyNetworkPolicy,
} from "./workload-parts.ts";

/** A container that runs to completion before the worker starts. */
export type FirstPartyWorkerInitContainer = FirstPartyContainerSpec & {
  name: string;
};

/**
 * The Service Prometheus scrapes, and its ServiceMonitor. Nothing else is
 * meant to call it: a worker has no ingress.
 */
export type FirstPartyWorkerMetrics = {
  /** The Service's construct id. */
  serviceId: string;
  /** An explicit Service name; without it cdk8s derives `<chart>-<serviceId>`. */
  serviceName?: string;
  /** The Service's `app` label, which the ServiceMonitor selects. */
  app: string;
  port: number;
  /** The Service port's name, which the ServiceMonitor scrapes. Defaults to `metrics`. */
  portName?: string;
  /** Stated only where the Service spells out its target port. */
  targetPort?: number;
  /** Seeds the ServiceMonitor's id and name: `<monitorName>-service-monitor`. */
  monitorName: string;
};

export type FirstPartyWorkerProps = {
  /** The Deployment's construct id. */
  name: string;
  /**
   * Deployment settings. A worker defaults to one replica replaced with
   * `Recreate`, since it usually holds a ReadWriteOnce claim or a single
   * gateway session.
   */
  deployment?: Omit<DeploymentProps, "containers">;
  /** A PriorityClass for the pods. */
  priorityClassName?: string;
  /**
   * ReplicaSets kept for rollback. Defaults to three; `false` leaves cdk8s's
   * default of ten in place.
   */
  revisionHistoryLimit?: number | false;
  /**
   * The containers. Unlike a web service's, each states its own name, ports,
   * probes and mounts: workers differ in all four. Called with the Deployment once it exists and before the
   * data claim, so a 1Password item, claim, Service or other resource created
   * inside it renders between the two, where the workers that predate this
   * construct have it.
   */
  containers: (deployment: Deployment) => {
    init?: FirstPartyWorkerInitContainer[];
    main: FirstPartyContainerSpec;
    /** Containers after the main one, in order. */
    sidecars?: FirstPartyContainerSpec[];
  };
  /**
   * A claim on the NVMe pool, mounted into the main container at `path` ahead
   * of its other mounts. `id` is the claim's name and `volumeId` the pod
   * volume's construct id.
   */
  data?: { id: string; storage: Size; volumeId: string; path: string };
  metrics?: FirstPartyWorkerMetrics;
  /** The namespace's policies, rendered in order after everything else. */
  policies: FirstPartyNetworkPolicy[];
};

/**
 * A first-party workload nothing routes to: a bot or worker in one
 * Deployment, the claim holding its state, the Service Prometheus scrapes,
 * and the NetworkPolicies around it.
 *
 * Resources are created in the given scope, not under this construct, so their
 * names do not carry its id: `id` only has to be unique in the chart.
 */
export class FirstPartyWorker extends Construct {
  readonly deployment: Deployment;
  /** The main container, for what the props do not model. */
  readonly container: Container;
  readonly policies: KubeNetworkPolicy[];
  /** The data claim, when `data` is given. */
  readonly dataVolume?: ZfsNvmeVolume;
  /** The metrics Service and its monitor, when `metrics` is given. */
  readonly service?: Service;
  readonly serviceMonitor?: ServiceMonitor;

  constructor(scope: Construct, id: string, props: FirstPartyWorkerProps) {
    super(scope, id);
    const { chart, namespace } = namespacedChart(
      scope,
      `FirstPartyWorker(${id})`,
    );

    this.deployment = new Deployment(scope, props.name, {
      replicas: 1,
      strategy: DeploymentStrategy.recreate(),
      ...props.deployment,
    });
    if (props.priorityClassName !== undefined)
      setDeploymentPriorityClass(this.deployment, props.priorityClassName);

    const containers = props.containers(this.deployment);

    const mainMounts = [...(containers.main.volumeMounts ?? [])];
    if (props.data !== undefined) {
      this.dataVolume = new ZfsNvmeVolume(scope, props.data.id, {
        storage: props.data.storage,
      });
      mainMounts.unshift({
        path: props.data.path,
        volume: Volume.fromPersistentVolumeClaim(
          scope,
          props.data.volumeId,
          this.dataVolume.claim,
        ),
      });
    }

    for (const init of containers.init ?? []) {
      this.deployment.addInitContainer(
        withCommonProps({ ...init, resources: init.resources }),
      );
    }
    this.container = this.deployment.addContainer(
      withCommonProps({
        ...containers.main,
        resources: containers.main.resources,
        volumeMounts: mainMounts,
      }),
    );
    for (const sidecar of containers.sidecars ?? []) {
      this.deployment.addContainer(
        withCommonProps({ ...sidecar, resources: sidecar.resources }),
      );
    }
    if (props.revisionHistoryLimit !== false)
      setRevisionHistoryLimit(this.deployment, props.revisionHistoryLimit);

    if (props.metrics !== undefined) {
      const { metrics } = props;
      const labels = { app: metrics.app };
      const portName = metrics.portName ?? "metrics";
      this.service = new Service(scope, metrics.serviceId, {
        metadata: {
          ...(metrics.serviceName === undefined
            ? {}
            : { name: metrics.serviceName }),
          labels,
        },
        selector: this.deployment,
        ports: [
          {
            name: portName,
            port: metrics.port,
            ...(metrics.targetPort === undefined
              ? {}
              : { targetPort: metrics.targetPort }),
          },
        ],
      });
      this.serviceMonitor = createServiceMonitor(chart, {
        name: metrics.monitorName,
        namespace,
        port: portName,
        matchLabels: labels,
      });
    }

    this.policies = createFirstPartyNetworkPolicies(
      scope,
      props.policies,
      props.deployment?.podMetadata?.labels,
    );
  }
}
