// Generated TypeScript types for alloy Helm chart

export type AlloyHelmValuesGlobal = {
  /**
   * @default {"registry":"","pullSecrets":[],"pullPolicy":""}
   */
  image?: AlloyHelmValuesGlobalImage;
  /**
   * Security context to apply to the Grafana Alloy pod.
   *
   * @default {}
   */
  podSecurityContext?: AlloyHelmValuesGlobalPodSecurityContext;
};

export type AlloyHelmValuesGlobalImage = {
  /**
   * Global image registry to use if it needs to be overridden for some specific use cases (e.g local registries, custom images, ...)
   *
   * @default ""
   */
  registry?: string;
  pullSecrets?: unknown[];
  /**
   * Global image pull policy to apply to all containers. Overrides `image.pullPolicy` and `configReloader.image.pullPolicy`.
   *
   * @default ""
   */
  pullPolicy?: string;
};

export type AlloyHelmValuesGlobalPodSecurityContext = object;

export type AlloyHelmValuesCrds = {
  /**
   * Whether to install CRDs for monitoring.
   *
   * @default true
   */
  create?: boolean;
};

export type AlloyHelmValuesAlloy = {
  /**
   * @default {...} (4 keys)
   */
  configMap?: AlloyHelmValuesAlloyConfigMap;
  /**
   * @default {"enabled":false,"name":"","portName":"http"}
   */
  clustering?: AlloyHelmValuesAlloyClustering;
  /**
   * Minimum stability level of components and behavior to enable. Must be
   * one of "experimental", "public-preview", or "generally-available".
   *
   * @default "generally-available"
   */
  stabilityLevel?: string;
  /**
   * Path to where Grafana Alloy stores data (for example, the Write-Ahead Log).
   * By default, data is lost between reboots.
   *
   * @default "/tmp/alloy"
   */
  storagePath?: string;
  /**
   * Enables Grafana Alloy container's http server port.
   *
   * @default true
   */
  enableHttpServerPort?: boolean;
  /**
   * Address to listen for traffic on. 0.0.0.0 exposes the UI to other
   * containers.
   *
   * @default "0.0.0.0"
   */
  listenAddr?: string;
  /**
   * Port to listen for traffic on.
   *
   * @default 12345
   */
  listenPort?: number;
  /**
   * Scheme is needed for readiness probes. If enabling tls in your configs, set to "HTTPS"
   *
   * @default "HTTP"
   */
  listenScheme?: string;
  /**
   * Initial delay for readiness probe.
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * Timeout for readiness probe.
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Base path where the UI is exposed.
   *
   * @default "/"
   */
  uiPathPrefix?: string;
  /**
   * Enables sending Grafana Labs anonymous usage stats to help improve Grafana
   * Alloy.
   *
   * @default true
   */
  enableReporting?: boolean;
  extraEnv?: unknown[];
  envFrom?: unknown[];
  extraArgs?: unknown[];
  extraPorts?: unknown[];
  hostAliases?: unknown[];
  /**
   * @default {"varlog":false,"dockercontainers":false,"extra":[]}
   */
  mounts?: AlloyHelmValuesAlloyMounts;
  /**
   * Security context to apply to the Grafana Alloy container.
   *
   * @default {}
   */
  securityContext?: AlloyHelmValuesAlloySecurityContext;
  /**
   * Resource requests and limits to apply to the Grafana Alloy container.
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * Set lifecycle hooks for the Grafana Alloy container.
   *
   * @default {}
   */
  lifecycle?: AlloyHelmValuesAlloyLifecycle;
  /**
   * Set livenessProbe for the Grafana Alloy container.
   *
   * @default {}
   */
  livenessProbe?: AlloyHelmValuesAlloyLivenessProbe;
};

export type AlloyHelmValuesAlloyConfigMap = {
  /**
   * Create a new ConfigMap for the config file.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Content to assign to the new ConfigMap.  This is passed into `tpl` allowing for templating from values.
   *
   * @default ""
   */
  content?: string;
  name?: unknown;
  key?: unknown;
};

export type AlloyHelmValuesAlloyClustering = {
  /**
   * Deploy Alloy in a cluster to allow for load distribution.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Name for the Alloy cluster. Used for differentiating between clusters.
   *
   * @default ""
   */
  name?: string;
  /**
   * Name for the port used for clustering, useful if running inside an Istio Mesh
   *
   * @default "http"
   */
  portName?: string;
};

