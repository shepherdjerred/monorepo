// Generated TypeScript types for velero Helm chart

export type VeleroHelmValuesNamespace = {
  /**
   * Enforce Pod Security Standards with Namespace Labels
   * https://kubernetes.io/docs/tasks/configure-pod-container/enforce-standards-namespace-labels/
   * pod-security.kubernetes.io/enforce: privileged
   * pod-security.kubernetes.io/enforce-version: latest
   * pod-security.kubernetes.io/audit: privileged
   * pod-security.kubernetes.io/audit-version: latest
   * pod-security.kubernetes.io/warn: privileged
   * pod-security.kubernetes.io/warn-version: latest
   *
   * @default {}
   */
  labels?: VeleroHelmValuesNamespaceLabels;
};

export type VeleroHelmValuesNamespaceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesImage = {
  /**
   * @default "velero/velero"
   */
  repository?: string;
  /**
   * @default "v1.17.1"
   */
  tag?: string;
  /**
   * Digest value example: sha256:d238835e151cec91c6a811fe3a89a66d3231d9f64d09e5f3c49552672d271f38.
   * If used, it will take precedence over the image.tag.
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * One or more secrets to be used when pulling images
   *
   * @default []
   */
  imagePullSecrets?: unknown[];
};

export type VeleroHelmValuesAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesSecretAnnotations = object;

export type VeleroHelmValuesLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesPodAnnotations = object;

export type VeleroHelmValuesPodLabels = object;

export type VeleroHelmValuesResources = object;

export type VeleroHelmValuesUpgradeJobResources = object;

export type VeleroHelmValuesUpgradeCRDsJob = {
  /**
   * Extra volumes for the Upgrade CRDs Job. Optional.
   *
   * @default []
   */
  extraVolumes?: unknown[];
  /**
   * Extra volumeMounts for the Upgrade CRDs Job. Optional.
   *
   * @default []
   */
  extraVolumeMounts?: unknown[];
  /**
   * Additional values to be used as environment variables. Optional.
   * Simple value
   * FieldRef example
   *
   * @default []
   */
  extraEnvVars?: unknown[];
  /**
   * Configure if API credential for Service Account is automounted.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type VeleroHelmValuesPodSecurityContext = object;

export type VeleroHelmValuesContainerSecurityContext = object;

export type VeleroHelmValuesLifecycle = object;

export type VeleroHelmValuesLivenessProbe = {
  /**
   * @default {"path":"/metrics","port":"http-monitoring","scheme":"HTTP"}
   */
  httpGet?: VeleroHelmValuesLivenessProbeHttpGet;
  /**
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * @default 30
   */
  periodSeconds?: number;
  /**
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 5
   */
  failureThreshold?: number;
};

