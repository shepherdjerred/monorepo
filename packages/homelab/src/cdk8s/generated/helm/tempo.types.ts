// Generated TypeScript types for tempo Helm chart

export type TempoHelmValuesGlobal = {
  /**
   * Common labels for all object directly managed by this chart.
   *
   * @default {}
   */
  commonLabels?: TempoHelmValuesGlobalCommonLabels;
};

export type TempoHelmValuesGlobalCommonLabels = object;

export type TempoHelmValuesLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type TempoHelmValuesAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type TempoHelmValuesTempo = {
  /**
   * @default "docker.io"
   */
  registry?: string;
  /**
   * @default "grafana/tempo"
   */
  repository?: string;
  /**
   * @default ""
   */
  tag?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * Optionally specify an array of imagePullSecrets.
   * Secrets must be manually created in the namespace.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/
   *
   * @default "RollingUpdate"
   */
  updateStrategy?: string;
  /**
   * @default {}
   */
  resources?: TempoHelmValuesTempoResources;
  /**
   * @default 1024
   */
  memBallastSizeMbs?: number;
  /**
   * @default false
   */
  multitenancyEnabled?: boolean;
  /**
   * If true, Tempo will report anonymous usage data about the shape of a deployment to Grafana Labs
   *
   * @default true
   */
  reportingEnabled?: boolean;
  /**
   * @default {...} (6 keys)
   */
  metricsGenerator?: TempoHelmValuesTempoMetricsGenerator;
  /**
   * Configuration options for the ingester.
   * Refers to: https://grafana.com/docs/tempo/latest/configuration/#ingester
   *
   * @default {}
   */
  ingester?: TempoHelmValuesTempoIngester;
  /**
   * Configuration options for the querier.
   * Refers to: https://grafana.com/docs/tempo/latest/configuration/#querier
   *
   * @default {}
   */
  querier?: TempoHelmValuesTempoQuerier;
  /**
   * Configuration options for the query-fronted.
   * Refers to: https://grafana.com/docs/tempo/latest/configuration/#query-frontend
   *
   * @default {}
   */
  queryFrontend?: TempoHelmValuesTempoQueryFrontend;
  /**
   * @default "24h"
   */
  retention?: string;
  /**
   * The standard overrides configuration section. This can include a `defaults` object for applying to all tenants (not to be confused with the `global` property of the same name, which overrides `max_byte_per_trace` for all tenants). For an example on how to enable the metrics generator using the `overrides` object, see the 'Activate metrics generator' section below. Refer to [Standard overrides](https://grafana.com/docs/tempo/latest/configuration/#standard-overrides) for more details.
   *
   * @default {"defaults":{},"per_tenant_override_config":"/conf/overrides.yaml"}
   */
  overrides?: TempoHelmValuesTempoOverrides;
  /**
   * The `per tenant` aka `tenant-specific` runtime overrides. This allows overriding values set in the configuration on a per-tenant basis. Note that *all* values must be given for each per-tenant configuration block. Refer to [Runtime overrides](https://grafana.com/docs/tempo/latest/configuration/#runtime-overrides) and [Tenant-Specific overrides](https://grafana.com/docs/tempo/latest/configuration/#tenant-specific-overrides) documentation for more details.
   * 'tenant-id':
   *
   * @default {}
   */
  per_tenant_overrides?: TempoHelmValuesTempoPertenantoverrides;
  /**
   * Tempo server configuration.
   * Refers to: https://grafana.com/docs/tempo/latest/configuration/#server
   *
   * @default {"http_listen_port":3200}
   */
  server?: TempoHelmValuesTempoServer;
  /**
   * Readiness and Liveness Probe Configuration Options
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: TempoHelmValuesTempoLivenessProbe;
  /**
   * @default {...} (6 keys)
   */
  readinessProbe?: TempoHelmValuesTempoReadinessProbe;
  /**
   * @default {"trace":{"backend":"local","local":{"path":"/var/tempo/traces"},"wal":{"path":"/var/tempo/wal"}}}
   */
  storage?: TempoHelmValuesTempoStorage;
  /**
   * this configuration will listen on all ports and protocols that tempo is capable of.
   * the receives all come from the OpenTelemetry collector.  more configuration information can
   * be found there: https://github.com/open-telemetry/opentelemetry-collector/tree/master/receiver
   *
   * @default {"jaeger":{"protocols":{"grpc":{"endpoint":"0.0.0.0:14250"},"thrift_binary":{"endpoint":"0.0.0.0:6832"},"thrift_compact":{"endpoint":"0.0.0.0:6831"},"thrift_http":{"endpoint":"0.0.0.0:14268"}}},"opencensus":null,"otlp":{"protocols":{"grpc":{"endpoint":"0.0.0.0:4317"},"http":{"endpoint":"0.0.0.0:4318"}}}}
   */
  receivers?: TempoHelmValuesTempoReceivers;
  /**
   * @default {}
   */
  securityContext?: TempoHelmValuesTempoSecurityContext;
  /**
   * @default {}
   */
  extraArgs?: TempoHelmValuesTempoExtraArgs;
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
};

