// Generated TypeScript types for loki Helm chart

export type LokiHelmValuesGlobal = {
  imageRegistry?: unknown;
  /**
   * @default {"registry":null}
   */
  image?: LokiHelmValuesGlobalImage;
  priorityClassName?: unknown;
  /**
   * configures cluster domain ("cluster.local" by default)
   *
   * @default "cluster.local"
   */
  clusterDomain?: string;
  /**
   * configures DNS service name
   *
   * @default "kube-dns"
   */
  dnsService?: string;
  /**
   * configures DNS service namespace
   *
   * @default "kube-system"
   */
  dnsNamespace?: string;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
};

export type LokiHelmValuesGlobalImage = {
  registry?: unknown;
};

export type LokiHelmValuesLoki = {
  /**
   * Configures the liveness probe for all of the Loki pods
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesLokiLivenessProbe;
  /**
   * Configures the readiness probe for all of the Loki pods
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: LokiHelmValuesLokiReadinessProbe;
  /**
   * Configures the startup probe for all of the Loki pods
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesLokiStartupProbe;
  /**
   * @default {...} (5 keys)
   */
  image?: LokiHelmValuesLokiImage;
  /**
   * Common annotations for all deployments/StatefulSets
   *
   * @default {}
   */
  annotations?: LokiHelmValuesLokiAnnotations;
  /**
   * Common annotations for all pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesLokiPodAnnotations;
  /**
   * Common labels for all pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesLokiPodLabels;
  /**
   * Common annotations for all services
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesLokiServiceAnnotations;
  /**
   * Common labels for all services
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesLokiServiceLabels;
  /**
   * The number of old ReplicaSets to retain to allow rollback
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * The SecurityContext for Loki pods
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: LokiHelmValuesLokiPodSecurityContext;
  /**
   * The SecurityContext for Loki containers
   *
   * @default {"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}
   */
  containerSecurityContext?: LokiHelmValuesLokiContainerSecurityContext;
  /**
   * Should enableServiceLinks be enabled. Default to enable
   *
   * @default true
   */
  enableServiceLinks?: boolean;
  /**
   * DNS config for Loki pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesLokiDnsConfig;
  /**
   * Loki Configuration
   * There are several ways to pass configuration to Loki, listing them here in order of our preference for how
   * you should use this chart.
   * 1. Use the templated value of loki.config below and the corresponding override sections which follow.
   * This allows us to set a lot of important Loki configurations and defaults and also allows us to maintain them
   * over time as Loki changes and evolves.
   * 2. Use the loki.structuredConfig section.
   * This will completely override the templated value of loki.config, so you MUST provide the entire Loki config
   * including any configuration that we set in loki.config unless you explicitly are trying to change one of those
   * values and are not able to do so with the templated sections.
   * If you choose this approach the burden is on you to maintain any changes we make to the templated config.
   * 3. Use an existing secret or configmap to provide the configuration.
   * This option is mostly provided for folks who have external processes which provide or modify the configuration.
   * When using this option you can specify a different name for loki.generatedConfigObjectName and configObjectName
   * if you have a process which takes the generated config and modifies it, or you can stop the chart from generating
   * a config entirely by setting loki.generatedConfigObjectName to
   * Defines what kind of object stores the configuration, a ConfigMap or a Secret.
   * In order to move sensitive information (such as credentials) from the ConfigMap/Secret to a more secure location (e.g. vault), it is possible to use [environment variables in the configuration](https://grafana.com/docs/loki/latest/configuration/#use-environment-variables-in-the-configuration).
   * Such environment variables can be then stored in a separate Secret and injected via the global.extraEnvFrom value. For details about environment injection from a Secret please see [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/#use-case-as-container-environment-variables).
   *
   * @default "ConfigMap"
   */
  configStorageType?: string;
  /**
   * The name of the object which Loki will mount as a volume containing the config.
   * If the configStorageType is Secret, this will be the name of the Secret, if it is ConfigMap, this will be the name of the ConfigMap.
   * The value will be passed through tpl.
   *
   * @default "{{ include "loki.name" . }}"
   */
  configObjectName?: string;
  /**
   * The name of the Secret or ConfigMap that will be created by this chart.
   * If empty, no configmap or secret will be created.
   * The value will be passed through tpl.
   *
   * @default "{{ include "loki.name" . }}"
   */
  generatedConfigObjectName?: string;
  /**
   * Config file contents for Loki
   *
   * @default "{{- if .Values.enterprise.enabled}}
{{- tpl .Va..."
   */
  config?: string;
  /**
   * Should authentication be enabled
   *
   * @default true
   */
  auth_enabled?: boolean;
  /**
   * memberlist configuration (overrides embedded default)
   *
   * @default {}
   */
  memberlistConfig?: LokiHelmValuesLokiMemberlistConfig;
  /**
   * Extra memberlist configuration
   *
   * @default {}
   */
  extraMemberlistConfig?: LokiHelmValuesLokiExtraMemberlistConfig;
  tenants?: unknown[];
  /**
   * Check https://grafana.com/docs/loki/latest/configuration/#server for more info on the server configuration.
   *
   * @default {...} (4 keys)
   */
  server?: LokiHelmValuesLokiServer;
  /**
   * @default {"trafficDistribution":""}
   */
  service?: LokiHelmValuesLokiService;
  /**
   * Limits config
   *
   * @default {...} (6 keys)
   */
  limits_config?: LokiHelmValuesLokiLimitsconfig;
  /**
   * Provides a reloadable runtime configuration file for some specific configuration
   *
   * @default {}
   */
  runtimeConfig?: LokiHelmValuesLokiRuntimeConfig;
  /**
   * Check https://grafana.com/docs/loki/latest/configuration/#common_config for more info on how to provide a common configuration
   *
   * @default {"path_prefix":"/var/loki","replication_factor":3,"compactor_grpc_address":"{{ include \"loki.compactorAddress\" . }}"}
   */
  commonConfig?: LokiHelmValuesLokiCommonConfig;
  /**
   * Storage config. Providing this will automatically populate all necessary storage configs in the templated config.
   * In case of using thanos storage, enable use_thanos_objstore and the configuration should be done inside the object_store section.
   *
   * @default {...} (8 keys)
   */
  storage?: LokiHelmValuesLokiStorage;
  /**
   * Check https://grafana.com/docs/loki/latest/configuration/#schema_config for more info on how to configure schemas
   *
   * @default {}
   */
  schemaConfig?: LokiHelmValuesLokiSchemaConfig;
  /**
   * a real Loki install requires a proper schemaConfig defined above this, however for testing or playing around
   * you can enable useTestSchema
   *
   * @default false
   */
  useTestSchema?: boolean;
  /**
   * @default {"configs":[{"from":"2024-04-01","store":"tsdb","object_store":"{{ include \"loki.testSchemaObjectStore\" . }}","schema":"v13","index":{"prefix":"index_","period":"24h"}}]}
   */
  testSchemaConfig?: LokiHelmValuesLokiTestSchemaConfig;
  /**
   * A separate loki ruler storage configuration can be provided via rulerStorage.storage section:
   * Check https://grafana.com/docs/loki/latest/configuration/#ruler for more info on configuring ruler
   *
   * @default {"wal":{"dir":"/var/loki/ruler-wal"}}
   */
  rulerConfig?: LokiHelmValuesLokiRulerConfig;
  /**
   * @default {}
   */
  structuredConfig?: LokiHelmValuesLokiStructuredConfig;
  /**
   * Additional query scheduler config
   *
   * @default {}
   */
  query_scheduler?: LokiHelmValuesLokiQueryscheduler;
  /**
   * Additional storage config
   *
   * @default {...} (4 keys)
   */
  storage_config?: LokiHelmValuesLokiStorageconfig;
  /**
   * Optional compactor configuration
   *
   * @default {}
   */
  compactor?: LokiHelmValuesLokiCompactor;
  /**
   * Optional compactor grpc client configuration
   *
   * @default {}
   */
  compactor_grpc_client?: LokiHelmValuesLokiCompactorgrpcclient;
  /**
   * Optional pattern ingester configuration
   *
   * @default {"enabled":false}
   */
  pattern_ingester?: LokiHelmValuesLokiPatterningester;
  /**
   * Optional analytics configuration
   *
   * @default {}
   */
  analytics?: LokiHelmValuesLokiAnalytics;
  /**
   * Optional Loki UI: Provides access to a operators UI for Loki distributed. When enabled UI will be available at /ui/ of loki-gateway
   *
   * @default {"enabled":false,"gateway":{"enabled":true}}
   */
  ui?: LokiHelmValuesLokiUi;
  /**
   * Optional querier configuration
   *
   * @default {}
   */
  query_range?: LokiHelmValuesLokiQueryrange;
  /**
   * Optional querier configuration
   *
   * @default {}
   */
  querier?: LokiHelmValuesLokiQuerier;
  /**
   * Optional ingester configuration
   *
   * @default {}
   */
  ingester?: LokiHelmValuesLokiIngester;
  /**
   * Optional ingester client configuration
   *
   * @default {}
   */
  ingester_client?: LokiHelmValuesLokiIngesterclient;
  /**
   * Optional block builder configuration
   *
   * @default {}
   */
  block_builder?: LokiHelmValuesLokiBlockbuilder;
  /**
   * Optional index gateway configuration
   *
   * @default {"mode":"simple"}
   */
  index_gateway?: LokiHelmValuesLokiIndexgateway;
  /**
   * @default {"scheduler_address":"{{ include \"loki.querySchedulerAddress\" . }}","tail_proxy_url":"{{ include \"loki.querierAddress\" . }}"}
   */
  frontend?: LokiHelmValuesLokiFrontend;
  /**
   * @default {"scheduler_address":"{{ include \"loki.querySchedulerAddress\" . }}"}
   */
  frontend_worker?: LokiHelmValuesLokiFrontendworker;
  /**
   * Optional distributor configuration
   *
   * @default {}
   */
  distributor?: LokiHelmValuesLokiDistributor;
  /**
   * Enable tracing
   *
   * @default {"enabled":false}
   */
  tracing?: LokiHelmValuesLokiTracing;
  /**
   * @default {"enabled":false,"builder":{"planner_address":"{{ include \"loki.bloomPlannerAddress\" . }}"}}
   */
  bloom_build?: LokiHelmValuesLokiBloombuild;
  /**
   * @default {"enabled":false,"client":{"addresses":"{{ include \"loki.bloomGatewayAddresses\" . }}"}}
   */
  bloom_gateway?: LokiHelmValuesLokiBloomgateway;
  /**
   * Optional operational configuration
   *
   * @default {}
   */
  operational_config?: LokiHelmValuesLokiOperationalconfig;
};

export type LokiHelmValuesLokiLivenessProbe = object;

export type LokiHelmValuesLokiReadinessProbe = {
  /**
   * @default {"path":"/ready","port":"http-metrics"}
   */
  httpGet?: LokiHelmValuesLokiReadinessProbeHttpGet;
  /**
   * @default 10
   */
  periodSeconds?: number;
  /**
   * @default 15
   */
  initialDelaySeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 1
   */
  timeoutSeconds?: number;
};

export type LokiHelmValuesLokiReadinessProbeHttpGet = {
  /**
   * @default "/ready"
   */
  path?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
};

export type LokiHelmValuesLokiStartupProbe = object;

export type LokiHelmValuesLokiImage = {
  /**
   * The Docker registry
   *
   * @default "docker.io"
   */
  registry?: string;
  /**
   * Docker image repository
   *
   * @default "grafana/loki"
   */
  repository?: string;
  /**
   * Overrides the image tag whose default is the chart's appVersion
   *
   * @default "3.6.3"
   */
  tag?: string;
  digest?: unknown;
  /**
   * Docker image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type LokiHelmValuesLokiAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesLokiPodAnnotations = object;

export type LokiHelmValuesLokiPodLabels = object;

export type LokiHelmValuesLokiServiceAnnotations = object;

export type LokiHelmValuesLokiServiceLabels = object;

export type LokiHelmValuesLokiPodSecurityContext = {
  /**
   * @default 10001
   */
  fsGroup?: number;
  /**
   * @default "OnRootMismatch"
   */
  fsGroupChangePolicy?: string;
  /**
   * @default 10001
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 10001
   */
  runAsUser?: number;
};

export type LokiHelmValuesLokiContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: LokiHelmValuesLokiContainerSecurityContextCapabilities;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type LokiHelmValuesLokiContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type LokiHelmValuesLokiDnsConfig = object;

export type LokiHelmValuesLokiMemberlistConfig = object;

export type LokiHelmValuesLokiExtraMemberlistConfig = object;

export type LokiHelmValuesLokiServer = {
  /**
   * @default 3100
   */
  http_listen_port?: number;
  /**
   * @default 9095
   */
  grpc_listen_port?: number;
  /**
   * @default "600s"
   */
  http_server_read_timeout?: string;
  /**
   * @default "600s"
   */
  http_server_write_timeout?: string;
};

export type LokiHelmValuesLokiService = {
  /**
   * trafficDistribution for services
   * Ref: https://kubernetes.io/docs/concepts/services-networking/service/#traffic-distribution
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type LokiHelmValuesLokiLimitsconfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default true
   */
  reject_old_samples?: boolean;
  /**
   * @default "168h"
   */
  reject_old_samples_max_age?: string;
  /**
   * @default "10m"
   */
  max_cache_freshness_per_query?: string;
  /**
   * @default "15m"
   */
  split_queries_by_interval?: string;
  /**
   * @default "300s"
   */
  query_timeout?: string;
  /**
   * @default true
   */
  volume_enabled?: boolean;
};

export type LokiHelmValuesLokiRuntimeConfig = object;

export type LokiHelmValuesLokiCommonConfig = {
  /**
   * @default "/var/loki"
   */
  path_prefix?: string;
  /**
   * @default 3
   */
  replication_factor?: number;
  /**
   * The gRPC address of the compactor. The use of compactor_grpc_address is prefered over compactor_address.
   * If a customized compactor_address is set, compactor_grpc_address should be set to an empty string.
   *
   * @default "{{ include "loki.compactorAddress" . }}"
   */
  compactor_grpc_address?: string;
};

export type LokiHelmValuesLokiStorage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Loki requires a bucket for chunks and the ruler. GEL requires a third bucket for the admin API.
   * Please provide these values if you are using object storage.
   *
   * @default "s3"
   */
  type?: string;
  /**
   * @default {...} (11 keys)
   */
  s3?: LokiHelmValuesLokiStorageS3;
  /**
   * @default {"chunkBufferSize":0,"requestTimeout":"0s","enableHttp2":true}
   */
  gcs?: LokiHelmValuesLokiStorageGcs;
  /**
   * @default {...} (9 keys)
   */
  azure?: LokiHelmValuesLokiStorageAzure;
  /**
   * @default {...} (19 keys)
   */
  swift?: LokiHelmValuesLokiStorageSwift;
  /**
   * @default {"chunks_directory":"/var/loki/chunks","rules_directory":"/var/loki/rules"}
   */
  filesystem?: LokiHelmValuesLokiStorageFilesystem;
  /**
   * Loki now supports using thanos storage clients for connecting to object storage backend.
   * This will become the default way to configure storage in a future releases.
   *
   * @default false
   */
  use_thanos_objstore?: boolean;
  /**
   * @default {...} (5 keys)
   */
  object_store?: LokiHelmValuesLokiStorageObjectstore;
};

export type LokiHelmValuesLokiStorageS3 = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  s3?: unknown;
  endpoint?: unknown;
  region?: unknown;
  secretAccessKey?: unknown;
  accessKeyId?: unknown;
  signatureVersion?: unknown;
  /**
   * @default false
   */
  s3ForcePathStyle?: boolean;
  /**
   * @default false
   */
  insecure?: boolean;
  /**
   * @default {}
   */
  http_config?: LokiHelmValuesLokiStorageS3Httpconfig;
  /**
   * Check https://grafana.com/docs/loki/latest/configure/#s3_storage_config for more info on how to provide a backoff_config
   *
   * @default {}
   */
  backoff_config?: LokiHelmValuesLokiStorageS3Backoffconfig;
  /**
   * @default false
   */
  disable_dualstack?: boolean;
};

export type LokiHelmValuesLokiStorageS3Httpconfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesLokiStorageS3Backoffconfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesLokiStorageGcs = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default 0
   */
  chunkBufferSize?: number;
  /**
   * @default "0s"
   */
  requestTimeout?: string;
  /**
   * @default true
   */
  enableHttp2?: boolean;
};

export type LokiHelmValuesLokiStorageAzure = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  accountName?: unknown;
  accountKey?: unknown;
  connectionString?: unknown;
  /**
   * @default false
   */
  useManagedIdentity?: boolean;
  /**
   * @default false
   */
  useFederatedToken?: boolean;
  userAssignedId?: unknown;
  requestTimeout?: unknown;
  endpointSuffix?: unknown;
  chunkDelimiter?: unknown;
};

export type LokiHelmValuesLokiStorageSwift = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  auth_version?: unknown;
  auth_url?: unknown;
  internal?: unknown;
  username?: unknown;
  user_domain_name?: unknown;
  user_domain_id?: unknown;
  user_id?: unknown;
  password?: unknown;
  domain_id?: unknown;
  domain_name?: unknown;
  project_id?: unknown;
  project_name?: unknown;
  project_domain_id?: unknown;
  project_domain_name?: unknown;
  region_name?: unknown;
  container_name?: unknown;
  max_retries?: unknown;
  connect_timeout?: unknown;
  request_timeout?: unknown;
};

export type LokiHelmValuesLokiStorageFilesystem = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "/var/loki/chunks"
   */
  chunks_directory?: string;
  /**
   * @default "/var/loki/rules"
   */
  rules_directory?: string;
};

export type LokiHelmValuesLokiStorageObjectstore = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Type of object store. Valid options are: s3, gcs, azure
   *
   * @default "s3"
   */
  type?: string;
  storage_prefix?: unknown;
  /**
   * S3 configuration (when type is "s3")
   *
   * @default {...} (7 keys)
   */
  s3?: LokiHelmValuesLokiStorageObjectstoreS3;
  /**
   * GCS configuration (when type is "gcs")
   *
   * @default {"bucket_name":null,"service_account":null}
   */
  gcs?: LokiHelmValuesLokiStorageObjectstoreGcs;
  /**
   * Azure configuration (when type is "azure")
   *
   * @default {"account_name":null,"account_key":null}
   */
  azure?: LokiHelmValuesLokiStorageObjectstoreAzure;
};

export type LokiHelmValuesLokiStorageObjectstoreS3 = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  endpoint?: unknown;
  region?: unknown;
  access_key_id?: unknown;
  secret_access_key?: unknown;
  /**
   * Optional. Enable if using self-signed TLS
   *
   * @default false
   */
  insecure?: boolean;
  /**
   * Optional server-side encryption configuration
   *
   * @default {}
   */
  sse?: LokiHelmValuesLokiStorageObjectstoreS3Sse;
  /**
   * Optional HTTP client configuration
   *
   * @default {}
   */
  http?: LokiHelmValuesLokiStorageObjectstoreS3Http;
};

export type LokiHelmValuesLokiStorageObjectstoreS3Sse = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesLokiStorageObjectstoreS3Http = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesLokiStorageObjectstoreGcs = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  bucket_name?: unknown;
  service_account?: unknown;
};

export type LokiHelmValuesLokiStorageObjectstoreAzure = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  account_name?: unknown;
  account_key?: unknown;
};

export type LokiHelmValuesLokiSchemaConfig = object;

export type LokiHelmValuesLokiTestSchemaConfig = {
  configs?: LokiHelmValuesLokiTestSchemaConfigConfigsElement[];
};

export type LokiHelmValuesLokiTestSchemaConfigConfigsElement = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "2024-04-01"
   */
  from?: string;
  /**
   * @default "tsdb"
   */
  store?: string;
  /**
   * @default "{{ include "loki.testSchemaObjectStore" . }}"
   */
  object_store?: string;
  /**
   * @default "v13"
   */
  schema?: string;
  /**
   * @default {"prefix":"index_","period":"24h"}
   */
  index?: LokiHelmValuesLokiTestSchemaConfigConfigsIndex;
};

export type LokiHelmValuesLokiTestSchemaConfigConfigsIndex = {
  /**
   * @default "index_"
   */
  prefix?: string;
  /**
   * @default "24h"
   */
  period?: string;
};

export type LokiHelmValuesLokiRulerConfig = {
  /**
   * @default {"dir":"/var/loki/ruler-wal"}
   */
  wal?: LokiHelmValuesLokiRulerConfigWal;
};

export type LokiHelmValuesLokiRulerConfigWal = {
  /**
   * @default "/var/loki/ruler-wal"
   */
  dir?: string;
};

export type LokiHelmValuesLokiStructuredConfig = object;

export type LokiHelmValuesLokiQueryscheduler = object;

export type LokiHelmValuesLokiStorageconfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"index_gateway_client":{"server_address":"{{ include \"loki.indexGatewayAddress\" . }}"}}
   */
  boltdb_shipper?: LokiHelmValuesLokiStorageconfigBoltdbshipper;
  /**
   * @default {"index_gateway_client":{"server_address":"{{ include \"loki.indexGatewayAddress\" . }}"}}
   */
  tsdb_shipper?: LokiHelmValuesLokiStorageconfigTsdbshipper;
  /**
   * @default {"working_directory":"/var/loki/data/bloomshipper"}
   */
  bloom_shipper?: LokiHelmValuesLokiStorageconfigBloomshipper;
  /**
   * @default {"at":"250ms","max_per_second":20,"up_to":3}
   */
  hedging?: LokiHelmValuesLokiStorageconfigHedging;
};

export type LokiHelmValuesLokiStorageconfigBoltdbshipper = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"server_address":"{{ include \"loki.indexGatewayAddress\" . }}"}
   */
  index_gateway_client?: LokiHelmValuesLokiStorageconfigBoltdbshipperIndexgatewayclient;
};

export type LokiHelmValuesLokiStorageconfigBoltdbshipperIndexgatewayclient = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "{{ include "loki.indexGatewayAddress" . }}"
   */
  server_address?: string;
};

export type LokiHelmValuesLokiStorageconfigTsdbshipper = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"server_address":"{{ include \"loki.indexGatewayAddress\" . }}"}
   */
  index_gateway_client?: LokiHelmValuesLokiStorageconfigTsdbshipperIndexgatewayclient;
};

export type LokiHelmValuesLokiStorageconfigTsdbshipperIndexgatewayclient = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "{{ include "loki.indexGatewayAddress" . }}"
   */
  server_address?: string;
};

export type LokiHelmValuesLokiStorageconfigBloomshipper = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "/var/loki/data/bloomshipper"
   */
  working_directory?: string;
};

export type LokiHelmValuesLokiStorageconfigHedging = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "250ms"
   */
  at?: string;
  /**
   * @default 20
   */
  max_per_second?: number;
  /**
   * @default 3
   */
  up_to?: number;
};

export type LokiHelmValuesLokiCompactor = object;

export type LokiHelmValuesLokiCompactorgrpcclient = object;

export type LokiHelmValuesLokiPatterningester = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type LokiHelmValuesLokiAnalytics = object;

export type LokiHelmValuesLokiUi = {
  /**
   * Disabled by default for backwards compatibility. Enable to use the Loki UI.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"enabled":true}
   */
  gateway?: LokiHelmValuesLokiUiGateway;
};

export type LokiHelmValuesLokiUiGateway = {
  /**
   * enable gateway proxying to UI under /ui
   *
   * @default true
   */
  enabled?: boolean;
};

export type LokiHelmValuesLokiQueryrange = object;

export type LokiHelmValuesLokiQuerier = object;

export type LokiHelmValuesLokiIngester = object;

export type LokiHelmValuesLokiIngesterclient = object;

export type LokiHelmValuesLokiBlockbuilder = object;

export type LokiHelmValuesLokiIndexgateway = {
  /**
   * @default "simple"
   */
  mode?: string;
};

export type LokiHelmValuesLokiFrontend = {
  /**
   * @default "{{ include "loki.querySchedulerAddress" . }}"
   */
  scheduler_address?: string;
  /**
   * @default "{{ include "loki.querierAddress" . }}"
   */
  tail_proxy_url?: string;
};

export type LokiHelmValuesLokiFrontendworker = {
  /**
   * @default "{{ include "loki.querySchedulerAddress" . }}"
   */
  scheduler_address?: string;
};

export type LokiHelmValuesLokiDistributor = object;

export type LokiHelmValuesLokiTracing = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type LokiHelmValuesLokiBloombuild = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"planner_address":"{{ include \"loki.bloomPlannerAddress\" . }}"}
   */
  builder?: LokiHelmValuesLokiBloombuildBuilder;
};

export type LokiHelmValuesLokiBloombuildBuilder = {
  /**
   * @default "{{ include "loki.bloomPlannerAddress" . }}"
   */
  planner_address?: string;
};

export type LokiHelmValuesLokiBloomgateway = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"addresses":"{{ include \"loki.bloomGatewayAddresses\" . }}"}
   */
  client?: LokiHelmValuesLokiBloomgatewayClient;
};

export type LokiHelmValuesLokiBloomgatewayClient = {
  /**
   * @default "{{ include "loki.bloomGatewayAddresses" . }}"
   */
  addresses?: string;
};

export type LokiHelmValuesLokiOperationalconfig = object;

export type LokiHelmValuesEnterprise = {
  /**
   * Enable enterprise features, license must be provided
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Default version of GEL to deploy
   *
   * @default "3.6.1"
   */
  version?: string;
  cluster_name?: unknown;
  /**
   * Grafana Enterprise Logs license
   * In order to use Grafana Enterprise Logs features, you will need to provide
   * the contents of your Grafana Enterprise Logs license, either by providing the
   * contents of the license.jwt, or the name Kubernetes Secret that contains your
   * license.jwt.
   * To set the license contents, use the flag `--set-file 'enterprise.license.contents=./license.jwt'`
   *
   * @default {"contents":"NOTAVALIDLICENSE"}
   */
  license?: LokiHelmValuesEnterpriseLicense;
  /**
   * Set to true when providing an external license
   *
   * @default false
   */
  useExternalLicense?: boolean;
  externalLicenseName?: unknown;
  /**
   * Name of the external config secret to use
   *
   * @default ""
   */
  externalConfigName?: string;
  /**
   * Use GEL gateway, if false will use the default nginx gateway
   *
   * @default true
   */
  gelGateway?: boolean;
  /**
   * If enabled, the correct admin_client storage will be configured. If disabled while running enterprise,
   * make sure auth is set to `type: trust`, or that `auth_enabled` is set to `false`.
   *
   * @default {"enabled":true}
   */
  adminApi?: LokiHelmValuesEnterpriseAdminApi;
  /**
   * enterprise specific sections of the config.yaml file
   *
   * @default "{{- if .Values.enterprise.adminApi.enabled }}
a..."
   */
  config?: string;
  /**
   * @default {...} (5 keys)
   */
  image?: LokiHelmValuesEnterpriseImage;
  /**
   * @default {"secret":null}
   */
  adminToken?: LokiHelmValuesEnterpriseAdminToken;
  canarySecret?: unknown;
  /**
   * Note: Uses enterprise.adminToken.secret value to mount the admin token used to call the admin api.
   *
   * @default {...} (17 keys)
   */
  provisioner?: LokiHelmValuesEnterpriseProvisioner;
};

export type LokiHelmValuesEnterpriseLicense = {
  /**
   * @default "NOTAVALIDLICENSE"
   */
  contents?: string;
};

export type LokiHelmValuesEnterpriseAdminApi = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type LokiHelmValuesEnterpriseImage = {
  /**
   * The Docker registry
   *
   * @default "docker.io"
   */
  registry?: string;
  /**
   * Docker image repository
   *
   * @default "grafana/enterprise-logs"
   */
  repository?: string;
  /**
   * Docker image tag
   *
   * @default "3.6.3"
   */
  tag?: string;
  digest?: unknown;
  /**
   * Docker image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type LokiHelmValuesEnterpriseAdminToken = {
  secret?: unknown;
};

export type LokiHelmValuesEnterpriseProvisioner = {
  /**
   * Whether the job should be part of the deployment
   *
   * @default true
   */
  enabled?: boolean;
  provisionedSecretPrefix?: unknown;
  /**
   * Hook type(s) to customize when the job runs.  defaults to post-install
   *
   * @default "post-install"
   */
  hookType?: string;
  /**
   * url of the admin api to use for the provisioner
   *
   * @default "{{ include "loki.address" . }}"
   */
  apiUrl?: string;
  additionalTenants?: unknown[];
  env?: unknown[];
  /**
   * Additional labels for the `provisioner` Job
   *
   * @default {}
   */
  labels?: LokiHelmValuesEnterpriseProvisionerLabels;
  /**
   * Additional annotations for the `provisioner` Job
   *
   * @default {}
   */
  annotations?: LokiHelmValuesEnterpriseProvisionerAnnotations;
  /**
   * Affinity for provisioner Pods
   * The value will be passed through tpl.
   *
   * @default {}
   */
  affinity?: LokiHelmValuesEnterpriseProvisionerAffinity;
  /**
   * Node selector for provisioner Pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesEnterpriseProvisionerNodeSelector;
  tolerations?: unknown[];
  priorityClassName?: unknown;
  /**
   * Use the host's user namespace in provisioner pods
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Run containers as user `enterprise-logs(uid=10001)`
   *
   * @default {...} (4 keys)
   */
  securityContext?: LokiHelmValuesEnterpriseProvisionerSecurityContext;
  /**
   * Provisioner image to Utilize
   *
   * @default {...} (5 keys)
   */
  image?: LokiHelmValuesEnterpriseProvisionerImage;
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
};

export type LokiHelmValuesEnterpriseProvisionerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesEnterpriseProvisionerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesEnterpriseProvisionerAffinity = object;

export type LokiHelmValuesEnterpriseProvisionerNodeSelector = object;

export type LokiHelmValuesEnterpriseProvisionerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 10001
   */
  runAsGroup?: number;
  /**
   * @default 10001
   */
  runAsUser?: number;
  /**
   * @default 10001
   */
  fsGroup?: number;
};

export type LokiHelmValuesEnterpriseProvisionerImage = {
  /**
   * The Docker registry
   *
   * @default "us-docker.pkg.dev"
   */
  registry?: string;
  /**
   * Docker image repository
   *
   * @default "grafanalabs-global/docker-enterprise-provisione..."
   */
  repository?: string;
  /**
   * Overrides the image tag whose default is the chart's appVersion
   *
   * @default "latest"
   */
  tag?: string;
  digest?: unknown;
  /**
   * Docker image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type LokiHelmValuesTest = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Used to directly query the metrics endpoint of the canary for testing, this approach avoids needing prometheus for testing.
   * This in a newer approach to using prometheusAddress such that tests do not have a dependency on prometheus
   *
   * @default "http://{{ include "loki-canary.fullname" $ }}.{..."
   */
  canaryServiceAddress?: string;
  /**
   * Address of the prometheus server to query for the test. This overrides any value set for canaryServiceAddress.
   * This is kept for backward compatibility and may be removed in future releases. Previous value was 'http://prometheus:9090'
   *
   * @default ""
   */
  prometheusAddress?: string;
  /**
   * Number of times to retry the test before failing
   *
   * @default "1m"
   */
  timeout?: string;
  /**
   * Additional labels for the test pods
   *
   * @default {}
   */
  labels?: LokiHelmValuesTestLabels;
  /**
   * Additional annotations for test pods
   *
   * @default {}
   */
  annotations?: LokiHelmValuesTestAnnotations;
  /**
   * Image to use for loki canary
   *
   * @default {...} (5 keys)
   */
  image?: LokiHelmValuesTestImage;
  /**
   * Use the host's user namespace in test pods
   *
   * @default "nil"
   */
  hostUsers?: string;
};