export type AlloyHelmValuesAlloyMounts = {
  /**
   * Mount /var/log from the host into the container for log collection.
   *
   * @default false
   */
  varlog?: boolean;
  /**
   * Mount /var/lib/docker/containers from the host into the container for log
   * collection.
   *
   * @default false
   */
  dockercontainers?: boolean;
  extra?: unknown[];
};

export type AlloyHelmValuesAlloySecurityContext = object;

export type AlloyHelmValuesAlloyLifecycle = object;

export type AlloyHelmValuesAlloyLivenessProbe = object;

export type AlloyHelmValuesImage = {
  /**
   * Grafana Alloy image registry (defaults to docker.io)
   *
   * @default "docker.io"
   */
  registry?: string;
  /**
   * Grafana Alloy image repository.
   *
   * @default "grafana/alloy"
   */
  repository?: string;
  tag?: unknown;
  digest?: unknown;
  /**
   * Grafana Alloy image pull policy.
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  pullSecrets?: unknown[];
};

export type AlloyHelmValuesRbac = {
  /**
   * Whether to create RBAC resources for Alloy.
   *
   * @default true
   */
  create?: boolean;
  namespaces?: unknown[];
  rules?: AlloyHelmValuesRbacRulesElement[];
  clusterRules?: AlloyHelmValuesRbacClusterRulesElement[];
};

export type AlloyHelmValuesRbacRulesElement = {
  apiGroups?: string[];
  resources?: string[];
  verbs?: string[];
};

export type AlloyHelmValuesRbacClusterRulesElement = {
  apiGroups?: string[];
  resources?: string[];
  verbs?: string[];
};

export type AlloyHelmValuesServiceAccount = {
  /**
   * Whether to create a service account for the Grafana Alloy deployment.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Additional labels to add to the created service account.
   *
   * @default {}
   */
  additionalLabels?: AlloyHelmValuesServiceAccountAdditionalLabels;
  /**
   * Annotations to add to the created service account.
   *
   * @default {}
   */
  annotations?: AlloyHelmValuesServiceAccountAnnotations;
  name?: unknown;
  /**
   * Whether the Alloy pod should automatically mount the service account token.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type AlloyHelmValuesServiceAccountAdditionalLabels = object;

export type AlloyHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type AlloyHelmValuesConfigReloader = {
  /**
   * Enables automatically reloading when the Alloy config changes.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {...} (5 keys)
   */
  image?: AlloyHelmValuesConfigReloaderImage;
  customArgs?: unknown[];
  /**
   * Resource requests and limits to apply to the config reloader container.
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * Security context to apply to the Grafana configReloader container.
   *
   * @default {}
   */
  securityContext?: AlloyHelmValuesConfigReloaderSecurityContext;
};

