// Generated TypeScript types for promtail Helm chart

export type PromtailHelmValuesGlobal = {
  /**
   * Allow parent charts to override registry hostname
   *
   * @default ""
   */
  imageRegistry?: string;
  imagePullSecrets?: unknown[];
};

export type PromtailHelmValuesDaemonset = {
  /**
   * Deploys Promtail as a DaemonSet
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {...} (4 keys)
   */
  autoscaling?: PromtailHelmValuesDaemonsetAutoscaling;
};

export type PromtailHelmValuesDaemonsetAutoscaling = {
  /**
   * Creates a VerticalPodAutoscaler for the daemonset
   *
   * @default false
   */
  enabled?: boolean;
  controlledResources?: unknown[];
  /**
   * Specifies which resource values should be controlled: RequestsOnly or RequestsAndLimits.
   * Defines the max allowed resources for the pod
   *
   * @default {}
   */
  maxAllowed?: PromtailHelmValuesDaemonsetAutoscalingMaxAllowed;
  /**
   * Defines the min allowed resources for the pod
   *
   * @default {}
   */
  minAllowed?: PromtailHelmValuesDaemonsetAutoscalingMinAllowed;
};

export type PromtailHelmValuesDaemonsetAutoscalingMaxAllowed = object;

export type PromtailHelmValuesDaemonsetAutoscalingMinAllowed = object;

export type PromtailHelmValuesDeployment = {
  /**
   * Deploys Promtail as a Deployment
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicaCount?: number;
  /**
   * @default {...} (5 keys)
   */
  autoscaling?: PromtailHelmValuesDeploymentAutoscaling;
  /**
   * Set deployment object update strategy
   *
   * @default {"type":"RollingUpdate"}
   */
  strategy?: PromtailHelmValuesDeploymentStrategy;
};

export type PromtailHelmValuesDeploymentAutoscaling = {
  /**
   * Creates a HorizontalPodAutoscaler for the deployment
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  minReplicas?: number;
  /**
   * @default 10
   */
  maxReplicas?: number;
  /**
   * @default 80
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
};

export type PromtailHelmValuesDeploymentStrategy = {
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type PromtailHelmValuesService = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Labels for the service
   *
   * @default {}
   */
  labels?: PromtailHelmValuesServiceLabels;
  /**
   * Annotations for the service
   *
   * @default {}
   */
  annotations?: PromtailHelmValuesServiceAnnotations;
};

export type PromtailHelmValuesServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PromtailHelmValuesServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PromtailHelmValuesSecret = {
  /**
   * Labels for the Secret
   *
   * @default {}
   */
  labels?: PromtailHelmValuesSecretLabels;
  /**
   * Annotations for the Secret
   *
   * @default {}
   */
  annotations?: PromtailHelmValuesSecretAnnotations;
};

export type PromtailHelmValuesSecretLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PromtailHelmValuesSecretAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PromtailHelmValuesConfigmap = {
  /**
   * If enabled, promtail config will be created as a ConfigMap instead of a secret
   *
   * @default false
   */
  enabled?: boolean;
};

export type PromtailHelmValuesImage = {
  /**
   * The Docker registry
   *
   * @default "docker.io"
   */
  registry?: string;
  /**
   * Docker image repository
   *
   * @default "grafana/promtail"
   */
  repository?: string;
  /**
   * Overrides the image tag whose default is the chart's appVersion
   *
   * @default ""
   */
  tag?: string;
  /**
   * Docker image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type PromtailHelmValuesAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PromtailHelmValuesUpdateStrategy = object;

export type PromtailHelmValuesPodLabels = object;

export type PromtailHelmValuesPodAnnotations = object;

export type PromtailHelmValuesLivenessProbe = object;

export type PromtailHelmValuesReadinessProbe = {
  /**
   * @default 5
   */
  failureThreshold?: number;
  /**
   * @default {"path":"{{ printf `%s/ready` .Values.httpPathPrefix }}","port":"http-metrics"}
   */
  httpGet?: PromtailHelmValuesReadinessProbeHttpGet;
  /**
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * @default 10
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 1
   */
  timeoutSeconds?: number;
};