export type LokiHelmValuesTestLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesTestAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesTestImage = {
  /**
   * The Docker registry
   *
   * @default "docker.io"
   */
  registry?: string;
  /**
   * Docker image repository
   *
   * @default "grafana/loki-helm-test"
   */
  repository?: string;
  /**
   * Overrides the image tag whose default is the chart's appVersion
   *
   * @default "latest"
   */
  tag?: string;
  digest?: unknown;
  /**
   * Docker image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type LokiHelmValuesLokiCanary = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * The type of the loki canary k8s rollout. This can be a DaemonSet or Deployment.
   *
   * @default "DaemonSet"
   */
  kind?: string;
  /**
   * If true, the canary will send directly to Loki via the address configured for verification --
   * If false, it will write to stdout and an Agent will be needed to scrape and send the logs --
   *
   * @default true
   */
  push?: boolean;
  lokiurl?: unknown;
  /**
   * The name of the label to look for at loki when doing the checks.
   *
   * @default "pod"
   */
  labelname?: string;
  /**
   * Additional annotations for the `loki-canary` Daemonset
   *
   * @default {}
   */
  annotations?: LokiHelmValuesLokiCanaryAnnotations;
  /**
   * Additional labels for each `loki-canary` pod
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesLokiCanaryPodLabels;
  /**
   * @default {"annotations":{},"labels":{}}
   */
  service?: LokiHelmValuesLokiCanaryService;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the canary
   *
   * @default {}
   */
  resources?: LokiHelmValuesLokiCanaryResources;
  /**
   * DNS config for canary pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesLokiCanaryDnsConfig;
  /**
   * Node selector for canary pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesLokiCanaryNodeSelector;
  tolerations?: unknown[];
  /**
   * Affinity for canary pods
   *
   * @default {}
   */
  affinity?: LokiHelmValuesLokiCanaryAffinity;
  priorityClassName?: unknown;
  /**
   * Use the host's user namespace in loki-canary pods
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Image to use for loki canary
   *
   * @default {...} (5 keys)
   */
  image?: LokiHelmValuesLokiCanaryImage;
  livenessProbe?: unknown;
  /**
   * @default {"httpGet":{"path":"/metrics","port":"http-metrics"},"initialDelaySeconds":15,"timeoutSeconds":1}
   */
  readinessProbe?: LokiHelmValuesLokiCanaryReadinessProbe;
  startupProbe?: unknown;
  /**
   * @default {"type":"RollingUpdate","rollingUpdate":{"maxUnavailable":1}}
   */
  updateStrategy?: LokiHelmValuesLokiCanaryUpdateStrategy;
  /**
   * Replicas for `loki-canary` when using a Deployment
   *
   * @default 1
   */
  replicas?: number;
};

export type LokiHelmValuesLokiCanaryAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesLokiCanaryPodLabels = object;

export type LokiHelmValuesLokiCanaryService = {
  /**
   * Annotations for loki-canary Service
   *
   * @default {}
   */
  annotations?: LokiHelmValuesLokiCanaryServiceAnnotations;
  /**
   * Additional labels for loki-canary Service
   *
   * @default {}
   */
  labels?: LokiHelmValuesLokiCanaryServiceLabels;
};

export type LokiHelmValuesLokiCanaryServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesLokiCanaryServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesLokiCanaryResources = object;

export type LokiHelmValuesLokiCanaryDnsConfig = object;

export type LokiHelmValuesLokiCanaryNodeSelector = object;

export type LokiHelmValuesLokiCanaryAffinity = object;

export type LokiHelmValuesLokiCanaryImage = {
  /**
   * The Docker registry
   *
   * @default "docker.io"
   */
  registry?: string;
  /**
   * Docker image repository
   *
   * @default "grafana/loki-canary"
   */
  repository?: string;
  tag?: unknown;
  digest?: unknown;
  /**
   * Docker image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type LokiHelmValuesLokiCanaryReadinessProbe = {
  /**
   * @default {"path":"/metrics","port":"http-metrics"}
   */
  httpGet?: LokiHelmValuesLokiCanaryReadinessProbeHttpGet;
  /**
   * @default 15
   */
  initialDelaySeconds?: number;
  /**
   * @default 1
   */
  timeoutSeconds?: number;
};

export type LokiHelmValuesLokiCanaryReadinessProbeHttpGet = {
  /**
   * @default "/metrics"
   */
  path?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
};

export type LokiHelmValuesLokiCanaryUpdateStrategy = {
  /**
   * @default "RollingUpdate"
   */
  type?: string;
  /**
   * @default {"maxUnavailable":1}
   */
  rollingUpdate?: LokiHelmValuesLokiCanaryUpdateStrategyRollingUpdate;
};

export type LokiHelmValuesLokiCanaryUpdateStrategyRollingUpdate = {
  /**
   * @default 1
   */
  maxUnavailable?: number;
};

export type LokiHelmValuesServiceAccount = {
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
  annotations?: LokiHelmValuesServiceAccountAnnotations;
  /**
   * Labels for the service account
   *
   * @default {}
   */
  labels?: LokiHelmValuesServiceAccountLabels;
  /**
   * Set this toggle to false to opt out of automounting API credentials for the service account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type LokiHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesServiceAccountLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesRbac = {
  /**
   * If pspEnabled true, a PodSecurityPolicy is created for K8s that use psp.
   *
   * @default false
   */
  pspEnabled?: boolean;
  /**
   * For OpenShift set pspEnabled to 'false' and sccEnabled to 'true' to use the SecurityContextConstraints.
   *
   * @default false
   */
  sccEnabled?: boolean;
  /**
   * Toggle this to true to allow the use of hostPath volumes on OpenShift
   *
   * @default false
   */
  sccAllowHostDirVolumePlugin?: boolean;
  /**
   * Specify PSP annotations
   * Ref: https://kubernetes.io/docs/reference/access-authn-authz/psp-to-pod-security-standards/#podsecuritypolicy-annotations
   *
   * @default {}
   */
  pspAnnotations?: LokiHelmValuesRbacPspAnnotations;
  /**
   * seccomp.security.alpha.kubernetes.io/allowedProfileNames: '*'
   * seccomp.security.alpha.kubernetes.io/defaultProfileName: 'docker/default'
   * apparmor.security.beta.kubernetes.io/defaultProfileName: 'runtime/default'
   * Whether to install RBAC in the namespace only or cluster-wide. Useful if you want to watch ConfigMap globally.
   *
   * @default false
   */
  namespaced?: boolean;
};

export type LokiHelmValuesRbacPspAnnotations = object;

export type LokiHelmValuesNetworkPolicy = {
  /**
   * Specifies whether Network Policies should be created
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Specifies whether the policies created will be standard Network Policies (flavor: kubernetes)
   * or Cilium Network Policies (flavor: cilium)
   *
   * @default "kubernetes"
   */
  flavor?: string;
  /**
   * @default {"podSelector":{},"namespaceSelector":{},"cidrs":[]}
   */
  metrics?: LokiHelmValuesNetworkPolicyMetrics;
  /**
   * @default {"podSelector":{},"namespaceSelector":{}}
   */
  ingress?: LokiHelmValuesNetworkPolicyIngress;
  /**
   * @default {"port":9093,"podSelector":{},"namespaceSelector":{}}
   */
  alertmanager?: LokiHelmValuesNetworkPolicyAlertmanager;
  /**
   * @default {"ports":[],"cidrs":[]}
   */
  externalStorage?: LokiHelmValuesNetworkPolicyExternalStorage;
  /**
   * @default {"port":null,"podSelector":{},"namespaceSelector":{}}
   */
  discovery?: LokiHelmValuesNetworkPolicyDiscovery;
  /**
   * @default {"enabled":false}
   */
  egressWorld?: LokiHelmValuesNetworkPolicyEgressWorld;
  /**
   * @default {"enabled":false}
   */
  egressKubeApiserver?: LokiHelmValuesNetworkPolicyEgressKubeApiserver;
};

export type LokiHelmValuesNetworkPolicyMetrics = {
  /**
   * Specifies the Pods which are allowed to access the metrics port.
   * As this is cross-namespace communication, you also need the namespaceSelector.
   *
   * @default {}
   */
  podSelector?: LokiHelmValuesNetworkPolicyMetricsPodSelector;
  /**
   * Specifies the namespaces which are allowed to access the metrics port
   *
   * @default {}
   */
  namespaceSelector?: LokiHelmValuesNetworkPolicyMetricsNamespaceSelector;
  cidrs?: unknown[];
};

export type LokiHelmValuesNetworkPolicyMetricsPodSelector = object;

export type LokiHelmValuesNetworkPolicyMetricsNamespaceSelector = object;

export type LokiHelmValuesNetworkPolicyIngress = {
  /**
   * Specifies the Pods which are allowed to access the http port.
   * As this is cross-namespace communication, you also need the namespaceSelector.
   *
   * @default {}
   */
  podSelector?: LokiHelmValuesNetworkPolicyIngressPodSelector;
  /**
   * Specifies the namespaces which are allowed to access the http port
   *
   * @default {}
   */
  namespaceSelector?: LokiHelmValuesNetworkPolicyIngressNamespaceSelector;
};

export type LokiHelmValuesNetworkPolicyIngressPodSelector = object;

export type LokiHelmValuesNetworkPolicyIngressNamespaceSelector = object;

export type LokiHelmValuesNetworkPolicyAlertmanager = {
  /**
   * Specify the alertmanager port used for alerting
   *
   * @default 9093
   */
  port?: number;
  /**
   * Specifies the alertmanager Pods.
   * As this is cross-namespace communication, you also need the namespaceSelector.
   *
   * @default {}
   */
  podSelector?: LokiHelmValuesNetworkPolicyAlertmanagerPodSelector;
  /**
   * Specifies the namespace the alertmanager is running in
   *
   * @default {}
   */
  namespaceSelector?: LokiHelmValuesNetworkPolicyAlertmanagerNamespaceSelector;
};

export type LokiHelmValuesNetworkPolicyAlertmanagerPodSelector = object;

export type LokiHelmValuesNetworkPolicyAlertmanagerNamespaceSelector = object;

export type LokiHelmValuesNetworkPolicyExternalStorage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  ports?: unknown[];
  cidrs?: unknown[];
};

export type LokiHelmValuesNetworkPolicyDiscovery = {
  port?: unknown;
  /**
   * Specifies the Pods labels used for discovery.
   * As this is cross-namespace communication, you also need the namespaceSelector.
   *
   * @default {}
   */
  podSelector?: LokiHelmValuesNetworkPolicyDiscoveryPodSelector;
  /**
   * Specifies the namespace the discovery Pods are running in
   *
   * @default {}
   */
  namespaceSelector?: LokiHelmValuesNetworkPolicyDiscoveryNamespaceSelector;
};

export type LokiHelmValuesNetworkPolicyDiscoveryPodSelector = object;

export type LokiHelmValuesNetworkPolicyDiscoveryNamespaceSelector = object;

export type LokiHelmValuesNetworkPolicyEgressWorld = {
  /**
   * Enable additional cilium egress rules to external world for write, read and backend.
   *
   * @default false
   */
  enabled?: boolean;
};

export type LokiHelmValuesNetworkPolicyEgressKubeApiserver = {
  /**
   * Enable additional cilium egress rules to kube-apiserver for backend.
   *
   * @default false
   */
  enabled?: boolean;
};

export type LokiHelmValuesMemberlist = {
  /**
   * @default {"publishNotReadyAddresses":false,"annotations":{}}
   */
  service?: LokiHelmValuesMemberlistService;
};

export type LokiHelmValuesMemberlistService = {
  /**
   * @default false
   */
  publishNotReadyAddresses?: boolean;
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesMemberlistServiceAnnotations;
};

export type LokiHelmValuesMemberlistServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesAdminApi = {
  /**
   * Define the amount of instances
   *
   * @default 1
   */
  replicas?: number;
  hostAliases?: unknown[];
  /**
   * Additional CLI arguments for the `admin-api` target
   *
   * @default {}
   */
  extraArgs?: LokiHelmValuesAdminApiExtraArgs;
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  /**
   * Additional labels for the `admin-api` Deployment
   *
   * @default {}
   */
  labels?: LokiHelmValuesAdminApiLabels;
  /**
   * Additional annotations for the `admin-api` Deployment
   *
   * @default {}
   */
  annotations?: LokiHelmValuesAdminApiAnnotations;
  /**
   * DNSConfig for `admin-api` pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesAdminApiDnsConfig;
  /**
   * Additional labels and annotations for the `admin-api` Service
   *
   * @default {"labels":{},"annotations":{}}
   */
  service?: LokiHelmValuesAdminApiService;
  /**
   * Run container as user `enterprise-logs(uid=10001)`
   * `fsGroup` must not be specified, because these security options are applied
   * on container level not on Pod level.
   *
   * @default {"runAsNonRoot":true,"runAsGroup":10001,"runAsUser":10001}
   */
  podSecurityContext?: LokiHelmValuesAdminApiPodSecurityContext;
  /**
   * @default {"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}
   */
  containerSecurityContext?: LokiHelmValuesAdminApiContainerSecurityContext;
  /**
   * Update strategy
   *
   * @default {"type":"RollingUpdate"}
   */
  strategy?: LokiHelmValuesAdminApiStrategy;
  /**
   * Liveness probe
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesAdminApiLivenessProbe;
  /**
   * Readiness probe
   *
   * @default {"httpGet":{"path":"/ready","port":"http-metrics"},"initialDelaySeconds":45}
   */
  readinessProbe?: LokiHelmValuesAdminApiReadinessProbe;
  /**
   * Startup probe
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesAdminApiStartupProbe;
  /**
   * Request and limit Kubernetes resources
   * Values are defined in small.yaml and large.yaml
   *
   * @default {}
   */
  resources?: LokiHelmValuesAdminApiResources;
  env?: unknown[];
  initContainers?: unknown[];
  extraContainers?: unknown[];
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  /**
   * Affinity for admin-api Pods
   * The value will be passed through tpl.
   *
   * @default {}
   */
  affinity?: LokiHelmValuesAdminApiAffinity;
  /**
   * Node selector for admin-api Pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesAdminApiNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Grace period to allow the admin-api to shutdown before it is killed
   *
   * @default 60
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Use the host's user namespace in admin-api pods
   *
   * @default "nil"
   */
  hostUsers?: string;
};

export type LokiHelmValuesAdminApiExtraArgs = object;

export type LokiHelmValuesAdminApiLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesAdminApiAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesAdminApiDnsConfig = object;

export type LokiHelmValuesAdminApiService = {
  /**
   * @default {}
   */
  labels?: LokiHelmValuesAdminApiServiceLabels;
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesAdminApiServiceAnnotations;
};

export type LokiHelmValuesAdminApiServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesAdminApiServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesAdminApiPodSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 10001
   */
  runAsGroup?: number;
  /**
   * @default 10001
   */
  runAsUser?: number;
};

export type LokiHelmValuesAdminApiContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: LokiHelmValuesAdminApiContainerSecurityContextCapabilities;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type LokiHelmValuesAdminApiContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type LokiHelmValuesAdminApiStrategy = {
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type LokiHelmValuesAdminApiLivenessProbe = object;

export type LokiHelmValuesAdminApiReadinessProbe = {
  /**
   * @default {"path":"/ready","port":"http-metrics"}
   */
  httpGet?: LokiHelmValuesAdminApiReadinessProbeHttpGet;
  /**
   * @default 45
   */
  initialDelaySeconds?: number;
};

export type LokiHelmValuesAdminApiReadinessProbeHttpGet = {
  /**
   * @default "/ready"
   */
  path?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
};

export type LokiHelmValuesAdminApiStartupProbe = object;

export type LokiHelmValuesAdminApiResources = object;

export type LokiHelmValuesAdminApiAffinity = object;

export type LokiHelmValuesAdminApiNodeSelector = object;

export type LokiHelmValuesGateway = {
  /**
   * Specifies whether the gateway should be enabled
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Number of replicas for the gateway
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Default container port
   *
   * @default 8080
   */
  containerPort?: number;
  /**
   * Enable logging of 2xx and 3xx HTTP requests
   *
   * @default true
   */
  verboseLogging?: boolean;
  /**
   * @default {...} (6 keys)
   */
  autoscaling?: LokiHelmValuesGatewayAutoscaling;
  /**
   * @default {"type":"RollingUpdate"}
   */
  deploymentStrategy?: LokiHelmValuesGatewayDeploymentStrategy;
  /**
   * @default {...} (5 keys)
   */
  image?: LokiHelmValuesGatewayImage;
  priorityClassName?: unknown;
  /**
   * Annotations for gateway deployment
   *
   * @default {}
   */
  annotations?: LokiHelmValuesGatewayAnnotations;
  /**
   * Annotations for gateway pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesGatewayPodAnnotations;
  /**
   * Additional labels for gateway pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesGatewayPodLabels;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  /**
   * Lifecycle for the gateway container
   *
   * @default {}
   */
  lifecycle?: LokiHelmValuesGatewayLifecycle;
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  /**
   * The SecurityContext for gateway containers
   *
   * @default {...} (4 keys)
   */
  podSecurityContext?: LokiHelmValuesGatewayPodSecurityContext;
  /**
   * The SecurityContext for gateway containers
   *
   * @default {"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}
   */
  containerSecurityContext?: LokiHelmValuesGatewayContainerSecurityContext;
  /**
   * Use the host's user namespace in the gateway
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Resource requests and limits for the gateway
   *
   * @default {}
   */
  resources?: LokiHelmValuesGatewayResources;
  extraContainers?: unknown[];
  /**
   * Grace period to allow the gateway to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Affinity for gateway pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesGatewayAffinity;
  /**
   * DNS config for gateway pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesGatewayDnsConfig;
  /**
   * Node selector for gateway pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesGatewayNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Gateway service configuration
   *
   * @default {...} (8 keys)
   */
  service?: LokiHelmValuesGatewayService;
  /**
   * Gateway ingress configuration
   *
   * @default {...} (6 keys)
   */
  ingress?: LokiHelmValuesGatewayIngress;
  /**
   * Basic auth configuration
   *
   * @default {...} (5 keys)
   */
  basicAuth?: LokiHelmValuesGatewayBasicAuth;
  /**
   * liveness probe for the nginx container in the gateway pods.
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesGatewayLivenessProbe;
  /**
   * Configures the readiness probe for the gateway
   *
   * @default {"httpGet":{"path":"/","port":"http-metrics"},"initialDelaySeconds":15,"timeoutSeconds":1}
   */
  readinessProbe?: LokiHelmValuesGatewayReadinessProbe;
  /**
   * startup probe for the nginx container in the gateway pods.
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesGatewayStartupProbe;
  /**
   * @default {...} (13 keys)
   */
  nginxConfig?: LokiHelmValuesGatewayNginxConfig;
};

export type LokiHelmValuesGatewayAutoscaling = {
  /**
   * Enable autoscaling for the gateway
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum autoscaling replicas for the gateway
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum autoscaling replicas for the gateway
   *
   * @default 3
   */
  maxReplicas?: number;
  /**
   * Target CPU utilisation percentage for the gateway
   *
   * @default 60
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy
   * Behavior policies while scaling.
   *
   * @default {}
   */
  behavior?: LokiHelmValuesGatewayAutoscalingBehavior;
};

export type LokiHelmValuesGatewayAutoscalingBehavior = object;

export type LokiHelmValuesGatewayDeploymentStrategy = {
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type LokiHelmValuesGatewayImage = {
  /**
   * The Docker registry for the gateway image
   *
   * @default "docker.io"
   */
  registry?: string;
  /**
   * The gateway image repository
   *
   * @default "nginxinc/nginx-unprivileged"
   */
  repository?: string;
  /**
   * The gateway image tag
   *
   * @default "1.29-alpine"
   */
  tag?: string;
  digest?: unknown;
  /**
   * The gateway image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type LokiHelmValuesGatewayAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesGatewayPodAnnotations = object;

export type LokiHelmValuesGatewayPodLabels = object;

export type LokiHelmValuesGatewayLifecycle = object;

export type LokiHelmValuesGatewayPodSecurityContext = {
  /**
   * @default 101
   */
  fsGroup?: number;
  /**
   * @default 101
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 101
   */
  runAsUser?: number;
};

export type LokiHelmValuesGatewayContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: LokiHelmValuesGatewayContainerSecurityContextCapabilities;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type LokiHelmValuesGatewayContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type LokiHelmValuesGatewayResources = object;

export type LokiHelmValuesGatewayAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesGatewayAffinityPodAntiAffinity;
};

export type LokiHelmValuesGatewayAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector = {
  /**
   * @default {"app.kubernetes.io/component":"gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
   */
  matchLabels?: LokiHelmValuesGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
};

export type LokiHelmValuesGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "gateway"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesGatewayDnsConfig = object;

export type LokiHelmValuesGatewayNodeSelector = object;

export type LokiHelmValuesGatewayService = {
  /**
   * Port of the gateway service
   *
   * @default 80
   */
  port?: number;
  /**
   * Type of the gateway service
   *
   * @default "ClusterIP"
   */
  type?: string;
  clusterIP?: unknown;
  nodePort?: unknown;
  loadBalancerIP?: unknown;
  /**
   * Annotations for the gateway service
   *
   * @default {}
   */
  annotations?: LokiHelmValuesGatewayServiceAnnotations;
  /**
   * Labels for gateway service
   *
   * @default {}
   */
  labels?: LokiHelmValuesGatewayServiceLabels;
  /**
   * trafficDistribution for gateway service
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type LokiHelmValuesGatewayServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesGatewayServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesGatewayIngress = {
  /**
   * Specifies whether an ingress for the gateway should be created
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Ingress Class Name. MAY be required for Kubernetes versions >= 1.18
   *
   * @default ""
   */
  ingressClassName?: string;
  /**
   * Annotations for the gateway ingress
   *
   * @default {}
   */
  annotations?: LokiHelmValuesGatewayIngressAnnotations;
  /**
   * Labels for the gateway ingress
   *
   * @default {}
   */
  labels?: LokiHelmValuesGatewayIngressLabels;
  hosts?: LokiHelmValuesGatewayIngressHostsElement[];
  tls?: LokiHelmValuesGatewayIngressTlsElement[];
};

export type LokiHelmValuesGatewayIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesGatewayIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesGatewayIngressHostsElement = {
  /**
   * @default "gateway.loki.example.com"
   */
  host?: string;
  paths?: LokiHelmValuesGatewayIngressHostsPathsElement[];
};

export type LokiHelmValuesGatewayIngressHostsPathsElement = {
  /**
   * @default "/"
   */
  path?: string;
};

export type LokiHelmValuesGatewayIngressTlsElement = {
  /**
   * @default "loki-gateway-tls"
   */
  secretName?: string;
  hosts?: string[];
};

export type LokiHelmValuesGatewayBasicAuth = {
  /**
   * Enables basic authentication for the gateway
   *
   * @default false
   */
  enabled?: boolean;
  username?: unknown;
  password?: unknown;
  /**
   * Uses the specified users from the `loki.tenants` list to create the htpasswd file.
   * if `loki.tenants` is not set, the `gateway.basicAuth.username` and `gateway.basicAuth.password` are used.
   * The value is templated using `tpl`. Override this to use a custom htpasswd, e.g. in case the default causes
   * high CPU load.
   *
   * @default "{{- with $tenants := .Values.loki.tenants }}
  ..."
   */
  htpasswd?: string;
  existingSecret?: unknown;
};

export type LokiHelmValuesGatewayLivenessProbe = object;

export type LokiHelmValuesGatewayReadinessProbe = {
  /**
   * @default {"path":"/","port":"http-metrics"}
   */
  httpGet?: LokiHelmValuesGatewayReadinessProbeHttpGet;
  /**
   * @default 15
   */
  initialDelaySeconds?: number;
  /**
   * @default 1
   */
  timeoutSeconds?: number;
};

export type LokiHelmValuesGatewayReadinessProbeHttpGet = {
  /**
   * @default "/"
   */
  path?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
};

export type LokiHelmValuesGatewayStartupProbe = object;

export type LokiHelmValuesGatewayNginxConfig = {
  /**
   * Which schema to be used when building URLs. Can be 'http' or 'https'.
   *
   * @default "http"
   */
  schema?: string;
  /**
   * Enable listener for IPv6, disable on IPv4-only systems
   *
   * @default true
   */
  enableIPv6?: boolean;
  /**
   * NGINX log format
   *
   * @default "main '$remote_addr - $remote_user [$time_local]..."
   */
  logFormat?: string;
  /**
   * Allows appending custom configuration to the server block
   *
   * @default ""
   */
  serverSnippet?: string;
  /**
   * Allows appending custom configuration to the http block, passed through the `tpl` function to allow templating
   *
   * @default ""
   */
  httpSnippet?: string;
  /**
   * Allows appending custom configuration inside every location block, useful for authentication or setting headers that are not inherited from the server block, passed through the `tpl` function to allow templating.
   *
   * @default "{{ if .Values.loki.tenants }}proxy_set_header X..."
   */
  locationSnippet?: string;
  /**
   * Allows customizing the `client_max_body_size` directive
   *
   * @default "4M"
   */
  clientMaxBodySize?: string;
  /**
   * Whether ssl should be appended to the listen directive of the server block or not.
   *
   * @default false
   */
  ssl?: boolean;
  customReadUrl?: unknown;
  customWriteUrl?: unknown;
  customBackendUrl?: unknown;
  /**
   * Allows overriding the DNS resolver address nginx will use.
   *
   * @default ""
   */
  resolver?: string;
  /**
   * Config file contents for Nginx. Passed through the `tpl` function to allow templating
   *
   * @default "{{- include "loki.nginxFile" . -}}
"
   */
  file?: string;
};

export type LokiHelmValuesEnterpriseGateway = {
  /**
   * Define the amount of instances
   *
   * @default 1
   */
  replicas?: number;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the `gateway` pod
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Additional CLI arguments for the `gateway` target
   *
   * @default {}
   */
  extraArgs?: LokiHelmValuesEnterpriseGatewayExtraArgs;
  extraEnvFrom?: unknown[];
  /**
   * Additional labels for the `gateway` Pod
   *
   * @default {}
   */
  labels?: LokiHelmValuesEnterpriseGatewayLabels;
  /**
   * Additional annotations for the `gateway` Pod
   *
   * @default {}
   */
  annotations?: LokiHelmValuesEnterpriseGatewayAnnotations;
  /**
   * Additional labels and annotations for the `gateway` Service
   * Service overriding service type
   *
   * @default {"type":"ClusterIP","labels":{},"annotations":{}}
   */
  service?: LokiHelmValuesEnterpriseGatewayService;
  /**
   * Run container as user `enterprise-logs(uid=10001)`
   *
   * @default {...} (4 keys)
   */
  podSecurityContext?: LokiHelmValuesEnterpriseGatewayPodSecurityContext;
  /**
   * @default {"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}
   */
  containerSecurityContext?: LokiHelmValuesEnterpriseGatewayContainerSecurityContext;
  /**
   * If you want to use your own proxy URLs, set this to false.
   *
   * @default true
   */
  useDefaultProxyURLs?: boolean;
  /**
   * update strategy
   *
   * @default {"type":"RollingUpdate"}
   */
  strategy?: LokiHelmValuesEnterpriseGatewayStrategy;
  /**
   * Liveness probe
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesEnterpriseGatewayLivenessProbe;
  /**
   * Readiness probe
   *
   * @default {"httpGet":{"path":"/ready","port":"http-metrics"},"initialDelaySeconds":45}
   */
  readinessProbe?: LokiHelmValuesEnterpriseGatewayReadinessProbe;
  /**
   * Startup probe
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesEnterpriseGatewayStartupProbe;
  /**
   * Request and limit Kubernetes resources
   * Values are defined in small.yaml and large.yaml
   *
   * @default {}
   */
  resources?: LokiHelmValuesEnterpriseGatewayResources;
  env?: unknown[];
  initContainers?: unknown[];
  extraContainers?: unknown[];
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  /**
   * Affinity for gateway Pods
   * The value will be passed through tpl.
   *
   * @default {}
   */
  affinity?: LokiHelmValuesEnterpriseGatewayAffinity;
  /**
   * Node selector for gateway Pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesEnterpriseGatewayNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Grace period to allow the gateway to shutdown before it is killed
   *
   * @default 60
   */
  terminationGracePeriodSeconds?: number;
};

export type LokiHelmValuesEnterpriseGatewayExtraArgs = object;

export type LokiHelmValuesEnterpriseGatewayLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesEnterpriseGatewayAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesEnterpriseGatewayService = {
  /**
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {}
   */
  labels?: LokiHelmValuesEnterpriseGatewayServiceLabels;
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesEnterpriseGatewayServiceAnnotations;
};

export type LokiHelmValuesEnterpriseGatewayServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesEnterpriseGatewayServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesEnterpriseGatewayPodSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 10001
   */
  runAsGroup?: number;
  /**
   * @default 10001
   */
  runAsUser?: number;
  /**
   * @default 10001
   */
  fsGroup?: number;
};

export type LokiHelmValuesEnterpriseGatewayContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: LokiHelmValuesEnterpriseGatewayContainerSecurityContextCapabilities;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type LokiHelmValuesEnterpriseGatewayContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type LokiHelmValuesEnterpriseGatewayStrategy = {
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type LokiHelmValuesEnterpriseGatewayLivenessProbe = object;

export type LokiHelmValuesEnterpriseGatewayReadinessProbe = {
  /**
   * @default {"path":"/ready","port":"http-metrics"}
   */
  httpGet?: LokiHelmValuesEnterpriseGatewayReadinessProbeHttpGet;
  /**
   * @default 45
   */
  initialDelaySeconds?: number;
};

export type LokiHelmValuesEnterpriseGatewayReadinessProbeHttpGet = {
  /**
   * @default "/ready"
   */
  path?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
};

export type LokiHelmValuesEnterpriseGatewayStartupProbe = object;

export type LokiHelmValuesEnterpriseGatewayResources = object;

export type LokiHelmValuesEnterpriseGatewayAffinity = object;

export type LokiHelmValuesEnterpriseGatewayNodeSelector = object;

export type LokiHelmValuesIngress = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  ingressClassName?: string;
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesIngressAnnotations;
  /**
   * nginx.ingress.kubernetes.io/auth-type: basic
   * nginx.ingress.kubernetes.io/auth-secret: loki-distributed-basic-auth
   * nginx.ingress.kubernetes.io/auth-secret-type: auth-map
   * nginx.ingress.kubernetes.io/configuration-snippet: |
   * proxy_set_header X-Scope-OrgID $remote_user;
   *
   * @default {}
   */
  labels?: LokiHelmValuesIngressLabels;
  /**
   * @default {...} (4 keys)
   */
  paths?: LokiHelmValuesIngressPaths;
  hosts?: string[];
  tls?: unknown[];
};

export type LokiHelmValuesIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesIngressPaths = {
  distributor?: string[];
  queryFrontend?: string[];
  ruler?: string[];
  compactor?: string[];
};

export type LokiHelmValuesMigrate = {
  /**
   * When migrating from a distributed chart like loki-distributed or enterprise-logs
   *
   * @default {"enabled":false,"memberlistService":""}
   */
  fromDistributed?: LokiHelmValuesMigrateFromDistributed;
};

export type LokiHelmValuesMigrateFromDistributed = {
  /**
   * Set to true if migrating from a distributed helm chart
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * If migrating from a distributed service, provide the distributed deployment's
   * memberlist service DNS so the new deployment can join its ring.
   *
   * @default ""
   */
  memberlistService?: string;
};

