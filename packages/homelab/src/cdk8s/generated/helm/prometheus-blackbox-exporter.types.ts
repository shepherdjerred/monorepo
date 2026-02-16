// Generated TypeScript types for prometheus-blackbox-exporter Helm chart

export type PrometheusblackboxexporterHelmValuesGlobal = {
  /**
   * Global image registry to use if it needs to be overriden for some specific use cases (e.g local registries, custom images, ...)
   *
   * @default ""
   */
  imageRegistry?: string;
};

export type PrometheusblackboxexporterHelmValuesPodDisruptionBudget = object;

export type PrometheusblackboxexporterHelmValuesStrategy = {
  /**
   * @default {"maxSurge":1,"maxUnavailable":0}
   */
  rollingUpdate?: PrometheusblackboxexporterHelmValuesStrategyRollingUpdate;
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type PrometheusblackboxexporterHelmValuesStrategyRollingUpdate = {
  /**
   * @default 1
   */
  maxSurge?: number;
  /**
   * @default 0
   */
  maxUnavailable?: number;
};

export type PrometheusblackboxexporterHelmValuesImage = {
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "prometheus/blackbox-exporter"
   */
  repository?: string;
  /**
   * Overrides the image tag whose default is {{ printf "v%s" .Chart.AppVersion }}
   *
   * @default ""
   */
  tag?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * @default ""
   */
  digest?: string;
};

export type PrometheusblackboxexporterHelmValuesPodSecurityContext = object;

export type PrometheusblackboxexporterHelmValuesSecurityContext = {
  /**
   * @default 1000
   */
  runAsUser?: number;
  /**
   * @default 1000
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: PrometheusblackboxexporterHelmValuesSecurityContextCapabilities;
};

export type PrometheusblackboxexporterHelmValuesSecurityContextCapabilities = {
  drop?: string[];
};

export type PrometheusblackboxexporterHelmValuesLivenessProbe = {
  /**
   * @default {"path":"/-/healthy","port":"http"}
   */
  httpGet?: PrometheusblackboxexporterHelmValuesLivenessProbeHttpGet;
  /**
   * @default 3
   */
  failureThreshold?: number;
};

export type PrometheusblackboxexporterHelmValuesLivenessProbeHttpGet = {
  /**
   * @default "/-/healthy"
   */
  path?: string;
  /**
   * @default "http"
   */
  port?: string;
};

export type PrometheusblackboxexporterHelmValuesReadinessProbe = {
  /**
   * @default {"path":"/-/healthy","port":"http"}
   */
  httpGet?: PrometheusblackboxexporterHelmValuesReadinessProbeHttpGet;
};

export type PrometheusblackboxexporterHelmValuesReadinessProbeHttpGet = {
  /**
   * @default "/-/healthy"
   */
  path?: string;
  /**
   * @default "http"
   */
  port?: string;
};

export type PrometheusblackboxexporterHelmValuesNodeSelector = object;

export type PrometheusblackboxexporterHelmValuesAffinity = object;

export type PrometheusblackboxexporterHelmValuesConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"http_2xx":{"prober":"http","timeout":"5s","http":{"valid_http_versions":["HTTP/1.1","HTTP/2.0"],"follow_redirects":true,"preferred_ip_protocol":"ip4"}}}
   */
  modules?: PrometheusblackboxexporterHelmValuesConfigModules;
};

export type PrometheusblackboxexporterHelmValuesConfigModules = {
  /**
   * @default {"prober":"http","timeout":"5s","http":{"valid_http_versions":["HTTP/1.1","HTTP/2.0"],"follow_redirects":true,"preferred_ip_protocol":"ip4"}}
   */
  http_2xx?: PrometheusblackboxexporterHelmValuesConfigModulesHttp2xx;
};

export type PrometheusblackboxexporterHelmValuesConfigModulesHttp2xx = {
  /**
   * @default "http"
   */
  prober?: string;
  /**
   * @default "5s"
   */
  timeout?: string;
  /**
   * @default {"valid_http_versions":["HTTP/1.1","HTTP/2.0"],"follow_redirects":true,"preferred_ip_protocol":"ip4"}
   */
  http?: PrometheusblackboxexporterHelmValuesConfigModulesHttp2xxHttp;
};