export type TempoHelmValuesTempoResources = object;

export type TempoHelmValuesTempoMetricsGenerator = {
  /**
   * If true, enables Tempo's metrics generator (https://grafana.com/docs/tempo/next/metrics-generator/)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "http://prometheus.monitoring:9090/api/v1/write"
   */
  remoteWriteUrl?: string;
  /**
   * Processor-specific configuration for metrics generator (optional)
   * Supports service_graphs, span_metrics, and local_blocks processors
   *
   * @default {}
   */
  processor?: TempoHelmValuesTempoMetricsGeneratorProcessor;
  /**
   * Registry configuration for metrics generator (optional)
   *
   * @default {}
   */
  registry?: TempoHelmValuesTempoMetricsGeneratorRegistry;
  /**
   * Storage configuration for metrics generator
   * This section configures the storage path and remote write endpoints
   *
   * @default {"path":"/tmp/tempo","remote_write":[]}
   */
  storage?: TempoHelmValuesTempoMetricsGeneratorStorage;
  /**
   * Traces storage (WAL) configuration for metrics generator
   * This configures the Write Ahead Log for traces used by the metrics generator
   *
   * @default {"path":"/tmp/traces"}
   */
  traces_storage?: TempoHelmValuesTempoMetricsGeneratorTracesstorage;
};

export type TempoHelmValuesTempoMetricsGeneratorProcessor = object;

export type TempoHelmValuesTempoMetricsGeneratorRegistry = object;

export type TempoHelmValuesTempoMetricsGeneratorStorage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Path for storing metrics blocks. Defaults to /tmp/tempo for backward compatibility, but /var/tempo/metrics is recommended for production with persistent storage
   *
   * @default "/tmp/tempo"
   */
  path?: string;
  remote_write?: unknown[];
};

export type TempoHelmValuesTempoMetricsGeneratorTracesstorage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Path for traces storage WAL used by metrics generator
   *
   * @default "/tmp/traces"
   */
  path?: string;
};

export type TempoHelmValuesTempoIngester = object;

export type TempoHelmValuesTempoQuerier = object;

export type TempoHelmValuesTempoQueryFrontend = object;

export type TempoHelmValuesTempoOverrides = {
  /**
   * Default config values for all tenants, can be overridden by per-tenant overrides. If a tenant's specific overrides are not found in the `per_tenant_overrides` block, the values in this `default` block will be used. Configs inside this block should follow the new overrides indentation format
   *
   * @default {}
   */
  defaults?: TempoHelmValuesTempoOverridesDefaults;
  /**
   * - service-graphs
   * - span-metrics
   * Path to the per tenant override config file. The values of the `per_tenant_overrides` config below will be written to the default path `/conf/overrides.yaml`. Users can set tenant-specific overrides settings in a separate file and point per_tenant_override_config to it if not using the per_tenant_overrides block below.
   *
   * @default "/conf/overrides.yaml"
   */
  per_tenant_override_config?: string;
};

export type TempoHelmValuesTempoOverridesDefaults = object;

export type TempoHelmValuesTempoPertenantoverrides = object;

export type TempoHelmValuesTempoServer = {
  /**
   * HTTP server listen port
   *
   * @default 3200
   */
  http_listen_port?: number;
};

export type TempoHelmValuesTempoLivenessProbe = {
  /**
   * @default {"path":"/ready","port":3200}
   */
  httpGet?: TempoHelmValuesTempoLivenessProbeHttpGet;
  /**
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * @default 10
   */
  periodSeconds?: number;
  /**
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
};

export type TempoHelmValuesTempoLivenessProbeHttpGet = {
  /**
   * @default "/ready"
   */
  path?: string;
  /**
   * @default 3200
   */
  port?: number;
};

