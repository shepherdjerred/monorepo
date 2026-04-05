// Generated TypeScript types for redis Helm chart

export type RedisHelmValuesGlobal = {
  /**
   * Global Docker image registry
   *
   * @default ""
   */
  imageRegistry?: string;
  imagePullSecrets?: unknown[];
  /**
   * Global default StorageClass for Persistent Volume(s)
   *
   * @default ""
   */
  defaultStorageClass?: string;
  /**
   * DEPRECATED: use global.defaultStorageClass instead
   *
   * @default ""
   */
  storageClass?: string;
  /**
   * Security parameters
   *
   * @default {"allowInsecureImages":false}
   */
  security?: RedisHelmValuesGlobalSecurity;
  /**
   * @default {"password":""}
   */
  redis?: RedisHelmValuesGlobalRedis;
  /**
   * Compatibility adaptations for Kubernetes platforms
   *
   * @default {"openshift":{"adaptSecurityContext":"auto"}}
   */
  compatibility?: RedisHelmValuesGlobalCompatibility;
  /**
   * Configure FIPS mode: '', 'restricted', 'relaxed', 'off'
   *
   * @default "restricted"
   */
  defaultFips?: string;
};

export type RedisHelmValuesGlobalSecurity = {
  /**
   * Allows skipping image verification
   *
   * @default false
   */
  allowInsecureImages?: boolean;
};

export type RedisHelmValuesGlobalRedis = {
  /**
   * Global Redis(R) password (overrides `auth.password`)
   *
   * @default ""
   */
  password?: string;
};

export type RedisHelmValuesGlobalCompatibility = {
  /**
   * Compatibility adaptations for Openshift
   *
   * @default {"adaptSecurityContext":"auto"}
   */
  openshift?: RedisHelmValuesGlobalCompatibilityOpenshift;
};

export type RedisHelmValuesGlobalCompatibilityOpenshift = {
  /**
   * Adapt the securityContext sections of the deployment to make them compatible with Openshift restricted-v2 SCC: remove runAsUser, runAsGroup and fsGroup and let the platform use their allowed default IDs. Possible values: auto (apply if the detected running cluster is Openshift), force (perform the adaptation always), disabled (do not perform adaptation)
   *
   * @default "auto"
   */
  adaptSecurityContext?: string;
};

export type RedisHelmValuesCommonLabels = object;

export type RedisHelmValuesCommonAnnotations = object;

export type RedisHelmValuesSecretAnnotations = object;

export type RedisHelmValuesDiagnosticMode = {
  /**
   * Enable diagnostic mode (all probes will be disabled and the command will be overridden)
   *
   * @default false
   */
  enabled?: boolean;
  command?: string[];
  args?: string[];
};

export type RedisHelmValuesImage = {
  /**
   * [default: REGISTRY_NAME] Redis(R) image registry
   *
   * @default "registry-1.docker.io"
   */
  registry?: string;
  /**
   * [default: REPOSITORY_NAME/redis] Redis(R) image repository
   *
   * @default "bitnami/redis"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * Redis(R) image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * @default ""
   */
  digest?: string;
  /**
   * Specify a imagePullPolicy
   * ref: https://kubernetes.io/docs/concepts/containers/images/#pre-pulled-images
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  pullSecrets?: unknown[];
  /**
   * Enable debug mode
   *
   * @default false
   */
  debug?: boolean;
};

export type RedisHelmValuesAuth = {
  /**
   * Enable password authentication
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Enable authentication on sentinels too
   *
   * @default true
   */
  sentinel?: boolean;
  /**
   * Defaults to a random 10-character alphanumeric string if not set
   *
   * @default ""
   */
  password?: string;
  /**
   * NOTE: When it's set, the previous `auth.password` parameter is ignored
   *
   * @default ""
   */
  existingSecret?: string;
  /**
   * NOTE: ignored unless `auth.existingSecret` parameter is set
   *
   * @default ""
   */
  existingSecretPasswordKey?: string;
  /**
   * Mount credentials as files instead of using an environment variable
   *
   * @default true
   */
  usePasswordFiles?: boolean;
  /**
   * Mount password file from secret
   *
   * @default true
   */
  usePasswordFileFromSecret?: boolean;
  /**
   * Redis ACL restricts connections by limiting commands and key access with auth management.
   * ref: https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/
   *
   * @default {...} (4 keys)
   */
  acl?: RedisHelmValuesAuthAcl;
};

export type RedisHelmValuesAuthAcl = {
  /**
   * Enables the support of the Redis ACL system
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Enables the support of the Redis ACL system for Sentinel Nodes
   *
   * @default false
   */
  sentinel?: boolean;
  users?: unknown[];
  /**
   * Name of the Secret, containing user credentials for ACL users. Keys must match usernames.
   *
   * @default ""
   */
  userSecret?: string;
};

export type RedisHelmValuesMaster = {
  /**
   * Number of Redis(R) master instances to deploy (experimental, requires additional configuration)
   *
   * @default 1
   */
  count?: number;
  /**
   * NOTE: Explicitly setting this field to 0, will result in cleaning up all the history, breaking ability to rollback
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * ref: https://redis.io/topics/config
   *
   * @default ""
   */
  configuration?: string;
  disableCommands?: string[];
  command?: unknown[];
  args?: unknown[];
  /**
   * Whether information about services should be injected into pod's environment variable
   *
   * @default true
   */
  enableServiceLinks?: boolean;
  preExecCmds?: unknown[];
  extraFlags?: unknown[];
  extraEnvVars?: unknown[];
  /**
   * Name of existing ConfigMap containing extra env vars for Redis(R) master nodes
   *
   * @default ""
   */
  extraEnvVarsCM?: string;
  /**
   * Name of existing Secret containing extra env vars for Redis(R) master nodes
   *
   * @default ""
   */
  extraEnvVarsSecret?: string;
  /**
   * @default {"redis":6379}
   */
  containerPorts?: RedisHelmValuesMasterContainerPorts;
  /**
   * Configure extra options for Redis(R) containers' liveness and readiness probes
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/#configure-probes
   *
   * @default {...} (6 keys)
   */
  startupProbe?: RedisHelmValuesMasterStartupProbe;
  /**
   * @default {...} (6 keys)
   */
  livenessProbe?: RedisHelmValuesMasterLivenessProbe;
  /**
   * @default {...} (6 keys)
   */
  readinessProbe?: RedisHelmValuesMasterReadinessProbe;
  /**
   * Custom startupProbe that overrides the default one
   *
   * @default {}
   */
  customStartupProbe?: RedisHelmValuesMasterCustomStartupProbe;
  /**
   * Custom livenessProbe that overrides the default one
   *
   * @default {}
   */
  customLivenessProbe?: RedisHelmValuesMasterCustomLivenessProbe;
  /**
   * Custom readinessProbe that overrides the default one
   *
   * @default {}
   */
  customReadinessProbe?: RedisHelmValuesMasterCustomReadinessProbe;
  /**
   * Redis(R) master resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * @default "nano"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * @default {}
   */
  resources?: RedisHelmValuesMasterResources;
  /**
   * @default {"openssl":""}
   */
  fips?: RedisHelmValuesMasterFips;
  /**
   * Configure Pods Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: RedisHelmValuesMasterPodSecurityContext;
  /**
   * Configure Container Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod
   *
   * @default {...} (9 keys)
   */
  containerSecurityContext?: RedisHelmValuesMasterContainerSecurityContext;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/
   *
   * @default "StatefulSet"
   */
  kind?: string;
  /**
   * ref: https://kubernetes.io/docs/tasks/administer-cluster/configure-multiple-schedulers/
   *
   * @default ""
   */
  schedulerName?: string;
  /**
   * Name of the runtime class to be used by master pod(s)
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#update-strategies
   *
   * @default {"type":"RollingUpdate"}
   */
  updateStrategy?: RedisHelmValuesMasterUpdateStrategy;
  /**
   * How many seconds a pod needs to be ready before killing the next, during update
   *
   * @default 0
   */
  minReadySeconds?: number;
  /**
   * Redis(R) master pods' priorityClassName
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Mount Service Account token in pod
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  hostAliases?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * @default {}
   */
  podLabels?: RedisHelmValuesMasterPodLabels;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
   *
   * @default {}
   */
  podAnnotations?: RedisHelmValuesMasterPodAnnotations;
  /**
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/share-process-namespace/
   *
   * @default false
   */
  shareProcessNamespace?: boolean;
  /**
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity
   *
   * @default ""
   */
  podAffinityPreset?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity
   *
   * @default "soft"
   */
  podAntiAffinityPreset?: string;
  /**
   * Node master.affinity preset
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#node-affinity
   *
   * @default {"type":"","key":"","values":[]}
   */
  nodeAffinityPreset?: RedisHelmValuesMasterNodeAffinityPreset;
  /**
   * ref: https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#affinity-and-anti-affinity
   * NOTE: `master.podAffinityPreset`, `master.podAntiAffinityPreset`, and `master.nodeAffinityPreset` will be ignored when it's set
   *
   * @default {}
   */
  affinity?: RedisHelmValuesMasterAffinity;
  /**
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
   *
   * @default {}
   */
  nodeSelector?: RedisHelmValuesMasterNodeSelector;
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/
   * E.g.
   *
   * @default ""
   */
  dnsPolicy?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/
   * E.g.
   *
   * @default {}
   */
  dnsConfig?: RedisHelmValuesMasterDnsConfig;
  /**
   * for the Redis(R) master container(s) to automate configuration before or after startup
   *
   * @default {}
   */
  lifecycleHooks?: RedisHelmValuesMasterLifecycleHooks;
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  sidecars?: unknown[];
  initContainers?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/concepts/storage/persistent-volumes/
   *
   * @default {...} (14 keys)
   */
  persistence?: RedisHelmValuesMasterPersistence;
  /**
   * persistentVolumeClaimRetentionPolicy
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#persistentvolumeclaim-retention
   *
   * @default {"enabled":false,"whenScaled":"Retain","whenDeleted":"Retain"}
   */
  persistentVolumeClaimRetentionPolicy?: RedisHelmValuesMasterPersistentVolumeClaimRetentionPolicy;
  /**
   * Redis(R) master service parameters
   *
   * @default {...} (15 keys)
   */
  service?: RedisHelmValuesMasterService;
  /**
   * Integer setting the termination grace period for the redis-master pods
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * ServiceAccount configuration
   *
   * @default {...} (4 keys)
   */
  serviceAccount?: RedisHelmValuesMasterServiceAccount;
  /**
   * ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb
   *
   * @default {"create":true,"minAvailable":"","maxUnavailable":""}
   */
  pdb?: RedisHelmValuesMasterPdb;
  /**
   * Optionally specify extra PodSpec for the Redis(R) master pod(s)
   *
   * @default {}
   */
  extraPodSpec?: RedisHelmValuesMasterExtraPodSpec;
  /**
   * Additional custom annotations for Redis(R) Master resource
   *
   * @default {}
   */
  annotations?: RedisHelmValuesMasterAnnotations;
};

export type RedisHelmValuesMasterContainerPorts = {
  /**
   * Container port to open on Redis(R) master nodes
   *
   * @default 6379
   */
  redis?: number;
};

export type RedisHelmValuesMasterStartupProbe = {
  /**
   * Enable startupProbe on Redis(R) master nodes
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for startupProbe
   *
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for startupProbe
   *
   * @default 5
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for startupProbe
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for startupProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for startupProbe
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type RedisHelmValuesMasterLivenessProbe = {
  /**
   * Enable livenessProbe on Redis(R) master nodes
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for livenessProbe
   *
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for livenessProbe
   *
   * @default 5
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for livenessProbe
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for livenessProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for livenessProbe
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type RedisHelmValuesMasterReadinessProbe = {
  /**
   * Enable readinessProbe on Redis(R) master nodes
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for readinessProbe
   *
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for readinessProbe
   *
   * @default 5
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for readinessProbe
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for readinessProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for readinessProbe
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type RedisHelmValuesMasterCustomStartupProbe = object;

export type RedisHelmValuesMasterCustomLivenessProbe = object;

export type RedisHelmValuesMasterCustomReadinessProbe = object;

export type RedisHelmValuesMasterResources = object;

export type RedisHelmValuesMasterFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
};

export type RedisHelmValuesMasterPodSecurityContext = {
  /**
   * Enabled Redis(R) master pods' Security Context
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Set filesystem group change policy
   *
   * @default "Always"
   */
  fsGroupChangePolicy?: string;
  sysctls?: unknown[];
  supplementalGroups?: unknown[];
  /**
   * Set Redis(R) master pod's Security Context fsGroup
   *
   * @default 1001
   */
  fsGroup?: number;
};

export type RedisHelmValuesMasterContainerSecurityContext = {
  /**
   * Enabled Redis(R) master containers' Security Context
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * [object,nullable] Set SELinux options in container
   *
   * @default {}
   */
  seLinuxOptions?: RedisHelmValuesMasterContainerSecurityContextSeLinuxOptions;
  /**
   * Set Redis(R) master containers' Security Context runAsUser
   *
   * @default 1001
   */
  runAsUser?: number;
  /**
   * Set Redis(R) master containers' Security Context runAsGroup
   *
   * @default 1001
   */
  runAsGroup?: number;
  /**
   * Set Redis(R) master containers' Security Context runAsNonRoot
   *
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * Is it possible to escalate Redis(R) pod(s) privileges
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * Set container's Security Context read-only root filesystem
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: RedisHelmValuesMasterContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: RedisHelmValuesMasterContainerSecurityContextCapabilities;
};

export type RedisHelmValuesMasterContainerSecurityContextSeLinuxOptions =
  object;

export type RedisHelmValuesMasterContainerSecurityContextSeccompProfile = {
  /**
   * Set Redis(R) master containers' Security Context seccompProfile
   *
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type RedisHelmValuesMasterContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type RedisHelmValuesMasterUpdateStrategy = {
  /**
   * StrategyType
   * Can be set to RollingUpdate, OnDelete (statefulset), Recreate (deployment)
   *
   * @default "RollingUpdate"
   */
  type?: string;
};