export type PrometheusblackboxexporterHelmValuesConfigModulesHttp2xxHttp = {
  valid_http_versions?: string[];
  /**
   * @default true
   */
  follow_redirects?: boolean;
  /**
   * @default "ip4"
   */
  preferred_ip_protocol?: string;
};

export type PrometheusblackboxexporterHelmValuesResources = object;

export type PrometheusblackboxexporterHelmValuesService = {
  /**
   * @default {}
   */
  annotations?: PrometheusblackboxexporterHelmValuesServiceAnnotations;
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesServiceLabels;
  /**
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default 9115
   */
  port?: number;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: PrometheusblackboxexporterHelmValuesServiceIpDualStack;
};

export type PrometheusblackboxexporterHelmValuesServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesServiceIpDualStack = {
  /**
   * @default false
   */
  enabled?: boolean;
  ipFamilies?: string[];
  /**
   * @default "PreferDualStack"
   */
  ipFamilyPolicy?: string;
};

export type PrometheusblackboxexporterHelmValuesServiceAccount = {
  /**
   * Specifies whether a ServiceAccount should be created
   *
   * @default true
   */
  create?: boolean;
  name?: unknown;
  /**
   * @default {}
   */
  annotations?: PrometheusblackboxexporterHelmValuesServiceAccountAnnotations;
};

export type PrometheusblackboxexporterHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesIngress = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  className?: string;
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesIngressLabels;
  /**
   * kubernetes.io/tls-acme: "true"
   *
   * @default {}
   */
  annotations?: PrometheusblackboxexporterHelmValuesIngressAnnotations;
  hosts?: PrometheusblackboxexporterHelmValuesIngressHostsElement[];
  tls?: unknown[];
};

export type PrometheusblackboxexporterHelmValuesIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesIngressHostsElement = {
  /**
   * @default "chart-example.local"
   */
  host?: string;
  paths?: PrometheusblackboxexporterHelmValuesIngressHostsPathsElement[];
};

export type PrometheusblackboxexporterHelmValuesIngressHostsPathsElement = {
  /**
   * @default "/"
   */
  path?: string;
  /**
   * @default "ImplementationSpecific"
   */
  pathType?: string;
};

export type PrometheusblackboxexporterHelmValuesPodAnnotations = object;

export type PrometheusblackboxexporterHelmValuesDeploymentAnnotations = object;

export type PrometheusblackboxexporterHelmValuesSecretAnnotations = object;

export type PrometheusblackboxexporterHelmValuesPod = {
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesPodLabels;
};

export type PrometheusblackboxexporterHelmValuesPodLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitor = {
  /**
   * Port can be defined by assigning a value for the port key below
   * If true, a ServiceMonitor CRD is created for a prometheus operator
   * https://github.com/coreos/prometheus-operator for each target
   *
   * @default {...} (9 keys)
   */
  selfMonitor?: PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitor;
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Default values that will be used for all ServiceMonitors created by `targets`
   *
   * @default {...} (7 keys)
   */
  defaults?: PrometheusblackboxexporterHelmValuesServiceMonitorDefaults;
  /**
   * @default "http"
   */
  scheme?: string;
  /**
   * @default "/probe"
   */
  path?: string;
  /**
   * Of type: https://github.com/coreos/prometheus-operator/blob/master/Documentation/api.md#tlsconfig
   *
   * @default {}
   */
  tlsConfig?: PrometheusblackboxexporterHelmValuesServiceMonitorTlsConfig;
  bearerTokenFile?: unknown;
  targets?: unknown;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitor = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorAdditionalMetricsRelabels;
  additionalRelabeling?: unknown[];
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorLabels;
  /**
   * @default "/metrics"
   */
  path?: string;
  /**
   * @default "http"
   */
  scheme?: string;
  /**
   * @default {}
   */
  tlsConfig?: PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorTlsConfig;
  /**
   * @default "30s"
   */
  interval?: string;
  /**
   * @default "30s"
   */
  scrapeTimeout?: string;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorAdditionalMetricsRelabels = object;

export type PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorTlsConfig = object;

export type PrometheusblackboxexporterHelmValuesServiceMonitorDefaults = {
  /**
   * @default {}
   */
  additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesServiceMonitorDefaultsAdditionalMetricsRelabels;
  additionalRelabeling?: unknown[];
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesServiceMonitorDefaultsLabels;
  /**
   * @default "30s"
   */
  interval?: string;
  /**
   * @default "30s"
   */
  scrapeTimeout?: string;
  /**
   * @default true
   */
  honorTimestamps?: boolean;
  /**
   * @default "http_2xx"
   */
  module?: string;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitorDefaultsAdditionalMetricsRelabels = object;

export type PrometheusblackboxexporterHelmValuesServiceMonitorDefaultsLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitorTlsConfig = object;

export type PrometheusblackboxexporterHelmValuesPrometheusRule = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  additionalLabels?: PrometheusblackboxexporterHelmValuesPrometheusRuleAdditionalLabels;
  /**
   * @default ""
   */
  namespace?: string;
  rules?: unknown[];
};

export type PrometheusblackboxexporterHelmValuesPrometheusRuleAdditionalLabels = object;

export type PrometheusblackboxexporterHelmValuesPodMonitoring = {
  /**
   * If true, a PodMonitoring CR is created for google managed prometheus
   * https://cloud.google.com/stackdriver/docs/managed-prometheus/setup-managed#gmp-pod-monitoring for blackbox-exporter itself
   *
   * @default {...} (6 keys)
   */
  selfMonitor?: PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitor;
  /**
   * If true, a PodMonitoring CR is created for a google managed prometheus
   * https://cloud.google.com/stackdriver/docs/managed-prometheus/setup-managed#gmp-pod-monitoring for each target
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Default values that will be used for all PodMonitoring created by `targets`
   * Following PodMonitoring API specs https://github.com/GoogleCloudPlatform/prometheus-engine/blob/main/doc/api.md#scrapeendpoint
   *
   * @default {...} (5 keys)
   */
  defaults?: PrometheusblackboxexporterHelmValuesPodMonitoringDefaults;
  /**
   * @default "http"
   */
  scheme?: string;
  /**
   * @default "/probe"
   */
  path?: string;
  /**
   * Of type: https://github.com/coreos/prometheus-operator/blob/master/Documentation/api.md#tlsconfig
   *
   * @default {}
   */
  tlsConfig?: PrometheusblackboxexporterHelmValuesPodMonitoringTlsConfig;
  targets?: unknown;
};

export type PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitor = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitorAdditionalMetricsRelabels;
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitorLabels;
  /**
   * @default "/metrics"
   */
  path?: string;
  /**
   * @default "30s"
   */
  interval?: string;
  /**
   * @default "30s"
   */
  scrapeTimeout?: string;
};

export type PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitorAdditionalMetricsRelabels = object;

export type PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesPodMonitoringDefaults = {
  /**
   * @default {}
   */
  additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesPodMonitoringDefaultsAdditionalMetricsRelabels;
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesPodMonitoringDefaultsLabels;
  /**
   * @default "30s"
   */
  interval?: string;
  /**
   * @default "30s"
   */
  scrapeTimeout?: string;
  /**
   * @default "http_2xx"
   */
  module?: string;
};

export type PrometheusblackboxexporterHelmValuesPodMonitoringDefaultsAdditionalMetricsRelabels = object;

export type PrometheusblackboxexporterHelmValuesPodMonitoringDefaultsLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesPodMonitoringTlsConfig = object;

export type PrometheusblackboxexporterHelmValuesNetworkPolicy = {
  /**
   * Enable network policy and allow access from anywhere
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Limit access only from monitoring namespace
   * Before setting this value to true, you must add the name=monitoring label to the monitoring namespace.  Name can be rewritten by monitoringNamespaceName
   * Network Policy uses label filtering
   *
   * @default false
   */
  allowMonitoringNamespace?: boolean;
  /**
   * Rewrite monitoring namespace in network policy (default value monitoring)
   *
   * @default "monitoring"
   */
  monitoringNamespaceName?: string;
};

export type PrometheusblackboxexporterHelmValuesCommonLabels = object;

export type PrometheusblackboxexporterHelmValuesVerticalPodAutoscaler = {
  /**
   * @default false
   */
  enabled?: boolean;
  controlledResources?: unknown[];
  /**
   * Specifies which resource values should be controlled: RequestsOnly or RequestsAndLimits.
   * Define the max allowed resources for the pod
   *
   * @default {}
   */
  maxAllowed?: PrometheusblackboxexporterHelmValuesVerticalPodAutoscalerMaxAllowed;
  /**
   * Define the min allowed resources for the pod
   *
   * @default {}
   */
  minAllowed?: PrometheusblackboxexporterHelmValuesVerticalPodAutoscalerMinAllowed;
  /**
   * @default {"updateMode":"Auto"}
   */
  updatePolicy?: PrometheusblackboxexporterHelmValuesVerticalPodAutoscalerUpdatePolicy;
};

export type PrometheusblackboxexporterHelmValuesVerticalPodAutoscalerMaxAllowed = object;

export type PrometheusblackboxexporterHelmValuesVerticalPodAutoscalerMinAllowed = object;

export type PrometheusblackboxexporterHelmValuesVerticalPodAutoscalerUpdatePolicy = {
  /**
   * Specifies minimal number of replicas which need to be alive for VPA Updater to attempt pod eviction
   * Specifies whether recommended updates are applied when a Pod is started and whether recommended updates
   * are applied during the life of a Pod. Possible values are "Off", "Initial", "Recreate", and "Auto".
   *
   * @default "Auto"
   */
  updateMode?: string;
};