export type LokiHelmValuesSingleBinary = {
  /**
   * Number of replicas for the single binary
   *
   * @default 0
   */
  replicas?: number;
  /**
   * @default {...} (5 keys)
   */
  autoscaling?: LokiHelmValuesSingleBinaryAutoscaling;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesSingleBinaryImage;
  priorityClassName?: unknown;
  /**
   * Annotations for single binary StatefulSet
   *
   * @default {}
   */
  annotations?: LokiHelmValuesSingleBinaryAnnotations;
  /**
   * Annotations for single binary pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesSingleBinaryPodAnnotations;
  /**
   * Additional labels for each `single binary` pod
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesSingleBinaryPodLabels;
  /**
   * Additional selector labels for each `single binary` pod
   *
   * @default {}
   */
  selectorLabels?: LokiHelmValuesSingleBinarySelectorLabels;
  /**
   * @default {...} (4 keys)
   */
  service?: LokiHelmValuesSingleBinaryService;
  /**
   * Comma-separated list of Loki modules to load for the single binary
   *
   * @default "all"
   */
  targetModule?: string;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraContainers?: unknown[];
  initContainers?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the single binary
   *
   * @default {}
   */
  resources?: LokiHelmValuesSingleBinaryResources;
  /**
   * Grace period to allow the single binary to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Use the host's user namespace in the single binary pods
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Affinity for single binary pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"single-binary","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesSingleBinaryAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * DNS config for single binary pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesSingleBinaryDnsConfig;
  /**
   * Node selector for single binary pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesSingleBinaryNodeSelector;
  tolerations?: unknown[];
  /**
   * @default {...} (11 keys)
   */
  persistence?: LokiHelmValuesSingleBinaryPersistence;
};

export type LokiHelmValuesSingleBinaryAutoscaling = {
  /**
   * Enable autoscaling
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum autoscaling replicas for the single binary
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum autoscaling replicas for the single binary
   *
   * @default 3
   */
  maxReplicas?: number;
  /**
   * Target CPU utilisation percentage for the single binary
   *
   * @default 60
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
};

export type LokiHelmValuesSingleBinaryImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesSingleBinaryAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesSingleBinaryPodAnnotations = object;

export type LokiHelmValuesSingleBinaryPodLabels = object;

export type LokiHelmValuesSingleBinarySelectorLabels = object;

export type LokiHelmValuesSingleBinaryService = {
  /**
   * Annotations for single binary Service
   *
   * @default {}
   */
  annotations?: LokiHelmValuesSingleBinaryServiceAnnotations;
  /**
   * Additional labels for single binary Service
   *
   * @default {}
   */
  labels?: LokiHelmValuesSingleBinaryServiceLabels;
  /**
   * Service Type for single binary Service
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * trafficDistribution single binary Service
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type LokiHelmValuesSingleBinaryServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesSingleBinaryServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesSingleBinaryResources = object;

export type LokiHelmValuesSingleBinaryAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"single-binary","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesSingleBinaryAffinityPodAntiAffinity;
};

export type LokiHelmValuesSingleBinaryAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesSingleBinaryAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesSingleBinaryAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"single-binary","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesSingleBinaryAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesSingleBinaryAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"single-binary","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesSingleBinaryAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesSingleBinaryAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "single-binary"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesSingleBinaryDnsConfig = object;

export type LokiHelmValuesSingleBinaryNodeSelector = object;

export type LokiHelmValuesSingleBinaryPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * What to do with the volume when the StatefulSet is scaled down.
   *
   * @default "Delete"
   */
  whenScaled?: string;
  /**
   * What to do with the volumes when the StatefulSet is deleted.
   *
   * @default "Delete"
   */
  whenDeleted?: string;
  /**
   * Enable StatefulSetAutoDeletePVC feature
   *
   * @default true
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  /**
   * Enable StatefulSetRecreation for changes to PVC size.
   * This means that the StatefulSet will be deleted, recreated (with the same name) and rolled when a change to the
   * PVC size is detected. That way the PVC can be resized without manual intervention.
   *
   * @default false
   */
  enableStatefulSetRecreationForSizeChange?: boolean;
  /**
   * Enable persistent disk
   *
   * @default true
   */
  enabled?: boolean;
  accessModes?: string[];
  /**
   * Size of persistent disk
   *
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  selector?: unknown;
  /**
   * Annotations for volume claim
   *
   * @default {}
   */
  annotations?: LokiHelmValuesSingleBinaryPersistenceAnnotations;
  /**
   * Labels for volume claim
   *
   * @default {}
   */
  labels?: LokiHelmValuesSingleBinaryPersistenceLabels;
};

export type LokiHelmValuesSingleBinaryPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesSingleBinaryPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesWrite = {
  /**
   * Number of replicas for the write
   *
   * @default 3
   */
  replicas?: number;
  /**
   * @default {...} (6 keys)
   */
  autoscaling?: LokiHelmValuesWriteAutoscaling;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesWriteImage;
  priorityClassName?: unknown;
  /**
   * Annotations for write StatefulSet
   *
   * @default {}
   */
  annotations?: LokiHelmValuesWriteAnnotations;
  /**
   * Annotations for write pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesWritePodAnnotations;
  /**
   * Additional labels for each `write` pod
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesWritePodLabels;
  /**
   * Additional selector labels for each `write` pod
   *
   * @default {}
   */
  selectorLabels?: LokiHelmValuesWriteSelectorLabels;
  /**
   * @default {...} (4 keys)
   */
  service?: LokiHelmValuesWriteService;
  /**
   * Comma-separated list of Loki modules to load for the write
   *
   * @default "write"
   */
  targetModule?: string;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  /**
   * Lifecycle for the write container
   *
   * @default {}
   */
  lifecycle?: LokiHelmValuesWriteLifecycle;
  initContainers?: unknown[];
  extraContainers?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  extraVolumeClaimTemplates?: unknown[];
  /**
   * Resource requests and limits for the write
   *
   * @default {}
   */
  resources?: LokiHelmValuesWriteResources;
  /**
   * Grace period to allow the write to shutdown before it is killed. Especially for the ingester,
   * this must be increased. It must be long enough so writes can be gracefully shutdown flushing/transferring
   * all data and to successfully leave the member ring on shutdown.
   *
   * @default 300
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Use the host's user namespace in the write pods.
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Affinity for write pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"write","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesWriteAffinity;
  /**
   * DNS config for write pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesWriteDnsConfig;
  /**
   * Node selector for write pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesWriteNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * The default is to deploy all pods in parallel.
   *
   * @default "Parallel"
   */
  podManagementPolicy?: string;
  /**
   * @default {...} (10 keys)
   */
  persistence?: LokiHelmValuesWritePersistence;
};

export type LokiHelmValuesWriteAutoscaling = {
  /**
   * Enable autoscaling for the write.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum autoscaling replicas for the write.
   *
   * @default 2
   */
  minReplicas?: number;
  /**
   * Maximum autoscaling replicas for the write.
   *
   * @default 6
   */
  maxReplicas?: number;
  /**
   * Target CPU utilisation percentage for the write.
   *
   * @default 60
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
  /**
   * @default {"scaleUp":{"policies":[{"type":"Pods","value":1,"periodSeconds":900}]},"scaleDown":{"policies":[{"type":"Pods","value":1,"periodSeconds":1800}],"stabilizationWindowSeconds":3600}}
   */
  behavior?: LokiHelmValuesWriteAutoscalingBehavior;
};

export type LokiHelmValuesWriteAutoscalingBehavior = {
  /**
   * see https://github.com/grafana/loki/blob/main/docs/sources/operations/storage/wal.md#how-to-scale-updown for scaledown details
   *
   * @default {"policies":[{"type":"Pods","value":1,"periodSeconds":900}]}
   */
  scaleUp?: LokiHelmValuesWriteAutoscalingBehaviorScaleUp;
  /**
   * @default {"policies":[{"type":"Pods","value":1,"periodSeconds":1800}],"stabilizationWindowSeconds":3600}
   */
  scaleDown?: LokiHelmValuesWriteAutoscalingBehaviorScaleDown;
};

export type LokiHelmValuesWriteAutoscalingBehaviorScaleUp = {
  policies?: LokiHelmValuesWriteAutoscalingBehaviorScaleUpPoliciesElement[];
};

export type LokiHelmValuesWriteAutoscalingBehaviorScaleUpPoliciesElement = {
  /**
   * @default "Pods"
   */
  type?: string;
  /**
   * @default 1
   */
  value?: number;
  /**
   * @default 900
   */
  periodSeconds?: number;
};

export type LokiHelmValuesWriteAutoscalingBehaviorScaleDown = {
  policies?: LokiHelmValuesWriteAutoscalingBehaviorScaleDownPoliciesElement[];
  /**
   * @default 3600
   */
  stabilizationWindowSeconds?: number;
};

export type LokiHelmValuesWriteAutoscalingBehaviorScaleDownPoliciesElement = {
  /**
   * @default "Pods"
   */
  type?: string;
  /**
   * @default 1
   */
  value?: number;
  /**
   * @default 1800
   */
  periodSeconds?: number;
};

export type LokiHelmValuesWriteImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesWriteAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesWritePodAnnotations = object;

export type LokiHelmValuesWritePodLabels = object;

export type LokiHelmValuesWriteSelectorLabels = object;

export type LokiHelmValuesWriteService = {
  /**
   * Annotations for write Service
   *
   * @default {}
   */
  annotations?: LokiHelmValuesWriteServiceAnnotations;
  /**
   * Additional labels for write Service
   *
   * @default {}
   */
  labels?: LokiHelmValuesWriteServiceLabels;
  /**
   * Service Type for write Service
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * trafficDistribution for write service
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type LokiHelmValuesWriteServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesWriteServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesWriteLifecycle = object;

export type LokiHelmValuesWriteResources = object;

export type LokiHelmValuesWriteAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"write","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesWriteAffinityPodAntiAffinity;
};

export type LokiHelmValuesWriteAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesWriteAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesWriteAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"write","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesWriteAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesWriteAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector = {
  /**
   * @default {"app.kubernetes.io/component":"write","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
   */
  matchLabels?: LokiHelmValuesWriteAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
};

export type LokiHelmValuesWriteAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "write"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesWriteDnsConfig = object;

export type LokiHelmValuesWriteNodeSelector = object;

export type LokiHelmValuesWritePersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable volume claims in pod spec
   *
   * @default true
   */
  volumeClaimsEnabled?: boolean;
  accessModes?: string[];
  /**
   * Parameters used for the `data` volume when volumeClaimEnabled if false
   *
   * @default {"emptyDir":{}}
   */
  dataVolumeParameters?: LokiHelmValuesWritePersistenceDataVolumeParameters;
  /**
   * Enable StatefulSetAutoDeletePVC feature
   *
   * @default false
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  /**
   * Size of persistent disk
   *
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  selector?: unknown;
  /**
   * Annotations for volume claim
   *
   * @default {}
   */
  annotations?: LokiHelmValuesWritePersistenceAnnotations;
  /**
   * Labels for volume claim
   *
   * @default {}
   */
  labels?: LokiHelmValuesWritePersistenceLabels;
};

export type LokiHelmValuesWritePersistenceDataVolumeParameters = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {}
   */
  emptyDir?: LokiHelmValuesWritePersistenceDataVolumeParametersEmptyDir;
};

export type LokiHelmValuesWritePersistenceDataVolumeParametersEmptyDir = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesWritePersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesWritePersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesRead = {
  /**
   * Number of replicas for the read
   *
   * @default 3
   */
  replicas?: number;
  /**
   * @default {...} (6 keys)
   */
  autoscaling?: LokiHelmValuesReadAutoscaling;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesReadImage;
  priorityClassName?: unknown;
  /**
   * Annotations for read deployment
   *
   * @default {}
   */
  annotations?: LokiHelmValuesReadAnnotations;
  /**
   * Annotations for read pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesReadPodAnnotations;
  /**
   * Additional labels for each `read` pod
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesReadPodLabels;
  /**
   * Additional selector labels for each `read` pod
   *
   * @default {}
   */
  selectorLabels?: LokiHelmValuesReadSelectorLabels;
  /**
   * @default {...} (4 keys)
   */
  service?: LokiHelmValuesReadService;
  /**
   * Comma-separated list of Loki modules to load for the read
   *
   * @default "read"
   */
  targetModule?: string;
  /**
   * Whether or not to use the 2 target type simple scalable mode (read, write) or the
   * 3 target type (read, write, backend). Legacy refers to the 2 target type, so true will
   * run two targets, false will run 3 targets.
   *
   * @default false
   */
  legacyReadTarget?: boolean;
  extraArgs?: unknown[];
  initContainers?: unknown[];
  extraContainers?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  /**
   * Lifecycle for the read container
   *
   * @default {}
   */
  lifecycle?: LokiHelmValuesReadLifecycle;
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the read
   *
   * @default {}
   */
  resources?: LokiHelmValuesReadResources;
  /**
   * liveness probe settings for read pods. If empty, applies no livenessProbe
   * statup probe for the read pods. If empty, applies no startupProbe
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesReadLivenessProbe;
  /**
   * @default {}
   */
  startupProbe?: LokiHelmValuesReadStartupProbe;
  /**
   * Grace period to allow the read to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Use the host's user namespace in the read pods.
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Affinity for read pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"read","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesReadAffinity;
  /**
   * DNS config for read pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesReadDnsConfig;
  /**
   * Node selector for read pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesReadNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * The default is to deploy all pods in parallel.
   *
   * @default "Parallel"
   */
  podManagementPolicy?: string;
  /**
   * read.persistence is used only if legacyReadTarget is set to true
   *
   * @default {...} (8 keys)
   */
  persistence?: LokiHelmValuesReadPersistence;
};

export type LokiHelmValuesReadAutoscaling = {
  /**
   * Enable autoscaling for the read, this is only used if `queryIndex.enabled: true`
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum autoscaling replicas for the read
   *
   * @default 2
   */
  minReplicas?: number;
  /**
   * Maximum autoscaling replicas for the read
   *
   * @default 6
   */
  maxReplicas?: number;
  /**
   * Target CPU utilisation percentage for the read
   *
   * @default 60
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
  /**
   * @default {}
   */
  behavior?: LokiHelmValuesReadAutoscalingBehavior;
};

export type LokiHelmValuesReadAutoscalingBehavior = object;

export type LokiHelmValuesReadImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesReadAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesReadPodAnnotations = object;

export type LokiHelmValuesReadPodLabels = object;

export type LokiHelmValuesReadSelectorLabels = object;

export type LokiHelmValuesReadService = {
  /**
   * Annotations for read Service
   *
   * @default {}
   */
  annotations?: LokiHelmValuesReadServiceAnnotations;
  /**
   * Additional labels for read Service
   *
   * @default {}
   */
  labels?: LokiHelmValuesReadServiceLabels;
  /**
   * Service Type for read Service
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * trafficDistribution for read service
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type LokiHelmValuesReadServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesReadServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesReadLifecycle = object;

export type LokiHelmValuesReadResources = object;

export type LokiHelmValuesReadLivenessProbe = object;

export type LokiHelmValuesReadStartupProbe = object;

export type LokiHelmValuesReadAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"read","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesReadAffinityPodAntiAffinity;
};

export type LokiHelmValuesReadAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesReadAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesReadAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"read","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesReadAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesReadAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector = {
  /**
   * @default {"app.kubernetes.io/component":"read","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
   */
  matchLabels?: LokiHelmValuesReadAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
};

export type LokiHelmValuesReadAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "read"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesReadDnsConfig = object;

export type LokiHelmValuesReadNodeSelector = object;

export type LokiHelmValuesReadPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable StatefulSetAutoDeletePVC feature
   *
   * @default true
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  accessModes?: string[];
  /**
   * Size of persistent disk
   *
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  selector?: unknown;
  /**
   * Annotations for volume claim
   *
   * @default {}
   */
  annotations?: LokiHelmValuesReadPersistenceAnnotations;
  /**
   * Labels for volume claim
   *
   * @default {}
   */
  labels?: LokiHelmValuesReadPersistenceLabels;
};

export type LokiHelmValuesReadPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesReadPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBackend = {
  /**
   * Number of replicas for the backend
   *
   * @default 3
   */
  replicas?: number;
  /**
   * @default {...} (6 keys)
   */
  autoscaling?: LokiHelmValuesBackendAutoscaling;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesBackendImage;
  priorityClassName?: unknown;
  /**
   * Annotations for backend StatefulSet
   *
   * @default {}
   */
  annotations?: LokiHelmValuesBackendAnnotations;
  /**
   * Annotations for backend pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesBackendPodAnnotations;
  /**
   * Additional labels for each `backend` pod
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesBackendPodLabels;
  /**
   * Additional selector labels for each `backend` pod
   *
   * @default {}
   */
  selectorLabels?: LokiHelmValuesBackendSelectorLabels;
  /**
   * @default {...} (4 keys)
   */
  service?: LokiHelmValuesBackendService;
  /**
   * Comma-separated list of Loki modules to load for the backend
   *
   * @default "backend"
   */
  targetModule?: string;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  initContainers?: unknown[];
  extraContainers?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the backend
   *
   * @default {}
   */
  resources?: LokiHelmValuesBackendResources;
  /**
   * Grace period to allow the backend to shutdown before it is killed. Especially for the ingester,
   * this must be increased. It must be long enough so backends can be gracefully shutdown flushing/transferring
   * all data and to successfully leave the member ring on shutdown.
   *
   * @default 300
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Use the host's user namespace in the backend pods.
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Affinity for backend pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"backend","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesBackendAffinity;
  /**
   * DNS config for backend pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesBackendDnsConfig;
  /**
   * Node selector for backend pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesBackendNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * The default is to deploy all pods in parallel.
   *
   * @default "Parallel"
   */
  podManagementPolicy?: string;
  /**
   * @default {...} (10 keys)
   */
  persistence?: LokiHelmValuesBackendPersistence;
};

export type LokiHelmValuesBackendAutoscaling = {
  /**
   * Enable autoscaling for the backend.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum autoscaling replicas for the backend.
   *
   * @default 3
   */
  minReplicas?: number;
  /**
   * Maximum autoscaling replicas for the backend.
   *
   * @default 6
   */
  maxReplicas?: number;
  /**
   * Target CPU utilization percentage for the backend.
   *
   * @default 60
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
  /**
   * @default {}
   */
  behavior?: LokiHelmValuesBackendAutoscalingBehavior;
};

export type LokiHelmValuesBackendAutoscalingBehavior = object;

export type LokiHelmValuesBackendImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesBackendAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBackendPodAnnotations = object;

export type LokiHelmValuesBackendPodLabels = object;

export type LokiHelmValuesBackendSelectorLabels = object;

export type LokiHelmValuesBackendService = {
  /**
   * Annotations for backend Service
   *
   * @default {}
   */
  annotations?: LokiHelmValuesBackendServiceAnnotations;
  /**
   * Additional labels for backend Service
   *
   * @default {}
   */
  labels?: LokiHelmValuesBackendServiceLabels;
  /**
   * Service type for backend Service
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * trafficDistribution for backend Service
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type LokiHelmValuesBackendServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBackendServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBackendResources = object;

export type LokiHelmValuesBackendAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"backend","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesBackendAffinityPodAntiAffinity;
};

export type LokiHelmValuesBackendAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesBackendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesBackendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"backend","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesBackendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesBackendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector = {
  /**
   * @default {"app.kubernetes.io/component":"backend","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
   */
  matchLabels?: LokiHelmValuesBackendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
};

export type LokiHelmValuesBackendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "backend"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesBackendDnsConfig = object;

export type LokiHelmValuesBackendNodeSelector = object;

export type LokiHelmValuesBackendPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable volume claims in pod spec
   *
   * @default true
   */
  volumeClaimsEnabled?: boolean;
  accessModes?: string[];
  /**
   * Parameters used for the `data` volume when volumeClaimEnabled if false
   *
   * @default {"emptyDir":{}}
   */
  dataVolumeParameters?: LokiHelmValuesBackendPersistenceDataVolumeParameters;
  /**
   * Enable StatefulSetAutoDeletePVC feature
   *
   * @default true
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  /**
   * Size of persistent disk
   *
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  selector?: unknown;
  /**
   * Annotations for volume claim
   *
   * @default {}
   */
  annotations?: LokiHelmValuesBackendPersistenceAnnotations;
  /**
   * Labels for volume claim
   *
   * @default {}
   */
  labels?: LokiHelmValuesBackendPersistenceLabels;
};

export type LokiHelmValuesBackendPersistenceDataVolumeParameters = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {}
   */
  emptyDir?: LokiHelmValuesBackendPersistenceDataVolumeParametersEmptyDir;
};

export type LokiHelmValuesBackendPersistenceDataVolumeParametersEmptyDir = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBackendPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBackendPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesIngester = {
  /**
   * Number of replicas for the ingester, when zoneAwareReplication.enabled is true, the total
   * number of replicas will match this value with each zone having 1/3rd of the total replicas.
   *
   * @default 0
   */
  replicas?: number;
  /**
   * DNSConfig for ingester pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesIngesterDnsConfig;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the ingester
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * @default {...} (7 keys)
   */
  autoscaling?: LokiHelmValuesIngesterAutoscaling;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesIngesterImage;
  command?: unknown;
  /**
   * @default {}
   */
  labels?: LokiHelmValuesIngesterLabels;
  priorityClassName?: unknown;
  /**
   * Labels for ingester pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesIngesterPodLabels;
  /**
   * Annotations for ingester pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesIngesterPodAnnotations;
  /**
   * The name of the PriorityClass for ingester pods
   * Labels for ingester service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesIngesterServiceLabels;
  /**
   * Annotations for ingester service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesIngesterServiceAnnotations;
  /**
   * Service type for ingester service
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the ingester
   *
   * @default {}
   */
  resources?: LokiHelmValuesIngesterResources;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  /**
   * Grace period to allow the ingester to shutdown before it is killed. Especially for the ingestor,
   * this must be increased. It must be long enough so ingesters can be gracefully shutdown flushing/transferring
   * all data and to successfully leave the member ring on shutdown.
   *
   * @default 300
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Lifecycle for the ingester container
   *
   * @default {}
   */
  lifecycle?: LokiHelmValuesIngesterLifecycle;
  topologySpreadConstraints?: LokiHelmValuesIngesterTopologySpreadConstraintsElement[];
  /**
   * Affinity for ingester pods. Ignored if zoneAwareReplication is enabled.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"ingester","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesIngesterAffinity;
  /**
   * Pod Disruption Budget maxUnavailable
   *
   * @default 1
   */
  maxUnavailable?: number;
  /**
   * Node selector for ingester pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesIngesterNodeSelector;
  tolerations?: unknown[];
  /**
   * readiness probe settings for ingester pods. If empty, use `loki.readinessProbe`
   *
   * @default {}
   */
  readinessProbe?: LokiHelmValuesIngesterReadinessProbe;
  /**
   * liveness probe settings for ingester pods. If empty use `loki.livenessProbe`
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesIngesterLivenessProbe;
  /**
   * startup probe settings for ingester pods. If empty use `loki.startupProbe`
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesIngesterStartupProbe;
  /**
   * UpdateStrategy for the ingester StatefulSets.
   * Optional for updateStrategy.type=RollingUpdate. See [Partitioned rolling updates](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#partitions) in the StatefulSet docs for details.
   *
   * @default {"type":"RollingUpdate"}
   */
  updateStrategy?: LokiHelmValuesIngesterUpdateStrategy;
  /**
   * @default {...} (6 keys)
   */
  persistence?: LokiHelmValuesIngesterPersistence;
  /**
   * Adds the appProtocol field to the ingester service. This allows ingester to work with istio protocol selection.
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesIngesterAppProtocol;
  /**
   * trafficDistribution for ingester service
   *
   * @default ""
   */
  trafficDistribution?: string;
  /**
   * Enabling zone awareness on ingesters will create 3 statefulests where all writes will send a replica to each zone.
   * This is primarily intended to accelerate rollout operations by allowing for multiple ingesters within a single
   * zone to be shutdown and restart simultaneously (the remaining 2 zones will be guaranteed to have at least one copy
   * of the data).
   * Note: This can be used to run Loki over multiple cloud provider availability zones however this is not currently
   * recommended as Loki is not optimized for this and cross zone network traffic costs can become extremely high
   * extremely quickly. Even with zone awareness enabled, it is recommended to run Loki in a single availability zone.
   *
   * @default {...} (6 keys)
   */
  zoneAwareReplication?: LokiHelmValuesIngesterZoneAwareReplication;
  rolloutGroupPrefix?: unknown;
  /**
   * optionally allow adding 'loki-' prefix to ingester name label
   *
   * @default false
   */
  addIngesterNamePrefix?: boolean;
};

export type LokiHelmValuesIngesterDnsConfig = object;

export type LokiHelmValuesIngesterAutoscaling = {
  /**
   * Enable autoscaling for the ingester
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum autoscaling replicas for the ingester
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum autoscaling replicas for the ingester
   *
   * @default 3
   */
  maxReplicas?: number;
  /**
   * Target CPU utilisation percentage for the ingester
   *
   * @default 60
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
  customMetrics?: unknown[];
  /**
   * @default {"enabled":false,"scaleDown":{},"scaleUp":{}}
   */
  behavior?: LokiHelmValuesIngesterAutoscalingBehavior;
};

export type LokiHelmValuesIngesterAutoscalingBehavior = {
  /**
   * Enable autoscaling behaviours
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * define scale down policies, must conform to HPAScalingRules
   *
   * @default {}
   */
  scaleDown?: LokiHelmValuesIngesterAutoscalingBehaviorScaleDown;
  /**
   * define scale up policies, must conform to HPAScalingRules
   *
   * @default {}
   */
  scaleUp?: LokiHelmValuesIngesterAutoscalingBehaviorScaleUp;
};

export type LokiHelmValuesIngesterAutoscalingBehaviorScaleDown = object;

export type LokiHelmValuesIngesterAutoscalingBehaviorScaleUp = object;

export type LokiHelmValuesIngesterImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesIngesterLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesIngesterPodLabels = object;

export type LokiHelmValuesIngesterPodAnnotations = object;

export type LokiHelmValuesIngesterServiceLabels = object;

export type LokiHelmValuesIngesterServiceAnnotations = object;

export type LokiHelmValuesIngesterResources = object;

export type LokiHelmValuesIngesterLifecycle = object;

export type LokiHelmValuesIngesterTopologySpreadConstraintsElement = {
  /**
   * @default 1
   */
  maxSkew?: number;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
  /**
   * @default "ScheduleAnyway"
   */
  whenUnsatisfiable?: string;
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"ingester","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesIngesterTopologySpreadConstraintsLabelSelector;
};

export type LokiHelmValuesIngesterTopologySpreadConstraintsLabelSelector = {
  /**
   * @default {"app.kubernetes.io/component":"ingester","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
   */
  matchLabels?: LokiHelmValuesIngesterTopologySpreadConstraintsLabelSelectorMatchLabels;
};

export type LokiHelmValuesIngesterTopologySpreadConstraintsLabelSelectorMatchLabels = {
  /**
   * @default "ingester"
   */
  "app.kubernetes.io/component"?: string;
  /**
   * @default "{{ include "loki.name" . }}"
   */
  "app.kubernetes.io/name"?: string;
  /**
   * @default "{{ .Release.Name }}"
   */
  "app.kubernetes.io/instance"?: string;
};

export type LokiHelmValuesIngesterAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"ingester","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesIngesterAffinityPodAntiAffinity;
};

export type LokiHelmValuesIngesterAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"ingester","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector = {
  /**
   * @default {"app.kubernetes.io/component":"ingester","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
   */
  matchLabels?: LokiHelmValuesIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
};

export type LokiHelmValuesIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "ingester"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesIngesterNodeSelector = object;

export type LokiHelmValuesIngesterReadinessProbe = object;

export type LokiHelmValuesIngesterLivenessProbe = object;

export type LokiHelmValuesIngesterStartupProbe = object;

export type LokiHelmValuesIngesterUpdateStrategy = {
  /**
   * One of  'OnDelete' or 'RollingUpdate'
   *
   * @default "RollingUpdate"
   */
  type?: string;
};

export type LokiHelmValuesIngesterPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable creating PVCs which is required when using boltdb-shipper
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Use emptyDir with ramdisk for storage. **Please note that all data in ingester will be lost on pod restart**
   *
   * @default false
   */
  inMemory?: boolean;
  claims?: LokiHelmValuesIngesterPersistenceClaimsElement[];
  /**
   * @default false
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  /**
   * @default "Retain"
   */
  whenDeleted?: string;
  /**
   * @default "Retain"
   */
  whenScaled?: string;
};

export type LokiHelmValuesIngesterPersistenceClaimsElement = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "data"
   */
  name?: string;
  accessModes?: string[];
  /**
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
};

export type LokiHelmValuesIngesterAppProtocol = {
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesIngesterZoneAwareReplication = {
  /**
   * Enable zone awareness.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * The percent of replicas in each zone that will be restarted at once. In a value of 0-100
   *
   * @default 33
   */
  maxUnavailablePct?: number;
  /**
   * zoneA configuration
   *
   * @default {...} (4 keys)
   */
  zoneA?: LokiHelmValuesIngesterZoneAwareReplicationZoneA;
  /**
   * @default {...} (4 keys)
   */
  zoneB?: LokiHelmValuesIngesterZoneAwareReplicationZoneB;
  /**
   * @default {...} (4 keys)
   */
  zoneC?: LokiHelmValuesIngesterZoneAwareReplicationZoneC;
  /**
   * The migration block allows migrating non zone aware ingesters to zone aware ingesters.
   *
   * @default {...} (4 keys)
   */
  migration?: LokiHelmValuesIngesterZoneAwareReplicationMigration;
};

export type LokiHelmValuesIngesterZoneAwareReplicationZoneA = {
  nodeSelector?: unknown;
  /**
   * optionally define extra affinity rules, by default different zones are not allowed to schedule on the same host
   * The value will be passed through tpl.
   *
   * @default {}
   */
  extraAffinity?: LokiHelmValuesIngesterZoneAwareReplicationZoneAExtraAffinity;
  /**
   * Specific annotations to add to zone A statefulset
   *
   * @default {}
   */
  annotations?: LokiHelmValuesIngesterZoneAwareReplicationZoneAAnnotations;
  /**
   * Specific annotations to add to zone A pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesIngesterZoneAwareReplicationZoneAPodAnnotations;
};

export type LokiHelmValuesIngesterZoneAwareReplicationZoneAExtraAffinity = object;

export type LokiHelmValuesIngesterZoneAwareReplicationZoneAAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesIngesterZoneAwareReplicationZoneAPodAnnotations = object;

export type LokiHelmValuesIngesterZoneAwareReplicationZoneB = {
  nodeSelector?: unknown;
  /**
   * optionally define extra affinity rules, by default different zones are not allowed to schedule on the same host
   * The value will be passed through tpl.
   *
   * @default {}
   */
  extraAffinity?: LokiHelmValuesIngesterZoneAwareReplicationZoneBExtraAffinity;
  /**
   * Specific annotations to add to zone B statefulset
   *
   * @default {}
   */
  annotations?: LokiHelmValuesIngesterZoneAwareReplicationZoneBAnnotations;
  /**
   * Specific annotations to add to zone B pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesIngesterZoneAwareReplicationZoneBPodAnnotations;
};

export type LokiHelmValuesIngesterZoneAwareReplicationZoneBExtraAffinity = object;

export type LokiHelmValuesIngesterZoneAwareReplicationZoneBAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesIngesterZoneAwareReplicationZoneBPodAnnotations = object;

export type LokiHelmValuesIngesterZoneAwareReplicationZoneC = {
  nodeSelector?: unknown;
  /**
   * optionally define extra affinity rules, by default different zones are not allowed to schedule on the same host
   * The value will be passed through tpl.
   *
   * @default {}
   */
  extraAffinity?: LokiHelmValuesIngesterZoneAwareReplicationZoneCExtraAffinity;
  /**
   * Specific annotations to add to zone C statefulset
   *
   * @default {}
   */
  annotations?: LokiHelmValuesIngesterZoneAwareReplicationZoneCAnnotations;
  /**
   * Specific annotations to add to zone C pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesIngesterZoneAwareReplicationZoneCPodAnnotations;
};

export type LokiHelmValuesIngesterZoneAwareReplicationZoneCExtraAffinity = object;

export type LokiHelmValuesIngesterZoneAwareReplicationZoneCAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesIngesterZoneAwareReplicationZoneCPodAnnotations = object;

export type LokiHelmValuesIngesterZoneAwareReplicationMigration = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default false
   */
  excludeDefaultZone?: boolean;
  /**
   * @default false
   */
  readPath?: boolean;
  /**
   * @default false
   */
  writePath?: boolean;
};