export type RedisHelmValuesMasterPodLabels = object;

export type RedisHelmValuesMasterPodAnnotations = object;

export type RedisHelmValuesMasterNodeAffinityPreset = {
  /**
   * Node affinity preset type. Ignored if `master.affinity` is set. Allowed values: `soft` or `hard`
   *
   * @default ""
   */
  type?: string;
  /**
   * Node label key to match. Ignored if `master.affinity` is set
   *
   * @default ""
   */
  key?: string;
  values?: unknown[];
};

export type RedisHelmValuesMasterAffinity = object;

export type RedisHelmValuesMasterNodeSelector = object;

export type RedisHelmValuesMasterDnsConfig = object;

export type RedisHelmValuesMasterLifecycleHooks = object;

export type RedisHelmValuesMasterPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable persistence on Redis(R) master nodes using Persistent Volume Claims
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Provide a medium for `emptyDir` volumes.
   *
   * @default ""
   */
  medium?: string;
  /**
   * Set this to enable a size limit for `emptyDir` volumes.
   *
   * @default ""
   */
  sizeLimit?: string;
  /**
   * NOTE: Useful when using different Redis(R) images
   *
   * @default "/data"
   */
  path?: string;
  /**
   * NOTE: Useful in dev environments
   *
   * @default ""
   */
  subPath?: string;
  /**
   * Used to construct the subPath subdirectory of the volume to mount on Redis(R) master containers
   *
   * @default ""
   */
  subPathExpr?: string;
  /**
   * If defined, storageClassName: <storageClass>
   * If set to "-", storageClassName: "", which disables dynamic provisioning
   * If undefined (the default) or set to null, no storageClassName spec is set, choosing the default provisioner
   *
   * @default ""
   */
  storageClass?: string;
  accessModes?: string[];
  /**
   * Persistent Volume size
   *
   * @default "8Gi"
   */
  size?: string;
  /**
   * Additional custom annotations for the PVC
   *
   * @default {}
   */
  annotations?: RedisHelmValuesMasterPersistenceAnnotations;
  /**
   * Additional custom labels for the PVC
   *
   * @default {}
   */
  labels?: RedisHelmValuesMasterPersistenceLabels;
  /**
   * Additional labels to match for the PVC
   *
   * @default {}
   */
  selector?: RedisHelmValuesMasterPersistenceSelector;
  /**
   * Custom PVC data source
   *
   * @default {}
   */
  dataSource?: RedisHelmValuesMasterPersistenceDataSource;
  /**
   * NOTE: requires master.persistence.enabled: true
   *
   * @default ""
   */
  existingClaim?: string;
};

export type RedisHelmValuesMasterPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesMasterPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesMasterPersistenceSelector = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesMasterPersistenceDataSource = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesMasterPersistentVolumeClaimRetentionPolicy = {
  /**
   * Controls if and how PVCs are deleted during the lifecycle of a StatefulSet
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Volume retention behavior when the replica count of the StatefulSet is reduced
   *
   * @default "Retain"
   */
  whenScaled?: string;
  /**
   * Volume retention behavior that applies when the StatefulSet is deleted
   *
   * @default "Retain"
   */
  whenDeleted?: string;
};

export type RedisHelmValuesMasterService = {
  /**
   * Redis(R) master service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {"redis":"tcp-redis"}
   */
  portNames?: RedisHelmValuesMasterServicePortNames;
  /**
   * @default {"redis":6379}
   */
  ports?: RedisHelmValuesMasterServicePorts;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport
   * NOTE: choose port between <30000-32767>
   *
   * @default {"redis":""}
   */
  nodePorts?: RedisHelmValuesMasterServiceNodePorts;
  /**
   * ref: https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/#preserving-the-client-source-ip
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  extraPorts?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service-traffic-policy/
   *
   * @default "Cluster"
   */
  internalTrafficPolicy?: string;
  /**
   * Redis(R) master service Cluster IP
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#internal-load-balancer
   *
   * @default ""
   */
  loadBalancerIP?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-loadbalancer
   *
   * @default ""
   */
  loadBalancerClass?: string;
  loadBalancerSourceRanges?: unknown[];
  externalIPs?: unknown[];
  /**
   * Additional custom annotations for Redis(R) master service
   *
   * @default {}
   */
  annotations?: RedisHelmValuesMasterServiceAnnotations;
  /**
   * If "ClientIP", consecutive client requests will be directed to the same Pod
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#virtual-ips-and-service-proxies
   *
   * @default "None"
   */
  sessionAffinity?: string;
  /**
   * Additional settings for the sessionAffinity. Ignored if `master.service.sessionAffinity` is `None`
   *
   * @default {}
   */
  sessionAffinityConfig?: RedisHelmValuesMasterServiceSessionAffinityConfig;
};

export type RedisHelmValuesMasterServicePortNames = {
  /**
   * Redis(R) master service port name
   *
   * @default "tcp-redis"
   */
  redis?: string;
};

export type RedisHelmValuesMasterServicePorts = {
  /**
   * Redis(R) master service port
   *
   * @default 6379
   */
  redis?: number;
};

export type RedisHelmValuesMasterServiceNodePorts = {
  /**
   * Node port for Redis(R) master
   *
   * @default ""
   */
  redis?: string;
};

export type RedisHelmValuesMasterServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesMasterServiceSessionAffinityConfig = object;

export type RedisHelmValuesMasterServiceAccount = {
  /**
   * Specifies whether a ServiceAccount should be created
   *
   * @default true
   */
  create?: boolean;
  /**
   * If not set and create is true, a name is generated using the common.names.fullname template
   *
   * @default ""
   */
  name?: string;
  /**
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#use-the-default-service-account-to-access-the-api-server
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  /**
   * Additional custom annotations for the ServiceAccount
   *
   * @default {}
   */
  annotations?: RedisHelmValuesMasterServiceAccountAnnotations;
};

export type RedisHelmValuesMasterServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesMasterPdb = {
  /**
   * Enable/disable a Pod Disruption Budget creation
   *
   * @default true
   */
  create?: boolean;
  /**
   * [object] Minimum number/percentage of pods that should remain scheduled
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * [object] Maximum number/percentage of pods that may be made unavailable. Defaults to `1` if both `master.pdb.minAvailable` and `master.pdb.maxUnavailable` are empty.
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type RedisHelmValuesMasterExtraPodSpec = object;

export type RedisHelmValuesMasterAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesReplica = {
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/
   *
   * @default "StatefulSet"
   */
  kind?: string;
  /**
   * Number of Redis(R) replicas to deploy
   *
   * @default 3
   */
  replicaCount?: number;
  /**
   * NOTE: Explicitly setting this field to 0, will result in cleaning up all the history, breaking ability to rollback
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * ref: https://redis.io/topics/config
   *
   * @default ""
   */
  configuration?: string;
  disableCommands?: string[];
  command?: unknown[];
  args?: unknown[];
  /**
   * Whether information about services should be injected into pod's environment variable
   *
   * @default true
   */
  enableServiceLinks?: boolean;
  preExecCmds?: unknown[];
  extraFlags?: unknown[];
  extraEnvVars?: unknown[];
  /**
   * Name of existing ConfigMap containing extra env vars for Redis(R) replicas nodes
   *
   * @default ""
   */
  extraEnvVarsCM?: string;
  /**
   * Name of existing Secret containing extra env vars for Redis(R) replicas nodes
   *
   * @default ""
   */
  extraEnvVarsSecret?: string;
  /**
   * @default {"enabled":false,"host":"","port":6379}
   */
  externalMaster?: RedisHelmValuesReplicaExternalMaster;
  /**
   * @default {"redis":6379}
   */
  containerPorts?: RedisHelmValuesReplicaContainerPorts;
  /**
   * Configure extra options for Redis(R) containers' liveness and readiness probes
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/#configure-probes
   *
   * @default {...} (6 keys)
   */
  startupProbe?: RedisHelmValuesReplicaStartupProbe;
  /**
   * @default {...} (6 keys)
   */
  livenessProbe?: RedisHelmValuesReplicaLivenessProbe;
  /**
   * @default {...} (6 keys)
   */
  readinessProbe?: RedisHelmValuesReplicaReadinessProbe;
  /**
   * Custom startupProbe that overrides the default one
   *
   * @default {}
   */
  customStartupProbe?: RedisHelmValuesReplicaCustomStartupProbe;
  /**
   * Custom livenessProbe that overrides the default one
   *
   * @default {}
   */
  customLivenessProbe?: RedisHelmValuesReplicaCustomLivenessProbe;
  /**
   * Custom readinessProbe that overrides the default one
   *
   * @default {}
   */
  customReadinessProbe?: RedisHelmValuesReplicaCustomReadinessProbe;
  /**
   * Redis(R) replicas resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * @default "nano"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * @default {}
   */
  resources?: RedisHelmValuesReplicaResources;
  /**
   * @default {"openssl":""}
   */
  fips?: RedisHelmValuesReplicaFips;
  /**
   * Configure Pods Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: RedisHelmValuesReplicaPodSecurityContext;
  /**
   * Configure Container Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod
   *
   * @default {...} (9 keys)
   */
  containerSecurityContext?: RedisHelmValuesReplicaContainerSecurityContext;
  /**
   * ref: https://kubernetes.io/docs/tasks/administer-cluster/configure-multiple-schedulers/
   *
   * @default ""
   */
  schedulerName?: string;
  /**
   * Name of the runtime class to be used by replica pod(s)
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#update-strategies
   *
   * @default {"type":"RollingUpdate"}
   */
  updateStrategy?: RedisHelmValuesReplicaUpdateStrategy;
  /**
   * How many seconds a pod needs to be ready before killing the next, during update
   *
   * @default 0
   */
  minReadySeconds?: number;
  /**
   * Redis(R) replicas pods' priorityClassName
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#pod-management-policies
   *
   * @default ""
   */
  podManagementPolicy?: string;
  /**
   * Mount Service Account token in pod
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  hostAliases?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * @default {}
   */
  podLabels?: RedisHelmValuesReplicaPodLabels;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
   *
   * @default {}
   */
  podAnnotations?: RedisHelmValuesReplicaPodAnnotations;
  /**
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/share-process-namespace/
   *
   * @default false
   */
  shareProcessNamespace?: boolean;
  /**
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity
   *
   * @default ""
   */
  podAffinityPreset?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity
   *
   * @default "soft"
   */
  podAntiAffinityPreset?: string;
  /**
   * Node affinity preset
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#node-affinity
   *
   * @default {"type":"","key":"","values":[]}
   */
  nodeAffinityPreset?: RedisHelmValuesReplicaNodeAffinityPreset;
  /**
   * ref: https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#affinity-and-anti-affinity
   * NOTE: `replica.podAffinityPreset`, `replica.podAntiAffinityPreset`, and `replica.nodeAffinityPreset` will be ignored when it's set
   *
   * @default {}
   */
  affinity?: RedisHelmValuesReplicaAffinity;
  /**
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
   *
   * @default {}
   */
  nodeSelector?: RedisHelmValuesReplicaNodeSelector;
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/
   * E.g.
   *
   * @default ""
   */
  dnsPolicy?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/
   * E.g.
   *
   * @default {}
   */
  dnsConfig?: RedisHelmValuesReplicaDnsConfig;
  /**
   * for the Redis(R) replica container(s) to automate configuration before or after startup
   *
   * @default {}
   */
  lifecycleHooks?: RedisHelmValuesReplicaLifecycleHooks;
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  sidecars?: unknown[];
  initContainers?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/concepts/storage/persistent-volumes/
   *
   * @default {...} (14 keys)
   */
  persistence?: RedisHelmValuesReplicaPersistence;
  /**
   * persistentVolumeClaimRetentionPolicy
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#persistentvolumeclaim-retention
   *
   * @default {"enabled":false,"whenScaled":"Retain","whenDeleted":"Retain"}
   */
  persistentVolumeClaimRetentionPolicy?: RedisHelmValuesReplicaPersistentVolumeClaimRetentionPolicy;
  /**
   * Redis(R) replicas service parameters
   *
   * @default {...} (13 keys)
   */
  service?: RedisHelmValuesReplicaService;
  /**
   * Integer setting the termination grace period for the redis-replicas pods
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Autoscaling configuration
   *
   * @default {...} (5 keys)
   */
  autoscaling?: RedisHelmValuesReplicaAutoscaling;
  /**
   * ServiceAccount configuration
   *
   * @default {...} (4 keys)
   */
  serviceAccount?: RedisHelmValuesReplicaServiceAccount;
  /**
   * ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb
   *
   * @default {"create":true,"minAvailable":"","maxUnavailable":""}
   */
  pdb?: RedisHelmValuesReplicaPdb;
  /**
   * Optionally specify extra PodSpec for the Redis(R) replicas pod(s)
   *
   * @default {}
   */
  extraPodSpec?: RedisHelmValuesReplicaExtraPodSpec;
  /**
   * Additional custom annotations for Redis(R) replicas resource
   *
   * @default {}
   */
  annotations?: RedisHelmValuesReplicaAnnotations;
};

export type RedisHelmValuesReplicaExternalMaster = {
  /**
   * Use external master for bootstrapping
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * External master host to bootstrap from
   *
   * @default ""
   */
  host?: string;
  /**
   * Port for Redis service external master host
   *
   * @default 6379
   */
  port?: number;
};

export type RedisHelmValuesReplicaContainerPorts = {
  /**
   * Container port to open on Redis(R) replicas nodes
   *
   * @default 6379
   */
  redis?: number;
};