export type VeleroHelmValuesLivenessProbeHttpGet = {
  /**
   * @default "/metrics"
   */
  path?: string;
  /**
   * @default "http-monitoring"
   */
  port?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type VeleroHelmValuesReadinessProbe = {
  /**
   * @default {"path":"/metrics","port":"http-monitoring","scheme":"HTTP"}
   */
  httpGet?: VeleroHelmValuesReadinessProbeHttpGet;
  /**
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * @default 30
   */
  periodSeconds?: number;
  /**
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 5
   */
  failureThreshold?: number;
};

export type VeleroHelmValuesReadinessProbeHttpGet = {
  /**
   * @default "/metrics"
   */
  path?: string;
  /**
   * @default "http-monitoring"
   */
  port?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type VeleroHelmValuesAffinity = object;

export type VeleroHelmValuesNodeSelector = object;

export type VeleroHelmValuesDnsConfig = object;

export type VeleroHelmValuesMetrics = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "30s"
   */
  scrapeInterval?: string;
  /**
   * @default "10s"
   */
  scrapeTimeout?: string;
  /**
   * service metdata if metrics are enabled
   *
   * @default {...} (8 keys)
   */
  service?: VeleroHelmValuesMetricsService;
  /**
   * Pod annotations for Prometheus
   *
   * @default {"prometheus.io/scrape":"true","prometheus.io/port":"8085","prometheus.io/path":"/metrics"}
   */
  podAnnotations?: VeleroHelmValuesMetricsPodAnnotations;
  /**
   * metrics.serviceMonitor.relabelings [array] Prometheus relabeling rules
   * ServiceMonitor namespace. Default to Velero namespace.
   * ServiceMonitor connection scheme. Defaults to HTTP.
   * ServiceMonitor connection tlsConfig. Defaults to {}.
   *
   * @default {...} (4 keys)
   */
  serviceMonitor?: VeleroHelmValuesMetricsServiceMonitor;
  /**
   * metrics.nodeAgentPodMonitor.relabelings [array] Prometheus relabeling rules
   * PodMonitor namespace. Default to Velero namespace.
   * PodMonitor connection scheme. Defaults to HTTP.
   * PodMonitor connection tlsConfig. Defaults to {}.
   *
   * @default {...} (4 keys)
   */
  nodeAgentPodMonitor?: VeleroHelmValuesMetricsNodeAgentPodMonitor;
  /**
   * @default {...} (4 keys)
   */
  prometheusRule?: VeleroHelmValuesMetricsPrometheusRule;
};

export type VeleroHelmValuesMetricsService = {
  /**
   * @default {}
   */
  annotations?: VeleroHelmValuesMetricsServiceAnnotations;
  /**
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {}
   */
  labels?: VeleroHelmValuesMetricsServiceLabels;
  nodePort?: unknown;
  /**
   * External/Internal traffic policy setting (Cluster, Local)
   * https://kubernetes.io/docs/reference/networking/virtual-ips/#traffic-policies
   *
   * @default ""
   */
  externalTrafficPolicy?: string;
  /**
   * @default ""
   */
  internalTrafficPolicy?: string;
  /**
   * the IP family policy for the metrics Service to be able to configure dual-stack; see [Configure dual-stack](https://kubernetes.io/docs/concepts/services-networking/dual-stack/#services).
   *
   * @default ""
   */
  ipFamilyPolicy?: string;
  ipFamilies?: unknown[];
};

export type VeleroHelmValuesMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesMetricsPodAnnotations = {
  /**
   * @default "true"
   */
  "prometheus.io/scrape"?: string;
  /**
   * @default "8085"
   */
  "prometheus.io/port"?: string;
  /**
   * @default "/metrics"
   */
  "prometheus.io/path"?: string;
};

export type VeleroHelmValuesMetricsServiceMonitor = {
  /**
   * @default true
   */
  autodetect?: boolean;
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  annotations?: VeleroHelmValuesMetricsServiceMonitorAnnotations;
  /**
   * @default {}
   */
  additionalLabels?: VeleroHelmValuesMetricsServiceMonitorAdditionalLabels;
};

export type VeleroHelmValuesMetricsServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesMetricsServiceMonitorAdditionalLabels = object;

export type VeleroHelmValuesMetricsNodeAgentPodMonitor = {
  /**
   * @default true
   */
  autodetect?: boolean;
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  annotations?: VeleroHelmValuesMetricsNodeAgentPodMonitorAnnotations;
  /**
   * @default {}
   */
  additionalLabels?: VeleroHelmValuesMetricsNodeAgentPodMonitorAdditionalLabels;
};

export type VeleroHelmValuesMetricsNodeAgentPodMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesMetricsNodeAgentPodMonitorAdditionalLabels = object;

export type VeleroHelmValuesMetricsPrometheusRule = {
  /**
   * @default true
   */
  autodetect?: boolean;
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional labels to add to deployed PrometheusRule
   *
   * @default {}
   */
  additionalLabels?: VeleroHelmValuesMetricsPrometheusRuleAdditionalLabels;
  /**
   * PrometheusRule namespace. Defaults to Velero namespace.
   * Rules to be deployed
   *
   * @default []
   */
  spec?: unknown[];
};

export type VeleroHelmValuesMetricsPrometheusRuleAdditionalLabels = object;

export type VeleroHelmValuesKubectl = {
  /**
   * Digest value example: sha256:d238835e151cec91c6a811fe3a89a66d3231d9f64d09e5f3c49552672d271f38.
   * If used, it will take precedence over the kubectl.image.tag.
   * Container Level Security Context for the 'kubectl' container of the crd jobs. Optional.
   * See: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container
   *
   * @default {"repository":"docker.io/bitnamilegacy/kubectl"}
   */
  image?: VeleroHelmValuesKubectlImage;
  /**
   * @default {}
   */
  containerSecurityContext?: VeleroHelmValuesKubectlContainerSecurityContext;
  /**
   * Resource requests/limits to specify for the upgrade/cleanup job. Optional
   *
   * @default {}
   */
  resources?: VeleroHelmValuesKubectlResources;
  /**
   * Annotations to set for the upgrade/cleanup job. Optional.
   *
   * @default {}
   */
  annotations?: VeleroHelmValuesKubectlAnnotations;
  /**
   * Labels to set for the upgrade/cleanup job. Optional.
   *
   * @default {}
   */
  labels?: VeleroHelmValuesKubectlLabels;
  /**
   * Extra volumes for the upgrade/cleanup job. Optional.
   *
   * @default []
   */
  extraVolumes?: unknown[];
  /**
   * Extra volumeMounts for the upgrade/cleanup job.. Optional.
   *
   * @default []
   */
  extraVolumeMounts?: unknown[];
};

export type VeleroHelmValuesKubectlImage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "docker.io/bitnamilegacy/kubectl"
   */
  repository?: string;
};