export type PromtailHelmValuesReadinessProbeHttpGet = {
  /**
   * @default "{{ printf `%s/ready` .Values.httpPathPrefix }}"
   */
  path?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
};

export type PromtailHelmValuesResources = object;

export type PromtailHelmValuesPodSecurityContext = {
  /**
   * @default 0
   */
  runAsUser?: number;
  /**
   * @default 0
   */
  runAsGroup?: number;
};

export type PromtailHelmValuesContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: PromtailHelmValuesContainerSecurityContextCapabilities;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type PromtailHelmValuesContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type PromtailHelmValuesRbac = {
  /**
   * Specifies whether RBAC resources are to be created
   *
   * @default true
   */
  create?: boolean;
  /**
   * Specifies whether a PodSecurityPolicy is to be created
   *
   * @default false
   */
  pspEnabled?: boolean;
};

export type PromtailHelmValuesServiceAccount = {
  /**
   * Specifies whether a ServiceAccount should be created
   *
   * @default true
   */
  create?: boolean;
  name?: unknown;
  imagePullSecrets?: unknown[];
  /**
   * Annotations for the service account
   *
   * @default {}
   */
  annotations?: PromtailHelmValuesServiceAccountAnnotations;
  /**
   * Automatically mount a ServiceAccount's API credentials
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type PromtailHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PromtailHelmValuesNodeSelector = object;

export type PromtailHelmValuesAffinity = object;

export type PromtailHelmValuesTolerationsElement = {
  /**
   * @default "node-role.kubernetes.io/master"
   */
  key?: string;
  /**
   * @default "Exists"
   */
  operator?: string;
  /**
   * @default "NoSchedule"
   */
  effect?: string;
};

export type PromtailHelmValuesDefaultVolumesElement = {
  /**
   * @default "run"
   */
  name?: string;
  /**
   * @default {"path":"/run/promtail"}
   */
  hostPath?: PromtailHelmValuesDefaultVolumesHostPath;
};

export type PromtailHelmValuesDefaultVolumesHostPath = {
  /**
   * @default "/run/promtail"
   */
  path?: string;
};

export type PromtailHelmValuesDefaultVolumeMountsElement = {
  /**
   * @default "run"
   */
  name?: string;
  /**
   * @default "/run/promtail"
   */
  mountPath?: string;
};

export type PromtailHelmValuesServiceMonitor = {
  /**
   * If enabled, ServiceMonitor resources for Prometheus Operator are created
   *
   * @default false
   */
  enabled?: boolean;
  namespace?: unknown;
  /**
   * Namespace selector for ServiceMonitor resources
   *
   * @default {}
   */
  namespaceSelector?: PromtailHelmValuesServiceMonitorNamespaceSelector;
  /**
   * ServiceMonitor annotations
   *
   * @default {}
   */
  annotations?: PromtailHelmValuesServiceMonitorAnnotations;
  /**
   * Additional ServiceMonitor labels
   *
   * @default {}
   */
  labels?: PromtailHelmValuesServiceMonitorLabels;
  interval?: unknown;
  scrapeTimeout?: unknown;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
  targetLabels?: unknown[];
  /**
   * ServiceMonitor will use http by default, but you can pick https as well
   *
   * @default "http"
   */
  scheme?: string;
  tlsConfig?: unknown;
  /**
   * Prometheus rules will be deployed for alerting purposes
   *
   * @default {"enabled":false,"additionalLabels":{},"rules":[]}
   */
  prometheusRule?: PromtailHelmValuesServiceMonitorPrometheusRule;
};

export type PromtailHelmValuesServiceMonitorNamespaceSelector = object;

export type PromtailHelmValuesServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PromtailHelmValuesServiceMonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PromtailHelmValuesServiceMonitorPrometheusRule = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  additionalLabels?: PromtailHelmValuesServiceMonitorPrometheusRuleAdditionalLabels;
  rules?: unknown[];
};

export type PromtailHelmValuesServiceMonitorPrometheusRuleAdditionalLabels = object;

export type PromtailHelmValuesExtraContainers = object;