export type RedisHelmValuesReplicaStartupProbe = {
  /**
   * Enable startupProbe on Redis(R) replicas nodes
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for startupProbe
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for startupProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for startupProbe
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for startupProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for startupProbe
   *
   * @default 22
   */
  failureThreshold?: number;
};

export type RedisHelmValuesReplicaLivenessProbe = {
  /**
   * Enable livenessProbe on Redis(R) replicas nodes
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for livenessProbe
   *
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for livenessProbe
   *
   * @default 5
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for livenessProbe
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for livenessProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for livenessProbe
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type RedisHelmValuesReplicaReadinessProbe = {
  /**
   * Enable readinessProbe on Redis(R) replicas nodes
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for readinessProbe
   *
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for readinessProbe
   *
   * @default 5
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for readinessProbe
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for readinessProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for readinessProbe
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type RedisHelmValuesReplicaCustomStartupProbe = object;

export type RedisHelmValuesReplicaCustomLivenessProbe = object;

export type RedisHelmValuesReplicaCustomReadinessProbe = object;

export type RedisHelmValuesReplicaResources = object;

export type RedisHelmValuesReplicaFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
};

export type RedisHelmValuesReplicaPodSecurityContext = {
  /**
   * Enabled Redis(R) replicas pods' Security Context
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Set filesystem group change policy
   *
   * @default "Always"
   */
  fsGroupChangePolicy?: string;
  sysctls?: unknown[];
  supplementalGroups?: unknown[];
  /**
   * Set Redis(R) replicas pod's Security Context fsGroup
   *
   * @default 1001
   */
  fsGroup?: number;
};

export type RedisHelmValuesReplicaContainerSecurityContext = {
  /**
   * Enabled Redis(R) replicas containers' Security Context
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * [object,nullable] Set SELinux options in container
   *
   * @default {}
   */
  seLinuxOptions?: RedisHelmValuesReplicaContainerSecurityContextSeLinuxOptions;
  /**
   * Set Redis(R) replicas containers' Security Context runAsUser
   *
   * @default 1001
   */
  runAsUser?: number;
  /**
   * Set Redis(R) replicas containers' Security Context runAsGroup
   *
   * @default 1001
   */
  runAsGroup?: number;
  /**
   * Set Redis(R) replicas containers' Security Context runAsNonRoot
   *
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * Set Redis(R) replicas pod's Security Context allowPrivilegeEscalation
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * Set container's Security Context read-only root filesystem
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: RedisHelmValuesReplicaContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: RedisHelmValuesReplicaContainerSecurityContextCapabilities;
};

export type RedisHelmValuesReplicaContainerSecurityContextSeLinuxOptions =
  object;

export type RedisHelmValuesReplicaContainerSecurityContextSeccompProfile = {
  /**
   * Set Redis(R) replicas containers' Security Context seccompProfile
   *
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type RedisHelmValuesReplicaContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type RedisHelmValuesReplicaUpdateStrategy = {
  /**
   * StrategyType
   * Can be set to RollingUpdate, OnDelete (statefulset), Recreate (deployment)
   *
   * @default "RollingUpdate"
   */
  type?: string;
};

export type RedisHelmValuesReplicaPodLabels = object;

export type RedisHelmValuesReplicaPodAnnotations = object;

export type RedisHelmValuesReplicaNodeAffinityPreset = {
  /**
   * Node affinity preset type. Ignored if `replica.affinity` is set. Allowed values: `soft` or `hard`
   *
   * @default ""
   */
  type?: string;
  /**
   * Node label key to match. Ignored if `replica.affinity` is set
   *
   * @default ""
   */
  key?: string;
  values?: unknown[];
};

export type RedisHelmValuesReplicaAffinity = object;

export type RedisHelmValuesReplicaNodeSelector = object;

export type RedisHelmValuesReplicaDnsConfig = object;

export type RedisHelmValuesReplicaLifecycleHooks = object;

export type RedisHelmValuesReplicaPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable persistence on Redis(R) replicas nodes using Persistent Volume Claims
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Provide a medium for `emptyDir` volumes.
   *
   * @default ""
   */
  medium?: string;
  /**
   * Set this to enable a size limit for `emptyDir` volumes.
   *
   * @default ""
   */
  sizeLimit?: string;
  /**
   * NOTE: Useful when using different Redis(R) images
   *
   * @default "/data"
   */
  path?: string;
  /**
   * NOTE: Useful in dev environments
   *
   * @default ""
   */
  subPath?: string;
  /**
   * Used to construct the subPath subdirectory of the volume to mount on Redis(R) replicas containers
   *
   * @default ""
   */
  subPathExpr?: string;
  /**
   * If defined, storageClassName: <storageClass>
   * If set to "-", storageClassName: "", which disables dynamic provisioning
   * If undefined (the default) or set to null, no storageClassName spec is set, choosing the default provisioner
   *
   * @default ""
   */
  storageClass?: string;
  accessModes?: string[];
  /**
   * Persistent Volume size
   *
   * @default "8Gi"
   */
  size?: string;
  /**
   * Additional custom annotations for the PVC
   *
   * @default {}
   */
  annotations?: RedisHelmValuesReplicaPersistenceAnnotations;
  /**
   * Additional custom labels for the PVC
   *
   * @default {}
   */
  labels?: RedisHelmValuesReplicaPersistenceLabels;
  /**
   * Additional labels to match for the PVC
   *
   * @default {}
   */
  selector?: RedisHelmValuesReplicaPersistenceSelector;
  /**
   * Custom PVC data source
   *
   * @default {}
   */
  dataSource?: RedisHelmValuesReplicaPersistenceDataSource;
  /**
   * NOTE: requires replica.persistence.enabled: true
   *
   * @default ""
   */
  existingClaim?: string;
};

export type RedisHelmValuesReplicaPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesReplicaPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesReplicaPersistenceSelector = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesReplicaPersistenceDataSource = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesReplicaPersistentVolumeClaimRetentionPolicy = {
  /**
   * Controls if and how PVCs are deleted during the lifecycle of a StatefulSet
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Volume retention behavior when the replica count of the StatefulSet is reduced
   *
   * @default "Retain"
   */
  whenScaled?: string;
  /**
   * Volume retention behavior that applies when the StatefulSet is deleted
   *
   * @default "Retain"
   */
  whenDeleted?: string;
};

export type RedisHelmValuesReplicaService = {
  /**
   * Redis(R) replicas service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {"redis":6379}
   */
  ports?: RedisHelmValuesReplicaServicePorts;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport
   * NOTE: choose port between <30000-32767>
   *
   * @default {"redis":""}
   */
  nodePorts?: RedisHelmValuesReplicaServiceNodePorts;
  /**
   * ref: https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/#preserving-the-client-source-ip
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service-traffic-policy/
   *
   * @default "Cluster"
   */
  internalTrafficPolicy?: string;
  extraPorts?: unknown[];
  /**
   * Redis(R) replicas service Cluster IP
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#internal-load-balancer
   *
   * @default ""
   */
  loadBalancerIP?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-loadbalancer
   *
   * @default ""
   */
  loadBalancerClass?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Additional custom annotations for Redis(R) replicas service
   *
   * @default {}
   */
  annotations?: RedisHelmValuesReplicaServiceAnnotations;
  /**
   * If "ClientIP", consecutive client requests will be directed to the same Pod
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#virtual-ips-and-service-proxies
   *
   * @default "None"
   */
  sessionAffinity?: string;
  /**
   * Additional settings for the sessionAffinity. Ignored if `replica.service.sessionAffinity` is `None`
   *
   * @default {}
   */
  sessionAffinityConfig?: RedisHelmValuesReplicaServiceSessionAffinityConfig;
};

export type RedisHelmValuesReplicaServicePorts = {
  /**
   * Redis(R) replicas service port
   *
   * @default 6379
   */
  redis?: number;
};

export type RedisHelmValuesReplicaServiceNodePorts = {
  /**
   * Node port for Redis(R) replicas
   *
   * @default ""
   */
  redis?: string;
};

export type RedisHelmValuesReplicaServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesReplicaServiceSessionAffinityConfig = object;

export type RedisHelmValuesReplicaAutoscaling = {
  /**
   * Enable replica autoscaling settings
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum replicas for the pod autoscaling
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum replicas for the pod autoscaling
   *
   * @default 11
   */
  maxReplicas?: number;
  /**
   * Percentage of CPU to consider when autoscaling
   *
   * @default ""
   */
  targetCPU?: string;
  /**
   * Percentage of Memory to consider when autoscaling
   *
   * @default ""
   */
  targetMemory?: string;
};

export type RedisHelmValuesReplicaServiceAccount = {
  /**
   * Specifies whether a ServiceAccount should be created
   *
   * @default true
   */
  create?: boolean;
  /**
   * If not set and create is true, a name is generated using the common.names.fullname template
   *
   * @default ""
   */
  name?: string;
  /**
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#use-the-default-service-account-to-access-the-api-server
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  /**
   * Additional custom annotations for the ServiceAccount
   *
   * @default {}
   */
  annotations?: RedisHelmValuesReplicaServiceAccountAnnotations;
};

export type RedisHelmValuesReplicaServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesReplicaPdb = {
  /**
   * Enable/disable a Pod Disruption Budget creation
   *
   * @default true
   */
  create?: boolean;
  /**
   * [object] Minimum number/percentage of pods that should remain scheduled
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * [object] Maximum number/percentage of pods that may be made unavailable. Defaults to `1` if both `replica.pdb.minAvailable` and `replica.pdb.maxUnavailable` are empty.
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type RedisHelmValuesReplicaExtraPodSpec = object;

export type RedisHelmValuesReplicaAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesSentinel = {
  /**
   * IMPORTANT: this will disable the master and replicas services and
   * create a single Redis(R) service exposing both the Redis and Sentinel ports
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Bitnami Redis(R) Sentinel image version
   * ref: https://hub.docker.com/r/bitnami/redis-sentinel/tags/
   * @skip sentinel.image.tag Redis(R) Sentinel image tag (immutable tags are recommended)
   *
   * @default {...} (7 keys)
   */
  image?: RedisHelmValuesSentinelImage;
  /**
   * Additional custom annotations for Redis(R) Sentinel resource
   *
   * @default {}
   */
  annotations?: RedisHelmValuesSentinelAnnotations;
  /**
   * Master set name
   *
   * @default "mymaster"
   */
  masterSet?: string;
  /**
   * Sentinel Quorum
   *
   * @default 2
   */
  quorum?: number;
  /**
   * Amount of time to allow before get_sentinel_master_info() times out.
   *
   * @default 90
   */
  getMasterTimeout?: number;
  /**
   * This also prevents any new replica from starting until the last remaining replica is elected as master to guarantee that it is the one to be elected by Sentinel, and not a newly started replica with no data.
   * NOTE: This feature requires a "downAfterMilliseconds" value less or equal to 2000.
   *
   * @default false
   */
  automateClusterRecovery?: boolean;
  /**
   * Whether the Redis(R) master container waits for the failover at shutdown (in addition to the Redis(R) Sentinel container).
   *
   * @default true
   */
  redisShutdownWaitFailover?: boolean;
  /**
   * Sentinel timing restrictions
   *
   * @default 60000
   */
  downAfterMilliseconds?: number;
  /**
   * Timeout for performing a election failover
   *
   * @default 180000
   */
  failoverTimeout?: number;
  /**
   * Number of replicas that can be reconfigured in parallel to use the new master after a failover
   *
   * @default 1
   */
  parallelSyncs?: number;
  /**
   * Wait for data full sync on replicas before marking them as ready (experimental)
   *
   * @default false
   */
  replicaSyncCheck?: boolean;
  /**
   * ref: https://redis.io/topics/sentinel
   *
   * @default ""
   */
  configuration?: string;
  command?: unknown[];
  args?: unknown[];
  /**
   * Whether information about services should be injected into pod's environment variable
   *
   * @default true
   */
  enableServiceLinks?: boolean;
  preExecCmds?: unknown[];
  extraEnvVars?: unknown[];
  /**
   * Name of existing ConfigMap containing extra env vars for Redis(R) Sentinel nodes
   *
   * @default ""
   */
  extraEnvVarsCM?: string;
  /**
   * Name of existing Secret containing extra env vars for Redis(R) Sentinel nodes
   *
   * @default ""
   */
  extraEnvVarsSecret?: string;
  /**
   * @default {"enabled":false,"host":"","port":6379}
   */
  externalMaster?: RedisHelmValuesSentinelExternalMaster;
  /**
   * @default {"sentinel":26379}
   */
  containerPorts?: RedisHelmValuesSentinelContainerPorts;
  /**
   * Configure extra options for Redis(R) containers' liveness and readiness probes
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/#configure-probes
   *
   * @default {...} (6 keys)
   */
  startupProbe?: RedisHelmValuesSentinelStartupProbe;
  /**
   * @default {...} (6 keys)
   */
  livenessProbe?: RedisHelmValuesSentinelLivenessProbe;
  /**
   * @default {...} (6 keys)
   */
  readinessProbe?: RedisHelmValuesSentinelReadinessProbe;
  /**
   * Custom startupProbe that overrides the default one
   *
   * @default {}
   */
  customStartupProbe?: RedisHelmValuesSentinelCustomStartupProbe;
  /**
   * Custom livenessProbe that overrides the default one
   *
   * @default {}
   */
  customLivenessProbe?: RedisHelmValuesSentinelCustomLivenessProbe;
  /**
   * Custom readinessProbe that overrides the default one
   *
   * @default {}
   */
  customReadinessProbe?: RedisHelmValuesSentinelCustomReadinessProbe;
  /**
   * ref: https://kubernetes.io/docs/concepts/storage/persistent-volumes/
   *
   * @default {...} (10 keys)
   */
  persistence?: RedisHelmValuesSentinelPersistence;
  /**
   * persistentVolumeClaimRetentionPolicy
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#persistentvolumeclaim-retention
   *
   * @default {"enabled":false,"whenScaled":"Retain","whenDeleted":"Retain"}
   */
  persistentVolumeClaimRetentionPolicy?: RedisHelmValuesSentinelPersistentVolumeClaimRetentionPolicy;
  /**
   * Redis(R) Sentinel resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * @default "nano"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * @default {}
   */
  resources?: RedisHelmValuesSentinelResources;
  /**
   * @default {"openssl":""}
   */
  fips?: RedisHelmValuesSentinelFips;
  /**
   * Configure Container Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod
   *
   * @default {...} (9 keys)
   */
  containerSecurityContext?: RedisHelmValuesSentinelContainerSecurityContext;
  /**
   * for the Redis(R) sentinel container(s) to automate configuration before or after startup
   *
   * @default {}
   */
  lifecycleHooks?: RedisHelmValuesSentinelLifecycleHooks;
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  /**
   * Redis(R) Sentinel service parameters
   * Note: values passed in this section also configure the master service, unless the sentinel.masterService is explicitly overridden.
   *
   * @default {...} (14 keys)
   */
  service?: RedisHelmValuesSentinelService;
  /**
   * Redis(R) master service parameters
   *
   * @default {...} (13 keys)
   */
  masterService?: RedisHelmValuesSentinelMasterService;
  /**
   * Integer setting the termination grace period for the redis-node pods
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Optionally specify extra PodSpec for the Redis(R) Sentinel pod(s)
   *
   * @default {}
   */
  extraPodSpec?: RedisHelmValuesSentinelExtraPodSpec;
  /**
   * @default {"enabled":false,"service":{"type":"LoadBalancer","redisPort":6379,"sentinelPort":26379,"loadBalancerIPs":[],"loadBalancerClass":"","loadBalancerSourceRanges":[],"annotations":{},"loadBalancerIPAnnotation":""}}
   */
  externalAccess?: RedisHelmValuesSentinelExternalAccess;
};