export type TempoHelmValuesTempoReadinessProbe = {
  /**
   * @default {"path":"/ready","port":3200}
   */
  httpGet?: TempoHelmValuesTempoReadinessProbeHttpGet;
  /**
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * @default 10
   */
  periodSeconds?: number;
  /**
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
};

export type TempoHelmValuesTempoReadinessProbeHttpGet = {
  /**
   * @default "/ready"
   */
  path?: string;
  /**
   * @default 3200
   */
  port?: number;
};

export type TempoHelmValuesTempoStorage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"backend":"local","local":{"path":"/var/tempo/traces"},"wal":{"path":"/var/tempo/wal"}}
   */
  trace?: TempoHelmValuesTempoStorageTrace;
};

export type TempoHelmValuesTempoStorageTrace = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "local"
   */
  backend?: string;
  /**
   * @default {"path":"/var/tempo/traces"}
   */
  local?: TempoHelmValuesTempoStorageTraceLocal;
  /**
   * @default {"path":"/var/tempo/wal"}
   */
  wal?: TempoHelmValuesTempoStorageTraceWal;
};

export type TempoHelmValuesTempoStorageTraceLocal = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "/var/tempo/traces"
   */
  path?: string;
};

export type TempoHelmValuesTempoStorageTraceWal = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "/var/tempo/wal"
   */
  path?: string;
};

export type TempoHelmValuesTempoReceivers = {
  /**
   * @default {"protocols":{"grpc":{"endpoint":"0.0.0.0:14250"},"thrift_binary":{"endpoint":"0.0.0.0:6832"},"thrift_compact":{"endpoint":"0.0.0.0:6831"},"thrift_http":{"endpoint":"0.0.0.0:14268"}}}
   */
  jaeger?: TempoHelmValuesTempoReceiversJaeger;
  opencensus?: unknown;
  /**
   * @default {"protocols":{"grpc":{"endpoint":"0.0.0.0:4317"},"http":{"endpoint":"0.0.0.0:4318"}}}
   */
  otlp?: TempoHelmValuesTempoReceiversOtlp;
};

export type TempoHelmValuesTempoReceiversJaeger = {
  /**
   * @default {...} (4 keys)
   */
  protocols?: TempoHelmValuesTempoReceiversJaegerProtocols;
};

export type TempoHelmValuesTempoReceiversJaegerProtocols = {
  /**
   * @default {"endpoint":"0.0.0.0:14250"}
   */
  grpc?: TempoHelmValuesTempoReceiversJaegerProtocolsGrpc;
  /**
   * @default {"endpoint":"0.0.0.0:6832"}
   */
  thrift_binary?: TempoHelmValuesTempoReceiversJaegerProtocolsThriftbinary;
  /**
   * @default {"endpoint":"0.0.0.0:6831"}
   */
  thrift_compact?: TempoHelmValuesTempoReceiversJaegerProtocolsThriftcompact;
  /**
   * @default {"endpoint":"0.0.0.0:14268"}
   */
  thrift_http?: TempoHelmValuesTempoReceiversJaegerProtocolsThrifthttp;
};

export type TempoHelmValuesTempoReceiversJaegerProtocolsGrpc = {
  /**
   * @default "0.0.0.0:14250"
   */
  endpoint?: string;
};

export type TempoHelmValuesTempoReceiversJaegerProtocolsThriftbinary = {
  /**
   * @default "0.0.0.0:6832"
   */
  endpoint?: string;
};

export type TempoHelmValuesTempoReceiversJaegerProtocolsThriftcompact = {
  /**
   * @default "0.0.0.0:6831"
   */
  endpoint?: string;
};

export type TempoHelmValuesTempoReceiversJaegerProtocolsThrifthttp = {
  /**
   * @default "0.0.0.0:14268"
   */
  endpoint?: string;
};

export type TempoHelmValuesTempoReceiversOtlp = {
  /**
   * @default {"grpc":{"endpoint":"0.0.0.0:4317"},"http":{"endpoint":"0.0.0.0:4318"}}
   */
  protocols?: TempoHelmValuesTempoReceiversOtlpProtocols;
};

export type TempoHelmValuesTempoReceiversOtlpProtocols = {
  /**
   * @default {"endpoint":"0.0.0.0:4317"}
   */
  grpc?: TempoHelmValuesTempoReceiversOtlpProtocolsGrpc;
  /**
   * @default {"endpoint":"0.0.0.0:4318"}
   */
  http?: TempoHelmValuesTempoReceiversOtlpProtocolsHttp;
};

