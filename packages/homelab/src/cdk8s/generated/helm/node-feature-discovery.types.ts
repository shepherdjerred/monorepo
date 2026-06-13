// Generated TypeScript types for node-feature-discovery Helm chart

export type NodefeaturediscoveryHelmValuesImage = {
  /**
   * @default "registry.k8s.io/nfd/node-feature-discovery"
   */
  repository?: string;
  /**
   * This should be set to 'IfNotPresent' for released version
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type NodefeaturediscoveryHelmValuesFeatureGates = {
  /**
   * @default false
   */
  NodeFeatureGroupAPI?: boolean;
};

export type NodefeaturediscoveryHelmValuesMaster = {
  /**
   * @default true
   */
  enable?: boolean;
  extraArgs?: unknown[];
  extraEnvs?: unknown[];
  /**
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @default "ClusterFirstWithHostNet"
   */
  dnsPolicy?: string;
  config?: unknown;
  /**
   * <NFD-MASTER-CONF-END-DO-NOT-REMOVE>
   *
   * @default 8080
   */
  port?: number;
  instance?: unknown;
  resyncPeriod?: unknown;
  denyLabelNs?: unknown[];
  extraLabelNs?: unknown[];
  /**
   * @default false
   */
  enableTaints?: boolean;
  nfdApiParallelism?: unknown;
  /**
   * @default {}
   */
  deploymentAnnotations?: NodefeaturediscoveryHelmValuesMasterDeploymentAnnotations;
  /**
   * @default 1
   */
  replicaCount?: number;
  /**
   * @default {}
   */
  podSecurityContext?: NodefeaturediscoveryHelmValuesMasterPodSecurityContext;
  /**
   * @default {...} (4 keys)
   */
  securityContext?: NodefeaturediscoveryHelmValuesMasterSecurityContext;
  /**
   * @default {"create":true,"annotations":{},"name":null}
   */
  serviceAccount?: NodefeaturediscoveryHelmValuesMasterServiceAccount;
  revisionHistoryLimit?: unknown;
  /**
   * @default {"create":true}
   */
  rbac?: NodefeaturediscoveryHelmValuesMasterRbac;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * @default {"enable":false,"minAvailable":1,"unhealthyPodEvictionPolicy":"AlwaysAllow"}
   */
  podDisruptionBudget?: NodefeaturediscoveryHelmValuesMasterPodDisruptionBudget;
  /**
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesMasterAnnotations;
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {"failureThreshold":30}
   */
  startupProbe?: NodefeaturediscoveryHelmValuesMasterStartupProbe;
  /**
   * @default {}
   */
  livenessProbe?: NodefeaturediscoveryHelmValuesMasterLivenessProbe;
  /**
   * @default {"failureThreshold":10}
   */
  readinessProbe?: NodefeaturediscoveryHelmValuesMasterReadinessProbe;
};

export type NodefeaturediscoveryHelmValuesMasterDeploymentAnnotations = object;

export type NodefeaturediscoveryHelmValuesMasterPodSecurityContext = object;

export type NodefeaturediscoveryHelmValuesMasterSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: NodefeaturediscoveryHelmValuesMasterSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
};

export type NodefeaturediscoveryHelmValuesMasterSecurityContextCapabilities = {
  drop?: string[];
};

export type NodefeaturediscoveryHelmValuesMasterServiceAccount = {
  /**
   * Specifies whether a service account should be created
   *
   * @default true
   */
  create?: boolean;
  /**
   * Annotations to add to the service account
   *
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesMasterServiceAccountAnnotations;
  name?: unknown;
};

export type NodefeaturediscoveryHelmValuesMasterServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesMasterRbac = {
  /**
   * @default true
   */
  create?: boolean;
};

export type NodefeaturediscoveryHelmValuesMasterPodDisruptionBudget = {
  /**
   * @default false
   */
  enable?: boolean;
  /**
   * @default 1
   */
  minAvailable?: number;
  /**
   * @default "AlwaysAllow"
   */
  unhealthyPodEvictionPolicy?: string;
};

export type NodefeaturediscoveryHelmValuesMasterAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesMasterStartupProbe = {
  /**
   * @default 30
   */
  failureThreshold?: number;
};