export type RedisHelmValuesSentinelImage = {
  /**
   * [default: REGISTRY_NAME] Redis(R) Sentinel image registry
   *
   * @default "registry-1.docker.io"
   */
  registry?: string;
  /**
   * [default: REPOSITORY_NAME/redis-sentinel] Redis(R) Sentinel image repository
   *
   * @default "bitnami/redis-sentinel"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * Redis(R) Sentinel image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * @default ""
   */
  digest?: string;
  /**
   * Specify a imagePullPolicy
   * ref: https://kubernetes.io/docs/concepts/containers/images/#pre-pulled-images
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  pullSecrets?: unknown[];
  /**
   * Enable debug mode
   *
   * @default false
   */
  debug?: boolean;
};

export type RedisHelmValuesSentinelAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesSentinelExternalMaster = {
  /**
   * Use external master for bootstrapping
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * External master host to bootstrap from
   *
   * @default ""
   */
  host?: string;
  /**
   * Port for Redis service external master host
   *
   * @default 6379
   */
  port?: number;
};

export type RedisHelmValuesSentinelContainerPorts = {
  /**
   * Container port to open on Redis(R) Sentinel nodes
   *
   * @default 26379
   */
  sentinel?: number;
};

export type RedisHelmValuesSentinelStartupProbe = {
  /**
   * Enable startupProbe on Redis(R) Sentinel nodes
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for startupProbe
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for startupProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for startupProbe
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for startupProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for startupProbe
   *
   * @default 22
   */
  failureThreshold?: number;
};

export type RedisHelmValuesSentinelLivenessProbe = {
  /**
   * Enable livenessProbe on Redis(R) Sentinel nodes
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for livenessProbe
   *
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for livenessProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for livenessProbe
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for livenessProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for livenessProbe
   *
   * @default 6
   */
  failureThreshold?: number;
};

export type RedisHelmValuesSentinelReadinessProbe = {
  /**
   * Enable readinessProbe on Redis(R) Sentinel nodes
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for readinessProbe
   *
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for readinessProbe
   *
   * @default 5
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for readinessProbe
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for readinessProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for readinessProbe
   *
   * @default 6
   */
  failureThreshold?: number;
};

export type RedisHelmValuesSentinelCustomStartupProbe = object;

export type RedisHelmValuesSentinelCustomLivenessProbe = object;

export type RedisHelmValuesSentinelCustomReadinessProbe = object;

export type RedisHelmValuesSentinelPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable persistence on Redis(R) sentinel nodes using Persistent Volume Claims (Experimental)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * If defined, storageClassName: <storageClass>
   * If set to "-", storageClassName: "", which disables dynamic provisioning
   * If undefined (the default) or set to null, no storageClassName spec is set, choosing the default provisioner
   *
   * @default ""
   */
  storageClass?: string;
  accessModes?: string[];
  /**
   * Persistent Volume size
   *
   * @default "100Mi"
   */
  size?: string;
  /**
   * Additional custom annotations for the PVC
   *
   * @default {}
   */
  annotations?: RedisHelmValuesSentinelPersistenceAnnotations;
  /**
   * Additional custom labels for the PVC
   *
   * @default {}
   */
  labels?: RedisHelmValuesSentinelPersistenceLabels;
  /**
   * Additional labels to match for the PVC
   *
   * @default {}
   */
  selector?: RedisHelmValuesSentinelPersistenceSelector;
  /**
   * Custom PVC data source
   *
   * @default {}
   */
  dataSource?: RedisHelmValuesSentinelPersistenceDataSource;
  /**
   * Provide a medium for `emptyDir` volumes.
   *
   * @default ""
   */
  medium?: string;
  /**
   * Set this to enable a size limit for `emptyDir` volumes.
   *
   * @default ""
   */
  sizeLimit?: string;
};

export type RedisHelmValuesSentinelPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesSentinelPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesSentinelPersistenceSelector = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesSentinelPersistenceDataSource = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesSentinelPersistentVolumeClaimRetentionPolicy = {
  /**
   * Controls if and how PVCs are deleted during the lifecycle of a StatefulSet
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Volume retention behavior when the replica count of the StatefulSet is reduced
   *
   * @default "Retain"
   */
  whenScaled?: string;
  /**
   * Volume retention behavior that applies when the StatefulSet is deleted
   *
   * @default "Retain"
   */
  whenDeleted?: string;
};

export type RedisHelmValuesSentinelResources = object;

export type RedisHelmValuesSentinelFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
};

export type RedisHelmValuesSentinelContainerSecurityContext = {
  /**
   * Enabled Redis(R) Sentinel containers' Security Context
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * [object,nullable] Set SELinux options in container
   *
   * @default {}
   */
  seLinuxOptions?: RedisHelmValuesSentinelContainerSecurityContextSeLinuxOptions;
  /**
   * Set Redis(R) Sentinel containers' Security Context runAsUser
   *
   * @default 1001
   */
  runAsUser?: number;
  /**
   * Set Redis(R) Sentinel containers' Security Context runAsGroup
   *
   * @default 1001
   */
  runAsGroup?: number;
  /**
   * Set Redis(R) Sentinel containers' Security Context runAsNonRoot
   *
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * Set Redis(R) Sentinel containers' Security Context allowPrivilegeEscalation
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * Set container's Security Context read-only root filesystem
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: RedisHelmValuesSentinelContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: RedisHelmValuesSentinelContainerSecurityContextCapabilities;
};

export type RedisHelmValuesSentinelContainerSecurityContextSeLinuxOptions =
  object;

export type RedisHelmValuesSentinelContainerSecurityContextSeccompProfile = {
  /**
   * Set Redis(R) Sentinel containers' Security Context seccompProfile
   *
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type RedisHelmValuesSentinelContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type RedisHelmValuesSentinelLifecycleHooks = object;

export type RedisHelmValuesSentinelService = {
  /**
   * Redis(R) Sentinel service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {"redis":6379,"sentinel":26379}
   */
  ports?: RedisHelmValuesSentinelServicePorts;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport
   * NOTE: choose port between <30000-32767>
   * NOTE: By leaving these values blank, they will be generated by ports-configmap
   * If setting manually, please leave at least replica.replicaCount + 1 in between sentinel.service.nodePorts.redis and sentinel.service.nodePorts.sentinel to take into account the ports that will be created while incrementing that base port
   *
   * @default {"redis":"","sentinel":""}
   */
  nodePorts?: RedisHelmValuesSentinelServiceNodePorts;
  /**
   * ref: https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/#preserving-the-client-source-ip
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  extraPorts?: unknown[];
  /**
   * Redis(R) Sentinel service Cluster IP
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * NOTE: rbac.create need to be set to true
   *
   * @default false
   */
  createMaster?: boolean;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#internal-load-balancer
   *
   * @default ""
   */
  loadBalancerIP?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-loadbalancer
   *
   * @default ""
   */
  loadBalancerClass?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Additional custom annotations for Redis(R) Sentinel service
   *
   * @default {}
   */
  annotations?: RedisHelmValuesSentinelServiceAnnotations;
  /**
   * If "ClientIP", consecutive client requests will be directed to the same Pod
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#virtual-ips-and-service-proxies
   *
   * @default "None"
   */
  sessionAffinity?: string;
  /**
   * Additional settings for the sessionAffinity. Ignored if `sentinel.service.sessionAffinity` is `None`
   *
   * @default {}
   */
  sessionAffinityConfig?: RedisHelmValuesSentinelServiceSessionAffinityConfig;
  /**
   * Headless service properties
   *
   * @default {"annotations":{},"extraPorts":[]}
   */
  headless?: RedisHelmValuesSentinelServiceHeadless;
};

export type RedisHelmValuesSentinelServicePorts = {
  /**
   * Redis(R) service port for Redis(R)
   *
   * @default 6379
   */
  redis?: number;
  /**
   * Redis(R) service port for Redis(R) Sentinel
   *
   * @default 26379
   */
  sentinel?: number;
};

export type RedisHelmValuesSentinelServiceNodePorts = {
  /**
   * Node port for Redis(R)
   *
   * @default ""
   */
  redis?: string;
  /**
   * Node port for Sentinel
   *
   * @default ""
   */
  sentinel?: string;
};

export type RedisHelmValuesSentinelServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesSentinelServiceSessionAffinityConfig = object;

export type RedisHelmValuesSentinelServiceHeadless = {
  /**
   * Annotations for the headless service.
   *
   * @default {}
   */
  annotations?: RedisHelmValuesSentinelServiceHeadlessAnnotations;
  extraPorts?: unknown[];
};

export type RedisHelmValuesSentinelServiceHeadlessAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesSentinelMasterService = {
  /**
   * NOTE: rbac.create need to be set to true
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Redis(R) Sentinel master service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {"redis":6379}
   */
  ports?: RedisHelmValuesSentinelMasterServicePorts;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport
   * NOTE: choose port between <30000-32767>
   * NOTE: By leaving these values blank, they will be generated by ports-configmap
   * If setting manually, please leave at least replica.replicaCount + 1 in between sentinel.service.nodePorts.redis and sentinel.service.nodePorts.sentinel to take into account the ports that will be created while incrementing that base port
   *
   * @default {"redis":""}
   */
  nodePorts?: RedisHelmValuesSentinelMasterServiceNodePorts;
  /**
   * ref: https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/#preserving-the-client-source-ip
   *
   * @default ""
   */
  externalTrafficPolicy?: string;
  extraPorts?: unknown[];
  /**
   * Redis(R) master service Cluster IP
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#internal-load-balancer
   *
   * @default ""
   */
  loadBalancerIP?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-loadbalancer
   *
   * @default ""
   */
  loadBalancerClass?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Additional custom annotations for Redis(R) master service
   *
   * @default {}
   */
  annotations?: RedisHelmValuesSentinelMasterServiceAnnotations;
  /**
   * If "ClientIP", consecutive client requests will be directed to the same Pod
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#virtual-ips-and-service-proxies
   *
   * @default "None"
   */
  sessionAffinity?: string;
  /**
   * Additional settings for the sessionAffinity. Ignored if `sentinel.masterService.sessionAffinity` is `None`
   *
   * @default {}
   */
  sessionAffinityConfig?: RedisHelmValuesSentinelMasterServiceSessionAffinityConfig;
};

export type RedisHelmValuesSentinelMasterServicePorts = {
  /**
   * Redis(R) service port for Redis(R)
   *
   * @default 6379
   */
  redis?: number;
};

export type RedisHelmValuesSentinelMasterServiceNodePorts = {
  /**
   * Node port for Redis(R)
   *
   * @default ""
   */
  redis?: string;
};

export type RedisHelmValuesSentinelMasterServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesSentinelMasterServiceSessionAffinityConfig = object;

export type RedisHelmValuesSentinelExtraPodSpec = object;

export type RedisHelmValuesSentinelExternalAccess = {
  /**
   * Enable external access to the Redis
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {...} (8 keys)
   */
  service?: RedisHelmValuesSentinelExternalAccessService;
};

export type RedisHelmValuesSentinelExternalAccessService = {
  /**
   * At this moment only LoadBalancer is supported
   *
   * @default "LoadBalancer"
   */
  type?: string;
  /**
   * Port for the services used to expose redis-server
   *
   * @default 6379
   */
  redisPort?: number;
  /**
   * Port for the services used to expose redis-sentinel
   *
   * @default 26379
   */
  sentinelPort?: number;
  loadBalancerIPs?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-loadbalancer
   *
   * @default ""
   */
  loadBalancerClass?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Annotations to add to the services used to expose every Pod of the Redis(R) Cluster
   *
   * @default {}
   */
  annotations?: RedisHelmValuesSentinelExternalAccessServiceAnnotations;
  /**
   * Name of annotation to specify fixed IP for the LoadBalancer service
   *
   * @default ""
   */
  loadBalancerIPAnnotation?: string;
};

export type RedisHelmValuesSentinelExternalAccessServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesServiceBindings = {
  /**
   * Create secret for service binding (Experimental)
   *
   * @default false
   */
  enabled?: boolean;
};