export type AlloyHelmValuesConfigReloaderImage = {
  /**
   * Config reloader image registry (defaults to docker.io)
   *
   * @default "quay.io"
   */
  registry?: string;
  /**
   * Repository to get config reloader image from.
   *
   * @default "prometheus-operator/prometheus-config-reloader"
   */
  repository?: string;
  /**
   * Tag of image to use for config reloading.
   *
   * @default "v0.91.0@sha256:7d9e4eea5f1139e602508871f422b011..."
   */
  tag?: string;
  /**
   * SHA256 digest of image to use for config reloading (either in format "sha256:XYZ" or "XYZ"). When set, will override `configReloader.image.tag`
   *
   * @default ""
   */
  digest?: string;
  /**
   * Config reloader image pull policy.
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type AlloyHelmValuesConfigReloaderSecurityContext = object;

export type AlloyHelmValuesController = {
  /**
   * Type of controller to use for deploying Grafana Alloy in the cluster.
   * Must be one of 'daemonset', 'deployment', or 'statefulset'.
   *
   * @default "daemonset"
   */
  type?: string;
  /**
   * Number of pods to deploy. Ignored when controller.type is 'daemonset'.
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Extra labels to add to the controller.
   *
   * @default {}
   */
  extraLabels?: AlloyHelmValuesControllerExtraLabels;
  /**
   * Annotations to add to controller.
   *
   * @default {}
   */
  extraAnnotations?: AlloyHelmValuesControllerExtraAnnotations;
  /**
   * Whether to deploy pods in parallel. Only used when controller.type is
   * 'statefulset'.
   *
   * @default true
   */
  parallelRollout?: boolean;
  /**
   * How many additional seconds to wait before considering a pod ready.
   *
   * @default 10
   */
  minReadySeconds?: number;
  /**
   * Configures Pods to use the host network. When set to true, the ports that will be used must be specified.
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * Configures Pods to use the host PID namespace.
   *
   * @default false
   */
  hostPID?: boolean;
  /**
   * Configures the DNS policy for the pod. https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-s-dns-policy
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  terminationGracePeriodSeconds?: unknown;
  /**
   * The maximum number of revisions that will be maintained in the Controllers's revision history. The history consists of all revisions not represented by a currently applied reversion.
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * Update strategy for updating deployed Pods.
   *
   * @default {}
   */
  updateStrategy?: AlloyHelmValuesControllerUpdateStrategy;
  /**
   * nodeSelector to apply to Grafana Alloy pods.
   */
  nodeSelector?: Record<string, string>;
  /**
   * Tolerations to apply to Grafana Alloy pods.
   */
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * priorityClassName to apply to Grafana Alloy pods.
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Extra pod annotations to add.
   *
   * @default {}
   */
  podAnnotations?: AlloyHelmValuesControllerPodAnnotations;
  /**
   * Extra pod labels to add.
   *
   * @default {}
   */
  podLabels?: AlloyHelmValuesControllerPodLabels;
  /**
   * PodDisruptionBudget configuration.
   *
   * @default {"enabled":false,"minAvailable":null,"maxUnavailable":null}
   */
  podDisruptionBudget?: AlloyHelmValuesControllerPodDisruptionBudget;
  /**
   * Whether to enable automatic deletion of stale PVCs due to a scale down operation, when controller.type is 'statefulset'.
   *
   * @default false
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  /**
   * @default {...} (9 keys)
   */
  autoscaling?: AlloyHelmValuesControllerAutoscaling;
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {"extra":[]}
   */
  volumes?: AlloyHelmValuesControllerVolumes;
  volumeClaimTemplates?: unknown[];
  initContainers?: unknown[];
  extraContainers?: unknown[];
};

export type AlloyHelmValuesControllerExtraLabels = object;

export type AlloyHelmValuesControllerExtraAnnotations = object;

export type AlloyHelmValuesControllerUpdateStrategy = object;

export type AlloyHelmValuesControllerPodAnnotations = object;

export type AlloyHelmValuesControllerPodLabels = object;

export type AlloyHelmValuesControllerPodDisruptionBudget = {
  /**
   * Whether to create a PodDisruptionBudget for the controller.
   *
   * @default false
   */
  enabled?: boolean;
  minAvailable?: unknown;
  maxUnavailable?: unknown;
};

export type AlloyHelmValuesControllerAutoscaling = {
  /**
   * Creates a HorizontalPodAutoscaler for controller type deployment.
   * Deprecated: Please use controller.autoscaling.horizontal instead
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * The lower limit for the number of replicas to which the autoscaler can scale down.
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * The upper limit for the number of replicas to which the autoscaler can scale up.
   *
   * @default 5
   */
  maxReplicas?: number;
  /**
   * Average CPU utilization across all relevant pods, a percentage of the requested value of the resource for the pods. Setting `targetCPUUtilizationPercentage` to 0 will disable CPU scaling.
   *
   * @default 0
   */
  targetCPUUtilizationPercentage?: number;
  /**
   * Average Memory utilization across all relevant pods, a percentage of the requested value of the resource for the pods. Setting `targetMemoryUtilizationPercentage` to 0 will disable Memory scaling.
   *
   * @default 80
   */
  targetMemoryUtilizationPercentage?: number;
  /**
   * @default {"policies":[],"selectPolicy":"Max","stabilizationWindowSeconds":300}
   */
  scaleDown?: AlloyHelmValuesControllerAutoscalingScaleDown;
  /**
   * @default {"policies":[],"selectPolicy":"Max","stabilizationWindowSeconds":0}
   */
  scaleUp?: AlloyHelmValuesControllerAutoscalingScaleUp;
  /**
   * Configures the Horizontal Pod Autoscaler for the controller.
   *
   * @default {...} (8 keys)
   */
  horizontal?: AlloyHelmValuesControllerAutoscalingHorizontal;
  /**
   * Configures the Vertical Pod Autoscaler for the controller.
   *
   * @default {...} (4 keys)
   */
  vertical?: AlloyHelmValuesControllerAutoscalingVertical;
};