export type PromtailHelmValuesExtraPorts = object;

export type PromtailHelmValuesPodSecurityPolicy = {
  /**
   * @default true
   */
  privileged?: boolean;
  /**
   * @default true
   */
  allowPrivilegeEscalation?: boolean;
  volumes?: string[];
  /**
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @default false
   */
  hostIPC?: boolean;
  /**
   * @default false
   */
  hostPID?: boolean;
  /**
   * @default {"rule":"RunAsAny"}
   */
  runAsUser?: PromtailHelmValuesPodSecurityPolicyRunAsUser;
  /**
   * @default {"rule":"RunAsAny"}
   */
  seLinux?: PromtailHelmValuesPodSecurityPolicySeLinux;
  /**
   * @default {"rule":"RunAsAny"}
   */
  supplementalGroups?: PromtailHelmValuesPodSecurityPolicySupplementalGroups;
  /**
   * @default {"rule":"RunAsAny"}
   */
  fsGroup?: PromtailHelmValuesPodSecurityPolicyFsGroup;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  requiredDropCapabilities?: string[];
};

export type PromtailHelmValuesPodSecurityPolicyRunAsUser = {
  /**
   * @default "RunAsAny"
   */
  rule?: string;
};

export type PromtailHelmValuesPodSecurityPolicySeLinux = {
  /**
   * @default "RunAsAny"
   */
  rule?: string;
};

export type PromtailHelmValuesPodSecurityPolicySupplementalGroups = {
  /**
   * @default "RunAsAny"
   */
  rule?: string;
};

export type PromtailHelmValuesPodSecurityPolicyFsGroup = {
  /**
   * @default "RunAsAny"
   */
  rule?: string;
};

export type PromtailHelmValuesConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable Promtail config from Helm chart
   * Set `configmap.enabled: true` and this to `false` to manage your own Promtail config
   * See default config in `values.yaml`
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * The log level of the Promtail server
   * Must be reference in `config.file` to configure `server.log_level`
   * See default config in `values.yaml`
   *
   * @default "info"
   */
  logLevel?: string;
  /**
   * The log format of the Promtail server
   * Must be reference in `config.file` to configure `server.log_format`
   * Valid formats: `logfmt, json`
   * See default config in `values.yaml`
   *
   * @default "logfmt"
   */
  logFormat?: string;
  /**
   * The port of the Promtail server
   * Must be reference in `config.file` to configure `server.http_listen_port`
   * See default config in `values.yaml`
   *
   * @default 3101
   */
  serverPort?: number;
  clients?: PromtailHelmValuesConfigClientsElement[];
  /**
   * Configures where Promtail will save it's positions file, to resume reading after restarts.
   * Must be referenced in `config.file` to configure `positions`
   *
   * @default {"filename":"/run/promtail/positions.yaml"}
   */
  positions?: PromtailHelmValuesConfigPositions;
  /**
   * The config to enable tracing
   *
   * @default false
   */
  enableTracing?: boolean;
  /**
   * A section of reusable snippets that can be reference in `config.file`.
   * Custom snippets may be added in order to reduce redundancy.
   * This is especially helpful when multiple `kubernetes_sd_configs` are use which usually have large parts in common.
   *
   * @default {...} (8 keys)
   */
  snippets?: PromtailHelmValuesConfigSnippets;
  /**
   * Config file contents for Promtail.
   * Must be configured as string.
   * It is templated so it can be assembled from reusable snippets in order to avoid redundancy.
   *
   * @default "server:
  log_level: {{ .Values.config.logLevel..."
   */
  file?: string;
};

export type PromtailHelmValuesConfigClientsElement = {
  /**
   * @default "http://loki-gateway/loki/api/v1/push"
   */
  url?: string;
};

export type PromtailHelmValuesConfigPositions = {
  /**
   * @default "/run/promtail/positions.yaml"
   */
  filename?: string;
};