export type RedisHelmValuesNetworkPolicy = {
  /**
   * Enable creation of NetworkPolicy resources
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * When set to false, only pods with the correct client label will have network access to the ports
   * Redis(R) is listening on. When true, Redis(R) will accept connections from any source
   * (with the correct destination port).
   *
   * @default true
   */
  allowExternal?: boolean;
  /**
   * Allow the pod to access any range of port and all destinations.
   *
   * @default true
   */
  allowExternalEgress?: boolean;
  extraIngress?: unknown[];
  extraEgress?: unknown[];
  /**
   * Labels to match to allow traffic from other namespaces
   *
   * @default {}
   */
  ingressNSMatchLabels?: RedisHelmValuesNetworkPolicyIngressNSMatchLabels;
  /**
   * Pod labels to match to allow traffic from other namespaces
   *
   * @default {}
   */
  ingressNSPodMatchLabels?: RedisHelmValuesNetworkPolicyIngressNSPodMatchLabels;
  /**
   * @default {"allowExternal":true,"ingressNSMatchLabels":{},"ingressNSPodMatchLabels":{}}
   */
  metrics?: RedisHelmValuesNetworkPolicyMetrics;
};

export type RedisHelmValuesNetworkPolicyIngressNSMatchLabels = object;

export type RedisHelmValuesNetworkPolicyIngressNSPodMatchLabels = object;

export type RedisHelmValuesNetworkPolicyMetrics = {
  /**
   * When set to false, only pods with the correct client label will have network access to the metrics port
   *
   * @default true
   */
  allowExternal?: boolean;
  /**
   * Labels to match to allow traffic from other namespaces to metrics endpoint
   *
   * @default {}
   */
  ingressNSMatchLabels?: RedisHelmValuesNetworkPolicyMetricsIngressNSMatchLabels;
  /**
   * Pod labels to match to allow traffic from other namespaces to metrics endpoint
   *
   * @default {}
   */
  ingressNSPodMatchLabels?: RedisHelmValuesNetworkPolicyMetricsIngressNSPodMatchLabels;
};

export type RedisHelmValuesNetworkPolicyMetricsIngressNSMatchLabels = object;

export type RedisHelmValuesNetworkPolicyMetricsIngressNSPodMatchLabels = object;

export type RedisHelmValuesPodSecurityPolicy = {
  /**
   * Whether to create a PodSecurityPolicy. WARNING: PodSecurityPolicy is deprecated in Kubernetes v1.21 or later, unavailable in v1.25 or later
   *
   * @default false
   */
  create?: boolean;
  /**
   * Enable PodSecurityPolicy's RBAC rules
   *
   * @default false
   */
  enabled?: boolean;
};

export type RedisHelmValuesRbac = {
  /**
   * Specifies whether RBAC resources should be created
   *
   * @default false
   */
  create?: boolean;
  rules?: unknown[];
};

export type RedisHelmValuesServiceAccount = {
  /**
   * Specifies whether a ServiceAccount should be created
   *
   * @default true
   */
  create?: boolean;
  /**
   * If not set and create is true, a name is generated using the common.names.fullname template
   *
   * @default ""
   */
  name?: string;
  /**
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#use-the-default-service-account-to-access-the-api-server
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  /**
   * Additional custom annotations for the ServiceAccount
   *
   * @default {}
   */
  annotations?: RedisHelmValuesServiceAccountAnnotations;
};

export type RedisHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesPdb = object;

export type RedisHelmValuesTls = {
  /**
   * Enable TLS traffic
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Require clients to authenticate
   *
   * @default true
   */
  authClients?: boolean;
  /**
   * Enable autogenerated certificates
   *
   * @default false
   */
  autoGenerated?: boolean;
  /**
   * The name of the existing secret that contains the TLS certificates
   *
   * @default ""
   */
  existingSecret?: string;
  /**
   * DEPRECATED. Use existingSecret instead.
   *
   * @default ""
   */
  certificatesSecret?: string;
  /**
   * Certificate filename
   *
   * @default ""
   */
  certFilename?: string;
  /**
   * Certificate Key filename
   *
   * @default ""
   */
  certKeyFilename?: string;
  /**
   * CA Certificate filename
   *
   * @default ""
   */
  certCAFilename?: string;
  /**
   * File containing DH params (in order to support DH based ciphers)
   *
   * @default ""
   */
  dhParamsFilename?: string;
};

export type RedisHelmValuesMetrics = {
  /**
   * Start a sidecar prometheus exporter to expose Redis(R) metrics
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Bitnami Redis(R) Exporter image
   * ref: https://hub.docker.com/r/bitnami/redis-exporter/tags/
   * @skip metrics.image.tag Redis(R) Exporter image tag (immutable tags are recommended)
   *
   * @default {...} (6 keys)
   */
  image?: RedisHelmValuesMetricsImage;
  /**
   * @default {"http":9121}
   */
  containerPorts?: RedisHelmValuesMetricsContainerPorts;
  /**
   * Configure extra options for Redis(R) containers' liveness, readiness & startup probes
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
   *
   * @default {...} (6 keys)
   */
  startupProbe?: RedisHelmValuesMetricsStartupProbe;
  /**
   * @default {...} (6 keys)
   */
  livenessProbe?: RedisHelmValuesMetricsLivenessProbe;
  /**
   * @default {...} (6 keys)
   */
  readinessProbe?: RedisHelmValuesMetricsReadinessProbe;
  /**
   * Custom startupProbe that overrides the default one
   *
   * @default {}
   */
  customStartupProbe?: RedisHelmValuesMetricsCustomStartupProbe;
  /**
   * Custom livenessProbe that overrides the default one
   *
   * @default {}
   */
  customLivenessProbe?: RedisHelmValuesMetricsCustomLivenessProbe;
  /**
   * Custom readinessProbe that overrides the default one
   *
   * @default {}
   */
  customReadinessProbe?: RedisHelmValuesMetricsCustomReadinessProbe;
  command?: unknown[];
  /**
   * Useful for certificate CN/SAN matching
   *
   * @default "localhost"
   */
  redisTargetHost?: string;
  /**
   * Extra arguments for Redis(R) exporter, for example:
   *
   * @default {}
   */
  extraArgs?: RedisHelmValuesMetricsExtraArgs;
  extraEnvVars?: unknown[];
  /**
   * Configure Container Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod
   *
   * @default {...} (9 keys)
   */
  containerSecurityContext?: RedisHelmValuesMetricsContainerSecurityContext;
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  /**
   * Redis(R) exporter resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * @default "nano"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * @default {}
   */
  resources?: RedisHelmValuesMetricsResources;
  /**
   * @default {"openssl":"","golang":"restricted"}
   */
  fips?: RedisHelmValuesMetricsFips;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * @default {}
   */
  podLabels?: RedisHelmValuesMetricsPodLabels;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
   *
   * @default {"prometheus.io/scrape":"true","prometheus.io/port":"9121"}
   */
  podAnnotations?: RedisHelmValuesMetricsPodAnnotations;
  /**
   * Redis(R) exporter service parameters
   *
   * @default {...} (10 keys)
   */
  service?: RedisHelmValuesMetricsService;
  /**
   * Prometheus Service Monitor
   * ref: https://github.com/coreos/prometheus-operator
   * https://github.com/coreos/prometheus-operator/blob/master/Documentation/api.md#endpoint
   * uncomment in order to scrape sentinel metrics, also to in order distinguish between Sentinel and Redis container metrics
   * add metricRelabelings with label like app=redis to main redis pod-monitor port
   * Prometheus Pod Monitor
   * ref: https://github.com/coreos/prometheus-operator
   * https://github.com/coreos/prometheus-operator/blob/master/Documentation/api.md#podmonitor
   *
   * @default {...} (15 keys)
   */
  serviceMonitor?: RedisHelmValuesMetricsServiceMonitor;
  /**
   * Custom PrometheusRule to be defined
   * ref: https://github.com/coreos/prometheus-operator#customresourcedefinitions
   *
   * @default {...} (15 keys)
   */
  podMonitor?: RedisHelmValuesMetricsPodMonitor;
  /**
   * @default {...} (4 keys)
   */
  prometheusRule?: RedisHelmValuesMetricsPrometheusRule;
};

export type RedisHelmValuesMetricsImage = {
  /**
   * [default: REGISTRY_NAME] Redis(R) Exporter image registry
   *
   * @default "registry-1.docker.io"
   */
  registry?: string;
  /**
   * [default: REPOSITORY_NAME/redis-exporter] Redis(R) Exporter image repository
   *
   * @default "bitnami/redis-exporter"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * Redis(R) Exporter image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * @default ""
   */
  digest?: string;
  /**
   * Redis(R) Exporter image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  pullSecrets?: unknown[];
};

export type RedisHelmValuesMetricsContainerPorts = {
  /**
   * Metrics HTTP container port
   *
   * @default 9121
   */
  http?: number;
};

export type RedisHelmValuesMetricsStartupProbe = {
  /**
   * Enable startupProbe on Redis(R) replicas nodes
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for startupProbe
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for startupProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for startupProbe
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for startupProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for startupProbe
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type RedisHelmValuesMetricsLivenessProbe = {
  /**
   * Enable livenessProbe on Redis(R) replicas nodes
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for livenessProbe
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for livenessProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for livenessProbe
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for livenessProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for livenessProbe
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type RedisHelmValuesMetricsReadinessProbe = {
  /**
   * Enable readinessProbe on Redis(R) replicas nodes
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for readinessProbe
   *
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for readinessProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for readinessProbe
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for readinessProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for readinessProbe
   *
   * @default 3
   */
  failureThreshold?: number;
};

export type RedisHelmValuesMetricsCustomStartupProbe = object;

export type RedisHelmValuesMetricsCustomLivenessProbe = object;

export type RedisHelmValuesMetricsCustomReadinessProbe = object;

export type RedisHelmValuesMetricsExtraArgs = object;

export type RedisHelmValuesMetricsContainerSecurityContext = {
  /**
   * Enabled Redis(R) exporter containers' Security Context
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * [object,nullable] Set SELinux options in container
   *
   * @default {}
   */
  seLinuxOptions?: RedisHelmValuesMetricsContainerSecurityContextSeLinuxOptions;
  /**
   * Set Redis(R) exporter containers' Security Context runAsUser
   *
   * @default 1001
   */
  runAsUser?: number;
  /**
   * Set Redis(R) exporter containers' Security Context runAsGroup
   *
   * @default 1001
   */
  runAsGroup?: number;
  /**
   * Set Redis(R) exporter containers' Security Context runAsNonRoot
   *
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * Set Redis(R) exporter containers' Security Context allowPrivilegeEscalation
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * Set container's Security Context read-only root filesystem
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: RedisHelmValuesMetricsContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: RedisHelmValuesMetricsContainerSecurityContextCapabilities;
};

export type RedisHelmValuesMetricsContainerSecurityContextSeLinuxOptions =
  object;

export type RedisHelmValuesMetricsContainerSecurityContextSeccompProfile = {
  /**
   * Set Redis(R) exporter containers' Security Context seccompProfile
   *
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type RedisHelmValuesMetricsContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type RedisHelmValuesMetricsResources = object;

export type RedisHelmValuesMetricsFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
  /**
   * Configure Golang FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default "restricted"
   */
  golang?: string;
};

export type RedisHelmValuesMetricsPodLabels = object;

export type RedisHelmValuesMetricsPodAnnotations = {
  /**
   * @default "true"
   */
  "prometheus.io/scrape"?: boolean;
  /**
   * @default "9121"
   */
  "prometheus.io/port"?: number;
};

export type RedisHelmValuesMetricsService = {
  /**
   * Create Service resource(s) for scraping metrics using PrometheusOperator ServiceMonitor, can be disabled when using a PodMonitor
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Redis(R) exporter service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {"http":9121}
   */
  ports?: RedisHelmValuesMetricsServicePorts;
  /**
   * ref: https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/#preserving-the-client-source-ip
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  extraPorts?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#internal-load-balancer
   *
   * @default ""
   */
  loadBalancerIP?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-loadbalancer
   *
   * @default ""
   */
  loadBalancerClass?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Additional custom annotations for Redis(R) exporter service
   *
   * @default {}
   */
  annotations?: RedisHelmValuesMetricsServiceAnnotations;
  /**
   * Redis(R) exporter service Cluster IP
   *
   * @default ""
   */
  clusterIP?: string;
};

export type RedisHelmValuesMetricsServicePorts = {
  /**
   * Redis(R) exporter service port
   *
   * @default 9121
   */
  http?: number;
};

export type RedisHelmValuesMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type RedisHelmValuesMetricsServiceMonitor = {
  /**
   * the service port to scrape metrics from
   *
   * @default "http-metrics"
   */
  port?: string;
  /**
   * Create ServiceMonitor resource(s) for scraping metrics using PrometheusOperator
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * The namespace in which the ServiceMonitor will be created
   *
   * @default ""
   */
  namespace?: string;
  /**
   * [object] TLS configuration used for scrape endpoints used by Prometheus
   *
   * @default {}
   */
  tlsConfig?: RedisHelmValuesMetricsServiceMonitorTlsConfig;
  /**
   * The interval at which metrics should be scraped
   *
   * @default "30s"
   */
  interval?: string;
  /**
   * The timeout after which the scrape is ended
   *
   * @default ""
   */
  scrapeTimeout?: string;
  relabelings?: unknown[];
  relabellings?: unknown[];
  metricRelabelings?: unknown[];
  /**
   * Specify honorLabels parameter to add the scrape endpoint
   *
   * @default false
   */
  honorLabels?: boolean;
  /**
   * Additional labels that can be used so ServiceMonitor resource(s) can be discovered by Prometheus
   *
   * @default {}
   */
  additionalLabels?: RedisHelmValuesMetricsServiceMonitorAdditionalLabels;
  podTargetLabels?: unknown[];
  /**
   * Limit of how many samples should be scraped from every Pod
   *
   * @default false
   */
  sampleLimit?: boolean;
  /**
   * Limit of how many targets should be scraped
   *
   * @default false
   */
  targetLimit?: boolean;
  additionalEndpoints?: unknown[];
};

