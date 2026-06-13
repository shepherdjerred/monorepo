// Generated TypeScript types for pyroscope Helm chart

export type PyroscopeHelmValuesGlobal = {
  imageRegistry?: unknown;
};

export type PyroscopeHelmValuesPyroscope = {
  /**
   * @default 1
   */
  replicaCount?: number;
  /**
   * Enable or disable Self profile push, useful to test
   *
   * @default true
   */
  disableSelfProfile?: boolean;
  /**
   * Kubernetes cluster domain suffix for DNS discovery
   *
   * @default ".cluster.local."
   */
  cluster_domain?: string;
  /**
   * @default {...} (4 keys)
   */
  image?: PyroscopeHelmValuesPyroscopeImage;
  /**
   * @default {"log.level":"debug"}
   */
  extraArgs?: PyroscopeHelmValuesPyroscopeExtraArgs;
  /**
   * @default {}
   */
  extraLabels?: PyroscopeHelmValuesPyroscopeExtraLabels;
  /**
   * The following environment variables are set by the Helm chart.
   *
   * @default {}
   */
  extraEnvVars?: PyroscopeHelmValuesPyroscopeExtraEnvVars;
  /**
   * The following environment variables raw form.
   *
   * @default {}
   */
  extraCustomEnvVars?: PyroscopeHelmValuesPyroscopeExtraCustomEnvVars;
  extraEnvFrom?: unknown[];
  imagePullSecrets?: unknown[];
  /**
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  initContainers?: unknown[];
  extraContainers?: unknown[];
  /**
   * @default ""
   */
  nameOverride?: string;
  /**
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * @default {"create":true}
   */
  rbac?: PyroscopeHelmValuesPyroscopeRbac;
  /**
   * @default {"create":true,"annotations":{},"name":""}
   */
  serviceAccount?: PyroscopeHelmValuesPyroscopeServiceAccount;
  /**
   * profiles.grafana.com/block.scrape: "true"
   * profiles.grafana.com/mutex.scrape: "true"
   *
   * @default {...} (6 keys)
   */
  podAnnotations?: PyroscopeHelmValuesPyroscopePodAnnotations;
  /**
   * @default {"fsGroup":10001,"runAsUser":10001,"runAsNonRoot":true}
   */
  podSecurityContext?: PyroscopeHelmValuesPyroscopePodSecurityContext;
  /**
   * @default {"enabled":true,"maxUnavailable":1}
   */
  podDisruptionBudget?: PyroscopeHelmValuesPyroscopePodDisruptionBudget;
  /**
   * @default {}
   */
  securityContext?: PyroscopeHelmValuesPyroscopeSecurityContext;
  /**
   * @default {...} (6 keys)
   */
  service?: PyroscopeHelmValuesPyroscopeService;
  /**
   * @default {"port":7946,"port_name":"memberlist"}
   */
  memberlist?: PyroscopeHelmValuesPyroscopeMemberlist;
  /**
   * @default {"port":9095,"port_name":"grpc"}
   */
  grpc?: PyroscopeHelmValuesPyroscopeGrpc;
  /**
   * @default {"port":9099,"port_name":"raft"}
   */
  metastore?: PyroscopeHelmValuesPyroscopeMetastore;
  /**
   * We usually recommend not to specify default resources and to leave this as a conscious
   * choice for the user. This also increases chances charts run on environments with little
   * resources, such as Minikube. If you do want to specify resources, uncomment the following
   * lines, adjust them as necessary, and remove the curly braces after 'resources'.
   * Note that if memory consumption is higher than you would like, you can decrease the interval
   * that profiles are written into blocks by setting `pyroscopedb.max-block-duration` in the `extraArgs`
   * stanza. By default, it is set to 3h - override it, for example, as below:
   * ```
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  topologySpreadConstraints?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/concepts/storage/persistent-volumes/
   * If you set enabled as "True", you need :
   * - create a pv which above 10Gi and has same namespace with pyroscope
   * - keep storageClassName same with below setting
   *
   * @default {...} (5 keys)
   */
  persistence?: PyroscopeHelmValuesPyroscopePersistence;
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * Override the PodPriorityClass
   * run specific components separately
   *
   * @default {}
   */
  components?: PyroscopeHelmValuesPyroscopeComponents;
  /**
   * Allows to override Pyroscope's configuration using structured format.
   *
   * @default {}
   */
  structuredConfig?: PyroscopeHelmValuesPyroscopeStructuredConfig;
  /**
   * Contains Pyroscope's configuration as a string.
   *
   * @default "{{- if .Values.minio.enabled }}
storage:
  back..."
   */
  config?: string;
  /**
   * Allows to add tenant specific overrides to the default limit configuration.
   * "foo":
   *
   * @default {}
   */
  tenantOverrides?: PyroscopeHelmValuesPyroscopeTenantOverrides;
};

export type PyroscopeHelmValuesPyroscopeImage = {
  /**
   * @default ""
   */
  registry?: string;
  /**
   * @default "grafana/pyroscope"
   */
  repository?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * Allows to override the image tag, which defaults to the appVersion in the chart metadata
   *
   * @default ""
   */
  tag?: string;
};

export type PyroscopeHelmValuesPyroscopeExtraArgs = {
  /**
   * @default "debug"
   */
  "log.level"?: string;
};

export type PyroscopeHelmValuesPyroscopeExtraLabels = object;

export type PyroscopeHelmValuesPyroscopeExtraEnvVars = object;

export type PyroscopeHelmValuesPyroscopeExtraCustomEnvVars = object;

export type PyroscopeHelmValuesPyroscopeRbac = {
  /**
   * Whether to create RBAC resources
   *
   * @default true
   */
  create?: boolean;
};