export type LokiHelmValuesDistributor = {
  /**
   * Number of replicas for the distributor
   *
   * @default 0
   */
  replicas?: number;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the distributor
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * DNSConfig for distributor pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesDistributorDnsConfig;
  /**
   * @default {...} (7 keys)
   */
  autoscaling?: LokiHelmValuesDistributorAutoscaling;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesDistributorImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for distributor pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesDistributorPodLabels;
  /**
   * Annotations for distributor pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesDistributorPodAnnotations;
  /**
   * Labels for distributor service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesDistributorServiceLabels;
  /**
   * Annotations for distributor service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesDistributorServiceAnnotations;
  /**
   * Service type for distributor service
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the distributor
   *
   * @default {}
   */
  resources?: LokiHelmValuesDistributorResources;
  initContainers?: unknown[];
  extraContainers?: unknown[];
  /**
   * Grace period to allow the distributor to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Affinity for distributor pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"distributor","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesDistributorAffinity;
  maxUnavailable?: unknown;
  /**
   * Max Surge for distributor pods
   *
   * @default 0
   */
  maxSurge?: number;
  /**
   * Node selector for distributor pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesDistributorNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Adds the appProtocol field to the distributor service. This allows distributor to work with istio protocol selection.
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesDistributorAppProtocol;
  /**
   * trafficDistribution for distributor service
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type LokiHelmValuesDistributorDnsConfig = object;

export type LokiHelmValuesDistributorAutoscaling = {
  /**
   * Enable autoscaling for the distributor
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum autoscaling replicas for the distributor
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum autoscaling replicas for the distributor
   *
   * @default 3
   */
  maxReplicas?: number;
  /**
   * Target CPU utilisation percentage for the distributor
   *
   * @default 60
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
  customMetrics?: unknown[];
  /**
   * @default {"enabled":false,"scaleDown":{},"scaleUp":{}}
   */
  behavior?: LokiHelmValuesDistributorAutoscalingBehavior;
};

export type LokiHelmValuesDistributorAutoscalingBehavior = {
  /**
   * Enable autoscaling behaviours
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * define scale down policies, must conform to HPAScalingRules
   *
   * @default {}
   */
  scaleDown?: LokiHelmValuesDistributorAutoscalingBehaviorScaleDown;
  /**
   * define scale up policies, must conform to HPAScalingRules
   *
   * @default {}
   */
  scaleUp?: LokiHelmValuesDistributorAutoscalingBehaviorScaleUp;
};

export type LokiHelmValuesDistributorAutoscalingBehaviorScaleDown = object;

export type LokiHelmValuesDistributorAutoscalingBehaviorScaleUp = object;

export type LokiHelmValuesDistributorImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesDistributorPodLabels = object;

export type LokiHelmValuesDistributorPodAnnotations = object;

export type LokiHelmValuesDistributorServiceLabels = object;

export type LokiHelmValuesDistributorServiceAnnotations = object;

export type LokiHelmValuesDistributorResources = object;

export type LokiHelmValuesDistributorAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"distributor","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesDistributorAffinityPodAntiAffinity;
};

export type LokiHelmValuesDistributorAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesDistributorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesDistributorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"distributor","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesDistributorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesDistributorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"distributor","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesDistributorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesDistributorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "distributor"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesDistributorNodeSelector = object;

export type LokiHelmValuesDistributorAppProtocol = {
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesQuerier = {
  /**
   * Number of replicas for the querier
   *
   * @default 0
   */
  replicas?: number;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the querier
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * @default {...} (7 keys)
   */
  autoscaling?: LokiHelmValuesQuerierAutoscaling;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesQuerierImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for querier pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesQuerierPodLabels;
  /**
   * Annotations for querier pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesQuerierPodAnnotations;
  /**
   * Labels for querier service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesQuerierServiceLabels;
  /**
   * Annotations for querier service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesQuerierServiceAnnotations;
  /**
   * Service Type for querier service
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the querier
   *
   * @default {}
   */
  resources?: LokiHelmValuesQuerierResources;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  /**
   * Grace period to allow the querier to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  topologySpreadConstraints?: LokiHelmValuesQuerierTopologySpreadConstraintsElement[];
  /**
   * Affinity for querier pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"querier","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesQuerierAffinity;
  maxUnavailable?: unknown;
  /**
   * Max Surge for querier pods
   *
   * @default 0
   */
  maxSurge?: number;
  /**
   * Node selector for querier pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesQuerierNodeSelector;
  tolerations?: unknown[];
  /**
   * DNSConfig for querier pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesQuerierDnsConfig;
  /**
   * Adds the appProtocol field to the querier service. This allows querier to work with istio protocol selection.
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesQuerierAppProtocol;
  /**
   * trafficDistribution for querier service
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type LokiHelmValuesQuerierAutoscaling = {
  /**
   * Enable autoscaling for the querier, this is only used if `indexGateway.enabled: true`
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum autoscaling replicas for the querier
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum autoscaling replicas for the querier
   *
   * @default 3
   */
  maxReplicas?: number;
  /**
   * Target CPU utilisation percentage for the querier
   *
   * @default 60
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
  customMetrics?: unknown[];
  /**
   * @default {"enabled":false,"scaleDown":{},"scaleUp":{}}
   */
  behavior?: LokiHelmValuesQuerierAutoscalingBehavior;
};

export type LokiHelmValuesQuerierAutoscalingBehavior = {
  /**
   * Enable autoscaling behaviours
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * define scale down policies, must conform to HPAScalingRules
   *
   * @default {}
   */
  scaleDown?: LokiHelmValuesQuerierAutoscalingBehaviorScaleDown;
  /**
   * define scale up policies, must conform to HPAScalingRules
   *
   * @default {}
   */
  scaleUp?: LokiHelmValuesQuerierAutoscalingBehaviorScaleUp;
};

export type LokiHelmValuesQuerierAutoscalingBehaviorScaleDown = object;

export type LokiHelmValuesQuerierAutoscalingBehaviorScaleUp = object;

export type LokiHelmValuesQuerierImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesQuerierPodLabels = object;

export type LokiHelmValuesQuerierPodAnnotations = object;

export type LokiHelmValuesQuerierServiceLabels = object;

export type LokiHelmValuesQuerierServiceAnnotations = object;

export type LokiHelmValuesQuerierResources = object;

export type LokiHelmValuesQuerierTopologySpreadConstraintsElement = {
  /**
   * @default 1
   */
  maxSkew?: number;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
  /**
   * @default "ScheduleAnyway"
   */
  whenUnsatisfiable?: string;
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"querier","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesQuerierTopologySpreadConstraintsLabelSelector;
};

export type LokiHelmValuesQuerierTopologySpreadConstraintsLabelSelector = {
  /**
   * @default {"app.kubernetes.io/component":"querier","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
   */
  matchLabels?: LokiHelmValuesQuerierTopologySpreadConstraintsLabelSelectorMatchLabels;
};

export type LokiHelmValuesQuerierTopologySpreadConstraintsLabelSelectorMatchLabels = {
  /**
   * @default "querier"
   */
  "app.kubernetes.io/component"?: string;
  /**
   * @default "{{ include "loki.name" . }}"
   */
  "app.kubernetes.io/name"?: string;
  /**
   * @default "{{ .Release.Name }}"
   */
  "app.kubernetes.io/instance"?: string;
};

export type LokiHelmValuesQuerierAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"querier","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesQuerierAffinityPodAntiAffinity;
};

export type LokiHelmValuesQuerierAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesQuerierAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesQuerierAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"querier","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesQuerierAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesQuerierAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector = {
  /**
   * @default {"app.kubernetes.io/component":"querier","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
   */
  matchLabels?: LokiHelmValuesQuerierAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
};

export type LokiHelmValuesQuerierAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "querier"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesQuerierNodeSelector = object;

export type LokiHelmValuesQuerierDnsConfig = object;

export type LokiHelmValuesQuerierAppProtocol = {
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesQueryFrontend = {
  /**
   * Number of replicas for the query-frontend
   *
   * @default 0
   */
  replicas?: number;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the query-frontend
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * @default {...} (7 keys)
   */
  autoscaling?: LokiHelmValuesQueryFrontendAutoscaling;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesQueryFrontendImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for query-frontend pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesQueryFrontendPodLabels;
  /**
   * Annotations for query-frontend pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesQueryFrontendPodAnnotations;
  /**
   * Labels for query-frontend service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesQueryFrontendServiceLabels;
  /**
   * Annotations for query-frontend service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesQueryFrontendServiceAnnotations;
  /**
   * Service Type for query-frontend service
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the query-frontend
   *
   * @default {}
   */
  resources?: LokiHelmValuesQueryFrontendResources;
  initContainers?: unknown[];
  extraContainers?: unknown[];
  /**
   * Grace period to allow the query-frontend to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Affinity for query-frontend pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"query-frontend","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesQueryFrontendAffinity;
  maxUnavailable?: unknown;
  /**
   * Node selector for query-frontend pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesQueryFrontendNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Adds the appProtocol field to the queryFrontend service. This allows queryFrontend to work with istio protocol selection.
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesQueryFrontendAppProtocol;
  /**
   * Enable load balancer port for query-frontend
   *
   * @default {"enabled":true}
   */
  loadBalancer?: LokiHelmValuesQueryFrontendLoadBalancer;
  /**
   * trafficDistribution for query-frontend service
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type LokiHelmValuesQueryFrontendAutoscaling = {
  /**
   * Enable autoscaling for the query-frontend
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum autoscaling replicas for the query-frontend
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum autoscaling replicas for the query-frontend
   *
   * @default 3
   */
  maxReplicas?: number;
  /**
   * Target CPU utilisation percentage for the query-frontend
   *
   * @default 60
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
  customMetrics?: unknown[];
  /**
   * @default {"enabled":false,"scaleDown":{},"scaleUp":{}}
   */
  behavior?: LokiHelmValuesQueryFrontendAutoscalingBehavior;
};

export type LokiHelmValuesQueryFrontendAutoscalingBehavior = {
  /**
   * Enable autoscaling behaviours
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * define scale down policies, must conform to HPAScalingRules
   *
   * @default {}
   */
  scaleDown?: LokiHelmValuesQueryFrontendAutoscalingBehaviorScaleDown;
  /**
   * define scale up policies, must conform to HPAScalingRules
   *
   * @default {}
   */
  scaleUp?: LokiHelmValuesQueryFrontendAutoscalingBehaviorScaleUp;
};

export type LokiHelmValuesQueryFrontendAutoscalingBehaviorScaleDown = object;

export type LokiHelmValuesQueryFrontendAutoscalingBehaviorScaleUp = object;

export type LokiHelmValuesQueryFrontendImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesQueryFrontendPodLabels = object;

export type LokiHelmValuesQueryFrontendPodAnnotations = object;

export type LokiHelmValuesQueryFrontendServiceLabels = object;

export type LokiHelmValuesQueryFrontendServiceAnnotations = object;

export type LokiHelmValuesQueryFrontendResources = object;

export type LokiHelmValuesQueryFrontendAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"query-frontend","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesQueryFrontendAffinityPodAntiAffinity;
};

export type LokiHelmValuesQueryFrontendAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesQueryFrontendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesQueryFrontendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"query-frontend","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesQueryFrontendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesQueryFrontendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"query-frontend","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesQueryFrontendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesQueryFrontendAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "query-frontend"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesQueryFrontendNodeSelector = object;

export type LokiHelmValuesQueryFrontendAppProtocol = {
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesQueryFrontendLoadBalancer = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type LokiHelmValuesQueryScheduler = {
  /**
   * Number of replicas for the query-scheduler.
   * It should be lower than `-querier.max-concurrent` to avoid generating back-pressure in queriers;
   * it's also recommended that this value evenly divides the latter
   *
   * @default 0
   */
  replicas?: number;
  /**
   * DNSConfig for query-scheduler
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesQuerySchedulerDnsConfig;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the query-scheduler
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesQuerySchedulerImage;
  priorityClassName?: unknown;
  /**
   * Labels for query-scheduler pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesQuerySchedulerPodLabels;
  /**
   * Annotations for query-scheduler pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesQuerySchedulerPodAnnotations;
  /**
   * Labels for query-scheduler service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesQuerySchedulerServiceLabels;
  /**
   * Annotations for query-scheduler service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesQuerySchedulerServiceAnnotations;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the query-scheduler
   *
   * @default {}
   */
  resources?: LokiHelmValuesQuerySchedulerResources;
  initContainers?: unknown[];
  extraContainers?: unknown[];
  /**
   * Grace period to allow the query-scheduler to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Affinity for query-scheduler pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"query-scheduler","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesQuerySchedulerAffinity;
  /**
   * Pod Disruption Budget maxUnavailable
   *
   * @default 1
   */
  maxUnavailable?: number;
  /**
   * Node selector for query-scheduler pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesQuerySchedulerNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesQuerySchedulerAppProtocol;
  /**
   * trafficDistribution for query-scheduler service
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type LokiHelmValuesQuerySchedulerDnsConfig = object;

export type LokiHelmValuesQuerySchedulerImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesQuerySchedulerPodLabels = object;

export type LokiHelmValuesQuerySchedulerPodAnnotations = object;

export type LokiHelmValuesQuerySchedulerServiceLabels = object;

export type LokiHelmValuesQuerySchedulerServiceAnnotations = object;

export type LokiHelmValuesQuerySchedulerResources = object;

export type LokiHelmValuesQuerySchedulerAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"query-scheduler","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesQuerySchedulerAffinityPodAntiAffinity;
};

export type LokiHelmValuesQuerySchedulerAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesQuerySchedulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesQuerySchedulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"query-scheduler","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesQuerySchedulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesQuerySchedulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"query-scheduler","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesQuerySchedulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesQuerySchedulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "query-scheduler"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesQuerySchedulerNodeSelector = object;

export type LokiHelmValuesQuerySchedulerAppProtocol = {
  /**
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesIndexGateway = {
  /**
   * Number of replicas for the index-gateway
   *
   * @default 0
   */
  replicas?: number;
  /**
   * Whether the index gateway should join the memberlist hashring
   *
   * @default true
   */
  joinMemberlist?: boolean;
  /**
   * DNSConfig for index-gateway pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesIndexGatewayDnsConfig;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the index-gateway
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesIndexGatewayImage;
  priorityClassName?: unknown;
  /**
   * Labels for index-gateway pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesIndexGatewayPodLabels;
  /**
   * Annotations for index-gateway pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesIndexGatewayPodAnnotations;
  /**
   * Labels for index-gateway service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesIndexGatewayServiceLabels;
  /**
   * Annotations for index-gateway service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesIndexGatewayServiceAnnotations;
  /**
   * Service type for index-gateway service
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the index-gateway
   *
   * @default {}
   */
  resources?: LokiHelmValuesIndexGatewayResources;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  /**
   * Grace period to allow the index-gateway to shutdown before it is killed.
   *
   * @default 300
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Lifecycle for the index-gateway container
   *
   * @default {}
   */
  lifecycle?: LokiHelmValuesIndexGatewayLifecycle;
  /**
   * Affinity for index-gateway pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"index-gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesIndexGatewayAffinity;
  maxUnavailable?: unknown;
  /**
   * Node selector for index-gateway pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesIndexGatewayNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * @default {...} (11 keys)
   */
  persistence?: LokiHelmValuesIndexGatewayPersistence;
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesIndexGatewayAppProtocol;
  /**
   * trafficDistribution for index-gateway service
   *
   * @default ""
   */
  trafficDistribution?: string;
  /**
   * UpdateStrategy for the indexGateway StatefulSet.
   * Optional for updateStrategy.type=RollingUpdate. See [Partitioned rolling updates](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#partitions) in the StatefulSet docs for details.
   * Configuration for the compactor
   *
   * @default {"type":"RollingUpdate"}
   */
  updateStrategy?: LokiHelmValuesIndexGatewayUpdateStrategy;
};

export type LokiHelmValuesIndexGatewayDnsConfig = object;

export type LokiHelmValuesIndexGatewayImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesIndexGatewayPodLabels = object;

export type LokiHelmValuesIndexGatewayPodAnnotations = object;

export type LokiHelmValuesIndexGatewayServiceLabels = object;

export type LokiHelmValuesIndexGatewayServiceAnnotations = object;

export type LokiHelmValuesIndexGatewayResources = object;

export type LokiHelmValuesIndexGatewayLifecycle = object;

export type LokiHelmValuesIndexGatewayAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"index-gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesIndexGatewayAffinityPodAntiAffinity;
};

export type LokiHelmValuesIndexGatewayAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesIndexGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesIndexGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"index-gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesIndexGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesIndexGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"index-gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesIndexGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesIndexGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "index-gateway"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesIndexGatewayNodeSelector = object;

export type LokiHelmValuesIndexGatewayPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable creating PVCs which is required when using boltdb-shipper
   *
   * @default false
   */
  enabled?: boolean;
  accessModes?: string[];
  /**
   * Use emptyDir with ramdisk for storage. **Please note that all data in indexGateway will be lost on pod restart**
   *
   * @default false
   */
  inMemory?: boolean;
  /**
   * Size of persistent or memory disk
   *
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  /**
   * Annotations for index gateway PVCs
   *
   * @default {}
   */
  annotations?: LokiHelmValuesIndexGatewayPersistenceAnnotations;
  /**
   * Labels for index gateway PVCs
   *
   * @default {}
   */
  labels?: LokiHelmValuesIndexGatewayPersistenceLabels;
  /**
   * Enable StatefulSetAutoDeletePVC feature
   *
   * @default false
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  /**
   * @default "Retain"
   */
  whenDeleted?: string;
  /**
   * @default "Retain"
   */
  whenScaled?: string;
};

export type LokiHelmValuesIndexGatewayPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesIndexGatewayPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesIndexGatewayAppProtocol = {
  /**
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesIndexGatewayUpdateStrategy = {
  /**
   * One of  'OnDelete' or 'RollingUpdate'
   *
   * @default "RollingUpdate"
   */
  type?: string;
};

export type LokiHelmValuesCompactor = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Number of replicas for the compactor
   *
   * @default 0
   */
  replicas?: number;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the compactor
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * DNSConfig for compactor pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesCompactorDnsConfig;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesCompactorImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for compactor pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesCompactorPodLabels;
  /**
   * Annotations for compactor pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesCompactorPodAnnotations;
  /**
   * Affinity for compactor pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"compactor","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesCompactorAffinity;
  /**
   * Labels for compactor service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesCompactorServiceLabels;
  /**
   * Annotations for compactor service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesCompactorServiceAnnotations;
  /**
   * Service type for compactor service
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * readiness probe settings for compactor pods. If empty, use `loki.readinessProbe`
   *
   * @default {}
   */
  readinessProbe?: LokiHelmValuesCompactorReadinessProbe;
  /**
   * liveness probe settings for compactor pods. If empty use `loki.livenessProbe`
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesCompactorLivenessProbe;
  /**
   * liveness probe settings for ingester pods. If empty use `loki.livenessProbe`
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesCompactorStartupProbe;
  /**
   * Resource requests and limits for the compactor
   *
   * @default {}
   */
  resources?: LokiHelmValuesCompactorResources;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  /**
   * Grace period to allow the compactor to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Node selector for compactor pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesCompactorNodeSelector;
  tolerations?: unknown[];
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesCompactorAppProtocol;
  /**
   * @default {...} (5 keys)
   */
  persistence?: LokiHelmValuesCompactorPersistence;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: LokiHelmValuesCompactorServiceAccount;
};

export type LokiHelmValuesCompactorDnsConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesCompactorImage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesCompactorPodLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesCompactorPodAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesCompactorAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"compactor","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesCompactorAffinityPodAntiAffinity;
};

export type LokiHelmValuesCompactorAffinityPodAntiAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesCompactorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesCompactorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"compactor","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesCompactorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesCompactorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"compactor","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesCompactorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesCompactorAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "compactor"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesCompactorServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesCompactorServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesCompactorReadinessProbe = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesCompactorLivenessProbe = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesCompactorStartupProbe = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesCompactorResources = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesCompactorNodeSelector = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesCompactorAppProtocol = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesCompactorPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable creating PVCs for the compactor
   *
   * @default false
   */
  enabled?: boolean;
  claims?: LokiHelmValuesCompactorPersistenceClaimsElement[];
  /**
   * @default false
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  /**
   * @default "Retain"
   */
  whenDeleted?: string;
  /**
   * @default "Retain"
   */
  whenScaled?: string;
};

export type LokiHelmValuesCompactorPersistenceClaimsElement = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "data"
   */
  name?: string;
  accessModes?: string[];
  /**
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesCompactorPersistenceClaimsAnnotations;
  /**
   * @default {}
   */
  labels?: LokiHelmValuesCompactorPersistenceClaimsLabels;
};

export type LokiHelmValuesCompactorPersistenceClaimsAnnotations = object;

export type LokiHelmValuesCompactorPersistenceClaimsLabels = object;

export type LokiHelmValuesCompactorServiceAccount = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default false
   */
  create?: boolean;
  name?: unknown;
  imagePullSecrets?: unknown[];
  /**
   * Annotations for the compactor service account
   *
   * @default {}
   */
  annotations?: LokiHelmValuesCompactorServiceAccountAnnotations;
  /**
   * Set this toggle to false to opt out of automounting API credentials for the service account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type LokiHelmValuesCompactorServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBloomGateway = {
  /**
   * Number of replicas for the bloom-gateway
   *
   * @default 0
   */
  replicas?: number;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the bloom-gateway
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * DNSConfig for bloom-gateway pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesBloomGatewayDnsConfig;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesBloomGatewayImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for bloom-gateway pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesBloomGatewayPodLabels;
  /**
   * Annotations for bloom-gateway pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesBloomGatewayPodAnnotations;
  /**
   * Affinity for bloom-gateway pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"bloom-gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesBloomGatewayAffinity;
  /**
   * Labels for bloom-gateway service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesBloomGatewayServiceLabels;
  /**
   * Annotations for bloom-gateway service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesBloomGatewayServiceAnnotations;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * readiness probe settings for bloom-gateway pods. If empty, use `loki.readinessProbe`
   *
   * @default {}
   */
  readinessProbe?: LokiHelmValuesBloomGatewayReadinessProbe;
  /**
   * liveness probe settings for bloom-gateway pods. If empty use `loki.livenessProbe`
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesBloomGatewayLivenessProbe;
  /**
   * startup probe settings for bloom-gateway pods. If empty, use `loki.startupProbe`
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesBloomGatewayStartupProbe;
  /**
   * Resource requests and limits for the bloom-gateway
   *
   * @default {}
   */
  resources?: LokiHelmValuesBloomGatewayResources;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  /**
   * Grace period to allow the bloom-gateway to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Node selector for bloom-gateway pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesBloomGatewayNodeSelector;
  tolerations?: unknown[];
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesBloomGatewayAppProtocol;
  /**
   * @default {...} (7 keys)
   */
  persistence?: LokiHelmValuesBloomGatewayPersistence;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: LokiHelmValuesBloomGatewayServiceAccount;
};

export type LokiHelmValuesBloomGatewayDnsConfig = object;

export type LokiHelmValuesBloomGatewayImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesBloomGatewayPodLabels = object;

export type LokiHelmValuesBloomGatewayPodAnnotations = object;

export type LokiHelmValuesBloomGatewayAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"bloom-gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesBloomGatewayAffinityPodAntiAffinity;
};

export type LokiHelmValuesBloomGatewayAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesBloomGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesBloomGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"bloom-gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesBloomGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesBloomGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"bloom-gateway","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesBloomGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesBloomGatewayAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "bloom-gateway"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesBloomGatewayServiceLabels = object;

export type LokiHelmValuesBloomGatewayServiceAnnotations = object;

export type LokiHelmValuesBloomGatewayReadinessProbe = object;

export type LokiHelmValuesBloomGatewayLivenessProbe = object;

export type LokiHelmValuesBloomGatewayStartupProbe = object;

export type LokiHelmValuesBloomGatewayResources = object;

export type LokiHelmValuesBloomGatewayNodeSelector = object;

export type LokiHelmValuesBloomGatewayAppProtocol = {
  /**
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesBloomGatewayPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable creating PVCs for the bloom-gateway
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Annotations for bloom-gateway PVCs
   *
   * @default {}
   */
  annotations?: LokiHelmValuesBloomGatewayPersistenceAnnotations;
  /**
   * Labels for bloom gateway PVCs
   *
   * @default {}
   */
  labels?: LokiHelmValuesBloomGatewayPersistenceLabels;
  claims?: LokiHelmValuesBloomGatewayPersistenceClaimsElement[];
  /**
   * Enable StatefulSetAutoDeletePVC feature
   *
   * @default false
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  /**
   * @default "Retain"
   */
  whenDeleted?: string;
  /**
   * @default "Retain"
   */
  whenScaled?: string;
};

export type LokiHelmValuesBloomGatewayPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBloomGatewayPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBloomGatewayPersistenceClaimsElement = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "data"
   */
  name?: string;
  accessModes?: string[];
  /**
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
};

export type LokiHelmValuesBloomGatewayServiceAccount = {
  /**
   * @default false
   */
  create?: boolean;
  name?: unknown;
  imagePullSecrets?: unknown[];
  /**
   * Annotations for the bloom-gateway service account
   *
   * @default {}
   */
  annotations?: LokiHelmValuesBloomGatewayServiceAccountAnnotations;
  /**
   * Set this toggle to false to opt out of automounting API credentials for the service account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type LokiHelmValuesBloomGatewayServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBloomPlanner = {
  /**
   * Number of replicas for the bloom-planner
   *
   * @default 0
   */
  replicas?: number;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the bloom-planner
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * DNSConfig for bloom-planner pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesBloomPlannerDnsConfig;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesBloomPlannerImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for bloom-planner pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesBloomPlannerPodLabels;
  /**
   * Annotations for bloom-planner pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesBloomPlannerPodAnnotations;
  /**
   * Affinity for bloom-planner pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"bloom-planner","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesBloomPlannerAffinity;
  /**
   * Labels for bloom-planner service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesBloomPlannerServiceLabels;
  /**
   * Annotations for bloom-planner service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesBloomPlannerServiceAnnotations;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * readiness probe settings for bloom-planner pods. If empty, use `loki.readinessProbe`
   *
   * @default {}
   */
  readinessProbe?: LokiHelmValuesBloomPlannerReadinessProbe;
  /**
   * liveness probe settings for bloom-planner pods. If empty use `loki.livenessProbe`
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesBloomPlannerLivenessProbe;
  /**
   * startup probe settings for bloom-planner pods. If empty use `loki.startupProbe`
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesBloomPlannerStartupProbe;
  /**
   * Resource requests and limits for the bloom-planner
   *
   * @default {}
   */
  resources?: LokiHelmValuesBloomPlannerResources;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  /**
   * Grace period to allow the bloom-planner to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Node selector for bloom-planner pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesBloomPlannerNodeSelector;
  tolerations?: unknown[];
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesBloomPlannerAppProtocol;
  /**
   * @default {...} (5 keys)
   */
  persistence?: LokiHelmValuesBloomPlannerPersistence;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: LokiHelmValuesBloomPlannerServiceAccount;
};

export type LokiHelmValuesBloomPlannerDnsConfig = object;

export type LokiHelmValuesBloomPlannerImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesBloomPlannerPodLabels = object;

export type LokiHelmValuesBloomPlannerPodAnnotations = object;

export type LokiHelmValuesBloomPlannerAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"bloom-planner","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesBloomPlannerAffinityPodAntiAffinity;
};

export type LokiHelmValuesBloomPlannerAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesBloomPlannerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesBloomPlannerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"bloom-planner","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesBloomPlannerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesBloomPlannerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"bloom-planner","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesBloomPlannerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesBloomPlannerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "bloom-planner"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesBloomPlannerServiceLabels = object;

export type LokiHelmValuesBloomPlannerServiceAnnotations = object;

export type LokiHelmValuesBloomPlannerReadinessProbe = object;

export type LokiHelmValuesBloomPlannerLivenessProbe = object;

export type LokiHelmValuesBloomPlannerStartupProbe = object;

export type LokiHelmValuesBloomPlannerResources = object;

export type LokiHelmValuesBloomPlannerNodeSelector = object;

export type LokiHelmValuesBloomPlannerAppProtocol = {
  /**
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesBloomPlannerPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable creating PVCs for the bloom-planner
   *
   * @default false
   */
  enabled?: boolean;
  claims?: LokiHelmValuesBloomPlannerPersistenceClaimsElement[];
  /**
   * Enable StatefulSetAutoDeletePVC feature
   *
   * @default false
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  /**
   * @default "Retain"
   */
  whenDeleted?: string;
  /**
   * @default "Retain"
   */
  whenScaled?: string;
};

export type LokiHelmValuesBloomPlannerPersistenceClaimsElement = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "data"
   */
  name?: string;
  accessModes?: string[];
  /**
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesBloomPlannerPersistenceClaimsAnnotations;
  /**
   * @default {}
   */
  labels?: LokiHelmValuesBloomPlannerPersistenceClaimsLabels;
};

export type LokiHelmValuesBloomPlannerPersistenceClaimsAnnotations = object;

export type LokiHelmValuesBloomPlannerPersistenceClaimsLabels = object;

export type LokiHelmValuesBloomPlannerServiceAccount = {
  /**
   * @default false
   */
  create?: boolean;
  name?: unknown;
  imagePullSecrets?: unknown[];
  /**
   * Annotations for the bloom-planner service account
   *
   * @default {}
   */
  annotations?: LokiHelmValuesBloomPlannerServiceAccountAnnotations;
  /**
   * Set this toggle to false to opt out of automounting API credentials for the service account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type LokiHelmValuesBloomPlannerServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesBloomBuilder = {
  /**
   * Number of replicas for the bloom-builder
   *
   * @default 0
   */
  replicas?: number;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the boom-builder
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * DNSConfig for bloom-builder pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesBloomBuilderDnsConfig;
  /**
   * @default {...} (7 keys)
   */
  autoscaling?: LokiHelmValuesBloomBuilderAutoscaling;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesBloomBuilderImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for bloom-builder pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesBloomBuilderPodLabels;
  /**
   * Annotations for bloom-builder pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesBloomBuilderPodAnnotations;
  /**
   * Labels for bloom-builder service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesBloomBuilderServiceLabels;
  /**
   * Annotations for bloom-builder service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesBloomBuilderServiceAnnotations;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the bloom-builder
   *
   * @default {}
   */
  resources?: LokiHelmValuesBloomBuilderResources;
  initContainers?: unknown[];
  extraContainers?: unknown[];
  /**
   * Grace period to allow the bloom-builder to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Affinity for bloom-builder pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"bloom-builder","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesBloomBuilderAffinity;
  maxUnavailable?: unknown;
  /**
   * Node selector for bloom-builder pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesBloomBuilderNodeSelector;
  tolerations?: unknown[];
  /**
   * Adds the appProtocol field to the queryFrontend service. This allows bloomBuilder to work with istio protocol selection.
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesBloomBuilderAppProtocol;
};

export type LokiHelmValuesBloomBuilderDnsConfig = object;

export type LokiHelmValuesBloomBuilderAutoscaling = {
  /**
   * Enable autoscaling for the bloom-builder
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum autoscaling replicas for the bloom-builder
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum autoscaling replicas for the bloom-builder
   *
   * @default 3
   */
  maxReplicas?: number;
  /**
   * Target CPU utilisation percentage for the bloom-builder
   *
   * @default 60
   */
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: unknown;
  customMetrics?: unknown[];
  /**
   * @default {"enabled":false,"scaleDown":{},"scaleUp":{}}
   */
  behavior?: LokiHelmValuesBloomBuilderAutoscalingBehavior;
};