export type AlloyHelmValuesControllerAutoscalingScaleDown = {
  policies?: unknown[];
  /**
   * Determines which of the provided scaling-down policies to apply if multiple are specified.
   *
   * @default "Max"
   */
  selectPolicy?: string;
  /**
   * The duration that the autoscaling mechanism should look back on to make decisions about scaling down.
   *
   * @default 300
   */
  stabilizationWindowSeconds?: number;
};

export type AlloyHelmValuesControllerAutoscalingScaleUp = {
  policies?: unknown[];
  /**
   * Determines which of the provided scaling-up policies to apply if multiple are specified.
   *
   * @default "Max"
   */
  selectPolicy?: string;
  /**
   * The duration that the autoscaling mechanism should look back on to make decisions about scaling up.
   *
   * @default 0
   */
  stabilizationWindowSeconds?: number;
};

export type AlloyHelmValuesControllerAutoscalingHorizontal = {
  /**
   * Enables the Horizontal Pod Autoscaler for the controller.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * When true, the chart omits `spec.replicas` from the workload AND does NOT
   * render its own HorizontalPodAutoscaler. Use this when an external controller
   * (e.g. KEDA, a hand-written HPA, or another scaler) owns replicas for the Alloy
   * workload. Mutually exclusive with `horizontal.enabled`. When set, all other
   * `controller.autoscaling.horizontal.*` fields are ignored.
   * Upgrade note: switching this from `false` to `true` on an existing release
   * triggers a one-time single-cycle dip to 1 replica on the next `helm upgrade`
   * (Helm removes the `replicas` field via `{"spec":{"replicas":null}}`, which
   * Kubernetes interprets as "reset to default"). The external HPA corrects this
   * within its next polling interval; users with `minReplicaCount > 1` are
   * restored within ~30s under KEDA defaults. Plan upgrades accordingly.
   *
   * @default false
   */
  externalHPA?: boolean;
  /**
   * The lower limit for the number of replicas to which the autoscaler can scale down.
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * The upper limit for the number of replicas to which the autoscaler can scale up.
   *
   * @default 5
   */
  maxReplicas?: number;
  /**
   * Average CPU utilization across all relevant pods, a percentage of the requested value of the resource for the pods. Setting `targetCPUUtilizationPercentage` to 0 will disable CPU scaling.
   *
   * @default 0
   */
  targetCPUUtilizationPercentage?: number;
  /**
   * Average Memory utilization across all relevant pods, a percentage of the requested value of the resource for the pods. Setting `targetMemoryUtilizationPercentage` to 0 will disable Memory scaling.
   *
   * @default 80
   */
  targetMemoryUtilizationPercentage?: number;
  /**
   * @default {"policies":[],"selectPolicy":"Max","stabilizationWindowSeconds":300}
   */
  scaleDown?: AlloyHelmValuesControllerAutoscalingHorizontalScaleDown;
  /**
   * @default {"policies":[],"selectPolicy":"Max","stabilizationWindowSeconds":0}
   */
  scaleUp?: AlloyHelmValuesControllerAutoscalingHorizontalScaleUp;
};

export type AlloyHelmValuesControllerAutoscalingHorizontalScaleDown = {
  policies?: unknown[];
  /**
   * Determines which of the provided scaling-down policies to apply if multiple are specified.
   *
   * @default "Max"
   */
  selectPolicy?: string;
  /**
   * The duration that the autoscaling mechanism should look back on to make decisions about scaling down.
   *
   * @default 300
   */
  stabilizationWindowSeconds?: number;
};

export type AlloyHelmValuesControllerAutoscalingHorizontalScaleUp = {
  policies?: unknown[];
  /**
   * Determines which of the provided scaling-up policies to apply if multiple are specified.
   *
   * @default "Max"
   */
  selectPolicy?: string;
  /**
   * The duration that the autoscaling mechanism should look back on to make decisions about scaling up.
   *
   * @default 0
   */
  stabilizationWindowSeconds?: number;
};