export type VeleroHelmValuesKubectlContainerSecurityContext = object;

export type VeleroHelmValuesKubectlResources = object;

export type VeleroHelmValuesKubectlAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesKubectlLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesConfiguration = {
  /**
   * Parameters for the VolumeSnapshotLocation(s). Configure multiple by adding other element(s) to the volumeSnapshotLocation slice.
   * See https://velero.io/docs/v1.6/api-types/volumesnapshotlocation/
   *
   * @default [{"name":null,"provider":"","bucket":"","caCert":null,"prefix":null,"default":false,"validationFrequency":null,"accessMode":"ReadWrite","credential":{"name":null,"key":null},"config":{},"annotations":{}}]
   */
  backupStorageLocation?: object[];
  /**
   * @default [{"name":null,"provider":"","credential":{"name":null,"key":null},"config":{},"annotations":{}}]
   */
  volumeSnapshotLocation?: object[];
  uploaderType?: unknown;
  backupSyncPeriod?: unknown;
  fsBackupTimeout?: unknown;
  clientBurst?: unknown;
  clientPageSize?: unknown;
  clientQPS?: unknown;
  defaultBackupStorageLocation?: unknown;
  defaultItemOperationTimeout?: unknown;
  defaultBackupTTL?: unknown;
  defaultVolumeSnapshotLocations?: unknown;
  disableControllers?: unknown;
  /**
   * @default false
   */
  disableInformerCache?: boolean;
  garbageCollectionFrequency?: unknown;
  itemBlockWorkerCount?: unknown;
  logFormat?: unknown;
  logLevel?: unknown;
  metricsAddress?: unknown;
  pluginDir?: unknown;
  profilerAddress?: unknown;
  restoreOnlyMode?: unknown;
  restoreResourcePriorities?: unknown;
  storeValidationFrequency?: unknown;
  terminatingResourceTimeout?: unknown;
  defaultSnapshotMoveData?: unknown;
  features?: unknown;
  dataMoverPrepareTimeout?: unknown;
  /**
   * https://velero.io/docs/v1.14/repository-maintenance/#resource-limitation
   *
   * @default {"repositoryConfigData":{"name":"velero-repo-maintenance","global":{"keepLatestMaintenanceJobs":3},"repositories":{}}}
   */
  repositoryMaintenanceJob?: VeleroHelmValuesConfigurationRepositoryMaintenanceJob;
  /**
   * `velero server` default: velero
   * additional command-line arguments that will be passed to the `velero server`
   *
   * @default null
   */
  namespace?: string | null;
  /**
   * e.g.: extraArgs: ["--foo=bar"]
   *
   * @default []
   */
  extraArgs?: unknown[];
  /**
   * Additional values to be used as environment variables. Optional.
   * Simple value
   * FieldRef example
   *
   * @default []
   */
  extraEnvVars?: unknown[];
  defaultVolumesToFsBackup?: unknown;
  defaultRepoMaintainFrequency?: unknown;
};

export type VeleroHelmValuesConfigurationRepositoryMaintenanceJob = {
  /**
   * Per-repository resource settings ConfigMap
   * This ConfigMap allows specifying different settings for different repositories
   * See: https://velero.io/docs/main/repository-maintenance/
   *
   * @default {"name":"velero-repo-maintenance","global":{"keepLatestMaintenanceJobs":3},"repositories":{}}
   */
  repositoryConfigData?: VeleroHelmValuesConfigurationRepositoryMaintenanceJobRepositoryConfigData;
};

export type VeleroHelmValuesConfigurationRepositoryMaintenanceJobRepositoryConfigData = {
  /**
   * Name of the ConfigMap to create. If not provided, will use "velero-repo-maintenance"
   *
   * Name of the ConfigMap to create for per-repository maintenance configuration
   *
   * @default "velero-repo-maintenance"
   */
  name?: string;
  /**
   * Global configuration applied to all repositories when no specific repository configuration is found
   *
   * @default {"keepLatestMaintenanceJobs":3}
   */
  global?: VeleroHelmValuesConfigurationRepositoryMaintenanceJobRepositoryConfigDataGlobal;
  /**
   * Repository-specific configurations
   * Repository keys are formed as: "{namespace}-{storageLocation}-{repositoryType}"
   * For example: "default-default-kopia" or "prod-s3-backup-kopia"
   * Note: priorityClassName is NOT supported in repository-specific configurations
   * "kibishii-default-kopia":
   *
   * Repository-specific configurations keyed by repository identifier (namespace-storageLocation-repositoryType)
   *
   * @default {}
   */
  repositories?: VeleroHelmValuesConfigurationRepositoryMaintenanceJobRepositoryConfigDataRepositories;
};