export type LokiHelmValuesBloomBuilderAutoscalingBehavior = {
  /**
   * Enable autoscaling behaviours
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * define scale down policies, must conform to HPAScalingRules
   *
   * @default {}
   */
  scaleDown?: LokiHelmValuesBloomBuilderAutoscalingBehaviorScaleDown;
  /**
   * define scale up policies, must conform to HPAScalingRules
   *
   * @default {}
   */
  scaleUp?: LokiHelmValuesBloomBuilderAutoscalingBehaviorScaleUp;
};

export type LokiHelmValuesBloomBuilderAutoscalingBehaviorScaleDown = object;

export type LokiHelmValuesBloomBuilderAutoscalingBehaviorScaleUp = object;

export type LokiHelmValuesBloomBuilderImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesBloomBuilderPodLabels = object;

export type LokiHelmValuesBloomBuilderPodAnnotations = object;

export type LokiHelmValuesBloomBuilderServiceLabels = object;

export type LokiHelmValuesBloomBuilderServiceAnnotations = object;

export type LokiHelmValuesBloomBuilderResources = object;

export type LokiHelmValuesBloomBuilderAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"bloom-builder","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesBloomBuilderAffinityPodAntiAffinity;
};

export type LokiHelmValuesBloomBuilderAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesBloomBuilderAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesBloomBuilderAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"bloom-builder","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesBloomBuilderAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesBloomBuilderAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"bloom-builder","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesBloomBuilderAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesBloomBuilderAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "bloom-builder"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesBloomBuilderNodeSelector = object;

export type LokiHelmValuesBloomBuilderAppProtocol = {
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesPatternIngester = {
  /**
   * Number of replicas for the pattern ingester
   *
   * @default 0
   */
  replicas?: number;
  /**
   * DNSConfig for pattern ingester pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesPatternIngesterDnsConfig;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the pattern ingester
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesPatternIngesterImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for pattern ingester pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesPatternIngesterPodLabels;
  /**
   * Annotations for pattern ingester pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesPatternIngesterPodAnnotations;
  /**
   * Affinity for pattern ingester pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"pattern-ingester","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesPatternIngesterAffinity;
  maxUnavailable?: unknown;
  /**
   * Labels for pattern ingester service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesPatternIngesterServiceLabels;
  /**
   * Annotations for pattern ingester service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesPatternIngesterServiceAnnotations;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * readiness probe settings for pattern ingester pods. If empty, use `loki.readinessProbe`
   *
   * @default {}
   */
  readinessProbe?: LokiHelmValuesPatternIngesterReadinessProbe;
  /**
   * liveness probe settings for pattern ingester pods. If empty use `loki.livenessProbe`
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesPatternIngesterLivenessProbe;
  /**
   * startup probe settings for pattern ingester pods. If empty use `loki.startupProbe`
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesPatternIngesterStartupProbe;
  /**
   * Resource requests and limits for the pattern ingester
   *
   * @default {}
   */
  resources?: LokiHelmValuesPatternIngesterResources;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  /**
   * Grace period to allow the pattern ingester to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Node selector for pattern ingester pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesPatternIngesterNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesPatternIngesterAppProtocol;
  /**
   * @default {...} (7 keys)
   */
  persistence?: LokiHelmValuesPatternIngesterPersistence;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: LokiHelmValuesPatternIngesterServiceAccount;
};

export type LokiHelmValuesPatternIngesterDnsConfig = object;

export type LokiHelmValuesPatternIngesterImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesPatternIngesterPodLabels = object;

export type LokiHelmValuesPatternIngesterPodAnnotations = object;

export type LokiHelmValuesPatternIngesterAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"pattern-ingester","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesPatternIngesterAffinityPodAntiAffinity;
};

export type LokiHelmValuesPatternIngesterAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesPatternIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesPatternIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement =
  {
    /**
     * @default {"matchLabels":{"app.kubernetes.io/component":"pattern-ingester","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
     */
    labelSelector?: LokiHelmValuesPatternIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
    /**
     * @default "kubernetes.io/hostname"
     */
    topologyKey?: string;
  };

export type LokiHelmValuesPatternIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"pattern-ingester","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesPatternIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesPatternIngesterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "pattern-ingester"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesPatternIngesterServiceLabels = object;

export type LokiHelmValuesPatternIngesterServiceAnnotations = object;

export type LokiHelmValuesPatternIngesterReadinessProbe = object;

export type LokiHelmValuesPatternIngesterLivenessProbe = object;

export type LokiHelmValuesPatternIngesterStartupProbe = object;

export type LokiHelmValuesPatternIngesterResources = object;

export type LokiHelmValuesPatternIngesterNodeSelector = object;

export type LokiHelmValuesPatternIngesterAppProtocol = {
  /**
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesPatternIngesterPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable creating PVCs for the pattern ingester
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Size of persistent disk
   *
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  claims?: LokiHelmValuesPatternIngesterPersistenceClaimsElement[];
  /**
   * @default false
   */
  enableStatefulSetAutoDeletePVC?: boolean;
  /**
   * @default "Retain"
   */
  whenDeleted?: string;
  /**
   * @default "Retain"
   */
  whenScaled?: string;
};

export type LokiHelmValuesPatternIngesterPersistenceClaimsElement = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "data"
   */
  name?: string;
  accessModes?: string[];
  /**
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesPatternIngesterPersistenceClaimsAnnotations;
  /**
   * @default {}
   */
  labels?: LokiHelmValuesPatternIngesterPersistenceClaimsLabels;
};

export type LokiHelmValuesPatternIngesterPersistenceClaimsAnnotations = object;

export type LokiHelmValuesPatternIngesterPersistenceClaimsLabels = object;

export type LokiHelmValuesPatternIngesterServiceAccount = {
  /**
   * @default false
   */
  create?: boolean;
  name?: unknown;
  imagePullSecrets?: unknown[];
  /**
   * Annotations for the pattern ingester service account
   *
   * @default {}
   */
  annotations?: LokiHelmValuesPatternIngesterServiceAccountAnnotations;
  /**
   * Set this toggle to false to opt out of automounting API credentials for the service account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type LokiHelmValuesPatternIngesterServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesRuler = {
  /**
   * The ruler component is optional and can be disabled if desired.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Whether to enable the rules sidecar
   *
   * @default false
   */
  sidecar?: boolean;
  /**
   * Number of replicas for the ruler
   *
   * @default 0
   */
  replicas?: number;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the ruler
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesRulerImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for compactor pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesRulerPodLabels;
  /**
   * Annotations for ruler pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesRulerPodAnnotations;
  /**
   * Labels for ruler service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesRulerServiceLabels;
  /**
   * Annotations for ruler service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesRulerServiceAnnotations;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the ruler
   *
   * @default {}
   */
  resources?: LokiHelmValuesRulerResources;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  /**
   * Grace period to allow the ruler to shutdown before it is killed
   *
   * @default 300
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Affinity for ruler pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"ruler","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesRulerAffinity;
  maxUnavailable?: unknown;
  /**
   * Node selector for ruler pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesRulerNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * DNSConfig for ruler pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesRulerDnsConfig;
  /**
   * @default {...} (7 keys)
   */
  persistence?: LokiHelmValuesRulerPersistence;
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesRulerAppProtocol;
  /**
   * Directories containing rules files. If used, you must also configure `loki.rulerConfig.storage` to use local storage.
   *
   * @default {}
   */
  directories?: LokiHelmValuesRulerDirectories;
};

export type LokiHelmValuesRulerImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesRulerPodLabels = object;

export type LokiHelmValuesRulerPodAnnotations = object;

export type LokiHelmValuesRulerServiceLabels = object;

export type LokiHelmValuesRulerServiceAnnotations = object;

export type LokiHelmValuesRulerResources = object;

export type LokiHelmValuesRulerAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"ruler","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesRulerAffinityPodAntiAffinity;
};

export type LokiHelmValuesRulerAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesRulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesRulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"ruler","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesRulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesRulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector = {
  /**
   * @default {"app.kubernetes.io/component":"ruler","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
   */
  matchLabels?: LokiHelmValuesRulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
};

export type LokiHelmValuesRulerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "ruler"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesRulerNodeSelector = object;

export type LokiHelmValuesRulerDnsConfig = object;

export type LokiHelmValuesRulerPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable creating PVCs which is required when using recording rules
   *
   * @default false
   */
  enabled?: boolean;
  accessModes?: string[];
  /**
   * Size of persistent disk
   *
   * @default "10Gi"
   */
  size?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  /**
   * Annotations for ruler PVCs
   *
   * @default {}
   */
  annotations?: LokiHelmValuesRulerPersistenceAnnotations;
  /**
   * Labels for ruler PVCs
   *
   * @default {}
   */
  labels?: LokiHelmValuesRulerPersistenceLabels;
};

export type LokiHelmValuesRulerPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesRulerPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesRulerAppProtocol = {
  /**
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesRulerDirectories = object;

export type LokiHelmValuesOverridesExporter = {
  /**
   * The overrides-exporter component is optional and can be disabled if desired.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Number of replicas for the overrides-exporter
   *
   * @default 0
   */
  replicas?: number;
  /**
   * DNSConfig for overrides-exporter
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesOverridesExporterDnsConfig;
  hostAliases?: unknown[];
  /**
   * Use the host's user namespace in the overrides-exporter
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesOverridesExporterImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for overrides-exporter pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesOverridesExporterPodLabels;
  /**
   * Annotations for overrides-exporter pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesOverridesExporterPodAnnotations;
  /**
   * Labels for overrides-exporter service
   *
   * @default {}
   */
  serviceLabels?: LokiHelmValuesOverridesExporterServiceLabels;
  /**
   * Annotations for overrides-exporter service
   *
   * @default {}
   */
  serviceAnnotations?: LokiHelmValuesOverridesExporterServiceAnnotations;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the overrides-exporter
   *
   * @default {}
   */
  resources?: LokiHelmValuesOverridesExporterResources;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  /**
   * Grace period to allow the overrides-exporter to shutdown before it is killed
   *
   * @default 300
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Affinity for overrides-exporter pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"overrides-exporter","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesOverridesExporterAffinity;
  maxUnavailable?: unknown;
  /**
   * Node selector for overrides-exporter pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesOverridesExporterNodeSelector;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Set the optional grpc service protocol. Ex: "grpc", "http2" or "https"
   *
   * @default {"grpc":""}
   */
  appProtocol?: LokiHelmValuesOverridesExporterAppProtocol;
};

export type LokiHelmValuesOverridesExporterDnsConfig = object;

export type LokiHelmValuesOverridesExporterImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesOverridesExporterPodLabels = object;

export type LokiHelmValuesOverridesExporterPodAnnotations = object;

export type LokiHelmValuesOverridesExporterServiceLabels = object;

export type LokiHelmValuesOverridesExporterServiceAnnotations = object;

export type LokiHelmValuesOverridesExporterResources = object;

export type LokiHelmValuesOverridesExporterAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"overrides-exporter","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesOverridesExporterAffinityPodAntiAffinity;
};

export type LokiHelmValuesOverridesExporterAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesOverridesExporterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesOverridesExporterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement =
  {
    /**
     * @default {"matchLabels":{"app.kubernetes.io/component":"overrides-exporter","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
     */
    labelSelector?: LokiHelmValuesOverridesExporterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
    /**
     * @default "kubernetes.io/hostname"
     */
    topologyKey?: string;
  };

export type LokiHelmValuesOverridesExporterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"overrides-exporter","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesOverridesExporterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesOverridesExporterAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "overrides-exporter"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesOverridesExporterNodeSelector = object;

export type LokiHelmValuesOverridesExporterAppProtocol = {
  /**
   * @default ""
   */
  grpc?: string;
};

export type LokiHelmValuesMemcached = {
  /**
   * Enable the built in memcached server provided by the chart
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"repository":"memcached","tag":"1.6.39-alpine","pullPolicy":"IfNotPresent"}
   */
  image?: LokiHelmValuesMemcachedImage;
  /**
   * The SecurityContext override for memcached pods
   *
   * @default {...} (4 keys)
   */
  podSecurityContext?: LokiHelmValuesMemcachedPodSecurityContext;
  priorityClassName?: unknown;
  /**
   * The SecurityContext for memcached containers
   *
   * @default {"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}
   */
  containerSecurityContext?: LokiHelmValuesMemcachedContainerSecurityContext;
  /**
   * Readiness probe for memcached pods (probe port defaults to container port)
   *
   * @default {...} (5 keys)
   */
  readinessProbe?: LokiHelmValuesMemcachedReadinessProbe;
  /**
   * Liveness probe for memcached pods
   *
   * @default {...} (5 keys)
   */
  livenessProbe?: LokiHelmValuesMemcachedLivenessProbe;
  /**
   * Startup probe for memcached pods
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesMemcachedStartupProbe;
};

export type LokiHelmValuesMemcachedImage = {
  /**
   * Memcached Docker image repository
   *
   * @default "memcached"
   */
  repository?: string;
  /**
   * Memcached Docker image tag
   *
   * @default "1.6.39-alpine"
   */
  tag?: string;
  /**
   * Memcached Docker image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type LokiHelmValuesMemcachedPodSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 11211
   */
  runAsUser?: number;
  /**
   * @default 11211
   */
  runAsGroup?: number;
  /**
   * @default 11211
   */
  fsGroup?: number;
};

export type LokiHelmValuesMemcachedContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: LokiHelmValuesMemcachedContainerSecurityContextCapabilities;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type LokiHelmValuesMemcachedContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type LokiHelmValuesMemcachedReadinessProbe = {
  /**
   * @default {"port":"client"}
   */
  tcpSocket?: LokiHelmValuesMemcachedReadinessProbeTcpSocket;
  /**
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * @default 5
   */
  periodSeconds?: number;
  /**
   * @default 3
   */
  timeoutSeconds?: number;
  /**
   * @default 6
   */
  failureThreshold?: number;
};

export type LokiHelmValuesMemcachedReadinessProbeTcpSocket = {
  /**
   * @default "client"
   */
  port?: string;
};

export type LokiHelmValuesMemcachedLivenessProbe = {
  /**
   * @default {"port":"client"}
   */
  tcpSocket?: LokiHelmValuesMemcachedLivenessProbeTcpSocket;
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
};

export type LokiHelmValuesMemcachedLivenessProbeTcpSocket = {
  /**
   * @default "client"
   */
  port?: string;
};

export type LokiHelmValuesMemcachedStartupProbe = object;

export type LokiHelmValuesMemcachedExporter = {
  /**
   * Whether memcached metrics should be exported
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"repository":"prom/memcached-exporter","tag":"v0.15.4","pullPolicy":"IfNotPresent"}
   */
  image?: LokiHelmValuesMemcachedExporterImage;
  /**
   * @default {"requests":{},"limits":{}}
   */
  resources?: LokiHelmValuesMemcachedExporterResources;
  /**
   * The SecurityContext for memcached exporter containers
   *
   * @default {"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}
   */
  containerSecurityContext?: LokiHelmValuesMemcachedExporterContainerSecurityContext;
  /**
   * Extra args to add to the exporter container.
   * Example:
   * extraArgs:
   * memcached.tls.server-name: memcached
   *
   * @default {}
   */
  extraArgs?: LokiHelmValuesMemcachedExporterExtraArgs;
  /**
   * Liveness probe for memcached exporter
   *
   * @default {...} (5 keys)
   */
  livenessProbe?: LokiHelmValuesMemcachedExporterLivenessProbe;
  /**
   * Readiness probe for memcached exporter
   *
   * @default {...} (5 keys)
   */
  readinessProbe?: LokiHelmValuesMemcachedExporterReadinessProbe;
  /**
   * Startup probe for memcached exporter
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesMemcachedExporterStartupProbe;
};

export type LokiHelmValuesMemcachedExporterImage = {
  /**
   * @default "prom/memcached-exporter"
   */
  repository?: string;
  /**
   * @default "v0.15.4"
   */
  tag?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type LokiHelmValuesMemcachedExporterResources = {
  /**
   * @default {}
   */
  requests?: LokiHelmValuesMemcachedExporterResourcesRequests;
  /**
   * @default {}
   */
  limits?: LokiHelmValuesMemcachedExporterResourcesLimits;
};

export type LokiHelmValuesMemcachedExporterResourcesRequests = object;

export type LokiHelmValuesMemcachedExporterResourcesLimits = object;

export type LokiHelmValuesMemcachedExporterContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: LokiHelmValuesMemcachedExporterContainerSecurityContextCapabilities;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type LokiHelmValuesMemcachedExporterContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type LokiHelmValuesMemcachedExporterExtraArgs = object;

export type LokiHelmValuesMemcachedExporterLivenessProbe = {
  /**
   * @default {"path":"/metrics","port":"http-metrics"}
   */
  httpGet?: LokiHelmValuesMemcachedExporterLivenessProbeHttpGet;
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
};

export type LokiHelmValuesMemcachedExporterLivenessProbeHttpGet = {
  /**
   * @default "/metrics"
   */
  path?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
};

export type LokiHelmValuesMemcachedExporterReadinessProbe = {
  /**
   * @default {"path":"/metrics","port":"http-metrics"}
   */
  httpGet?: LokiHelmValuesMemcachedExporterReadinessProbeHttpGet;
  /**
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * @default 5
   */
  periodSeconds?: number;
  /**
   * @default 3
   */
  timeoutSeconds?: number;
  /**
   * @default 3
   */
  failureThreshold?: number;
};

export type LokiHelmValuesMemcachedExporterReadinessProbeHttpGet = {
  /**
   * @default "/metrics"
   */
  path?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
};

export type LokiHelmValuesMemcachedExporterStartupProbe = object;

export type LokiHelmValuesResultsCache = {
  /**
   * Specifies whether memcached based results-cache should be enabled
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Comma separated addresses list in DNS Service Discovery format
   *
   * @default "dnssrvnoa+_memcached-client._tcp.{{ include "lo..."
   */
  addresses?: string;
  /**
   * Specify how long cached results should be stored in the results-cache before being expired
   *
   * @default "12h"
   */
  defaultValidity?: string;
  /**
   * Memcached operation timeout
   *
   * @default "500ms"
   */
  timeout?: string;
  /**
   * Total number of results-cache replicas
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Port of the results-cache service
   *
   * @default 11211
   */
  port?: number;
  /**
   * Amount of memory allocated to results-cache for object storage (in MB).
   *
   * @default 1024
   */
  allocatedMemory?: number;
  /**
   * Maximum item results-cache for memcached (in MB).
   *
   * @default 5
   */
  maxItemMemory?: number;
  /**
   * Maximum number of connections allowed
   *
   * @default 16384
   */
  connectionLimit?: number;
  /**
   * Max memory to use for cache write back
   *
   * @default "500MB"
   */
  writebackSizeLimit?: string;
  /**
   * Max number of objects to use for cache write back
   *
   * @default 500000
   */
  writebackBuffer?: number;
  /**
   * Number of parallel threads for cache write back
   *
   * @default 1
   */
  writebackParallelism?: number;
  initContainers?: unknown[];
  /**
   * Annotations for the results-cache pods
   *
   * @default {}
   */
  annotations?: LokiHelmValuesResultsCacheAnnotations;
  /**
   * Node selector for results-cache pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesResultsCacheNodeSelector;
  /**
   * Affinity for results-cache pods
   *
   * @default {}
   */
  affinity?: LokiHelmValuesResultsCacheAffinity;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Pod Disruption Budget maxUnavailable
   *
   * @default 1
   */
  maxUnavailable?: number;
  /**
   * DNSConfig for results-cache
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesResultsCacheDnsConfig;
  priorityClassName?: unknown;
  /**
   * Use the host's user namespace in results-cache pods
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Labels for results-cache pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesResultsCachePodLabels;
  /**
   * Annotations for results-cache pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesResultsCachePodAnnotations;
  /**
   * Management policy for results-cache pods
   *
   * @default "Parallel"
   */
  podManagementPolicy?: string;
  /**
   * Grace period to allow the results-cache to shutdown before it is killed
   *
   * @default 60
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Stateful results-cache strategy
   *
   * @default {"type":"RollingUpdate"}
   */
  statefulStrategy?: LokiHelmValuesResultsCacheStatefulStrategy;
  /**
   * Add extended options for results-cache memcached container. The format is the same as for the memcached -o/--extend flag.
   * Example:
   * extraExtendedOptions: 'tls,modern,track_sizes'
   *
   * @default ""
   */
  extraExtendedOptions?: string;
  /**
   * Additional CLI args for results-cache
   *
   * @default {}
   */
  extraArgs?: LokiHelmValuesResultsCacheExtraArgs;
  extraContainers?: unknown[];
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  resources?: unknown;
  /**
   * Service annotations and labels
   *
   * @default {"annotations":{},"labels":{}}
   */
  service?: LokiHelmValuesResultsCacheService;
  /**
   * Persistence settings for the results-cache
   *
   * @default {...} (6 keys)
   */
  persistence?: LokiHelmValuesResultsCachePersistence;
};

export type LokiHelmValuesResultsCacheAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesResultsCacheNodeSelector = object;

export type LokiHelmValuesResultsCacheAffinity = object;

export type LokiHelmValuesResultsCacheDnsConfig = object;

export type LokiHelmValuesResultsCachePodLabels = object;

export type LokiHelmValuesResultsCachePodAnnotations = object;

export type LokiHelmValuesResultsCacheStatefulStrategy = {
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type LokiHelmValuesResultsCacheExtraArgs = object;

export type LokiHelmValuesResultsCacheService = {
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesResultsCacheServiceAnnotations;
  /**
   * @default {}
   */
  labels?: LokiHelmValuesResultsCacheServiceLabels;
};

export type LokiHelmValuesResultsCacheServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesResultsCacheServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesResultsCachePersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable creating PVCs for the results-cache
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Size of persistent disk, must be in G or Gi
   *
   * @default "10G"
   */
  storageSize?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  /**
   * Volume mount path
   *
   * @default "/data"
   */
  mountPath?: string;
  /**
   * PVC additional labels
   *
   * @default {}
   */
  labels?: LokiHelmValuesResultsCachePersistenceLabels;
};

export type LokiHelmValuesResultsCachePersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesChunksCache = {
  /**
   * Append to the name of the resources to make names different for l1 and l2
   *
   * @default ""
   */
  suffix?: string;
  /**
   * Specifies whether memcached based chunks-cache should be enabled
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Comma separated addresses list in DNS Service Discovery format
   *
   * @default "dnssrvnoa+_memcached-client._tcp.{{ include "lo..."
   */
  addresses?: string;
  /**
   * Batchsize for sending and receiving chunks from chunks cache
   *
   * @default 4
   */
  batchSize?: number;
  /**
   * Parallel threads for sending and receiving chunks from chunks cache
   *
   * @default 5
   */
  parallelism?: number;
  /**
   * Memcached operation timeout
   *
   * @default "2000ms"
   */
  timeout?: string;
  /**
   * Specify how long cached chunks should be stored in the chunks-cache before being expired
   *
   * @default "0s"
   */
  defaultValidity?: string;
  /**
   * Specify how long cached chunks should be stored in the chunks-cache before being expired
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Port of the chunks-cache service
   *
   * @default 11211
   */
  port?: number;
  /**
   * Amount of memory allocated to chunks-cache for object storage (in MB).
   *
   * @default 8192
   */
  allocatedMemory?: number;
  /**
   * Maximum item memory for chunks-cache (in MB).
   *
   * @default 5
   */
  maxItemMemory?: number;
  /**
   * Maximum number of connections allowed
   *
   * @default 16384
   */
  connectionLimit?: number;
  /**
   * Max memory to use for cache write back
   *
   * @default "500MB"
   */
  writebackSizeLimit?: string;
  /**
   * Max number of objects to use for cache write back
   *
   * @default 500000
   */
  writebackBuffer?: number;
  /**
   * Number of parallel threads for cache write back
   *
   * @default 1
   */
  writebackParallelism?: number;
  initContainers?: unknown[];
  /**
   * Annotations for the chunks-cache pods
   *
   * @default {}
   */
  annotations?: LokiHelmValuesChunksCacheAnnotations;
  /**
   * Node selector for chunks-cache pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesChunksCacheNodeSelector;
  /**
   * Affinity for chunks-cache pods
   *
   * @default {}
   */
  affinity?: LokiHelmValuesChunksCacheAffinity;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Pod Disruption Budget maxUnavailable
   *
   * @default 1
   */
  maxUnavailable?: number;
  /**
   * DNSConfig for chunks-cache
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesChunksCacheDnsConfig;
  priorityClassName?: unknown;
  /**
   * Use the host's user namespace in chunks-cache pods
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Labels for chunks-cache pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesChunksCachePodLabels;
  /**
   * Annotations for chunks-cache pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesChunksCachePodAnnotations;
  /**
   * Management policy for chunks-cache pods
   *
   * @default "Parallel"
   */
  podManagementPolicy?: string;
  /**
   * Grace period to allow the chunks-cache to shutdown before it is killed
   *
   * @default 60
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Stateful chunks-cache strategy
   *
   * @default {"type":"RollingUpdate"}
   */
  statefulStrategy?: LokiHelmValuesChunksCacheStatefulStrategy;
  /**
   * Add extended options for chunks-cache memcached container. The format is the same as for the memcached -o/--extend flag.
   * Example:
   * extraExtendedOptions: 'tls,no_hashexpand'
   *
   * @default ""
   */
  extraExtendedOptions?: string;
  /**
   * Additional CLI args for chunks-cache
   *
   * @default {}
   */
  extraArgs?: LokiHelmValuesChunksCacheExtraArgs;
  extraContainers?: unknown[];
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  resources?: unknown;
  /**
   * Service annotations and labels
   *
   * @default {"annotations":{},"labels":{}}
   */
  service?: LokiHelmValuesChunksCacheService;
  /**
   * Persistence settings for the chunks-cache
   *
   * @default {...} (6 keys)
   */
  persistence?: LokiHelmValuesChunksCachePersistence;
  /**
   * l2 memcache configuration
   *
   * @default {...} (39 keys)
   */
  l2?: LokiHelmValuesChunksCacheL2;
};

export type LokiHelmValuesChunksCacheAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesChunksCacheNodeSelector = object;

export type LokiHelmValuesChunksCacheAffinity = object;

export type LokiHelmValuesChunksCacheDnsConfig = object;

export type LokiHelmValuesChunksCachePodLabels = object;

export type LokiHelmValuesChunksCachePodAnnotations = object;

export type LokiHelmValuesChunksCacheStatefulStrategy = {
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type LokiHelmValuesChunksCacheExtraArgs = object;

export type LokiHelmValuesChunksCacheService = {
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesChunksCacheServiceAnnotations;
  /**
   * @default {}
   */
  labels?: LokiHelmValuesChunksCacheServiceLabels;
};

export type LokiHelmValuesChunksCacheServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesChunksCacheServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesChunksCachePersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable creating PVCs for the chunks-cache
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Size of persistent disk, must be in G or Gi
   *
   * @default "10G"
   */
  storageSize?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  /**
   * Volume mount path
   *
   * @default "/data"
   */
  mountPath?: string;
  /**
   * @default {}
   */
  labels?: LokiHelmValuesChunksCachePersistenceLabels;
};

export type LokiHelmValuesChunksCachePersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesChunksCacheL2 = {
  /**
   * Append to the name of the resources to make names different for l1 and l2
   *
   * @default "l2"
   */
  suffix?: string;
  /**
   * The age of chunks should be transfered from l1 cache to l2
   * 4 days
   *
   * @default "345600s"
   */
  l2ChunkCacheHandoff?: string;
  /**
   * Specifies whether memcached based chunks-cache-l2 should be enabled
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Comma separated addresses list in DNS Service Discovery format
   *
   * @default "dnssrvnoa+_memcached-client._tcp.{{ include "lo..."
   */
  addresses?: string;
  /**
   * Batchsize for sending and receiving chunks from chunks cache
   *
   * @default 4
   */
  batchSize?: number;
  /**
   * Parallel threads for sending and receiving chunks from chunks cache
   *
   * @default 5
   */
  parallelism?: number;
  /**
   * Memcached operation timeout
   *
   * @default "2000ms"
   */
  timeout?: string;
  /**
   * Specify how long cached chunks should be stored in the chunks-cache-l2 before being expired
   *
   * @default "0s"
   */
  defaultValidity?: string;
  /**
   * Specify how long cached chunks should be stored in the chunks-cache-l2 before being expired
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Port of the chunks-cache-l2 service
   *
   * @default 11211
   */
  port?: number;
  /**
   * Amount of memory allocated to chunks-cache-l2 for object storage (in MB).
   *
   * @default 8192
   */
  allocatedMemory?: number;
  /**
   * Maximum item memory for chunks-cache-l2 (in MB).
   *
   * @default 5
   */
  maxItemMemory?: number;
  /**
   * Maximum number of connections allowed
   *
   * @default 16384
   */
  connectionLimit?: number;
  /**
   * Max memory to use for cache write back
   *
   * @default "500MB"
   */
  writebackSizeLimit?: string;
  /**
   * Max number of objects to use for cache write back
   *
   * @default 500000
   */
  writebackBuffer?: number;
  /**
   * Number of parallel threads for cache write back
   *
   * @default 1
   */
  writebackParallelism?: number;
  initContainers?: unknown[];
  /**
   * Annotations for the chunks-cache-l2 pods
   *
   * @default {}
   */
  annotations?: LokiHelmValuesChunksCacheL2Annotations;
  /**
   * Node selector for chunks-cach-l2 pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesChunksCacheL2NodeSelector;
  /**
   * Affinity for chunks-cache-l2 pods
   *
   * @default {}
   */
  affinity?: LokiHelmValuesChunksCacheL2Affinity;
  topologySpreadConstraints?: unknown[];
  tolerations?: unknown[];
  /**
   * Pod Disruption Budget maxUnavailable
   *
   * @default 1
   */
  maxUnavailable?: number;
  /**
   * DNSConfig for chunks-cache-l2
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesChunksCacheL2DnsConfig;
  priorityClassName?: unknown;
  /**
   * Use the host's user namespace in chunks-cache-l2 pods
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Labels for chunks-cache-l2 pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesChunksCacheL2PodLabels;
  /**
   * Annotations for chunks-cache-l2 pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesChunksCacheL2PodAnnotations;
  /**
   * Management policy for chunks-cache-l2 pods
   *
   * @default "Parallel"
   */
  podManagementPolicy?: string;
  /**
   * Grace period to allow the chunks-cache-l2 to shutdown before it is killed
   *
   * @default 60
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Stateful chunks-cache strategy
   *
   * @default {"type":"RollingUpdate"}
   */
  statefulStrategy?: LokiHelmValuesChunksCacheL2StatefulStrategy;
  /**
   * Add extended options for chunks-cache-l2 memcached container. The format is the same as for the memcached -o/--extend flag.
   * Example:
   * extraExtendedOptions: 'tls,no_hashexpand'
   *
   * @default ""
   */
  extraExtendedOptions?: string;
  /**
   * Additional CLI args for chunks-cache-l2
   *
   * @default {}
   */
  extraArgs?: LokiHelmValuesChunksCacheL2ExtraArgs;
  extraContainers?: unknown[];
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  resources?: unknown;
  /**
   * Service annotations and labels
   *
   * @default {"annotations":{},"labels":{}}
   */
  service?: LokiHelmValuesChunksCacheL2Service;
  /**
   * Persistence settings for the chunks-cache-l2
   *
   * @default {...} (6 keys)
   */
  persistence?: LokiHelmValuesChunksCacheL2Persistence;
};

export type LokiHelmValuesChunksCacheL2Annotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesChunksCacheL2NodeSelector = object;

export type LokiHelmValuesChunksCacheL2Affinity = object;

export type LokiHelmValuesChunksCacheL2DnsConfig = object;

export type LokiHelmValuesChunksCacheL2PodLabels = object;

export type LokiHelmValuesChunksCacheL2PodAnnotations = object;

export type LokiHelmValuesChunksCacheL2StatefulStrategy = {
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type LokiHelmValuesChunksCacheL2ExtraArgs = object;

export type LokiHelmValuesChunksCacheL2Service = {
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesChunksCacheL2ServiceAnnotations;
  /**
   * @default {}
   */
  labels?: LokiHelmValuesChunksCacheL2ServiceLabels;
};

export type LokiHelmValuesChunksCacheL2ServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesChunksCacheL2ServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesChunksCacheL2Persistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable creating PVCs for the chunks-cache-l2
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Size of persistent disk, must be in G or Gi
   *
   * @default "10G"
   */
  storageSize?: string;
  storageClass?: unknown;
  volumeAttributesClassName?: unknown;
  /**
   * Volume mount path
   *
   * @default "/data"
   */
  mountPath?: string;
  /**
   * @default {}
   */
  labels?: LokiHelmValuesChunksCacheL2PersistenceLabels;
};

export type LokiHelmValuesChunksCacheL2PersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesRolloutoperator = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * podSecurityContext is the pod security context for the rollout operator.
   * When installing on OpenShift, override podSecurityContext settings with
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: LokiHelmValuesRolloutoperatorPodSecurityContext;
  /**
   * Set the container security context
   *
   * @default {"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}
   */
  securityContext?: LokiHelmValuesRolloutoperatorSecurityContext;
};