export type AlloyHelmValuesControllerAutoscalingVertical = {
  /**
   * Enables the Vertical Pod Autoscaler for the controller.
   *
   * @default false
   */
  enabled?: boolean;
  recommenders?: unknown[];
  /**
   * Configures the resource policy for the Vertical Pod Autoscaler.
   *
   * @default {"containerPolicies":[{"containerName":"alloy","controlledResources":["cpu","memory"],"controlledValues":"RequestsAndLimits","maxAllowed":{},"minAllowed":{}}]}
   */
  resourcePolicy?: AlloyHelmValuesControllerAutoscalingVerticalResourcePolicy;
  updatePolicy?: unknown;
};

export type AlloyHelmValuesControllerAutoscalingVerticalResourcePolicy = {
  containerPolicies?: AlloyHelmValuesControllerAutoscalingVerticalResourcePolicyContainerPoliciesElement[];
};

export type AlloyHelmValuesControllerAutoscalingVerticalResourcePolicyContainerPoliciesElement =
  {
    /**
     * @default "alloy"
     */
    containerName?: string;
    controlledResources?: string[];
    /**
     * @default "RequestsAndLimits"
     */
    controlledValues?: string;
    /**
     * @default {}
     */
    maxAllowed?: AlloyHelmValuesControllerAutoscalingVerticalResourcePolicyContainerPoliciesMaxAllowed;
    /**
     * @default {}
     */
    minAllowed?: AlloyHelmValuesControllerAutoscalingVerticalResourcePolicyContainerPoliciesMinAllowed;
  };

export type AlloyHelmValuesControllerAutoscalingVerticalResourcePolicyContainerPoliciesMaxAllowed =
  object;

export type AlloyHelmValuesControllerAutoscalingVerticalResourcePolicyContainerPoliciesMinAllowed =
  object;

export type AlloyHelmValuesControllerVolumes = {
  extra?: unknown[];
};

export type AlloyHelmValuesNetworkPolicy = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "kubernetes"
   */
  flavor?: string;
  policyTypes?: string[];
  ingress?: AlloyHelmValuesNetworkPolicyIngressElement[];
  egress?: AlloyHelmValuesNetworkPolicyEgressElement[];
};

export type AlloyHelmValuesNetworkPolicyIngressElement = object;

export type AlloyHelmValuesNetworkPolicyEgressElement = object;

export type AlloyHelmValuesService = {
  /**
   * Creates a Service for the controller's pods.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * NodePort port. Only takes effect when `service.type: NodePort`
   *
   * @default 31128
   */
  nodePort?: number;
  /**
   * Cluster IP, can be set to None, empty "" or an IP address
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * Value for internal traffic policy. 'Cluster' or 'Local'
   *
   * @default "Cluster"
   */
  internalTrafficPolicy?: string;
  /**
   * Value for external traffic policy. 'Cluster' or 'Local'
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * cloud.google.com/load-balancer-type: Internal
   *
   * @default {}
   */
  annotations?: AlloyHelmValuesServiceAnnotations;
};

export type AlloyHelmValuesServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type AlloyHelmValuesServiceMonitor = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional labels for the service monitor.
   *
   * @default {}
   */
  additionalLabels?: AlloyHelmValuesServiceMonitorAdditionalLabels;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  metricRelabelings?: unknown[];
  /**
   * Customize tls parameters for the service monitor
   *
   * @default {}
   */
  tlsConfig?: AlloyHelmValuesServiceMonitorTlsConfig;
  relabelings?: unknown[];
};

export type AlloyHelmValuesServiceMonitorAdditionalLabels = object;

export type AlloyHelmValuesServiceMonitorTlsConfig = object;

export type AlloyHelmValuesIngress = {
  /**
   * Enables ingress for Alloy (Faro port)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * For Kubernetes >= 1.18 you should specify the ingress-controller via the field ingressClassName
   * See https://kubernetes.io/blog/2020/04/02/improvements-to-the-ingress-api-in-kubernetes-1.18/#specifying-the-class-of-an-ingress
   * Values can be templated
   * kubernetes.io/ingress.class: nginx
   * kubernetes.io/tls-acme: "true"
   *
   * @default {}
   */
  annotations?: AlloyHelmValuesIngressAnnotations;
  /**
   * @default {}
   */
  labels?: AlloyHelmValuesIngressLabels;
  /**
   * @default "/"
   */
  path?: string;
  /**
   * @default 12347
   */
  faroPort?: number;
  /**
   * pathType is only for k8s >= 1.1=
   *
   * @default "Prefix"
   */
  pathType?: string;
  hosts?: string[];
  extraPaths?: unknown[];
  tls?: unknown[];
};