export type NodefeaturediscoveryHelmValuesMasterLivenessProbe = object;

export type NodefeaturediscoveryHelmValuesMasterReadinessProbe = {
  /**
   * @default 10
   */
  failureThreshold?: number;
};

export type NodefeaturediscoveryHelmValuesWorker = {
  /**
   * @default true
   */
  enable?: boolean;
  extraArgs?: unknown[];
  extraEnvs?: unknown[];
  /**
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @default "ClusterFirstWithHostNet"
   */
  dnsPolicy?: string;
  config?: unknown;
  /**
   * @default 8080
   */
  port?: number;
  /**
   * @default {}
   */
  daemonsetAnnotations?: NodefeaturediscoveryHelmValuesWorkerDaemonsetAnnotations;
  /**
   * @default {}
   */
  podSecurityContext?: NodefeaturediscoveryHelmValuesWorkerPodSecurityContext;
  /**
   * @default {...} (4 keys)
   */
  securityContext?: NodefeaturediscoveryHelmValuesWorkerSecurityContext;
  /**
   * @default {"initialDelaySeconds":10}
   */
  livenessProbe?: NodefeaturediscoveryHelmValuesWorkerLivenessProbe;
  /**
   * @default {"initialDelaySeconds":5,"failureThreshold":10}
   */
  readinessProbe?: NodefeaturediscoveryHelmValuesWorkerReadinessProbe;
  /**
   * @default {"create":true,"annotations":{},"name":null}
   */
  serviceAccount?: NodefeaturediscoveryHelmValuesWorkerServiceAccount;
  revisionHistoryLimit?: unknown;
  /**
   * @default {"create":true}
   */
  rbac?: NodefeaturediscoveryHelmValuesWorkerRbac;
  /**
   * Allow users to mount the hostPath /usr/src, useful for RHCOS on s390x
   * Does not work on systems without /usr/src AND a read-only /usr, such as Talos
   *
   * @default false
   */
  mountUsrSrc?: boolean;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesWorkerAnnotations;
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default ""
   */
  priorityClassName?: string;
  /**
   * @default {}
   */
  updateStrategy?: NodefeaturediscoveryHelmValuesWorkerUpdateStrategy;
};

export type NodefeaturediscoveryHelmValuesWorkerDaemonsetAnnotations = object;

export type NodefeaturediscoveryHelmValuesWorkerPodSecurityContext = object;

export type NodefeaturediscoveryHelmValuesWorkerSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: NodefeaturediscoveryHelmValuesWorkerSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
};

export type NodefeaturediscoveryHelmValuesWorkerSecurityContextCapabilities = {
  drop?: string[];
};

export type NodefeaturediscoveryHelmValuesWorkerLivenessProbe = {
  /**
   * @default 10
   */
  initialDelaySeconds?: number;
};

export type NodefeaturediscoveryHelmValuesWorkerReadinessProbe = {
  /**
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * @default 10
   */
  failureThreshold?: number;
};

export type NodefeaturediscoveryHelmValuesWorkerServiceAccount = {
  /**
   * Specifies whether a service account should be created.
   * We create this by default to make it easier for downstream users to apply PodSecurityPolicies.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Annotations to add to the service account
   *
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesWorkerServiceAccountAnnotations;
  name?: unknown;
};

export type NodefeaturediscoveryHelmValuesWorkerServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesWorkerRbac = {
  /**
   * @default true
   */
  create?: boolean;
};

export type NodefeaturediscoveryHelmValuesWorkerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesWorkerUpdateStrategy = object;

export type NodefeaturediscoveryHelmValuesTopologyUpdater = {
  config?: unknown;
  /**
   * @default false
   */
  enable?: boolean;
  /**
   * @default false
   */
  createCRDs?: boolean;
  extraArgs?: unknown[];
  extraEnvs?: unknown[];
  /**
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @default "ClusterFirstWithHostNet"
   */
  dnsPolicy?: string;
  /**
   * @default {"create":true,"annotations":{},"name":null}
   */
  serviceAccount?: NodefeaturediscoveryHelmValuesTopologyUpdaterServiceAccount;
  revisionHistoryLimit?: unknown;
  /**
   * @default {"create":true}
   */
  rbac?: NodefeaturediscoveryHelmValuesTopologyUpdaterRbac;
  /**
   * @default 8080
   */
  port?: number;
  kubeletConfigPath?: unknown;
  kubeletPodResourcesSockPath?: unknown;
  /**
   * @default "60s"
   */
  updateInterval?: string;
  /**
   * @default "*"
   */
  watchNamespace?: string;
  /**
   * @default "/var/lib/kubelet"
   */
  kubeletStateDir?: string;
  /**
   * @default {}
   */
  podSecurityContext?: NodefeaturediscoveryHelmValuesTopologyUpdaterPodSecurityContext;
  /**
   * @default {...} (4 keys)
   */
  securityContext?: NodefeaturediscoveryHelmValuesTopologyUpdaterSecurityContext;
  /**
   * @default {"initialDelaySeconds":10}
   */
  livenessProbe?: NodefeaturediscoveryHelmValuesTopologyUpdaterLivenessProbe;
  /**
   * @default {"initialDelaySeconds":5,"failureThreshold":10}
   */
  readinessProbe?: NodefeaturediscoveryHelmValuesTopologyUpdaterReadinessProbe;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesTopologyUpdaterAnnotations;
  /**
   * @default {}
   */
  daemonsetAnnotations?: NodefeaturediscoveryHelmValuesTopologyUpdaterDaemonsetAnnotations;
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default true
   */
  podSetFingerprint?: boolean;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterServiceAccount = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesTopologyUpdaterServiceAccountAnnotations;
  name?: unknown;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterServiceAccountAnnotations =
  {
    /**
     * This type allows arbitrary additional properties beyond those defined below.
     * This is common for config maps, custom settings, and extensible configurations.
     */
    [key: string]: unknown;
  };

export type NodefeaturediscoveryHelmValuesTopologyUpdaterRbac = {
  /**
   * @default true
   */
  create?: boolean;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterPodSecurityContext =
  object;

export type NodefeaturediscoveryHelmValuesTopologyUpdaterSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: NodefeaturediscoveryHelmValuesTopologyUpdaterSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default 0
   */
  runAsUser?: number;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterSecurityContextCapabilities =
  {
    drop?: string[];
  };

export type NodefeaturediscoveryHelmValuesTopologyUpdaterLivenessProbe = {
  /**
   * @default 10
   */
  initialDelaySeconds?: number;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterReadinessProbe = {
  /**
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * @default 10
   */
  failureThreshold?: number;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterDaemonsetAnnotations =
  object;

export type NodefeaturediscoveryHelmValuesGc = {
  /**
   * @default true
   */
  enable?: boolean;
  extraArgs?: unknown[];
  extraEnvs?: unknown[];
  /**
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @default 1
   */
  replicaCount?: number;
  /**
   * @default "ClusterFirstWithHostNet"
   */
  dnsPolicy?: string;
  /**
   * @default {"create":true,"annotations":{},"name":null}
   */
  serviceAccount?: NodefeaturediscoveryHelmValuesGcServiceAccount;
  /**
   * @default {"create":true}
   */
  rbac?: NodefeaturediscoveryHelmValuesGcRbac;
  /**
   * @default "1h"
   */
  interval?: string;
  /**
   * @default {}
   */
  podSecurityContext?: NodefeaturediscoveryHelmValuesGcPodSecurityContext;
  /**
   * @default {"initialDelaySeconds":10}
   */
  livenessProbe?: NodefeaturediscoveryHelmValuesGcLivenessProbe;
  /**
   * @default {"initialDelaySeconds":5}
   */
  readinessProbe?: NodefeaturediscoveryHelmValuesGcReadinessProbe;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * @default 8080
   */
  port?: number;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesGcAnnotations;
  /**
   * @default {}
   */
  deploymentAnnotations?: NodefeaturediscoveryHelmValuesGcDeploymentAnnotations;
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {"enable":false,"minAvailable":1,"unhealthyPodEvictionPolicy":"AlwaysAllow"}
   */
  podDisruptionBudget?: NodefeaturediscoveryHelmValuesGcPodDisruptionBudget;
  revisionHistoryLimit?: unknown;
};

export type NodefeaturediscoveryHelmValuesGcServiceAccount = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesGcServiceAccountAnnotations;
  name?: unknown;
};

export type NodefeaturediscoveryHelmValuesGcServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesGcRbac = {
  /**
   * @default true
   */
  create?: boolean;
};

export type NodefeaturediscoveryHelmValuesGcPodSecurityContext = object;

export type NodefeaturediscoveryHelmValuesGcLivenessProbe = {
  /**
   * @default 10
   */
  initialDelaySeconds?: number;
};

export type NodefeaturediscoveryHelmValuesGcReadinessProbe = {
  /**
   * @default 5
   */
  initialDelaySeconds?: number;
};

export type NodefeaturediscoveryHelmValuesGcAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesGcDeploymentAnnotations = object;

export type NodefeaturediscoveryHelmValuesGcPodDisruptionBudget = {
  /**
   * @default false
   */
  enable?: boolean;
  /**
   * @default 1
   */
  minAvailable?: number;
  /**
   * @default "AlwaysAllow"
   */
  unhealthyPodEvictionPolicy?: string;
};

export type NodefeaturediscoveryHelmValuesPrometheus = {
  /**
   * @default false
   */
  enable?: boolean;
  /**
   * @default "10s"
   */
  scrapeInterval?: string;
  /**
   * @default {}
   */
  labels?: NodefeaturediscoveryHelmValuesPrometheusLabels;
};

export type NodefeaturediscoveryHelmValuesPrometheusLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValues = {
  /**
   * tag, if defined will use the given image tag, else Chart.AppVersion will be used
   * tag
   *
   * @default {"repository":"registry.k8s.io/nfd/node-feature-discovery","pullPolicy":"IfNotPresent"}
   */
  image?: NodefeaturediscoveryHelmValuesImage;
  imagePullSecrets?: unknown[];
  /**
   * @default ""
   */
  nameOverride?: string;
  /**
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * @default {"NodeFeatureGroupAPI":false}
   */
  featureGates?: NodefeaturediscoveryHelmValuesFeatureGates;
  /**
   * @default ""
   */
  priorityClassName?: string;
  /**
   * @default true
   */
  postDeleteCleanup?: boolean;
  /**
   * @default {...} (29 keys)
   */
  master?: NodefeaturediscoveryHelmValuesMaster;
  /**
   * @default {...} (23 keys)
   */
  worker?: NodefeaturediscoveryHelmValuesWorker;
  /**
   * @default {...} (27 keys)
   */
  topologyUpdater?: NodefeaturediscoveryHelmValuesTopologyUpdater;
  /**
   * @default {...} (21 keys)
   */
  gc?: NodefeaturediscoveryHelmValuesGc;
  /**
   * @default {"enable":false,"scrapeInterval":"10s","labels":{}}
   */
  prometheus?: NodefeaturediscoveryHelmValuesPrometheus;
};

export type NodefeaturediscoveryHelmParameters = {
  "image.repository"?: string;
  "image.pullPolicy"?: string;
  imagePullSecrets?: string;
  nameOverride?: string;
  fullnameOverride?: string;
  namespaceOverride?: string;
  "featureGates.NodeFeatureGroupAPI"?: string;
  priorityClassName?: string;
  postDeleteCleanup?: string;
  "master.enable"?: string;
  "master.extraArgs"?: string;
  "master.extraEnvs"?: string;
  "master.hostNetwork"?: string;
  "master.dnsPolicy"?: string;
  "master.config"?: string;
  "master.port"?: string;
  "master.instance"?: string;
  "master.resyncPeriod"?: string;
  "master.denyLabelNs"?: string;
  "master.extraLabelNs"?: string;
  "master.enableTaints"?: string;
  "master.nfdApiParallelism"?: string;
  "master.replicaCount"?: string;
  "master.securityContext.allowPrivilegeEscalation"?: string;
  "master.securityContext.capabilities.drop"?: string;
  "master.securityContext.readOnlyRootFilesystem"?: string;
  "master.securityContext.runAsNonRoot"?: string;
  "master.serviceAccount.create"?: string;
  "master.serviceAccount.name"?: string;
  "master.revisionHistoryLimit"?: string;
  "master.rbac.create"?: string;
  "master.resources"?: string;
  "master.nodeSelector"?: string;
  "master.tolerations"?: string;
  "master.podDisruptionBudget.enable"?: string;
  "master.podDisruptionBudget.minAvailable"?: string;
  "master.podDisruptionBudget.unhealthyPodEvictionPolicy"?: string;
  "master.affinity"?: string;
  "master.startupProbe.failureThreshold"?: string;
  "master.readinessProbe.failureThreshold"?: string;
  "worker.enable"?: string;
  "worker.extraArgs"?: string;
  "worker.extraEnvs"?: string;
  "worker.hostNetwork"?: string;
  "worker.dnsPolicy"?: string;
  "worker.config"?: string;
  "worker.port"?: string;
  "worker.securityContext.allowPrivilegeEscalation"?: string;
  "worker.securityContext.capabilities.drop"?: string;
  "worker.securityContext.readOnlyRootFilesystem"?: string;
  "worker.securityContext.runAsNonRoot"?: string;
  "worker.livenessProbe.initialDelaySeconds"?: string;
  "worker.readinessProbe.initialDelaySeconds"?: string;
  "worker.readinessProbe.failureThreshold"?: string;
  "worker.serviceAccount.create"?: string;
  "worker.serviceAccount.name"?: string;
  "worker.revisionHistoryLimit"?: string;
  "worker.rbac.create"?: string;
  "worker.mountUsrSrc"?: string;
  "worker.resources"?: string;
  "worker.nodeSelector"?: string;
  "worker.tolerations"?: string;
  "worker.affinity"?: string;
  "worker.priorityClassName"?: string;
  "topologyUpdater.config"?: string;
  "topologyUpdater.enable"?: string;
  "topologyUpdater.createCRDs"?: string;
  "topologyUpdater.extraArgs"?: string;
  "topologyUpdater.extraEnvs"?: string;
  "topologyUpdater.hostNetwork"?: string;
  "topologyUpdater.dnsPolicy"?: string;
  "topologyUpdater.serviceAccount.create"?: string;
  "topologyUpdater.serviceAccount.name"?: string;
  "topologyUpdater.revisionHistoryLimit"?: string;
  "topologyUpdater.rbac.create"?: string;
  "topologyUpdater.port"?: string;
  "topologyUpdater.kubeletConfigPath"?: string;
  "topologyUpdater.kubeletPodResourcesSockPath"?: string;
  "topologyUpdater.updateInterval"?: string;
  "topologyUpdater.watchNamespace"?: string;
  "topologyUpdater.kubeletStateDir"?: string;
  "topologyUpdater.securityContext.allowPrivilegeEscalation"?: string;
  "topologyUpdater.securityContext.capabilities.drop"?: string;
  "topologyUpdater.securityContext.readOnlyRootFilesystem"?: string;
  "topologyUpdater.securityContext.runAsUser"?: string;
  "topologyUpdater.livenessProbe.initialDelaySeconds"?: string;
  "topologyUpdater.readinessProbe.initialDelaySeconds"?: string;
  "topologyUpdater.readinessProbe.failureThreshold"?: string;
  "topologyUpdater.resources"?: string;
  "topologyUpdater.nodeSelector"?: string;
  "topologyUpdater.tolerations"?: string;
  "topologyUpdater.affinity"?: string;
  "topologyUpdater.podSetFingerprint"?: string;
  "gc.enable"?: string;
  "gc.extraArgs"?: string;
  "gc.extraEnvs"?: string;
  "gc.hostNetwork"?: string;
  "gc.replicaCount"?: string;
  "gc.dnsPolicy"?: string;
  "gc.serviceAccount.create"?: string;
  "gc.serviceAccount.name"?: string;
  "gc.rbac.create"?: string;
  "gc.interval"?: string;
  "gc.livenessProbe.initialDelaySeconds"?: string;
  "gc.readinessProbe.initialDelaySeconds"?: string;
  "gc.resources"?: string;
  "gc.port"?: string;
  "gc.nodeSelector"?: string;
  "gc.tolerations"?: string;
  "gc.affinity"?: string;
  "gc.podDisruptionBudget.enable"?: string;
  "gc.podDisruptionBudget.minAvailable"?: string;
  "gc.podDisruptionBudget.unhealthyPodEvictionPolicy"?: string;
  "gc.revisionHistoryLimit"?: string;
  "prometheus.enable"?: string;
  "prometheus.scrapeInterval"?: string;
};