export type PromtailHelmValuesConfigSnippets = {
  pipelineStages?: PromtailHelmValuesConfigSnippetsPipelineStagesElement[];
  common?: PromtailHelmValuesConfigSnippetsCommonElement[];
  /**
   * If set to true, adds an additional label for the scrape job.
   * This helps debug the Promtail config.
   *
   * @default false
   */
  addScrapeJobLabel?: boolean;
  /**
   * You can put here any keys that will be directly added to the config file's 'limits_config' block.
   *
   * @default ""
   */
  extraLimitsConfig?: string;
  /**
   * You can put here any keys that will be directly added to the config file's 'server' block.
   *
   * @default ""
   */
  extraServerConfigs?: string;
  /**
   * You can put here any additional scrape configs you want to add to the config file.
   *
   * @default ""
   */
  extraScrapeConfigs?: string;
  extraRelabelConfigs?: unknown[];
  /**
   * @default "# See also https://github.com/grafana/loki/blob..."
   */
  scrapeConfigs?: string;
};

export type PromtailHelmValuesConfigSnippetsPipelineStagesElement = {
  /**
   * @default {}
   */
  cri?: PromtailHelmValuesConfigSnippetsPipelineStagesCri;
};

export type PromtailHelmValuesConfigSnippetsPipelineStagesCri = object;

export type PromtailHelmValuesConfigSnippetsCommonElement = {
  /**
   * @default "replace"
   */
  action?: string;
  source_labels?: string[];
  /**
   * @default "node_name"
   */
  target_label?: string;
};

export type PromtailHelmValuesNetworkPolicy = {
  /**
   * Specifies whether Network Policies should be created
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"podSelector":{},"namespaceSelector":{},"cidrs":[]}
   */
  metrics?: PromtailHelmValuesNetworkPolicyMetrics;
  /**
   * @default {"port":8443,"cidrs":[]}
   */
  k8sApi?: PromtailHelmValuesNetworkPolicyK8sApi;
};

export type PromtailHelmValuesNetworkPolicyMetrics = {
  /**
   * Specifies the Pods which are allowed to access the metrics port.
   * As this is cross-namespace communication, you also neeed the namespaceSelector.
   *
   * @default {}
   */
  podSelector?: PromtailHelmValuesNetworkPolicyMetricsPodSelector;
  /**
   * Specifies the namespaces which are allowed to access the metrics port
   *
   * @default {}
   */
  namespaceSelector?: PromtailHelmValuesNetworkPolicyMetricsNamespaceSelector;
  cidrs?: unknown[];
};

export type PromtailHelmValuesNetworkPolicyMetricsPodSelector = object;

export type PromtailHelmValuesNetworkPolicyMetricsNamespaceSelector = object;

export type PromtailHelmValuesNetworkPolicyK8sApi = {
  /**
   * Specify the k8s API endpoint port
   *
   * @default 8443
   */
  port?: number;
  cidrs?: unknown[];
};

export type PromtailHelmValuesSidecar = {
  /**
   * @default {...} (11 keys)
   */
  configReloader?: PromtailHelmValuesSidecarConfigReloader;
};

export type PromtailHelmValuesSidecarConfigReloader = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {...} (4 keys)
   */
  image?: PromtailHelmValuesSidecarConfigReloaderImage;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  /**
   * The security context for containers for sidecar config-reloader
   *
   * @default {"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}
   */
  containerSecurityContext?: PromtailHelmValuesSidecarConfigReloaderContainerSecurityContext;
  /**
   * Readiness probe for sidecar config-reloader
   *
   * @default {}
   */
  readinessProbe?: PromtailHelmValuesSidecarConfigReloaderReadinessProbe;
  /**
   * Liveness probe for sidecar config-reloader
   *
   * @default {}
   */
  livenessProbe?: PromtailHelmValuesSidecarConfigReloaderLivenessProbe;
  /**
   * Resource requests and limits for sidecar config-reloader
   *
   * @default {}
   */
  resources?: PromtailHelmValuesSidecarConfigReloaderResources;
  /**
   * @default {"serverPort":9533}
   */
  config?: PromtailHelmValuesSidecarConfigReloaderConfig;
  /**
   * @default {"enabled":true}
   */
  serviceMonitor?: PromtailHelmValuesSidecarConfigReloaderServiceMonitor;
};