export type TempoHelmValuesTempoReceiversOtlpProtocolsGrpc = {
  /**
   * @default "0.0.0.0:4317"
   */
  endpoint?: string;
};

export type TempoHelmValuesTempoReceiversOtlpProtocolsHttp = {
  /**
   * @default "0.0.0.0:4318"
   */
  endpoint?: string;
};

export type TempoHelmValuesTempoSecurityContext = object;

export type TempoHelmValuesTempoExtraArgs = object;

export type TempoHelmValuesTempoQuery = {
  /**
   * @default "grafana/tempo-query"
   */
  repository?: string;
  tag?: unknown;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * Optionally specify an array of imagePullSecrets.
   * Secrets must be manually created in the namespace.
   * Refers to: https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/
   * if False the tempo-query container is not deployed
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"port":16686}
   */
  service?: TempoHelmValuesTempoQueryService;
  /**
   * @default {...} (8 keys)
   */
  ingress?: TempoHelmValuesTempoQueryIngress;
  /**
   * @default {}
   */
  resources?: TempoHelmValuesTempoQueryResources;
  /**
   * Additional container arguments
   *
   * @default {}
   */
  extraArgs?: TempoHelmValuesTempoQueryExtraArgs;
  extraEnv?: unknown[];
  extraVolumeMounts?: unknown[];
  /**
   * @default {}
   */
  securityContext?: TempoHelmValuesTempoQuerySecurityContext;
};

export type TempoHelmValuesTempoQueryService = {
  /**
   * @default 16686
   */
  port?: number;
};

export type TempoHelmValuesTempoQueryIngress = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * For Kubernetes >= 1.18 you should specify the ingress-controller via the field ingressClassName
   * See https://kubernetes.io/blog/2020/04/02/improvements-to-the-ingress-api-in-kubernetes-1.18/#specifying-the-class-of-an-ingress
   * Values can be templated
   *
   * @default {}
   */
  annotations?: TempoHelmValuesTempoQueryIngressAnnotations;
  /**
   * kubernetes.io/ingress.class: nginx
   * kubernetes.io/tls-acme: "true"
   *
   * @default {}
   */
  labels?: TempoHelmValuesTempoQueryIngressLabels;
  /**
   * @default "/"
   */
  path?: string;
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

export type TempoHelmValuesTempoQueryIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type TempoHelmValuesTempoQueryIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type TempoHelmValuesTempoQueryResources = object;

export type TempoHelmValuesTempoQueryExtraArgs = object;

export type TempoHelmValuesTempoQuerySecurityContext = object;

export type TempoHelmValuesSecurityContext = {
  /**
   * @default 10001
   */
  runAsUser?: number;
  /**
   * @default 10001
   */
  runAsGroup?: number;
  /**
   * @default 10001
   */
  fsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
};

export type TempoHelmValuesServiceAccount = {
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
  annotations?: TempoHelmValuesServiceAccountAnnotations;
  /**
   * Labels for the service account
   *
   * @default {}
   */
  labels?: TempoHelmValuesServiceAccountLabels;
  /**
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type TempoHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type TempoHelmValuesServiceAccountLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type TempoHelmValuesService = {
  /**
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default ""
   */
  clusterIP?: string;
  loadBalancerIP?: unknown;
  /**
   * @default "TCP"
   */
  protocol?: string;
  /**
   * @default {}
   */
  annotations?: TempoHelmValuesServiceAnnotations;
  /**
   * @default {}
   */
  labels?: TempoHelmValuesServiceLabels;
  /**
   * @default ""
   */
  targetPort?: string;
};

export type TempoHelmValuesServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type TempoHelmValuesServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type TempoHelmValuesServiceMonitor = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  interval?: string;
  /**
   * @default {}
   */
  additionalLabels?: TempoHelmValuesServiceMonitorAdditionalLabels;
  /**
   * @default {}
   */
  annotations?: TempoHelmValuesServiceMonitorAnnotations;
};

export type TempoHelmValuesServiceMonitorAdditionalLabels = object;

export type TempoHelmValuesServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type TempoHelmValuesPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable StatefulSetAutoDeletePVC feature
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default false
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  accessModes?: string[];
  /**
   * @default "10Gi"
   */
  size?: string;
};

export type TempoHelmValuesPodAnnotations = object;

export type TempoHelmValuesPodLabels = object;

export type TempoHelmValuesExtraLabels = object;

export type TempoHelmValuesNodeSelector = object;

export type TempoHelmValuesAffinity = object;