export type VeleroHelmValuesConfigurationRepositoryMaintenanceJobRepositoryConfigDataGlobal = {
  /**
   * @default 3
   */
  keepLatestMaintenanceJobs?: number;
};

export type VeleroHelmValuesConfigurationRepositoryMaintenanceJobRepositoryConfigDataRepositories = object;

export type VeleroHelmValuesRbac = {
  /**
   * Whether to create the Velero role and role binding to give all permissions to the namespace to Velero.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Whether to create the cluster role binding to give administrator permissions to Velero
   *
   * @default true
   */
  clusterAdministrator?: boolean;
  /**
   * Name of the ClusterRole.
   *
   * @default "cluster-admin"
   */
  clusterAdministratorName?: string;
};

export type VeleroHelmValuesServiceAccount = {
  /**
   * @default {...} (6 keys)
   */
  server?: VeleroHelmValuesServiceAccountServer;
};

export type VeleroHelmValuesServiceAccountServer = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default null
   */
  name?: string | null;
  /**
   * @default null
   */
  annotations?: object | null;
  /**
   * @default null
   */
  labels?: object | null;
  /**
   * @default []
   */
  imagePullSecrets?: string[];
  /**
   * - registrySecretName
   * Configure if API credential for Service Account is automounted.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type VeleroHelmValuesCredentials = {
  /**
   * Whether a secret should be used. Set to false if, for examples:
   * - using kube2iam or kiam to provide AWS IAM credentials instead of providing the key file. (AWS only)
   * - using workload identity instead of providing the key file. (Azure/GCP only)
   *
   * @default true
   */
  useSecret?: boolean;
  /**
   * Name of the secret to create if `useSecret` is true and `existingSecret` is empty
   * Name of a pre-existing secret (if any) in the Velero namespace
   *
   * @default null
   */
  name?: string | null;
  /**
   * that should be used to get IAM account credentials. Optional.
   * Data to be stored in the Velero secret, if `useSecret` is true and `existingSecret` is empty.
   *
   * @default null
   */
  existingSecret?: string | null;
  /**
   * As of the current Velero release, Velero only uses one secret key/value at a time.
   * The key must be named `cloud`, and the value corresponds to the entire content of your IAM credentials file.
   * Note that the format will be different for different providers, please check their documentation.
   * Here is a list of documentation for plugins maintained by the Velero team:
   * [AWS] https://github.com/vmware-tanzu/velero-plugin-for-aws/blob/main/README.md
   * [GCP] https://github.com/vmware-tanzu/velero-plugin-for-gcp/blob/main/README.md
   * [Azure] https://github.com/vmware-tanzu/velero-plugin-for-microsoft-azure/blob/main/README.md
   *
   * @default {}
   */
  secretContents?: VeleroHelmValuesCredentialsSecretContents;
  /**
   * [default]
   * aws_access_key_id=<REDACTED>
   * aws_secret_access_key=<REDACTED>
   * additional key/value pairs to be used as environment variables such as "DIGITALOCEAN_TOKEN: <your-key>". Values will be stored in the secret.
   *
   * @default {}
   */
  extraEnvVars?: VeleroHelmValuesCredentialsExtraEnvVars;
  /**
   * Name of a pre-existing secret (if any) in the Velero namespace
   * that will be used to load environment variables into velero and node-agent.
   * Secret should be in format - https://kubernetes.io/docs/concepts/configuration/secret/#use-case-as-container-environment-variables
   *
   * @default ""
   */
  extraSecretRef?: string;
};

export type VeleroHelmValuesCredentialsSecretContents = object;