export type LokiHelmValuesRolloutoperatorPodSecurityContext = {
  /**
   * @default 10001
   */
  fsGroup?: number;
  /**
   * @default 10001
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 10001
   */
  runAsUser?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: LokiHelmValuesRolloutoperatorPodSecurityContextSeccompProfile;
};

export type LokiHelmValuesRolloutoperatorPodSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type LokiHelmValuesRolloutoperatorSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: LokiHelmValuesRolloutoperatorSecurityContextCapabilities;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type LokiHelmValuesRolloutoperatorSecurityContextCapabilities = {
  drop?: string[];
};

export type LokiHelmValuesMinio = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * Minio requires 2 to 16 drives for erasure code (drivesPerNode * replicas)
   * https://docs.min.io/docs/minio-erasure-code-quickstart-guide
   * Since we only have 1 replica, that means 2 drives must be used.
   *
   * @default 2
   */
  drivesPerNode?: number;
  /**
   * root user; not used for GEL authentication
   *
   * @default "root-user"
   */
  rootUser?: string;
  /**
   * @default "supersecretpassword"
   */
  rootPassword?: string;
  users?: LokiHelmValuesMinioUsersElement[];
  buckets?: LokiHelmValuesMinioBucketsElement[];
  /**
   * @default {"size":"5Gi","annotations":{}}
   */
  persistence?: LokiHelmValuesMinioPersistence;
  /**
   * @default {"requests":{"cpu":"100m","memory":"128Mi"}}
   */
  resources?: LokiHelmValuesMinioResources;
  address?: unknown;
};

export type LokiHelmValuesMinioUsersElement = {
  /**
   * @default "logs-user"
   */
  accessKey?: string;
  /**
   * @default "supersecretpassword"
   */
  secretKey?: string;
  /**
   * @default "readwrite"
   */
  policy?: string;
};

export type LokiHelmValuesMinioBucketsElement = {
  /**
   * @default "chunks"
   */
  name?: string;
  /**
   * @default "none"
   */
  policy?: string;
  /**
   * @default false
   */
  purge?: boolean;
};

export type LokiHelmValuesMinioPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "5Gi"
   */
  size?: string;
  /**
   * @default {}
   */
  annotations?: LokiHelmValuesMinioPersistenceAnnotations;
};

export type LokiHelmValuesMinioPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMinioResources = {
  /**
   * @default {"cpu":"100m","memory":"128Mi"}
   */
  requests?: LokiHelmValuesMinioResourcesRequests;
  /**
   * Kubernetes resource limits (memory, cpu, etc.)
   */
  limits?: LokiHelmValuesMinioResourcesLimits;
};

export type LokiHelmValuesMinioResourcesRequests = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "128Mi"
   */
  memory?: string;
};

export type LokiHelmValuesMinioResourcesLimits = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "128Mi"
   */
  memory?: string;
};

export type LokiHelmValuesSidecar = {
  /**
   * @default {...} (5 keys)
   */
  image?: LokiHelmValuesSidecarImage;
  /**
   * Resource requests and limits for the sidecar
   *
   * @default {}
   */
  resources?: LokiHelmValuesSidecarResources;
  /**
   * The SecurityContext for the sidecar.
   *
   * @default {"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}
   */
  securityContext?: LokiHelmValuesSidecarSecurityContext;
  /**
   * Set to true to skip tls verification for kube api calls.
   *
   * @default false
   */
  skipTlsVerify?: boolean;
  /**
   * Ensure that rule files aren't conflicting and being overwritten by prefixing their name with the namespace they are defined in.
   *
   * @default false
   */
  enableUniqueFilenames?: boolean;
  /**
   * Readiness probe definition. Probe is disabled on the sidecar by default.
   *
   * @default {}
   */
  readinessProbe?: LokiHelmValuesSidecarReadinessProbe;
  /**
   * Liveness probe definition. Probe is disabled on the sidecar by default.
   *
   * @default {}
   */
  livenessProbe?: LokiHelmValuesSidecarLivenessProbe;
  /**
   * Startup probe definition. Probe is disabled on the sidecar by default.
   *
   * @default {}
   */
  startupProbe?: LokiHelmValuesSidecarStartupProbe;
  /**
   * @default {...} (12 keys)
   */
  rules?: LokiHelmValuesSidecarRules;
};

export type LokiHelmValuesSidecarImage = {
  /**
   * @default "docker.io"
   */
  registry?: string;
  /**
   * The Docker registry and image for the k8s sidecar
   *
   * @default "kiwigrid/k8s-sidecar"
   */
  repository?: string;
  /**
   * Docker image tag
   *
   * @default "1.30.9"
   */
  tag?: string;
  /**
   * Docker image sha. If empty, no sha will be used
   *
   * @default ""
   */
  sha?: string;
  /**
   * Docker image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type LokiHelmValuesSidecarResources = object;

export type LokiHelmValuesSidecarSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: LokiHelmValuesSidecarSecurityContextCapabilities;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type LokiHelmValuesSidecarSecurityContextCapabilities = {
  drop?: string[];
};

export type LokiHelmValuesSidecarReadinessProbe = object;

export type LokiHelmValuesSidecarLivenessProbe = object;

export type LokiHelmValuesSidecarStartupProbe = object;

export type LokiHelmValuesSidecarRules = {
  /**
   * Whether or not to create a sidecar to ingest rule from specific ConfigMaps and/or Secrets.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Label that the configmaps/secrets with rules will be marked with.
   *
   * @default "loki_rule"
   */
  label?: string;
  /**
   * Label value that the configmaps/secrets with rules will be set to.
   *
   * @default ""
   */
  labelValue?: string;
  /**
   * Folder into which the rules will be placed.
   *
   * @default "/rules"
   */
  folder?: string;
  folderAnnotation?: unknown;
  searchNamespace?: unknown;
  /**
   * Method to use to detect ConfigMap changes. With WATCH the sidecar will do a WATCH request, with SLEEP it will list all ConfigMaps, then sleep for 60 seconds.
   *
   * @default "WATCH"
   */
  watchMethod?: string;
  /**
   * Search in configmap, secret, or both.
   *
   * @default "both"
   */
  resource?: string;
  script?: unknown;
  /**
   * WatchServerTimeout: request to the server, asking it to cleanly close the connection after that.
   * defaults to 60sec; much higher values like 3600 seconds (1h) are feasible for non-Azure K8S.
   *
   * @default 60
   */
  watchServerTimeout?: number;
  /**
   * WatchClientTimeout: is a client-side timeout, configuring your local socket.
   * If you have a network outage dropping all packets with no RST/FIN,
   * this is how long your client waits before realizing & dropping the connection.
   * Defaults to 66sec.
   *
   * @default 60
   */
  watchClientTimeout?: number;
  /**
   * Log level of the sidecar container.
   *
   * @default "INFO"
   */
  logLevel?: string;
};

export type LokiHelmValuesMonitoring = {
  /**
   * Dashboards for monitoring Loki
   *
   * @default {...} (4 keys)
   */
  dashboards?: LokiHelmValuesMonitoringDashboards;
  /**
   * Recording rules for monitoring Loki, required for some dashboards
   *
   * @default {...} (10 keys)
   */
  rules?: LokiHelmValuesMonitoringRules;
  /**
   * @default {...} (11 keys)
   */
  serviceMonitor?: LokiHelmValuesMonitoringServiceMonitor;
  /**
   * DEPRECATED Self monitoring determines whether Loki should scrape its own logs.
   * This feature relies on Grafana Agent Operator, which is deprecated.
   * It will create custom resources for GrafanaAgent, LogsInstance, and PodLogs to configure
   * scrape configs to scrape its own logs with the labels expected by the included dashboards.
   *
   * @default {...} (5 keys)
   */
  selfMonitoring?: LokiHelmValuesMonitoringSelfMonitoring;
};

export type LokiHelmValuesMonitoringDashboards = {
  /**
   * If enabled, create configmap with dashboards for monitoring Loki
   *
   * @default false
   */
  enabled?: boolean;
  namespace?: unknown;
  /**
   * Additional annotations for the dashboards ConfigMap
   *
   * @default {}
   */
  annotations?: LokiHelmValuesMonitoringDashboardsAnnotations;
  /**
   * Labels for the dashboards ConfigMap
   *
   * @default {"grafana_dashboard":"1"}
   */
  labels?: LokiHelmValuesMonitoringDashboardsLabels;
};

export type LokiHelmValuesMonitoringDashboardsAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringDashboardsLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "1"
   */
  grafana_dashboard?: number;
};

export type LokiHelmValuesMonitoringRules = {
  /**
   * If enabled, create PrometheusRule resource with Loki recording rules
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Include alerting rules
   *
   * @default true
   */
  alerting?: boolean;
  /**
   * Specify which individual alerts should be disabled
   * Instead of turning off each alert one by one, set the .monitoring.rules.alerting value to false instead.
   * If you disable all the alerts and keep .monitoring.rules.alerting set to true, the chart will fail to render.
   *
   * @default {}
   */
  disabled?: LokiHelmValuesMonitoringRulesDisabled;
  /**
   * @default {...} (5 keys)
   */
  configs?: LokiHelmValuesMonitoringRulesConfigs;
  namespace?: unknown;
  /**
   * Additional annotations for the rules PrometheusRule resource
   *
   * @default {}
   */
  annotations?: LokiHelmValuesMonitoringRulesAnnotations;
  /**
   * Additional labels for the rules PrometheusRule resource
   *
   * @default {}
   */
  labels?: LokiHelmValuesMonitoringRulesLabels;
  /**
   * Additional annotations for PrometheusRule alerts
   *
   * @default {}
   */
  additionalRuleAnnotations?: LokiHelmValuesMonitoringRulesAdditionalRuleAnnotations;
  /**
   * Additional labels for PrometheusRule alerts
   *
   * @default {}
   */
  additionalRuleLabels?: LokiHelmValuesMonitoringRulesAdditionalRuleLabels;
  additionalGroups?: unknown[];
};

export type LokiHelmValuesMonitoringRulesDisabled = object;

export type LokiHelmValuesMonitoringRulesConfigs = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {...} (5 keys)
   */
  LokiRequestErrors?: LokiHelmValuesMonitoringRulesConfigsLokiRequestErrors;
  /**
   * @default {...} (4 keys)
   */
  LokiRequestPanics?: LokiHelmValuesMonitoringRulesConfigsLokiRequestPanics;
  /**
   * @default {...} (4 keys)
   */
  LokiRequestLatency?: LokiHelmValuesMonitoringRulesConfigsLokiRequestLatency;
  /**
   * @default {"enabled":true,"for":"5m","severity":"warning"}
   */
  LokiTooManyCompactorsRunning?: LokiHelmValuesMonitoringRulesConfigsLokiTooManyCompactorsRunning;
  /**
   * @default {...} (5 keys)
   */
  LokiCanaryLatency?: LokiHelmValuesMonitoringRulesConfigsLokiCanaryLatency;
};

export type LokiHelmValuesMonitoringRulesConfigsLokiRequestErrors = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "15m"
   */
  for?: string;
  /**
   * @default "2m"
   */
  lookbackPeriod?: string;
  /**
   * @default "critical"
   */
  severity?: string;
  /**
   * @default 10
   */
  threshold?: number;
};

export type LokiHelmValuesMonitoringRulesConfigsLokiRequestPanics = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "10m"
   */
  lookbackPeriod?: string;
  /**
   * @default "critical"
   */
  severity?: string;
  /**
   * @default 0
   */
  threshold?: number;
};

export type LokiHelmValuesMonitoringRulesConfigsLokiRequestLatency = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "15m"
   */
  for?: string;
  /**
   * @default "critical"
   */
  severity?: string;
  /**
   * @default 1
   */
  threshold?: number;
};

export type LokiHelmValuesMonitoringRulesConfigsLokiTooManyCompactorsRunning = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "5m"
   */
  for?: string;
  /**
   * @default "warning"
   */
  severity?: string;
};

export type LokiHelmValuesMonitoringRulesConfigsLokiCanaryLatency = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "15m"
   */
  for?: string;
  /**
   * @default "5m"
   */
  lookbackPeriod?: string;
  /**
   * @default "warning"
   */
  severity?: string;
  /**
   * @default 5
   */
  threshold?: number;
};

export type LokiHelmValuesMonitoringRulesAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringRulesLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringRulesAdditionalRuleAnnotations = object;

export type LokiHelmValuesMonitoringRulesAdditionalRuleLabels = object;

export type LokiHelmValuesMonitoringServiceMonitor = {
  /**
   * If enabled, ServiceMonitor resources for Prometheus Operator are created
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Namespace selector for ServiceMonitor resources
   *
   * @default {}
   */
  namespaceSelector?: LokiHelmValuesMonitoringServiceMonitorNamespaceSelector;
  /**
   * ServiceMonitor annotations
   *
   * @default {}
   */
  annotations?: LokiHelmValuesMonitoringServiceMonitorAnnotations;
  /**
   * Additional ServiceMonitor labels
   *
   * @default {}
   */
  labels?: LokiHelmValuesMonitoringServiceMonitorLabels;
  /**
   * ServiceMonitor scrape interval
   * Default is 15s because included recording rules use a 1m rate, and scrape interval needs to be at
   * least 1/4 rate interval.
   *
   * @default "15s"
   */
  interval?: string;
  scrapeTimeout?: unknown;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
  /**
   * ServiceMonitor will use http by default, but you can pick https as well
   *
   * @default "http"
   */
  scheme?: string;
  tlsConfig?: unknown;
  /**
   * DEPRECATED If defined, will create a MetricsInstance for the Grafana Agent Operator.
   *
   * @default {...} (4 keys)
   */
  metricsInstance?: LokiHelmValuesMonitoringServiceMonitorMetricsInstance;
};

export type LokiHelmValuesMonitoringServiceMonitorNamespaceSelector = object;

export type LokiHelmValuesMonitoringServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringServiceMonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringServiceMonitorMetricsInstance = {
  /**
   * If enabled, MetricsInstance resources for Grafana Agent Operator are created
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * MetricsInstance annotations
   *
   * @default {}
   */
  annotations?: LokiHelmValuesMonitoringServiceMonitorMetricsInstanceAnnotations;
  /**
   * Additional MetricsInstance labels
   *
   * @default {}
   */
  labels?: LokiHelmValuesMonitoringServiceMonitorMetricsInstanceLabels;
  remoteWrite?: unknown;
};

export type LokiHelmValuesMonitoringServiceMonitorMetricsInstanceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringServiceMonitorMetricsInstanceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringSelfMonitoring = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Tenant to use for self monitoring
   *
   * @default {"name":"self-monitoring","password":null,"secretNamespace":"{{ include \"loki.namespace\" . }}"}
   */
  tenant?: LokiHelmValuesMonitoringSelfMonitoringTenant;
  /**
   * DEPRECATED Grafana Agent configuration
   *
   * @default {...} (7 keys)
   */
  grafanaAgent?: LokiHelmValuesMonitoringSelfMonitoringGrafanaAgent;
  /**
   * PodLogs configuration
   *
   * @default {...} (5 keys)
   */
  podLogs?: LokiHelmValuesMonitoringSelfMonitoringPodLogs;
  /**
   * LogsInstance configuration
   *
   * @default {"annotations":{},"labels":{},"clients":null}
   */
  logsInstance?: LokiHelmValuesMonitoringSelfMonitoringLogsInstance;
};

export type LokiHelmValuesMonitoringSelfMonitoringTenant = {
  /**
   * Name of the tenant
   *
   * @default "self-monitoring"
   */
  name?: string;
  password?: unknown;
  /**
   * Namespace to create additional tenant token secret in. Useful if your Grafana instance
   * is in a separate namespace. Token will still be created in the canary namespace.
   *
   * @default "{{ include "loki.namespace" . }}"
   */
  secretNamespace?: string;
};

export type LokiHelmValuesMonitoringSelfMonitoringGrafanaAgent = {
  /**
   * DEPRECATED Controls whether to install the Grafana Agent Operator and its CRDs.
   * Note that helm will not install CRDs if this flag is enabled during an upgrade.
   * In that case install the CRDs manually from https://github.com/grafana/agent/tree/main/production/operator/crds
   *
   * @default false
   */
  installOperator?: boolean;
  /**
   * Grafana Agent annotations
   *
   * @default {}
   */
  annotations?: LokiHelmValuesMonitoringSelfMonitoringGrafanaAgentAnnotations;
  /**
   * Additional Grafana Agent labels
   *
   * @default {}
   */
  labels?: LokiHelmValuesMonitoringSelfMonitoringGrafanaAgentLabels;
  /**
   * Enable the config read api on port 8080 of the agent
   *
   * @default false
   */
  enableConfigReadAPI?: boolean;
  priorityClassName?: unknown;
  /**
   * Resource requests and limits for the grafanaAgent pods
   *
   * @default {}
   */
  resources?: LokiHelmValuesMonitoringSelfMonitoringGrafanaAgentResources;
  tolerations?: unknown[];
};

export type LokiHelmValuesMonitoringSelfMonitoringGrafanaAgentAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringSelfMonitoringGrafanaAgentLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringSelfMonitoringGrafanaAgentResources = object;

export type LokiHelmValuesMonitoringSelfMonitoringPodLogs = {
  /**
   * PodLogs version
   *
   * @default "monitoring.grafana.com/v1alpha1"
   */
  apiVersion?: string;
  /**
   * PodLogs annotations
   *
   * @default {}
   */
  annotations?: LokiHelmValuesMonitoringSelfMonitoringPodLogsAnnotations;
  /**
   * Additional PodLogs labels
   *
   * @default {}
   */
  labels?: LokiHelmValuesMonitoringSelfMonitoringPodLogsLabels;
  relabelings?: unknown[];
  additionalPipelineStages?: unknown[];
};

export type LokiHelmValuesMonitoringSelfMonitoringPodLogsAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringSelfMonitoringPodLogsLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringSelfMonitoringLogsInstance = {
  /**
   * LogsInstance annotations
   *
   * @default {}
   */
  annotations?: LokiHelmValuesMonitoringSelfMonitoringLogsInstanceAnnotations;
  /**
   * Additional LogsInstance labels
   *
   * @default {}
   */
  labels?: LokiHelmValuesMonitoringSelfMonitoringLogsInstanceLabels;
  clients?: unknown;
};

export type LokiHelmValuesMonitoringSelfMonitoringLogsInstanceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesMonitoringSelfMonitoringLogsInstanceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesTableManager = {
  /**
   * Specifies whether the table-manager should be enabled
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"registry":null,"repository":null,"tag":null}
   */
  image?: LokiHelmValuesTableManagerImage;
  command?: unknown;
  priorityClassName?: unknown;
  /**
   * Labels for table-manager pods
   *
   * @default {}
   */
  podLabels?: LokiHelmValuesTableManagerPodLabels;
  /**
   * Annotations for table-manager deployment
   *
   * @default {}
   */
  annotations?: LokiHelmValuesTableManagerAnnotations;
  /**
   * Annotations for table-manager pods
   *
   * @default {}
   */
  podAnnotations?: LokiHelmValuesTableManagerPodAnnotations;
  /**
   * @default {"annotations":{},"labels":{}}
   */
  service?: LokiHelmValuesTableManagerService;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Resource requests and limits for the table-manager
   *
   * @default {}
   */
  resources?: LokiHelmValuesTableManagerResources;
  extraContainers?: unknown[];
  /**
   * Grace period to allow the table-manager to shutdown before it is killed
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Use the host's user namespace in table-manager pods
   *
   * @default "nil"
   */
  hostUsers?: string;
  /**
   * Affinity for table-manager pods.
   * The value will be passed through tpl.
   *
   * @default {"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"table-manager","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}}
   */
  affinity?: LokiHelmValuesTableManagerAffinity;
  /**
   * DNS config table-manager pods
   *
   * @default {}
   */
  dnsConfig?: LokiHelmValuesTableManagerDnsConfig;
  /**
   * Node selector for table-manager pods
   *
   * @default {}
   */
  nodeSelector?: LokiHelmValuesTableManagerNodeSelector;
  tolerations?: unknown[];
  /**
   * Enable deletes by retention
   *
   * @default false
   */
  retention_deletes_enabled?: boolean;
  /**
   * Set retention period
   *
   * @default 0
   */
  retention_period?: number;
};

export type LokiHelmValuesTableManagerImage = {
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
};

export type LokiHelmValuesTableManagerPodLabels = object;

export type LokiHelmValuesTableManagerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesTableManagerPodAnnotations = object;

export type LokiHelmValuesTableManagerService = {
  /**
   * Annotations for table-manager Service
   *
   * @default {}
   */
  annotations?: LokiHelmValuesTableManagerServiceAnnotations;
  /**
   * Additional labels for table-manager Service
   *
   * @default {}
   */
  labels?: LokiHelmValuesTableManagerServiceLabels;
};

export type LokiHelmValuesTableManagerServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesTableManagerServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type LokiHelmValuesTableManagerResources = object;

export type LokiHelmValuesTableManagerAffinity = {
  /**
   * @default {"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"app.kubernetes.io/component":"table-manager","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}},"topologyKey":"kubernetes.io/hostname"}]}
   */
  podAntiAffinity?: LokiHelmValuesTableManagerAffinityPodAntiAffinity;
};