export type PrometheusblackboxexporterHelmValuesConfigReloader = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 8080
   */
  containerPort?: number;
  /**
   * @default {"logFormat":"logfmt","logLevel":"info","watchInterval":"1m"}
   */
  config?: PrometheusblackboxexporterHelmValuesConfigReloaderConfig;
  /**
   * @default {...} (5 keys)
   */
  image?: PrometheusblackboxexporterHelmValuesConfigReloaderImage;
  /**
   * @default {...} (6 keys)
   */
  securityContext?: PrometheusblackboxexporterHelmValuesConfigReloaderSecurityContext;
  /**
   * @default {"limits":{"memory":"50Mi"},"requests":{"cpu":"10m","memory":"20Mi"}}
   */
  resources?: PrometheusblackboxexporterHelmValuesConfigReloaderResources;
  /**
   * @default {"httpGet":{"path":"/healthz","port":"reloader-web","scheme":"HTTP"}}
   */
  livenessProbe?: PrometheusblackboxexporterHelmValuesConfigReloaderLivenessProbe;
  /**
   * @default {"httpGet":{"path":"/healthz","port":"reloader-web","scheme":"HTTP"}}
   */
  readinessProbe?: PrometheusblackboxexporterHelmValuesConfigReloaderReadinessProbe;
  /**
   * @default {"port":8080}
   */
  service?: PrometheusblackboxexporterHelmValuesConfigReloaderService;
  /**
   * @default {"selfMonitor":{"additionalMetricsRelabels":{},"additionalRelabeling":[],"path":"/metrics","scheme":"http","tlsConfig":{},"interval":"30s","scrapeTimeout":"30s"}}
   */
  serviceMonitor?: PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitor;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "logfmt"
   */
  logFormat?: string;
  /**
   * @default "info"
   */
  logLevel?: string;
  /**
   * @default "1m"
   */
  watchInterval?: string;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderImage = {
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "prometheus-operator/prometheus-config-reloader"
   */
  repository?: string;
  /**
   * @default "v0.87.1"
   */
  tag?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * @default ""
   */
  digest?: string;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderSecurityContext = {
  /**
   * @default 1000
   */
  runAsUser?: number;
  /**
   * @default 1000
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: PrometheusblackboxexporterHelmValuesConfigReloaderSecurityContextCapabilities;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderSecurityContextCapabilities = {
  drop?: string[];
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderResources = {
  /**
   * @default {"memory":"50Mi"}
   */
  limits?: PrometheusblackboxexporterHelmValuesConfigReloaderResourcesLimits;
  /**
   * @default {"cpu":"10m","memory":"20Mi"}
   */
  requests?: PrometheusblackboxexporterHelmValuesConfigReloaderResourcesRequests;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderResourcesLimits = {
  /**
   * @default "50Mi"
   */
  memory?: string;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderResourcesRequests = {
  /**
   * @default "10m"
   */
  cpu?: string;
  /**
   * @default "20Mi"
   */
  memory?: string;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderLivenessProbe = {
  /**
   * @default {"path":"/healthz","port":"reloader-web","scheme":"HTTP"}
   */
  httpGet?: PrometheusblackboxexporterHelmValuesConfigReloaderLivenessProbeHttpGet;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderLivenessProbeHttpGet = {
  /**
   * @default "/healthz"
   */
  path?: string;
  /**
   * @default "reloader-web"
   */
  port?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderReadinessProbe = {
  /**
   * @default {"path":"/healthz","port":"reloader-web","scheme":"HTTP"}
   */
  httpGet?: PrometheusblackboxexporterHelmValuesConfigReloaderReadinessProbeHttpGet;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderReadinessProbeHttpGet = {
  /**
   * @default "/healthz"
   */
  path?: string;
  /**
   * @default "reloader-web"
   */
  port?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderService = {
  /**
   * @default 8080
   */
  port?: number;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitor = {
  /**
   * @default {...} (7 keys)
   */
  selfMonitor?: PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitor;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitor = {
  /**
   * @default {}
   */
  additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitorAdditionalMetricsRelabels;
  additionalRelabeling?: unknown[];
  /**
   * @default "/metrics"
   */
  path?: string;
  /**
   * @default "http"
   */
  scheme?: string;
  /**
   * @default {}
   */
  tlsConfig?: PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitorTlsConfig;
  /**
   * @default "30s"
   */
  interval?: string;
  /**
   * @default "30s"
   */
  scrapeTimeout?: string;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitorAdditionalMetricsRelabels =
  object;

export type PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitorTlsConfig = object;

export type PrometheusblackboxexporterHelmValues = {
  /**
   * @default {"imageRegistry":""}
   */
  global?: PrometheusblackboxexporterHelmValuesGlobal;
  /**
   * @default "Always"
   */
  restartPolicy?: string;
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * Override the namespace
   *
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * Override Kubernetes version if your distribution does not follow semver v2
   *
   * @default ""
   */
  kubeVersionOverride?: string;
  /**
   * set to true to add the release label so scraping of the servicemonitor with kube-prometheus-stack works out of the box
   *
   * @default false
   */
  releaseLabel?: boolean;
  /**
   * @default {}
   */
  podDisruptionBudget?: PrometheusblackboxexporterHelmValuesPodDisruptionBudget;
  /**
   * Allow automount the serviceaccount token for sidecar container (eg: oauthproxy)
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown;
  extraInitContainers?: unknown[];
  extraContainers?: unknown[];
  /**
   * Number of replicasets to retain ##
   * default value is 10, 0 will not retain any replicasets and make rollbacks impossible ##
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @default {"rollingUpdate":{"maxSurge":1,"maxUnavailable":0},"type":"RollingUpdate"}
   */
  strategy?: PrometheusblackboxexporterHelmValuesStrategy;
  /**
   * Optionally specify an array of imagePullSecrets.
   * Secrets must be manually created in the namespace.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/
   *
   * @default {...} (5 keys)
   */
  image?: PrometheusblackboxexporterHelmValuesImage;
  /**
   * - myRegistrKeySecretName
   *
   * @default {}
   */
  podSecurityContext?: PrometheusblackboxexporterHelmValuesPodSecurityContext;
  /**
   * User and Group to run blackbox-exporter container as
   *
   * @default {...} (6 keys)
   */
  securityContext?: PrometheusblackboxexporterHelmValuesSecurityContext;
  /**
   * Add NET_RAW to enable ICMP
   *
   * @default {"httpGet":{"path":"/-/healthy","port":"http"},"failureThreshold":3}
   */
  livenessProbe?: PrometheusblackboxexporterHelmValuesLivenessProbe;
  /**
   * @default {"httpGet":{"path":"/-/healthy","port":"http"}}
   */
  readinessProbe?: PrometheusblackboxexporterHelmValuesReadinessProbe;
  /**
   * @default {}
   */
  nodeSelector?: PrometheusblackboxexporterHelmValuesNodeSelector;
  tolerations?: unknown[];
  /**
   * @default {}
   */
  affinity?: PrometheusblackboxexporterHelmValuesAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * if the configuration is managed as secret outside the chart, using SealedSecret for example,
   * provide the name of the secret here. If secretConfig is set to true, configExistingSecretName will be ignored
   * in favor of the config value.
   *
   * @default ""
   */
  configExistingSecretName?: string;
  /**
   * Store the configuration as a `Secret` instead of a `ConfigMap`, useful in case it contains sensitive data
   *
   * @default false
   */
  secretConfig?: boolean;
  /**
   * @default {"modules":{"http_2xx":{"prober":"http","timeout":"5s","http":{"valid_http_versions":["HTTP/1.1","HTTP/2.0"],"follow_redirects":true,"preferred_ip_protocol":"ip4"}}}}
   */
  config?: PrometheusblackboxexporterHelmValuesConfig;
  extraConfigmapMounts?: unknown[];
  extraSecretMounts?: unknown[];
  /**
   * @default {}
   */
  resources?: PrometheusblackboxexporterHelmValuesResources;
  /**
   * @default ""
   */
  priorityClassName?: string;
  /**
   * @default {...} (5 keys)
   */
  service?: PrometheusblackboxexporterHelmValuesService;
  /**
   * Only changes container port. Application port can be changed with extraArgs (--web.listen-address=:9115)
   * https://github.com/prometheus/blackbox_exporter/blob/998037b5b40c1de5fee348ffdea8820509d85171/main.go#L55
   *
   * @default 9115
   */
  containerPort?: number;
  /**
   * Number of port to expose on the host. If specified, this must be a valid port number, 0 < x < 65536. If zero, no port is exposed.
   * This is useful for communicating with Daemon Pods when kind is DaemonSet.
   *
   * @default 0
   */
  hostPort?: number;
  /**
   * @default {"create":true,"name":null,"annotations":{}}
   */
  serviceAccount?: PrometheusblackboxexporterHelmValuesServiceAccount;
  /**
   * An Ingress resource can provide name-based virtual hosting and TLS
   * termination among other things for CouchDB deployments which are accessed
   * from outside the Kubernetes cluster.
   * ref: https://kubernetes.io/docs/concepts/services-networking/ingress/
   *
   * @default {...} (6 keys)
   */
  ingress?: PrometheusblackboxexporterHelmValuesIngress;
  /**
   * - chart-example.local
   *
   * @default {}
   */
  podAnnotations?: PrometheusblackboxexporterHelmValuesPodAnnotations;
  /**
   * Annotations for the Deployment
   *
   * @default {}
   */
  deploymentAnnotations?: PrometheusblackboxexporterHelmValuesDeploymentAnnotations;
  /**
   * Annotations for the Secret
   *
   * @default {}
   */
  secretAnnotations?: PrometheusblackboxexporterHelmValuesSecretAnnotations;
  hostAliases?: unknown[];
  /**
   * @default {"labels":{}}
   */
  pod?: PrometheusblackboxexporterHelmValuesPod;
  extraArgs?: unknown[];
  /**
   * - --history.limit=1000
   *
   * @default 1
   */
  replicas?: number;
  /**
   * @default {...} (8 keys)
   */
  serviceMonitor?: PrometheusblackboxexporterHelmValuesServiceMonitor;
  /**
   * @default {...} (4 keys)
   */
  prometheusRule?: PrometheusblackboxexporterHelmValuesPrometheusRule;
  /**
   * @default {...} (7 keys)
   */
  podMonitoring?: PrometheusblackboxexporterHelmValuesPodMonitoring;
  /**
   * @default {"enabled":false,"allowMonitoringNamespace":false,"monitoringNamespaceName":"monitoring"}
   */
  networkPolicy?: PrometheusblackboxexporterHelmValuesNetworkPolicy;
  dnsPolicy?: unknown;
  dnsConfig?: unknown;
  extraManifests?: unknown[];
  /**
   * global common labels, applied to all ressources
   *
   * @default {}
   */
  commonLabels?: PrometheusblackboxexporterHelmValuesCommonLabels;
  /**
   * Enable vertical pod autoscaler support for prometheus-blackbox-exporter
   *
   * @default {...} (5 keys)
   */
  verticalPodAutoscaler?: PrometheusblackboxexporterHelmValuesVerticalPodAutoscaler;
  /**
   * @default {...} (10 keys)
   */
  configReloader?: PrometheusblackboxexporterHelmValuesConfigReloader;
};

export type PrometheusblackboxexporterHelmParameters = {
  "global.imageRegistry"?: string;
  restartPolicy?: string;
  kind?: string;
  namespaceOverride?: string;
  kubeVersionOverride?: string;
  releaseLabel?: string;
  automountServiceAccountToken?: string;
  extraEnv?: string;
  extraEnvFrom?: string;
  extraVolumes?: string;
  extraVolumeMounts?: string;
  extraInitContainers?: string;
  extraContainers?: string;
  revisionHistoryLimit?: string;
  hostNetwork?: string;
  "strategy.rollingUpdate.maxSurge"?: string;
  "strategy.rollingUpdate.maxUnavailable"?: string;
  "strategy.type"?: string;
  "image.registry"?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "image.pullPolicy"?: string;
  "image.digest"?: string;
  "securityContext.runAsUser"?: string;
  "securityContext.runAsGroup"?: string;
  "securityContext.readOnlyRootFilesystem"?: string;
  "securityContext.runAsNonRoot"?: string;
  "securityContext.allowPrivilegeEscalation"?: string;
  "securityContext.capabilities.drop"?: string;
  "livenessProbe.httpGet.path"?: string;
  "livenessProbe.httpGet.port"?: string;
  "livenessProbe.failureThreshold"?: string;
  "readinessProbe.httpGet.path"?: string;
  "readinessProbe.httpGet.port"?: string;
  tolerations?: string;
  topologySpreadConstraints?: string;
  configExistingSecretName?: string;
  secretConfig?: string;
  "config.modules.http_2xx.prober"?: string;
  "config.modules.http_2xx.timeout"?: string;
  "config.modules.http_2xx.http.valid_http_versions"?: string;
  "config.modules.http_2xx.http.follow_redirects"?: string;
  "config.modules.http_2xx.http.preferred_ip_protocol"?: string;
  extraConfigmapMounts?: string;
  extraSecretMounts?: string;
  priorityClassName?: string;
  "service.type"?: string;
  "service.port"?: string;
  "service.ipDualStack.enabled"?: string;
  "service.ipDualStack.ipFamilies"?: string;
  "service.ipDualStack.ipFamilyPolicy"?: string;
  containerPort?: string;
  hostPort?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "ingress.enabled"?: string;
  "ingress.className"?: string;
  "ingress.hosts.host"?: string;
  "ingress.hosts.paths.path"?: string;
  "ingress.hosts.paths.pathType"?: string;
  "ingress.tls"?: string;
  hostAliases?: string;
  extraArgs?: string;
  replicas?: string;
  "serviceMonitor.selfMonitor.enabled"?: string;
  "serviceMonitor.selfMonitor.additionalRelabeling"?: string;
  "serviceMonitor.selfMonitor.path"?: string;
  "serviceMonitor.selfMonitor.scheme"?: string;
  "serviceMonitor.selfMonitor.interval"?: string;
  "serviceMonitor.selfMonitor.scrapeTimeout"?: string;
  "serviceMonitor.enabled"?: string;
  "serviceMonitor.defaults.additionalRelabeling"?: string;
  "serviceMonitor.defaults.interval"?: string;
  "serviceMonitor.defaults.scrapeTimeout"?: string;
  "serviceMonitor.defaults.honorTimestamps"?: string;
  "serviceMonitor.defaults.module"?: string;
  "serviceMonitor.scheme"?: string;
  "serviceMonitor.path"?: string;
  "serviceMonitor.bearerTokenFile"?: string;
  "serviceMonitor.targets"?: string;
  "prometheusRule.enabled"?: string;
  "prometheusRule.namespace"?: string;
  "prometheusRule.rules"?: string;
  "podMonitoring.selfMonitor.enabled"?: string;
  "podMonitoring.selfMonitor.path"?: string;
  "podMonitoring.selfMonitor.interval"?: string;
  "podMonitoring.selfMonitor.scrapeTimeout"?: string;
  "podMonitoring.enabled"?: string;
  "podMonitoring.defaults.interval"?: string;
  "podMonitoring.defaults.scrapeTimeout"?: string;
  "podMonitoring.defaults.module"?: string;
  "podMonitoring.scheme"?: string;
  "podMonitoring.path"?: string;
  "podMonitoring.targets"?: string;
  "networkPolicy.enabled"?: string;
  "networkPolicy.allowMonitoringNamespace"?: string;
  "networkPolicy.monitoringNamespaceName"?: string;
  dnsPolicy?: string;
  dnsConfig?: string;
  extraManifests?: string;
  "verticalPodAutoscaler.enabled"?: string;
  "verticalPodAutoscaler.controlledResources"?: string;
  "verticalPodAutoscaler.updatePolicy.updateMode"?: string;
  "configReloader.enabled"?: string;
  "configReloader.containerPort"?: string;
  "configReloader.config.logFormat"?: string;
  "configReloader.config.logLevel"?: string;
  "configReloader.config.watchInterval"?: string;
  "configReloader.image.registry"?: string;
  "configReloader.image.repository"?: string;
  "configReloader.image.tag"?: string;
  "configReloader.image.pullPolicy"?: string;
  "configReloader.image.digest"?: string;
  "configReloader.securityContext.runAsUser"?: string;
  "configReloader.securityContext.runAsGroup"?: string;
  "configReloader.securityContext.readOnlyRootFilesystem"?: string;
  "configReloader.securityContext.runAsNonRoot"?: string;
  "configReloader.securityContext.allowPrivilegeEscalation"?: string;
  "configReloader.securityContext.capabilities.drop"?: string;
  "configReloader.resources.limits.memory"?: string;
  "configReloader.resources.requests.cpu"?: string;
  "configReloader.resources.requests.memory"?: string;
  "configReloader.livenessProbe.httpGet.path"?: string;
  "configReloader.livenessProbe.httpGet.port"?: string;
  "configReloader.livenessProbe.httpGet.scheme"?: string;
  "configReloader.readinessProbe.httpGet.path"?: string;
  "configReloader.readinessProbe.httpGet.port"?: string;
  "configReloader.readinessProbe.httpGet.scheme"?: string;
  "configReloader.service.port"?: string;
  "configReloader.serviceMonitor.selfMonitor.additionalRelabeling"?: string;
  "configReloader.serviceMonitor.selfMonitor.path"?: string;
  "configReloader.serviceMonitor.selfMonitor.scheme"?: string;
  "configReloader.serviceMonitor.selfMonitor.interval"?: string;
  "configReloader.serviceMonitor.selfMonitor.scrapeTimeout"?: string;
};