export type VeleroHelmValuesCredentialsExtraEnvVars = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesNodeAgent = {
  /**
   * Disables Host Path volumes for node-agent.
   *
   * @default false
   */
  disableHostPath?: boolean;
  /**
   * @default "/var/lib/kubelet/pods"
   */
  podVolumePath?: string;
  /**
   * @default "/var/lib/kubelet/plugins"
   */
  pluginVolumePath?: string;
  /**
   * Pod priority class name to use for the node-agent daemonset. Optional.
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Pod runtime class name to use for the node-agent daemonset. Optional.
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * Resource requests/limits to specify for the node-agent daemonset deployment. Optional.
   * https://velero.io/docs/v1.6/customize-installation/#customize-resource-requests-and-limits
   *
   * @default {}
   */
  resources?: VeleroHelmValuesNodeAgentResources;
  resizePolicy?: unknown[];
  /**
   * Tolerations to use for the node-agent daemonset. Optional.
   *
   * @default []
   */
  tolerations?: unknown[];
  /**
   * Annotations to set for the node-agent daemonset. Optional.
   *
   * @default {}
   */
  annotations?: VeleroHelmValuesNodeAgentAnnotations;
  /**
   * labels to set for the node-agent daemonset. Optional.
   *
   * @default {}
   */
  labels?: VeleroHelmValuesNodeAgentLabels;
  /**
   * Additional pod labels for the node-agent daemonset. Optional
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * @default {}
   */
  podLabels?: VeleroHelmValuesNodeAgentPodLabels;
  /**
   * will map /scratch to emptyDir. Set to false and specify your own volume
   * via extraVolumes and extraVolumeMounts that maps to /scratch
   * if you don't want to use emptyDir.
   *
   * @default true
   */
  useScratchEmptyDir?: boolean;
  /**
   * Extra volumes for the node-agent daemonset. Optional.
   *
   * @default []
   */
  extraVolumes?: unknown[];
  /**
   * Extra volumeMounts for the node-agent daemonset. Optional.
   *
   * @default []
   */
  extraVolumeMounts?: unknown[];
  /**
   * Additional values to be used as environment variables for node-agent daemonset. Optional.
   * Simple key/value
   * FieldRef example
   *
   * @default []
   */
  extraEnvVars?: unknown[];
  /**
   * Additional command-line arguments that will be passed to the node-agent. Optional.
   * e.g.: extraArgs: ["--foo=bar"]
   *
   * @default []
   */
  extraArgs?: unknown[];
  /**
   * Configure the dnsPolicy of the node-agent daemonset
   * See: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-s-dns-policy
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  hostAliases?: unknown[];
  /**
   * SecurityContext to use for the Velero deployment. Optional.
   * Set fsGroup for `AWS IAM Roles for Service Accounts`
   * see more informations at: https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html
   *
   * @default {"runAsUser":0}
   */
  podSecurityContext?: VeleroHelmValuesNodeAgentPodSecurityContext;
  /**
   * Container Level Security Context for the 'node-agent' container of the node-agent daemonset. Optional.
   * See: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container
   *
   * @default {}
   */
  containerSecurityContext?: VeleroHelmValuesNodeAgentContainerSecurityContext;
  /**
   * Container Lifecycle Hooks to use for the node-agent daemonset. Optional.
   *
   * @default {}
   */
  lifecycle?: VeleroHelmValuesNodeAgentLifecycle;
  /**
   * Node selector to use for the node-agent daemonset. Optional.
   *
   * @default {}
   */
  nodeSelector?: VeleroHelmValuesNodeAgentNodeSelector;
  /**
   * Affinity to use with node-agent daemonset. Optional.
   *
   * @default {}
   */
  affinity?: VeleroHelmValuesNodeAgentAffinity;
  /**
   * DNS configuration to use for the node-agent daemonset. Optional.
   *
   * @default {}
   */
  dnsConfig?: VeleroHelmValuesNodeAgentDnsConfig;
  /**
   * Update strategy to use for the node-agent daemonset. Optional.
   *
   * @default {}
   */
  updateStrategy?: VeleroHelmValuesNodeAgentUpdateStrategy;
};

export type VeleroHelmValuesNodeAgentResources = object;

export type VeleroHelmValuesNodeAgentAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesNodeAgentLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type VeleroHelmValuesNodeAgentPodLabels = object;

export type VeleroHelmValuesNodeAgentPodSecurityContext = {
  /**
   * @default 0
   */
  runAsUser?: number;
};

export type VeleroHelmValuesNodeAgentContainerSecurityContext = object;

export type VeleroHelmValuesNodeAgentLifecycle = object;

export type VeleroHelmValuesNodeAgentNodeSelector = object;

export type VeleroHelmValuesNodeAgentAffinity = object;

export type VeleroHelmValuesNodeAgentDnsConfig = object;

export type VeleroHelmValuesNodeAgentUpdateStrategy = object;

export type VeleroHelmValuesSchedules = object;

export type VeleroHelmValuesConfigMaps = object;

