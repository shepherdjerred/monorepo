// Generated TypeScript types for node-feature-discovery Helm chart

export type NodefeaturediscoveryHelmValuesImage = {
  /**
   * NFD image repository
   * -- General
   *
   * NFD image repository
   *
   * @default "registry.k8s.io/nfd/node-feature-discovery"
   */
  repository?: string;
  /**
   * @schema enum: [Always, IfNotPresent, Never]
   * Image pull policy
   * -- General
   *
   * Image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: "Always" | "IfNotPresent" | "Never";
  /**
   * @schema type: [string, null]
   * NFD image tag. If not specified Chart.AppVersion will be used.
   * -- General
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/imagePullSecrets
   * Image pull secrets. [More info](https://kubernetes.io/docs/concepts/containers/images#specifying-imagepullsecrets-on-a-pod).
   * -- General
   *
   * NFD image tag. If not specified Chart.AppVersion will be used.
   *
   * @default null
   */
  tag?: string | null;
};

export type NodefeaturediscoveryHelmValuesFeatureGates = object;

export type NodefeaturediscoveryHelmValuesGlobal = {
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/imagePullSecrets
   * If `imagePullSecrets` is specified, it takes precedence over `global.imagePullSecrets`. [More info](https://kubernetes.io/docs/concepts/containers/images#specifying-imagepullsecrets-on-a-pod).
   * -- Global
   *
   * If `imagePullSecrets` is specified, it takes precedence over `global.imagePullSecrets`. [More info](https://kubernetes.io/docs/concepts/containers/images#specifying-imagepullsecrets-on-a-pod).
   *
   * @default []
   */
  imagePullSecrets?: unknown[];
};

export type NodefeaturediscoveryHelmValuesMaster = {
  /**
   * Specifies whether nfd-master should be deployed
   * -- NFD-Master
   *
   * Specifies whether nfd-master should be deployed
   *
   * @default true
   */
  enable?: boolean;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Container/properties/args
   * Additional [command line arguments](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/master-commandline-reference) to pass to nfd-master.
   * -- NFD-Master
   *
   * Additional [command line arguments](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/master-commandline-reference) to pass to nfd-master.
   *
   * @default []
   */
  extraArgs?: unknown[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Container/properties/env
   * Additional environment variables to set in the nfd-master container.
   * -- NFD-Master
   *
   * Additional environment variables to set in the nfd-master container.
   *
   * @default []
   */
  extraEnvs?: unknown[];
  /**
   * Run the container in the host's network namespace.
   * -- NFD-Master
   *
   * Run the container in the host's network namespace.
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @schema type: [boolean, null]
   * (bool) Run the container with host user ids. NOTE: if hostNetwork is true, hostUsers should be true.
   * -- NFD-Master
   * @schema type: [boolean, null]
   *
   * Run the container with host user ids. NOTE: if hostNetwork is true, hostUsers should be true.
   *
   * @default null
   */
  hostUsers?: boolean | null;
  /**
   * @enum: [Default, ClusterFirst, ClusterFirstWithHostNet, None]
   * NFD master pod [dnsPolicy](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-s-dns-policy).
   * -- NFD-Master
   *
   * NFD master pod [dnsPolicy](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-s-dns-policy).
   *
   * @default "ClusterFirstWithHostNet"
   */
  dnsPolicy?: string;
  /**
   * @schema type: [object, null]
   * NFD master [configuration](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/master-configuration-reference).
   * -- NFD-Master
   *
   * NFD master [configuration](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/master-configuration-reference).
   *
   * @default null
   */
  config?: object | null;
  /**
   * <NFD-MASTER-CONF-END-DO-NOT-REMOVE>
   * @schema type: integer; minimum: 1; maximum: 65535
   * Port on which to serve http for metrics and healthz endpoints.
   * -- NFD-Master
   *
   * Port on which to serve http for metrics and healthz endpoints.
   *
   * @default 8080
   */
  port?: number;
  /**
   * @schema type: [string, null]
   * Instance name. Used to separate annotation namespaces for multiple parallel deployments.
   * -- NFD-Master
   * @schema type: [string, null]
   *
   * Instance name. Used to separate annotation namespaces for multiple parallel deployments.
   *
   * @default null
   */
  instance?: string | null;
  /**
   * (int) NFD API controller resync period. Time duration string (e.g. "5m", "1h", "2h45m").
   * -- NFD-Master
   * @schema item: string
   *
   * NFD API controller resync period. Time duration string (e.g. "5m", "1h", "2h45m").
   *
   * @default null
   */
  resyncPeriod?: string | null;
  /**
   * Label namespaces to deny. Labels with these prefixes will not be published to the nodes.
   * -- NFD-Master
   *
   * Label namespaces to deny. Labels with these prefixes will not be published to the nodes.
   *
   * @default []
   */
  denyLabelNs?: string[];
  /**
   * @schema item: string
   * Additional label namespaces to publish. Labels with these prefixes are allowed even if otherwise denied by `master.denyLabelNs`.
   * -- NFD-Master
   *
   * Additional label namespaces to publish. Labels with these prefixes are allowed even if otherwise denied by `master.denyLabelNs`.
   *
   * @default []
   */
  extraLabelNs?: string[];
  /**
   * Enable node tainting.
   * -- NFD-Master
   *
   * Enable node tainting.
   *
   * @default false
   */
  enableTaints?: boolean;
  /**
   * @schema type: [integer, null]; minimum: 1; maximum: 100
   * (int) The maximum number of concurrent node updates.
   * -- NFD-Master
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   *
   * The maximum number of concurrent node updates.
   *
   * @default null
   */
  nfdApiParallelism?: number | null;
  /**
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-master Deployment.
   * -- NFD-Master
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-master Deployment.
   *
   * @default {}
   */
  deploymentAnnotations?: NodefeaturediscoveryHelmValuesMasterDeploymentAnnotations;
  /**
   * Number of the desired replicas for the nfd-master Deployment.
   * -- NFD-Master
   *
   * Number of the desired replicas for the nfd-master Deployment.
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSecurityContext
   * [Pod SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod) of the nfd-master pods.
   * -- NFD-Master
   *
   * [Pod SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod) of the nfd-master pods.
   *
   * @default {}
   */
  podSecurityContext?: NodefeaturediscoveryHelmValuesMasterPodSecurityContext;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/initContainers
   * [Init containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) to add to the nfd-master pods.
   * -- NFD-Master
   *
   * [Init containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) to add to the nfd-master pods.
   *
   * @default []
   */
  initContainers?: unknown[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.SecurityContext
   * [SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container) of the nfd-master container.
   * -- NFD-Master
   *
   * [SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container) of the nfd-master container.
   *
   * @default {...} (4 keys)
   */
  securityContext?: NodefeaturediscoveryHelmValuesMasterSecurityContext;
  /**
   * @default {"create":true,"annotations":{},"name":null}
   */
  serviceAccount?: NodefeaturediscoveryHelmValuesMasterServiceAccount;
  /**
   * Specifies the number of old ReplicaSets for the Deployment to retain. [revisionHistoryLimit](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#revision-history-limit)
   *
   * @default null
   */
  revisionHistoryLimit?: number | null;
  /**
   * @default {"create":true}
   */
  rbac?: NodefeaturediscoveryHelmValuesMasterRbac;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.ResourceRequirements
   *
   * @default {"limits":{"memory":"4Gi"},"requests":{"cpu":"100m","memory":"128Mi"}}
   */
  resources?: NodefeaturediscoveryHelmValuesMasterResources;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/nodeSelector
   * [Node selector](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector) for the nfd-master pods.
   * -- NFD-Master
   *
   * [Node selector](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector) for the nfd-master pods.
   *
   * @default {}
   */
  nodeSelector?: NodefeaturediscoveryHelmValuesMasterNodeSelector;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/tolerations
   * [Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) for the nfd-master pods.
   * -- NFD-Master
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.policy.v1.PodDisruptionBudgetSpec
   *
   * [Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) for the nfd-master pods.
   *
   * @default [{"key":"node-role.kubernetes.io/control-plane","operator":"Equal","value":"","effect":"NoSchedule"}]
   */
  tolerations?: object[];
  /**
   * @default {"enable":false,"minAvailable":1,"unhealthyPodEvictionPolicy":"AlwaysAllow"}
   */
  podDisruptionBudget?: NodefeaturediscoveryHelmValuesMasterPodDisruptionBudget;
  /**
   * -- NFD-Master
   *
   * @default {"enabled":false,"egress":[{"ports":[{"port":80,"protocol":"TCP"},{"port":443,"protocol":"TCP"},{"port":53,"protocol":"TCP"},{"port":53,"protocol":"UDP"},{"port":6443,"protocol":"TCP"}]}],"ingress":[{"ports":[{"protocol":"TCP","port":"http"}]}]}
   */
  networkPolicy?: NodefeaturediscoveryHelmValuesMasterNetworkPolicy;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-master pods.
   * -- NFD-Master
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-master pods.
   *
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesMasterAnnotations;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/labels
   * [Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) to add to the nfd-master pods.
   * -- NFD-Master
   *
   * [Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) to add to the nfd-master pods.
   *
   * @default {}
   */
  labels?: NodefeaturediscoveryHelmValuesMasterLabels;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Affinity
   * [Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) for the nfd-master pods.
   * -- NFD-Master
   *
   * [Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) for the nfd-master pods.
   *
   * @default {"nodeAffinity":{"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":1,"preference":{"matchExpressions":[{"key":"node-role.kubernetes.io/control-plane","operator":"In","values":[""]}]}}]}}
   */
  affinity?: NodefeaturediscoveryHelmValuesMasterAffinity;
  /**
   * Startup probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-startup-probes).
   * -- NFD-Master
   *
   * Startup probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-startup-probes).
   *
   * @default {...} (4 keys)
   */
  startupProbe?: NodefeaturediscoveryHelmValuesMasterStartupProbe;
  /**
   * Liveness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-liveness-probes).
   * -- NFD-Master
   *
   * Liveness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-liveness-probes).
   *
   * @default {...} (4 keys)
   */
  livenessProbe?: NodefeaturediscoveryHelmValuesMasterLivenessProbe;
  /**
   * Readiness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-readiness-probes).
   *
   * @default {...} (5 keys)
   */
  readinessProbe?: NodefeaturediscoveryHelmValuesMasterReadinessProbe;
};

export type NodefeaturediscoveryHelmValuesMasterDeploymentAnnotations = object;

export type NodefeaturediscoveryHelmValuesMasterPodSecurityContext = object;

export type NodefeaturediscoveryHelmValuesMasterSecurityContext = {
  /**
   * @schema hidden
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @schema hidden
   *
   * @default {"drop":["ALL"]}
   */
  capabilities?: NodefeaturediscoveryHelmValuesMasterSecurityContextCapabilities;
  /**
   * @schema hidden
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @schema hidden
   *
   * @default true
   */
  runAsNonRoot?: boolean;
};

export type NodefeaturediscoveryHelmValuesMasterSecurityContextCapabilities = {
  drop?: string[];
};

export type NodefeaturediscoveryHelmValuesMasterServiceAccount = {
  /**
   * Specifies whether a service account should be created.
   * -- NFD-Master
   *
   * Specifies whether a service account should be created.
   *
   * @default true
   */
  create?: boolean;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the service account
   * -- NFD-Master
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the service account
   *
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesMasterServiceAccountAnnotations;
  /**
   * @schema type: [string, null]
   * The name of the service account to use. If not set and create is true, a name is generated using the fullname template
   * -- NFD-Master
   * @schema type: [integer, null]
   * (int) Specifies the number of old ReplicaSets for the Deployment to retain. [revisionHistoryLimit](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#revision-history-limit)
   * -- NFD-Master
   *
   * The name of the service account to use. If not set and create is true, a name is generated using the fullname template
   *
   * @default null
   */
  name?: string | null;
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
   * Create [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) configuration for nfd-master.
   * -- NFD-Master
   *
   * Create [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) configuration for nfd-master.
   *
   * @default true
   */
  create?: boolean;
};

export type NodefeaturediscoveryHelmValuesMasterResources = {
  /**
   * @schema hidden
   * Resource [limits](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#requests-and-limits) for the nfd-master container.
   * -- NFD-Master
   *
   * @default {"memory":"4Gi"}
   */
  limits?: NodefeaturediscoveryHelmValuesMasterResourcesLimits;
  /**
   * @schema hidden
   * Resource [requests](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#requests-and-limits) for the nfd-master container.
   * -- NFD-Master
   *
   * @default {"cpu":"100m","memory":"128Mi"}
   */
  requests?: NodefeaturediscoveryHelmValuesMasterResourcesRequests;
};

export type NodefeaturediscoveryHelmValuesMasterResourcesLimits = {
  /**
   * @default "4Gi"
   */
  memory?: string;
};

export type NodefeaturediscoveryHelmValuesMasterResourcesRequests = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * You may want to use the same value for `requests.memory` and `limits.memory`. The “requests” value affects scheduling to accommodate pods on nodes.
   * If there is a large difference between “requests” and “limits” and nodes experience memory pressure, the kernel may invoke
   * the OOM Killer, even if the memory does not exceed the “limits” threshold. This can cause unexpected pod evictions. Memory
   * cannot be compressed and once allocated to a pod, it can only be reclaimed by killing the pod.
   * Natan Yellin 22/09/2022 https://home.robusta.dev/blog/kubernetes-memory-limit
   *
   * @default "128Mi"
   */
  memory?: string;
};

export type NodefeaturediscoveryHelmValuesMasterNodeSelector = object;

export type NodefeaturediscoveryHelmValuesMasterPodDisruptionBudget = {
  /**
   * Configure PodDisruptionBudget for the nfd-master Deployment.
   * -- NFD-Master
   *
   * Configure PodDisruptionBudget for the nfd-master Deployment.
   *
   * @default false
   */
  enable?: boolean;
  /**
   * @schema hidden
   * Minimum number (or percentage) of pods that must be available after the eviction.
   * -- NFD-Master
   *
   * @default 1
   */
  minAvailable?: number;
  /**
   * @schema hidden
   * Policy to evict unhealthy pods when a PodDisruptionBudget is defined.
   * -- NFD-Master
   *
   * @default "AlwaysAllow"
   */
  unhealthyPodEvictionPolicy?: string;
};

export type NodefeaturediscoveryHelmValuesMasterNetworkPolicy = {
  /**
   * Should a networkPolicy be deployed for the nfd-master pods
   * -- NFD-Master
   *
   * Should a networkPolicy be deployed for the nfd-master pods
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @schema itemRef: $k8s/_definitions.json#/definitions/io.k8s.api.networking.v1.NetworkPolicyEgressRule
   * [Egress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-master pods.
   * The minimum egress ports required to function are: DNS (53/udp, 53/tcp, API server (80/tcp, 443/tcp, 6443/tcp). NOTE: OKD and Openshift use 6443/tcp
   * -- NFD-Master
   * @schema itemRef: $k8s/_definitions.json#/definitions/io.k8s.api.networking.v1.NetworkPolicyIngressRule
   * [Ingress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-master pods.
   * -- NFD-Master
   *
   * [Egress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-master pods. The minimum egress ports required to function are: DNS (53/udp, 53/tcp, API server (80/tcp, 443/tcp, 6443/tcp). NOTE: OKD and Openshift use 6443/tcp
   *
   * @default [{"ports":[{"port":80,"protocol":"TCP"},{"port":443,"protocol":"TCP"},{"port":53,"protocol":"TCP"},{"port":53,"protocol":"UDP"},{"port":6443,"protocol":"TCP"}]}]
   */
  egress?: object[];
  /**
   * [Ingress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-master pods.
   *
   * @default [{"ports":[{"protocol":"TCP","port":"http"}]}]
   */
  ingress?: object[];
};

export type NodefeaturediscoveryHelmValuesMasterAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesMasterLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesMasterAffinity = {
  /**
   * @schema hidden
   *
   * @default {"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":1,"preference":{"matchExpressions":[{"key":"node-role.kubernetes.io/control-plane","operator":"In","values":[""]}]}}]}
   */
  nodeAffinity?: NodefeaturediscoveryHelmValuesMasterAffinityNodeAffinity;
};

export type NodefeaturediscoveryHelmValuesMasterAffinityNodeAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  preferredDuringSchedulingIgnoredDuringExecution?: NodefeaturediscoveryHelmValuesMasterAffinityNodeAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type NodefeaturediscoveryHelmValuesMasterAffinityNodeAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement =
  {
    /**
     * @default 1
     */
    weight?: number;
    /**
     * @default {"matchExpressions":[{"key":"node-role.kubernetes.io/control-plane","operator":"In","values":[""]}]}
     */
    preference?: NodefeaturediscoveryHelmValuesMasterAffinityNodeAffinityPreferredDuringSchedulingIgnoredDuringExecutionPreference;
  };

export type NodefeaturediscoveryHelmValuesMasterAffinityNodeAffinityPreferredDuringSchedulingIgnoredDuringExecutionPreference =
  {
    matchExpressions?: NodefeaturediscoveryHelmValuesMasterAffinityNodeAffinityPreferredDuringSchedulingIgnoredDuringExecutionPreferenceMatchExpressionsElement[];
  };

export type NodefeaturediscoveryHelmValuesMasterAffinityNodeAffinityPreferredDuringSchedulingIgnoredDuringExecutionPreferenceMatchExpressionsElement =
  {
    /**
     * @default "node-role.kubernetes.io/control-plane"
     */
    key?: string;
    /**
     * @default "In"
     */
    operator?: string;
    values?: string[];
  };

export type NodefeaturediscoveryHelmValuesMasterStartupProbe = {
  /**
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after the container has started before probe is initiated.
   *
   * @default null
   */
  initialDelaySeconds?: number | null;
  /**
   * (int) The number of seconds after which the probe times out.
   * -- NFD-Master
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after which the probe times out.
   *
   * @default null
   */
  timeoutSeconds?: number | null;
  /**
   * (int) How often (in seconds) to perform the probe.
   * -- NFD-Master
   * @schema type: [integer, null]; minimum: 1
   *
   * How often (in seconds) to perform the probe.
   *
   * @default null
   */
  periodSeconds?: number | null;
  /**
   * (int) The number of consecutive failures for the probe before considering the pod as not ready.
   * -- NFD-Master
   *
   * The number of consecutive failures for the probe before considering the pod as not ready.
   *
   * @default 30
   */
  failureThreshold?: number | null;
};

export type NodefeaturediscoveryHelmValuesMasterLivenessProbe = {
  /**
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after the container has started before probe is initiated.
   *
   * @default null
   */
  initialDelaySeconds?: number | null;
  /**
   * (int) The number of seconds after which the probe times out.
   * -- NFD-Master
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after which the probe times out.
   *
   * @default null
   */
  timeoutSeconds?: number | null;
  /**
   * (int) How often (in seconds) to perform the probe.
   * -- NFD-Master
   * @schema type: [integer, null]; minimum: 1
   *
   * How often (in seconds) to perform the probe.
   *
   * @default null
   */
  periodSeconds?: number | null;
  /**
   * (int) Minimum consecutive successes for the probe before considering the pod as ready.
   * -- NFD-Master
   * Readiness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-readiness-probes).
   * -- NFD-Master
   *
   * Minimum consecutive successes for the probe before considering the pod as ready.
   *
   * @default null
   */
  failureThreshold?: number | null;
};

export type NodefeaturediscoveryHelmValuesMasterReadinessProbe = {
  /**
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after the container has started before probe is initiated.
   *
   * @default null
   */
  initialDelaySeconds?: number | null;
  /**
   * (int) The number of seconds after which the probe times out.
   * -- NFD-Master
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after which the probe times out.
   *
   * @default null
   */
  timeoutSeconds?: number | null;
  /**
   * (int) How often (in seconds) to perform the probe.
   * -- NFD-Master
   * @schema type: [integer, null]; minimum: 1
   *
   * How often (in seconds) to perform the probe.
   *
   * @default null
   */
  periodSeconds?: number | null;
  /**
   * (int) Minimum consecutive successes for the probe before considering the pod as ready.
   * -- NFD-Master
   * @schema type: [integer, null]; minimum: 1
   *
   * Minimum consecutive successes for the probe before considering the pod as ready.
   *
   * @default null
   */
  successThreshold?: number | null;
  /**
   * (int) The number of consecutive failures for the probe before considering the pod as not ready.
   * -- NFD-Master
   *
   * The number of consecutive failures for the probe before considering the pod as not ready.
   *
   * @default 10
   */
  failureThreshold?: number | null;
};

export type NodefeaturediscoveryHelmValuesWorker = {
  /**
   * Specifies whether nfd-worker should be deployed
   * -- NFD-Worker
   *
   * Specifies whether nfd-worker should be deployed
   *
   * @default true
   */
  enable?: boolean;
  /**
   * @schema uniqueItems:true;item:string;itemEnum:["node","pod","ds"]
   * Objects used as owner references for NodeFeature objects. Valid values are `node`, `pod`, and `ds`. This value is passed through `-owner-refs` and takes precedence over `worker.config.core.ownerRefs`.
   * -- NFD-Worker
   *
   * Objects used as owner references for NodeFeature objects. Valid values are `node`, `pod`, and `ds`. This value is passed through `-owner-refs` and takes precedence over `worker.config.core.ownerRefs`.
   *
   * @default ["pod","ds"]
   */
  ownerRefs?: "node" | "pod" | "ds"[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Container/properties/args
   * Additional [command line arguments](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/worker-commandline-reference) to pass to nfd-worker.
   * -- NFD-Worker
   *
   * Additional [command line arguments](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/worker-commandline-reference) to pass to nfd-worker.
   *
   * @default []
   */
  extraArgs?: unknown[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Container/properties/env
   * Additional environment variables to set in the nfd-worker container.
   * -- NFD-Worker
   *
   * Additional environment variables to set in the nfd-worker container.
   *
   * @default []
   */
  extraEnvs?: unknown[];
  /**
   * Run the container in the host's network namespace.
   * -- NFD-Worker
   *
   * Run the container in the host's network namespace.
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @schema type: [boolean, null]
   * (bool) Run the container with host user ids. NOTE: if hostNetwork is true, hostUsers should be true.
   * -- NFD-Worker
   * @schema type: [boolean, null]
   *
   * Run the container with host user ids. NOTE: if hostNetwork is true, hostUsers should be true.
   *
   * @default null
   */
  hostUsers?: boolean | null;
  /**
   * @enum: [Default, ClusterFirst, ClusterFirstWithHostNet, None]
   * NFD worker pod [dnsPolicy](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-dns-policy).
   * -- NFD-Worker
   *
   * NFD worker pod [dnsPolicy](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-dns-policy).
   *
   * @default "ClusterFirstWithHostNet"
   */
  dnsPolicy?: string;
  /**
   * @schema type: [object, null]
   * NFD worker [configuration](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/worker-configuration-reference).
   * -- NFD-Worker
   * The following features demonstreate label templating capabilities
   * ID: {op: InRegexp, value: ["^open.*"]}
   * VERSION_ID.major: {op: In, value: ["13", "15"]}
   * AVX: {op: Exists}
   * The following examples demonstrate vars field and back-referencing
   * previous labels and vars
   * @schema type: integer; minimum: 1; maximum: 65535
   * Port on which to serve http for metrics and healthz endpoints.
   * -- NFD-Worker
   *
   * NFD worker [configuration](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/worker-configuration-reference).
   *
   * @default null
   */
  config?: object | null;
  /**
   * Port on which to serve http for metrics and healthz endpoints.
   *
   * @default 8080
   */
  port?: number;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-worker DaemonSet.
   * -- NFD-Worker
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-worker DaemonSet.
   *
   * @default {}
   */
  daemonsetAnnotations?: NodefeaturediscoveryHelmValuesWorkerDaemonsetAnnotations;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSecurityContext
   * [Pod SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod) of the nfd-worker pods.
   * -- NFD-Worker
   *
   * [Pod SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod) of the nfd-worker pods.
   *
   * @default {}
   */
  podSecurityContext?: NodefeaturediscoveryHelmValuesWorkerPodSecurityContext;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/initContainers
   * [Init containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) to add to the nfd-worker pods.
   * -- NFD-Worker
   *
   * [Init containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) to add to the nfd-worker pods.
   *
   * @default []
   */
  initContainers?: unknown[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.SecurityContext
   * [SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container) of the nfd-worker container.
   * -- NFD-Worker
   *
   * [SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container) of the nfd-worker container.
   *
   * @default {...} (4 keys)
   */
  securityContext?: NodefeaturediscoveryHelmValuesWorkerSecurityContext;
  /**
   * Liveness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-liveness-probes).
   * -- NFD-Worker
   *
   * Liveness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-liveness-probes).
   *
   * @default {...} (4 keys)
   */
  livenessProbe?: NodefeaturediscoveryHelmValuesWorkerLivenessProbe;
  /**
   * Readiness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-readiness-probes).
   *
   * @default {...} (5 keys)
   */
  readinessProbe?: NodefeaturediscoveryHelmValuesWorkerReadinessProbe;
  /**
   * @default {"create":true,"annotations":{},"name":null}
   */
  serviceAccount?: NodefeaturediscoveryHelmValuesWorkerServiceAccount;
  /**
   * Specifies the number of old history for the DaemonSet to retain to allow rollback.
   *
   * @default null
   */
  revisionHistoryLimit?: number | null;
  /**
   * @default {"create":true}
   */
  rbac?: NodefeaturediscoveryHelmValuesWorkerRbac;
  /**
   * Allow users to mount the hostPath /usr/src, useful for RHCOS on s390x
   * Does not work on systems without /usr/src AND a read-only /usr, such as Talos
   * Mount host path /user/src inside the container. Does not work on systems without /usr/src AND a read-only /usr.
   * -- NFD-Worker
   *
   * Mount host path /user/src inside the container. Does not work on systems without /usr/src AND a read-only /usr.
   *
   * @default false
   */
  mountUsrSrc?: boolean;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.ResourceRequirements
   *
   * @default {"limits":{"memory":"512Mi"},"requests":{"cpu":"5m","memory":"64Mi"}}
   */
  resources?: NodefeaturediscoveryHelmValuesWorkerResources;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/nodeSelector
   * [Node selector](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector) for the nfd-worker pods.
   * -- NFD-Worker
   *
   * [Node selector](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector) for the nfd-worker pods.
   *
   * @default {}
   */
  nodeSelector?: NodefeaturediscoveryHelmValuesWorkerNodeSelector;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/tolerations
   * [Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) for the nfd-worker pods.
   * -- NFD-Worker
   *
   * [Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) for the nfd-worker pods.
   *
   * @default []
   */
  tolerations?: unknown[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-worker pods.
   * -- NFD-Worker
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-worker pods.
   *
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesWorkerAnnotations;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/labels
   * [Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) to add to the nfd-worker pods.
   * -- NFD-Worker
   *
   * [Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) to add to the nfd-worker pods.
   *
   * @default {}
   */
  labels?: NodefeaturediscoveryHelmValuesWorkerLabels;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Affinity
   * [Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) for the nfd-worker pods.
   * -- NFD-Worker
   *
   * [Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) for the nfd-worker pods.
   *
   * @default {}
   */
  affinity?: NodefeaturediscoveryHelmValuesWorkerAffinity;
  /**
   * @schema type: [string, null]
   * The name of the PriorityClass to be used for the nfd-worker pods.
   * -- NFD-Worker
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.apps.v1.DaemonSetUpdateStrategy
   *
   * The name of the PriorityClass to be used for the nfd-worker pods.
   *
   * @default null
   */
  priorityClassName?: string | null;
  /**
   * Update strategy for the nfd-worker DaemonSet. Defaults to a rolling
   * update with `maxUnavailable: "10%"` so upgrades complete in a bounded
   * number of waves on clusters of any size (the Kubernetes default of
   * `maxUnavailable: 1` rolls one node at a time and makes Helm wait and
   * Flux HelmRelease timeouts likely on large clusters). nfd-worker is
   * stateless and node labels persist while a worker pod restarts, so a
   * faster roll is safe. Set `maxUnavailable: 1` to restore the Kubernetes
   * default. To use `type: OnDelete`, also set `rollingUpdate: null`
   * (Helm deep-merges maps).
   * [More info](https://kubernetes.io/docs/tasks/manage-daemon/update-daemon-set)
   * -- NFD-Worker
   *
   * Update strategy for the nfd-worker DaemonSet. Defaults to a rolling update with `maxUnavailable: "10%"` so upgrades complete in a bounded number of waves on clusters of any size (the Kubernetes default of `maxUnavailable: 1` rolls one node at a time and makes Helm wait and Flux HelmRelease timeouts likely on large clusters). nfd-worker is stateless and node labels persist while a worker pod restarts, so a faster roll is safe. Set `maxUnavailable: 1` to restore the Kubernetes default. To use `type: OnDelete`, also set `rollingUpdate: null` (Helm deep-merges maps). [More info](https://kubernetes.io/docs/tasks/manage-daemon/update-daemon-set)
   *
   * @default {"rollingUpdate":{"maxUnavailable":"10%"}}
   */
  updateStrategy?: NodefeaturediscoveryHelmValuesWorkerUpdateStrategy;
  /**
   * -- NFD-Worker
   *
   * @default {"enabled":false,"egress":[{"ports":[{"port":80,"protocol":"TCP"},{"port":443,"protocol":"TCP"},{"port":53,"protocol":"TCP"},{"port":53,"protocol":"UDP"},{"port":6443,"protocol":"TCP"}]}],"ingress":[{"ports":[{"protocol":"TCP","port":"http"}]}]}
   */
  networkPolicy?: NodefeaturediscoveryHelmValuesWorkerNetworkPolicy;
};

export type NodefeaturediscoveryHelmValuesWorkerDaemonsetAnnotations = object;

export type NodefeaturediscoveryHelmValuesWorkerPodSecurityContext = object;

export type NodefeaturediscoveryHelmValuesWorkerSecurityContext = {
  /**
   * @schema hidden
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @schema hidden
   *
   * @default {"drop":["ALL"]}
   */
  capabilities?: NodefeaturediscoveryHelmValuesWorkerSecurityContextCapabilities;
  /**
   * @schema hidden
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @schema hidden
   *
   * @default true
   */
  runAsNonRoot?: boolean;
};

export type NodefeaturediscoveryHelmValuesWorkerSecurityContextCapabilities = {
  drop?: string[];
};

export type NodefeaturediscoveryHelmValuesWorkerLivenessProbe = {
  /**
   * @schema type: [integer, null]
   * (int) The number of seconds after the container has started before probe is initiated.
   * -- NFD-Worker
   *
   * The number of seconds after the container has started before probe is initiated.
   *
   * @default 10
   */
  initialDelaySeconds?: number | null;
  /**
   * @schema type: [integer, null]; minimum: 1
   * (int) The number of seconds after which the probe times out.
   * -- NFD-Worker
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after which the probe times out.
   *
   * @default null
   */
  timeoutSeconds?: number | null;
  /**
   * (int) How often (in seconds) to perform the probe.
   * -- NFD-Worker
   * @schema type: [integer, null]; minimum: 1
   *
   * How often (in seconds) to perform the probe.
   *
   * @default null
   */
  periodSeconds?: number | null;
  /**
   * (int) Minimum consecutive successes for the probe before considering the pod as ready.
   * -- NFD-Worker
   * Readiness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-readiness-probes).
   * -- NFD-Worker
   *
   * Minimum consecutive successes for the probe before considering the pod as ready.
   *
   * @default null
   */
  failureThreshold?: number | null;
};

export type NodefeaturediscoveryHelmValuesWorkerReadinessProbe = {
  /**
   * @schema type: [integer, null]
   * (int) The number of seconds after the container has started before probe is initiated.
   * -- NFD-Worker
   *
   * The number of seconds after the container has started before probe is initiated.
   *
   * @default 5
   */
  initialDelaySeconds?: number | null;
  /**
   * @schema type: [integer, null]; minimum: 1
   * (int) The number of seconds after which the probe times out.
   * -- NFD-Worker
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after which the probe times out.
   *
   * @default null
   */
  timeoutSeconds?: number | null;
  /**
   * (int) How often (in seconds) to perform the probe.
   * -- NFD-Worker
   * @schema type: [integer, null]; minimum: 1
   *
   * How often (in seconds) to perform the probe.
   *
   * @default null
   */
  periodSeconds?: number | null;
  /**
   * (int) Minimum consecutive successes for the probe before considering the pod as ready.
   * -- NFD-Worker
   * @schema type: [integer, null]; minimum: 1
   *
   * Minimum consecutive successes for the probe before considering the pod as ready.
   *
   * @default null
   */
  successThreshold?: number | null;
  /**
   * (int) The number of consecutive failures for the probe before considering the pod as not ready.
   * -- NFD-Worker
   *
   * The number of consecutive failures for the probe before considering the pod as not ready.
   *
   * @default 10
   */
  failureThreshold?: number | null;
};

export type NodefeaturediscoveryHelmValuesWorkerServiceAccount = {
  /**
   * Specifies whether a service account should be created.
   * -- NFD-Worker
   *
   * Specifies whether a service account should be created.
   *
   * @default true
   */
  create?: boolean;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the service account
   * -- NFD-Worker
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the service account
   *
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesWorkerServiceAccountAnnotations;
  /**
   * @schema type: [string, null]
   * Name of the service account to use. If not set and create is true, a name is generated using the fullname template
   * -- NFD-Worker
   * @schema type: [integer, null]
   * (int) Specifies the number of old history for the DaemonSet to retain to allow rollback.
   * -- NFD-Worker
   *
   * Name of the service account to use. If not set and create is true, a name is generated using the fullname template
   *
   * @default null
   */
  name?: string | null;
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
   * Create [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) configuration for nfd-worker.
   * -- NFD-Worker
   *
   * Create [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) configuration for nfd-worker.
   *
   * @default true
   */
  create?: boolean;
};

export type NodefeaturediscoveryHelmValuesWorkerResources = {
  /**
   * @schema hidden
   * Resource [limits](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#requests-and-limits) for the nfd-worker container.
   * -- NFD-Worker
   *
   * @default {"memory":"512Mi"}
   */
  limits?: NodefeaturediscoveryHelmValuesWorkerResourcesLimits;
  /**
   * @schema hidden
   * Resource [requests](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#requests-and-limits) for the nfd-worker container.
   * -- NFD-Worker
   *
   * @default {"cpu":"5m","memory":"64Mi"}
   */
  requests?: NodefeaturediscoveryHelmValuesWorkerResourcesRequests;
};

export type NodefeaturediscoveryHelmValuesWorkerResourcesLimits = {
  /**
   * @default "512Mi"
   */
  memory?: string;
};

export type NodefeaturediscoveryHelmValuesWorkerResourcesRequests = {
  /**
   * @default "5m"
   */
  cpu?: string;
  /**
   * @default "64Mi"
   */
  memory?: string;
};

export type NodefeaturediscoveryHelmValuesWorkerNodeSelector = object;

export type NodefeaturediscoveryHelmValuesWorkerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesWorkerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesWorkerAffinity = object;

export type NodefeaturediscoveryHelmValuesWorkerUpdateStrategy = {
  /**
   * @default {"maxUnavailable":"10%"}
   */
  rollingUpdate?: NodefeaturediscoveryHelmValuesWorkerUpdateStrategyRollingUpdate;
};

export type NodefeaturediscoveryHelmValuesWorkerUpdateStrategyRollingUpdate = {
  /**
   * @schema type: [string, integer]
   *
   * @default "10%"
   */
  maxUnavailable?: string | number;
};

export type NodefeaturediscoveryHelmValuesWorkerNetworkPolicy = {
  /**
   * Should a networkPolicy be deployed for the nfd-worker pods
   * -- NFD-Worker
   *
   * Should a networkPolicy be deployed for the nfd-worker pods
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @schema itemRef: $k8s/_definitions.json#/definitions/io.k8s.api.networking.v1.NetworkPolicyEgressRule
   * [Egress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-worker pods.
   * The minimum egress ports required to function are: DNS (53/udp, 53/tcp, API server (80/tcp, 443/tcp, 6443/tcp). NOTE: OKD and Openshift use 6443/tcp
   * -- NFD-Worker
   * @schema itemRef: $k8s/_definitions.json#/definitions/io.k8s.api.networking.v1.NetworkPolicyIngressRule
   * [Ingress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-worker pods.
   * -- NFD-Worker
   *
   * [Egress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-worker pods. The minimum egress ports required to function are: DNS (53/udp, 53/tcp, API server (80/tcp, 443/tcp, 6443/tcp). NOTE: OKD and Openshift use 6443/tcp
   *
   * @default [{"ports":[{"port":80,"protocol":"TCP"},{"port":443,"protocol":"TCP"},{"port":53,"protocol":"TCP"},{"port":53,"protocol":"UDP"},{"port":6443,"protocol":"TCP"}]}]
   */
  egress?: object[];
  /**
   * [Ingress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-worker pods.
   *
   * @default [{"ports":[{"protocol":"TCP","port":"http"}]}]
   */
  ingress?: object[];
};

export type NodefeaturediscoveryHelmValuesTopologyUpdater = {
  /**
   * *: [hugepages-2Mi]
   * <NFD-TOPOLOGY-UPDATER-CONF-END-DO-NOT-REMOVE>
   * Specifies whether nfd-topology-updater should be deployed.
   * -- NFD-Topology-Updater
   *
   * Configuration for the topology updater. See the [configuration reference](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/topology-updater-configuration-reference) for details.
   *
   * @default null
   */
  config?: object | null;
  /**
   * Specifies whether nfd-topology-updater should be deployed.
   *
   * @default false
   */
  enable?: boolean;
  /**
   * Create the NodeResourceTopology CRD. This MUST be set to true when
   * 'enable' is true, unless the CRD is installed separately (e.g., by another
   * Helm release or external tool). If the CRD is missing, the topology-updater
   * pods will fail with "NodeResourceTopology CRD is not installed" error.
   * -- NFD-Topology-Updater
   *
   * Create the NodeResourceTopology CRD. This MUST be set to true when 'enable' is true, unless the CRD is installed separately (e.g., by another Helm release or external tool). If the CRD is missing, the topology-updater pods will fail with "NodeResourceTopology CRD is not installed" error.
   *
   * @default false
   */
  createCRDs?: boolean;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Container/properties/args
   * Additional [command line arguments](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/topology-updater-commandline-reference) to pass to nfd-topology-updater.
   * -- NFD-Topology-Updater
   *
   * Additional [command line arguments](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/topology-updater-commandline-reference) to pass to nfd-topology-updater.
   *
   * @default []
   */
  extraArgs?: unknown[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Container/properties/env
   * Additional environment variables to set in the nfd-topology-updater container.
   * -- NFD-Topology-Updater
   *
   * Additional environment variables to set in the nfd-topology-updater container.
   *
   * @default []
   */
  extraEnvs?: unknown[];
  /**
   * Run the container in the host's network namespace.
   * -- NFD-Topology-Updater
   *
   * Run the container in the host's network namespace.
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @schema type: [boolean, null]
   * (bool) Run the container with host user ids. NOTE: if hostNetwork is true, hostUsers should be true.
   * -- NFD-Topology-Updater
   * @schema type: [boolean, null]
   *
   * Run the container with host user ids. NOTE: if hostNetwork is true, hostUsers should be true.
   *
   * @default null
   */
  hostUsers?: boolean | null;
  /**
   * @enum: [Default, ClusterFirst, ClusterFirstWithHostNet, None]
   * NFD topology updater pod [dnsPolicy](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-dns-policy).
   * -- NFD-Topology-Updater
   *
   * NFD topology updater pod [dnsPolicy](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-dns-policy).
   *
   * @default "ClusterFirstWithHostNet"
   */
  dnsPolicy?: string;
  /**
   * @default {"create":true,"annotations":{},"name":null}
   */
  serviceAccount?: NodefeaturediscoveryHelmValuesTopologyUpdaterServiceAccount;
  /**
   * Specifies the number of old history for the DaemonSet to retain to allow rollback.
   *
   * @default null
   */
  revisionHistoryLimit?: number | null;
  /**
   * @default {"create":true}
   */
  rbac?: NodefeaturediscoveryHelmValuesTopologyUpdaterRbac;
  /**
   * @schema type: integer; minimum: 1; maximum: 65535
   * Port on which to serve http for metrics and healthz endpoints.
   * -- NFD-Topology-Updater
   *
   * Port on which to serve http for metrics and healthz endpoints.
   *
   * @default 8080
   */
  port?: number;
  /**
   * @schema type: [string, null]
   * Host path for the kubelet config file.
   * -- NFD-Topology-Updater
   * @schema type: [string, null]
   *
   * Host path for the kubelet config file.
   *
   * @default null
   */
  kubeletConfigPath?: string | null;
  /**
   * Host path for the kubelet socket for podresources endpoint.
   * -- NFD-Topology-Updater
   * Time to sleep between CR updates. Non-positive value implies no CR update.
   *
   * Host path for the kubelet socket for podresources endpoint.
   *
   * @default null
   */
  kubeletPodResourcesSockPath?: string | null;
  /**
   * -- NFD-Topology-Updater
   *
   * Time to sleep between CR updates. Non-positive value implies no CR update.
   *
   * @default "60s"
   */
  updateInterval?: string;
  /**
   * Namespace to watch pods, `*` for all namespaces.
   * -- NFD-Topology-Updater
   *
   * Namespace to watch pods, `*` for all namespaces.
   *
   * @default "*"
   */
  watchNamespace?: string;
  /**
   * The kubelet state directory path for watching state and checkpoint files. Empty value disables kubelet state tracking.
   * -- NFD-Topology-Updater
   *
   * The kubelet state directory path for watching state and checkpoint files. Empty value disables kubelet state tracking.
   *
   * @default "/var/lib/kubelet"
   */
  kubeletStateDir?: string;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSecurityContext
   * [Pod SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod) of the nfd-topology-updater pods.
   * -- NFD-Topology-Updater
   *
   * [Pod SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod) of the nfd-topology-updater pods.
   *
   * @default {}
   */
  podSecurityContext?: NodefeaturediscoveryHelmValuesTopologyUpdaterPodSecurityContext;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/initContainers
   * [Init containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) to add to the nfd-topology-updater pods.
   * -- NFD-Topology-Updater
   *
   * [Init containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) to add to the nfd-topology-updater pods.
   *
   * @default []
   */
  initContainers?: unknown[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.SecurityContext
   * [SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container) of the nfd-topology-updater container.
   * -- NFD-Topology-Updater
   *
   * [SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container) of the nfd-topology-updater container.
   *
   * @default {...} (4 keys)
   */
  securityContext?: NodefeaturediscoveryHelmValuesTopologyUpdaterSecurityContext;
  /**
   * Liveness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-liveness-probes).
   * -- NFD-Topology-Updater
   *
   * Liveness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-liveness-probes).
   *
   * @default {...} (4 keys)
   */
  livenessProbe?: NodefeaturediscoveryHelmValuesTopologyUpdaterLivenessProbe;
  /**
   * Readiness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-readiness-probes).
   *
   * @default {...} (5 keys)
   */
  readinessProbe?: NodefeaturediscoveryHelmValuesTopologyUpdaterReadinessProbe;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.ResourceRequirements
   *
   * @default {"limits":{"memory":"60Mi"},"requests":{"cpu":"50m","memory":"40Mi"}}
   */
  resources?: NodefeaturediscoveryHelmValuesTopologyUpdaterResources;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/nodeSelector
   * [Node selector](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector) for the nfd-topology-updater pods.
   * -- NFD-Topology-Updater
   *
   * [Node selector](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector) for the nfd-topology-updater pods.
   *
   * @default {}
   */
  nodeSelector?: NodefeaturediscoveryHelmValuesTopologyUpdaterNodeSelector;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/tolerations
   * [Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) for the nfd-topology-updater pods.
   * -- NFD-Topology-Updater
   *
   * [Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) for the nfd-topology-updater pods.
   *
   * @default []
   */
  tolerations?: unknown[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-topology-updater pods.
   * -- NFD-Topology-Updater
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-topology-updater pods.
   *
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesTopologyUpdaterAnnotations;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/labels
   * [Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) to add to the nfd-topology-updater pods.
   * -- NFD-Topology-Updater
   *
   * [Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) to add to the nfd-topology-updater pods.
   *
   * @default {}
   */
  labels?: NodefeaturediscoveryHelmValuesTopologyUpdaterLabels;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-topology-updater DaemonSet.
   * -- NFD-Topology-Updater
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-topology-updater DaemonSet.
   *
   * @default {}
   */
  daemonsetAnnotations?: NodefeaturediscoveryHelmValuesTopologyUpdaterDaemonsetAnnotations;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Affinity
   * [Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) for the nfd-topology-updater pods.
   * -- NFD-Topology-Updater
   *
   * [Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) for the nfd-topology-updater pods.
   *
   * @default {}
   */
  affinity?: NodefeaturediscoveryHelmValuesTopologyUpdaterAffinity;
  /**
   * Enables compute and report of pod fingerprint in NRT objects.
   * -- NFD-Topology-Updater
   *
   * Enables compute and report of pod fingerprint in NRT objects.
   *
   * @default true
   */
  podSetFingerprint?: boolean;
  /**
   * -- NFD-Topology-Updater
   *
   * @default {"enabled":false,"egress":[{"ports":[{"port":80,"protocol":"TCP"},{"port":443,"protocol":"TCP"},{"port":53,"protocol":"TCP"},{"port":53,"protocol":"UDP"},{"port":6443,"protocol":"TCP"}]}],"ingress":[{"ports":[{"protocol":"TCP","port":"http"}]}]}
   */
  networkPolicy?: NodefeaturediscoveryHelmValuesTopologyUpdaterNetworkPolicy;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterServiceAccount = {
  /**
   * Specifies whether a service account should be created.
   * -- NFD-Topology-Updater
   *
   * Specifies whether a service account should be created.
   *
   * @default true
   */
  create?: boolean;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the service account.
   * -- NFD-Topology-Updater
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the service account.
   *
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesTopologyUpdaterServiceAccountAnnotations;
  /**
   * @schema type: [string, null]
   * Name or the service account to use. If not set and create is true, a name is generated using the fullname template.
   * -- NFD-Topology-Updater
   * @schema type: [integer, null]
   * (int) Specifies the number of old history for the DaemonSet to retain to allow rollback.
   * -- NFD-Topology-Updater
   *
   * Name or the service account to use. If not set and create is true, a name is generated using the fullname template.
   *
   * @default null
   */
  name?: string | null;
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
   * Create [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) configuration for nfd-topology-updater.
   * -- NFD-Topology-Updater
   *
   * Create [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) configuration for nfd-topology-updater.
   *
   * @default true
   */
  create?: boolean;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterPodSecurityContext =
  object;

export type NodefeaturediscoveryHelmValuesTopologyUpdaterSecurityContext = {
  /**
   * @schema hidden
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @schema hidden
   *
   * @default {"drop":["ALL"]}
   */
  capabilities?: NodefeaturediscoveryHelmValuesTopologyUpdaterSecurityContextCapabilities;
  /**
   * @schema hidden
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @schema hidden
   *
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
   * @schema type: [integer, null]
   * (int) The number of seconds after the container has started before probe is initiated.
   * -- NFD-Topology-Updater
   *
   * The number of seconds after the container has started before probe is initiated.
   *
   * @default 10
   */
  initialDelaySeconds?: number | null;
  /**
   * @schema type: [integer, null]; minimum: 1
   * (int) The number of seconds after which the probe times out.
   * -- NFD-Topology-Updater
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after which the probe times out.
   *
   * @default null
   */
  timeoutSeconds?: number | null;
  /**
   * (int) How often (in seconds) to perform the probe.
   * -- NFD-Topology-Updater
   * @schema type: [integer, null]; minimum: 1
   *
   * How often (in seconds) to perform the probe.
   *
   * @default null
   */
  periodSeconds?: number | null;
  /**
   * (int) Minimum consecutive successes for the probe before considering the pod as ready.
   * -- NFD-Topology-Updater
   * Readiness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-readiness-probes).
   * -- NFD-Topology-Updater
   *
   * Minimum consecutive successes for the probe before considering the pod as ready.
   *
   * @default null
   */
  failureThreshold?: number | null;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterReadinessProbe = {
  /**
   * @schema type: [integer, null]
   * (int) The number of seconds after the container has started before probe is initiated.
   * -- NFD-Topology-Updater
   *
   * The number of seconds after the container has started before probe is initiated.
   *
   * @default 5
   */
  initialDelaySeconds?: number | null;
  /**
   * @schema type: [integer, null]; minimum: 1
   * (int) The number of seconds after which the probe times out.
   * -- NFD-Topology-Updater
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after which the probe times out.
   *
   * @default null
   */
  timeoutSeconds?: number | null;
  /**
   * (int) How often (in seconds) to perform the probe.
   * -- NFD-Topology-Updater
   * @schema type: [integer, null]; minimum: 1
   *
   * How often (in seconds) to perform the probe.
   *
   * @default null
   */
  periodSeconds?: number | null;
  /**
   * (int) Minimum consecutive successes for the probe before considering the pod as ready.
   * -- NFD-Topology-Updater
   * @schema type: [integer, null]; minimum: 1
   *
   * Minimum consecutive successes for the probe before considering the pod as ready.
   *
   * @default null
   */
  successThreshold?: number | null;
  /**
   * (int) The number of consecutive failures for the probe before considering the pod as not ready.
   * -- NFD-Topology-Updater
   *
   * The number of consecutive failures for the probe before considering the pod as not ready.
   *
   * @default 10
   */
  failureThreshold?: number | null;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterResources = {
  /**
   * @schema hidden
   * Resource [limits](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#requests-and-limits) for the nfd-topology-updater container.
   * -- NFD-Topology-Updater
   *
   * @default {"memory":"60Mi"}
   */
  limits?: NodefeaturediscoveryHelmValuesTopologyUpdaterResourcesLimits;
  /**
   * @schema hidden
   * Resource [requests](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#requests-and-limits) for the nfd-topology-updater container.
   * -- NFD-Topology-Updater
   *
   * @default {"cpu":"50m","memory":"40Mi"}
   */
  requests?: NodefeaturediscoveryHelmValuesTopologyUpdaterResourcesRequests;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterResourcesLimits = {
  /**
   * @default "60Mi"
   */
  memory?: string;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterResourcesRequests = {
  /**
   * @default "50m"
   */
  cpu?: string;
  /**
   * @default "40Mi"
   */
  memory?: string;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterNodeSelector = object;

export type NodefeaturediscoveryHelmValuesTopologyUpdaterAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesTopologyUpdaterDaemonsetAnnotations =
  object;

export type NodefeaturediscoveryHelmValuesTopologyUpdaterAffinity = object;

export type NodefeaturediscoveryHelmValuesTopologyUpdaterNetworkPolicy = {
  /**
   * Should a networkPolicy be deployed for the nfd-topology pods
   * -- NFD-Topology-Updater
   *
   * Should a networkPolicy be deployed for the nfd-topology pods
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @schema itemRef: $k8s/_definitions.json#/definitions/io.k8s.api.networking.v1.NetworkPolicyEgressRule
   * [Egress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-topology pods.
   * The minimum egress ports required to function are: DNS (53/udp, 53/tcp, API server (80/tcp, 443/tcp, 6443/tcp). NOTE: OKD and Openshift use 6443/tcp
   * -- NFD-Topology-Updater
   * @schema itemRef: $k8s/_definitions.json#/definitions/io.k8s.api.networking.v1.NetworkPolicyIngressRule
   * [Ingress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-topology pods.
   * -- NFD-Topology-Updater
   *
   * [Egress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-topology pods. The minimum egress ports required to function are: DNS (53/udp, 53/tcp, API server (80/tcp, 443/tcp, 6443/tcp). NOTE: OKD and Openshift use 6443/tcp
   *
   * @default [{"ports":[{"port":80,"protocol":"TCP"},{"port":443,"protocol":"TCP"},{"port":53,"protocol":"TCP"},{"port":53,"protocol":"UDP"},{"port":6443,"protocol":"TCP"}]}]
   */
  egress?: object[];
  /**
   * [Ingress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-topology pods.
   *
   * @default [{"ports":[{"protocol":"TCP","port":"http"}]}]
   */
  ingress?: object[];
};

export type NodefeaturediscoveryHelmValuesGc = {
  /**
   * Specifies whether nfd-gc should be deployed.
   * -- NFD-GC
   *
   * Specifies whether nfd-gc should be deployed.
   *
   * @default true
   */
  enable?: boolean;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Container/properties/args
   * Additional [command line arguments](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/gc-commandline-reference) to pass to nfd-gc.
   * -- NFD-GC
   *
   * Additional [command line arguments](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/gc-commandline-reference) to pass to nfd-gc.
   *
   * @default []
   */
  extraArgs?: unknown[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Container/properties/env
   * Additional environment variables to set in the nfd-gc container.
   * -- NFD-GC
   *
   * Additional environment variables to set in the nfd-gc container.
   *
   * @default []
   */
  extraEnvs?: unknown[];
  /**
   * Run the container in the host's network namespace.
   * -- NFD-GC
   *
   * Run the container in the host's network namespace.
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @schema type: [boolean, null]
   * (bool) Run the container with host user ids. NOTE: if hostNetwork is true, hostUsers should be true.
   * -- NFD-GC
   * @schema type: [boolean, null]
   *
   * Run the container with host user ids. NOTE: if hostNetwork is true, hostUsers should be true.
   *
   * @default null
   */
  hostUsers?: boolean | null;
  /**
   * The number of desired replicas for the nfd-gc Deployment.
   * -- NFD-GC
   *
   * The number of desired replicas for the nfd-gc Deployment.
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * @enum: [Default, ClusterFirst, ClusterFirstWithHostNet, None]
   * NFD gc pod [dnsPolicy](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-dns-policy).
   * -- NFD-GC
   *
   * NFD gc pod [dnsPolicy](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-dns-policy).
   *
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
   * Time between periodic garbage collector runs.
   * -- NFD-GC
   *
   * Time between periodic garbage collector runs.
   *
   * @default "1h"
   */
  interval?: string;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSecurityContext
   * [Pod SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod) of the nfd-gc pods.
   * -- NFD-GC
   *
   * [Pod SecurityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod) of the nfd-gc pods.
   *
   * @default {}
   */
  podSecurityContext?: NodefeaturediscoveryHelmValuesGcPodSecurityContext;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/initContainers
   * [Init containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) to add to the nfd-gc pods.
   * -- NFD-GC
   *
   * [Init containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) to add to the nfd-gc pods.
   *
   * @default []
   */
  initContainers?: unknown[];
  /**
   * Liveness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-liveness-probes).
   * -- NFD-GC
   *
   * Liveness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-liveness-probes).
   *
   * @default {...} (4 keys)
   */
  livenessProbe?: NodefeaturediscoveryHelmValuesGcLivenessProbe;
  /**
   * Readiness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-readiness-probes).
   *
   * @default {...} (5 keys)
   */
  readinessProbe?: NodefeaturediscoveryHelmValuesGcReadinessProbe;
  /**
   * @default {"limits":{"memory":"1Gi"},"requests":{"cpu":"10m","memory":"128Mi"}}
   */
  resources?: NodefeaturediscoveryHelmValuesGcResources;
  /**
   * @schema type: integer; minimum: 1; maximum: 65535
   * Port on which to serve http for metrics and healthz endpoints.
   * -- NFD-GC
   *
   * Port on which to serve http for metrics and healthz endpoints.
   *
   * @default 8080
   */
  port?: number;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/nodeSelector
   * [Node selector](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector) for the nfd-gc pods.
   * -- NFD-GC
   *
   * [Node selector](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector) for the nfd-gc pods.
   *
   * @default {}
   */
  nodeSelector?: NodefeaturediscoveryHelmValuesGcNodeSelector;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/tolerations
   * [Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) for the nfd-gc pods.
   * -- NFD-GC
   *
   * [Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) for the nfd-gc pods.
   *
   * @default []
   */
  tolerations?: unknown[];
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-gc pods.
   * -- NFD-GC
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-gc pods.
   *
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesGcAnnotations;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/labels
   * [Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) to add to the nfd-gc pods.
   * -- NFD-GC
   *
   * [Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) to add to the nfd-gc pods.
   *
   * @default {}
   */
  labels?: NodefeaturediscoveryHelmValuesGcLabels;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-gc  Deployment.
   * -- NFD-GC
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the nfd-gc  Deployment.
   *
   * @default {}
   */
  deploymentAnnotations?: NodefeaturediscoveryHelmValuesGcDeploymentAnnotations;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.Affinity
   * [Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) for the nfd-gc pods.
   * -- NFD-GC
   *
   * [Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) for the nfd-gc pods.
   *
   * @default {}
   */
  affinity?: NodefeaturediscoveryHelmValuesGcAffinity;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.policy.v1.PodDisruptionBudgetSpec
   *
   * @default {"enable":false,"minAvailable":1,"unhealthyPodEvictionPolicy":"AlwaysAllow"}
   */
  podDisruptionBudget?: NodefeaturediscoveryHelmValuesGcPodDisruptionBudget;
  /**
   * @schema type: [integer, null]
   * (int) Specifies the number of old history for the Deployment to retain to allow rollback.
   * -- NFD-GC
   * -- NFD-GC
   *
   * Specifies the number of old history for the Deployment to retain to allow rollback.
   *
   * @default null
   */
  revisionHistoryLimit?: number | null;
  /**
   * @default {"enabled":false,"egress":[{"ports":[{"port":80,"protocol":"TCP"},{"port":443,"protocol":"TCP"},{"port":53,"protocol":"TCP"},{"port":53,"protocol":"UDP"},{"port":6443,"protocol":"TCP"}]}],"ingress":[{"ports":[{"protocol":"TCP","port":"http"}]}]}
   */
  networkPolicy?: NodefeaturediscoveryHelmValuesGcNetworkPolicy;
};

export type NodefeaturediscoveryHelmValuesGcServiceAccount = {
  /**
   * Specifies whether a service account should be created.
   * -- NFD-GC
   *
   * Specifies whether a service account should be created.
   *
   * @default true
   */
  create?: boolean;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta/properties/annotations
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the service account.
   * -- NFD-GC
   *
   * [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations) to add to the service account.
   *
   * @default {}
   */
  annotations?: NodefeaturediscoveryHelmValuesGcServiceAccountAnnotations;
  /**
   * @schema type: [string, null]
   * Name of the service account to use. If not set and create is true, a name is generated using the fullname template.
   * -- NFD-GC
   *
   * Name of the service account to use. If not set and create is true, a name is generated using the fullname template.
   *
   * @default null
   */
  name?: string | null;
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
   * Create [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) configuration for nfd-gc.
   * -- NFD-GC
   *
   * Create [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) configuration for nfd-gc.
   *
   * @default true
   */
  create?: boolean;
};

export type NodefeaturediscoveryHelmValuesGcPodSecurityContext = object;

export type NodefeaturediscoveryHelmValuesGcLivenessProbe = {
  /**
   * @schema type: [integer, null]
   * (int) The number of seconds after the container has started before probe is initiated.
   * -- NFD-GC
   *
   * The number of seconds after the container has started before probe is initiated.
   *
   * @default 10
   */
  initialDelaySeconds?: number | null;
  /**
   * @schema type: [integer, null]; minimum: 1
   * (int) The number of seconds after which the probe times out.
   * -- NFD-GC
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after which the probe times out.
   *
   * @default null
   */
  timeoutSeconds?: number | null;
  /**
   * (int) How often (in seconds) to perform the probe.
   * -- NFD-GC
   * @schema type: [integer, null]; minimum: 1
   *
   * How often (in seconds) to perform the probe.
   *
   * @default null
   */
  periodSeconds?: number | null;
  /**
   * (int) Minimum consecutive successes for the probe before considering the pod as ready.
   * -- NFD-GC
   * Readiness probe configuration. [More information](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-readiness-probes).
   * -- NFD-GC
   *
   * Minimum consecutive successes for the probe before considering the pod as ready.
   *
   * @default null
   */
  failureThreshold?: number | null;
};

export type NodefeaturediscoveryHelmValuesGcReadinessProbe = {
  /**
   * @schema type: [integer, null]
   * (int) The number of seconds after the container has started before probe is initiated.
   * -- NFD-GC
   *
   * The number of seconds after the container has started before probe is initiated.
   *
   * @default 5
   */
  initialDelaySeconds?: number | null;
  /**
   * @schema type: [integer, null]; minimum: 1
   * (int) The number of seconds after which the probe times out.
   * -- NFD-GC
   * @schema type: [integer, null]; minimum: 1
   *
   * The number of seconds after which the probe times out.
   *
   * @default null
   */
  timeoutSeconds?: number | null;
  /**
   * (int) How often (in seconds) to perform the probe.
   * -- NFD-GC
   * @schema type: [integer, null]; minimum: 1
   *
   * How often (in seconds) to perform the probe.
   *
   * @default null
   */
  periodSeconds?: number | null;
  /**
   * (int) Minimum consecutive successes for the probe before considering the pod as ready.
   * -- NFD-GC
   * @schema type: [integer, null]; minimum: 1
   *
   * Minimum consecutive successes for the probe before considering the pod as ready.
   *
   * @default null
   */
  successThreshold?: number | null;
  /**
   * (int) The number of consecutive failures for the probe before considering the pod as not ready.
   * -- NFD-GC
   *
   * The number of consecutive failures for the probe before considering the pod as not ready.
   *
   * @default null
   */
  failureThreshold?: number | null;
};

export type NodefeaturediscoveryHelmValuesGcResources = {
  /**
   * @schema hidden
   * Resource [limits](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#requests-and-limits) for the nfd-gc container.
   * -- NFD-GC
   *
   * @default {"memory":"1Gi"}
   */
  limits?: NodefeaturediscoveryHelmValuesGcResourcesLimits;
  /**
   * @schema hidden
   * Resource [requests](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#requests-and-limits) for the nfd-gc container.
   * -- NFD-GC
   *
   * @default {"cpu":"10m","memory":"128Mi"}
   */
  requests?: NodefeaturediscoveryHelmValuesGcResourcesRequests;
};

export type NodefeaturediscoveryHelmValuesGcResourcesLimits = {
  /**
   * @default "1Gi"
   */
  memory?: string;
};

export type NodefeaturediscoveryHelmValuesGcResourcesRequests = {
  /**
   * @default "10m"
   */
  cpu?: string;
  /**
   * @default "128Mi"
   */
  memory?: string;
};

export type NodefeaturediscoveryHelmValuesGcNodeSelector = object;

export type NodefeaturediscoveryHelmValuesGcAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesGcLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type NodefeaturediscoveryHelmValuesGcDeploymentAnnotations = object;

export type NodefeaturediscoveryHelmValuesGcAffinity = object;

export type NodefeaturediscoveryHelmValuesGcPodDisruptionBudget = {
  /**
   * Configure PodDisruptionBudget for the nfd-master Deployment.
   * -- NFD-GC
   *
   * Configure PodDisruptionBudget for the nfd-master Deployment.
   *
   * @default false
   */
  enable?: boolean;
  /**
   * @schema hidden
   * Minimum number (or percentage) of pods that must be available after the eviction.
   * -- NFD-GC
   *
   * @default 1
   */
  minAvailable?: number;
  /**
   * @schema hidden
   * Policy to evict unhealthy pods when a PodDisruptionBudget is defined.
   * -- NFD-GC
   *
   * @default "AlwaysAllow"
   */
  unhealthyPodEvictionPolicy?: string;
};

export type NodefeaturediscoveryHelmValuesGcNetworkPolicy = {
  /**
   * Should a networkPolicy be deployed for the nfd-gc pods
   * -- NFD-GC
   *
   * Should a networkPolicy be deployed for the nfd-gc pods
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @schema itemRef: $k8s/_definitions.json#/definitions/io.k8s.api.networking.v1.NetworkPolicyEgressRule
   * [Egress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-gc pods.
   * The minimum egress ports required to function are: DNS (53/udp, 53/tcp, API server (80/tcp, 443/tcp, 6443/tcp). NOTE: OKD and Openshift use 6443/tcp
   * -- NFD-GC
   * @schema itemRef: $k8s/_definitions.json#/definitions/io.k8s.api.networking.v1.NetworkPolicyIngressRule
   * [Ingress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-gc pods.
   * -- NFD-GC
   *
   * [Egress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-gc pods. The minimum egress ports required to function are: DNS (53/udp, 53/tcp, API server (80/tcp, 443/tcp, 6443/tcp). NOTE: OKD and Openshift use 6443/tcp
   *
   * @default [{"ports":[{"port":80,"protocol":"TCP"},{"port":443,"protocol":"TCP"},{"port":53,"protocol":"TCP"},{"port":53,"protocol":"UDP"},{"port":6443,"protocol":"TCP"}]}]
   */
  egress?: object[];
  /**
   * [Ingress](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering) for the nfd-gc pods.
   *
   * @default [{"ports":[{"protocol":"TCP","port":"http"}]}]
   */
  ingress?: object[];
};

export type NodefeaturediscoveryHelmValuesPrometheus = {
  /**
   * Create PodMonitor object for enabling metrics collection by Prometheus Operator.
   * -- Prometheus
   *
   * Create PodMonitor object for enabling metrics collection by Prometheus Operator.
   *
   * @default false
   */
  enable?: boolean;
  /**
   * Interval at which metrics are scraped.
   * -- Prometheus
   *
   * Interval at which metrics are scraped.
   *
   * @default "10s"
   */
  scrapeInterval?: string;
  /**
   * Labels to add to the PodMonitor object.
   * -- Prometheus
   *
   * Labels to add to the PodMonitor object.
   *
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
   * @default {"repository":"registry.k8s.io/nfd/node-feature-discovery","pullPolicy":"IfNotPresent","tag":null}
   */
  image?: NodefeaturediscoveryHelmValuesImage;
  /**
   * @schema $ref: $k8s/_definitions.json#/definitions/io.k8s.api.core.v1.PodSpec/properties/imagePullSecrets
   * If `imagePullSecrets` is specified, it takes precedence over `global.imagePullSecrets`. [More info](https://kubernetes.io/docs/concepts/containers/images#specifying-imagepullsecrets-on-a-pod).
   * -- Global
   *
   * Image pull secrets. [More info](https://kubernetes.io/docs/concepts/containers/images#specifying-imagepullsecrets-on-a-pod).
   *
   * @default []
   */
  imagePullSecrets?: unknown[];
  /**
   * Override the name of the chart
   * -- General
   *
   * Override the name of the chart
   *
   * @default ""
   */
  nameOverride?: string;
  /**
   * Override a default fully qualified app name
   * -- General
   *
   * Override a default fully qualified app name
   *
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * Override the namespace to install the chart into. By default, the namespace is determined by Helm.
   * -- General
   *
   * Override the namespace to install the chart into. By default, the namespace is determined by Helm.
   *
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * @schema patternProperties: {"^[a-zA-Z]$": {type: string}}
   * [Feature gates](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/feature-gates) to enable/disable specific features.
   * -- General
   *
   * [Feature gates](https://kubernetes-sigs.github.io/node-feature-discovery/v0.19/reference/feature-gates) to enable/disable specific features.
   *
   * @default {}
   */
  featureGates?: NodefeaturediscoveryHelmValuesFeatureGates;
  /**
   * Only checksum config values (not the full rendered ConfigMap template) for the rollout annotation.
   * When enabled, pods will only restart when config values actually change, not on unrelated template changes.
   * -- General
   *
   * Only checksum config values (not the full rendered ConfigMap template) for the rollout annotation. When enabled, pods will only restart when config values actually change, not on unrelated template changes.
   *
   * @default false
   */
  checksumValuesOnly?: boolean;
  /**
   * The name of the PriorityClass to be used for the NFD pods.
   * -- General
   *
   * The name of the PriorityClass to be used for the NFD pods.
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Enable/disable the Helm post-delete hook.
   * -- General
   *
   * Enable/disable the Helm post-delete hook.
   *
   * @default true
   */
  postDeleteCleanup?: boolean;
  /**
   * Global configuration for NFD used as a sub-chart
   *
   * @default {"imagePullSecrets":[]}
   */
  global?: NodefeaturediscoveryHelmValuesGlobal;
  /**
   * NFD-Master configuration
   *
   * @default {...} (33 keys)
   */
  master?: NodefeaturediscoveryHelmValuesMaster;
  /**
   * NFD-Worker configuration
   *
   * @default {...} (28 keys)
   */
  worker?: NodefeaturediscoveryHelmValuesWorker;
  /**
   * NFD-Topology-Updater configuration
   *
   * @default {...} (31 keys)
   */
  topologyUpdater?: NodefeaturediscoveryHelmValuesTopologyUpdater;
  /**
   * NFD-GC configuration
   *
   * @default {...} (25 keys)
   */
  gc?: NodefeaturediscoveryHelmValuesGc;
  /**
   * Prometheus configuration
   *
   * @default {"enable":false,"scrapeInterval":"10s","labels":{}}
   */
  prometheus?: NodefeaturediscoveryHelmValuesPrometheus;
};

export type NodefeaturediscoveryHelmParameters = {
  "image.repository"?: string;
  "image.pullPolicy"?: string;
  "image.tag"?: string;
  imagePullSecrets?: string;
  nameOverride?: string;
  fullnameOverride?: string;
  namespaceOverride?: string;
  checksumValuesOnly?: string;
  priorityClassName?: string;
  postDeleteCleanup?: string;
  "global.imagePullSecrets"?: string;
  "master.enable"?: string;
  "master.extraArgs"?: string;
  "master.extraEnvs"?: string;
  "master.hostNetwork"?: string;
  "master.hostUsers"?: string;
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
  "master.initContainers"?: string;
  "master.securityContext.allowPrivilegeEscalation"?: string;
  "master.securityContext.capabilities.drop"?: string;
  "master.securityContext.readOnlyRootFilesystem"?: string;
  "master.securityContext.runAsNonRoot"?: string;
  "master.serviceAccount.create"?: string;
  "master.serviceAccount.name"?: string;
  "master.revisionHistoryLimit"?: string;
  "master.rbac.create"?: string;
  "master.resources.limits.memory"?: string;
  "master.resources.requests.cpu"?: string;
  "master.resources.requests.memory"?: string;
  "master.tolerations"?: string;
  "master.podDisruptionBudget.enable"?: string;
  "master.podDisruptionBudget.minAvailable"?: string;
  "master.podDisruptionBudget.unhealthyPodEvictionPolicy"?: string;
  "master.networkPolicy.enabled"?: string;
  "master.networkPolicy.egress"?: string;
  "master.networkPolicy.ingress"?: string;
  "master.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution.weight"?: string;
  "master.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution.preference.matchExpressions.key"?: string;
  "master.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution.preference.matchExpressions.operator"?: string;
  "master.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution.preference.matchExpressions.values"?: string;
  "master.startupProbe.initialDelaySeconds"?: string;
  "master.startupProbe.timeoutSeconds"?: string;
  "master.startupProbe.periodSeconds"?: string;
  "master.startupProbe.failureThreshold"?: string;
  "master.livenessProbe.initialDelaySeconds"?: string;
  "master.livenessProbe.timeoutSeconds"?: string;
  "master.livenessProbe.periodSeconds"?: string;
  "master.livenessProbe.failureThreshold"?: string;
  "master.readinessProbe.initialDelaySeconds"?: string;
  "master.readinessProbe.timeoutSeconds"?: string;
  "master.readinessProbe.periodSeconds"?: string;
  "master.readinessProbe.successThreshold"?: string;
  "master.readinessProbe.failureThreshold"?: string;
  "worker.enable"?: string;
  "worker.ownerRefs"?: string;
  "worker.extraArgs"?: string;
  "worker.extraEnvs"?: string;
  "worker.hostNetwork"?: string;
  "worker.hostUsers"?: string;
  "worker.dnsPolicy"?: string;
  "worker.config"?: string;
  "worker.port"?: string;
  "worker.initContainers"?: string;
  "worker.securityContext.allowPrivilegeEscalation"?: string;
  "worker.securityContext.capabilities.drop"?: string;
  "worker.securityContext.readOnlyRootFilesystem"?: string;
  "worker.securityContext.runAsNonRoot"?: string;
  "worker.livenessProbe.initialDelaySeconds"?: string;
  "worker.livenessProbe.timeoutSeconds"?: string;
  "worker.livenessProbe.periodSeconds"?: string;
  "worker.livenessProbe.failureThreshold"?: string;
  "worker.readinessProbe.initialDelaySeconds"?: string;
  "worker.readinessProbe.timeoutSeconds"?: string;
  "worker.readinessProbe.periodSeconds"?: string;
  "worker.readinessProbe.successThreshold"?: string;
  "worker.readinessProbe.failureThreshold"?: string;
  "worker.serviceAccount.create"?: string;
  "worker.serviceAccount.name"?: string;
  "worker.revisionHistoryLimit"?: string;
  "worker.rbac.create"?: string;
  "worker.mountUsrSrc"?: string;
  "worker.resources.limits.memory"?: string;
  "worker.resources.requests.cpu"?: string;
  "worker.resources.requests.memory"?: string;
  "worker.tolerations"?: string;
  "worker.priorityClassName"?: string;
  "worker.updateStrategy.rollingUpdate.maxUnavailable"?: string;
  "worker.networkPolicy.enabled"?: string;
  "worker.networkPolicy.egress"?: string;
  "worker.networkPolicy.ingress"?: string;
  "topologyUpdater.config"?: string;
  "topologyUpdater.enable"?: string;
  "topologyUpdater.createCRDs"?: string;
  "topologyUpdater.extraArgs"?: string;
  "topologyUpdater.extraEnvs"?: string;
  "topologyUpdater.hostNetwork"?: string;
  "topologyUpdater.hostUsers"?: string;
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
  "topologyUpdater.initContainers"?: string;
  "topologyUpdater.securityContext.allowPrivilegeEscalation"?: string;
  "topologyUpdater.securityContext.capabilities.drop"?: string;
  "topologyUpdater.securityContext.readOnlyRootFilesystem"?: string;
  "topologyUpdater.securityContext.runAsUser"?: string;
  "topologyUpdater.livenessProbe.initialDelaySeconds"?: string;
  "topologyUpdater.livenessProbe.timeoutSeconds"?: string;
  "topologyUpdater.livenessProbe.periodSeconds"?: string;
  "topologyUpdater.livenessProbe.failureThreshold"?: string;
  "topologyUpdater.readinessProbe.initialDelaySeconds"?: string;
  "topologyUpdater.readinessProbe.timeoutSeconds"?: string;
  "topologyUpdater.readinessProbe.periodSeconds"?: string;
  "topologyUpdater.readinessProbe.successThreshold"?: string;
  "topologyUpdater.readinessProbe.failureThreshold"?: string;
  "topologyUpdater.resources.limits.memory"?: string;
  "topologyUpdater.resources.requests.cpu"?: string;
  "topologyUpdater.resources.requests.memory"?: string;
  "topologyUpdater.tolerations"?: string;
  "topologyUpdater.podSetFingerprint"?: string;
  "topologyUpdater.networkPolicy.enabled"?: string;
  "topologyUpdater.networkPolicy.egress"?: string;
  "topologyUpdater.networkPolicy.ingress"?: string;
  "gc.enable"?: string;
  "gc.extraArgs"?: string;
  "gc.extraEnvs"?: string;
  "gc.hostNetwork"?: string;
  "gc.hostUsers"?: string;
  "gc.replicaCount"?: string;
  "gc.dnsPolicy"?: string;
  "gc.serviceAccount.create"?: string;
  "gc.serviceAccount.name"?: string;
  "gc.rbac.create"?: string;
  "gc.interval"?: string;
  "gc.initContainers"?: string;
  "gc.livenessProbe.initialDelaySeconds"?: string;
  "gc.livenessProbe.timeoutSeconds"?: string;
  "gc.livenessProbe.periodSeconds"?: string;
  "gc.livenessProbe.failureThreshold"?: string;
  "gc.readinessProbe.initialDelaySeconds"?: string;
  "gc.readinessProbe.timeoutSeconds"?: string;
  "gc.readinessProbe.periodSeconds"?: string;
  "gc.readinessProbe.successThreshold"?: string;
  "gc.readinessProbe.failureThreshold"?: string;
  "gc.resources.limits.memory"?: string;
  "gc.resources.requests.cpu"?: string;
  "gc.resources.requests.memory"?: string;
  "gc.port"?: string;
  "gc.tolerations"?: string;
  "gc.podDisruptionBudget.enable"?: string;
  "gc.podDisruptionBudget.minAvailable"?: string;
  "gc.podDisruptionBudget.unhealthyPodEvictionPolicy"?: string;
  "gc.revisionHistoryLimit"?: string;
  "gc.networkPolicy.enabled"?: string;
  "gc.networkPolicy.egress"?: string;
  "gc.networkPolicy.ingress"?: string;
  "prometheus.enable"?: string;
  "prometheus.scrapeInterval"?: string;
};
