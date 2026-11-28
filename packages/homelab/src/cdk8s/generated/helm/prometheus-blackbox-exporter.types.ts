// Generated TypeScript types for prometheus-blackbox-exporter Helm chart

export type PrometheusblackboxexporterHelmValuesCommonLabels = object;

export type PrometheusblackboxexporterHelmValuesConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"http_2xx":{"http":{"follow_redirects":true,"preferred_ip_protocol":"ip4","valid_http_versions":["HTTP/1.1","HTTP/2.0"]},"prober":"http","timeout":"5s"}}
   */
  modules?: PrometheusblackboxexporterHelmValuesConfigModules;
};

export type PrometheusblackboxexporterHelmValuesConfigModules = {
  /**
   * @default {"http":{"follow_redirects":true,"preferred_ip_protocol":"ip4","valid_http_versions":["HTTP/1.1","HTTP/2.0"]},"prober":"http","timeout":"5s"}
   */
  http_2xx?: PrometheusblackboxexporterHelmValuesConfigModulesHttp2xx;
};

export type PrometheusblackboxexporterHelmValuesConfigModulesHttp2xx = {
  /**
   * @default {"follow_redirects":true,"preferred_ip_protocol":"ip4","valid_http_versions":["HTTP/1.1","HTTP/2.0"]}
   */
  http?: PrometheusblackboxexporterHelmValuesConfigModulesHttp2xxHttp;
  /**
   * @default "http"
   */
  prober?: string;
  /**
   * @default "5s"
   */
  timeout?: string;
};

export type PrometheusblackboxexporterHelmValuesConfigModulesHttp2xxHttp = {
  /**
   * @default true
   */
  follow_redirects?: boolean;
  /**
   * @default "ip4"
   */
  preferred_ip_protocol?: string;
  valid_http_versions?: string[];
};

export type PrometheusblackboxexporterHelmValuesConfigAutoReload = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Interval in seconds (an integer, not a duration) between checks of the configuration file
   *
   * @default 30
   */
  interval?: number;
};