export type PyroscopeHelmValuesPyroscopeServiceAccount = {
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
  annotations?: PyroscopeHelmValuesPyroscopeServiceAccountAnnotations;
  /**
   * The name of the service account to use.
   * If not set and create is true, a name is generated using the fullname template
   *
   * @default ""
   */
  name?: string;
};

export type PyroscopeHelmValuesPyroscopeServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PyroscopeHelmValuesPyroscopePodAnnotations = {
  /**
   * Scrapes itself see https://grafana.com/docs/pyroscope/latest/deploy-kubernetes/helm/#optional-scrape-your-own-workloads-profiles
   *
   * @default "true"
   */
  "profiles.grafana.com/memory.scrape"?: boolean;
  /**
   * @default "http2"
   */
  "profiles.grafana.com/memory.port_name"?: string;
  /**
   * @default "true"
   */
  "profiles.grafana.com/cpu.scrape"?: boolean;
  /**
   * @default "http2"
   */
  "profiles.grafana.com/cpu.port_name"?: string;
  /**
   * @default "true"
   */
  "profiles.grafana.com/goroutine.scrape"?: boolean;
  /**
   * @default "http2"
   */
  "profiles.grafana.com/goroutine.port_name"?: string;
};

export type PyroscopeHelmValuesPyroscopePodSecurityContext = {
  /**
   * @default 10001
   */
  fsGroup?: number;
  /**
   * @default 10001
   */
  runAsUser?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
};

export type PyroscopeHelmValuesPyroscopePodDisruptionBudget = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  maxUnavailable?: number;
};

export type PyroscopeHelmValuesPyroscopeSecurityContext = object;

export type PyroscopeHelmValuesPyroscopeService = {
  /**
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default 4040
   */
  port?: number;
  /**
   * @default "http2"
   */
  port_name?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
  /**
   * @default {}
   */
  annotations?: PyroscopeHelmValuesPyroscopeServiceAnnotations;
  /**
   * @default {}
   */
  headlessAnnotations?: PyroscopeHelmValuesPyroscopeServiceHeadlessAnnotations;
};

export type PyroscopeHelmValuesPyroscopeServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PyroscopeHelmValuesPyroscopeServiceHeadlessAnnotations = object;

export type PyroscopeHelmValuesPyroscopeMemberlist = {
  /**
   * @default 7946
   */
  port?: number;
  /**
   * @default "memberlist"
   */
  port_name?: string;
};

export type PyroscopeHelmValuesPyroscopeGrpc = {
  /**
   * @default 9095
   */
  port?: number;
  /**
   * @default "grpc"
   */
  port_name?: string;
};

export type PyroscopeHelmValuesPyroscopeMetastore = {
  /**
   * @default 9099
   */
  port?: number;
  /**
   * @default "raft"
   */
  port_name?: string;
};

export type PyroscopeHelmValuesPyroscopePersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default false
   */
  enabled?: boolean;
  accessModes?: string[];
  /**
   * @default "10Gi"
   */
  size?: string;
  /**
   * @default {}
   */
  annotations?: PyroscopeHelmValuesPyroscopePersistenceAnnotations;
  /**
   * @default {"subPath":".metastore"}
   */
  metastore?: PyroscopeHelmValuesPyroscopePersistenceMetastore;
};

export type PyroscopeHelmValuesPyroscopePersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PyroscopeHelmValuesPyroscopePersistenceMetastore = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * subPath to use of the data volume for the metastore persistence.
   *
   * @default ".metastore"
   */
  subPath?: string;
};

export type PyroscopeHelmValuesPyroscopeComponents = object;

export type PyroscopeHelmValuesPyroscopeStructuredConfig = object;

export type PyroscopeHelmValuesPyroscopeTenantOverrides = object;

export type PyroscopeHelmValuesArchitecture = {
  /**
   * @default {"v1":false,"v2":true,"migration":{"ingesterWeight":1,"segmentWriterWeight":1,"queryBackendFrom":"auto"}}
   */
  storage?: PyroscopeHelmValuesArchitectureStorage;
  /**
   * This flag is useful for testing, it will overwrite all pods resource statements with its contents
   *
   * @default {}
   */
  overwriteResources?: PyroscopeHelmValuesArchitectureOverwriteResources;
  /**
   * Deploy unified write/read services. These endpoints will can be used no matter if the helm chart is configured as single-binary or microservices
   *
   * @default false
   */
  deployUnifiedServices?: boolean;
  /**
   * @default {...} (4 keys)
   */
  microservices?: PyroscopeHelmValuesArchitectureMicroservices;
};

export type PyroscopeHelmValuesArchitectureStorage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * (bool) Enable v1 storage layer.
   *
   * @default false
   */
  v1?: boolean;
  /**
   * (bool) Enable v2 storage layer.
   *
   * @default true
   */
  v2?: boolean;
  /**
   * @default {"ingesterWeight":1,"segmentWriterWeight":1,"queryBackendFrom":"auto"}
   */
  migration?: PyroscopeHelmValuesArchitectureStorageMigration;
};

export type PyroscopeHelmValuesArchitectureStorageMigration = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * (float) Specifies the fraction [0:1] that should be send to the v1 write path / ingester in combined mode. 0 means no traffics is sent to ingester. 1 means 100% of requests are sent to ingester.
   *
   * @default 1
   */
  ingesterWeight?: number;
  /**
   * (float) Specifies the fraction [0:1] that should be send to the v2 write path / segment-writer in combined mode. 0 means no traffics is sent to segment-writer. 1 means 100% of requests are sent to segment-writer.
   *
   * @default 1
   */
  segmentWriterWeight?: number;
  /**
   * (string) Specify a time stamp from when the v2 read path should serve traffic. Defaults to "auto" which determines the split point from the metastore.
   *
   * @default "auto"
   */
  queryBackendFrom?: string;
};