export type VeleroHelmValues = {
  /**
   * Configuration settings related to Velero installation namespace
   * Labels settings in namespace
   *
   * @default {"labels":{}}
   */
  namespace?: VeleroHelmValuesNamespace;
  /**
   * End of namespace-related settings.
   * Configuration settings that directly affect the Velero deployment YAML.
   * Details of the container image to use in the Velero deployment & daemonset (if
   * enabling node-agent). Required.
   * - registrySecretName
   *
   * @default {...} (4 keys)
   */
  image?: VeleroHelmValuesImage;
  /**
   * - registrySecretName
   *
   * @default ""
   */
  nameOverride?: string;
  /**
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * Annotations to add to the Velero deployment's. Optional.
   * If you are using reloader use the following annotation with your VELERO_SECRET_NAME
   *
   * @default {}
   */
  annotations?: VeleroHelmValuesAnnotations;
  /**
   * secret.reloader.stakater.com/reload: "<VELERO_SECRET_NAME>"
   * Annotations to add to secret
   *
   * @default {}
   */
  secretAnnotations?: VeleroHelmValuesSecretAnnotations;
  /**
   * Labels to add to the Velero deployment's. Optional.
   *
   * @default {}
   */
  labels?: VeleroHelmValuesLabels;
  /**
   * Annotations to add to the Velero deployment's pod template. Optional.
   * If using kube2iam or kiam, use the following annotation with your AWS_ACCOUNT_ID
   * and VELERO_ROLE_NAME filled in:
   * iam.amazonaws.com/role: "arn:aws:iam::<AWS_ACCOUNT_ID>:role/<VELERO_ROLE_NAME>"
   *
   * @default {}
   */
  podAnnotations?: VeleroHelmValuesPodAnnotations;
  /**
   * Additional pod labels for Velero deployment's template. Optional
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * @default {}
   */
  podLabels?: VeleroHelmValuesPodLabels;
  /**
   * Number of old history to retain to allow rollback (If not set, default Kubernetes value is set to 10)
   * Resource requests/limits to specify for the Velero deployment.
   * https://velero.io/docs/v1.6/customize-installation/#customize-resource-requests-and-limits
   *
   * @default {}
   */
  resources?: VeleroHelmValuesResources;
  resizePolicy?: unknown[];
  hostAliases?: unknown[];
  /**
   * Resource requests/limits to specify for the upgradeCRDs job pod. Need to be adjusted by user accordingly.
   *
   * @default {}
   */
  upgradeJobResources?: VeleroHelmValuesUpgradeJobResources;
  /**
   * @default {...} (4 keys)
   */
  upgradeCRDsJob?: VeleroHelmValuesUpgradeCRDsJob;
  /**
   * Configure the dnsPolicy of the Velero deployment
   * See: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-s-dns-policy
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Init containers to add to the Velero deployment's pod spec. At least one plugin provider image is required.
   * If the value is a string then it is evaluated as a template.
   *
   * @default null
   */
  initContainers?: unknown[] | string | null;
  /**
   * SecurityContext to use for the Velero deployment. Optional.
   * Set fsGroup for `AWS IAM Roles for Service Accounts`
   * see more informations at: https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html
   *
   * @default {}
   */
  podSecurityContext?: VeleroHelmValuesPodSecurityContext;
  /**
   * Container Level Security Context for the 'velero' container of the Velero deployment. Optional.
   * See: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container
   *
   * @default {}
   */
  containerSecurityContext?: VeleroHelmValuesContainerSecurityContext;
  /**
   * Container Lifecycle Hooks to use for the Velero deployment. Optional.
   *
   * @default {}
   */
  lifecycle?: VeleroHelmValuesLifecycle;
  /**
   * Pod priority class name to use for the Velero deployment. Optional.
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Pod runtime class name to use for the Velero deployment. Optional.
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * The number of seconds to allow for graceful termination of the pod. Optional.
   *
   * @default 3600
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Liveness probe of the pod
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: VeleroHelmValuesLivenessProbe;
  /**
   * Readiness probe of the pod
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: VeleroHelmValuesReadinessProbe;
  /**
   * Tolerations to use for the Velero deployment. Optional.
   *
   * @default []
   */
  tolerations?: unknown[];
  /**
   * Affinity to use for the Velero deployment. Optional.
   *
   * @default {}
   */
  affinity?: VeleroHelmValuesAffinity;
  /**
   * Node selector to use for the Velero deployment. Optional.
   *
   * @default {}
   */
  nodeSelector?: VeleroHelmValuesNodeSelector;
  /**
   * DNS configuration to use for the Velero deployment. Optional.
   *
   * @default {}
   */
  dnsConfig?: VeleroHelmValuesDnsConfig;
  /**
   * Extra volumes for the Velero deployment. Optional.
   *
   * @default []
   */
  extraVolumes?: unknown[];
  /**
   * Extra volumeMounts for the Velero deployment. Optional.
   *
   * @default []
   */
  extraVolumeMounts?: unknown[];
  /**
   * Extra K8s manifests to deploy
   *
   * @default []
   */
  extraObjects?: unknown[];
  /**
   * @default {...} (8 keys)
   */
  metrics?: VeleroHelmValuesMetrics;
  /**
   * @default {...} (7 keys)
   */
  kubectl?: VeleroHelmValuesKubectl;
  /**
   * This job upgrades the CRDs.
   *
   * @default true
   */
  upgradeCRDs?: boolean;
  /**
   * This job is meant primarily for cleaning up CRDs on CI systems.
   * Using this on production systems, especially those that have multiple releases of Velero, will be destructive.
   *
   * @default false
   */
  cleanUpCRDs?: boolean;
  /**
   * End of deployment-related settings.
   * Parameters for the `default` BackupStorageLocation and VolumeSnapshotLocation,
   * and additional server settings.
   *
   * @default {...} (34 keys)
   */
  configuration?: VeleroHelmValuesConfiguration;
  /**
   * @default {"create":true,"clusterAdministrator":true,"clusterAdministratorName":"cluster-admin"}
   */
  rbac?: VeleroHelmValuesRbac;
  /**
   * Information about the Kubernetes service account Velero uses.
   *
   * @default {"server":{"create":true,"name":null,"annotations":null,"labels":null,"imagePullSecrets":[],"automountServiceAccountToken":true}}
   */
  serviceAccount?: VeleroHelmValuesServiceAccount;
  /**
   * Info about the secret to be used by the Velero deployment, which
   * should contain credentials for the cloud provider IAM account you've
   * set up for Velero.
   *
   * @default {...} (6 keys)
   */
  credentials?: VeleroHelmValuesCredentials;
  /**
   * Whether to create backupstoragelocation crd, if false => do not create a default backup location
   *
   * @default true
   */
  backupsEnabled?: boolean;
  /**
   * Whether to create volumesnapshotlocation crd, if false => disable snapshot feature
   *
   * @default true
   */
  snapshotsEnabled?: boolean;
  /**
   * Whether to deploy the node-agent daemonset.
   *
   * @default false
   */
  deployNodeAgent?: boolean;
  /**
   * @default {...} (25 keys)
   */
  nodeAgent?: VeleroHelmValuesNodeAgent;
  /**
   * Backup schedules to create.
   * See: https://velero.io/docs/v1.14/resource-filtering/#excludes
   *
   * @default {}
   */
  schedules?: VeleroHelmValuesSchedules;
  /**
   * Velero ConfigMaps.
   * See: https://velero.io/docs/v1.11/file-system-backup/
   *
   * @default {}
   */
  configMaps?: VeleroHelmValuesConfigMaps;
};