export type RedisHelmValuesMetricsServiceMonitorTlsConfig = object;

export type RedisHelmValuesMetricsServiceMonitorAdditionalLabels = object;

export type RedisHelmValuesMetricsPodMonitor = {
  /**
   * the pod port to scrape metrics from
   *
   * @default "metrics"
   */
  port?: string;
  /**
   * Create PodMonitor resource(s) for scraping metrics using PrometheusOperator
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * The namespace in which the PodMonitor will be created
   *
   * @default ""
   */
  namespace?: string;
  /**
   * [object] TLS configuration used for scrape endpoints used by Prometheus
   *
   * @default {}
   */
  tlsConfig?: RedisHelmValuesMetricsPodMonitorTlsConfig;
  /**
   * The interval at which metrics should be scraped
   *
   * @default "30s"
   */
  interval?: string;
  /**
   * The timeout after which the scrape is ended
   *
   * @default ""
   */
  scrapeTimeout?: string;
  relabelings?: unknown[];
  relabellings?: unknown[];
  metricRelabelings?: unknown[];
  /**
   * Specify honorLabels parameter to add the scrape endpoint
   *
   * @default false
   */
  honorLabels?: boolean;
  /**
   * Additional labels that can be used so PodMonitor resource(s) can be discovered by Prometheus
   *
   * @default {}
   */
  additionalLabels?: RedisHelmValuesMetricsPodMonitorAdditionalLabels;
  podTargetLabels?: unknown[];
  /**
   * Limit of how many samples should be scraped from every Pod
   *
   * @default false
   */
  sampleLimit?: boolean;
  /**
   * Limit of how many targets should be scraped
   *
   * @default false
   */
  targetLimit?: boolean;
  additionalEndpoints?: unknown[];
};

export type RedisHelmValuesMetricsPodMonitorTlsConfig = object;

export type RedisHelmValuesMetricsPodMonitorAdditionalLabels = object;

export type RedisHelmValuesMetricsPrometheusRule = {
  /**
   * Create a custom prometheusRule Resource for scraping metrics using PrometheusOperator
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * The namespace in which the prometheusRule will be created
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Additional labels for the prometheusRule
   *
   * @default {}
   */
  additionalLabels?: RedisHelmValuesMetricsPrometheusRuleAdditionalLabels;
  rules?: unknown[];
};

export type RedisHelmValuesMetricsPrometheusRuleAdditionalLabels = object;

export type RedisHelmValuesVolumePermissions = {
  /**
   * Enable init container that changes the owner/group of the PV mount point to `runAsUser:fsGroup`
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * OS Shell + Utility image
   * ref: https://hub.docker.com/r/bitnami/os-shell/tags/
   * @skip volumePermissions.image.tag OS Shell + Utility image tag (immutable tags are recommended)
   *
   * @default {...} (6 keys)
   */
  image?: RedisHelmValuesVolumePermissionsImage;
  /**
   * Init container's resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * @default "nano"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * @default {}
   */
  resources?: RedisHelmValuesVolumePermissionsResources;
  /**
   * @default {"openssl":""}
   */
  fips?: RedisHelmValuesVolumePermissionsFips;
  /**
   * Init container Container Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container
   * NOTE: when runAsUser is set to special value "auto", init container will try to chown the
   * data folder to auto-determined user&group, using commands: `id -u`:`id -G | cut -d" " -f2`
   * "auto" is especially useful for OpenShift which has scc with dynamic user ids (and 0 is not allowed)
   *
   * @default {"seLinuxOptions":{},"runAsUser":0}
   */
  containerSecurityContext?: RedisHelmValuesVolumePermissionsContainerSecurityContext;
  extraEnvVars?: unknown[];
};

export type RedisHelmValuesVolumePermissionsImage = {
  /**
   * [default: REGISTRY_NAME] OS Shell + Utility image registry
   *
   * @default "registry-1.docker.io"
   */
  registry?: string;
  /**
   * [default: REPOSITORY_NAME/os-shell] OS Shell + Utility image repository
   *
   * @default "bitnami/os-shell"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * OS Shell + Utility image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * @default ""
   */
  digest?: string;
  /**
   * OS Shell + Utility image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  pullSecrets?: unknown[];
};

export type RedisHelmValuesVolumePermissionsResources = object;

export type RedisHelmValuesVolumePermissionsFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
};

export type RedisHelmValuesVolumePermissionsContainerSecurityContext = {
  /**
   * [object,nullable] Set SELinux options in container
   *
   * @default {}
   */
  seLinuxOptions?: RedisHelmValuesVolumePermissionsContainerSecurityContextSeLinuxOptions;
  /**
   * Set init container's Security Context runAsUser
   *
   * @default 0
   */
  runAsUser?: number;
};

export type RedisHelmValuesVolumePermissionsContainerSecurityContextSeLinuxOptions =
  object;

export type RedisHelmValuesKubectl = {
  /**
   * Bitnami Kubectl image version
   * ref: https://hub.docker.com/r/bitnami/kubectl/tags/
   * @skip kubectl.image.tag Kubectl image tag (immutable tags are recommended), by default, using the current version
   *
   * @default {...} (6 keys)
   */
  image?: RedisHelmValuesKubectlImage;
  command?: string[];
  /**
   * Configure Container Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod
   *
   * @default {...} (9 keys)
   */
  containerSecurityContext?: RedisHelmValuesKubectlContainerSecurityContext;
  /**
   * Bitnami Kubectl resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   *
   * @default {"limits":{},"requests":{}}
   */
  resources?: RedisHelmValuesKubectlResources;
  /**
   * @default {"openssl":"","golang":"relaxed"}
   */
  fips?: RedisHelmValuesKubectlFips;
};

export type RedisHelmValuesKubectlImage = {
  /**
   * [default: REGISTRY_NAME] Kubectl image registry
   *
   * @default "registry-1.docker.io"
   */
  registry?: string;
  /**
   * [default: REPOSITORY_NAME/kubectl] Kubectl image repository
   *
   * @default "bitnami/kubectl"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * Kubectl image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * @default ""
   */
  digest?: string;
  /**
   * Specify a imagePullPolicy
   * ref: https://kubernetes.io/docs/concepts/containers/images/#pre-pulled-images
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  pullSecrets?: unknown[];
};

export type RedisHelmValuesKubectlContainerSecurityContext = {
  /**
   * Enabled kubectl containers' Security Context
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * [object,nullable] Set SELinux options in container
   *
   * @default {}
   */
  seLinuxOptions?: RedisHelmValuesKubectlContainerSecurityContextSeLinuxOptions;
  /**
   * Set kubectl containers' Security Context runAsUser
   *
   * @default 1001
   */
  runAsUser?: number;
  /**
   * Set kubectl containers' Security Context runAsGroup
   *
   * @default 1001
   */
  runAsGroup?: number;
  /**
   * Set kubectl containers' Security Context runAsNonRoot
   *
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * Set kubectl containers' Security Context allowPrivilegeEscalation
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * Set container's Security Context read-only root filesystem
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: RedisHelmValuesKubectlContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: RedisHelmValuesKubectlContainerSecurityContextCapabilities;
};

export type RedisHelmValuesKubectlContainerSecurityContextSeLinuxOptions =
  object;

export type RedisHelmValuesKubectlContainerSecurityContextSeccompProfile = {
  /**
   * Set kubectl containers' Security Context seccompProfile
   *
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type RedisHelmValuesKubectlContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type RedisHelmValuesKubectlResources = {
  /**
   * The resources limits for the kubectl containers
   *
   * @default {}
   */
  limits?: RedisHelmValuesKubectlResourcesLimits;
  /**
   * The requested resources for the kubectl containers
   *
   * @default {}
   */
  requests?: RedisHelmValuesKubectlResourcesRequests;
};

export type RedisHelmValuesKubectlResourcesLimits = object;

export type RedisHelmValuesKubectlResourcesRequests = object;

export type RedisHelmValuesKubectlFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
  /**
   * Configure Golang FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default "relaxed"
   */
  golang?: string;
};

export type RedisHelmValuesSysctl = {
  /**
   * Enable init container to modify Kernel settings
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * OS Shell + Utility image
   * ref: https://hub.docker.com/r/bitnami/os-shell/tags/
   * @skip sysctl.image.tag OS Shell + Utility image tag (immutable tags are recommended)
   *
   * @default {...} (6 keys)
   */
  image?: RedisHelmValuesSysctlImage;
  command?: unknown[];
  /**
   * Mount the host `/sys` folder to `/host-sys`
   *
   * @default false
   */
  mountHostSys?: boolean;
  /**
   * Init container's resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * @default "nano"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * @default {}
   */
  resources?: RedisHelmValuesSysctlResources;
  /**
   * @default {"openssl":""}
   */
  fips?: RedisHelmValuesSysctlFips;
};

export type RedisHelmValuesSysctlImage = {
  /**
   * [default: REGISTRY_NAME] OS Shell + Utility image registry
   *
   * @default "registry-1.docker.io"
   */
  registry?: string;
  /**
   * [default: REPOSITORY_NAME/os-shell] OS Shell + Utility image repository
   *
   * @default "bitnami/os-shell"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * OS Shell + Utility image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * @default ""
   */
  digest?: string;
  /**
   * OS Shell + Utility image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  pullSecrets?: unknown[];
};

export type RedisHelmValuesSysctlResources = object;

export type RedisHelmValuesSysctlFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
};

export type RedisHelmValuesUseExternalDNS = {
  /**
   * Enable various syntax that would enable external-dns to work.  Note this requires a working installation of `external-dns` to be usable.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * The DNS suffix utilized when `external-dns` is enabled.  Note that we prepend the suffix with the full name of the release.
   *
   * @default ""
   */
  suffix?: string;
  /**
   * The annotation key utilized when `external-dns` is enabled. Setting this to `false` will disable annotations.
   *
   * @default "external-dns.alpha.kubernetes.io/"
   */
  annotationKey?: string;
  /**
   * Extra annotations to be utilized when `external-dns` is enabled.
   *
   * @default {}
   */
  additionalAnnotations?: RedisHelmValuesUseExternalDNSAdditionalAnnotations;
};

export type RedisHelmValuesUseExternalDNSAdditionalAnnotations = object;

export type RedisHelmValues = {
  /**
   * Copyright Broadcom, Inc. All Rights Reserved.
   * Global Docker image parameters
   * Please, note that this will override the image parameters, including dependencies, configured to use the global value
   * Current available global Docker image parameters: imageRegistry, imagePullSecrets and storageClass
   *
   * @default {...} (8 keys)
   */
  global?: RedisHelmValuesGlobal;
  /**
   * Common parameters
   *
   * @default ""
   */
  kubeVersion?: string;
  /**
   * String to partially override common.names.fullname
   *
   * @default ""
   */
  nameOverride?: string;
  /**
   * String to fully override common.names.fullname
   *
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * String to fully override common.names.namespace
   *
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * Labels to add to all deployed objects
   *
   * @default {}
   */
  commonLabels?: RedisHelmValuesCommonLabels;
  /**
   * Annotations to add to all deployed objects
   *
   * @default {}
   */
  commonAnnotations?: RedisHelmValuesCommonAnnotations;
  /**
   * Enable checksum annotations used to trigger rolling updates when ConfigMap(s) change
   *
   * @default true
   */
  configmapChecksumAnnotations?: boolean;
  /**
   * Enable checksum annotations used to trigger rolling updates when Secret(s) change
   *
   * @default true
   */
  secretChecksumAnnotations?: boolean;
  /**
   * Annotations to add to secret
   *
   * @default {}
   */
  secretAnnotations?: RedisHelmValuesSecretAnnotations;
  /**
   * Kubernetes cluster domain name
   *
   * @default "cluster.local"
   */
  clusterDomain?: string;
  extraDeploy?: unknown[];
  /**
   * Use hostnames internally when announcing replication. If false, the hostname will be resolved to an IP address
   *
   * @default true
   */
  useHostnames?: boolean;
  /**
   * Failure threshold for internal hostnames resolution
   *
   * @default 5
   */
  nameResolutionThreshold?: number;
  /**
   * Timeout seconds between probes for internal hostnames resolution
   *
   * @default 5
   */
  nameResolutionTimeout?: number;
  /**
   * Enable diagnostic mode in the deployment
   *
   * @default {"enabled":false,"command":["sleep"],"args":["infinity"]}
   */
  diagnosticMode?: RedisHelmValuesDiagnosticMode;
  /**
   * Redis(R) Image parameters
   * Bitnami Redis(R) image
   * ref: https://hub.docker.com/r/bitnami/redis/tags/
   * @skip image.tag Redis(R) image tag (immutable tags are recommended)
   *
   * @default {...} (7 keys)
   */
  image?: RedisHelmValuesImage;
  /**
   * Redis(R) common configuration parameters
   * https://github.com/bitnami/containers/tree/main/bitnami/redis#configuration
   *
   * @default "replication"
   */
  architecture?: string;
  /**
   * Redis(R) Authentication parameters
   * ref: https://github.com/bitnami/containers/tree/main/bitnami/redis#setting-the-server-password-on-first-run
   *
   * @default {...} (8 keys)
   */
  auth?: RedisHelmValuesAuth;
  /**
   * ref: https://redis.io/topics/config
   *
   * @default "# Enable ReJSON y Redisearch
loadmodule /opt/bi..."
   */
  commonConfiguration?: string;
  /**
   * The name of an existing ConfigMap with your custom configuration for Redis(R) nodes
   *
   * @default ""
   */
  existingConfigmap?: string;
  /**
   * Redis(R) master configuration parameters
   *
   * @default {...} (57 keys)
   */
  master?: RedisHelmValuesMaster;
  /**
   * Redis(R) replicas configuration parameters
   *
   * @default {...} (60 keys)
   */
  replica?: RedisHelmValuesReplica;
  /**
   * Redis(R) Sentinel configuration parameters
   *
   * @default {...} (42 keys)
   */
  sentinel?: RedisHelmValuesSentinel;
  /**
   * Ref: https://servicebinding.io/service-provider/
   *
   * @default {"enabled":false}
   */
  serviceBindings?: RedisHelmValuesServiceBindings;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/network-policies/
   *
   * @default {...} (8 keys)
   */
  networkPolicy?: RedisHelmValuesNetworkPolicy;
  /**
   * ref: https://kubernetes.io/docs/concepts/policy/pod-security-policy/
   *
   * @default {"create":false,"enabled":false}
   */
  podSecurityPolicy?: RedisHelmValuesPodSecurityPolicy;
  /**
   * RBAC configuration
   *
   * @default {"create":false,"rules":[]}
   */
  rbac?: RedisHelmValuesRbac;
  /**
   * ServiceAccount configuration
   *
   * @default {...} (4 keys)
   */
  serviceAccount?: RedisHelmValuesServiceAccount;
  /**
   * ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {}
   */
  pdb?: RedisHelmValuesPdb;
  /**
   * TLS configuration
   *
   * @default {...} (9 keys)
   */
  tls?: RedisHelmValuesTls;
  /**
   * Metrics Parameters
   *
   * @default {...} (25 keys)
   */
  metrics?: RedisHelmValuesMetrics;
  /**
   * Init Container Parameters
   * 'volumePermissions' init container parameters
   * Changes the owner and group of the persistent volume mount point to runAsUser:fsGroup values
   * based on the *podSecurityContext/*containerSecurityContext parameters
   *
   * @default {...} (7 keys)
   */
  volumePermissions?: RedisHelmValuesVolumePermissions;
  /**
   * Kubectl InitContainer
   * used by Sentinel to update the isMaster label on the Redis(TM) pods
   *
   * @default {...} (5 keys)
   */
  kubectl?: RedisHelmValuesKubectl;
  /**
   * init-sysctl container parameters
   * used to perform sysctl operation to modify Kernel settings (needed sometimes to avoid warnings)
   *
   * @default {...} (7 keys)
   */
  sysctl?: RedisHelmValuesSysctl;
  /**
   * useExternalDNS Parameters
   *
   * @default {...} (4 keys)
   */
  useExternalDNS?: RedisHelmValuesUseExternalDNS;
};