export type PromtailHelmValuesSidecarConfigReloaderImage = {
  /**
   * The Docker registry for sidecar config-reloader
   *
   * @default "ghcr.io"
   */
  registry?: string;
  /**
   * Docker image repository for sidecar config-reloader
   *
   * @default "jimmidyson/configmap-reload"
   */
  repository?: string;
  /**
   * Docker image tag for sidecar config-reloader
   *
   * @default "v0.12.0"
   */
  tag?: string;
  /**
   * Docker image pull policy for sidecar config-reloader
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type PromtailHelmValuesSidecarConfigReloaderContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: PromtailHelmValuesSidecarConfigReloaderContainerSecurityContextCapabilities;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type PromtailHelmValuesSidecarConfigReloaderContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type PromtailHelmValuesSidecarConfigReloaderReadinessProbe = object;

export type PromtailHelmValuesSidecarConfigReloaderLivenessProbe = object;

export type PromtailHelmValuesSidecarConfigReloaderResources = object;

export type PromtailHelmValuesSidecarConfigReloaderConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * The port of the config-reloader server
   *
   * @default 9533
   */
  serverPort?: number;
};

export type PromtailHelmValuesSidecarConfigReloaderServiceMonitor = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type PromtailHelmValues = {
  nameOverride?: unknown;
  fullnameOverride?: unknown;
  /**
   * @default {"imageRegistry":"","imagePullSecrets":[]}
   */
  global?: PromtailHelmValuesGlobal;
  /**
   * @default {"enabled":true,"autoscaling":{"enabled":false,"controlledResources":[],"maxAllowed":{},"minAllowed":{}}}
   */
  daemonset?: PromtailHelmValuesDaemonset;
  /**
   * @default {...} (4 keys)
   */
  deployment?: PromtailHelmValuesDeployment;
  /**
   * @default {"enabled":false,"labels":{},"annotations":{}}
   */
  service?: PromtailHelmValuesService;
  /**
   * @default {"labels":{},"annotations":{}}
   */
  secret?: PromtailHelmValuesSecret;
  /**
   * @default {"enabled":false}
   */
  configmap?: PromtailHelmValuesConfigmap;
  initContainer?: unknown[];
  /**
   * @default {...} (4 keys)
   */
  image?: PromtailHelmValuesImage;
  imagePullSecrets?: unknown[];
  hostAliases?: unknown[];
  hostNetwork?: unknown;
  /**
   * Annotations for the DaemonSet
   *
   * @default {}
   */
  annotations?: PromtailHelmValuesAnnotations;
  /**
   * Number of old history to retain to allow rollback (If not set, default Kubernetes value is set to 10)
   * The update strategy for the DaemonSet
   *
   * @default {}
   */
  updateStrategy?: PromtailHelmValuesUpdateStrategy;
  /**
   * Pod labels
   *
   * @default {}
   */
  podLabels?: PromtailHelmValuesPodLabels;
  /**
   * Pod annotations
   *
   * @default {}
   */
  podAnnotations?: PromtailHelmValuesPodAnnotations;
  priorityClassName?: unknown;
  /**
   * Liveness probe
   *
   * @default {}
   */
  livenessProbe?: PromtailHelmValuesLivenessProbe;
  /**
   * Readiness probe
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: PromtailHelmValuesReadinessProbe;
  /**
   * Resource requests and limits
   *
   * @default {}
   */
  resources?: PromtailHelmValuesResources;
  /**
   * The security context for pods
   *
   * @default {"runAsUser":0,"runAsGroup":0}
   */
  podSecurityContext?: PromtailHelmValuesPodSecurityContext;
  /**
   * The security context for containers
   *
   * @default {"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}
   */
  containerSecurityContext?: PromtailHelmValuesContainerSecurityContext;
  /**
   * @default {"create":true,"pspEnabled":false}
   */
  rbac?: PromtailHelmValuesRbac;
  namespace?: unknown;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: PromtailHelmValuesServiceAccount;
  /**
   * Automatically mount API credentials for a particular Pod
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * Node selector for pods
   *
   * @default {}
   */
  nodeSelector?: PromtailHelmValuesNodeSelector;
  /**
   * Affinity configuration for pods
   *
   * @default {}
   */
  affinity?: PromtailHelmValuesAffinity;
  tolerations?: PromtailHelmValuesTolerationsElement[];
  defaultVolumes?: PromtailHelmValuesDefaultVolumesElement[];
  defaultVolumeMounts?: PromtailHelmValuesDefaultVolumeMountsElement[];
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  /**
   * Configure enableServiceLinks in pod
   *
   * @default true
   */
  enableServiceLinks?: boolean;
  /**
   * ServiceMonitor configuration
   *
   * @default {...} (13 keys)
   */
  serviceMonitor?: PromtailHelmValuesServiceMonitor;
  /**
   * Extra containers created as part of a Promtail Deployment resource
   * Note that the key is used as the `name` field, i.e. below will create a
   * container named `promtail-proxy`.
   *
   * @default {}
   */
  extraContainers?: PromtailHelmValuesExtraContainers;
  /**
   * Configure additional ports and services. For each configured port, a corresponding service is created.
   * See values.yaml for details
   *
   * @default {}
   */
  extraPorts?: PromtailHelmValuesExtraPorts;
  /**
   * PodSecurityPolicy configuration.
   *
   * @default {...} (12 keys)
   */
  podSecurityPolicy?: PromtailHelmValuesPodSecurityPolicy;
  /**
   * Section for crafting Promtails config file. The only directly relevant value is `config.file`
   * which is a templated string that references the other values and snippets below this key.
   *
   * @default {...} (9 keys)
   */
  config?: PromtailHelmValuesConfig;
  /**
   * @default {"enabled":false,"metrics":{"podSelector":{},"namespaceSelector":{},"cidrs":[]},"k8sApi":{"port":8443,"cidrs":[]}}
   */
  networkPolicy?: PromtailHelmValuesNetworkPolicy;
  /**
   * Base path to server all API routes fro
   *
   * @default ""
   */
  httpPathPrefix?: string;
  /**
   * @default {"configReloader":{"enabled":false,"image":{"registry":"ghcr.io","repository":"jimmidyson/configmap-reload","tag":"v0.12.0","pullPolicy":"IfNotPresent"},"extraArgs":[],"extraEnv":[],"extraEnvFrom":[],"containerSecurityContext":{"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false},"readinessProbe":{},"livenessProbe":{},"resources":{},"config":{"serverPort":9533},"serviceMonitor":{"enabled":true}}}
   */
  sidecar?: PromtailHelmValuesSidecar;
  extraObjects?: unknown[];
};