export type VeleroHelmParameters = {
  "image.repository"?: string;
  "image.tag"?: string;
  "image.pullPolicy"?: string;
  "image.imagePullSecrets"?: string;
  nameOverride?: string;
  fullnameOverride?: string;
  resizePolicy?: string;
  hostAliases?: string;
  "upgradeCRDsJob.extraVolumes"?: string;
  "upgradeCRDsJob.extraVolumeMounts"?: string;
  "upgradeCRDsJob.extraEnvVars"?: string;
  "upgradeCRDsJob.automountServiceAccountToken"?: string;
  dnsPolicy?: string;
  initContainers?: string;
  priorityClassName?: string;
  runtimeClassName?: string;
  terminationGracePeriodSeconds?: string;
  "livenessProbe.httpGet.path"?: string;
  "livenessProbe.httpGet.port"?: string;
  "livenessProbe.httpGet.scheme"?: string;
  "livenessProbe.initialDelaySeconds"?: string;
  "livenessProbe.periodSeconds"?: string;
  "livenessProbe.timeoutSeconds"?: string;
  "livenessProbe.successThreshold"?: string;
  "livenessProbe.failureThreshold"?: string;
  "readinessProbe.httpGet.path"?: string;
  "readinessProbe.httpGet.port"?: string;
  "readinessProbe.httpGet.scheme"?: string;
  "readinessProbe.initialDelaySeconds"?: string;
  "readinessProbe.periodSeconds"?: string;
  "readinessProbe.timeoutSeconds"?: string;
  "readinessProbe.successThreshold"?: string;
  "readinessProbe.failureThreshold"?: string;
  tolerations?: string;
  extraVolumes?: string;
  extraVolumeMounts?: string;
  extraObjects?: string;
  "metrics.enabled"?: string;
  "metrics.scrapeInterval"?: string;
  "metrics.scrapeTimeout"?: string;
  "metrics.service.type"?: string;
  "metrics.service.nodePort"?: string;
  "metrics.service.externalTrafficPolicy"?: string;
  "metrics.service.internalTrafficPolicy"?: string;
  "metrics.service.ipFamilyPolicy"?: string;
  "metrics.service.ipFamilies"?: string;
  "metrics.podAnnotations.prometheus.io/scrape"?: string;
  "metrics.podAnnotations.prometheus.io/port"?: string;
  "metrics.podAnnotations.prometheus.io/path"?: string;
  "metrics.serviceMonitor.autodetect"?: string;
  "metrics.serviceMonitor.enabled"?: string;
  "metrics.nodeAgentPodMonitor.autodetect"?: string;
  "metrics.nodeAgentPodMonitor.enabled"?: string;
  "metrics.prometheusRule.autodetect"?: string;
  "metrics.prometheusRule.enabled"?: string;
  "metrics.prometheusRule.spec"?: string;
  "kubectl.image.repository"?: string;
  "kubectl.extraVolumes"?: string;
  "kubectl.extraVolumeMounts"?: string;
  upgradeCRDs?: string;
  cleanUpCRDs?: string;
  "configuration.backupStorageLocation"?: string;
  "configuration.volumeSnapshotLocation"?: string;
  "configuration.uploaderType"?: string;
  "configuration.backupSyncPeriod"?: string;
  "configuration.fsBackupTimeout"?: string;
  "configuration.clientBurst"?: string;
  "configuration.clientPageSize"?: string;
  "configuration.clientQPS"?: string;
  "configuration.defaultBackupStorageLocation"?: string;
  "configuration.defaultItemOperationTimeout"?: string;
  "configuration.defaultBackupTTL"?: string;
  "configuration.defaultVolumeSnapshotLocations"?: string;
  "configuration.disableControllers"?: string;
  "configuration.disableInformerCache"?: string;
  "configuration.garbageCollectionFrequency"?: string;
  "configuration.itemBlockWorkerCount"?: string;
  "configuration.logFormat"?: string;
  "configuration.logLevel"?: string;
  "configuration.metricsAddress"?: string;
  "configuration.pluginDir"?: string;
  "configuration.profilerAddress"?: string;
  "configuration.restoreOnlyMode"?: string;
  "configuration.restoreResourcePriorities"?: string;
  "configuration.storeValidationFrequency"?: string;
  "configuration.terminatingResourceTimeout"?: string;
  "configuration.defaultSnapshotMoveData"?: string;
  "configuration.features"?: string;
  "configuration.dataMoverPrepareTimeout"?: string;
  "configuration.repositoryMaintenanceJob.repositoryConfigData.name"?: string;
  "configuration.repositoryMaintenanceJob.repositoryConfigData.global.keepLatestMaintenanceJobs"?: string;
  "configuration.namespace"?: string;
  "configuration.extraArgs"?: string;
  "configuration.extraEnvVars"?: string;
  "configuration.defaultVolumesToFsBackup"?: string;
  "configuration.defaultRepoMaintainFrequency"?: string;
  "rbac.create"?: string;
  "rbac.clusterAdministrator"?: string;
  "rbac.clusterAdministratorName"?: string;
  "serviceAccount.server.create"?: string;
  "serviceAccount.server.name"?: string;
  "serviceAccount.server.annotations"?: string;
  "serviceAccount.server.labels"?: string;
  "serviceAccount.server.imagePullSecrets"?: string;
  "serviceAccount.server.automountServiceAccountToken"?: string;
  "credentials.useSecret"?: string;
  "credentials.name"?: string;
  "credentials.existingSecret"?: string;
  "credentials.extraSecretRef"?: string;
  backupsEnabled?: string;
  snapshotsEnabled?: string;
  deployNodeAgent?: string;
  "nodeAgent.disableHostPath"?: string;
  "nodeAgent.podVolumePath"?: string;
  "nodeAgent.pluginVolumePath"?: string;
  "nodeAgent.priorityClassName"?: string;
  "nodeAgent.runtimeClassName"?: string;
  "nodeAgent.resizePolicy"?: string;
  "nodeAgent.tolerations"?: string;
  "nodeAgent.useScratchEmptyDir"?: string;
  "nodeAgent.extraVolumes"?: string;
  "nodeAgent.extraVolumeMounts"?: string;
  "nodeAgent.extraEnvVars"?: string;
  "nodeAgent.extraArgs"?: string;
  "nodeAgent.dnsPolicy"?: string;
  "nodeAgent.hostAliases"?: string;
  "nodeAgent.podSecurityContext.runAsUser"?: string;
};