export type RedisHelmParameters = {
  "global.imageRegistry"?: string;
  "global.imagePullSecrets"?: string;
  "global.defaultStorageClass"?: string;
  "global.storageClass"?: string;
  "global.security.allowInsecureImages"?: string;
  "global.redis.password"?: string;
  "global.compatibility.openshift.adaptSecurityContext"?: string;
  "global.defaultFips"?: string;
  kubeVersion?: string;
  nameOverride?: string;
  fullnameOverride?: string;
  namespaceOverride?: string;
  configmapChecksumAnnotations?: string;
  secretChecksumAnnotations?: string;
  clusterDomain?: string;
  extraDeploy?: string;
  useHostnames?: string;
  nameResolutionThreshold?: string;
  nameResolutionTimeout?: string;
  "diagnosticMode.enabled"?: string;
  "diagnosticMode.command"?: string;
  "diagnosticMode.args"?: string;
  "image.registry"?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "image.digest"?: string;
  "image.pullPolicy"?: string;
  "image.pullSecrets"?: string;
  "image.debug"?: string;
  architecture?: string;
  "auth.enabled"?: string;
  "auth.sentinel"?: string;
  "auth.password"?: string;
  "auth.existingSecret"?: string;
  "auth.existingSecretPasswordKey"?: string;
  "auth.usePasswordFiles"?: string;
  "auth.usePasswordFileFromSecret"?: string;
  "auth.acl.enabled"?: string;
  "auth.acl.sentinel"?: string;
  "auth.acl.users"?: string;
  "auth.acl.userSecret"?: string;
  commonConfiguration?: string;
  existingConfigmap?: string;
  "master.count"?: string;
  "master.revisionHistoryLimit"?: string;
  "master.configuration"?: string;
  "master.disableCommands"?: string;
  "master.command"?: string;
  "master.args"?: string;
  "master.enableServiceLinks"?: string;
  "master.preExecCmds"?: string;
  "master.extraFlags"?: string;
  "master.extraEnvVars"?: string;
  "master.extraEnvVarsCM"?: string;
  "master.extraEnvVarsSecret"?: string;
  "master.containerPorts.redis"?: string;
  "master.startupProbe.enabled"?: string;
  "master.startupProbe.initialDelaySeconds"?: string;
  "master.startupProbe.periodSeconds"?: string;
  "master.startupProbe.timeoutSeconds"?: string;
  "master.startupProbe.successThreshold"?: string;
  "master.startupProbe.failureThreshold"?: string;
  "master.livenessProbe.enabled"?: string;
  "master.livenessProbe.initialDelaySeconds"?: string;
  "master.livenessProbe.periodSeconds"?: string;
  "master.livenessProbe.timeoutSeconds"?: string;
  "master.livenessProbe.successThreshold"?: string;
  "master.livenessProbe.failureThreshold"?: string;
  "master.readinessProbe.enabled"?: string;
  "master.readinessProbe.initialDelaySeconds"?: string;
  "master.readinessProbe.periodSeconds"?: string;
  "master.readinessProbe.timeoutSeconds"?: string;
  "master.readinessProbe.successThreshold"?: string;
  "master.readinessProbe.failureThreshold"?: string;
  "master.resourcesPreset"?: string;
  "master.fips.openssl"?: string;
  "master.podSecurityContext.enabled"?: string;
  "master.podSecurityContext.fsGroupChangePolicy"?: string;
  "master.podSecurityContext.sysctls"?: string;
  "master.podSecurityContext.supplementalGroups"?: string;
  "master.podSecurityContext.fsGroup"?: string;
  "master.containerSecurityContext.enabled"?: string;
  "master.containerSecurityContext.runAsUser"?: string;
  "master.containerSecurityContext.runAsGroup"?: string;
  "master.containerSecurityContext.runAsNonRoot"?: string;
  "master.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "master.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "master.containerSecurityContext.seccompProfile.type"?: string;
  "master.containerSecurityContext.capabilities.drop"?: string;
  "master.kind"?: string;
  "master.schedulerName"?: string;
  "master.runtimeClassName"?: string;
  "master.updateStrategy.type"?: string;
  "master.minReadySeconds"?: string;
  "master.priorityClassName"?: string;
  "master.automountServiceAccountToken"?: string;
  "master.hostAliases"?: string;
  "master.shareProcessNamespace"?: string;
  "master.podAffinityPreset"?: string;
  "master.podAntiAffinityPreset"?: string;
  "master.nodeAffinityPreset.type"?: string;
  "master.nodeAffinityPreset.key"?: string;
  "master.nodeAffinityPreset.values"?: string;
  "master.tolerations"?: string;
  "master.topologySpreadConstraints"?: string;
  "master.dnsPolicy"?: string;
  "master.extraVolumes"?: string;
  "master.extraVolumeMounts"?: string;
  "master.sidecars"?: string;
  "master.initContainers"?: string;
  "master.persistence.enabled"?: string;
  "master.persistence.medium"?: string;
  "master.persistence.sizeLimit"?: string;
  "master.persistence.path"?: string;
  "master.persistence.subPath"?: string;
  "master.persistence.subPathExpr"?: string;
  "master.persistence.storageClass"?: string;
  "master.persistence.accessModes"?: string;
  "master.persistence.size"?: string;
  "master.persistence.existingClaim"?: string;
  "master.persistentVolumeClaimRetentionPolicy.enabled"?: string;
  "master.persistentVolumeClaimRetentionPolicy.whenScaled"?: string;
  "master.persistentVolumeClaimRetentionPolicy.whenDeleted"?: string;
  "master.service.type"?: string;
  "master.service.portNames.redis"?: string;
  "master.service.ports.redis"?: string;
  "master.service.nodePorts.redis"?: string;
  "master.service.externalTrafficPolicy"?: string;
  "master.service.extraPorts"?: string;
  "master.service.internalTrafficPolicy"?: string;
  "master.service.clusterIP"?: string;
  "master.service.loadBalancerIP"?: string;
  "master.service.loadBalancerClass"?: string;
  "master.service.loadBalancerSourceRanges"?: string;
  "master.service.externalIPs"?: string;
  "master.service.sessionAffinity"?: string;
  "master.terminationGracePeriodSeconds"?: string;
  "master.serviceAccount.create"?: string;
  "master.serviceAccount.name"?: string;
  "master.serviceAccount.automountServiceAccountToken"?: string;
  "master.pdb.create"?: string;
  "master.pdb.minAvailable"?: string;
  "master.pdb.maxUnavailable"?: string;
  "replica.kind"?: string;
  "replica.replicaCount"?: string;
  "replica.revisionHistoryLimit"?: string;
  "replica.configuration"?: string;
  "replica.disableCommands"?: string;
  "replica.command"?: string;
  "replica.args"?: string;
  "replica.enableServiceLinks"?: string;
  "replica.preExecCmds"?: string;
  "replica.extraFlags"?: string;
  "replica.extraEnvVars"?: string;
  "replica.extraEnvVarsCM"?: string;
  "replica.extraEnvVarsSecret"?: string;
  "replica.externalMaster.enabled"?: string;
  "replica.externalMaster.host"?: string;
  "replica.externalMaster.port"?: string;
  "replica.containerPorts.redis"?: string;
  "replica.startupProbe.enabled"?: string;
  "replica.startupProbe.initialDelaySeconds"?: string;
  "replica.startupProbe.periodSeconds"?: string;
  "replica.startupProbe.timeoutSeconds"?: string;
  "replica.startupProbe.successThreshold"?: string;
  "replica.startupProbe.failureThreshold"?: string;
  "replica.livenessProbe.enabled"?: string;
  "replica.livenessProbe.initialDelaySeconds"?: string;
  "replica.livenessProbe.periodSeconds"?: string;
  "replica.livenessProbe.timeoutSeconds"?: string;
  "replica.livenessProbe.successThreshold"?: string;
  "replica.livenessProbe.failureThreshold"?: string;
  "replica.readinessProbe.enabled"?: string;
  "replica.readinessProbe.initialDelaySeconds"?: string;
  "replica.readinessProbe.periodSeconds"?: string;
  "replica.readinessProbe.timeoutSeconds"?: string;
  "replica.readinessProbe.successThreshold"?: string;
  "replica.readinessProbe.failureThreshold"?: string;
  "replica.resourcesPreset"?: string;
  "replica.fips.openssl"?: string;
  "replica.podSecurityContext.enabled"?: string;
  "replica.podSecurityContext.fsGroupChangePolicy"?: string;
  "replica.podSecurityContext.sysctls"?: string;
  "replica.podSecurityContext.supplementalGroups"?: string;
  "replica.podSecurityContext.fsGroup"?: string;
  "replica.containerSecurityContext.enabled"?: string;
  "replica.containerSecurityContext.runAsUser"?: string;
  "replica.containerSecurityContext.runAsGroup"?: string;
  "replica.containerSecurityContext.runAsNonRoot"?: string;
  "replica.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "replica.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "replica.containerSecurityContext.seccompProfile.type"?: string;
  "replica.containerSecurityContext.capabilities.drop"?: string;
  "replica.schedulerName"?: string;
  "replica.runtimeClassName"?: string;
  "replica.updateStrategy.type"?: string;
  "replica.minReadySeconds"?: string;
  "replica.priorityClassName"?: string;
  "replica.podManagementPolicy"?: string;
  "replica.automountServiceAccountToken"?: string;
  "replica.hostAliases"?: string;
  "replica.shareProcessNamespace"?: string;
  "replica.podAffinityPreset"?: string;
  "replica.podAntiAffinityPreset"?: string;
  "replica.nodeAffinityPreset.type"?: string;
  "replica.nodeAffinityPreset.key"?: string;
  "replica.nodeAffinityPreset.values"?: string;
  "replica.tolerations"?: string;
  "replica.topologySpreadConstraints"?: string;
  "replica.dnsPolicy"?: string;
  "replica.extraVolumes"?: string;
  "replica.extraVolumeMounts"?: string;
  "replica.sidecars"?: string;
  "replica.initContainers"?: string;
  "replica.persistence.enabled"?: string;
  "replica.persistence.medium"?: string;
  "replica.persistence.sizeLimit"?: string;
  "replica.persistence.path"?: string;
  "replica.persistence.subPath"?: string;
  "replica.persistence.subPathExpr"?: string;
  "replica.persistence.storageClass"?: string;
  "replica.persistence.accessModes"?: string;
  "replica.persistence.size"?: string;
  "replica.persistence.existingClaim"?: string;
  "replica.persistentVolumeClaimRetentionPolicy.enabled"?: string;
  "replica.persistentVolumeClaimRetentionPolicy.whenScaled"?: string;
  "replica.persistentVolumeClaimRetentionPolicy.whenDeleted"?: string;
  "replica.service.type"?: string;
  "replica.service.ports.redis"?: string;
  "replica.service.nodePorts.redis"?: string;
  "replica.service.externalTrafficPolicy"?: string;
  "replica.service.internalTrafficPolicy"?: string;
  "replica.service.extraPorts"?: string;
  "replica.service.clusterIP"?: string;
  "replica.service.loadBalancerIP"?: string;
  "replica.service.loadBalancerClass"?: string;
  "replica.service.loadBalancerSourceRanges"?: string;
  "replica.service.sessionAffinity"?: string;
  "replica.terminationGracePeriodSeconds"?: string;
  "replica.autoscaling.enabled"?: string;
  "replica.autoscaling.minReplicas"?: string;
  "replica.autoscaling.maxReplicas"?: string;
  "replica.autoscaling.targetCPU"?: string;
  "replica.autoscaling.targetMemory"?: string;
  "replica.serviceAccount.create"?: string;
  "replica.serviceAccount.name"?: string;
  "replica.serviceAccount.automountServiceAccountToken"?: string;
  "replica.pdb.create"?: string;
  "replica.pdb.minAvailable"?: string;
  "replica.pdb.maxUnavailable"?: string;
  "sentinel.enabled"?: string;
  "sentinel.image.registry"?: string;
  "sentinel.image.repository"?: string;
  "sentinel.image.tag"?: string;
  "sentinel.image.digest"?: string;
  "sentinel.image.pullPolicy"?: string;
  "sentinel.image.pullSecrets"?: string;
  "sentinel.image.debug"?: string;
  "sentinel.masterSet"?: string;
  "sentinel.quorum"?: string;
  "sentinel.getMasterTimeout"?: string;
  "sentinel.automateClusterRecovery"?: string;
  "sentinel.redisShutdownWaitFailover"?: string;
  "sentinel.downAfterMilliseconds"?: string;
  "sentinel.failoverTimeout"?: string;
  "sentinel.parallelSyncs"?: string;
  "sentinel.replicaSyncCheck"?: string;
  "sentinel.configuration"?: string;
  "sentinel.command"?: string;
  "sentinel.args"?: string;
  "sentinel.enableServiceLinks"?: string;
  "sentinel.preExecCmds"?: string;
  "sentinel.extraEnvVars"?: string;
  "sentinel.extraEnvVarsCM"?: string;
  "sentinel.extraEnvVarsSecret"?: string;
  "sentinel.externalMaster.enabled"?: string;
  "sentinel.externalMaster.host"?: string;
  "sentinel.externalMaster.port"?: string;
  "sentinel.containerPorts.sentinel"?: string;
  "sentinel.startupProbe.enabled"?: string;
  "sentinel.startupProbe.initialDelaySeconds"?: string;
  "sentinel.startupProbe.periodSeconds"?: string;
  "sentinel.startupProbe.timeoutSeconds"?: string;
  "sentinel.startupProbe.successThreshold"?: string;
  "sentinel.startupProbe.failureThreshold"?: string;
  "sentinel.livenessProbe.enabled"?: string;
  "sentinel.livenessProbe.initialDelaySeconds"?: string;
  "sentinel.livenessProbe.periodSeconds"?: string;
  "sentinel.livenessProbe.timeoutSeconds"?: string;
  "sentinel.livenessProbe.successThreshold"?: string;
  "sentinel.livenessProbe.failureThreshold"?: string;
  "sentinel.readinessProbe.enabled"?: string;
  "sentinel.readinessProbe.initialDelaySeconds"?: string;
  "sentinel.readinessProbe.periodSeconds"?: string;
  "sentinel.readinessProbe.timeoutSeconds"?: string;
  "sentinel.readinessProbe.successThreshold"?: string;
  "sentinel.readinessProbe.failureThreshold"?: string;
  "sentinel.persistence.enabled"?: string;
  "sentinel.persistence.storageClass"?: string;
  "sentinel.persistence.accessModes"?: string;
  "sentinel.persistence.size"?: string;
  "sentinel.persistence.medium"?: string;
  "sentinel.persistence.sizeLimit"?: string;
  "sentinel.persistentVolumeClaimRetentionPolicy.enabled"?: string;
  "sentinel.persistentVolumeClaimRetentionPolicy.whenScaled"?: string;
  "sentinel.persistentVolumeClaimRetentionPolicy.whenDeleted"?: string;
  "sentinel.resourcesPreset"?: string;
  "sentinel.fips.openssl"?: string;
  "sentinel.containerSecurityContext.enabled"?: string;
  "sentinel.containerSecurityContext.runAsUser"?: string;
  "sentinel.containerSecurityContext.runAsGroup"?: string;
  "sentinel.containerSecurityContext.runAsNonRoot"?: string;
  "sentinel.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "sentinel.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "sentinel.containerSecurityContext.seccompProfile.type"?: string;
  "sentinel.containerSecurityContext.capabilities.drop"?: string;
  "sentinel.extraVolumes"?: string;
  "sentinel.extraVolumeMounts"?: string;
  "sentinel.service.type"?: string;
  "sentinel.service.ports.redis"?: string;
  "sentinel.service.ports.sentinel"?: string;
  "sentinel.service.nodePorts.redis"?: string;
  "sentinel.service.nodePorts.sentinel"?: string;
  "sentinel.service.externalTrafficPolicy"?: string;
  "sentinel.service.extraPorts"?: string;
  "sentinel.service.clusterIP"?: string;
  "sentinel.service.createMaster"?: string;
  "sentinel.service.loadBalancerIP"?: string;
  "sentinel.service.loadBalancerClass"?: string;
  "sentinel.service.loadBalancerSourceRanges"?: string;
  "sentinel.service.sessionAffinity"?: string;
  "sentinel.service.headless.extraPorts"?: string;
  "sentinel.masterService.enabled"?: string;
  "sentinel.masterService.type"?: string;
  "sentinel.masterService.ports.redis"?: string;
  "sentinel.masterService.nodePorts.redis"?: string;
  "sentinel.masterService.externalTrafficPolicy"?: string;
  "sentinel.masterService.extraPorts"?: string;
  "sentinel.masterService.clusterIP"?: string;
  "sentinel.masterService.loadBalancerIP"?: string;
  "sentinel.masterService.loadBalancerClass"?: string;
  "sentinel.masterService.loadBalancerSourceRanges"?: string;
  "sentinel.masterService.sessionAffinity"?: string;
  "sentinel.terminationGracePeriodSeconds"?: string;
  "sentinel.externalAccess.enabled"?: string;
  "sentinel.externalAccess.service.type"?: string;
  "sentinel.externalAccess.service.redisPort"?: string;
  "sentinel.externalAccess.service.sentinelPort"?: string;
  "sentinel.externalAccess.service.loadBalancerIPs"?: string;
  "sentinel.externalAccess.service.loadBalancerClass"?: string;
  "sentinel.externalAccess.service.loadBalancerSourceRanges"?: string;
  "sentinel.externalAccess.service.loadBalancerIPAnnotation"?: string;
  "serviceBindings.enabled"?: string;
  "networkPolicy.enabled"?: string;
  "networkPolicy.allowExternal"?: string;
  "networkPolicy.allowExternalEgress"?: string;
  "networkPolicy.extraIngress"?: string;
  "networkPolicy.extraEgress"?: string;
  "networkPolicy.metrics.allowExternal"?: string;
  "podSecurityPolicy.create"?: string;
  "podSecurityPolicy.enabled"?: string;
  "rbac.create"?: string;
  "rbac.rules"?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "serviceAccount.automountServiceAccountToken"?: string;
  "tls.enabled"?: string;
  "tls.authClients"?: string;
  "tls.autoGenerated"?: string;
  "tls.existingSecret"?: string;
  "tls.certificatesSecret"?: string;
  "tls.certFilename"?: string;
  "tls.certKeyFilename"?: string;
  "tls.certCAFilename"?: string;
  "tls.dhParamsFilename"?: string;
  "metrics.enabled"?: string;
  "metrics.image.registry"?: string;
  "metrics.image.repository"?: string;
  "metrics.image.tag"?: string;
  "metrics.image.digest"?: string;
  "metrics.image.pullPolicy"?: string;
  "metrics.image.pullSecrets"?: string;
  "metrics.containerPorts.http"?: string;
  "metrics.startupProbe.enabled"?: string;
  "metrics.startupProbe.initialDelaySeconds"?: string;
  "metrics.startupProbe.periodSeconds"?: string;
  "metrics.startupProbe.timeoutSeconds"?: string;
  "metrics.startupProbe.successThreshold"?: string;
  "metrics.startupProbe.failureThreshold"?: string;
  "metrics.livenessProbe.enabled"?: string;
  "metrics.livenessProbe.initialDelaySeconds"?: string;
  "metrics.livenessProbe.periodSeconds"?: string;
  "metrics.livenessProbe.timeoutSeconds"?: string;
  "metrics.livenessProbe.successThreshold"?: string;
  "metrics.livenessProbe.failureThreshold"?: string;
  "metrics.readinessProbe.enabled"?: string;
  "metrics.readinessProbe.initialDelaySeconds"?: string;
  "metrics.readinessProbe.periodSeconds"?: string;
  "metrics.readinessProbe.timeoutSeconds"?: string;
  "metrics.readinessProbe.successThreshold"?: string;
  "metrics.readinessProbe.failureThreshold"?: string;
  "metrics.command"?: string;
  "metrics.redisTargetHost"?: string;
  "metrics.extraEnvVars"?: string;
  "metrics.containerSecurityContext.enabled"?: string;
  "metrics.containerSecurityContext.runAsUser"?: string;
  "metrics.containerSecurityContext.runAsGroup"?: string;
  "metrics.containerSecurityContext.runAsNonRoot"?: string;
  "metrics.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "metrics.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "metrics.containerSecurityContext.seccompProfile.type"?: string;
  "metrics.containerSecurityContext.capabilities.drop"?: string;
  "metrics.extraVolumes"?: string;
  "metrics.extraVolumeMounts"?: string;
  "metrics.resourcesPreset"?: string;
  "metrics.fips.openssl"?: string;
  "metrics.fips.golang"?: string;
  "metrics.podAnnotations.prometheus.io/scrape"?: string;
  "metrics.podAnnotations.prometheus.io/port"?: string;
  "metrics.service.enabled"?: string;
  "metrics.service.type"?: string;
  "metrics.service.ports.http"?: string;
  "metrics.service.externalTrafficPolicy"?: string;
  "metrics.service.extraPorts"?: string;
  "metrics.service.loadBalancerIP"?: string;
  "metrics.service.loadBalancerClass"?: string;
  "metrics.service.loadBalancerSourceRanges"?: string;
  "metrics.service.clusterIP"?: string;
  "metrics.serviceMonitor.port"?: string;
  "metrics.serviceMonitor.enabled"?: string;
  "metrics.serviceMonitor.namespace"?: string;
  "metrics.serviceMonitor.interval"?: string;
  "metrics.serviceMonitor.scrapeTimeout"?: string;
  "metrics.serviceMonitor.relabelings"?: string;
  "metrics.serviceMonitor.relabellings"?: string;
  "metrics.serviceMonitor.metricRelabelings"?: string;
  "metrics.serviceMonitor.honorLabels"?: string;
  "metrics.serviceMonitor.podTargetLabels"?: string;
  "metrics.serviceMonitor.sampleLimit"?: string;
  "metrics.serviceMonitor.targetLimit"?: string;
  "metrics.serviceMonitor.additionalEndpoints"?: string;
  "metrics.podMonitor.port"?: string;
  "metrics.podMonitor.enabled"?: string;
  "metrics.podMonitor.namespace"?: string;
  "metrics.podMonitor.interval"?: string;
  "metrics.podMonitor.scrapeTimeout"?: string;
  "metrics.podMonitor.relabelings"?: string;
  "metrics.podMonitor.relabellings"?: string;
  "metrics.podMonitor.metricRelabelings"?: string;
  "metrics.podMonitor.honorLabels"?: string;
  "metrics.podMonitor.podTargetLabels"?: string;
  "metrics.podMonitor.sampleLimit"?: string;
  "metrics.podMonitor.targetLimit"?: string;
  "metrics.podMonitor.additionalEndpoints"?: string;
  "metrics.prometheusRule.enabled"?: string;
  "metrics.prometheusRule.namespace"?: string;
  "metrics.prometheusRule.rules"?: string;
  "volumePermissions.enabled"?: string;
  "volumePermissions.image.registry"?: string;
  "volumePermissions.image.repository"?: string;
  "volumePermissions.image.tag"?: string;
  "volumePermissions.image.digest"?: string;
  "volumePermissions.image.pullPolicy"?: string;
  "volumePermissions.image.pullSecrets"?: string;
  "volumePermissions.resourcesPreset"?: string;
  "volumePermissions.fips.openssl"?: string;
  "volumePermissions.containerSecurityContext.runAsUser"?: string;
  "volumePermissions.extraEnvVars"?: string;
  "kubectl.image.registry"?: string;
  "kubectl.image.repository"?: string;
  "kubectl.image.tag"?: string;
  "kubectl.image.digest"?: string;
  "kubectl.image.pullPolicy"?: string;
  "kubectl.image.pullSecrets"?: string;
  "kubectl.command"?: string;
  "kubectl.containerSecurityContext.enabled"?: string;
  "kubectl.containerSecurityContext.runAsUser"?: string;
  "kubectl.containerSecurityContext.runAsGroup"?: string;
  "kubectl.containerSecurityContext.runAsNonRoot"?: string;
  "kubectl.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "kubectl.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "kubectl.containerSecurityContext.seccompProfile.type"?: string;
  "kubectl.containerSecurityContext.capabilities.drop"?: string;
  "kubectl.fips.openssl"?: string;
  "kubectl.fips.golang"?: string;
  "sysctl.enabled"?: string;
  "sysctl.image.registry"?: string;
  "sysctl.image.repository"?: string;
  "sysctl.image.tag"?: string;
  "sysctl.image.digest"?: string;
  "sysctl.image.pullPolicy"?: string;
  "sysctl.image.pullSecrets"?: string;
  "sysctl.command"?: string;
  "sysctl.mountHostSys"?: string;
  "sysctl.resourcesPreset"?: string;
  "sysctl.fips.openssl"?: string;
  "useExternalDNS.enabled"?: string;
  "useExternalDNS.suffix"?: string;
  "useExternalDNS.annotationKey"?: string;
};