export type PromtailHelmParameters = {
  nameOverride?: string;
  fullnameOverride?: string;
  "global.imageRegistry"?: string;
  "global.imagePullSecrets"?: string;
  "daemonset.enabled"?: string;
  "daemonset.autoscaling.enabled"?: string;
  "daemonset.autoscaling.controlledResources"?: string;
  "deployment.enabled"?: string;
  "deployment.replicaCount"?: string;
  "deployment.autoscaling.enabled"?: string;
  "deployment.autoscaling.minReplicas"?: string;
  "deployment.autoscaling.maxReplicas"?: string;
  "deployment.autoscaling.targetCPUUtilizationPercentage"?: string;
  "deployment.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "deployment.strategy.type"?: string;
  "service.enabled"?: string;
  "configmap.enabled"?: string;
  initContainer?: string;
  "image.registry"?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "image.pullPolicy"?: string;
  imagePullSecrets?: string;
  hostAliases?: string;
  hostNetwork?: string;
  priorityClassName?: string;
  "readinessProbe.failureThreshold"?: string;
  "readinessProbe.httpGet.path"?: string;
  "readinessProbe.httpGet.port"?: string;
  "readinessProbe.initialDelaySeconds"?: string;
  "readinessProbe.periodSeconds"?: string;
  "readinessProbe.successThreshold"?: string;
  "readinessProbe.timeoutSeconds"?: string;
  "podSecurityContext.runAsUser"?: string;
  "podSecurityContext.runAsGroup"?: string;
  "containerSecurityContext.readOnlyRootFilesystem"?: string;
  "containerSecurityContext.capabilities.drop"?: string;
  "containerSecurityContext.allowPrivilegeEscalation"?: string;
  "rbac.create"?: string;
  "rbac.pspEnabled"?: string;
  namespace?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "serviceAccount.imagePullSecrets"?: string;
  "serviceAccount.automountServiceAccountToken"?: string;
  automountServiceAccountToken?: string;
  "tolerations.key"?: string;
  "tolerations.operator"?: string;
  "tolerations.effect"?: string;
  "defaultVolumes.name"?: string;
  "defaultVolumes.hostPath.path"?: string;
  "defaultVolumeMounts.name"?: string;
  "defaultVolumeMounts.mountPath"?: string;
  extraVolumes?: string;
  extraVolumeMounts?: string;
  extraArgs?: string;
  extraEnv?: string;
  extraEnvFrom?: string;
  enableServiceLinks?: string;
  "serviceMonitor.enabled"?: string;
  "serviceMonitor.namespace"?: string;
  "serviceMonitor.interval"?: string;
  "serviceMonitor.scrapeTimeout"?: string;
  "serviceMonitor.relabelings"?: string;
  "serviceMonitor.metricRelabelings"?: string;
  "serviceMonitor.targetLabels"?: string;
  "serviceMonitor.scheme"?: string;
  "serviceMonitor.tlsConfig"?: string;
  "serviceMonitor.prometheusRule.enabled"?: string;
  "serviceMonitor.prometheusRule.rules"?: string;
  "podSecurityPolicy.privileged"?: string;
  "podSecurityPolicy.allowPrivilegeEscalation"?: string;
  "podSecurityPolicy.volumes"?: string;
  "podSecurityPolicy.hostNetwork"?: string;
  "podSecurityPolicy.hostIPC"?: string;
  "podSecurityPolicy.hostPID"?: string;
  "podSecurityPolicy.runAsUser.rule"?: string;
  "podSecurityPolicy.seLinux.rule"?: string;
  "podSecurityPolicy.supplementalGroups.rule"?: string;
  "podSecurityPolicy.fsGroup.rule"?: string;
  "podSecurityPolicy.readOnlyRootFilesystem"?: string;
  "podSecurityPolicy.requiredDropCapabilities"?: string;
  "config.enabled"?: string;
  "config.logLevel"?: string;
  "config.logFormat"?: string;
  "config.serverPort"?: string;
  "config.clients.url"?: string;
  "config.positions.filename"?: string;
  "config.enableTracing"?: string;
  "config.snippets.common.action"?: string;
  "config.snippets.common.source_labels"?: string;
  "config.snippets.common.target_label"?: string;
  "config.snippets.addScrapeJobLabel"?: string;
  "config.snippets.extraLimitsConfig"?: string;
  "config.snippets.extraServerConfigs"?: string;
  "config.snippets.extraScrapeConfigs"?: string;
  "config.snippets.extraRelabelConfigs"?: string;
  "config.snippets.scrapeConfigs"?: string;
  "config.file"?: string;
  "networkPolicy.enabled"?: string;
  "networkPolicy.metrics.cidrs"?: string;
  "networkPolicy.k8sApi.port"?: string;
  "networkPolicy.k8sApi.cidrs"?: string;
  httpPathPrefix?: string;
  "sidecar.configReloader.enabled"?: string;
  "sidecar.configReloader.image.registry"?: string;
  "sidecar.configReloader.image.repository"?: string;
  "sidecar.configReloader.image.tag"?: string;
  "sidecar.configReloader.image.pullPolicy"?: string;
  "sidecar.configReloader.extraArgs"?: string;
  "sidecar.configReloader.extraEnv"?: string;
  "sidecar.configReloader.extraEnvFrom"?: string;
  "sidecar.configReloader.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "sidecar.configReloader.containerSecurityContext.capabilities.drop"?: string;
  "sidecar.configReloader.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "sidecar.configReloader.config.serverPort"?: string;
  "sidecar.configReloader.serviceMonitor.enabled"?: string;
  extraObjects?: string;
};