export type AlloyHelmValuesIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type AlloyHelmValuesIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type AlloyHelmValues = {
  nameOverride?: unknown;
  namespaceOverride?: unknown;
  fullnameOverride?: unknown;
  /**
   * Global properties for image pulling override the values defined under `image.registry` and `configReloader.image.registry`.
   * If you want to override only one image registry, use the specific fields but if you want to override them all, use `global.image.registry`
   *
   * @default {"image":{"registry":"","pullSecrets":[],"pullPolicy":""},"podSecurityContext":{}}
   */
  global?: AlloyHelmValuesGlobal;
  /**
   * @default {"create":true}
   */
  crds?: AlloyHelmValuesCrds;
  /**
   * Various Alloy settings. For backwards compatibility with the grafana-agent
   * chart, this field may also be called "agent". Naming this field "agent" is
   * deprecated and will be removed in a future release.
   *
   * @default {...} (22 keys)
   */
  alloy?: AlloyHelmValuesAlloy;
  /**
   * @default {...} (6 keys)
   */
  image?: AlloyHelmValuesImage;
  /**
   * @default {...} (4 keys)
   */
  rbac?: AlloyHelmValuesRbac;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: AlloyHelmValuesServiceAccount;
  /**
   * Options for the extra controller used for config reloading.
   *
   * @default {...} (5 keys)
   */
  configReloader?: AlloyHelmValuesConfigReloader;
  /**
   * @default {...} (26 keys)
   */
  controller?: AlloyHelmValuesController;
  /**
   * @default {...} (5 keys)
   */
  networkPolicy?: AlloyHelmValuesNetworkPolicy;
  /**
   * @default {...} (7 keys)
   */
  service?: AlloyHelmValuesService;
  /**
   * @default {...} (6 keys)
   */
  serviceMonitor?: AlloyHelmValuesServiceMonitor;
  /**
   * Extra k8s manifests to deploy
   *
   * @default {...} (9 keys)
   */
  ingress?: AlloyHelmValuesIngress;
  extraObjects?: unknown[];
};