export type TempoHelmValuesNetworkPolicy = {
  /**
   * Enable creation of NetworkPolicy resources. Only Ingress traffic is filtered for now.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * When true enables the creation
   *
   * @default true
   */
  ingress?: boolean;
  /**
   * an ingress network policy
   *
   * @default true
   */
  allowExternal?: boolean;
  /**
   * If explicitNamespacesSelector is missing or set to {}, only client Pods that are in the networkPolicy's namespace
   * and that match other criteria, the ones that have the good label, can reach the tempo.
   * But sometimes, we want the tempo to be accessible to clients from other namespaces, in this case, we can use this
   * LabelSelector to select these namespaces, note that the networkPolicy's namespace should also be explicitly added.
   * Example:
   * explicitNamespacesSelector:
   * matchLabels:
   * matchExpressions:
   * - {key: role, operator: In, values: [frontend]}
   *
   * @default {}
   */
  explicitNamespacesSelector?: TempoHelmValuesNetworkPolicyExplicitNamespacesSelector;
  /**
   * Add destinations to the egress by specifying - ipBlock: <CIDR>
   * E.X.
   *
   * @default {...} (4 keys)
   */
  egress?: TempoHelmValuesNetworkPolicyEgress;
};

export type TempoHelmValuesNetworkPolicyExplicitNamespacesSelector = object;

export type TempoHelmValuesNetworkPolicyEgress = {
  /**
   * created allowing tempo to connect to external data sources from kubernetes cluster.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * for all pods in the tempo namespace.
   *
   * @default false
   */
  blockDNSResolution?: boolean;
  ports?: unknown[];
  to?: unknown[];
};

export type TempoHelmValues = {
  /**
   * @default {"commonLabels":{}}
   */
  global?: TempoHelmValuesGlobal;
  /**
   * Overrides the chart's name
   *
   * @default ""
   */
  nameOverride?: string;
  /**
   * Overrides the chart's computed fullname
   *
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * Define the amount of instances
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Number of old history to retain to allow rollback (If not set, default Kubernetes value is set to 10)
   * labels for tempo
   *
   * @default {}
   */
  labels?: TempoHelmValuesLabels;
  /**
   * Annotations for the StatefulSet
   *
   * @default {}
   */
  annotations?: TempoHelmValuesAnnotations;
  /**
   * @default {...} (26 keys)
   */
  tempo?: TempoHelmValuesTempo;
  /**
   * Tempo configuration file contents
   *
   * @default "memberlist:
  cluster_label: "{{ .Release.Name ..."
   */
  config?: string;
  /**
   * @default {...} (11 keys)
   */
  tempoQuery?: TempoHelmValuesTempoQuery;
  /**
   * @default {...} (4 keys)
   */
  securityContext?: TempoHelmValuesSecurityContext;
  /**
   * @default {...} (6 keys)
   */
  serviceAccount?: TempoHelmValuesServiceAccount;
  /**
   * @default {...} (7 keys)
   */
  service?: TempoHelmValuesService;
  /**
   * @default {...} (4 keys)
   */
  serviceMonitor?: TempoHelmValuesServiceMonitor;
  /**
   * @default {...} (4 keys)
   */
  persistence?: TempoHelmValuesPersistence;
  /**
   * Pod Annotations
   *
   * @default {}
   */
  podAnnotations?: TempoHelmValuesPodAnnotations;
  /**
   * Pod (extra) Labels
   *
   * @default {}
   */
  podLabels?: TempoHelmValuesPodLabels;
  /**
   * Apply extra labels to common labels.
   *
   * @default {}
   */
  extraLabels?: TempoHelmValuesExtraLabels;
  extraVolumes?: unknown[];
  /**
   * Node labels for pod assignment. See: https://kubernetes.io/docs/user-guide/node-selection/
   *
   * @default {}
   */
  nodeSelector?: TempoHelmValuesNodeSelector;
  tolerations?: unknown[];
  /**
   * Affinity for pod assignment. See: https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#affinity-and-anti-affinity
   *
   * @default {}
   */
  affinity?: TempoHelmValuesAffinity;
  priorityClassName?: unknown;
  hostAliases?: unknown[];
  /**
   * @default {...} (5 keys)
   */
  networkPolicy?: TempoHelmValuesNetworkPolicy;
};