export type LokiHelmValuesTableManagerAffinityPodAntiAffinity = {
  requiredDuringSchedulingIgnoredDuringExecution?: LokiHelmValuesTableManagerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type LokiHelmValuesTableManagerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"matchLabels":{"app.kubernetes.io/component":"table-manager","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}}
   */
  labelSelector?: LokiHelmValuesTableManagerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector;
  /**
   * @default "kubernetes.io/hostname"
   */
  topologyKey?: string;
};

export type LokiHelmValuesTableManagerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelector =
  {
    /**
     * @default {"app.kubernetes.io/component":"table-manager","app.kubernetes.io/name":"{{ include \"loki.name\" . }}","app.kubernetes.io/instance":"{{ .Release.Name }}"}
     */
    matchLabels?: LokiHelmValuesTableManagerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels;
  };

export type LokiHelmValuesTableManagerAffinityPodAntiAffinityRequiredDuringSchedulingIgnoredDuringExecutionLabelSelectorMatchLabels =
  {
    /**
     * @default "table-manager"
     */
    "app.kubernetes.io/component"?: string;
    /**
     * @default "{{ include "loki.name" . }}"
     */
    "app.kubernetes.io/name"?: string;
    /**
     * @default "{{ .Release.Name }}"
     */
    "app.kubernetes.io/instance"?: string;
  };

export type LokiHelmValuesTableManagerDnsConfig = object;

export type LokiHelmValuesTableManagerNodeSelector = object;

export type LokiHelmValues = {
  kubeVersionOverride?: unknown;
  /**
   * @default {...} (11 keys)
   */
  global?: LokiHelmValuesGlobal;
  nameOverride?: unknown;
  fullnameOverride?: unknown;
  namespaceOverride?: unknown;
  clusterLabelOverride?: unknown;
  imagePullSecrets?: unknown[];
  /**
   * Deployment mode lets you specify how to deploy Loki.
   * There are 3 options:
   * There are also 2 additional modes used for migrating between deployment modes:
   * Note: SimpleScalable and Distributed REQUIRE the use of object storage.
   *
   * @default "SimpleScalable"
   */
  deploymentMode?: string;
  /**
   * Base Loki Configs including kubernetes configurations and configurations for Loki itself,
   * see below for more specifics on Loki's configuration.
   * Configuration for running Loki
   *
   * @default {...} (53 keys)
   */
  loki?: LokiHelmValuesLoki;
  /**
   * Enterprise Loki Configs
   * Configuration for running Enterprise Loki
   *
   * @default {...} (14 keys)
   */
  enterprise?: LokiHelmValuesEnterprise;
  /**
   * Chart Testing
   * Section for configuring optional Helm test
   *
   * @default {...} (8 keys)
   */
  test?: LokiHelmValuesTest;
  /**
   * The Loki canary pushes logs to and queries from this loki installation to test
   * that it's working correctly
   *
   * @default {...} (26 keys)
   */
  lokiCanary?: LokiHelmValuesLokiCanary;
  /**
   * Service Accounts and Kubernetes RBAC
   *
   * @default {...} (6 keys)
   */
  serviceAccount?: LokiHelmValuesServiceAccount;
  /**
   * RBAC configuration
   *
   * @default {...} (5 keys)
   */
  rbac?: LokiHelmValuesRbac;
  /**
   * Network Policy configuration
   *
   * @default {...} (9 keys)
   */
  networkPolicy?: LokiHelmValuesNetworkPolicy;
  /**
   * Global memberlist configuration
   * Configuration for the memberlist service
   *
   * @default {"service":{"publishNotReadyAddresses":false,"annotations":{}}}
   */
  memberlist?: LokiHelmValuesMemberlist;
  /**
   * adminAPI configuration, enterprise only.
   * Configuration for the `admin-api` target
   *
   * @default {...} (27 keys)
   */
  adminApi?: LokiHelmValuesAdminApi;
  /**
   * Gateway and Ingress
   * By default this chart will deploy a Nginx container to act as a gateway which handles routing of traffic
   * and can also do auth.
   * If you would prefer you can optionally disable this and enable using k8s ingress to do the incoming routing.
   * Configuration for the gateway
   *
   * @default {...} (35 keys)
   */
  gateway?: LokiHelmValuesGateway;
  /**
   * If running enterprise and using the default enterprise gateway, configs go here.
   *
   * @default {...} (26 keys)
   */
  enterpriseGateway?: LokiHelmValuesEnterpriseGateway;
  /**
   * Ingress configuration Use either this ingress or the gateway, but not both at once.
   * If you enable this, make sure to disable the gateway.
   * You'll need to supply authn configuration for your ingress controller.
   *
   * @default {...} (7 keys)
   */
  ingress?: LokiHelmValuesIngress;
  /**
   * Migration
   * Options that may be necessary when performing a migration from another helm chart
   *
   * @default {"fromDistributed":{"enabled":false,"memberlistService":""}}
   */
  migrate?: LokiHelmValuesMigrate;
  /**
   * Single Binary Deployment
   * For small Loki installations up to a few 10's of GB per day, or for testing and development.
   * Configuration for the single binary node(s)
   *
   * @default {...} (26 keys)
   */
  singleBinary?: LokiHelmValuesSingleBinary;
  /**
   * Simple Scalable Deployment (SSD) Mode
   * For small to medium size Loki deployments up to around 1 TB/day, this is the default mode for this helm chart
   * Configuration for the write pod(s)
   *
   * @default {...} (29 keys)
   */
  write?: LokiHelmValuesWrite;
  /**
   * Configuration for the read pod(s)
   *
   * @default {...} (31 keys)
   */
  read?: LokiHelmValuesRead;
  /**
   * Configuration for the backend pod(s)
   *
   * @default {...} (27 keys)
   */
  backend?: LokiHelmValuesBackend;
  /**
   * Microservices Mode
   * For large Loki deployments ingesting more than 1 TB/day
   * Configuration for the ingester
   *
   * @default {...} (39 keys)
   */
  ingester?: LokiHelmValuesIngester;
  /**
   * Configuration for the distributor
   *
   * @default {...} (30 keys)
   */
  distributor?: LokiHelmValuesDistributor;
  /**
   * Configuration for the querier
   *
   * @default {...} (30 keys)
   */
  querier?: LokiHelmValuesQuerier;
  /**
   * Configuration for the query-frontend
   *
   * @default {...} (29 keys)
   */
  queryFrontend?: LokiHelmValuesQueryFrontend;
  /**
   * Configuration for the query-scheduler
   *
   * @default {...} (26 keys)
   */
  queryScheduler?: LokiHelmValuesQueryScheduler;
  /**
   * Configuration for the index-gateway
   *
   * @default {...} (31 keys)
   */
  indexGateway?: LokiHelmValuesIndexGateway;
  /**
   * Optional compactor configuration
   *
   * @default {...} (30 keys)
   */
  compactor?: LokiHelmValuesCompactor;
  /**
   * Configuration for the bloom-gateway
   *
   * @default {...} (29 keys)
   */
  bloomGateway?: LokiHelmValuesBloomGateway;
  /**
   * Configuration for the bloom-planner
   *
   * @default {...} (29 keys)
   */
  bloomPlanner?: LokiHelmValuesBloomPlanner;
  /**
   * Configuration for the bloom-builder
   *
   * @default {...} (26 keys)
   */
  bloomBuilder?: LokiHelmValuesBloomBuilder;
  /**
   * Configuration for the pattern ingester
   *
   * @default {...} (31 keys)
   */
  patternIngester?: LokiHelmValuesPatternIngester;
  /**
   * Configuration for the ruler
   *
   * @default {...} (30 keys)
   */
  ruler?: LokiHelmValuesRuler;
  /**
   * @default {...} (27 keys)
   */
  overridesExporter?: LokiHelmValuesOverridesExporter;
  /**
   * You can use a self hosted memcached by setting enabled to false and providing addresses.
   *
   * @default {...} (8 keys)
   */
  memcached?: LokiHelmValuesMemcached;
  /**
   * @default {...} (8 keys)
   */
  memcachedExporter?: LokiHelmValuesMemcachedExporter;
  /**
   * @default {...} (35 keys)
   */
  resultsCache?: LokiHelmValuesResultsCache;
  /**
   * @default {...} (39 keys)
   */
  chunksCache?: LokiHelmValuesChunksCache;
  /**
   * Subchart configurations
   * Setting for the Grafana Rollout Operator https://github.com/grafana/helm-charts/tree/main/charts/rollout-operator
   *
   * @default {"enabled":false,"podSecurityContext":{"fsGroup":10001,"runAsGroup":10001,"runAsNonRoot":true,"runAsUser":10001,"seccompProfile":{"type":"RuntimeDefault"}},"securityContext":{"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]},"allowPrivilegeEscalation":false}}
   */
  rollout_operator?: LokiHelmValuesRolloutoperator;
  /**
   * Configuration for the minio subchart
   *
   * @default {...} (10 keys)
   */
  minio?: LokiHelmValuesMinio;
  extraObjects?: unknown;
  /**
   * Whether to enable the rules sidecar
   *
   * @default {...} (9 keys)
   */
  sidecar?: LokiHelmValuesSidecar;
  /**
   * Monitoring section determines which monitoring features to enable
   *
   * @default {...} (4 keys)
   */
  monitoring?: LokiHelmValuesMonitoring;
  /**
   * DEPRECATED Configuration for the table-manager. The table-manager is only necessary when using a deprecated
   * index type such as Cassandra, Bigtable, or DynamoDB, it has not been necessary since loki introduced self-
   * contained index types like 'boltdb-shipper' and 'tsdb'. This will be removed in a future helm chart.
   *
   * @default {...} (23 keys)
   */
  tableManager?: LokiHelmValuesTableManager;
};

export type LokiHelmParameters = {
  kubeVersionOverride?: string;
  "global.imageRegistry"?: string;
  "global.image.registry"?: string;
  "global.priorityClassName"?: string;
  "global.clusterDomain"?: string;
  "global.dnsService"?: string;
  "global.dnsNamespace"?: string;
  "global.extraArgs"?: string;
  "global.extraEnv"?: string;
  "global.extraEnvFrom"?: string;
  "global.extraVolumes"?: string;
  "global.extraVolumeMounts"?: string;
  nameOverride?: string;
  fullnameOverride?: string;
  namespaceOverride?: string;
  clusterLabelOverride?: string;
  imagePullSecrets?: string;
  deploymentMode?: string;
  "loki.readinessProbe.httpGet.path"?: string;
  "loki.readinessProbe.httpGet.port"?: string;
  "loki.readinessProbe.periodSeconds"?: string;
  "loki.readinessProbe.initialDelaySeconds"?: string;
  "loki.readinessProbe.successThreshold"?: string;
  "loki.readinessProbe.failureThreshold"?: string;
  "loki.readinessProbe.timeoutSeconds"?: string;
  "loki.image.registry"?: string;
  "loki.image.repository"?: string;
  "loki.image.tag"?: string;
  "loki.image.digest"?: string;
  "loki.image.pullPolicy"?: string;
  "loki.revisionHistoryLimit"?: string;
  "loki.podSecurityContext.fsGroup"?: string;
  "loki.podSecurityContext.fsGroupChangePolicy"?: string;
  "loki.podSecurityContext.runAsGroup"?: string;
  "loki.podSecurityContext.runAsNonRoot"?: string;
  "loki.podSecurityContext.runAsUser"?: string;
  "loki.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "loki.containerSecurityContext.capabilities.drop"?: string;
  "loki.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "loki.enableServiceLinks"?: string;
  "loki.configStorageType"?: string;
  "loki.configObjectName"?: string;
  "loki.generatedConfigObjectName"?: string;
  "loki.config"?: string;
  "loki.auth_enabled"?: string;
  "loki.tenants"?: string;
  "loki.server.http_listen_port"?: string;
  "loki.server.grpc_listen_port"?: string;
  "loki.server.http_server_read_timeout"?: string;
  "loki.server.http_server_write_timeout"?: string;
  "loki.service.trafficDistribution"?: string;
  "loki.limits_config.reject_old_samples"?: string;
  "loki.limits_config.reject_old_samples_max_age"?: string;
  "loki.limits_config.max_cache_freshness_per_query"?: string;
  "loki.limits_config.split_queries_by_interval"?: string;
  "loki.limits_config.query_timeout"?: string;
  "loki.limits_config.volume_enabled"?: string;
  "loki.commonConfig.path_prefix"?: string;
  "loki.commonConfig.replication_factor"?: string;
  "loki.commonConfig.compactor_grpc_address"?: string;
  "loki.storage.type"?: string;
  "loki.storage.s3.s3"?: string;
  "loki.storage.s3.endpoint"?: string;
  "loki.storage.s3.region"?: string;
  "loki.storage.s3.secretAccessKey"?: string;
  "loki.storage.s3.accessKeyId"?: string;
  "loki.storage.s3.signatureVersion"?: string;
  "loki.storage.s3.s3ForcePathStyle"?: string;
  "loki.storage.s3.insecure"?: string;
  "loki.storage.s3.disable_dualstack"?: string;
  "loki.storage.gcs.chunkBufferSize"?: string;
  "loki.storage.gcs.requestTimeout"?: string;
  "loki.storage.gcs.enableHttp2"?: string;
  "loki.storage.azure.accountName"?: string;
  "loki.storage.azure.accountKey"?: string;
  "loki.storage.azure.connectionString"?: string;
  "loki.storage.azure.useManagedIdentity"?: string;
  "loki.storage.azure.useFederatedToken"?: string;
  "loki.storage.azure.userAssignedId"?: string;
  "loki.storage.azure.requestTimeout"?: string;
  "loki.storage.azure.endpointSuffix"?: string;
  "loki.storage.azure.chunkDelimiter"?: string;
  "loki.storage.swift.auth_version"?: string;
  "loki.storage.swift.auth_url"?: string;
  "loki.storage.swift.internal"?: string;
  "loki.storage.swift.username"?: string;
  "loki.storage.swift.user_domain_name"?: string;
  "loki.storage.swift.user_domain_id"?: string;
  "loki.storage.swift.user_id"?: string;
  "loki.storage.swift.password"?: string;
  "loki.storage.swift.domain_id"?: string;
  "loki.storage.swift.domain_name"?: string;
  "loki.storage.swift.project_id"?: string;
  "loki.storage.swift.project_name"?: string;
  "loki.storage.swift.project_domain_id"?: string;
  "loki.storage.swift.project_domain_name"?: string;
  "loki.storage.swift.region_name"?: string;
  "loki.storage.swift.container_name"?: string;
  "loki.storage.swift.max_retries"?: string;
  "loki.storage.swift.connect_timeout"?: string;
  "loki.storage.swift.request_timeout"?: string;
  "loki.storage.filesystem.chunks_directory"?: string;
  "loki.storage.filesystem.rules_directory"?: string;
  "loki.storage.use_thanos_objstore"?: string;
  "loki.storage.object_store.type"?: string;
  "loki.storage.object_store.storage_prefix"?: string;
  "loki.storage.object_store.s3.endpoint"?: string;
  "loki.storage.object_store.s3.region"?: string;
  "loki.storage.object_store.s3.access_key_id"?: string;
  "loki.storage.object_store.s3.secret_access_key"?: string;
  "loki.storage.object_store.s3.insecure"?: string;
  "loki.storage.object_store.gcs.bucket_name"?: string;
  "loki.storage.object_store.gcs.service_account"?: string;
  "loki.storage.object_store.azure.account_name"?: string;
  "loki.storage.object_store.azure.account_key"?: string;
  "loki.useTestSchema"?: string;
  "loki.testSchemaConfig.configs.from"?: string;
  "loki.testSchemaConfig.configs.store"?: string;
  "loki.testSchemaConfig.configs.object_store"?: string;
  "loki.testSchemaConfig.configs.schema"?: string;
  "loki.testSchemaConfig.configs.index.prefix"?: string;
  "loki.testSchemaConfig.configs.index.period"?: string;
  "loki.rulerConfig.wal.dir"?: string;
  "loki.storage_config.boltdb_shipper.index_gateway_client.server_address"?: string;
  "loki.storage_config.tsdb_shipper.index_gateway_client.server_address"?: string;
  "loki.storage_config.bloom_shipper.working_directory"?: string;
  "loki.storage_config.hedging.at"?: string;
  "loki.storage_config.hedging.max_per_second"?: string;
  "loki.storage_config.hedging.up_to"?: string;
  "loki.pattern_ingester.enabled"?: string;
  "loki.ui.enabled"?: string;
  "loki.ui.gateway.enabled"?: string;
  "loki.index_gateway.mode"?: string;
  "loki.frontend.scheduler_address"?: string;
  "loki.frontend.tail_proxy_url"?: string;
  "loki.frontend_worker.scheduler_address"?: string;
  "loki.tracing.enabled"?: string;
  "loki.bloom_build.enabled"?: string;
  "loki.bloom_build.builder.planner_address"?: string;
  "loki.bloom_gateway.enabled"?: string;
  "loki.bloom_gateway.client.addresses"?: string;
  "enterprise.enabled"?: string;
  "enterprise.version"?: string;
  "enterprise.cluster_name"?: string;
  "enterprise.license.contents"?: string;
  "enterprise.useExternalLicense"?: string;
  "enterprise.externalLicenseName"?: string;
  "enterprise.externalConfigName"?: string;
  "enterprise.gelGateway"?: string;
  "enterprise.adminApi.enabled"?: string;
  "enterprise.config"?: string;
  "enterprise.image.registry"?: string;
  "enterprise.image.repository"?: string;
  "enterprise.image.tag"?: string;
  "enterprise.image.digest"?: string;
  "enterprise.image.pullPolicy"?: string;
  "enterprise.adminToken.secret"?: string;
  "enterprise.canarySecret"?: string;
  "enterprise.provisioner.enabled"?: string;
  "enterprise.provisioner.provisionedSecretPrefix"?: string;
  "enterprise.provisioner.hookType"?: string;
  "enterprise.provisioner.apiUrl"?: string;
  "enterprise.provisioner.additionalTenants"?: string;
  "enterprise.provisioner.env"?: string;
  "enterprise.provisioner.tolerations"?: string;
  "enterprise.provisioner.priorityClassName"?: string;
  "enterprise.provisioner.hostUsers"?: string;
  "enterprise.provisioner.securityContext.runAsNonRoot"?: string;
  "enterprise.provisioner.securityContext.runAsGroup"?: string;
  "enterprise.provisioner.securityContext.runAsUser"?: string;
  "enterprise.provisioner.securityContext.fsGroup"?: string;
  "enterprise.provisioner.image.registry"?: string;
  "enterprise.provisioner.image.repository"?: string;
  "enterprise.provisioner.image.tag"?: string;
  "enterprise.provisioner.image.digest"?: string;
  "enterprise.provisioner.image.pullPolicy"?: string;
  "enterprise.provisioner.extraVolumeMounts"?: string;
  "enterprise.provisioner.extraVolumes"?: string;
  "test.enabled"?: string;
  "test.canaryServiceAddress"?: string;
  "test.prometheusAddress"?: string;
  "test.timeout"?: string;
  "test.image.registry"?: string;
  "test.image.repository"?: string;
  "test.image.tag"?: string;
  "test.image.digest"?: string;
  "test.image.pullPolicy"?: string;
  "test.hostUsers"?: string;
  "lokiCanary.enabled"?: string;
  "lokiCanary.kind"?: string;
  "lokiCanary.push"?: string;
  "lokiCanary.lokiurl"?: string;
  "lokiCanary.labelname"?: string;
  "lokiCanary.extraArgs"?: string;
  "lokiCanary.extraEnv"?: string;
  "lokiCanary.extraEnvFrom"?: string;
  "lokiCanary.extraVolumeMounts"?: string;
  "lokiCanary.extraVolumes"?: string;
  "lokiCanary.tolerations"?: string;
  "lokiCanary.priorityClassName"?: string;
  "lokiCanary.hostUsers"?: string;
  "lokiCanary.image.registry"?: string;
  "lokiCanary.image.repository"?: string;
  "lokiCanary.image.tag"?: string;
  "lokiCanary.image.digest"?: string;
  "lokiCanary.image.pullPolicy"?: string;
  "lokiCanary.livenessProbe"?: string;
  "lokiCanary.readinessProbe.httpGet.path"?: string;
  "lokiCanary.readinessProbe.httpGet.port"?: string;
  "lokiCanary.readinessProbe.initialDelaySeconds"?: string;
  "lokiCanary.readinessProbe.timeoutSeconds"?: string;
  "lokiCanary.startupProbe"?: string;
  "lokiCanary.updateStrategy.type"?: string;
  "lokiCanary.updateStrategy.rollingUpdate.maxUnavailable"?: string;
  "lokiCanary.replicas"?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "serviceAccount.imagePullSecrets"?: string;
  "serviceAccount.automountServiceAccountToken"?: string;
  "rbac.pspEnabled"?: string;
  "rbac.sccEnabled"?: string;
  "rbac.sccAllowHostDirVolumePlugin"?: string;
  "rbac.namespaced"?: string;
  "networkPolicy.enabled"?: string;
  "networkPolicy.flavor"?: string;
  "networkPolicy.metrics.cidrs"?: string;
  "networkPolicy.alertmanager.port"?: string;
  "networkPolicy.externalStorage.ports"?: string;
  "networkPolicy.externalStorage.cidrs"?: string;
  "networkPolicy.discovery.port"?: string;
  "networkPolicy.egressWorld.enabled"?: string;
  "networkPolicy.egressKubeApiserver.enabled"?: string;
  "memberlist.service.publishNotReadyAddresses"?: string;
  "adminApi.replicas"?: string;
  "adminApi.hostAliases"?: string;
  "adminApi.extraEnv"?: string;
  "adminApi.extraEnvFrom"?: string;
  "adminApi.podSecurityContext.runAsNonRoot"?: string;
  "adminApi.podSecurityContext.runAsGroup"?: string;
  "adminApi.podSecurityContext.runAsUser"?: string;
  "adminApi.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "adminApi.containerSecurityContext.capabilities.drop"?: string;
  "adminApi.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "adminApi.strategy.type"?: string;
  "adminApi.readinessProbe.httpGet.path"?: string;
  "adminApi.readinessProbe.httpGet.port"?: string;
  "adminApi.readinessProbe.initialDelaySeconds"?: string;
  "adminApi.env"?: string;
  "adminApi.initContainers"?: string;
  "adminApi.extraContainers"?: string;
  "adminApi.extraVolumes"?: string;
  "adminApi.extraVolumeMounts"?: string;
  "adminApi.topologySpreadConstraints"?: string;
  "adminApi.tolerations"?: string;
  "adminApi.terminationGracePeriodSeconds"?: string;
  "adminApi.hostUsers"?: string;
  "gateway.enabled"?: string;
  "gateway.replicas"?: string;
  "gateway.containerPort"?: string;
  "gateway.verboseLogging"?: string;
  "gateway.autoscaling.enabled"?: string;
  "gateway.autoscaling.minReplicas"?: string;
  "gateway.autoscaling.maxReplicas"?: string;
  "gateway.autoscaling.targetCPUUtilizationPercentage"?: string;
  "gateway.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "gateway.deploymentStrategy.type"?: string;
  "gateway.image.registry"?: string;
  "gateway.image.repository"?: string;
  "gateway.image.tag"?: string;
  "gateway.image.digest"?: string;
  "gateway.image.pullPolicy"?: string;
  "gateway.priorityClassName"?: string;
  "gateway.extraArgs"?: string;
  "gateway.extraEnv"?: string;
  "gateway.extraEnvFrom"?: string;
  "gateway.extraVolumes"?: string;
  "gateway.extraVolumeMounts"?: string;
  "gateway.podSecurityContext.fsGroup"?: string;
  "gateway.podSecurityContext.runAsGroup"?: string;
  "gateway.podSecurityContext.runAsNonRoot"?: string;
  "gateway.podSecurityContext.runAsUser"?: string;
  "gateway.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "gateway.containerSecurityContext.capabilities.drop"?: string;
  "gateway.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "gateway.hostUsers"?: string;
  "gateway.extraContainers"?: string;
  "gateway.terminationGracePeriodSeconds"?: string;
  "gateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "gateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "gateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "gateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "gateway.topologySpreadConstraints"?: string;
  "gateway.tolerations"?: string;
  "gateway.service.port"?: string;
  "gateway.service.type"?: string;
  "gateway.service.clusterIP"?: string;
  "gateway.service.nodePort"?: string;
  "gateway.service.loadBalancerIP"?: string;
  "gateway.service.trafficDistribution"?: string;
  "gateway.ingress.enabled"?: string;
  "gateway.ingress.ingressClassName"?: string;
  "gateway.ingress.hosts.host"?: string;
  "gateway.ingress.hosts.paths.path"?: string;
  "gateway.ingress.tls.secretName"?: string;
  "gateway.ingress.tls.hosts"?: string;
  "gateway.basicAuth.enabled"?: string;
  "gateway.basicAuth.username"?: string;
  "gateway.basicAuth.password"?: string;
  "gateway.basicAuth.htpasswd"?: string;
  "gateway.basicAuth.existingSecret"?: string;
  "gateway.readinessProbe.httpGet.path"?: string;
  "gateway.readinessProbe.httpGet.port"?: string;
  "gateway.readinessProbe.initialDelaySeconds"?: string;
  "gateway.readinessProbe.timeoutSeconds"?: string;
  "gateway.nginxConfig.schema"?: string;
  "gateway.nginxConfig.enableIPv6"?: string;
  "gateway.nginxConfig.logFormat"?: string;
  "gateway.nginxConfig.serverSnippet"?: string;
  "gateway.nginxConfig.httpSnippet"?: string;
  "gateway.nginxConfig.locationSnippet"?: string;
  "gateway.nginxConfig.clientMaxBodySize"?: string;
  "gateway.nginxConfig.ssl"?: string;
  "gateway.nginxConfig.customReadUrl"?: string;
  "gateway.nginxConfig.customWriteUrl"?: string;
  "gateway.nginxConfig.customBackendUrl"?: string;
  "gateway.nginxConfig.resolver"?: string;
  "gateway.nginxConfig.file"?: string;
  "enterpriseGateway.replicas"?: string;
  "enterpriseGateway.hostAliases"?: string;
  "enterpriseGateway.hostUsers"?: string;
  "enterpriseGateway.extraEnvFrom"?: string;
  "enterpriseGateway.service.type"?: string;
  "enterpriseGateway.podSecurityContext.runAsNonRoot"?: string;
  "enterpriseGateway.podSecurityContext.runAsGroup"?: string;
  "enterpriseGateway.podSecurityContext.runAsUser"?: string;
  "enterpriseGateway.podSecurityContext.fsGroup"?: string;
  "enterpriseGateway.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "enterpriseGateway.containerSecurityContext.capabilities.drop"?: string;
  "enterpriseGateway.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "enterpriseGateway.useDefaultProxyURLs"?: string;
  "enterpriseGateway.strategy.type"?: string;
  "enterpriseGateway.readinessProbe.httpGet.path"?: string;
  "enterpriseGateway.readinessProbe.httpGet.port"?: string;
  "enterpriseGateway.readinessProbe.initialDelaySeconds"?: string;
  "enterpriseGateway.env"?: string;
  "enterpriseGateway.initContainers"?: string;
  "enterpriseGateway.extraContainers"?: string;
  "enterpriseGateway.extraVolumes"?: string;
  "enterpriseGateway.extraVolumeMounts"?: string;
  "enterpriseGateway.topologySpreadConstraints"?: string;
  "enterpriseGateway.tolerations"?: string;
  "enterpriseGateway.terminationGracePeriodSeconds"?: string;
  "ingress.enabled"?: string;
  "ingress.ingressClassName"?: string;
  "ingress.paths.distributor"?: string;
  "ingress.paths.queryFrontend"?: string;
  "ingress.paths.ruler"?: string;
  "ingress.paths.compactor"?: string;
  "ingress.hosts"?: string;
  "ingress.tls"?: string;
  "migrate.fromDistributed.enabled"?: string;
  "migrate.fromDistributed.memberlistService"?: string;
  "singleBinary.replicas"?: string;
  "singleBinary.autoscaling.enabled"?: string;
  "singleBinary.autoscaling.minReplicas"?: string;
  "singleBinary.autoscaling.maxReplicas"?: string;
  "singleBinary.autoscaling.targetCPUUtilizationPercentage"?: string;
  "singleBinary.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "singleBinary.image.registry"?: string;
  "singleBinary.image.repository"?: string;
  "singleBinary.image.tag"?: string;
  "singleBinary.priorityClassName"?: string;
  "singleBinary.service.type"?: string;
  "singleBinary.service.trafficDistribution"?: string;
  "singleBinary.targetModule"?: string;
  "singleBinary.extraArgs"?: string;
  "singleBinary.extraEnv"?: string;
  "singleBinary.extraEnvFrom"?: string;
  "singleBinary.extraContainers"?: string;
  "singleBinary.initContainers"?: string;
  "singleBinary.extraVolumeMounts"?: string;
  "singleBinary.extraVolumes"?: string;
  "singleBinary.terminationGracePeriodSeconds"?: string;
  "singleBinary.hostUsers"?: string;
  "singleBinary.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "singleBinary.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "singleBinary.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "singleBinary.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "singleBinary.topologySpreadConstraints"?: string;
  "singleBinary.tolerations"?: string;
  "singleBinary.persistence.whenScaled"?: string;
  "singleBinary.persistence.whenDeleted"?: string;
  "singleBinary.persistence.enableStatefulSetAutoDeletePVC"?: string;
  "singleBinary.persistence.enableStatefulSetRecreationForSizeChange"?: string;
  "singleBinary.persistence.enabled"?: string;
  "singleBinary.persistence.accessModes"?: string;
  "singleBinary.persistence.size"?: string;
  "singleBinary.persistence.storageClass"?: string;
  "singleBinary.persistence.selector"?: string;
  "write.replicas"?: string;
  "write.autoscaling.enabled"?: string;
  "write.autoscaling.minReplicas"?: string;
  "write.autoscaling.maxReplicas"?: string;
  "write.autoscaling.targetCPUUtilizationPercentage"?: string;
  "write.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "write.autoscaling.behavior.scaleUp.policies.type"?: string;
  "write.autoscaling.behavior.scaleUp.policies.value"?: string;
  "write.autoscaling.behavior.scaleUp.policies.periodSeconds"?: string;
  "write.autoscaling.behavior.scaleDown.policies.type"?: string;
  "write.autoscaling.behavior.scaleDown.policies.value"?: string;
  "write.autoscaling.behavior.scaleDown.policies.periodSeconds"?: string;
  "write.autoscaling.behavior.scaleDown.stabilizationWindowSeconds"?: string;
  "write.image.registry"?: string;
  "write.image.repository"?: string;
  "write.image.tag"?: string;
  "write.priorityClassName"?: string;
  "write.service.type"?: string;
  "write.service.trafficDistribution"?: string;
  "write.targetModule"?: string;
  "write.extraArgs"?: string;
  "write.extraEnv"?: string;
  "write.extraEnvFrom"?: string;
  "write.initContainers"?: string;
  "write.extraContainers"?: string;
  "write.extraVolumeMounts"?: string;
  "write.extraVolumes"?: string;
  "write.extraVolumeClaimTemplates"?: string;
  "write.terminationGracePeriodSeconds"?: string;
  "write.hostUsers"?: string;
  "write.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "write.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "write.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "write.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "write.topologySpreadConstraints"?: string;
  "write.tolerations"?: string;
  "write.podManagementPolicy"?: string;
  "write.persistence.volumeClaimsEnabled"?: string;
  "write.persistence.accessModes"?: string;
  "write.persistence.enableStatefulSetAutoDeletePVC"?: string;
  "write.persistence.size"?: string;
  "write.persistence.storageClass"?: string;
  "write.persistence.volumeAttributesClassName"?: string;
  "write.persistence.selector"?: string;
  "read.replicas"?: string;
  "read.autoscaling.enabled"?: string;
  "read.autoscaling.minReplicas"?: string;
  "read.autoscaling.maxReplicas"?: string;
  "read.autoscaling.targetCPUUtilizationPercentage"?: string;
  "read.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "read.image.registry"?: string;
  "read.image.repository"?: string;
  "read.image.tag"?: string;
  "read.priorityClassName"?: string;
  "read.service.type"?: string;
  "read.service.trafficDistribution"?: string;
  "read.targetModule"?: string;
  "read.legacyReadTarget"?: string;
  "read.extraArgs"?: string;
  "read.initContainers"?: string;
  "read.extraContainers"?: string;
  "read.extraEnv"?: string;
  "read.extraEnvFrom"?: string;
  "read.extraVolumeMounts"?: string;
  "read.extraVolumes"?: string;
  "read.terminationGracePeriodSeconds"?: string;
  "read.hostUsers"?: string;
  "read.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "read.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "read.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "read.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "read.topologySpreadConstraints"?: string;
  "read.tolerations"?: string;
  "read.podManagementPolicy"?: string;
  "read.persistence.enableStatefulSetAutoDeletePVC"?: string;
  "read.persistence.accessModes"?: string;
  "read.persistence.size"?: string;
  "read.persistence.storageClass"?: string;
  "read.persistence.volumeAttributesClassName"?: string;
  "read.persistence.selector"?: string;
  "backend.replicas"?: string;
  "backend.autoscaling.enabled"?: string;
  "backend.autoscaling.minReplicas"?: string;
  "backend.autoscaling.maxReplicas"?: string;
  "backend.autoscaling.targetCPUUtilizationPercentage"?: string;
  "backend.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "backend.image.registry"?: string;
  "backend.image.repository"?: string;
  "backend.image.tag"?: string;
  "backend.priorityClassName"?: string;
  "backend.service.type"?: string;
  "backend.service.trafficDistribution"?: string;
  "backend.targetModule"?: string;
  "backend.extraArgs"?: string;
  "backend.extraEnv"?: string;
  "backend.extraEnvFrom"?: string;
  "backend.initContainers"?: string;
  "backend.extraContainers"?: string;
  "backend.extraVolumeMounts"?: string;
  "backend.extraVolumes"?: string;
  "backend.terminationGracePeriodSeconds"?: string;
  "backend.hostUsers"?: string;
  "backend.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "backend.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "backend.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "backend.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "backend.topologySpreadConstraints"?: string;
  "backend.tolerations"?: string;
  "backend.podManagementPolicy"?: string;
  "backend.persistence.volumeClaimsEnabled"?: string;
  "backend.persistence.accessModes"?: string;
  "backend.persistence.enableStatefulSetAutoDeletePVC"?: string;
  "backend.persistence.size"?: string;
  "backend.persistence.storageClass"?: string;
  "backend.persistence.volumeAttributesClassName"?: string;
  "backend.persistence.selector"?: string;
  "ingester.replicas"?: string;
  "ingester.hostAliases"?: string;
  "ingester.hostUsers"?: string;
  "ingester.autoscaling.enabled"?: string;
  "ingester.autoscaling.minReplicas"?: string;
  "ingester.autoscaling.maxReplicas"?: string;
  "ingester.autoscaling.targetCPUUtilizationPercentage"?: string;
  "ingester.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "ingester.autoscaling.customMetrics"?: string;
  "ingester.autoscaling.behavior.enabled"?: string;
  "ingester.image.registry"?: string;
  "ingester.image.repository"?: string;
  "ingester.image.tag"?: string;
  "ingester.command"?: string;
  "ingester.priorityClassName"?: string;
  "ingester.serviceType"?: string;
  "ingester.extraArgs"?: string;
  "ingester.extraEnv"?: string;
  "ingester.extraEnvFrom"?: string;
  "ingester.extraVolumeMounts"?: string;
  "ingester.extraVolumes"?: string;
  "ingester.extraContainers"?: string;
  "ingester.initContainers"?: string;
  "ingester.terminationGracePeriodSeconds"?: string;
  "ingester.topologySpreadConstraints.maxSkew"?: string;
  "ingester.topologySpreadConstraints.topologyKey"?: string;
  "ingester.topologySpreadConstraints.whenUnsatisfiable"?: string;
  "ingester.topologySpreadConstraints.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "ingester.topologySpreadConstraints.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "ingester.topologySpreadConstraints.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "ingester.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "ingester.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "ingester.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "ingester.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "ingester.maxUnavailable"?: string;
  "ingester.tolerations"?: string;
  "ingester.updateStrategy.type"?: string;
  "ingester.persistence.enabled"?: string;
  "ingester.persistence.inMemory"?: string;
  "ingester.persistence.claims.name"?: string;
  "ingester.persistence.claims.accessModes"?: string;
  "ingester.persistence.claims.size"?: string;
  "ingester.persistence.claims.storageClass"?: string;
  "ingester.persistence.claims.volumeAttributesClassName"?: string;
  "ingester.persistence.enableStatefulSetAutoDeletePVC"?: string;
  "ingester.persistence.whenDeleted"?: string;
  "ingester.persistence.whenScaled"?: string;
  "ingester.appProtocol.grpc"?: string;
  "ingester.trafficDistribution"?: string;
  "ingester.zoneAwareReplication.enabled"?: string;
  "ingester.zoneAwareReplication.maxUnavailablePct"?: string;
  "ingester.zoneAwareReplication.zoneA.nodeSelector"?: string;
  "ingester.zoneAwareReplication.zoneB.nodeSelector"?: string;
  "ingester.zoneAwareReplication.zoneC.nodeSelector"?: string;
  "ingester.zoneAwareReplication.migration.enabled"?: string;
  "ingester.zoneAwareReplication.migration.excludeDefaultZone"?: string;
  "ingester.zoneAwareReplication.migration.readPath"?: string;
  "ingester.zoneAwareReplication.migration.writePath"?: string;
  "ingester.rolloutGroupPrefix"?: string;
  "ingester.addIngesterNamePrefix"?: string;
  "distributor.replicas"?: string;
  "distributor.hostAliases"?: string;
  "distributor.hostUsers"?: string;
  "distributor.autoscaling.enabled"?: string;
  "distributor.autoscaling.minReplicas"?: string;
  "distributor.autoscaling.maxReplicas"?: string;
  "distributor.autoscaling.targetCPUUtilizationPercentage"?: string;
  "distributor.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "distributor.autoscaling.customMetrics"?: string;
  "distributor.autoscaling.behavior.enabled"?: string;
  "distributor.image.registry"?: string;
  "distributor.image.repository"?: string;
  "distributor.image.tag"?: string;
  "distributor.command"?: string;
  "distributor.priorityClassName"?: string;
  "distributor.serviceType"?: string;
  "distributor.extraArgs"?: string;
  "distributor.extraEnv"?: string;
  "distributor.extraEnvFrom"?: string;
  "distributor.extraVolumeMounts"?: string;
  "distributor.extraVolumes"?: string;
  "distributor.initContainers"?: string;
  "distributor.extraContainers"?: string;
  "distributor.terminationGracePeriodSeconds"?: string;
  "distributor.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "distributor.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "distributor.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "distributor.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "distributor.maxUnavailable"?: string;
  "distributor.maxSurge"?: string;
  "distributor.topologySpreadConstraints"?: string;
  "distributor.tolerations"?: string;
  "distributor.appProtocol.grpc"?: string;
  "distributor.trafficDistribution"?: string;
  "querier.replicas"?: string;
  "querier.hostAliases"?: string;
  "querier.hostUsers"?: string;
  "querier.autoscaling.enabled"?: string;
  "querier.autoscaling.minReplicas"?: string;
  "querier.autoscaling.maxReplicas"?: string;
  "querier.autoscaling.targetCPUUtilizationPercentage"?: string;
  "querier.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "querier.autoscaling.customMetrics"?: string;
  "querier.autoscaling.behavior.enabled"?: string;
  "querier.image.registry"?: string;
  "querier.image.repository"?: string;
  "querier.image.tag"?: string;
  "querier.command"?: string;
  "querier.priorityClassName"?: string;
  "querier.serviceType"?: string;
  "querier.extraArgs"?: string;
  "querier.extraEnv"?: string;
  "querier.extraEnvFrom"?: string;
  "querier.extraVolumeMounts"?: string;
  "querier.extraVolumes"?: string;
  "querier.extraContainers"?: string;
  "querier.initContainers"?: string;
  "querier.terminationGracePeriodSeconds"?: string;
  "querier.topologySpreadConstraints.maxSkew"?: string;
  "querier.topologySpreadConstraints.topologyKey"?: string;
  "querier.topologySpreadConstraints.whenUnsatisfiable"?: string;
  "querier.topologySpreadConstraints.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "querier.topologySpreadConstraints.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "querier.topologySpreadConstraints.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "querier.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "querier.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "querier.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "querier.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "querier.maxUnavailable"?: string;
  "querier.maxSurge"?: string;
  "querier.tolerations"?: string;
  "querier.appProtocol.grpc"?: string;
  "querier.trafficDistribution"?: string;
  "queryFrontend.replicas"?: string;
  "queryFrontend.hostAliases"?: string;
  "queryFrontend.hostUsers"?: string;
  "queryFrontend.autoscaling.enabled"?: string;
  "queryFrontend.autoscaling.minReplicas"?: string;
  "queryFrontend.autoscaling.maxReplicas"?: string;
  "queryFrontend.autoscaling.targetCPUUtilizationPercentage"?: string;
  "queryFrontend.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "queryFrontend.autoscaling.customMetrics"?: string;
  "queryFrontend.autoscaling.behavior.enabled"?: string;
  "queryFrontend.image.registry"?: string;
  "queryFrontend.image.repository"?: string;
  "queryFrontend.image.tag"?: string;
  "queryFrontend.command"?: string;
  "queryFrontend.priorityClassName"?: string;
  "queryFrontend.serviceType"?: string;
  "queryFrontend.extraArgs"?: string;
  "queryFrontend.extraEnv"?: string;
  "queryFrontend.extraEnvFrom"?: string;
  "queryFrontend.extraVolumeMounts"?: string;
  "queryFrontend.extraVolumes"?: string;
  "queryFrontend.initContainers"?: string;
  "queryFrontend.extraContainers"?: string;
  "queryFrontend.terminationGracePeriodSeconds"?: string;
  "queryFrontend.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "queryFrontend.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "queryFrontend.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "queryFrontend.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "queryFrontend.maxUnavailable"?: string;
  "queryFrontend.topologySpreadConstraints"?: string;
  "queryFrontend.tolerations"?: string;
  "queryFrontend.appProtocol.grpc"?: string;
  "queryFrontend.loadBalancer.enabled"?: string;
  "queryFrontend.trafficDistribution"?: string;
  "queryScheduler.replicas"?: string;
  "queryScheduler.hostAliases"?: string;
  "queryScheduler.hostUsers"?: string;
  "queryScheduler.image.registry"?: string;
  "queryScheduler.image.repository"?: string;
  "queryScheduler.image.tag"?: string;
  "queryScheduler.priorityClassName"?: string;
  "queryScheduler.extraArgs"?: string;
  "queryScheduler.extraEnv"?: string;
  "queryScheduler.extraEnvFrom"?: string;
  "queryScheduler.extraVolumeMounts"?: string;
  "queryScheduler.extraVolumes"?: string;
  "queryScheduler.initContainers"?: string;
  "queryScheduler.extraContainers"?: string;
  "queryScheduler.terminationGracePeriodSeconds"?: string;
  "queryScheduler.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "queryScheduler.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "queryScheduler.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "queryScheduler.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "queryScheduler.maxUnavailable"?: string;
  "queryScheduler.topologySpreadConstraints"?: string;
  "queryScheduler.tolerations"?: string;
  "queryScheduler.appProtocol.grpc"?: string;
  "queryScheduler.trafficDistribution"?: string;
  "indexGateway.replicas"?: string;
  "indexGateway.joinMemberlist"?: string;
  "indexGateway.hostAliases"?: string;
  "indexGateway.hostUsers"?: string;
  "indexGateway.image.registry"?: string;
  "indexGateway.image.repository"?: string;
  "indexGateway.image.tag"?: string;
  "indexGateway.priorityClassName"?: string;
  "indexGateway.serviceType"?: string;
  "indexGateway.extraArgs"?: string;
  "indexGateway.extraEnv"?: string;
  "indexGateway.extraEnvFrom"?: string;
  "indexGateway.extraVolumeMounts"?: string;
  "indexGateway.extraVolumes"?: string;
  "indexGateway.extraContainers"?: string;
  "indexGateway.initContainers"?: string;
  "indexGateway.terminationGracePeriodSeconds"?: string;
  "indexGateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "indexGateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "indexGateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "indexGateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "indexGateway.maxUnavailable"?: string;
  "indexGateway.topologySpreadConstraints"?: string;
  "indexGateway.tolerations"?: string;
  "indexGateway.persistence.enabled"?: string;
  "indexGateway.persistence.accessModes"?: string;
  "indexGateway.persistence.inMemory"?: string;
  "indexGateway.persistence.size"?: string;
  "indexGateway.persistence.storageClass"?: string;
  "indexGateway.persistence.volumeAttributesClassName"?: string;
  "indexGateway.persistence.enableStatefulSetAutoDeletePVC"?: string;
  "indexGateway.persistence.whenDeleted"?: string;
  "indexGateway.persistence.whenScaled"?: string;
  "indexGateway.appProtocol.grpc"?: string;
  "indexGateway.trafficDistribution"?: string;
  "indexGateway.updateStrategy.type"?: string;
  "compactor.replicas"?: string;
  "compactor.hostAliases"?: string;
  "compactor.hostUsers"?: string;
  "compactor.image.registry"?: string;
  "compactor.image.repository"?: string;
  "compactor.image.tag"?: string;
  "compactor.command"?: string;
  "compactor.priorityClassName"?: string;
  "compactor.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "compactor.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "compactor.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "compactor.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "compactor.serviceType"?: string;
  "compactor.extraArgs"?: string;
  "compactor.extraEnv"?: string;
  "compactor.extraEnvFrom"?: string;
  "compactor.extraVolumeMounts"?: string;
  "compactor.extraVolumes"?: string;
  "compactor.extraContainers"?: string;
  "compactor.initContainers"?: string;
  "compactor.terminationGracePeriodSeconds"?: string;
  "compactor.tolerations"?: string;
  "compactor.appProtocol.grpc"?: string;
  "compactor.persistence.enabled"?: string;
  "compactor.persistence.claims.name"?: string;
  "compactor.persistence.claims.accessModes"?: string;
  "compactor.persistence.claims.size"?: string;
  "compactor.persistence.claims.storageClass"?: string;
  "compactor.persistence.claims.volumeAttributesClassName"?: string;
  "compactor.persistence.enableStatefulSetAutoDeletePVC"?: string;
  "compactor.persistence.whenDeleted"?: string;
  "compactor.persistence.whenScaled"?: string;
  "compactor.serviceAccount.create"?: string;
  "compactor.serviceAccount.name"?: string;
  "compactor.serviceAccount.imagePullSecrets"?: string;
  "compactor.serviceAccount.automountServiceAccountToken"?: string;
  "bloomGateway.replicas"?: string;
  "bloomGateway.hostAliases"?: string;
  "bloomGateway.hostUsers"?: string;
  "bloomGateway.image.registry"?: string;
  "bloomGateway.image.repository"?: string;
  "bloomGateway.image.tag"?: string;
  "bloomGateway.command"?: string;
  "bloomGateway.priorityClassName"?: string;
  "bloomGateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "bloomGateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "bloomGateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "bloomGateway.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "bloomGateway.extraArgs"?: string;
  "bloomGateway.extraEnv"?: string;
  "bloomGateway.extraEnvFrom"?: string;
  "bloomGateway.extraVolumeMounts"?: string;
  "bloomGateway.extraVolumes"?: string;
  "bloomGateway.extraContainers"?: string;
  "bloomGateway.initContainers"?: string;
  "bloomGateway.terminationGracePeriodSeconds"?: string;
  "bloomGateway.tolerations"?: string;
  "bloomGateway.appProtocol.grpc"?: string;
  "bloomGateway.persistence.enabled"?: string;
  "bloomGateway.persistence.claims.name"?: string;
  "bloomGateway.persistence.claims.accessModes"?: string;
  "bloomGateway.persistence.claims.size"?: string;
  "bloomGateway.persistence.claims.storageClass"?: string;
  "bloomGateway.persistence.claims.volumeAttributesClassName"?: string;
  "bloomGateway.persistence.enableStatefulSetAutoDeletePVC"?: string;
  "bloomGateway.persistence.whenDeleted"?: string;
  "bloomGateway.persistence.whenScaled"?: string;
  "bloomGateway.serviceAccount.create"?: string;
  "bloomGateway.serviceAccount.name"?: string;
  "bloomGateway.serviceAccount.imagePullSecrets"?: string;
  "bloomGateway.serviceAccount.automountServiceAccountToken"?: string;
  "bloomPlanner.replicas"?: string;
  "bloomPlanner.hostAliases"?: string;
  "bloomPlanner.hostUsers"?: string;
  "bloomPlanner.image.registry"?: string;
  "bloomPlanner.image.repository"?: string;
  "bloomPlanner.image.tag"?: string;
  "bloomPlanner.command"?: string;
  "bloomPlanner.priorityClassName"?: string;
  "bloomPlanner.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "bloomPlanner.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "bloomPlanner.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "bloomPlanner.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "bloomPlanner.extraArgs"?: string;
  "bloomPlanner.extraEnv"?: string;
  "bloomPlanner.extraEnvFrom"?: string;
  "bloomPlanner.extraVolumeMounts"?: string;
  "bloomPlanner.extraVolumes"?: string;
  "bloomPlanner.extraContainers"?: string;
  "bloomPlanner.initContainers"?: string;
  "bloomPlanner.terminationGracePeriodSeconds"?: string;
  "bloomPlanner.tolerations"?: string;
  "bloomPlanner.appProtocol.grpc"?: string;
  "bloomPlanner.persistence.enabled"?: string;
  "bloomPlanner.persistence.claims.name"?: string;
  "bloomPlanner.persistence.claims.accessModes"?: string;
  "bloomPlanner.persistence.claims.size"?: string;
  "bloomPlanner.persistence.claims.storageClass"?: string;
  "bloomPlanner.persistence.claims.volumeAttributesClassName"?: string;
  "bloomPlanner.persistence.enableStatefulSetAutoDeletePVC"?: string;
  "bloomPlanner.persistence.whenDeleted"?: string;
  "bloomPlanner.persistence.whenScaled"?: string;
  "bloomPlanner.serviceAccount.create"?: string;
  "bloomPlanner.serviceAccount.name"?: string;
  "bloomPlanner.serviceAccount.imagePullSecrets"?: string;
  "bloomPlanner.serviceAccount.automountServiceAccountToken"?: string;
  "bloomBuilder.replicas"?: string;
  "bloomBuilder.hostAliases"?: string;
  "bloomBuilder.hostUsers"?: string;
  "bloomBuilder.autoscaling.enabled"?: string;
  "bloomBuilder.autoscaling.minReplicas"?: string;
  "bloomBuilder.autoscaling.maxReplicas"?: string;
  "bloomBuilder.autoscaling.targetCPUUtilizationPercentage"?: string;
  "bloomBuilder.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "bloomBuilder.autoscaling.customMetrics"?: string;
  "bloomBuilder.autoscaling.behavior.enabled"?: string;
  "bloomBuilder.image.registry"?: string;
  "bloomBuilder.image.repository"?: string;
  "bloomBuilder.image.tag"?: string;
  "bloomBuilder.command"?: string;
  "bloomBuilder.priorityClassName"?: string;
  "bloomBuilder.extraArgs"?: string;
  "bloomBuilder.extraEnv"?: string;
  "bloomBuilder.extraEnvFrom"?: string;
  "bloomBuilder.extraVolumeMounts"?: string;
  "bloomBuilder.extraVolumes"?: string;
  "bloomBuilder.initContainers"?: string;
  "bloomBuilder.extraContainers"?: string;
  "bloomBuilder.terminationGracePeriodSeconds"?: string;
  "bloomBuilder.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "bloomBuilder.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "bloomBuilder.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "bloomBuilder.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "bloomBuilder.maxUnavailable"?: string;
  "bloomBuilder.tolerations"?: string;
  "bloomBuilder.appProtocol.grpc"?: string;
  "patternIngester.replicas"?: string;
  "patternIngester.hostAliases"?: string;
  "patternIngester.hostUsers"?: string;
  "patternIngester.image.registry"?: string;
  "patternIngester.image.repository"?: string;
  "patternIngester.image.tag"?: string;
  "patternIngester.command"?: string;
  "patternIngester.priorityClassName"?: string;
  "patternIngester.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "patternIngester.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "patternIngester.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "patternIngester.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "patternIngester.maxUnavailable"?: string;
  "patternIngester.extraArgs"?: string;
  "patternIngester.extraEnv"?: string;
  "patternIngester.extraEnvFrom"?: string;
  "patternIngester.extraVolumeMounts"?: string;
  "patternIngester.extraVolumes"?: string;
  "patternIngester.extraContainers"?: string;
  "patternIngester.initContainers"?: string;
  "patternIngester.terminationGracePeriodSeconds"?: string;
  "patternIngester.topologySpreadConstraints"?: string;
  "patternIngester.tolerations"?: string;
  "patternIngester.appProtocol.grpc"?: string;
  "patternIngester.persistence.enabled"?: string;
  "patternIngester.persistence.size"?: string;
  "patternIngester.persistence.storageClass"?: string;
  "patternIngester.persistence.claims.name"?: string;
  "patternIngester.persistence.claims.accessModes"?: string;
  "patternIngester.persistence.claims.size"?: string;
  "patternIngester.persistence.claims.storageClass"?: string;
  "patternIngester.persistence.claims.volumeAttributesClassName"?: string;
  "patternIngester.persistence.enableStatefulSetAutoDeletePVC"?: string;
  "patternIngester.persistence.whenDeleted"?: string;
  "patternIngester.persistence.whenScaled"?: string;
  "patternIngester.serviceAccount.create"?: string;
  "patternIngester.serviceAccount.name"?: string;
  "patternIngester.serviceAccount.imagePullSecrets"?: string;
  "patternIngester.serviceAccount.automountServiceAccountToken"?: string;
  "ruler.enabled"?: string;
  "ruler.sidecar"?: string;
  "ruler.replicas"?: string;
  "ruler.hostAliases"?: string;
  "ruler.hostUsers"?: string;
  "ruler.image.registry"?: string;
  "ruler.image.repository"?: string;
  "ruler.image.tag"?: string;
  "ruler.command"?: string;
  "ruler.priorityClassName"?: string;
  "ruler.extraArgs"?: string;
  "ruler.extraEnv"?: string;
  "ruler.extraEnvFrom"?: string;
  "ruler.extraVolumeMounts"?: string;
  "ruler.extraVolumes"?: string;
  "ruler.extraContainers"?: string;
  "ruler.initContainers"?: string;
  "ruler.terminationGracePeriodSeconds"?: string;
  "ruler.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "ruler.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "ruler.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "ruler.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "ruler.maxUnavailable"?: string;
  "ruler.topologySpreadConstraints"?: string;
  "ruler.tolerations"?: string;
  "ruler.persistence.enabled"?: string;
  "ruler.persistence.accessModes"?: string;
  "ruler.persistence.size"?: string;
  "ruler.persistence.storageClass"?: string;
  "ruler.persistence.volumeAttributesClassName"?: string;
  "ruler.appProtocol.grpc"?: string;
  "overridesExporter.enabled"?: string;
  "overridesExporter.replicas"?: string;
  "overridesExporter.hostAliases"?: string;
  "overridesExporter.hostUsers"?: string;
  "overridesExporter.image.registry"?: string;
  "overridesExporter.image.repository"?: string;
  "overridesExporter.image.tag"?: string;
  "overridesExporter.command"?: string;
  "overridesExporter.priorityClassName"?: string;
  "overridesExporter.extraArgs"?: string;
  "overridesExporter.extraEnv"?: string;
  "overridesExporter.extraEnvFrom"?: string;
  "overridesExporter.extraVolumeMounts"?: string;
  "overridesExporter.extraVolumes"?: string;
  "overridesExporter.extraContainers"?: string;
  "overridesExporter.initContainers"?: string;
  "overridesExporter.terminationGracePeriodSeconds"?: string;
  "overridesExporter.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "overridesExporter.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "overridesExporter.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "overridesExporter.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "overridesExporter.maxUnavailable"?: string;
  "overridesExporter.topologySpreadConstraints"?: string;
  "overridesExporter.tolerations"?: string;
  "overridesExporter.appProtocol.grpc"?: string;
  "memcached.enabled"?: string;
  "memcached.image.repository"?: string;
  "memcached.image.tag"?: string;
  "memcached.image.pullPolicy"?: string;
  "memcached.podSecurityContext.runAsNonRoot"?: string;
  "memcached.podSecurityContext.runAsUser"?: string;
  "memcached.podSecurityContext.runAsGroup"?: string;
  "memcached.podSecurityContext.fsGroup"?: string;
  "memcached.priorityClassName"?: string;
  "memcached.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "memcached.containerSecurityContext.capabilities.drop"?: string;
  "memcached.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "memcached.readinessProbe.tcpSocket.port"?: string;
  "memcached.readinessProbe.initialDelaySeconds"?: string;
  "memcached.readinessProbe.periodSeconds"?: string;
  "memcached.readinessProbe.timeoutSeconds"?: string;
  "memcached.readinessProbe.failureThreshold"?: string;
  "memcached.livenessProbe.tcpSocket.port"?: string;
  "memcached.livenessProbe.initialDelaySeconds"?: string;
  "memcached.livenessProbe.periodSeconds"?: string;
  "memcached.livenessProbe.timeoutSeconds"?: string;
  "memcached.livenessProbe.failureThreshold"?: string;
  "memcachedExporter.enabled"?: string;
  "memcachedExporter.image.repository"?: string;
  "memcachedExporter.image.tag"?: string;
  "memcachedExporter.image.pullPolicy"?: string;
  "memcachedExporter.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "memcachedExporter.containerSecurityContext.capabilities.drop"?: string;
  "memcachedExporter.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "memcachedExporter.livenessProbe.httpGet.path"?: string;
  "memcachedExporter.livenessProbe.httpGet.port"?: string;
  "memcachedExporter.livenessProbe.initialDelaySeconds"?: string;
  "memcachedExporter.livenessProbe.periodSeconds"?: string;
  "memcachedExporter.livenessProbe.timeoutSeconds"?: string;
  "memcachedExporter.livenessProbe.failureThreshold"?: string;
  "memcachedExporter.readinessProbe.httpGet.path"?: string;
  "memcachedExporter.readinessProbe.httpGet.port"?: string;
  "memcachedExporter.readinessProbe.initialDelaySeconds"?: string;
  "memcachedExporter.readinessProbe.periodSeconds"?: string;
  "memcachedExporter.readinessProbe.timeoutSeconds"?: string;
  "memcachedExporter.readinessProbe.failureThreshold"?: string;
  "resultsCache.enabled"?: string;
  "resultsCache.addresses"?: string;
  "resultsCache.defaultValidity"?: string;
  "resultsCache.timeout"?: string;
  "resultsCache.replicas"?: string;
  "resultsCache.port"?: string;
  "resultsCache.allocatedMemory"?: string;
  "resultsCache.maxItemMemory"?: string;
  "resultsCache.connectionLimit"?: string;
  "resultsCache.writebackSizeLimit"?: string;
  "resultsCache.writebackBuffer"?: string;
  "resultsCache.writebackParallelism"?: string;
  "resultsCache.initContainers"?: string;
  "resultsCache.topologySpreadConstraints"?: string;
  "resultsCache.tolerations"?: string;
  "resultsCache.maxUnavailable"?: string;
  "resultsCache.priorityClassName"?: string;
  "resultsCache.hostUsers"?: string;
  "resultsCache.podManagementPolicy"?: string;
  "resultsCache.terminationGracePeriodSeconds"?: string;
  "resultsCache.statefulStrategy.type"?: string;
  "resultsCache.extraExtendedOptions"?: string;
  "resultsCache.extraContainers"?: string;
  "resultsCache.extraVolumes"?: string;
  "resultsCache.extraVolumeMounts"?: string;
  "resultsCache.resources"?: string;
  "resultsCache.persistence.enabled"?: string;
  "resultsCache.persistence.storageSize"?: string;
  "resultsCache.persistence.storageClass"?: string;
  "resultsCache.persistence.volumeAttributesClassName"?: string;
  "resultsCache.persistence.mountPath"?: string;
  "chunksCache.suffix"?: string;
  "chunksCache.enabled"?: string;
  "chunksCache.addresses"?: string;
  "chunksCache.batchSize"?: string;
  "chunksCache.parallelism"?: string;
  "chunksCache.timeout"?: string;
  "chunksCache.defaultValidity"?: string;
  "chunksCache.replicas"?: string;
  "chunksCache.port"?: string;
  "chunksCache.allocatedMemory"?: string;
  "chunksCache.maxItemMemory"?: string;
  "chunksCache.connectionLimit"?: string;
  "chunksCache.writebackSizeLimit"?: string;
  "chunksCache.writebackBuffer"?: string;
  "chunksCache.writebackParallelism"?: string;
  "chunksCache.initContainers"?: string;
  "chunksCache.topologySpreadConstraints"?: string;
  "chunksCache.tolerations"?: string;
  "chunksCache.maxUnavailable"?: string;
  "chunksCache.priorityClassName"?: string;
  "chunksCache.hostUsers"?: string;
  "chunksCache.podManagementPolicy"?: string;
  "chunksCache.terminationGracePeriodSeconds"?: string;
  "chunksCache.statefulStrategy.type"?: string;
  "chunksCache.extraExtendedOptions"?: string;
  "chunksCache.extraContainers"?: string;
  "chunksCache.extraVolumes"?: string;
  "chunksCache.extraVolumeMounts"?: string;
  "chunksCache.resources"?: string;
  "chunksCache.persistence.enabled"?: string;
  "chunksCache.persistence.storageSize"?: string;
  "chunksCache.persistence.storageClass"?: string;
  "chunksCache.persistence.volumeAttributesClassName"?: string;
  "chunksCache.persistence.mountPath"?: string;
  "chunksCache.l2.suffix"?: string;
  "chunksCache.l2.l2ChunkCacheHandoff"?: string;
  "chunksCache.l2.enabled"?: string;
  "chunksCache.l2.addresses"?: string;
  "chunksCache.l2.batchSize"?: string;
  "chunksCache.l2.parallelism"?: string;
  "chunksCache.l2.timeout"?: string;
  "chunksCache.l2.defaultValidity"?: string;
  "chunksCache.l2.replicas"?: string;
  "chunksCache.l2.port"?: string;
  "chunksCache.l2.allocatedMemory"?: string;
  "chunksCache.l2.maxItemMemory"?: string;
  "chunksCache.l2.connectionLimit"?: string;
  "chunksCache.l2.writebackSizeLimit"?: string;
  "chunksCache.l2.writebackBuffer"?: string;
  "chunksCache.l2.writebackParallelism"?: string;
  "chunksCache.l2.initContainers"?: string;
  "chunksCache.l2.topologySpreadConstraints"?: string;
  "chunksCache.l2.tolerations"?: string;
  "chunksCache.l2.maxUnavailable"?: string;
  "chunksCache.l2.priorityClassName"?: string;
  "chunksCache.l2.hostUsers"?: string;
  "chunksCache.l2.podManagementPolicy"?: string;
  "chunksCache.l2.terminationGracePeriodSeconds"?: string;
  "chunksCache.l2.statefulStrategy.type"?: string;
  "chunksCache.l2.extraExtendedOptions"?: string;
  "chunksCache.l2.extraContainers"?: string;
  "chunksCache.l2.extraVolumes"?: string;
  "chunksCache.l2.extraVolumeMounts"?: string;
  "chunksCache.l2.resources"?: string;
  "chunksCache.l2.persistence.enabled"?: string;
  "chunksCache.l2.persistence.storageSize"?: string;
  "chunksCache.l2.persistence.storageClass"?: string;
  "chunksCache.l2.persistence.volumeAttributesClassName"?: string;
  "chunksCache.l2.persistence.mountPath"?: string;
  "rollout_operator.enabled"?: string;
  "rollout_operator.podSecurityContext.fsGroup"?: string;
  "rollout_operator.podSecurityContext.runAsGroup"?: string;
  "rollout_operator.podSecurityContext.runAsNonRoot"?: string;
  "rollout_operator.podSecurityContext.runAsUser"?: string;
  "rollout_operator.podSecurityContext.seccompProfile.type"?: string;
  "rollout_operator.securityContext.readOnlyRootFilesystem"?: string;
  "rollout_operator.securityContext.capabilities.drop"?: string;
  "rollout_operator.securityContext.allowPrivilegeEscalation"?: string;
  "minio.enabled"?: string;
  "minio.replicas"?: string;
  "minio.drivesPerNode"?: string;
  "minio.rootUser"?: string;
  "minio.rootPassword"?: string;
  "minio.users.accessKey"?: string;
  "minio.users.secretKey"?: string;
  "minio.users.policy"?: string;
  "minio.buckets.name"?: string;
  "minio.buckets.policy"?: string;
  "minio.buckets.purge"?: string;
  "minio.persistence.size"?: string;
  "minio.resources.requests.cpu"?: string;
  "minio.resources.requests.memory"?: string;
  "minio.resources.limits.cpu"?: string;
  "minio.resources.limits.memory"?: string;
  "minio.address"?: string;
  extraObjects?: string;
  "sidecar.image.registry"?: string;
  "sidecar.image.repository"?: string;
  "sidecar.image.tag"?: string;
  "sidecar.image.sha"?: string;
  "sidecar.image.pullPolicy"?: string;
  "sidecar.securityContext.readOnlyRootFilesystem"?: string;
  "sidecar.securityContext.capabilities.drop"?: string;
  "sidecar.securityContext.allowPrivilegeEscalation"?: string;
  "sidecar.skipTlsVerify"?: string;
  "sidecar.enableUniqueFilenames"?: string;
  "sidecar.rules.enabled"?: string;
  "sidecar.rules.label"?: string;
  "sidecar.rules.labelValue"?: string;
  "sidecar.rules.folder"?: string;
  "sidecar.rules.folderAnnotation"?: string;
  "sidecar.rules.searchNamespace"?: string;
  "sidecar.rules.watchMethod"?: string;
  "sidecar.rules.resource"?: string;
  "sidecar.rules.script"?: string;
  "sidecar.rules.watchServerTimeout"?: string;
  "sidecar.rules.watchClientTimeout"?: string;
  "sidecar.rules.logLevel"?: string;
  "monitoring.dashboards.enabled"?: string;
  "monitoring.dashboards.namespace"?: string;
  "monitoring.dashboards.labels.grafana_dashboard"?: string;
  "monitoring.rules.enabled"?: string;
  "monitoring.rules.alerting"?: string;
  "monitoring.rules.configs.LokiRequestErrors.enabled"?: string;
  "monitoring.rules.configs.LokiRequestErrors.for"?: string;
  "monitoring.rules.configs.LokiRequestErrors.lookbackPeriod"?: string;
  "monitoring.rules.configs.LokiRequestErrors.severity"?: string;
  "monitoring.rules.configs.LokiRequestErrors.threshold"?: string;
  "monitoring.rules.configs.LokiRequestPanics.enabled"?: string;
  "monitoring.rules.configs.LokiRequestPanics.lookbackPeriod"?: string;
  "monitoring.rules.configs.LokiRequestPanics.severity"?: string;
  "monitoring.rules.configs.LokiRequestPanics.threshold"?: string;
  "monitoring.rules.configs.LokiRequestLatency.enabled"?: string;
  "monitoring.rules.configs.LokiRequestLatency.for"?: string;
  "monitoring.rules.configs.LokiRequestLatency.severity"?: string;
  "monitoring.rules.configs.LokiRequestLatency.threshold"?: string;
  "monitoring.rules.configs.LokiTooManyCompactorsRunning.enabled"?: string;
  "monitoring.rules.configs.LokiTooManyCompactorsRunning.for"?: string;
  "monitoring.rules.configs.LokiTooManyCompactorsRunning.severity"?: string;
  "monitoring.rules.configs.LokiCanaryLatency.enabled"?: string;
  "monitoring.rules.configs.LokiCanaryLatency.for"?: string;
  "monitoring.rules.configs.LokiCanaryLatency.lookbackPeriod"?: string;
  "monitoring.rules.configs.LokiCanaryLatency.severity"?: string;
  "monitoring.rules.configs.LokiCanaryLatency.threshold"?: string;
  "monitoring.rules.namespace"?: string;
  "monitoring.rules.additionalGroups"?: string;
  "monitoring.serviceMonitor.enabled"?: string;
  "monitoring.serviceMonitor.interval"?: string;
  "monitoring.serviceMonitor.scrapeTimeout"?: string;
  "monitoring.serviceMonitor.relabelings"?: string;
  "monitoring.serviceMonitor.metricRelabelings"?: string;
  "monitoring.serviceMonitor.scheme"?: string;
  "monitoring.serviceMonitor.tlsConfig"?: string;
  "monitoring.serviceMonitor.metricsInstance.enabled"?: string;
  "monitoring.serviceMonitor.metricsInstance.remoteWrite"?: string;
  "monitoring.selfMonitoring.enabled"?: string;
  "monitoring.selfMonitoring.tenant.name"?: string;
  "monitoring.selfMonitoring.tenant.password"?: string;
  "monitoring.selfMonitoring.tenant.secretNamespace"?: string;
  "monitoring.selfMonitoring.grafanaAgent.installOperator"?: string;
  "monitoring.selfMonitoring.grafanaAgent.enableConfigReadAPI"?: string;
  "monitoring.selfMonitoring.grafanaAgent.priorityClassName"?: string;
  "monitoring.selfMonitoring.grafanaAgent.tolerations"?: string;
  "monitoring.selfMonitoring.podLogs.apiVersion"?: string;
  "monitoring.selfMonitoring.podLogs.relabelings"?: string;
  "monitoring.selfMonitoring.podLogs.additionalPipelineStages"?: string;
  "monitoring.selfMonitoring.logsInstance.clients"?: string;
  "tableManager.enabled"?: string;
  "tableManager.image.registry"?: string;
  "tableManager.image.repository"?: string;
  "tableManager.image.tag"?: string;
  "tableManager.command"?: string;
  "tableManager.priorityClassName"?: string;
  "tableManager.extraArgs"?: string;
  "tableManager.extraEnv"?: string;
  "tableManager.extraEnvFrom"?: string;
  "tableManager.extraVolumeMounts"?: string;
  "tableManager.extraVolumes"?: string;
  "tableManager.extraContainers"?: string;
  "tableManager.terminationGracePeriodSeconds"?: string;
  "tableManager.hostUsers"?: string;
  "tableManager.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/component"?: string;
  "tableManager.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/name"?: string;
  "tableManager.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.labelSelector.matchLabels.app.kubernetes.io/instance"?: string;
  "tableManager.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution.topologyKey"?: string;
  "tableManager.tolerations"?: string;
  "tableManager.retention_deletes_enabled"?: string;
  "tableManager.retention_period"?: string;
};