export type PrometheusblackboxexporterHelmValuesConfigReloader = {
  /**
   * @default {"logFormat":"logfmt","logLevel":"info","watchInterval":"1m"}
   */
  config?: PrometheusblackboxexporterHelmValuesConfigReloaderConfig;
  /**
   * @default 8080
   */
  containerPort?: number;
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {...} (5 keys)
   */
  image?: PrometheusblackboxexporterHelmValuesConfigReloaderImage;
  /**
   * @default {"httpGet":{"path":"/healthz","port":"reloader-web","scheme":"HTTP"}}
   */
  livenessProbe?: PrometheusblackboxexporterHelmValuesConfigReloaderLivenessProbe;
  /**
   * @default {"httpGet":{"path":"/healthz","port":"reloader-web","scheme":"HTTP"}}
   */
  readinessProbe?: PrometheusblackboxexporterHelmValuesConfigReloaderReadinessProbe;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * @default {...} (6 keys)
   */
  securityContext?: PrometheusblackboxexporterHelmValuesConfigReloaderSecurityContext;
  /**
   * @default {"port":8080}
   */
  service?: PrometheusblackboxexporterHelmValuesConfigReloaderService;
  /**
   * @default {"selfMonitor":{"additionalMetricsRelabels":{},"additionalRelabeling":[],"interval":"30s","path":"/metrics","scheme":"http","scrapeTimeout":"30s","tlsConfig":{}}}
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
   * @default ""
   */
  digest?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "prometheus-operator/prometheus-config-reloader"
   */
  repository?: string;
  /**
   * @default "v0.95.2"
   */
  tag?: string;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderLivenessProbe = {
  /**
   * @default {"path":"/healthz","port":"reloader-web","scheme":"HTTP"}
   */
  httpGet?: PrometheusblackboxexporterHelmValuesConfigReloaderLivenessProbeHttpGet;
};

export type PrometheusblackboxexporterHelmValuesConfigReloaderLivenessProbeHttpGet =
  {
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

export type PrometheusblackboxexporterHelmValuesConfigReloaderReadinessProbeHttpGet =
  {
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

export type PrometheusblackboxexporterHelmValuesConfigReloaderSecurityContext =
  {
    /**
     * @default false
     */
    allowPrivilegeEscalation?: boolean;
    /**
     * @default {"drop":["ALL"]}
     */
    capabilities?: PrometheusblackboxexporterHelmValuesConfigReloaderSecurityContextCapabilities;
    /**
     * @default true
     */
    readOnlyRootFilesystem?: boolean;
    /**
     * @default 1000
     */
    runAsGroup?: number;
    /**
     * @default true
     */
    runAsNonRoot?: boolean;
    /**
     * @default 1000
     */
    runAsUser?: number;
  };

export type PrometheusblackboxexporterHelmValuesConfigReloaderSecurityContextCapabilities =
  {
    drop?: string[];
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

export type PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitor =
  {
    /**
     * @default {}
     */
    additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitorAdditionalMetricsRelabels;
    additionalRelabeling?: unknown[];
    /**
     * @default "30s"
     */
    interval?: string;
    /**
     * @default "/metrics"
     */
    path?: string;
    /**
     * Name of the Service port to scrape. Defaults to "reloader-web".
     *
     * @default "http"
     */
    scheme?: string;
    /**
     * @default "30s"
     */
    scrapeTimeout?: string;
    /**
     * @default {}
     */
    tlsConfig?: PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitorTlsConfig;
  };

export type PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitorAdditionalMetricsRelabels =
  object;

export type PrometheusblackboxexporterHelmValuesConfigReloaderServiceMonitorSelfMonitorTlsConfig =
  object;

export type PrometheusblackboxexporterHelmValuesDeploymentAnnotations = object;

export type PrometheusblackboxexporterHelmValuesGlobal = {
  /**
   * Global image registry to use if it needs to be overridden for some specific use cases (e.g local registries, custom images, ...)
   *
   * @default ""
   */
  imageRegistry?: string;
};

export type PrometheusblackboxexporterHelmValuesImage = {
  /**
   * @default ""
   */
  digest?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "prometheus/blackbox-exporter"
   */
  repository?: string;
  /**
   * Overrides the image tag whose default is {{ .Chart.AppVersion }}
   *
   * @default ""
   */
  tag?: string;
};

export type PrometheusblackboxexporterHelmValuesIngress = {
  /**
   * kubernetes.io/tls-acme: "true"
   *
   * @default {}
   */
  annotations?: PrometheusblackboxexporterHelmValuesIngressAnnotations;
  /**
   * @default ""
   */
  className?: string;
  /**
   * @default false
   */
  enabled?: boolean;
  hosts?: PrometheusblackboxexporterHelmValuesIngressHostsElement[];
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesIngressLabels;
  tls?: unknown[];
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

export type PrometheusblackboxexporterHelmValuesIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesLifecycle = object;

export type PrometheusblackboxexporterHelmValuesLivenessProbe = {
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default {"path":"/-/healthy","port":"http"}
   */
  httpGet?: PrometheusblackboxexporterHelmValuesLivenessProbeHttpGet;
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

export type PrometheusblackboxexporterHelmValuesNetworkPolicy = {
  /**
   * Limit access only from monitoring namespace
   * Before setting this value to true, the monitoring namespace must exist. Kubernetes automatically sets the kubernetes.io/metadata.name label on all namespaces. The namespace name can be configured via monitoringNamespaceName
   * Network Policy uses label filtering
   *
   * @default false
   */
  allowMonitoringNamespace?: boolean;
  /**
   * Enable network policy and allow access from anywhere
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Rewrite monitoring namespace in network policy (default value monitoring)
   *
   * @default "monitoring"
   */
  monitoringNamespaceName?: string;
};

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

export type PrometheusblackboxexporterHelmValuesPodAnnotations = object;

export type PrometheusblackboxexporterHelmValuesPodDisruptionBudget = object;

export type PrometheusblackboxexporterHelmValuesPodMonitoring = {
  /**
   * Default values that will be used for all PodMonitoring created by `targets`
   * Following PodMonitoring API specs https://github.com/GoogleCloudPlatform/prometheus-engine/blob/main/doc/api.md#scrapeendpoint
   *
   * @default {...} (5 keys)
   */
  defaults?: PrometheusblackboxexporterHelmValuesPodMonitoringDefaults;
  /**
   * If true, a PodMonitoring CR is created for a google managed prometheus
   * https://cloud.google.com/stackdriver/docs/managed-prometheus/setup-managed#gmp-pod-monitoring for each target
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "/probe"
   */
  path?: string;
  /**
   * @default "http"
   */
  scheme?: string;
  /**
   * If true, a PodMonitoring CR is created for google managed prometheus
   * https://cloud.google.com/stackdriver/docs/managed-prometheus/setup-managed#gmp-pod-monitoring for blackbox-exporter itself
   *
   * @default {...} (6 keys)
   */
  selfMonitor?: PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitor;
  targets?: unknown;
  /**
   * Of type: https://github.com/GoogleCloudPlatform/prometheus-engine/blob/main/doc/api.md#tls
   *
   * @default {}
   */
  tlsConfig?: PrometheusblackboxexporterHelmValuesPodMonitoringTlsConfig;
};

export type PrometheusblackboxexporterHelmValuesPodMonitoringDefaults = {
  /**
   * @default {}
   */
  additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesPodMonitoringDefaultsAdditionalMetricsRelabels;
  /**
   * @default "30s"
   */
  interval?: string;
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesPodMonitoringDefaultsLabels;
  /**
   * @default "http_2xx"
   */
  module?: string;
  /**
   * @default "30s"
   */
  scrapeTimeout?: string;
};

export type PrometheusblackboxexporterHelmValuesPodMonitoringDefaultsAdditionalMetricsRelabels =
  object;

export type PrometheusblackboxexporterHelmValuesPodMonitoringDefaultsLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitor = {
  /**
   * @default {}
   */
  additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitorAdditionalMetricsRelabels;
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "30s"
   */
  interval?: string;
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
  scrapeTimeout?: string;
};

export type PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitorAdditionalMetricsRelabels =
  object;

export type PrometheusblackboxexporterHelmValuesPodMonitoringSelfMonitorLabels =
  {
    /**
     * This type allows arbitrary additional properties beyond those defined below.
     * This is common for config maps, custom settings, and extensible configurations.
     */
    [key: string]: unknown;
  };

export type PrometheusblackboxexporterHelmValuesPodMonitoringTlsConfig = object;

export type PrometheusblackboxexporterHelmValuesPodSecurityContext = object;

export type PrometheusblackboxexporterHelmValuesProbe = {
  /**
   * Probe CRD API version
   *
   * @default "monitoring.coreos.com/v1"
   */
  apiVersion?: string;
  /**
   * Default values that will be used for all Probes created by `targets`
   *
   * @default {...} (6 keys)
   */
  defaults?: PrometheusblackboxexporterHelmValuesProbeDefaults;
  /**
   * If true, a Probe is created for a prometheus operator for each target
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "/probe"
   */
  path?: string;
  /**
   * @default "http"
   */
  scheme?: string;
  targets?: unknown;
  /**
   * Of type: https://prometheus-operator.dev/docs/api-reference/api/#monitoring.coreos.com/v1.SafeTLSConfig
   *
   * @default {}
   */
  tlsConfig?: PrometheusblackboxexporterHelmValuesProbeTlsConfig;
};

export type PrometheusblackboxexporterHelmValuesProbeDefaults = {
  /**
   * @default {}
   */
  additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesProbeDefaultsAdditionalMetricsRelabels;
  additionalRelabeling?: unknown[];
  /**
   * @default "30s"
   */
  interval?: string;
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesProbeDefaultsLabels;
  /**
   * @default "http_2xx"
   */
  module?: string;
  /**
   * @default "30s"
   */
  scrapeTimeout?: string;
};

export type PrometheusblackboxexporterHelmValuesProbeDefaultsAdditionalMetricsRelabels =
  object;

export type PrometheusblackboxexporterHelmValuesProbeDefaultsLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesProbeTlsConfig = object;

export type PrometheusblackboxexporterHelmValuesPrometheusRule = {
  /**
   * @default {}
   */
  additionalLabels?: PrometheusblackboxexporterHelmValuesPrometheusRuleAdditionalLabels;
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  namespace?: string;
  rules?: unknown[];
};

export type PrometheusblackboxexporterHelmValuesPrometheusRuleAdditionalLabels =
  object;

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

export type PrometheusblackboxexporterHelmValuesRoute = {
  /**
   * @default {...} (12 keys)
   */
  main?: PrometheusblackboxexporterHelmValuesRouteMain;
};

export type PrometheusblackboxexporterHelmValuesRouteMain = {
  additionalRules?: unknown[];
  /**
   * Annotations to attach to the HTTPRoute resource
   *
   * @default {}
   */
  annotations?: PrometheusblackboxexporterHelmValuesRouteMainAnnotations;
  /**
   * ApiVersion set by default to "gateway.networking.k8s.io/v1"
   *
   * @default ""
   */
  apiVersion?: string;
  /**
   * Enable this route
   *
   * @default false
   */
  enabled?: boolean;
  filters?: unknown[];
  hostnames?: unknown[];
  /**
   * httpsRedirect adds a filter for redirecting to https (HTTP 301 Moved Permanently).
   * To redirect HTTP traffic to HTTPS, you need to have a Gateway with both HTTP and HTTPS listeners.
   * Matches and filters do not take effect if enabled.
   * Ref. https://gateway-api.sigs.k8s.io/guides/http-redirect-rewrite/
   *
   * @default false
   */
  httpsRedirect?: boolean;
  /**
   * kind set by default to HTTPRoute
   *
   * @default ""
   */
  kind?: string;
  /**
   * Labels to attach to the HTTPRoute resource
   *
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesRouteMainLabels;
  matches?: PrometheusblackboxexporterHelmValuesRouteMainMatchesElement[];
  /**
   * Optional name for the default rule in the rendered HTTPRoute.
   *
   * @default ""
   */
  name?: string;
  parentRefs?: unknown[];
};

export type PrometheusblackboxexporterHelmValuesRouteMainAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesRouteMainLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesRouteMainMatchesElement = {
  /**
   * @default {"type":"PathPrefix","value":"/"}
   */
  path?: PrometheusblackboxexporterHelmValuesRouteMainMatchesPath;
};

export type PrometheusblackboxexporterHelmValuesRouteMainMatchesPath = {
  /**
   * @default "PathPrefix"
   */
  type?: string;
  /**
   * @default "/"
   */
  value?: string;
};

export type PrometheusblackboxexporterHelmValuesSecretAnnotations = object;

export type PrometheusblackboxexporterHelmValuesSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: PrometheusblackboxexporterHelmValuesSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default 1000
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 1000
   */
  runAsUser?: number;
};

export type PrometheusblackboxexporterHelmValuesSecurityContextCapabilities = {
  drop?: string[];
};

export type PrometheusblackboxexporterHelmValuesService = {
  /**
   * @default {}
   */
  annotations?: PrometheusblackboxexporterHelmValuesServiceAnnotations;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: PrometheusblackboxexporterHelmValuesServiceIpDualStack;
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesServiceLabels;
  /**
   * @default 9115
   */
  port?: number;
  /**
   * @default "ClusterIP"
   */
  type?: string;
};

export type PrometheusblackboxexporterHelmValuesServiceAnnotations = {
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

export type PrometheusblackboxexporterHelmValuesServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesServiceAccount = {
  /**
   * @default {}
   */
  annotations?: PrometheusblackboxexporterHelmValuesServiceAccountAnnotations;
  /**
   * Specifies whether a ServiceAccount should be created
   *
   * @default true
   */
  create?: boolean;
  name?: unknown;
};

export type PrometheusblackboxexporterHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitor = {
  /**
   * ServiceMonitor CRD API version
   *
   * @default "monitoring.coreos.com/v1"
   */
  apiVersion?: string;
  bearerTokenFile?: unknown;
  /**
   * Default values that will be used for all ServiceMonitors created by `targets`
   *
   * @default {...} (7 keys)
   */
  defaults?: PrometheusblackboxexporterHelmValuesServiceMonitorDefaults;
  /**
   * If true, a ServiceMonitor CRD is created for a prometheus operator
   * https://github.com/coreos/prometheus-operator for each target
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "/probe"
   */
  path?: string;
  /**
   * Set to https when webConfiguration enables TLS.
   *
   * @default "http"
   */
  scheme?: string;
  /**
   * If true, a ServiceMonitor CRD is created for a prometheus operator
   * https://github.com/coreos/prometheus-operator for blackbox-exporter itself
   *
   * @default {...} (9 keys)
   */
  selfMonitor?: PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitor;
  targets?: unknown;
  /**
   * Of type: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#monitoring.coreos.com/v1.TLSConfig
   *
   * @default {}
   */
  tlsConfig?: PrometheusblackboxexporterHelmValuesServiceMonitorTlsConfig;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitorDefaults = {
  /**
   * @default {}
   */
  additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesServiceMonitorDefaultsAdditionalMetricsRelabels;
  additionalRelabeling?: unknown[];
  /**
   * @default true
   */
  honorTimestamps?: boolean;
  /**
   * @default "30s"
   */
  interval?: string;
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesServiceMonitorDefaultsLabels;
  /**
   * @default "http_2xx"
   */
  module?: string;
  /**
   * @default "30s"
   */
  scrapeTimeout?: string;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitorDefaultsAdditionalMetricsRelabels =
  object;

export type PrometheusblackboxexporterHelmValuesServiceMonitorDefaultsLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitor = {
  /**
   * @default {}
   */
  additionalMetricsRelabels?: PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorAdditionalMetricsRelabels;
  additionalRelabeling?: unknown[];
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "30s"
   */
  interval?: string;
  /**
   * @default {}
   */
  labels?: PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorLabels;
  /**
   * @default "/metrics"
   */
  path?: string;
  /**
   * Name of the Service port to scrape. Defaults to "http".
   * Set to https (with tlsConfig) when webConfiguration enables TLS.
   *
   * @default "http"
   */
  scheme?: string;
  /**
   * @default "30s"
   */
  scrapeTimeout?: string;
  /**
   * @default {}
   */
  tlsConfig?: PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorTlsConfig;
};

export type PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorAdditionalMetricsRelabels =
  object;

export type PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorLabels =
  {
    /**
     * This type allows arbitrary additional properties beyond those defined below.
     * This is common for config maps, custom settings, and extensible configurations.
     */
    [key: string]: unknown;
  };

export type PrometheusblackboxexporterHelmValuesServiceMonitorSelfMonitorTlsConfig =
  object;

export type PrometheusblackboxexporterHelmValuesServiceMonitorTlsConfig =
  object;

export type PrometheusblackboxexporterHelmValuesStartupProbe = object;

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

export type PrometheusblackboxexporterHelmValuesVerticalPodAutoscaler = {
  controlledResources?: unknown[];
  /**
   * Specifies which resource values should be controlled: RequestsOnly or RequestsAndLimits.
   *
   * @default false
   */
  enabled?: boolean;
  /**
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
   * Recommender responsible for generating recommendation for the object.
   * List should be empty (then the default recommender will generate the recommendation)
   * or contain exactly one recommender.
   *
   * @default {"updateMode":"Auto"}
   */
  updatePolicy?: PrometheusblackboxexporterHelmValuesVerticalPodAutoscalerUpdatePolicy;
};

export type PrometheusblackboxexporterHelmValuesVerticalPodAutoscalerMaxAllowed =
  object;

export type PrometheusblackboxexporterHelmValuesVerticalPodAutoscalerMinAllowed =
  object;

export type PrometheusblackboxexporterHelmValuesVerticalPodAutoscalerUpdatePolicy =
  {
    /**
     * Specifies minimal number of replicas which need to be alive for VPA Updater to attempt pod eviction
     * Specifies whether recommended updates are applied when a Pod is started and whether recommended updates
     * are applied during the life of a Pod. Possible values are "Off", "Initial", "Recreate", and "Auto".
     *
     * @default "Auto"
     */
    updateMode?: string;
  };

export type PrometheusblackboxexporterHelmValuesWebConfiguration = {
  /**
   * Inline web configuration, rendered into a Secret named <fullname>-web-config.
   * When it contains tls_server_config, the liveness/readiness probes switch to HTTPS and the
   * config reloader calls https://127.0.0.1:<containerPort>/-/reload.
   * When it contains basic_auth_users, or a client_auth_type that requires a client certificate,
   * httpGet probes are replaced by tcpSocket probes on the same port, because credentials are
   * never put into the pod spec. configReloader cannot authenticate and is rejected in that case;
   * set configAutoReload.enabled instead.
   * Mount the certificate and key with extraSecretMounts (for example a kubernetes.io/tls Secret).
   *
   * @default {}
   */
  config?: PrometheusblackboxexporterHelmValuesWebConfigurationConfig;
  /**
   * @default {"name":""}
   */
  existingSecret?: PrometheusblackboxexporterHelmValuesWebConfigurationExistingSecret;
};

export type PrometheusblackboxexporterHelmValuesWebConfigurationConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusblackboxexporterHelmValuesWebConfigurationExistingSecret =
  {
    /**
     * @default ""
     */
    name?: string;
  };

export type PrometheusblackboxexporterHelmValues = {
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * Allow automount the serviceaccount token for sidecar container (eg: oauthproxy)
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  /**
   * global common labels, applied to all resources
   *
   * @default {}
   */
  commonLabels?: PrometheusblackboxexporterHelmValuesCommonLabels;
  /**
   * NOTE: Binary payloads (!!binary) in module config are corrupted by Helm's toYaml.
   * The contents of `config:` are passed through `toYaml` in the ConfigMap template,
   * which round-trips the values through Helm's YAML parser and silently corrupts any
   * byte >= 0x80. Use configExistingSecretName instead (see README.md).
   *
   * @default {"modules":{"http_2xx":{"http":{"follow_redirects":true,"preferred_ip_protocol":"ip4","valid_http_versions":["HTTP/1.1","HTTP/2.0"]},"prober":"http","timeout":"5s"}}}
   */
  config?: PrometheusblackboxexporterHelmValuesConfig;
  /**
   * Let the exporter reload its configuration file by itself, without restarting the pod
   * (--config.enable-auto-reload). Requires blackbox_exporter v0.28.0 or later.
   * When enabled, the checksum/config pod annotation is no longer set, so changing `config`
   * does not roll the pods; the exporter picks up the new file once the kubelet has refreshed the
   * mounted ConfigMap/Secret (up to about a minute by default) and the next interval has passed.
   * Mutually exclusive with configReloader.enabled. Do not pass the same flags through extraArgs.
   *
   * @default {"enabled":false,"interval":30}
   */
  configAutoReload?: PrometheusblackboxexporterHelmValuesConfigAutoReload;
  /**
   * if the configuration is managed as secret outside the chart, using SealedSecret for example,
   * provide the name of the secret here. If secretConfig is set to true, configExistingSecretName will be ignored
   * in favor of the config value.
   *
   * @default ""
   */
  configExistingSecretName?: string;
  /**
   * @default {...} (10 keys)
   */
  configReloader?: PrometheusblackboxexporterHelmValuesConfigReloader;
  /**
   * Only changes container port. Application port can be changed with extraArgs (--web.listen-address=:9115)
   * https://github.com/prometheus/blackbox_exporter/blob/998037b5b40c1de5fee348ffdea8820509d85171/main.go#L55
   *
   * @default 9115
   */
  containerPort?: number;
  /**
   * Annotations for the Deployment
   *
   * @default {}
   */
  deploymentAnnotations?: PrometheusblackboxexporterHelmValuesDeploymentAnnotations;
  dnsConfig?: unknown;
  dnsPolicy?: unknown;
  extraArgs?: unknown[];
  extraConfigmapMounts?: unknown[];
  extraContainers?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraInitContainers?: unknown[];
  extraManifests?: unknown[];
  extraSecretMounts?: unknown[];
  extraVolumeMounts?: unknown;
  extraVolumes?: unknown[];
  /**
   * @default {"imageRegistry":""}
   */
  global?: PrometheusblackboxexporterHelmValuesGlobal;
  hostAliases?: unknown[];
  /**
   * - test.example.com
   * - another.example.net
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * Number of port to expose on the host. If specified, this must be a valid port number, 0 < x < 65536. If zero, no port is exposed.
   * This is useful for communicating with Daemon Pods when kind is DaemonSet.
   *
   * @default 0
   */
  hostPort?: number;
  /**
   * @default {...} (5 keys)
   */
  image?: PrometheusblackboxexporterHelmValuesImage;
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
   * kind set by default to HTTPRoute
   *
   * @default "Deployment"
   */
  kind?: string;
  /**
   * Override Kubernetes version if your distribution does not follow semver v2
   *
   * @default ""
   */
  kubeVersionOverride?: string;
  /**
   * Lifecycle hooks for the blackbox-exporter container, not set by default
   * ref: https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/
   *
   * @default {}
   */
  lifecycle?: PrometheusblackboxexporterHelmValuesLifecycle;
  /**
   * @default {"failureThreshold":3,"httpGet":{"path":"/-/healthy","port":"http"}}
   */
  livenessProbe?: PrometheusblackboxexporterHelmValuesLivenessProbe;
  /**
   * Override the namespace
   *
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * Network policy for chart
   *
   * @default {"allowMonitoringNamespace":false,"enabled":false,"monitoringNamespaceName":"monitoring"}
   */
  networkPolicy?: PrometheusblackboxexporterHelmValuesNetworkPolicy;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * @default {"labels":{}}
   */
  pod?: PrometheusblackboxexporterHelmValuesPod;
  /**
   * @default {}
   */
  podAnnotations?: PrometheusblackboxexporterHelmValuesPodAnnotations;
  /**
   * @default {}
   */
  podDisruptionBudget?: PrometheusblackboxexporterHelmValuesPodDisruptionBudget;
  /**
   * @default {...} (7 keys)
   */
  podMonitoring?: PrometheusblackboxexporterHelmValuesPodMonitoring;
  /**
   * @default {}
   */
  podSecurityContext?: PrometheusblackboxexporterHelmValuesPodSecurityContext;
  /**
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Prometheus Operator Probe resources, an alternative to `serviceMonitor.targets`.
   * One Probe is created per target. Its prober is this chart's Service (port `service.port`).
   * ref: https://prometheus-operator.dev/docs/api-reference/api/#monitoring.coreos.com/v1.Probe
   *
   * @default {...} (7 keys)
   */
  probe?: PrometheusblackboxexporterHelmValuesProbe;
  /**
   * Custom PrometheusRules to be defined
   * ref: https://github.com/coreos/prometheus-operator#customresourcedefinitions
   *
   * @default {...} (4 keys)
   */
  prometheusRule?: PrometheusblackboxexporterHelmValuesPrometheusRule;
  /**
   * @default {"httpGet":{"path":"/-/healthy","port":"http"}}
   */
  readinessProbe?: PrometheusblackboxexporterHelmValuesReadinessProbe;
  /**
   * set to true to add the release label so scraping of the servicemonitor with kube-prometheus-stack works out of the box
   *
   * @default false
   */
  releaseLabel?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * @default "Always"
   */
  restartPolicy?: string;
  /**
   * Number of replicasets to retain ##
   * default value is 10, 0 will not retain any replicasets and make rollbacks impossible ##
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * A HTTPRoute (Gateway API) resource is an alternative to Ingress for routing
   * external HTTP traffic to the blackbox exporter Service.
   * ref: https://gateway-api.sigs.k8s.io/reference/api-types/httproute/
   *
   * @default {"main":{"additionalRules":[],"annotations":{},"apiVersion":"","enabled":false,"filters":[],"hostnames":[],"httpsRedirect":false,"kind":"","labels":{},"matches":[{"path":{"type":"PathPrefix","value":"/"}}],"name":"","parentRefs":[]}}
   */
  route?: PrometheusblackboxexporterHelmValuesRoute;
  /**
   * Annotations for the Secret
   *
   * @default {}
   */
  secretAnnotations?: PrometheusblackboxexporterHelmValuesSecretAnnotations;
  /**
   * Store the configuration as a `Secret` instead of a `ConfigMap`, useful in case it contains sensitive data
   *
   * @default false
   */
  secretConfig?: boolean;
  /**
   * User and Group to run blackbox-exporter container as
   *
   * @default {...} (6 keys)
   */
  securityContext?: PrometheusblackboxexporterHelmValuesSecurityContext;
  /**
   * @default {...} (5 keys)
   */
  service?: PrometheusblackboxexporterHelmValuesService;
  /**
   * @default {"annotations":{},"create":true,"name":null}
   */
  serviceAccount?: PrometheusblackboxexporterHelmValuesServiceAccount;
  /**
   * @default {...} (9 keys)
   */
  serviceMonitor?: PrometheusblackboxexporterHelmValuesServiceMonitor;
  /**
   * Startup probe for the blackbox-exporter container, not set by default
   * ref: https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/
   *
   * @default {}
   */
  startupProbe?: PrometheusblackboxexporterHelmValuesStartupProbe;
  /**
   * @default {"rollingUpdate":{"maxSurge":1,"maxUnavailable":0},"type":"RollingUpdate"}
   */
  strategy?: PrometheusblackboxexporterHelmValuesStrategy;
  /**
   * Pod termination grace period in seconds. Set to null to leave it out of the pod spec.
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * Enable vertical pod autoscaler support for prometheus-blackbox-exporter
   *
   * @default {...} (5 keys)
   */
  verticalPodAutoscaler?: PrometheusblackboxexporterHelmValuesVerticalPodAutoscaler;
  /**
   * Web configuration (TLS and basic authentication) for the exporter's HTTP endpoints, passed
   * with --web.config.file. Format: https://prometheus.io/docs/prometheus/latest/configuration/https/
   * Disabled while both `config` and `existingSecret.name` are empty.
   *
   * @default {"config":{},"existingSecret":{"name":""}}
   */
  webConfiguration?: PrometheusblackboxexporterHelmValuesWebConfiguration;
};

export type PrometheusblackboxexporterHelmParameters = {
  affinity?: string;
  automountServiceAccountToken?: string;
  "config.modules.http_2xx.http.follow_redirects"?: string;
  "config.modules.http_2xx.http.preferred_ip_protocol"?: string;
  "config.modules.http_2xx.http.valid_http_versions"?: string;
  "config.modules.http_2xx.prober"?: string;
  "config.modules.http_2xx.timeout"?: string;
  "configAutoReload.enabled"?: string;
  "configAutoReload.interval"?: string;
  configExistingSecretName?: string;
  "configReloader.config.logFormat"?: string;
  "configReloader.config.logLevel"?: string;
  "configReloader.config.watchInterval"?: string;
  "configReloader.containerPort"?: string;
  "configReloader.enabled"?: string;
  "configReloader.image.digest"?: string;
  "configReloader.image.pullPolicy"?: string;
  "configReloader.image.registry"?: string;
  "configReloader.image.repository"?: string;
  "configReloader.image.tag"?: string;
  "configReloader.livenessProbe.httpGet.path"?: string;
  "configReloader.livenessProbe.httpGet.port"?: string;
  "configReloader.livenessProbe.httpGet.scheme"?: string;
  "configReloader.readinessProbe.httpGet.path"?: string;
  "configReloader.readinessProbe.httpGet.port"?: string;
  "configReloader.readinessProbe.httpGet.scheme"?: string;
  "configReloader.resources"?: string;
  "configReloader.securityContext.allowPrivilegeEscalation"?: string;
  "configReloader.securityContext.capabilities.drop"?: string;
  "configReloader.securityContext.readOnlyRootFilesystem"?: string;
  "configReloader.securityContext.runAsGroup"?: string;
  "configReloader.securityContext.runAsNonRoot"?: string;
  "configReloader.securityContext.runAsUser"?: string;
  "configReloader.service.port"?: string;
  "configReloader.serviceMonitor.selfMonitor.additionalRelabeling"?: string;
  "configReloader.serviceMonitor.selfMonitor.interval"?: string;
  "configReloader.serviceMonitor.selfMonitor.path"?: string;
  "configReloader.serviceMonitor.selfMonitor.scheme"?: string;
  "configReloader.serviceMonitor.selfMonitor.scrapeTimeout"?: string;
  containerPort?: string;
  dnsConfig?: string;
  dnsPolicy?: string;
  extraArgs?: string;
  extraConfigmapMounts?: string;
  extraContainers?: string;
  extraEnv?: string;
  extraEnvFrom?: string;
  extraInitContainers?: string;
  extraManifests?: string;
  extraSecretMounts?: string;
  extraVolumeMounts?: string;
  extraVolumes?: string;
  "global.imageRegistry"?: string;
  hostAliases?: string;
  hostNetwork?: string;
  hostPort?: string;
  "image.digest"?: string;
  "image.pullPolicy"?: string;
  "image.registry"?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "ingress.className"?: string;
  "ingress.enabled"?: string;
  "ingress.hosts.host"?: string;
  "ingress.hosts.paths.path"?: string;
  "ingress.hosts.paths.pathType"?: string;
  "ingress.tls"?: string;
  kind?: string;
  kubeVersionOverride?: string;
  "livenessProbe.failureThreshold"?: string;
  "livenessProbe.httpGet.path"?: string;
  "livenessProbe.httpGet.port"?: string;
  namespaceOverride?: string;
  "networkPolicy.allowMonitoringNamespace"?: string;
  "networkPolicy.enabled"?: string;
  "networkPolicy.monitoringNamespaceName"?: string;
  nodeSelector?: string;
  "podMonitoring.defaults.interval"?: string;
  "podMonitoring.defaults.module"?: string;
  "podMonitoring.defaults.scrapeTimeout"?: string;
  "podMonitoring.enabled"?: string;
  "podMonitoring.path"?: string;
  "podMonitoring.scheme"?: string;
  "podMonitoring.selfMonitor.enabled"?: string;
  "podMonitoring.selfMonitor.interval"?: string;
  "podMonitoring.selfMonitor.path"?: string;
  "podMonitoring.selfMonitor.scrapeTimeout"?: string;
  "podMonitoring.targets"?: string;
  priorityClassName?: string;
  "probe.apiVersion"?: string;
  "probe.defaults.additionalRelabeling"?: string;
  "probe.defaults.interval"?: string;
  "probe.defaults.module"?: string;
  "probe.defaults.scrapeTimeout"?: string;
  "probe.enabled"?: string;
  "probe.path"?: string;
  "probe.scheme"?: string;
  "probe.targets"?: string;
  "prometheusRule.enabled"?: string;
  "prometheusRule.namespace"?: string;
  "prometheusRule.rules"?: string;
  "readinessProbe.httpGet.path"?: string;
  "readinessProbe.httpGet.port"?: string;
  releaseLabel?: string;
  replicas?: string;
  resources?: string;
  restartPolicy?: string;
  revisionHistoryLimit?: string;
  "route.main.additionalRules"?: string;
  "route.main.apiVersion"?: string;
  "route.main.enabled"?: string;
  "route.main.filters"?: string;
  "route.main.hostnames"?: string;
  "route.main.httpsRedirect"?: string;
  "route.main.kind"?: string;
  "route.main.matches.path.type"?: string;
  "route.main.matches.path.value"?: string;
  "route.main.name"?: string;
  "route.main.parentRefs"?: string;
  secretConfig?: string;
  "securityContext.allowPrivilegeEscalation"?: string;
  "securityContext.capabilities.drop"?: string;
  "securityContext.readOnlyRootFilesystem"?: string;
  "securityContext.runAsGroup"?: string;
  "securityContext.runAsNonRoot"?: string;
  "securityContext.runAsUser"?: string;
  "service.ipDualStack.enabled"?: string;
  "service.ipDualStack.ipFamilies"?: string;
  "service.ipDualStack.ipFamilyPolicy"?: string;
  "service.port"?: string;
  "service.type"?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "serviceMonitor.apiVersion"?: string;
  "serviceMonitor.bearerTokenFile"?: string;
  "serviceMonitor.defaults.additionalRelabeling"?: string;
  "serviceMonitor.defaults.honorTimestamps"?: string;
  "serviceMonitor.defaults.interval"?: string;
  "serviceMonitor.defaults.module"?: string;
  "serviceMonitor.defaults.scrapeTimeout"?: string;
  "serviceMonitor.enabled"?: string;
  "serviceMonitor.path"?: string;
  "serviceMonitor.scheme"?: string;
  "serviceMonitor.selfMonitor.additionalRelabeling"?: string;
  "serviceMonitor.selfMonitor.enabled"?: string;
  "serviceMonitor.selfMonitor.interval"?: string;
  "serviceMonitor.selfMonitor.path"?: string;
  "serviceMonitor.selfMonitor.scheme"?: string;
  "serviceMonitor.selfMonitor.scrapeTimeout"?: string;
  "serviceMonitor.targets"?: string;
  "strategy.rollingUpdate.maxSurge"?: string;
  "strategy.rollingUpdate.maxUnavailable"?: string;
  "strategy.type"?: string;
  terminationGracePeriodSeconds?: string;
  tolerations?: string;
  topologySpreadConstraints?: string;
  "verticalPodAutoscaler.controlledResources"?: string;
  "verticalPodAutoscaler.enabled"?: string;
  "verticalPodAutoscaler.updatePolicy.updateMode"?: string;
  "webConfiguration.existingSecret.name"?: string;
};