export type AlloyHelmParameters = {
  nameOverride?: string;
  namespaceOverride?: string;
  fullnameOverride?: string;
  "global.image.registry"?: string;
  "global.image.pullSecrets"?: string;
  "global.image.pullPolicy"?: string;
  "crds.create"?: string;
  "alloy.configMap.create"?: string;
  "alloy.configMap.content"?: string;
  "alloy.configMap.name"?: string;
  "alloy.configMap.key"?: string;
  "alloy.clustering.enabled"?: string;
  "alloy.clustering.name"?: string;
  "alloy.clustering.portName"?: string;
  "alloy.stabilityLevel"?: string;
  "alloy.storagePath"?: string;
  "alloy.enableHttpServerPort"?: string;
  "alloy.listenAddr"?: string;
  "alloy.listenPort"?: string;
  "alloy.listenScheme"?: string;
  "alloy.initialDelaySeconds"?: string;
  "alloy.timeoutSeconds"?: string;
  "alloy.uiPathPrefix"?: string;
  "alloy.enableReporting"?: string;
  "alloy.extraEnv"?: string;
  "alloy.envFrom"?: string;
  "alloy.extraArgs"?: string;
  "alloy.extraPorts"?: string;
  "alloy.hostAliases"?: string;
  "alloy.mounts.varlog"?: string;
  "alloy.mounts.dockercontainers"?: string;
  "alloy.mounts.extra"?: string;
  "alloy.resources"?: string;
  "image.registry"?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "image.digest"?: string;
  "image.pullPolicy"?: string;
  "image.pullSecrets"?: string;
  "rbac.create"?: string;
  "rbac.namespaces"?: string;
  "rbac.rules.apiGroups"?: string;
  "rbac.rules.resources"?: string;
  "rbac.rules.verbs"?: string;
  "rbac.clusterRules.apiGroups"?: string;
  "rbac.clusterRules.resources"?: string;
  "rbac.clusterRules.verbs"?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "serviceAccount.automountServiceAccountToken"?: string;
  "configReloader.enabled"?: string;
  "configReloader.image.registry"?: string;
  "configReloader.image.repository"?: string;
  "configReloader.image.tag"?: string;
  "configReloader.image.digest"?: string;
  "configReloader.image.pullPolicy"?: string;
  "configReloader.customArgs"?: string;
  "configReloader.resources"?: string;
  "controller.type"?: string;
  "controller.replicas"?: string;
  "controller.parallelRollout"?: string;
  "controller.minReadySeconds"?: string;
  "controller.hostNetwork"?: string;
  "controller.hostPID"?: string;
  "controller.dnsPolicy"?: string;
  "controller.terminationGracePeriodSeconds"?: string;
  "controller.revisionHistoryLimit"?: string;
  "controller.nodeSelector"?: string;
  "controller.tolerations"?: string;
  "controller.topologySpreadConstraints"?: string;
  "controller.priorityClassName"?: string;
  "controller.podDisruptionBudget.enabled"?: string;
  "controller.podDisruptionBudget.minAvailable"?: string;
  "controller.podDisruptionBudget.maxUnavailable"?: string;
  "controller.enableStatefulSetAutoDeletePVC"?: string;
  "controller.autoscaling.enabled"?: string;
  "controller.autoscaling.minReplicas"?: string;
  "controller.autoscaling.maxReplicas"?: string;
  "controller.autoscaling.targetCPUUtilizationPercentage"?: string;
  "controller.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "controller.autoscaling.scaleDown.policies"?: string;
  "controller.autoscaling.scaleDown.selectPolicy"?: string;
  "controller.autoscaling.scaleDown.stabilizationWindowSeconds"?: string;
  "controller.autoscaling.scaleUp.policies"?: string;
  "controller.autoscaling.scaleUp.selectPolicy"?: string;
  "controller.autoscaling.scaleUp.stabilizationWindowSeconds"?: string;
  "controller.autoscaling.horizontal.enabled"?: string;
  "controller.autoscaling.horizontal.externalHPA"?: string;
  "controller.autoscaling.horizontal.minReplicas"?: string;
  "controller.autoscaling.horizontal.maxReplicas"?: string;
  "controller.autoscaling.horizontal.targetCPUUtilizationPercentage"?: string;
  "controller.autoscaling.horizontal.targetMemoryUtilizationPercentage"?: string;
  "controller.autoscaling.horizontal.scaleDown.policies"?: string;
  "controller.autoscaling.horizontal.scaleDown.selectPolicy"?: string;
  "controller.autoscaling.horizontal.scaleDown.stabilizationWindowSeconds"?: string;
  "controller.autoscaling.horizontal.scaleUp.policies"?: string;
  "controller.autoscaling.horizontal.scaleUp.selectPolicy"?: string;
  "controller.autoscaling.horizontal.scaleUp.stabilizationWindowSeconds"?: string;
  "controller.autoscaling.vertical.enabled"?: string;
  "controller.autoscaling.vertical.recommenders"?: string;
  "controller.autoscaling.vertical.resourcePolicy.containerPolicies.containerName"?: string;
  "controller.autoscaling.vertical.resourcePolicy.containerPolicies.controlledResources"?: string;
  "controller.autoscaling.vertical.resourcePolicy.containerPolicies.controlledValues"?: string;
  "controller.autoscaling.vertical.updatePolicy"?: string;
  "controller.affinity"?: string;
  "controller.volumes.extra"?: string;
  "controller.volumeClaimTemplates"?: string;
  "controller.initContainers"?: string;
  "controller.extraContainers"?: string;
  "networkPolicy.enabled"?: string;
  "networkPolicy.flavor"?: string;
  "networkPolicy.policyTypes"?: string;
  "service.enabled"?: string;
  "service.type"?: string;
  "service.nodePort"?: string;
  "service.clusterIP"?: string;
  "service.internalTrafficPolicy"?: string;
  "service.externalTrafficPolicy"?: string;
  "serviceMonitor.enabled"?: string;
  "serviceMonitor.interval"?: string;
  "serviceMonitor.metricRelabelings"?: string;
  "serviceMonitor.relabelings"?: string;
  "ingress.enabled"?: string;
  "ingress.path"?: string;
  "ingress.faroPort"?: string;
  "ingress.pathType"?: string;
  "ingress.hosts"?: string;
  "ingress.extraPaths"?: string;
  "ingress.tls"?: string;
  extraObjects?: string;
};