export type PyroscopeHelmValuesArchitectureOverwriteResources = object;

export type PyroscopeHelmValuesArchitectureMicroservices = {
  /**
   * (bool) Enable micro-services deployment mode. This is recommend for larger scale deployment and allow right size each aspect of Pyroscope.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * (string) Memberlist cluster label that will be used for all members of this cluster
   *
   * @default "-micro-services"
   */
  clusterLabelSuffix?: string;
  /**
   * @ignored
   * Not useful to be indivually exposed
   *
   * @default {...} (9 keys)
   */
  v1?: PyroscopeHelmValuesArchitectureMicroservicesV1;
  /**
   * @ignored
   * Not useful to be indivually exposed
   *
   * @default {...} (9 keys)
   */
  v2?: PyroscopeHelmValuesArchitectureMicroservicesV2;
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1 = {
  /**
   * @default {...} (4 keys)
   */
  querier?: PyroscopeHelmValuesArchitectureMicroservicesV1Querier;
  /**
   * @default {"kind":"Deployment","replicaCount":2,"resources":{"limits":{"memory":"1Gi"},"requests":{"memory":"256Mi","cpu":"100m"}}}
   */
  "query-frontend"?: PyroscopeHelmValuesArchitectureMicroservicesV1Queryfrontend;
  /**
   * @default {"kind":"Deployment","replicaCount":2,"resources":{"limits":{"memory":"1Gi"},"requests":{"memory":"256Mi","cpu":"100m"}}}
   */
  "query-scheduler"?: PyroscopeHelmValuesArchitectureMicroservicesV1Queryscheduler;
  /**
   * @default {"kind":"Deployment","replicaCount":2,"resources":{"limits":{"memory":"1Gi"},"requests":{"memory":"256Mi","cpu":"500m"}}}
   */
  distributor?: PyroscopeHelmValuesArchitectureMicroservicesV1Distributor;
  /**
   * @default {...} (4 keys)
   */
  ingester?: PyroscopeHelmValuesArchitectureMicroservicesV1Ingester;
  /**
   * @default {...} (5 keys)
   */
  compactor?: PyroscopeHelmValuesArchitectureMicroservicesV1Compactor;
  /**
   * @default {...} (6 keys)
   */
  "store-gateway"?: PyroscopeHelmValuesArchitectureMicroservicesV1Storegateway;
  /**
   * @default {"kind":"Deployment","replicaCount":1,"resources":{"limits":{"memory":"4Gi"},"requests":{"memory":"16Mi","cpu":0.1}}}
   */
  "tenant-settings"?: PyroscopeHelmValuesArchitectureMicroservicesV1Tenantsettings;
  /**
   * @default {"kind":"Deployment","replicaCount":1,"resources":{"limits":{"memory":"4Gi"},"requests":{"memory":"16Mi","cpu":0.1}}}
   */
  "ad-hoc-profiles"?: PyroscopeHelmValuesArchitectureMicroservicesV1Adhocprofiles;
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1Querier = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 3
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * @default {"store-gateway.sharding-ring.replication-factor":"3"}
   */
  extraArgs?: PyroscopeHelmValuesArchitectureMicroservicesV1QuerierExtraArgs;
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1QuerierExtraArgs = {
  /**
   * @default "3"
   */
  "store-gateway.sharding-ring.replication-factor"?: number;
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1Queryfrontend = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 2
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1Queryscheduler = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 2
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1Distributor = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 2
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1Ingester = {
  /**
   * @default "StatefulSet"
   */
  kind?: string;
  /**
   * @default 3
   */
  replicaCount?: number;
  /**
   * @default 600
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1Compactor = {
  /**
   * @default "StatefulSet"
   */
  kind?: string;
  /**
   * @default 3
   */
  replicaCount?: number;
  /**
   * @default 1200
   */
  terminationGracePeriodSeconds?: number;
  /**
   * @default {"enabled":false}
   */
  persistence?: PyroscopeHelmValuesArchitectureMicroservicesV1CompactorPersistence;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1CompactorPersistence =
  {
    /**
     * This type allows arbitrary additional properties beyond those defined below.
     * This is common for config maps, custom settings, and extensible configurations.
     */
    [key: string]: unknown;
    /**
     * @default false
     */
    enabled?: boolean;
  };

export type PyroscopeHelmValuesArchitectureMicroservicesV1Storegateway = {
  /**
   * @default "StatefulSet"
   */
  kind?: string;
  /**
   * @default 3
   */
  replicaCount?: number;
  /**
   * @default {"enabled":false}
   */
  persistence?: PyroscopeHelmValuesArchitectureMicroservicesV1StoregatewayPersistence;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * @default {"initialDelaySeconds":60}
   */
  readinessProbe?: PyroscopeHelmValuesArchitectureMicroservicesV1StoregatewayReadinessProbe;
  /**
   * @default {"store-gateway.sharding-ring.replication-factor":"3"}
   */
  extraArgs?: PyroscopeHelmValuesArchitectureMicroservicesV1StoregatewayExtraArgs;
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1StoregatewayPersistence =
  {
    /**
     * This type allows arbitrary additional properties beyond those defined below.
     * This is common for config maps, custom settings, and extensible configurations.
     */
    [key: string]: unknown;
    /**
     * The store-gateway needs not need persistent storage, but we still run it as a StatefulSet
     * This is to avoid having blocks of data being
     *
     * @default false
     */
    enabled?: boolean;
  };

export type PyroscopeHelmValuesArchitectureMicroservicesV1StoregatewayReadinessProbe =
  {
    /**
     * The store gateway can be configured to wait on startup for ring stability to be reached before it becomes
     * ready. See the `store-gateway.sharding-ring.wait-stability-min-duration` server argument for more information.
     * Depending on this flag and the number of tenants + blocks that need to be synced on startup, pods can take
     * some time to become ready. This value can be used to ensure Kubernetes waits long enough and reduce errors.
     *
     * @default 60
     */
    initialDelaySeconds?: number;
  };

export type PyroscopeHelmValuesArchitectureMicroservicesV1StoregatewayExtraArgs =
  {
    /**
     * @default "3"
     */
    "store-gateway.sharding-ring.replication-factor"?: number;
  };

export type PyroscopeHelmValuesArchitectureMicroservicesV1Tenantsettings = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 1
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV1Adhocprofiles = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 1
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2 = {
  /**
   * @default {"kind":"Deployment","replicaCount":3,"resources":{"limits":{"memory":"1Gi"},"requests":{"memory":"256Mi","cpu":1}}}
   */
  "query-backend"?: PyroscopeHelmValuesArchitectureMicroservicesV2Querybackend;
  /**
   * @default {"kind":"Deployment","replicaCount":2,"resources":{"limits":{"memory":"1Gi"},"requests":{"memory":"256Mi","cpu":"100m"}}}
   */
  "query-frontend"?: PyroscopeHelmValuesArchitectureMicroservicesV2Queryfrontend;
  /**
   * @default {"kind":"Deployment","replicaCount":2,"resources":{"limits":{"memory":"1Gi"},"requests":{"memory":"256Mi","cpu":"500m"}}}
   */
  distributor?: PyroscopeHelmValuesArchitectureMicroservicesV2Distributor;
  /**
   * @default {...} (4 keys)
   */
  "segment-writer"?: PyroscopeHelmValuesArchitectureMicroservicesV2Segmentwriter;
  /**
   * @default {...} (5 keys)
   */
  "compaction-worker"?: PyroscopeHelmValuesArchitectureMicroservicesV2Compactionworker;
  /**
   * @default {...} (6 keys)
   */
  metastore?: PyroscopeHelmValuesArchitectureMicroservicesV2Metastore;
  /**
   * @default {"kind":"Deployment","replicaCount":1,"resources":{"limits":{"memory":"256Mi"},"requests":{"memory":"16Mi","cpu":0.1}}}
   */
  "tenant-settings"?: PyroscopeHelmValuesArchitectureMicroservicesV2Tenantsettings;
  /**
   * @default {"kind":"Deployment","replicaCount":1,"resources":{"limits":{"memory":"256Mi"},"requests":{"memory":"16Mi","cpu":0.1}}}
   */
  "ad-hoc-profiles"?: PyroscopeHelmValuesArchitectureMicroservicesV2Adhocprofiles;
  /**
   * @default {"kind":"Deployment","replicaCount":1,"resources":{"limits":{"memory":"256Mi"},"requests":{"memory":"16Mi","cpu":0.1}}}
   */
  admin?: PyroscopeHelmValuesArchitectureMicroservicesV2Admin;
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2Querybackend = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 3
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2Queryfrontend = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 2
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2Distributor = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 2
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2Segmentwriter = {
  /**
   * @default "StatefulSet"
   */
  kind?: string;
  /**
   * @default 3
   */
  replicaCount?: number;
  /**
   * @default 600
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2Compactionworker = {
  /**
   * @default "StatefulSet"
   */
  kind?: string;
  /**
   * @default 3
   */
  replicaCount?: number;
  /**
   * @default 1200
   */
  terminationGracePeriodSeconds?: number;
  /**
   * @default {"enabled":false}
   */
  persistence?: PyroscopeHelmValuesArchitectureMicroservicesV2CompactionworkerPersistence;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2CompactionworkerPersistence =
  {
    /**
     * This type allows arbitrary additional properties beyond those defined below.
     * This is common for config maps, custom settings, and extensible configurations.
     */
    [key: string]: unknown;
    /**
     * @default false
     */
    enabled?: boolean;
  };

export type PyroscopeHelmValuesArchitectureMicroservicesV2Metastore = {
  /**
   * @default "StatefulSet"
   */
  kind?: string;
  /**
   * @default 3
   */
  replicaCount?: number;
  /**
   * @default 1200
   */
  terminationGracePeriodSeconds?: number;
  /**
   * @default {"enabled":false}
   */
  persistence?: PyroscopeHelmValuesArchitectureMicroservicesV2MetastorePersistence;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * @default {"metastore.raft.bootstrap-expect-peers":3,"metastore.index.cleanup-interval":"1m","metastore.snapshot-compact-on-restore":true}
   */
  extraArgs?: PyroscopeHelmValuesArchitectureMicroservicesV2MetastoreExtraArgs;
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2MetastorePersistence =
  {
    /**
     * This type allows arbitrary additional properties beyond those defined below.
     * This is common for config maps, custom settings, and extensible configurations.
     */
    [key: string]: unknown;
    /**
     * @default false
     */
    enabled?: boolean;
  };

export type PyroscopeHelmValuesArchitectureMicroservicesV2MetastoreExtraArgs = {
  /**
   * Expect 3 metastores
   *
   * @default 3
   */
  "metastore.raft.bootstrap-expect-peers"?: number;
  /**
   * enable cleanup of blocks beyond retention
   *
   * @default "1m"
   */
  "metastore.index.cleanup-interval"?: string;
  /**
   * @default true
   */
  "metastore.snapshot-compact-on-restore"?: boolean;
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2Tenantsettings = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 1
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2Adhocprofiles = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 1
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesArchitectureMicroservicesV2Admin = {
  /**
   * @default "Deployment"
   */
  kind?: string;
  /**
   * @default 1
   */
  replicaCount?: number;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type PyroscopeHelmValuesAlloy = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"type":"statefulset","replicas":1,"podAnnotations":{"profiles.grafana.com/memory.scrape":"true","profiles.grafana.com/memory.port_name":"http-metrics","profiles.grafana.com/cpu.scrape":"true","profiles.grafana.com/cpu.port_name":"http-metrics","profiles.grafana.com/goroutine.scrape":"true","profiles.grafana.com/goroutine.port_name":"http-metrics","profiles.grafana.com/service_repository":"https://github.com/grafana/alloy","profiles.grafana.com/service_git_ref":"v1.8.1"}}
   */
  controller?: PyroscopeHelmValuesAlloyController;
  /**
   * @default {"stabilityLevel":"public-preview","configMap":{"create":false,"name":"alloy-config-pyroscope"},"clustering":{"enabled":true}}
   */
  alloy?: PyroscopeHelmValuesAlloyAlloy;
};

export type PyroscopeHelmValuesAlloyController = {
  /**
   * @default "statefulset"
   */
  type?: string;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default {...} (8 keys)
   */
  podAnnotations?: PyroscopeHelmValuesAlloyControllerPodAnnotations;
};

export type PyroscopeHelmValuesAlloyControllerPodAnnotations = {
  /**
   * @default "true"
   */
  "profiles.grafana.com/memory.scrape"?: boolean;
  /**
   * @default "http-metrics"
   */
  "profiles.grafana.com/memory.port_name"?: string;
  /**
   * @default "true"
   */
  "profiles.grafana.com/cpu.scrape"?: boolean;
  /**
   * @default "http-metrics"
   */
  "profiles.grafana.com/cpu.port_name"?: string;
  /**
   * @default "true"
   */
  "profiles.grafana.com/goroutine.scrape"?: boolean;
  /**
   * @default "http-metrics"
   */
  "profiles.grafana.com/goroutine.port_name"?: string;
  /**
   * @default "https://github.com/grafana/alloy"
   */
  "profiles.grafana.com/service_repository"?: string;
  /**
   * @default "v1.8.1"
   */
  "profiles.grafana.com/service_git_ref"?: string;
};

export type PyroscopeHelmValuesAlloyAlloy = {
  /**
   * This needs to be set for some of our resources until verison v1.2 is released
   *
   * @default "public-preview"
   */
  stabilityLevel?: string;
  /**
   * @default {"create":false,"name":"alloy-config-pyroscope"}
   */
  configMap?: PyroscopeHelmValuesAlloyAlloyConfigMap;
  /**
   * @default {"enabled":true}
   */
  clustering?: PyroscopeHelmValuesAlloyAlloyClustering;
};

export type PyroscopeHelmValuesAlloyAlloyConfigMap = {
  /**
   * @default false
   */
  create?: boolean;
  /**
   * @default "alloy-config-pyroscope"
   */
  name?: string;
};

export type PyroscopeHelmValuesAlloyAlloyClustering = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type PyroscopeHelmValuesAgent = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"type":"statefulset","replicas":1,"podAnnotations":{"profiles.grafana.com/memory.scrape":"true","profiles.grafana.com/memory.port_name":"http-metrics","profiles.grafana.com/cpu.scrape":"true","profiles.grafana.com/cpu.port_name":"http-metrics","profiles.grafana.com/goroutine.scrape":"true","profiles.grafana.com/goroutine.port_name":"http-metrics"}}
   */
  controller?: PyroscopeHelmValuesAgentController;
  /**
   * @default {"configMap":{"create":false,"name":"grafana-agent-config-pyroscope"},"clustering":{"enabled":true}}
   */
  agent?: PyroscopeHelmValuesAgentAgent;
};

export type PyroscopeHelmValuesAgentController = {
  /**
   * @default "statefulset"
   */
  type?: string;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default {...} (6 keys)
   */
  podAnnotations?: PyroscopeHelmValuesAgentControllerPodAnnotations;
};

export type PyroscopeHelmValuesAgentControllerPodAnnotations = {
  /**
   * @default "true"
   */
  "profiles.grafana.com/memory.scrape"?: boolean;
  /**
   * @default "http-metrics"
   */
  "profiles.grafana.com/memory.port_name"?: string;
  /**
   * @default "true"
   */
  "profiles.grafana.com/cpu.scrape"?: boolean;
  /**
   * @default "http-metrics"
   */
  "profiles.grafana.com/cpu.port_name"?: string;
  /**
   * @default "true"
   */
  "profiles.grafana.com/goroutine.scrape"?: boolean;
  /**
   * @default "http-metrics"
   */
  "profiles.grafana.com/goroutine.port_name"?: string;
};

export type PyroscopeHelmValuesAgentAgent = {
  /**
   * @default {"create":false,"name":"grafana-agent-config-pyroscope"}
   */
  configMap?: PyroscopeHelmValuesAgentAgentConfigMap;
  /**
   * @default {"enabled":true}
   */
  clustering?: PyroscopeHelmValuesAgentAgentClustering;
};

export type PyroscopeHelmValuesAgentAgentConfigMap = {
  /**
   * @default false
   */
  create?: boolean;
  /**
   * @default "grafana-agent-config-pyroscope"
   */
  name?: string;
};

export type PyroscopeHelmValuesAgentAgentClustering = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type PyroscopeHelmValuesMinio = {
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
   * @default "grafana-pyroscope"
   */
  rootUser?: string;
  /**
   * @default "supersecret"
   */
  rootPassword?: string;
  buckets?: PyroscopeHelmValuesMinioBucketsElement[];
  /**
   * @default {"size":"5Gi"}
   */
  persistence?: PyroscopeHelmValuesMinioPersistence;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * @default {}
   */
  podAnnotations?: PyroscopeHelmValuesMinioPodAnnotations;
};

export type PyroscopeHelmValuesMinioBucketsElement = {
  /**
   * @default "grafana-pyroscope-data"
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

export type PyroscopeHelmValuesMinioPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "5Gi"
   */
  size?: string;
};

export type PyroscopeHelmValuesMinioPodAnnotations = object;

export type PyroscopeHelmValuesIngress = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  className?: string;
  /**
   * @default "ImplementationSpecific"
   */
  pathType?: string;
  /**
   * Additional labels to add to the ingress resource
   *
   * @default {}
   */
  labels?: PyroscopeHelmValuesIngressLabels;
  /**
   * Additional annotations to add to the ingress resource
   *
   * @default {}
   */
  annotations?: PyroscopeHelmValuesIngressAnnotations;
};

export type PyroscopeHelmValuesIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PyroscopeHelmValuesIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PyroscopeHelmValuesHttpRoute = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"name":"","namespace":"","sectionName":null}
   */
  gateway?: PyroscopeHelmValuesHttpRouteGateway;
  /**
   * Additional labels to add to HTTPRoute resource.
   *
   * @default {}
   */
  labels?: PyroscopeHelmValuesHttpRouteLabels;
  /**
   * Additional annotations to add to HTTPRoute resource.
   *
   * @default {}
   */
  annotations?: PyroscopeHelmValuesHttpRouteAnnotations;
  hostnames?: unknown[];
  /**
   * Timeout settings to add to each rule in HTTPRoute resource.
   * https://gateway-api.sigs.k8s.io/reference/spec/#httproutetimeouts.
   *
   * @default {}
   */
  timeouts?: PyroscopeHelmValuesHttpRouteTimeouts;
};

export type PyroscopeHelmValuesHttpRouteGateway = {
  /**
   * @default ""
   */
  name?: string;
  /**
   * @default ""
   */
  namespace?: string;
  sectionName?: unknown;
};

export type PyroscopeHelmValuesHttpRouteLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PyroscopeHelmValuesHttpRouteAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PyroscopeHelmValuesHttpRouteTimeouts = object;

export type PyroscopeHelmValuesServiceMonitor = {
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
  namespaceSelector?: PyroscopeHelmValuesServiceMonitorNamespaceSelector;
  matchExpressions?: unknown[];
  /**
   * @default {}
   */
  annotations?: PyroscopeHelmValuesServiceMonitorAnnotations;
  /**
   * Additional ServiceMonitor labels
   *
   * @default {}
   */
  labels?: PyroscopeHelmValuesServiceMonitorLabels;
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
};

export type PyroscopeHelmValuesServiceMonitorNamespaceSelector = object;

export type PyroscopeHelmValuesServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PyroscopeHelmValuesServiceMonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PyroscopeHelmValues = {
  /**
   * Default values for pyroscope.
   * This is a YAML-formatted file.
   * Declare variables to be passed into your templates.
   *
   * @default {"imageRegistry":null}
   */
  global?: PyroscopeHelmValuesGlobal;
  /**
   * Grafana Agent Configuration.
   *
   * @default {...} (37 keys)
   */
  pyroscope?: PyroscopeHelmValuesPyroscope;
  /**
   * @default {...} (4 keys)
   */
  architecture?: PyroscopeHelmValuesArchitecture;
  /**
   * Configuration for `alloy` child chart
   *
   * @default {"enabled":true,"controller":{"type":"statefulset","replicas":1,"podAnnotations":{"profiles.grafana.com/memory.scrape":"true","profiles.grafana.com/memory.port_name":"http-metrics","profiles.grafana.com/cpu.scrape":"true","profiles.grafana.com/cpu.port_name":"http-metrics","profiles.grafana.com/goroutine.scrape":"true","profiles.grafana.com/goroutine.port_name":"http-metrics","profiles.grafana.com/service_repository":"https://github.com/grafana/alloy","profiles.grafana.com/service_git_ref":"v1.8.1"}},"alloy":{"stabilityLevel":"public-preview","configMap":{"create":false,"name":"alloy-config-pyroscope"},"clustering":{"enabled":true}}}
   */
  alloy?: PyroscopeHelmValuesAlloy;
  /**
   * Configuration for `grafana-agent` child chart
   *
   * @default {"enabled":false,"controller":{"type":"statefulset","replicas":1,"podAnnotations":{"profiles.grafana.com/memory.scrape":"true","profiles.grafana.com/memory.port_name":"http-metrics","profiles.grafana.com/cpu.scrape":"true","profiles.grafana.com/cpu.port_name":"http-metrics","profiles.grafana.com/goroutine.scrape":"true","profiles.grafana.com/goroutine.port_name":"http-metrics"}},"agent":{"configMap":{"create":false,"name":"grafana-agent-config-pyroscope"},"clustering":{"enabled":true}}}
   */
  agent?: PyroscopeHelmValuesAgent;
  /**
   * Configuration for `minio` child chart
   *
   * @default {...} (9 keys)
   */
  minio?: PyroscopeHelmValuesMinio;
  /**
   * @default {...} (5 keys)
   */
  ingress?: PyroscopeHelmValuesIngress;
  /**
   * @default {...} (6 keys)
   */
  httpRoute?: PyroscopeHelmValuesHttpRoute;
  /**
   * ServiceMonitor configuration
   *
   * @default {...} (12 keys)
   */
  serviceMonitor?: PyroscopeHelmValuesServiceMonitor;
  extraObjects?: unknown[];
};

export type PyroscopeHelmParameters = {
  "global.imageRegistry"?: string;
  "pyroscope.replicaCount"?: string;
  "pyroscope.disableSelfProfile"?: string;
  "pyroscope.cluster_domain"?: string;
  "pyroscope.image.registry"?: string;
  "pyroscope.image.repository"?: string;
  "pyroscope.image.pullPolicy"?: string;
  "pyroscope.image.tag"?: string;
  "pyroscope.extraArgs.log.level"?: string;
  "pyroscope.extraEnvFrom"?: string;
  "pyroscope.imagePullSecrets"?: string;
  "pyroscope.dnsPolicy"?: string;
  "pyroscope.initContainers"?: string;
  "pyroscope.extraContainers"?: string;
  "pyroscope.nameOverride"?: string;
  "pyroscope.fullnameOverride"?: string;
  "pyroscope.rbac.create"?: string;
  "pyroscope.serviceAccount.create"?: string;
  "pyroscope.serviceAccount.name"?: string;
  "pyroscope.podAnnotations.profiles.grafana.com/memory.scrape"?: string;
  "pyroscope.podAnnotations.profiles.grafana.com/memory.port_name"?: string;
  "pyroscope.podAnnotations.profiles.grafana.com/cpu.scrape"?: string;
  "pyroscope.podAnnotations.profiles.grafana.com/cpu.port_name"?: string;
  "pyroscope.podAnnotations.profiles.grafana.com/goroutine.scrape"?: string;
  "pyroscope.podAnnotations.profiles.grafana.com/goroutine.port_name"?: string;
  "pyroscope.podSecurityContext.fsGroup"?: string;
  "pyroscope.podSecurityContext.runAsUser"?: string;
  "pyroscope.podSecurityContext.runAsNonRoot"?: string;
  "pyroscope.podDisruptionBudget.enabled"?: string;
  "pyroscope.podDisruptionBudget.maxUnavailable"?: string;
  "pyroscope.service.type"?: string;
  "pyroscope.service.port"?: string;
  "pyroscope.service.port_name"?: string;
  "pyroscope.service.scheme"?: string;
  "pyroscope.memberlist.port"?: string;
  "pyroscope.memberlist.port_name"?: string;
  "pyroscope.grpc.port"?: string;
  "pyroscope.grpc.port_name"?: string;
  "pyroscope.metastore.port"?: string;
  "pyroscope.metastore.port_name"?: string;
  "pyroscope.resources"?: string;
  "pyroscope.nodeSelector"?: string;
  "pyroscope.topologySpreadConstraints"?: string;
  "pyroscope.persistence.enabled"?: string;
  "pyroscope.persistence.accessModes"?: string;
  "pyroscope.persistence.size"?: string;
  "pyroscope.persistence.metastore.subPath"?: string;
  "pyroscope.extraVolumes"?: string;
  "pyroscope.extraVolumeMounts"?: string;
  "pyroscope.tolerations"?: string;
  "pyroscope.affinity"?: string;
  "pyroscope.config"?: string;
  "architecture.storage.v1"?: string;
  "architecture.storage.v2"?: string;
  "architecture.storage.migration.ingesterWeight"?: string;
  "architecture.storage.migration.segmentWriterWeight"?: string;
  "architecture.storage.migration.queryBackendFrom"?: string;
  "architecture.deployUnifiedServices"?: string;
  "architecture.microservices.enabled"?: string;
  "architecture.microservices.clusterLabelSuffix"?: string;
  "architecture.microservices.v1.querier.kind"?: string;
  "architecture.microservices.v1.querier.replicaCount"?: string;
  "architecture.microservices.v1.querier.resources"?: string;
  "architecture.microservices.v1.querier.extraArgs.store-gateway.sharding-ring.replication-factor"?: string;
  "architecture.microservices.v1.query-frontend.kind"?: string;
  "architecture.microservices.v1.query-frontend.replicaCount"?: string;
  "architecture.microservices.v1.query-frontend.resources"?: string;
  "architecture.microservices.v1.query-scheduler.kind"?: string;
  "architecture.microservices.v1.query-scheduler.replicaCount"?: string;
  "architecture.microservices.v1.query-scheduler.resources"?: string;
  "architecture.microservices.v1.distributor.kind"?: string;
  "architecture.microservices.v1.distributor.replicaCount"?: string;
  "architecture.microservices.v1.distributor.resources"?: string;
  "architecture.microservices.v1.ingester.kind"?: string;
  "architecture.microservices.v1.ingester.replicaCount"?: string;
  "architecture.microservices.v1.ingester.terminationGracePeriodSeconds"?: string;
  "architecture.microservices.v1.ingester.resources"?: string;
  "architecture.microservices.v1.compactor.kind"?: string;
  "architecture.microservices.v1.compactor.replicaCount"?: string;
  "architecture.microservices.v1.compactor.terminationGracePeriodSeconds"?: string;
  "architecture.microservices.v1.compactor.persistence.enabled"?: string;
  "architecture.microservices.v1.compactor.resources"?: string;
  "architecture.microservices.v1.store-gateway.kind"?: string;
  "architecture.microservices.v1.store-gateway.replicaCount"?: string;
  "architecture.microservices.v1.store-gateway.persistence.enabled"?: string;
  "architecture.microservices.v1.store-gateway.resources"?: string;
  "architecture.microservices.v1.store-gateway.readinessProbe.initialDelaySeconds"?: string;
  "architecture.microservices.v1.store-gateway.extraArgs.store-gateway.sharding-ring.replication-factor"?: string;
  "architecture.microservices.v1.tenant-settings.kind"?: string;
  "architecture.microservices.v1.tenant-settings.replicaCount"?: string;
  "architecture.microservices.v1.tenant-settings.resources"?: string;
  "architecture.microservices.v1.ad-hoc-profiles.kind"?: string;
  "architecture.microservices.v1.ad-hoc-profiles.replicaCount"?: string;
  "architecture.microservices.v1.ad-hoc-profiles.resources"?: string;
  "architecture.microservices.v2.query-backend.kind"?: string;
  "architecture.microservices.v2.query-backend.replicaCount"?: string;
  "architecture.microservices.v2.query-backend.resources"?: string;
  "architecture.microservices.v2.query-frontend.kind"?: string;
  "architecture.microservices.v2.query-frontend.replicaCount"?: string;
  "architecture.microservices.v2.query-frontend.resources"?: string;
  "architecture.microservices.v2.distributor.kind"?: string;
  "architecture.microservices.v2.distributor.replicaCount"?: string;
  "architecture.microservices.v2.distributor.resources"?: string;
  "architecture.microservices.v2.segment-writer.kind"?: string;
  "architecture.microservices.v2.segment-writer.replicaCount"?: string;
  "architecture.microservices.v2.segment-writer.terminationGracePeriodSeconds"?: string;
  "architecture.microservices.v2.segment-writer.resources"?: string;
  "architecture.microservices.v2.compaction-worker.kind"?: string;
  "architecture.microservices.v2.compaction-worker.replicaCount"?: string;
  "architecture.microservices.v2.compaction-worker.terminationGracePeriodSeconds"?: string;
  "architecture.microservices.v2.compaction-worker.persistence.enabled"?: string;
  "architecture.microservices.v2.compaction-worker.resources"?: string;
  "architecture.microservices.v2.metastore.kind"?: string;
  "architecture.microservices.v2.metastore.replicaCount"?: string;
  "architecture.microservices.v2.metastore.terminationGracePeriodSeconds"?: string;
  "architecture.microservices.v2.metastore.persistence.enabled"?: string;
  "architecture.microservices.v2.metastore.resources"?: string;
  "architecture.microservices.v2.metastore.extraArgs.metastore.raft.bootstrap-expect-peers"?: string;
  "architecture.microservices.v2.metastore.extraArgs.metastore.index.cleanup-interval"?: string;
  "architecture.microservices.v2.metastore.extraArgs.metastore.snapshot-compact-on-restore"?: string;
  "architecture.microservices.v2.tenant-settings.kind"?: string;
  "architecture.microservices.v2.tenant-settings.replicaCount"?: string;
  "architecture.microservices.v2.tenant-settings.resources"?: string;
  "architecture.microservices.v2.ad-hoc-profiles.kind"?: string;
  "architecture.microservices.v2.ad-hoc-profiles.replicaCount"?: string;
  "architecture.microservices.v2.ad-hoc-profiles.resources"?: string;
  "architecture.microservices.v2.admin.kind"?: string;
  "architecture.microservices.v2.admin.replicaCount"?: string;
  "architecture.microservices.v2.admin.resources"?: string;
  "alloy.enabled"?: string;
  "alloy.controller.type"?: string;
  "alloy.controller.replicas"?: string;
  "alloy.controller.podAnnotations.profiles.grafana.com/memory.scrape"?: string;
  "alloy.controller.podAnnotations.profiles.grafana.com/memory.port_name"?: string;
  "alloy.controller.podAnnotations.profiles.grafana.com/cpu.scrape"?: string;
  "alloy.controller.podAnnotations.profiles.grafana.com/cpu.port_name"?: string;
  "alloy.controller.podAnnotations.profiles.grafana.com/goroutine.scrape"?: string;
  "alloy.controller.podAnnotations.profiles.grafana.com/goroutine.port_name"?: string;
  "alloy.controller.podAnnotations.profiles.grafana.com/service_repository"?: string;
  "alloy.controller.podAnnotations.profiles.grafana.com/service_git_ref"?: string;
  "alloy.alloy.stabilityLevel"?: string;
  "alloy.alloy.configMap.create"?: string;
  "alloy.alloy.configMap.name"?: string;
  "alloy.alloy.clustering.enabled"?: string;
  "agent.enabled"?: string;
  "agent.controller.type"?: string;
  "agent.controller.replicas"?: string;
  "agent.controller.podAnnotations.profiles.grafana.com/memory.scrape"?: string;
  "agent.controller.podAnnotations.profiles.grafana.com/memory.port_name"?: string;
  "agent.controller.podAnnotations.profiles.grafana.com/cpu.scrape"?: string;
  "agent.controller.podAnnotations.profiles.grafana.com/cpu.port_name"?: string;
  "agent.controller.podAnnotations.profiles.grafana.com/goroutine.scrape"?: string;
  "agent.controller.podAnnotations.profiles.grafana.com/goroutine.port_name"?: string;
  "agent.agent.configMap.create"?: string;
  "agent.agent.configMap.name"?: string;
  "agent.agent.clustering.enabled"?: string;
  "minio.enabled"?: string;
  "minio.replicas"?: string;
  "minio.drivesPerNode"?: string;
  "minio.rootUser"?: string;
  "minio.rootPassword"?: string;
  "minio.buckets.name"?: string;
  "minio.buckets.policy"?: string;
  "minio.buckets.purge"?: string;
  "minio.persistence.size"?: string;
  "minio.resources"?: string;
  "ingress.enabled"?: string;
  "ingress.className"?: string;
  "ingress.pathType"?: string;
  "httpRoute.enabled"?: string;
  "httpRoute.gateway.name"?: string;
  "httpRoute.gateway.namespace"?: string;
  "httpRoute.gateway.sectionName"?: string;
  "httpRoute.hostnames"?: string;
  "serviceMonitor.enabled"?: string;
  "serviceMonitor.matchExpressions"?: string;
  "serviceMonitor.interval"?: string;
  "serviceMonitor.scrapeTimeout"?: string;
  "serviceMonitor.relabelings"?: string;
  "serviceMonitor.metricRelabelings"?: string;
  "serviceMonitor.targetLabels"?: string;
  "serviceMonitor.scheme"?: string;
  "serviceMonitor.tlsConfig"?: string;
  extraObjects?: string;
};