export type TempoHelmParameters = {
  nameOverride?: string;
  fullnameOverride?: string;
  replicas?: string;
  "tempo.registry"?: string;
  "tempo.repository"?: string;
  "tempo.tag"?: string;
  "tempo.pullPolicy"?: string;
  "tempo.updateStrategy"?: string;
  "tempo.memBallastSizeMbs"?: string;
  "tempo.multitenancyEnabled"?: string;
  "tempo.reportingEnabled"?: string;
  "tempo.metricsGenerator.enabled"?: string;
  "tempo.metricsGenerator.remoteWriteUrl"?: string;
  "tempo.metricsGenerator.storage.path"?: string;
  "tempo.metricsGenerator.storage.remote_write"?: string;
  "tempo.metricsGenerator.traces_storage.path"?: string;
  "tempo.retention"?: string;
  "tempo.overrides.per_tenant_override_config"?: string;
  "tempo.server.http_listen_port"?: string;
  "tempo.livenessProbe.httpGet.path"?: string;
  "tempo.livenessProbe.httpGet.port"?: string;
  "tempo.livenessProbe.initialDelaySeconds"?: string;
  "tempo.livenessProbe.periodSeconds"?: string;
  "tempo.livenessProbe.timeoutSeconds"?: string;
  "tempo.livenessProbe.failureThreshold"?: string;
  "tempo.livenessProbe.successThreshold"?: string;
  "tempo.readinessProbe.httpGet.path"?: string;
  "tempo.readinessProbe.httpGet.port"?: string;
  "tempo.readinessProbe.initialDelaySeconds"?: string;
  "tempo.readinessProbe.periodSeconds"?: string;
  "tempo.readinessProbe.timeoutSeconds"?: string;
  "tempo.readinessProbe.failureThreshold"?: string;
  "tempo.readinessProbe.successThreshold"?: string;
  "tempo.storage.trace.backend"?: string;
  "tempo.storage.trace.local.path"?: string;
  "tempo.storage.trace.wal.path"?: string;
  "tempo.receivers.jaeger.protocols.grpc.endpoint"?: string;
  "tempo.receivers.jaeger.protocols.thrift_binary.endpoint"?: string;
  "tempo.receivers.jaeger.protocols.thrift_compact.endpoint"?: string;
  "tempo.receivers.jaeger.protocols.thrift_http.endpoint"?: string;
  "tempo.receivers.opencensus"?: string;
  "tempo.receivers.otlp.protocols.grpc.endpoint"?: string;
  "tempo.receivers.otlp.protocols.http.endpoint"?: string;
  "tempo.extraEnv"?: string;
  "tempo.extraEnvFrom"?: string;
  "tempo.extraVolumeMounts"?: string;
  config?: string;
  "tempoQuery.repository"?: string;
  "tempoQuery.tag"?: string;
  "tempoQuery.pullPolicy"?: string;
  "tempoQuery.enabled"?: string;
  "tempoQuery.service.port"?: string;
  "tempoQuery.ingress.enabled"?: string;
  "tempoQuery.ingress.path"?: string;
  "tempoQuery.ingress.pathType"?: string;
  "tempoQuery.ingress.hosts"?: string;
  "tempoQuery.ingress.extraPaths"?: string;
  "tempoQuery.ingress.tls"?: string;
  "tempoQuery.extraEnv"?: string;
  "tempoQuery.extraVolumeMounts"?: string;
  "securityContext.runAsUser"?: string;
  "securityContext.runAsGroup"?: string;
  "securityContext.fsGroup"?: string;
  "securityContext.runAsNonRoot"?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "serviceAccount.imagePullSecrets"?: string;
  "serviceAccount.automountServiceAccountToken"?: string;
  "service.type"?: string;
  "service.clusterIP"?: string;
  "service.loadBalancerIP"?: string;
  "service.protocol"?: string;
  "service.targetPort"?: string;
  "serviceMonitor.enabled"?: string;
  "serviceMonitor.interval"?: string;
  "persistence.enabled"?: string;
  "persistence.enableStatefulSetAutoDeletePVC"?: string;
  "persistence.accessModes"?: string;
  "persistence.size"?: string;
  extraVolumes?: string;
  tolerations?: string;
  priorityClassName?: string;
  hostAliases?: string;
  "networkPolicy.enabled"?: string;
  "networkPolicy.ingress"?: string;
  "networkPolicy.allowExternal"?: string;
  "networkPolicy.egress.enabled"?: string;
  "networkPolicy.egress.blockDNSResolution"?: string;
  "networkPolicy.egress.ports"?: string;
  "networkPolicy.egress.to"?: string;
};
