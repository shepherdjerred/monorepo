// Generated TypeScript types for kyverno Helm chart

export type KyvernoHelmValuesTemplating = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default false
   */
  debug?: boolean;
  version?: unknown;
};

export type KyvernoHelmValuesGlobal = {
  /**
   * @default {"registry":null}
   */
  image?: KyvernoHelmValuesGlobalImage;
  imagePullSecrets?: unknown[];
  /**
   * Resync period for informers
   *
   * @default "15m"
   */
  resyncPeriod?: string;
  /**
   * @default {"data":null,"volume":{}}
   */
  caCertificates?: KyvernoHelmValuesGlobalCaCertificates;
  extraEnvVars?: unknown[];
  /**
   * Global node labels for pod assignment. Non-global values will override the global value.
   *
   * @default {}
   */
  nodeSelector?: KyvernoHelmValuesGlobalNodeSelector;
  tolerations?: unknown[];
};

export type KyvernoHelmValuesGlobalImage = {
  registry?: unknown;
};

export type KyvernoHelmValuesGlobalCaCertificates = {
  data?: unknown;
  /**
   * Global value to set single volume to be mounted for CA certificates for all deployments.
   * Not used when `.Values.global.caCertificates.data` is defined
   * Individual  controller values will override this global value
   *
   * @default {}
   */
  volume?: KyvernoHelmValuesGlobalCaCertificatesVolume;
};

export type KyvernoHelmValuesGlobalCaCertificatesVolume = object;

export type KyvernoHelmValuesGlobalNodeSelector = object;

export type KyvernoHelmValuesUpgrade = {
  /**
   * Upgrading from v2 to v3 is not allowed by default, set this to true once changes have been reviewed.
   *
   * @default false
   */
  fromV2?: boolean;
};

export type KyvernoHelmValuesApiVersionOverride = {
  podDisruptionBudget?: unknown;
};

export type KyvernoHelmValuesCrds = {
  /**
   * Whether to have Helm install the Kyverno CRDs, if the CRDs are not installed by Helm, they must be added before policies can be created
   *
   * @default true
   */
  install?: boolean;
  /**
   * @default {"kyverno":{"cleanuppolicies":true,"clustercleanuppolicies":true,"clusterpolicies":true,"globalcontextentries":true,"policies":true,"policyexceptions":true,"updaterequests":true},"reports":{"clusterephemeralreports":true,"ephemeralreports":true},"wgpolicyk8s":{"clusterpolicyreports":true,"policyreports":true}}
   */
  groups?: KyvernoHelmValuesCrdsGroups;
  /**
   * Additional CRDs annotations
   * argocd.argoproj.io/sync-options: Replace=true
   * strategy.spinnaker.io/replace: 'true'
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesCrdsAnnotations;
  /**
   * Additional CRDs labels
   *
   * @default {}
   */
  customLabels?: KyvernoHelmValuesCrdsCustomLabels;
  /**
   * @default {...} (13 keys)
   */
  migration?: KyvernoHelmValuesCrdsMigration;
};

export type KyvernoHelmValuesCrdsGroups = {
  /**
   * Install CRDs in group `kyverno.io`
   *
   * @default {...} (7 keys)
   */
  kyverno?: KyvernoHelmValuesCrdsGroupsKyverno;
  /**
   * Install CRDs in group `reports.kyverno.io`
   *
   * @default {"clusterephemeralreports":true,"ephemeralreports":true}
   */
  reports?: KyvernoHelmValuesCrdsGroupsReports;
  /**
   * Install CRDs in group `wgpolicyk8s.io`
   *
   * @default {"clusterpolicyreports":true,"policyreports":true}
   */
  wgpolicyk8s?: KyvernoHelmValuesCrdsGroupsWgpolicyk8s;
};

export type KyvernoHelmValuesCrdsGroupsKyverno = {
  /**
   * @default true
   */
  cleanuppolicies?: boolean;
  /**
   * @default true
   */
  clustercleanuppolicies?: boolean;
  /**
   * @default true
   */
  clusterpolicies?: boolean;
  /**
   * @default true
   */
  globalcontextentries?: boolean;
  /**
   * @default true
   */
  policies?: boolean;
  /**
   * @default true
   */
  policyexceptions?: boolean;
  /**
   * @default true
   */
  updaterequests?: boolean;
};

export type KyvernoHelmValuesCrdsGroupsReports = {
  /**
   * @default true
   */
  clusterephemeralreports?: boolean;
  /**
   * @default true
   */
  ephemeralreports?: boolean;
};

export type KyvernoHelmValuesCrdsGroupsWgpolicyk8s = {
  /**
   * @default true
   */
  clusterpolicyreports?: boolean;
  /**
   * @default true
   */
  policyreports?: boolean;
};

export type KyvernoHelmValuesCrdsAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesCrdsCustomLabels = object;

export type KyvernoHelmValuesCrdsMigration = {
  /**
   * Enable CRDs migration using helm post upgrade hook
   *
   * @default true
   */
  enabled?: boolean;
  resources?: string[];
  /**
   * @default {...} (5 keys)
   */
  image?: KyvernoHelmValuesCrdsMigrationImage;
  imagePullSecrets?: unknown[];
  /**
   * Security context for the pod
   *
   * @default {}
   */
  podSecurityContext?: KyvernoHelmValuesCrdsMigrationPodSecurityContext;
  /**
   * Node labels for pod assignment
   *
   * @default {}
   */
  nodeSelector?: KyvernoHelmValuesCrdsMigrationNodeSelector;
  tolerations?: unknown[];
  /**
   * Pod anti affinity constraints.
   *
   * @default {}
   */
  podAntiAffinity?: KyvernoHelmValuesCrdsMigrationPodAntiAffinity;
  /**
   * Pod affinity constraints.
   *
   * @default {}
   */
  podAffinity?: KyvernoHelmValuesCrdsMigrationPodAffinity;
  /**
   * Pod labels.
   *
   * @default {}
   */
  podLabels?: KyvernoHelmValuesCrdsMigrationPodLabels;
  /**
   * Pod annotations.
   *
   * @default {}
   */
  podAnnotations?: KyvernoHelmValuesCrdsMigrationPodAnnotations;
  /**
   * Node affinity constraints.
   *
   * @default {}
   */
  nodeAffinity?: KyvernoHelmValuesCrdsMigrationNodeAffinity;
  /**
   * Security context for the hook containers
   *
   * @default {...} (8 keys)
   */
  securityContext?: KyvernoHelmValuesCrdsMigrationSecurityContext;
};

export type KyvernoHelmValuesCrdsMigrationImage = {
  registry?: unknown;
  /**
   * @default "ghcr.io"
   */
  defaultRegistry?: string;
  /**
   * (string) Image repository
   *
   * @default "kyverno/kyverno-cli"
   */
  repository?: string;
  tag?: unknown;
  /**
   * (string) Image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KyvernoHelmValuesCrdsMigrationPodSecurityContext = object;

export type KyvernoHelmValuesCrdsMigrationNodeSelector = object;

export type KyvernoHelmValuesCrdsMigrationPodAntiAffinity = object;

export type KyvernoHelmValuesCrdsMigrationPodAffinity = object;

export type KyvernoHelmValuesCrdsMigrationPodLabels = object;

export type KyvernoHelmValuesCrdsMigrationPodAnnotations = object;

export type KyvernoHelmValuesCrdsMigrationNodeAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesCrdsMigrationSecurityContext = {
  /**
   * @default 65534
   */
  runAsUser?: number;
  /**
   * @default 65534
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  privileged?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KyvernoHelmValuesCrdsMigrationSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KyvernoHelmValuesCrdsMigrationSecurityContextSeccompProfile;
};

export type KyvernoHelmValuesCrdsMigrationSecurityContextCapabilities = {
  drop?: string[];
};

export type KyvernoHelmValuesCrdsMigrationSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KyvernoHelmValuesConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Create the configmap.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Preserve the configmap settings during upgrade.
   *
   * @default true
   */
  preserve?: boolean;
  name?: unknown;
  /**
   * Additional annotations to add to the configmap.
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesConfigAnnotations;
  /**
   * Enable registry mutation for container images. Enabled by default.
   *
   * @default true
   */
  enableDefaultRegistryMutation?: boolean;
  /**
   * The registry hostname used for the image mutation.
   *
   * @default "docker.io"
   */
  defaultRegistry?: string;
  excludeGroups?: string[];
  excludeUsernames?: unknown[];
  excludeRoles?: unknown[];
  excludeClusterRoles?: unknown[];
  /**
   * Generate success events.
   *
   * @default false
   */
  generateSuccessEvents?: boolean;
  resourceFilters?: string[];
  /**
   * Sets the threshold for the total number of UpdateRequests generated for mutateExisitng and generate policies.
   *
   * @default 1000
   */
  updateRequestThreshold?: number;
  /**
   * Defines the `namespaceSelector`/`objectSelector` in the webhook configurations.
   * The Kyverno namespace is excluded if `excludeKyvernoNamespace` is `true` (default)
   * Exclude objects
   * Defines annotations to set on webhook configurations.
   *
   * @default {"namespaceSelector":{"matchExpressions":[{"key":"kubernetes.io/metadata.name","operator":"NotIn","values":["kube-system"]}]}}
   */
  webhooks?: KyvernoHelmValuesConfigWebhooks;
  /**
   * @default {"admissions.enforcer/disabled":"true"}
   */
  webhookAnnotations?: KyvernoHelmValuesConfigWebhookAnnotations;
  /**
   * Defines labels to set on webhook configurations.
   * Example to adopt webhook resources in ArgoCD:
   * 'argocd.argoproj.io/instance': 'kyverno'
   *
   * @default {}
   */
  webhookLabels?: KyvernoHelmValuesConfigWebhookLabels;
  matchConditions?: unknown[];
  /**
   * Exclude Kyverno namespace
   * Determines if default Kyverno namespace exclusion is enabled for webhooks and resourceFilters
   *
   * @default true
   */
  excludeKyvernoNamespace?: boolean;
  resourceFiltersExcludeNamespaces?: unknown[];
  resourceFiltersExclude?: unknown[];
  resourceFiltersIncludeNamespaces?: unknown[];
  resourceFiltersInclude?: unknown[];
};

export type KyvernoHelmValuesConfigAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesConfigWebhooks = {
  /**
   * Exclude namespaces
   *
   * @default {"matchExpressions":[{"key":"kubernetes.io/metadata.name","operator":"NotIn","values":["kube-system"]}]}
   */
  namespaceSelector?: KyvernoHelmValuesConfigWebhooksNamespaceSelector;
};

export type KyvernoHelmValuesConfigWebhooksNamespaceSelector = {
  matchExpressions?: KyvernoHelmValuesConfigWebhooksNamespaceSelectorMatchExpressionsElement[];
};

export type KyvernoHelmValuesConfigWebhooksNamespaceSelectorMatchExpressionsElement = {
  /**
   * @default "kubernetes.io/metadata.name"
   */
  key?: string;
  /**
   * @default "NotIn"
   */
  operator?: string;
  values?: string[];
};

export type KyvernoHelmValuesConfigWebhookAnnotations = {
  /**
   * Example to disable admission enforcer on AKS:
   *
   * @default "true"
   */
  "admissions.enforcer/disabled"?: boolean;
};

export type KyvernoHelmValuesConfigWebhookLabels = object;

export type KyvernoHelmValuesMetricsConfig = {
  /**
   * Create the configmap.
   *
   * @default true
   */
  create?: boolean;
  name?: unknown;
  /**
   * Additional annotations to add to the configmap.
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesMetricsConfigAnnotations;
  /**
   * @default {"include":[],"exclude":[]}
   */
  namespaces?: KyvernoHelmValuesMetricsConfigNamespaces;
  metricsRefreshInterval?: unknown;
  bucketBoundaries?: number[];
  /**
   * (map) Configures the exposure of individual metrics, by default all metrics and all labels are exported, changing this configuration requires restart of the kyverno admission controller
   *
   * @default {...} (6 keys)
   */
  metricsExposure?: KyvernoHelmValuesMetricsConfigMetricsExposure;
};

export type KyvernoHelmValuesMetricsConfigAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesMetricsConfigNamespaces = {
  include?: unknown[];
  exclude?: unknown[];
};

export type KyvernoHelmValuesMetricsConfigMetricsExposure = {
  /**
   * @default {"disabledLabelDimensions":["resource_namespace","resource_request_operation"]}
   */
  kyverno_policy_execution_duration_seconds?: KyvernoHelmValuesMetricsConfigMetricsExposureKyvernopolicyexecutiondurationseconds;
  /**
   * @default {"disabledLabelDimensions":["resource_namespace"]}
   */
  kyverno_admission_review_duration_seconds?: KyvernoHelmValuesMetricsConfigMetricsExposureKyvernoadmissionreviewdurationseconds;
  /**
   * @default {"disabledLabelDimensions":["resource_namespace","policy_namespace"]}
   */
  kyverno_policy_rule_info_total?: KyvernoHelmValuesMetricsConfigMetricsExposureKyvernopolicyruleinfototal;
  /**
   * @default {"disabledLabelDimensions":["resource_namespace","policy_namespace"]}
   */
  kyverno_policy_results_total?: KyvernoHelmValuesMetricsConfigMetricsExposureKyvernopolicyresultstotal;
  /**
   * @default {"disabledLabelDimensions":["resource_namespace"]}
   */
  kyverno_admission_requests_total?: KyvernoHelmValuesMetricsConfigMetricsExposureKyvernoadmissionrequeststotal;
  /**
   * @default {"disabledLabelDimensions":["resource_namespace","policy_namespace"]}
   */
  kyverno_cleanup_controller_deletedobjects_total?: KyvernoHelmValuesMetricsConfigMetricsExposureKyvernocleanupcontrollerdeletedobjectstotal;
};

export type KyvernoHelmValuesMetricsConfigMetricsExposureKyvernopolicyexecutiondurationseconds = {
  disabledLabelDimensions?: string[];
};

export type KyvernoHelmValuesMetricsConfigMetricsExposureKyvernoadmissionreviewdurationseconds = {
  disabledLabelDimensions?: string[];
};

export type KyvernoHelmValuesMetricsConfigMetricsExposureKyvernopolicyruleinfototal = {
  disabledLabelDimensions?: string[];
};

export type KyvernoHelmValuesMetricsConfigMetricsExposureKyvernopolicyresultstotal = {
  disabledLabelDimensions?: string[];
};

export type KyvernoHelmValuesMetricsConfigMetricsExposureKyvernoadmissionrequeststotal = {
  disabledLabelDimensions?: string[];
};

export type KyvernoHelmValuesMetricsConfigMetricsExposureKyvernocleanupcontrollerdeletedobjectstotal = {
  disabledLabelDimensions?: string[];
};

export type KyvernoHelmValuesImagePullSecrets = object;

export type KyvernoHelmValuesTest = {
  /**
   * Sleep time before running test
   *
   * @default 20
   */
  sleep?: number;
  /**
   * @default {...} (4 keys)
   */
  image?: KyvernoHelmValuesTestImage;
  imagePullSecrets?: unknown[];
  /**
   * @default {"limits":{"cpu":"100m","memory":"256Mi"},"requests":{"cpu":"10m","memory":"64Mi"}}
   */
  resources?: KyvernoHelmValuesTestResources;
  /**
   * Security context for the test containers
   *
   * @default {...} (8 keys)
   */
  securityContext?: KyvernoHelmValuesTestSecurityContext;
};

export type KyvernoHelmValuesTestImage = {
  registry?: unknown;
  /**
   * Image repository
   *
   * @default "busybox"
   */
  repository?: string;
  /**
   * Image tag
   * Defaults to `latest` if omitted
   *
   * @default "1.35"
   */
  tag?: number;
  pullPolicy?: unknown;
};

export type KyvernoHelmValuesTestResources = {
  /**
   * Pod resource limits
   *
   * @default {"cpu":"100m","memory":"256Mi"}
   */
  limits?: KyvernoHelmValuesTestResourcesLimits;
  /**
   * Pod resource requests
   *
   * @default {"cpu":"10m","memory":"64Mi"}
   */
  requests?: KyvernoHelmValuesTestResourcesRequests;
};

export type KyvernoHelmValuesTestResourcesLimits = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "256Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesTestResourcesRequests = {
  /**
   * @default "10m"
   */
  cpu?: string;
  /**
   * @default "64Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesTestSecurityContext = {
  /**
   * @default 65534
   */
  runAsUser?: number;
  /**
   * @default 65534
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  privileged?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KyvernoHelmValuesTestSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KyvernoHelmValuesTestSecurityContextSeccompProfile;
};

export type KyvernoHelmValuesTestSecurityContextCapabilities = {
  drop?: string[];
};

export type KyvernoHelmValuesTestSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KyvernoHelmValuesCustomLabels = object;

export type KyvernoHelmValuesWebhooksCleanup = {
  /**
   * Create a helm pre-delete hook to cleanup webhooks.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"enabled":false}
   */
  autoDeleteWebhooks?: KyvernoHelmValuesWebhooksCleanupAutoDeleteWebhooks;
  /**
   * @default {...} (4 keys)
   */
  image?: KyvernoHelmValuesWebhooksCleanupImage;
  imagePullSecrets?: unknown[];
  /**
   * Security context for the pod
   *
   * @default {}
   */
  podSecurityContext?: KyvernoHelmValuesWebhooksCleanupPodSecurityContext;
  /**
   * Node labels for pod assignment
   *
   * @default {}
   */
  nodeSelector?: KyvernoHelmValuesWebhooksCleanupNodeSelector;
  tolerations?: unknown[];
  /**
   * Pod anti affinity constraints.
   *
   * @default {}
   */
  podAntiAffinity?: KyvernoHelmValuesWebhooksCleanupPodAntiAffinity;
  /**
   * Pod affinity constraints.
   *
   * @default {}
   */
  podAffinity?: KyvernoHelmValuesWebhooksCleanupPodAffinity;
  /**
   * Pod labels.
   *
   * @default {}
   */
  podLabels?: KyvernoHelmValuesWebhooksCleanupPodLabels;
  /**
   * Pod annotations.
   *
   * @default {}
   */
  podAnnotations?: KyvernoHelmValuesWebhooksCleanupPodAnnotations;
  /**
   * Node affinity constraints.
   *
   * @default {}
   */
  nodeAffinity?: KyvernoHelmValuesWebhooksCleanupNodeAffinity;
  /**
   * Security context for the hook containers
   *
   * @default {...} (8 keys)
   */
  securityContext?: KyvernoHelmValuesWebhooksCleanupSecurityContext;
};

export type KyvernoHelmValuesWebhooksCleanupAutoDeleteWebhooks = {
  /**
   * Allow webhooks controller to delete webhooks using finalizers
   *
   * @default false
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesWebhooksCleanupImage = {
  registry?: unknown;
  /**
   * Image repository
   *
   * @default "bitnami/kubectl"
   */
  repository?: string;
  /**
   * Image tag
   * Defaults to `latest` if omitted
   *
   * @default "1.30.2"
   */
  tag?: string;
  pullPolicy?: unknown;
};

export type KyvernoHelmValuesWebhooksCleanupPodSecurityContext = object;

export type KyvernoHelmValuesWebhooksCleanupNodeSelector = object;

export type KyvernoHelmValuesWebhooksCleanupPodAntiAffinity = object;

export type KyvernoHelmValuesWebhooksCleanupPodAffinity = object;

export type KyvernoHelmValuesWebhooksCleanupPodLabels = object;

export type KyvernoHelmValuesWebhooksCleanupPodAnnotations = object;

export type KyvernoHelmValuesWebhooksCleanupNodeAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesWebhooksCleanupSecurityContext = {
  /**
   * @default 65534
   */
  runAsUser?: number;
  /**
   * @default 65534
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  privileged?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KyvernoHelmValuesWebhooksCleanupSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KyvernoHelmValuesWebhooksCleanupSecurityContextSeccompProfile;
};

export type KyvernoHelmValuesWebhooksCleanupSecurityContextCapabilities = {
  drop?: string[];
};

export type KyvernoHelmValuesWebhooksCleanupSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KyvernoHelmValuesPolicyReportsCleanup = {
  /**
   * Create a helm post-upgrade hook to cleanup the old policy reports.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {...} (4 keys)
   */
  image?: KyvernoHelmValuesPolicyReportsCleanupImage;
  imagePullSecrets?: unknown[];
  /**
   * Security context for the pod
   *
   * @default {}
   */
  podSecurityContext?: KyvernoHelmValuesPolicyReportsCleanupPodSecurityContext;
  /**
   * Node labels for pod assignment
   *
   * @default {}
   */
  nodeSelector?: KyvernoHelmValuesPolicyReportsCleanupNodeSelector;
  tolerations?: unknown[];
  /**
   * Pod anti affinity constraints.
   *
   * @default {}
   */
  podAntiAffinity?: KyvernoHelmValuesPolicyReportsCleanupPodAntiAffinity;
  /**
   * Pod affinity constraints.
   *
   * @default {}
   */
  podAffinity?: KyvernoHelmValuesPolicyReportsCleanupPodAffinity;
  /**
   * Pod labels.
   *
   * @default {}
   */
  podLabels?: KyvernoHelmValuesPolicyReportsCleanupPodLabels;
  /**
   * Pod annotations.
   *
   * @default {}
   */
  podAnnotations?: KyvernoHelmValuesPolicyReportsCleanupPodAnnotations;
  /**
   * Node affinity constraints.
   *
   * @default {}
   */
  nodeAffinity?: KyvernoHelmValuesPolicyReportsCleanupNodeAffinity;
  /**
   * Security context for the hook containers
   *
   * @default {...} (8 keys)
   */
  securityContext?: KyvernoHelmValuesPolicyReportsCleanupSecurityContext;
};

export type KyvernoHelmValuesPolicyReportsCleanupImage = {
  registry?: unknown;
  /**
   * Image repository
   *
   * @default "bitnami/kubectl"
   */
  repository?: string;
  /**
   * Image tag
   * Defaults to `latest` if omitted
   *
   * @default "1.30.2"
   */
  tag?: string;
  pullPolicy?: unknown;
};

export type KyvernoHelmValuesPolicyReportsCleanupPodSecurityContext = object;

export type KyvernoHelmValuesPolicyReportsCleanupNodeSelector = object;

export type KyvernoHelmValuesPolicyReportsCleanupPodAntiAffinity = object;

export type KyvernoHelmValuesPolicyReportsCleanupPodAffinity = object;

export type KyvernoHelmValuesPolicyReportsCleanupPodLabels = object;

export type KyvernoHelmValuesPolicyReportsCleanupPodAnnotations = object;

export type KyvernoHelmValuesPolicyReportsCleanupNodeAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesPolicyReportsCleanupSecurityContext = {
  /**
   * @default 65534
   */
  runAsUser?: number;
  /**
   * @default 65534
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  privileged?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KyvernoHelmValuesPolicyReportsCleanupSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KyvernoHelmValuesPolicyReportsCleanupSecurityContextSeccompProfile;
};

export type KyvernoHelmValuesPolicyReportsCleanupSecurityContextCapabilities = {
  drop?: string[];
};

export type KyvernoHelmValuesPolicyReportsCleanupSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KyvernoHelmValuesGrafana = {
  /**
   * Enable grafana dashboard creation.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Configmap name template.
   *
   * @default "{{ include "kyverno.fullname" . }}-grafana"
   */
  configMapName?: string;
  namespace?: unknown;
  /**
   * Grafana dashboard configmap annotations.
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesGrafanaAnnotations;
  /**
   * Grafana dashboard configmap labels
   *
   * @default {"grafana_dashboard":"1"}
   */
  labels?: KyvernoHelmValuesGrafanaLabels;
  /**
   * create GrafanaDashboard custom resource referencing to the configMap.
   * according to https://grafana-operator.github.io/grafana-operator/docs/examples/dashboard_from_configmap/readme/
   *
   * @default {...} (4 keys)
   */
  grafanaDashboard?: KyvernoHelmValuesGrafanaGrafanaDashboard;
};

export type KyvernoHelmValuesGrafanaAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesGrafanaLabels = {
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

export type KyvernoHelmValuesGrafanaGrafanaDashboard = {
  /**
   * @default false
   */
  create?: boolean;
  /**
   * @default "kyverno"
   */
  folder?: string;
  /**
   * @default true
   */
  allowCrossNamespaceImport?: boolean;
  /**
   * @default {"dashboards":"grafana"}
   */
  matchLabels?: KyvernoHelmValuesGrafanaGrafanaDashboardMatchLabels;
};

export type KyvernoHelmValuesGrafanaGrafanaDashboardMatchLabels = {
  /**
   * @default "grafana"
   */
  dashboards?: string;
};

export type KyvernoHelmValuesFeatures = {
  /**
   * @default {"enabled":true}
   */
  admissionReports?: KyvernoHelmValuesFeaturesAdmissionReports;
  /**
   * @default {"enabled":true}
   */
  aggregateReports?: KyvernoHelmValuesFeaturesAggregateReports;
  /**
   * @default {"enabled":true}
   */
  policyReports?: KyvernoHelmValuesFeaturesPolicyReports;
  /**
   * @default {"enabled":false}
   */
  validatingAdmissionPolicyReports?: KyvernoHelmValuesFeaturesValidatingAdmissionPolicyReports;
  /**
   * @default {...} (5 keys)
   */
  reporting?: KyvernoHelmValuesFeaturesReporting;
  /**
   * @default {"enabled":true}
   */
  autoUpdateWebhooks?: KyvernoHelmValuesFeaturesAutoUpdateWebhooks;
  /**
   * @default {...} (4 keys)
   */
  backgroundScan?: KyvernoHelmValuesFeaturesBackgroundScan;
  /**
   * @default {"enabled":true}
   */
  configMapCaching?: KyvernoHelmValuesFeaturesConfigMapCaching;
  /**
   * @default {"enabled":true}
   */
  deferredLoading?: KyvernoHelmValuesFeaturesDeferredLoading;
  /**
   * @default {"enabled":false}
   */
  dumpPayload?: KyvernoHelmValuesFeaturesDumpPayload;
  /**
   * @default {"enabled":false}
   */
  forceFailurePolicyIgnore?: KyvernoHelmValuesFeaturesForceFailurePolicyIgnore;
  /**
   * @default {"enabled":false}
   */
  generateValidatingAdmissionPolicy?: KyvernoHelmValuesFeaturesGenerateValidatingAdmissionPolicy;
  /**
   * @default {"enabled":false}
   */
  dumpPatches?: KyvernoHelmValuesFeaturesDumpPatches;
  /**
   * @default {"maxApiCallResponseLength":2000000}
   */
  globalContext?: KyvernoHelmValuesFeaturesGlobalContext;
  /**
   * @default {"format":"text","verbosity":2}
   */
  logging?: KyvernoHelmValuesFeaturesLogging;
  /**
   * @default {"eventTypes":["PolicyApplied","PolicySkipped"]}
   */
  omitEvents?: KyvernoHelmValuesFeaturesOmitEvents;
  /**
   * @default {"enabled":false,"namespace":""}
   */
  policyExceptions?: KyvernoHelmValuesFeaturesPolicyExceptions;
  /**
   * @default {"enabled":false}
   */
  protectManagedResources?: KyvernoHelmValuesFeaturesProtectManagedResources;
  /**
   * @default {"allowInsecure":false,"credentialHelpers":["default","google","amazon","azure","github"]}
   */
  registryClient?: KyvernoHelmValuesFeaturesRegistryClient;
  /**
   * @default {"reconciliationInterval":"1m"}
   */
  ttlController?: KyvernoHelmValuesFeaturesTtlController;
  /**
   * @default {...} (4 keys)
   */
  tuf?: KyvernoHelmValuesFeaturesTuf;
};

export type KyvernoHelmValuesFeaturesAdmissionReports = {
  /**
   * Enables the feature
   *
   * @default true
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesAggregateReports = {
  /**
   * Enables the feature
   *
   * @default true
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesPolicyReports = {
  /**
   * Enables the feature
   *
   * @default true
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesValidatingAdmissionPolicyReports = {
  /**
   * Enables the feature
   *
   * @default false
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesReporting = {
  /**
   * Enables the feature
   *
   * @default true
   */
  validate?: boolean;
  /**
   * Enables the feature
   *
   * @default true
   */
  mutate?: boolean;
  /**
   * Enables the feature
   *
   * @default true
   */
  mutateExisting?: boolean;
  /**
   * Enables the feature
   *
   * @default true
   */
  imageVerify?: boolean;
  /**
   * Enables the feature
   *
   * @default true
   */
  generate?: boolean;
};

export type KyvernoHelmValuesFeaturesAutoUpdateWebhooks = {
  /**
   * Enables the feature
   *
   * @default true
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesBackgroundScan = {
  /**
   * Enables the feature
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Number of background scan workers
   *
   * @default 2
   */
  backgroundScanWorkers?: number;
  /**
   * Background scan interval
   *
   * @default "1h"
   */
  backgroundScanInterval?: string;
  /**
   * Skips resource filters in background scan
   *
   * @default true
   */
  skipResourceFilters?: boolean;
};

export type KyvernoHelmValuesFeaturesConfigMapCaching = {
  /**
   * Enables the feature
   *
   * @default true
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesDeferredLoading = {
  /**
   * Enables the feature
   *
   * @default true
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesDumpPayload = {
  /**
   * Enables the feature
   *
   * @default false
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesForceFailurePolicyIgnore = {
  /**
   * Enables the feature
   *
   * @default false
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesGenerateValidatingAdmissionPolicy = {
  /**
   * Enables the feature
   *
   * @default false
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesDumpPatches = {
  /**
   * Enables the feature
   *
   * @default false
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesGlobalContext = {
  /**
   * Maximum allowed response size from API Calls. A value of 0 bypasses checks (not recommended)
   *
   * @default 2000000
   */
  maxApiCallResponseLength?: number;
};

export type KyvernoHelmValuesFeaturesLogging = {
  /**
   * Logging format
   *
   * @default "text"
   */
  format?: string;
  /**
   * Logging verbosity
   *
   * @default 2
   */
  verbosity?: number;
};

export type KyvernoHelmValuesFeaturesOmitEvents = {
  eventTypes?: string[];
};

export type KyvernoHelmValuesFeaturesPolicyExceptions = {
  /**
   * Enables the feature
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Restrict policy exceptions to a single namespace
   * Set to "*" to allow exceptions in all namespaces
   *
   * @default ""
   */
  namespace?: string;
};

export type KyvernoHelmValuesFeaturesProtectManagedResources = {
  /**
   * Enables the feature
   *
   * @default false
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesFeaturesRegistryClient = {
  /**
   * Allow insecure registry
   *
   * @default false
   */
  allowInsecure?: boolean;
  credentialHelpers?: unknown[];
};

export type KyvernoHelmValuesFeaturesTtlController = {
  /**
   * Reconciliation interval for the label based cleanup manager
   *
   * @default "1m"
   */
  reconciliationInterval?: string;
};

export type KyvernoHelmValuesFeaturesTuf = {
  /**
   * Enables the feature
   *
   * @default false
   */
  enabled?: boolean;
  root?: unknown;
  rootRaw?: unknown;
  mirror?: unknown;
};

export type KyvernoHelmValuesAdmissionController = {
  /**
   * Overrides features defined at the root level
   *
   * @default {"admissionReports":{"backPressureThreshold":1000}}
   */
  featuresOverride?: KyvernoHelmValuesAdmissionControllerFeaturesOverride;
  /**
   * @default {...} (6 keys)
   */
  rbac?: KyvernoHelmValuesAdmissionControllerRbac;
  /**
   * @default false
   */
  createSelfSignedCert?: boolean;
  replicas?: unknown;
  /**
   * The number of revisions to keep
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * Resync period for informers
   *
   * @default "15m"
   */
  resyncPeriod?: string;
  /**
   * Additional labels to add to each pod
   * example.com/label: foo
   *
   * @default {}
   */
  podLabels?: KyvernoHelmValuesAdmissionControllerPodLabels;
  /**
   * Additional annotations to add to each pod
   * example.com/annotation: foo
   *
   * @default {}
   */
  podAnnotations?: KyvernoHelmValuesAdmissionControllerPodAnnotations;
  /**
   * Deployment annotations.
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesAdmissionControllerAnnotations;
  /**
   * Deployment update strategy.
   * Ref: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy
   *
   * @default {"rollingUpdate":{"maxSurge":1,"maxUnavailable":"40%"},"type":"RollingUpdate"}
   */
  updateStrategy?: KyvernoHelmValuesAdmissionControllerUpdateStrategy;
  /**
   * Optional priority class
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Change `apiPriorityAndFairness` to `true` if you want to insulate the API calls made by Kyverno admission controller activities.
   * This will help ensure Kyverno stability in busy clusters.
   * Ref: https://kubernetes.io/docs/concepts/cluster-administration/flow-control/
   *
   * @default false
   */
  apiPriorityAndFairness?: boolean;
  /**
   * Priority level configuration.
   * The block is directly forwarded into the priorityLevelConfiguration, so you can use whatever specification you want.
   * ref: https://kubernetes.io/docs/concepts/cluster-administration/flow-control/#prioritylevelconfiguration
   *
   * @default {"type":"Limited","limited":{"nominalConcurrencyShares":10,"limitResponse":{"queuing":{"queueLengthLimit":50},"type":"Queue"}}}
   */
  priorityLevelConfigurationSpec?: KyvernoHelmValuesAdmissionControllerPriorityLevelConfigurationSpec;
  /**
   * Change `hostNetwork` to `true` when you want the pod to share its host's network namespace.
   * Useful for situations like when you end up dealing with a custom CNI over Amazon EKS.
   * Update the `dnsPolicy` accordingly as well to suit the host network mode.
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * admissionController webhook server port
   * in case you are using hostNetwork: true, you might want to change the port the webhookServer is listening to
   *
   * @default {"port":9443}
   */
  webhookServer?: KyvernoHelmValuesAdmissionControllerWebhookServer;
  /**
   * `dnsPolicy` determines the manner in which DNS resolution happens in the cluster.
   * In case of `hostNetwork: true`, usually, the `dnsPolicy` is suitable to be `ClusterFirstWithHostNet`.
   * For further reference: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-s-dns-policy.
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Startup probe.
   * The block is directly forwarded into the deployment, so you can use whatever startupProbes configuration you want.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/
   *
   * @default {...} (4 keys)
   */
  startupProbe?: KyvernoHelmValuesAdmissionControllerStartupProbe;
  /**
   * Liveness probe.
   * The block is directly forwarded into the deployment, so you can use whatever livenessProbe configuration you want.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: KyvernoHelmValuesAdmissionControllerLivenessProbe;
  /**
   * Readiness Probe.
   * The block is directly forwarded into the deployment, so you can use whatever readinessProbe configuration you want.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: KyvernoHelmValuesAdmissionControllerReadinessProbe;
  /**
   * Node labels for pod assignment
   *
   * @default {}
   */
  nodeSelector?: KyvernoHelmValuesAdmissionControllerNodeSelector;
  tolerations?: unknown[];
  /**
   * @default {"enabled":true}
   */
  antiAffinity?: KyvernoHelmValuesAdmissionControllerAntiAffinity;
  /**
   * Pod anti affinity constraints.
   *
   * @default {"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":1,"podAffinityTerm":{"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["admission-controller"]}]},"topologyKey":"kubernetes.io/hostname"}}]}
   */
  podAntiAffinity?: KyvernoHelmValuesAdmissionControllerPodAntiAffinity;
  /**
   * Pod affinity constraints.
   *
   * @default {}
   */
  podAffinity?: KyvernoHelmValuesAdmissionControllerPodAffinity;
  /**
   * Node affinity constraints.
   *
   * @default {}
   */
  nodeAffinity?: KyvernoHelmValuesAdmissionControllerNodeAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Security context for the pod
   *
   * @default {}
   */
  podSecurityContext?: KyvernoHelmValuesAdmissionControllerPodSecurityContext;
  /**
   * @default {"enabled":false,"minAvailable":1,"maxUnavailable":null}
   */
  podDisruptionBudget?: KyvernoHelmValuesAdmissionControllerPodDisruptionBudget;
  /**
   * @default "/.sigstore"
   */
  tufRootMountPath?: string;
  /**
   * Volume to be mounted in pods for TUF/cosign work.
   *
   * @default {"emptyDir":{}}
   */
  sigstoreVolume?: KyvernoHelmValuesAdmissionControllerSigstoreVolume;
  /**
   * @default {"data":null,"volume":{}}
   */
  caCertificates?: KyvernoHelmValuesAdmissionControllerCaCertificates;
  imagePullSecrets?: unknown[];
  /**
   * @default {...} (5 keys)
   */
  initContainer?: KyvernoHelmValuesAdmissionControllerInitContainer;
  /**
   * Array of extra init containers
   *
   * @default {...} (5 keys)
   */
  container?: KyvernoHelmValuesAdmissionControllerContainer;
  extraInitContainers?: unknown[];
  extraContainers?: unknown[];
  /**
   * @default {...} (4 keys)
   */
  service?: KyvernoHelmValuesAdmissionControllerService;
  /**
   * @default {...} (5 keys)
   */
  metricsService?: KyvernoHelmValuesAdmissionControllerMetricsService;
  /**
   * @default {"enabled":false,"ingressFrom":[]}
   */
  networkPolicy?: KyvernoHelmValuesAdmissionControllerNetworkPolicy;
  /**
   * @default {...} (9 keys)
   */
  serviceMonitor?: KyvernoHelmValuesAdmissionControllerServiceMonitor;
  /**
   * @default {...} (4 keys)
   */
  tracing?: KyvernoHelmValuesAdmissionControllerTracing;
  /**
   * @default {...} (5 keys)
   */
  metering?: KyvernoHelmValuesAdmissionControllerMetering;
  /**
   * @default {...} (4 keys)
   */
  profiling?: KyvernoHelmValuesAdmissionControllerProfiling;
};

export type KyvernoHelmValuesAdmissionControllerFeaturesOverride = {
  /**
   * @default {"backPressureThreshold":1000}
   */
  admissionReports?: KyvernoHelmValuesAdmissionControllerFeaturesOverrideAdmissionReports;
};

export type KyvernoHelmValuesAdmissionControllerFeaturesOverrideAdmissionReports = {
  /**
   * Max number of admission reports allowed in flight until the admission controller stops creating new ones
   *
   * @default 1000
   */
  backPressureThreshold?: number;
};

export type KyvernoHelmValuesAdmissionControllerRbac = {
  /**
   * Create RBAC resources
   *
   * @default true
   */
  create?: boolean;
  /**
   * Create rolebinding to view role
   *
   * @default true
   */
  createViewRoleBinding?: boolean;
  /**
   * The view role to use in the rolebinding
   *
   * @default "view"
   */
  viewRoleName?: string;
  /**
   * @default {"name":null,"annotations":{}}
   */
  serviceAccount?: KyvernoHelmValuesAdmissionControllerRbacServiceAccount;
  /**
   * @default {"extraResources":[]}
   */
  coreClusterRole?: KyvernoHelmValuesAdmissionControllerRbacCoreClusterRole;
  /**
   * Create self-signed certificates at deployment time.
   * The certificates won't be automatically renewed if this is set to `true`.
   *
   * @default {"extraResources":[]}
   */
  clusterRole?: KyvernoHelmValuesAdmissionControllerRbacClusterRole;
};

export type KyvernoHelmValuesAdmissionControllerRbacServiceAccount = {
  name?: unknown;
  /**
   * Annotations for the ServiceAccount
   * example.com/annotation: value
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesAdmissionControllerRbacServiceAccountAnnotations;
};

export type KyvernoHelmValuesAdmissionControllerRbacServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesAdmissionControllerRbacCoreClusterRole = {
  extraResources?: unknown[];
};

export type KyvernoHelmValuesAdmissionControllerRbacClusterRole = {
  extraResources?: unknown[];
};

export type KyvernoHelmValuesAdmissionControllerPodLabels = object;

export type KyvernoHelmValuesAdmissionControllerPodAnnotations = object;

export type KyvernoHelmValuesAdmissionControllerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesAdmissionControllerUpdateStrategy = {
  /**
   * @default {"maxSurge":1,"maxUnavailable":"40%"}
   */
  rollingUpdate?: KyvernoHelmValuesAdmissionControllerUpdateStrategyRollingUpdate;
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type KyvernoHelmValuesAdmissionControllerUpdateStrategyRollingUpdate = {
  /**
   * @default 1
   */
  maxSurge?: number;
  /**
   * @default "40%"
   */
  maxUnavailable?: string;
};

export type KyvernoHelmValuesAdmissionControllerPriorityLevelConfigurationSpec = {
  /**
   * @default "Limited"
   */
  type?: string;
  /**
   * @default {"nominalConcurrencyShares":10,"limitResponse":{"queuing":{"queueLengthLimit":50},"type":"Queue"}}
   */
  limited?: KyvernoHelmValuesAdmissionControllerPriorityLevelConfigurationSpecLimited;
};

export type KyvernoHelmValuesAdmissionControllerPriorityLevelConfigurationSpecLimited = {
  /**
   * @default 10
   */
  nominalConcurrencyShares?: number;
  /**
   * @default {"queuing":{"queueLengthLimit":50},"type":"Queue"}
   */
  limitResponse?: KyvernoHelmValuesAdmissionControllerPriorityLevelConfigurationSpecLimitedLimitResponse;
};

export type KyvernoHelmValuesAdmissionControllerPriorityLevelConfigurationSpecLimitedLimitResponse = {
  /**
   * @default {"queueLengthLimit":50}
   */
  queuing?: KyvernoHelmValuesAdmissionControllerPriorityLevelConfigurationSpecLimitedLimitResponseQueuing;
  /**
   * @default "Queue"
   */
  type?: string;
};

export type KyvernoHelmValuesAdmissionControllerPriorityLevelConfigurationSpecLimitedLimitResponseQueuing = {
  /**
   * @default 50
   */
  queueLengthLimit?: number;
};

export type KyvernoHelmValuesAdmissionControllerWebhookServer = {
  /**
   * @default 9443
   */
  port?: number;
};

export type KyvernoHelmValuesAdmissionControllerStartupProbe = {
  /**
   * @default {"path":"/health/liveness","port":9443,"scheme":"HTTPS"}
   */
  httpGet?: KyvernoHelmValuesAdmissionControllerStartupProbeHttpGet;
  /**
   * @default 20
   */
  failureThreshold?: number;
  /**
   * @default 2
   */
  initialDelaySeconds?: number;
  /**
   * @default 6
   */
  periodSeconds?: number;
};

export type KyvernoHelmValuesAdmissionControllerStartupProbeHttpGet = {
  /**
   * @default "/health/liveness"
   */
  path?: string;
  /**
   * @default 9443
   */
  port?: number;
  /**
   * @default "HTTPS"
   */
  scheme?: string;
};

export type KyvernoHelmValuesAdmissionControllerLivenessProbe = {
  /**
   * @default {"path":"/health/liveness","port":9443,"scheme":"HTTPS"}
   */
  httpGet?: KyvernoHelmValuesAdmissionControllerLivenessProbeHttpGet;
  /**
   * @default 15
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
   * @default 2
   */
  failureThreshold?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
};

export type KyvernoHelmValuesAdmissionControllerLivenessProbeHttpGet = {
  /**
   * @default "/health/liveness"
   */
  path?: string;
  /**
   * @default 9443
   */
  port?: number;
  /**
   * @default "HTTPS"
   */
  scheme?: string;
};

export type KyvernoHelmValuesAdmissionControllerReadinessProbe = {
  /**
   * @default {"path":"/health/readiness","port":9443,"scheme":"HTTPS"}
   */
  httpGet?: KyvernoHelmValuesAdmissionControllerReadinessProbeHttpGet;
  /**
   * @default 5
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
   * @default 6
   */
  failureThreshold?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
};

export type KyvernoHelmValuesAdmissionControllerReadinessProbeHttpGet = {
  /**
   * @default "/health/readiness"
   */
  path?: string;
  /**
   * @default 9443
   */
  port?: number;
  /**
   * @default "HTTPS"
   */
  scheme?: string;
};

export type KyvernoHelmValuesAdmissionControllerNodeSelector = object;

export type KyvernoHelmValuesAdmissionControllerAntiAffinity = {
  /**
   * Pod antiAffinities toggle.
   * Enabled by default but can be disabled if you want to schedule pods to the same node.
   *
   * @default true
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesAdmissionControllerPodAntiAffinity = {
  preferredDuringSchedulingIgnoredDuringExecution?: KyvernoHelmValuesAdmissionControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type KyvernoHelmValuesAdmissionControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement =
  {
    /**
     * @default 1
     */
    weight?: number;
    /**
     * @default {"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["admission-controller"]}]},"topologyKey":"kubernetes.io/hostname"}
     */
    podAffinityTerm?: KyvernoHelmValuesAdmissionControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTerm;
  };

export type KyvernoHelmValuesAdmissionControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTerm =
  {
    /**
     * @default {"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["admission-controller"]}]}
     */
    labelSelector?: KyvernoHelmValuesAdmissionControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelector;
    /**
     * @default "kubernetes.io/hostname"
     */
    topologyKey?: string;
  };

export type KyvernoHelmValuesAdmissionControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelector =
  {
    matchExpressions?: KyvernoHelmValuesAdmissionControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelectorMatchExpressionsElement[];
  };

export type KyvernoHelmValuesAdmissionControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelectorMatchExpressionsElement =
  {
    /**
     * @default "app.kubernetes.io/component"
     */
    key?: string;
    /**
     * @default "In"
     */
    operator?: string;
    values?: string[];
  };

export type KyvernoHelmValuesAdmissionControllerPodAffinity = object;

export type KyvernoHelmValuesAdmissionControllerNodeAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesAdmissionControllerPodSecurityContext = object;

export type KyvernoHelmValuesAdmissionControllerPodDisruptionBudget = {
  /**
   * Enable PodDisruptionBudget.
   * Will always be enabled if replicas > 1. This non-declarative behavior should ideally be avoided, but changing it now would be breaking.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Configures the minimum available pods for disruptions.
   * Cannot be used if `maxUnavailable` is set.
   *
   * @default 1
   */
  minAvailable?: number;
  maxUnavailable?: unknown;
};

export type KyvernoHelmValuesAdmissionControllerSigstoreVolume = {
  /**
   * @default {}
   */
  emptyDir?: KyvernoHelmValuesAdmissionControllerSigstoreVolumeEmptyDir;
};

export type KyvernoHelmValuesAdmissionControllerSigstoreVolumeEmptyDir = object;

export type KyvernoHelmValuesAdmissionControllerCaCertificates = {
  data?: unknown;
  /**
   * Volume to be mounted for CA certificates
   * Not used when `.Values.admissionController.caCertificates.data` is defined
   *
   * @default {}
   */
  volume?: KyvernoHelmValuesAdmissionControllerCaCertificatesVolume;
};

export type KyvernoHelmValuesAdmissionControllerCaCertificatesVolume = object;

export type KyvernoHelmValuesAdmissionControllerInitContainer = {
  /**
   * @default {...} (5 keys)
   */
  image?: KyvernoHelmValuesAdmissionControllerInitContainerImage;
  /**
   * @default {"limits":{"cpu":"100m","memory":"256Mi"},"requests":{"cpu":"10m","memory":"64Mi"}}
   */
  resources?: KyvernoHelmValuesAdmissionControllerInitContainerResources;
  /**
   * Container security context
   *
   * @default {...} (6 keys)
   */
  securityContext?: KyvernoHelmValuesAdmissionControllerInitContainerSecurityContext;
  /**
   * Additional container args.
   *
   * @default {}
   */
  extraArgs?: KyvernoHelmValuesAdmissionControllerInitContainerExtraArgs;
  extraEnvVars?: unknown[];
};

export type KyvernoHelmValuesAdmissionControllerInitContainerImage = {
  registry?: unknown;
  /**
   * @default "ghcr.io"
   */
  defaultRegistry?: string;
  /**
   * Image repository
   *
   * @default "kyverno/kyvernopre"
   */
  repository?: string;
  tag?: unknown;
  pullPolicy?: unknown;
};

export type KyvernoHelmValuesAdmissionControllerInitContainerResources = {
  /**
   * Pod resource limits
   *
   * @default {"cpu":"100m","memory":"256Mi"}
   */
  limits?: KyvernoHelmValuesAdmissionControllerInitContainerResourcesLimits;
  /**
   * Pod resource requests
   *
   * @default {"cpu":"10m","memory":"64Mi"}
   */
  requests?: KyvernoHelmValuesAdmissionControllerInitContainerResourcesRequests;
};

export type KyvernoHelmValuesAdmissionControllerInitContainerResourcesLimits = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "256Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesAdmissionControllerInitContainerResourcesRequests = {
  /**
   * @default "10m"
   */
  cpu?: string;
  /**
   * @default "64Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesAdmissionControllerInitContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  privileged?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KyvernoHelmValuesAdmissionControllerInitContainerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KyvernoHelmValuesAdmissionControllerInitContainerSecurityContextSeccompProfile;
};

export type KyvernoHelmValuesAdmissionControllerInitContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type KyvernoHelmValuesAdmissionControllerInitContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KyvernoHelmValuesAdmissionControllerInitContainerExtraArgs = object;

export type KyvernoHelmValuesAdmissionControllerContainer = {
  /**
   * @default {...} (5 keys)
   */
  image?: KyvernoHelmValuesAdmissionControllerContainerImage;
  /**
   * @default {"limits":{"memory":"384Mi"},"requests":{"cpu":"100m","memory":"128Mi"}}
   */
  resources?: KyvernoHelmValuesAdmissionControllerContainerResources;
  /**
   * Container security context
   *
   * @default {...} (6 keys)
   */
  securityContext?: KyvernoHelmValuesAdmissionControllerContainerSecurityContext;
  /**
   * Additional container args.
   *
   * @default {}
   */
  extraArgs?: KyvernoHelmValuesAdmissionControllerContainerExtraArgs;
  extraEnvVars?: unknown[];
};

export type KyvernoHelmValuesAdmissionControllerContainerImage = {
  registry?: unknown;
  /**
   * @default "ghcr.io"
   */
  defaultRegistry?: string;
  /**
   * Image repository
   *
   * @default "kyverno/kyverno"
   */
  repository?: string;
  tag?: unknown;
  /**
   * Image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KyvernoHelmValuesAdmissionControllerContainerResources = {
  /**
   * Pod resource limits
   *
   * @default {"memory":"384Mi"}
   */
  limits?: KyvernoHelmValuesAdmissionControllerContainerResourcesLimits;
  /**
   * Pod resource requests
   *
   * @default {"cpu":"100m","memory":"128Mi"}
   */
  requests?: KyvernoHelmValuesAdmissionControllerContainerResourcesRequests;
};

export type KyvernoHelmValuesAdmissionControllerContainerResourcesLimits = {
  /**
   * @default "384Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesAdmissionControllerContainerResourcesRequests = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "128Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesAdmissionControllerContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  privileged?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KyvernoHelmValuesAdmissionControllerContainerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KyvernoHelmValuesAdmissionControllerContainerSecurityContextSeccompProfile;
};

export type KyvernoHelmValuesAdmissionControllerContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type KyvernoHelmValuesAdmissionControllerContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KyvernoHelmValuesAdmissionControllerContainerExtraArgs = object;

export type KyvernoHelmValuesAdmissionControllerService = {
  /**
   * Service port.
   *
   * @default 443
   */
  port?: number;
  /**
   * Service type.
   *
   * @default "ClusterIP"
   */
  type?: string;
  nodePort?: unknown;
  /**
   * @default {}
   */
  annotations?: KyvernoHelmValuesAdmissionControllerServiceAnnotations;
};

export type KyvernoHelmValuesAdmissionControllerServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesAdmissionControllerMetricsService = {
  /**
   * Create service.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Service port.
   * Kyverno's metrics server will be exposed at this port.
   *
   * @default 8000
   */
  port?: number;
  /**
   * Service type.
   *
   * @default "ClusterIP"
   */
  type?: string;
  nodePort?: unknown;
  /**
   * @default {}
   */
  annotations?: KyvernoHelmValuesAdmissionControllerMetricsServiceAnnotations;
};

export type KyvernoHelmValuesAdmissionControllerMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesAdmissionControllerNetworkPolicy = {
  /**
   * When true, use a NetworkPolicy to allow ingress to the webhook
   * This is useful on clusters using Calico and/or native k8s network policies in a default-deny setup.
   *
   * @default false
   */
  enabled?: boolean;
  ingressFrom?: unknown[];
};

export type KyvernoHelmValuesAdmissionControllerServiceMonitor = {
  /**
   * Create a `ServiceMonitor` to collect Prometheus metrics.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KyvernoHelmValuesAdmissionControllerServiceMonitorAdditionalLabels;
  namespace?: unknown;
  /**
   * Interval to scrape metrics
   *
   * @default "30s"
   */
  interval?: string;
  /**
   * Timeout if metrics can't be retrieved in given time interval
   *
   * @default "25s"
   */
  scrapeTimeout?: string;
  /**
   * Is TLS required for endpoint
   *
   * @default false
   */
  secure?: boolean;
  /**
   * TLS Configuration for endpoint
   *
   * @default {}
   */
  tlsConfig?: KyvernoHelmValuesAdmissionControllerServiceMonitorTlsConfig;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
};

export type KyvernoHelmValuesAdmissionControllerServiceMonitorAdditionalLabels = object;

export type KyvernoHelmValuesAdmissionControllerServiceMonitorTlsConfig = object;

export type KyvernoHelmValuesAdmissionControllerTracing = {
  /**
   * Enable tracing
   *
   * @default false
   */
  enabled?: boolean;
  address?: unknown;
  port?: unknown;
  /**
   * @default ""
   */
  creds?: string;
};

export type KyvernoHelmValuesAdmissionControllerMetering = {
  /**
   * Disable metrics export
   *
   * @default false
   */
  disabled?: boolean;
  /**
   * Otel configuration, can be `prometheus` or `grpc`
   *
   * @default "prometheus"
   */
  config?: string;
  /**
   * Prometheus endpoint port
   *
   * @default 8000
   */
  port?: number;
  /**
   * Otel collector endpoint
   *
   * @default ""
   */
  collector?: string;
  /**
   * Otel collector credentials
   *
   * @default ""
   */
  creds?: string;
};

export type KyvernoHelmValuesAdmissionControllerProfiling = {
  /**
   * Enable profiling
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Profiling endpoint port
   *
   * @default 6060
   */
  port?: number;
  /**
   * Service type.
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  nodePort?: unknown;
};

export type KyvernoHelmValuesBackgroundController = {
  /**
   * Overrides features defined at the root level
   *
   * @default {}
   */
  featuresOverride?: KyvernoHelmValuesBackgroundControllerFeaturesOverride;
  /**
   * Enable background controller.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {...} (6 keys)
   */
  rbac?: KyvernoHelmValuesBackgroundControllerRbac;
  /**
   * @default {...} (5 keys)
   */
  image?: KyvernoHelmValuesBackgroundControllerImage;
  imagePullSecrets?: unknown[];
  replicas?: unknown;
  /**
   * The number of revisions to keep
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * Resync period for informers
   *
   * @default "15m"
   */
  resyncPeriod?: string;
  /**
   * Additional labels to add to each pod
   *
   * @default {}
   */
  podLabels?: KyvernoHelmValuesBackgroundControllerPodLabels;
  /**
   * example.com/label: foo
   * Additional annotations to add to each pod
   *
   * @default {}
   */
  podAnnotations?: KyvernoHelmValuesBackgroundControllerPodAnnotations;
  /**
   * example.com/annotation: foo
   * Deployment annotations.
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesBackgroundControllerAnnotations;
  /**
   * Deployment update strategy.
   * Ref: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy
   *
   * @default {"rollingUpdate":{"maxSurge":1,"maxUnavailable":"40%"},"type":"RollingUpdate"}
   */
  updateStrategy?: KyvernoHelmValuesBackgroundControllerUpdateStrategy;
  /**
   * Optional priority class
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Change `hostNetwork` to `true` when you want the pod to share its host's network namespace.
   * Useful for situations like when you end up dealing with a custom CNI over Amazon EKS.
   * Update the `dnsPolicy` accordingly as well to suit the host network mode.
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * `dnsPolicy` determines the manner in which DNS resolution happens in the cluster.
   * In case of `hostNetwork: true`, usually, the `dnsPolicy` is suitable to be `ClusterFirstWithHostNet`.
   * For further reference: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-s-dns-policy.
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Extra arguments passed to the container on the command line
   *
   * @default {}
   */
  extraArgs?: KyvernoHelmValuesBackgroundControllerExtraArgs;
  extraEnvVars?: unknown[];
  /**
   * @default {"limits":{"memory":"128Mi"},"requests":{"cpu":"100m","memory":"64Mi"}}
   */
  resources?: KyvernoHelmValuesBackgroundControllerResources;
  /**
   * Node labels for pod assignment
   *
   * @default {}
   */
  nodeSelector?: KyvernoHelmValuesBackgroundControllerNodeSelector;
  tolerations?: unknown[];
  /**
   * @default {"enabled":true}
   */
  antiAffinity?: KyvernoHelmValuesBackgroundControllerAntiAffinity;
  /**
   * Pod anti affinity constraints.
   *
   * @default {"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":1,"podAffinityTerm":{"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["background-controller"]}]},"topologyKey":"kubernetes.io/hostname"}}]}
   */
  podAntiAffinity?: KyvernoHelmValuesBackgroundControllerPodAntiAffinity;
  /**
   * Pod affinity constraints.
   *
   * @default {}
   */
  podAffinity?: KyvernoHelmValuesBackgroundControllerPodAffinity;
  /**
   * Node affinity constraints.
   *
   * @default {}
   */
  nodeAffinity?: KyvernoHelmValuesBackgroundControllerNodeAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Security context for the pod
   *
   * @default {}
   */
  podSecurityContext?: KyvernoHelmValuesBackgroundControllerPodSecurityContext;
  /**
   * Security context for the containers
   *
   * @default {...} (6 keys)
   */
  securityContext?: KyvernoHelmValuesBackgroundControllerSecurityContext;
  /**
   * @default {"enabled":false,"minAvailable":1,"maxUnavailable":null}
   */
  podDisruptionBudget?: KyvernoHelmValuesBackgroundControllerPodDisruptionBudget;
  /**
   * @default {"data":null,"volume":{}}
   */
  caCertificates?: KyvernoHelmValuesBackgroundControllerCaCertificates;
  /**
   * @default {...} (5 keys)
   */
  metricsService?: KyvernoHelmValuesBackgroundControllerMetricsService;
  /**
   * @default {"enabled":false,"ingressFrom":[]}
   */
  networkPolicy?: KyvernoHelmValuesBackgroundControllerNetworkPolicy;
  /**
   * @default {...} (9 keys)
   */
  serviceMonitor?: KyvernoHelmValuesBackgroundControllerServiceMonitor;
  /**
   * @default {...} (4 keys)
   */
  tracing?: KyvernoHelmValuesBackgroundControllerTracing;
  /**
   * @default {...} (5 keys)
   */
  metering?: KyvernoHelmValuesBackgroundControllerMetering;
  /**
   * backgroundController server port
   * in case you are using hostNetwork: true, you might want to change the port the backgroundController is listening to
   *
   * @default {"port":9443}
   */
  server?: KyvernoHelmValuesBackgroundControllerServer;
  /**
   * @default {...} (4 keys)
   */
  profiling?: KyvernoHelmValuesBackgroundControllerProfiling;
};

export type KyvernoHelmValuesBackgroundControllerFeaturesOverride = object;

export type KyvernoHelmValuesBackgroundControllerRbac = {
  /**
   * Create RBAC resources
   *
   * @default true
   */
  create?: boolean;
  /**
   * Create rolebinding to view role
   *
   * @default true
   */
  createViewRoleBinding?: boolean;
  /**
   * The view role to use in the rolebinding
   *
   * @default "view"
   */
  viewRoleName?: string;
  /**
   * @default {"name":null,"annotations":{}}
   */
  serviceAccount?: KyvernoHelmValuesBackgroundControllerRbacServiceAccount;
  /**
   * @default {"extraResources":[{"apiGroups":["networking.k8s.io"],"resources":["ingresses","ingressclasses","networkpolicies"],"verbs":["create","update","patch","delete"]},{"apiGroups":["rbac.authorization.k8s.io"],"resources":["rolebindings","roles"],"verbs":["create","update","patch","delete"]},{"apiGroups":[""],"resources":["configmaps","resourcequotas","limitranges"],"verbs":["create","update","patch","delete"]}]}
   */
  coreClusterRole?: KyvernoHelmValuesBackgroundControllerRbacCoreClusterRole;
  /**
   * @default {"extraResources":[]}
   */
  clusterRole?: KyvernoHelmValuesBackgroundControllerRbacClusterRole;
};

export type KyvernoHelmValuesBackgroundControllerRbacServiceAccount = {
  name?: unknown;
  /**
   * Annotations for the ServiceAccount
   * example.com/annotation: value
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesBackgroundControllerRbacServiceAccountAnnotations;
};

export type KyvernoHelmValuesBackgroundControllerRbacServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesBackgroundControllerRbacCoreClusterRole = {
  extraResources?: KyvernoHelmValuesBackgroundControllerRbacCoreClusterRoleExtraResourcesElement[];
};

export type KyvernoHelmValuesBackgroundControllerRbacCoreClusterRoleExtraResourcesElement = {
  apiGroups?: string[];
  resources?: string[];
  verbs?: string[];
};

export type KyvernoHelmValuesBackgroundControllerRbacClusterRole = {
  extraResources?: unknown[];
};

export type KyvernoHelmValuesBackgroundControllerImage = {
  registry?: unknown;
  /**
   * @default "ghcr.io"
   */
  defaultRegistry?: string;
  /**
   * Image repository
   *
   * @default "kyverno/background-controller"
   */
  repository?: string;
  tag?: unknown;
  /**
   * Image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KyvernoHelmValuesBackgroundControllerPodLabels = object;

export type KyvernoHelmValuesBackgroundControllerPodAnnotations = object;

export type KyvernoHelmValuesBackgroundControllerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesBackgroundControllerUpdateStrategy = {
  /**
   * @default {"maxSurge":1,"maxUnavailable":"40%"}
   */
  rollingUpdate?: KyvernoHelmValuesBackgroundControllerUpdateStrategyRollingUpdate;
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type KyvernoHelmValuesBackgroundControllerUpdateStrategyRollingUpdate = {
  /**
   * @default 1
   */
  maxSurge?: number;
  /**
   * @default "40%"
   */
  maxUnavailable?: string;
};

export type KyvernoHelmValuesBackgroundControllerExtraArgs = object;

export type KyvernoHelmValuesBackgroundControllerResources = {
  /**
   * Pod resource limits
   *
   * @default {"memory":"128Mi"}
   */
  limits?: KyvernoHelmValuesBackgroundControllerResourcesLimits;
  /**
   * Pod resource requests
   *
   * @default {"cpu":"100m","memory":"64Mi"}
   */
  requests?: KyvernoHelmValuesBackgroundControllerResourcesRequests;
};

export type KyvernoHelmValuesBackgroundControllerResourcesLimits = {
  /**
   * @default "128Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesBackgroundControllerResourcesRequests = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "64Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesBackgroundControllerNodeSelector = object;

export type KyvernoHelmValuesBackgroundControllerAntiAffinity = {
  /**
   * Pod antiAffinities toggle.
   * Enabled by default but can be disabled if you want to schedule pods to the same node.
   *
   * @default true
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesBackgroundControllerPodAntiAffinity = {
  preferredDuringSchedulingIgnoredDuringExecution?: KyvernoHelmValuesBackgroundControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type KyvernoHelmValuesBackgroundControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement =
  {
    /**
     * @default 1
     */
    weight?: number;
    /**
     * @default {"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["background-controller"]}]},"topologyKey":"kubernetes.io/hostname"}
     */
    podAffinityTerm?: KyvernoHelmValuesBackgroundControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTerm;
  };

export type KyvernoHelmValuesBackgroundControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTerm =
  {
    /**
     * @default {"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["background-controller"]}]}
     */
    labelSelector?: KyvernoHelmValuesBackgroundControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelector;
    /**
     * @default "kubernetes.io/hostname"
     */
    topologyKey?: string;
  };

export type KyvernoHelmValuesBackgroundControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelector =
  {
    matchExpressions?: KyvernoHelmValuesBackgroundControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelectorMatchExpressionsElement[];
  };

export type KyvernoHelmValuesBackgroundControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelectorMatchExpressionsElement =
  {
    /**
     * @default "app.kubernetes.io/component"
     */
    key?: string;
    /**
     * @default "In"
     */
    operator?: string;
    values?: string[];
  };

export type KyvernoHelmValuesBackgroundControllerPodAffinity = object;

export type KyvernoHelmValuesBackgroundControllerNodeAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesBackgroundControllerPodSecurityContext = object;

export type KyvernoHelmValuesBackgroundControllerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  privileged?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KyvernoHelmValuesBackgroundControllerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KyvernoHelmValuesBackgroundControllerSecurityContextSeccompProfile;
};

export type KyvernoHelmValuesBackgroundControllerSecurityContextCapabilities = {
  drop?: string[];
};

export type KyvernoHelmValuesBackgroundControllerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KyvernoHelmValuesBackgroundControllerPodDisruptionBudget = {
  /**
   * Enable PodDisruptionBudget.
   * Will always be enabled if replicas > 1. This non-declarative behavior should ideally be avoided, but changing it now would be breaking.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Configures the minimum available pods for disruptions.
   * Cannot be used if `maxUnavailable` is set.
   *
   * @default 1
   */
  minAvailable?: number;
  maxUnavailable?: unknown;
};

export type KyvernoHelmValuesBackgroundControllerCaCertificates = {
  data?: unknown;
  /**
   * Volume to be mounted for CA certificates
   * Not used when `.Values.backgroundController.caCertificates.data` is defined
   *
   * @default {}
   */
  volume?: KyvernoHelmValuesBackgroundControllerCaCertificatesVolume;
};

export type KyvernoHelmValuesBackgroundControllerCaCertificatesVolume = object;

export type KyvernoHelmValuesBackgroundControllerMetricsService = {
  /**
   * Create service.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Service port.
   * Metrics server will be exposed at this port.
   *
   * @default 8000
   */
  port?: number;
  /**
   * Service type.
   *
   * @default "ClusterIP"
   */
  type?: string;
  nodePort?: unknown;
  /**
   * @default {}
   */
  annotations?: KyvernoHelmValuesBackgroundControllerMetricsServiceAnnotations;
};

export type KyvernoHelmValuesBackgroundControllerMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesBackgroundControllerNetworkPolicy = {
  /**
   * When true, use a NetworkPolicy to allow ingress to the webhook
   * This is useful on clusters using Calico and/or native k8s network policies in a default-deny setup.
   *
   * @default false
   */
  enabled?: boolean;
  ingressFrom?: unknown[];
};

export type KyvernoHelmValuesBackgroundControllerServiceMonitor = {
  /**
   * Create a `ServiceMonitor` to collect Prometheus metrics.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KyvernoHelmValuesBackgroundControllerServiceMonitorAdditionalLabels;
  namespace?: unknown;
  /**
   * Interval to scrape metrics
   *
   * @default "30s"
   */
  interval?: string;
  /**
   * Timeout if metrics can't be retrieved in given time interval
   *
   * @default "25s"
   */
  scrapeTimeout?: string;
  /**
   * Is TLS required for endpoint
   *
   * @default false
   */
  secure?: boolean;
  /**
   * TLS Configuration for endpoint
   *
   * @default {}
   */
  tlsConfig?: KyvernoHelmValuesBackgroundControllerServiceMonitorTlsConfig;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
};

export type KyvernoHelmValuesBackgroundControllerServiceMonitorAdditionalLabels = object;

export type KyvernoHelmValuesBackgroundControllerServiceMonitorTlsConfig = object;

export type KyvernoHelmValuesBackgroundControllerTracing = {
  /**
   * Enable tracing
   *
   * @default false
   */
  enabled?: boolean;
  address?: unknown;
  port?: unknown;
  /**
   * @default ""
   */
  creds?: string;
};

export type KyvernoHelmValuesBackgroundControllerMetering = {
  /**
   * Disable metrics export
   *
   * @default false
   */
  disabled?: boolean;
  /**
   * Otel configuration, can be `prometheus` or `grpc`
   *
   * @default "prometheus"
   */
  config?: string;
  /**
   * Prometheus endpoint port
   *
   * @default 8000
   */
  port?: number;
  /**
   * Otel collector endpoint
   *
   * @default ""
   */
  collector?: string;
  /**
   * Otel collector credentials
   *
   * @default ""
   */
  creds?: string;
};

export type KyvernoHelmValuesBackgroundControllerServer = {
  /**
   * @default 9443
   */
  port?: number;
};

export type KyvernoHelmValuesBackgroundControllerProfiling = {
  /**
   * Enable profiling
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Profiling endpoint port
   *
   * @default 6060
   */
  port?: number;
  /**
   * Service type.
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  nodePort?: unknown;
};

export type KyvernoHelmValuesCleanupController = {
  /**
   * Overrides features defined at the root level
   *
   * @default {}
   */
  featuresOverride?: KyvernoHelmValuesCleanupControllerFeaturesOverride;
  /**
   * Enable cleanup controller.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"create":true,"serviceAccount":{"name":null,"annotations":{}},"clusterRole":{"extraResources":[]}}
   */
  rbac?: KyvernoHelmValuesCleanupControllerRbac;
  /**
   * @default false
   */
  createSelfSignedCert?: boolean;
  /**
   * @default {...} (5 keys)
   */
  image?: KyvernoHelmValuesCleanupControllerImage;
  imagePullSecrets?: unknown[];
  replicas?: unknown;
  /**
   * The number of revisions to keep
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * Resync period for informers
   *
   * @default "15m"
   */
  resyncPeriod?: string;
  /**
   * Additional labels to add to each pod
   *
   * @default {}
   */
  podLabels?: KyvernoHelmValuesCleanupControllerPodLabels;
  /**
   * example.com/label: foo
   * Additional annotations to add to each pod
   *
   * @default {}
   */
  podAnnotations?: KyvernoHelmValuesCleanupControllerPodAnnotations;
  /**
   * example.com/annotation: foo
   * Deployment annotations.
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesCleanupControllerAnnotations;
  /**
   * Deployment update strategy.
   * Ref: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy
   *
   * @default {"rollingUpdate":{"maxSurge":1,"maxUnavailable":"40%"},"type":"RollingUpdate"}
   */
  updateStrategy?: KyvernoHelmValuesCleanupControllerUpdateStrategy;
  /**
   * Optional priority class
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Change `hostNetwork` to `true` when you want the pod to share its host's network namespace.
   * Useful for situations like when you end up dealing with a custom CNI over Amazon EKS.
   * Update the `dnsPolicy` accordingly as well to suit the host network mode.
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * cleanupController server port
   * in case you are using hostNetwork: true, you might want to change the port the cleanupController is listening to
   *
   * @default {"port":9443}
   */
  server?: KyvernoHelmValuesCleanupControllerServer;
  /**
   * cleanupController webhook server port
   * in case you are using hostNetwork: true, you might want to change the port the webhookServer is listening to
   *
   * @default {"port":9443}
   */
  webhookServer?: KyvernoHelmValuesCleanupControllerWebhookServer;
  /**
   * `dnsPolicy` determines the manner in which DNS resolution happens in the cluster.
   * In case of `hostNetwork: true`, usually, the `dnsPolicy` is suitable to be `ClusterFirstWithHostNet`.
   * For further reference: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-s-dns-policy.
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Extra arguments passed to the container on the command line
   *
   * @default {}
   */
  extraArgs?: KyvernoHelmValuesCleanupControllerExtraArgs;
  extraEnvVars?: unknown[];
  /**
   * @default {"limits":{"memory":"128Mi"},"requests":{"cpu":"100m","memory":"64Mi"}}
   */
  resources?: KyvernoHelmValuesCleanupControllerResources;
  /**
   * Startup probe.
   * The block is directly forwarded into the deployment, so you can use whatever startupProbes configuration you want.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/
   *
   * @default {...} (4 keys)
   */
  startupProbe?: KyvernoHelmValuesCleanupControllerStartupProbe;
  /**
   * Liveness probe.
   * The block is directly forwarded into the deployment, so you can use whatever livenessProbe configuration you want.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: KyvernoHelmValuesCleanupControllerLivenessProbe;
  /**
   * Readiness Probe.
   * The block is directly forwarded into the deployment, so you can use whatever readinessProbe configuration you want.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: KyvernoHelmValuesCleanupControllerReadinessProbe;
  /**
   * Node labels for pod assignment
   *
   * @default {}
   */
  nodeSelector?: KyvernoHelmValuesCleanupControllerNodeSelector;
  tolerations?: unknown[];
  /**
   * @default {"enabled":true}
   */
  antiAffinity?: KyvernoHelmValuesCleanupControllerAntiAffinity;
  /**
   * Pod anti affinity constraints.
   *
   * @default {"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":1,"podAffinityTerm":{"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["cleanup-controller"]}]},"topologyKey":"kubernetes.io/hostname"}}]}
   */
  podAntiAffinity?: KyvernoHelmValuesCleanupControllerPodAntiAffinity;
  /**
   * Pod affinity constraints.
   *
   * @default {}
   */
  podAffinity?: KyvernoHelmValuesCleanupControllerPodAffinity;
  /**
   * Node affinity constraints.
   *
   * @default {}
   */
  nodeAffinity?: KyvernoHelmValuesCleanupControllerNodeAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Security context for the pod
   *
   * @default {}
   */
  podSecurityContext?: KyvernoHelmValuesCleanupControllerPodSecurityContext;
  /**
   * Security context for the containers
   *
   * @default {...} (6 keys)
   */
  securityContext?: KyvernoHelmValuesCleanupControllerSecurityContext;
  /**
   * @default {"enabled":false,"minAvailable":1,"maxUnavailable":null}
   */
  podDisruptionBudget?: KyvernoHelmValuesCleanupControllerPodDisruptionBudget;
  /**
   * @default {...} (4 keys)
   */
  service?: KyvernoHelmValuesCleanupControllerService;
  /**
   * @default {...} (5 keys)
   */
  metricsService?: KyvernoHelmValuesCleanupControllerMetricsService;
  /**
   * @default {"enabled":false,"ingressFrom":[]}
   */
  networkPolicy?: KyvernoHelmValuesCleanupControllerNetworkPolicy;
  /**
   * @default {...} (9 keys)
   */
  serviceMonitor?: KyvernoHelmValuesCleanupControllerServiceMonitor;
  /**
   * @default {...} (4 keys)
   */
  tracing?: KyvernoHelmValuesCleanupControllerTracing;
  /**
   * @default {...} (5 keys)
   */
  metering?: KyvernoHelmValuesCleanupControllerMetering;
  /**
   * @default {...} (4 keys)
   */
  profiling?: KyvernoHelmValuesCleanupControllerProfiling;
};

export type KyvernoHelmValuesCleanupControllerFeaturesOverride = object;

export type KyvernoHelmValuesCleanupControllerRbac = {
  /**
   * Create RBAC resources
   *
   * @default true
   */
  create?: boolean;
  /**
   * @default {"name":null,"annotations":{}}
   */
  serviceAccount?: KyvernoHelmValuesCleanupControllerRbacServiceAccount;
  /**
   * Create self-signed certificates at deployment time.
   * The certificates won't be automatically renewed if this is set to `true`.
   *
   * @default {"extraResources":[]}
   */
  clusterRole?: KyvernoHelmValuesCleanupControllerRbacClusterRole;
};

export type KyvernoHelmValuesCleanupControllerRbacServiceAccount = {
  name?: unknown;
  /**
   * Annotations for the ServiceAccount
   * example.com/annotation: value
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesCleanupControllerRbacServiceAccountAnnotations;
};

export type KyvernoHelmValuesCleanupControllerRbacServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesCleanupControllerRbacClusterRole = {
  extraResources?: unknown[];
};

export type KyvernoHelmValuesCleanupControllerImage = {
  registry?: unknown;
  /**
   * @default "ghcr.io"
   */
  defaultRegistry?: string;
  /**
   * Image repository
   *
   * @default "kyverno/cleanup-controller"
   */
  repository?: string;
  tag?: unknown;
  /**
   * Image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KyvernoHelmValuesCleanupControllerPodLabels = object;

export type KyvernoHelmValuesCleanupControllerPodAnnotations = object;

export type KyvernoHelmValuesCleanupControllerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesCleanupControllerUpdateStrategy = {
  /**
   * @default {"maxSurge":1,"maxUnavailable":"40%"}
   */
  rollingUpdate?: KyvernoHelmValuesCleanupControllerUpdateStrategyRollingUpdate;
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type KyvernoHelmValuesCleanupControllerUpdateStrategyRollingUpdate = {
  /**
   * @default 1
   */
  maxSurge?: number;
  /**
   * @default "40%"
   */
  maxUnavailable?: string;
};

export type KyvernoHelmValuesCleanupControllerServer = {
  /**
   * @default 9443
   */
  port?: number;
};

export type KyvernoHelmValuesCleanupControllerWebhookServer = {
  /**
   * @default 9443
   */
  port?: number;
};

export type KyvernoHelmValuesCleanupControllerExtraArgs = object;

export type KyvernoHelmValuesCleanupControllerResources = {
  /**
   * Pod resource limits
   *
   * @default {"memory":"128Mi"}
   */
  limits?: KyvernoHelmValuesCleanupControllerResourcesLimits;
  /**
   * Pod resource requests
   *
   * @default {"cpu":"100m","memory":"64Mi"}
   */
  requests?: KyvernoHelmValuesCleanupControllerResourcesRequests;
};

export type KyvernoHelmValuesCleanupControllerResourcesLimits = {
  /**
   * @default "128Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesCleanupControllerResourcesRequests = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "64Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesCleanupControllerStartupProbe = {
  /**
   * @default {"path":"/health/liveness","port":9443,"scheme":"HTTPS"}
   */
  httpGet?: KyvernoHelmValuesCleanupControllerStartupProbeHttpGet;
  /**
   * @default 20
   */
  failureThreshold?: number;
  /**
   * @default 2
   */
  initialDelaySeconds?: number;
  /**
   * @default 6
   */
  periodSeconds?: number;
};

export type KyvernoHelmValuesCleanupControllerStartupProbeHttpGet = {
  /**
   * @default "/health/liveness"
   */
  path?: string;
  /**
   * @default 9443
   */
  port?: number;
  /**
   * @default "HTTPS"
   */
  scheme?: string;
};

export type KyvernoHelmValuesCleanupControllerLivenessProbe = {
  /**
   * @default {"path":"/health/liveness","port":9443,"scheme":"HTTPS"}
   */
  httpGet?: KyvernoHelmValuesCleanupControllerLivenessProbeHttpGet;
  /**
   * @default 15
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
   * @default 2
   */
  failureThreshold?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
};

export type KyvernoHelmValuesCleanupControllerLivenessProbeHttpGet = {
  /**
   * @default "/health/liveness"
   */
  path?: string;
  /**
   * @default 9443
   */
  port?: number;
  /**
   * @default "HTTPS"
   */
  scheme?: string;
};

export type KyvernoHelmValuesCleanupControllerReadinessProbe = {
  /**
   * @default {"path":"/health/readiness","port":9443,"scheme":"HTTPS"}
   */
  httpGet?: KyvernoHelmValuesCleanupControllerReadinessProbeHttpGet;
  /**
   * @default 5
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
   * @default 6
   */
  failureThreshold?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
};

export type KyvernoHelmValuesCleanupControllerReadinessProbeHttpGet = {
  /**
   * @default "/health/readiness"
   */
  path?: string;
  /**
   * @default 9443
   */
  port?: number;
  /**
   * @default "HTTPS"
   */
  scheme?: string;
};

export type KyvernoHelmValuesCleanupControllerNodeSelector = object;

export type KyvernoHelmValuesCleanupControllerAntiAffinity = {
  /**
   * Pod antiAffinities toggle.
   * Enabled by default but can be disabled if you want to schedule pods to the same node.
   *
   * @default true
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesCleanupControllerPodAntiAffinity = {
  preferredDuringSchedulingIgnoredDuringExecution?: KyvernoHelmValuesCleanupControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type KyvernoHelmValuesCleanupControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default 1
   */
  weight?: number;
  /**
   * @default {"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["cleanup-controller"]}]},"topologyKey":"kubernetes.io/hostname"}
   */
  podAffinityTerm?: KyvernoHelmValuesCleanupControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTerm;
};

export type KyvernoHelmValuesCleanupControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTerm =
  {
    /**
     * @default {"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["cleanup-controller"]}]}
     */
    labelSelector?: KyvernoHelmValuesCleanupControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelector;
    /**
     * @default "kubernetes.io/hostname"
     */
    topologyKey?: string;
  };

export type KyvernoHelmValuesCleanupControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelector =
  {
    matchExpressions?: KyvernoHelmValuesCleanupControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelectorMatchExpressionsElement[];
  };

export type KyvernoHelmValuesCleanupControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelectorMatchExpressionsElement =
  {
    /**
     * @default "app.kubernetes.io/component"
     */
    key?: string;
    /**
     * @default "In"
     */
    operator?: string;
    values?: string[];
  };

export type KyvernoHelmValuesCleanupControllerPodAffinity = object;

export type KyvernoHelmValuesCleanupControllerNodeAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesCleanupControllerPodSecurityContext = object;

export type KyvernoHelmValuesCleanupControllerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  privileged?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KyvernoHelmValuesCleanupControllerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KyvernoHelmValuesCleanupControllerSecurityContextSeccompProfile;
};

export type KyvernoHelmValuesCleanupControllerSecurityContextCapabilities = {
  drop?: string[];
};

export type KyvernoHelmValuesCleanupControllerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KyvernoHelmValuesCleanupControllerPodDisruptionBudget = {
  /**
   * Enable PodDisruptionBudget.
   * Will always be enabled if replicas > 1. This non-declarative behavior should ideally be avoided, but changing it now would be breaking.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Configures the minimum available pods for disruptions.
   * Cannot be used if `maxUnavailable` is set.
   *
   * @default 1
   */
  minAvailable?: number;
  maxUnavailable?: unknown;
};

export type KyvernoHelmValuesCleanupControllerService = {
  /**
   * Service port.
   *
   * @default 443
   */
  port?: number;
  /**
   * Service type.
   *
   * @default "ClusterIP"
   */
  type?: string;
  nodePort?: unknown;
  /**
   * @default {}
   */
  annotations?: KyvernoHelmValuesCleanupControllerServiceAnnotations;
};

export type KyvernoHelmValuesCleanupControllerServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesCleanupControllerMetricsService = {
  /**
   * Create service.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Service port.
   * Metrics server will be exposed at this port.
   *
   * @default 8000
   */
  port?: number;
  /**
   * Service type.
   *
   * @default "ClusterIP"
   */
  type?: string;
  nodePort?: unknown;
  /**
   * @default {}
   */
  annotations?: KyvernoHelmValuesCleanupControllerMetricsServiceAnnotations;
};

export type KyvernoHelmValuesCleanupControllerMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesCleanupControllerNetworkPolicy = {
  /**
   * When true, use a NetworkPolicy to allow ingress to the webhook
   * This is useful on clusters using Calico and/or native k8s network policies in a default-deny setup.
   *
   * @default false
   */
  enabled?: boolean;
  ingressFrom?: unknown[];
};

export type KyvernoHelmValuesCleanupControllerServiceMonitor = {
  /**
   * Create a `ServiceMonitor` to collect Prometheus metrics.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KyvernoHelmValuesCleanupControllerServiceMonitorAdditionalLabels;
  namespace?: unknown;
  /**
   * Interval to scrape metrics
   *
   * @default "30s"
   */
  interval?: string;
  /**
   * Timeout if metrics can't be retrieved in given time interval
   *
   * @default "25s"
   */
  scrapeTimeout?: string;
  /**
   * Is TLS required for endpoint
   *
   * @default false
   */
  secure?: boolean;
  /**
   * TLS Configuration for endpoint
   *
   * @default {}
   */
  tlsConfig?: KyvernoHelmValuesCleanupControllerServiceMonitorTlsConfig;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
};

export type KyvernoHelmValuesCleanupControllerServiceMonitorAdditionalLabels = object;

export type KyvernoHelmValuesCleanupControllerServiceMonitorTlsConfig = object;

export type KyvernoHelmValuesCleanupControllerTracing = {
  /**
   * Enable tracing
   *
   * @default false
   */
  enabled?: boolean;
  address?: unknown;
  port?: unknown;
  /**
   * @default ""
   */
  creds?: string;
};

export type KyvernoHelmValuesCleanupControllerMetering = {
  /**
   * Disable metrics export
   *
   * @default false
   */
  disabled?: boolean;
  /**
   * Otel configuration, can be `prometheus` or `grpc`
   *
   * @default "prometheus"
   */
  config?: string;
  /**
   * Prometheus endpoint port
   *
   * @default 8000
   */
  port?: number;
  /**
   * Otel collector endpoint
   *
   * @default ""
   */
  collector?: string;
  /**
   * Otel collector credentials
   *
   * @default ""
   */
  creds?: string;
};

export type KyvernoHelmValuesCleanupControllerProfiling = {
  /**
   * Enable profiling
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Profiling endpoint port
   *
   * @default 6060
   */
  port?: number;
  /**
   * Service type.
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  nodePort?: unknown;
};

export type KyvernoHelmValuesReportsController = {
  /**
   * Overrides features defined at the root level
   *
   * @default {}
   */
  featuresOverride?: KyvernoHelmValuesReportsControllerFeaturesOverride;
  /**
   * Enable reports controller.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {...} (6 keys)
   */
  rbac?: KyvernoHelmValuesReportsControllerRbac;
  /**
   * @default {...} (5 keys)
   */
  image?: KyvernoHelmValuesReportsControllerImage;
  imagePullSecrets?: unknown[];
  replicas?: unknown;
  /**
   * The number of revisions to keep
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * Resync period for informers
   *
   * @default "15m"
   */
  resyncPeriod?: string;
  /**
   * Additional labels to add to each pod
   *
   * @default {}
   */
  podLabels?: KyvernoHelmValuesReportsControllerPodLabels;
  /**
   * example.com/label: foo
   * Additional annotations to add to each pod
   *
   * @default {}
   */
  podAnnotations?: KyvernoHelmValuesReportsControllerPodAnnotations;
  /**
   * example.com/annotation: foo
   * Deployment annotations.
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesReportsControllerAnnotations;
  /**
   * Deployment update strategy.
   * Ref: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy
   *
   * @default {"rollingUpdate":{"maxSurge":1,"maxUnavailable":"40%"},"type":"RollingUpdate"}
   */
  updateStrategy?: KyvernoHelmValuesReportsControllerUpdateStrategy;
  /**
   * Optional priority class
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Change `apiPriorityAndFairness` to `true` if you want to insulate the API calls made by Kyverno reports controller activities.
   * This will help ensure Kyverno reports stability in busy clusters.
   * Ref: https://kubernetes.io/docs/concepts/cluster-administration/flow-control/
   *
   * @default false
   */
  apiPriorityAndFairness?: boolean;
  /**
   * Priority level configuration.
   * The block is directly forwarded into the priorityLevelConfiguration, so you can use whatever specification you want.
   * ref: https://kubernetes.io/docs/concepts/cluster-administration/flow-control/#prioritylevelconfiguration
   *
   * @default {"type":"Limited","limited":{"nominalConcurrencyShares":10,"limitResponse":{"queuing":{"queueLengthLimit":50},"type":"Queue"}}}
   */
  priorityLevelConfigurationSpec?: KyvernoHelmValuesReportsControllerPriorityLevelConfigurationSpec;
  /**
   * Change `hostNetwork` to `true` when you want the pod to share its host's network namespace.
   * Useful for situations like when you end up dealing with a custom CNI over Amazon EKS.
   * Update the `dnsPolicy` accordingly as well to suit the host network mode.
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * `dnsPolicy` determines the manner in which DNS resolution happens in the cluster.
   * In case of `hostNetwork: true`, usually, the `dnsPolicy` is suitable to be `ClusterFirstWithHostNet`.
   * For further reference: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-s-dns-policy.
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Extra arguments passed to the container on the command line
   *
   * @default {}
   */
  extraArgs?: KyvernoHelmValuesReportsControllerExtraArgs;
  extraEnvVars?: unknown[];
  /**
   * @default {"limits":{"memory":"128Mi"},"requests":{"cpu":"100m","memory":"64Mi"}}
   */
  resources?: KyvernoHelmValuesReportsControllerResources;
  /**
   * Node labels for pod assignment
   *
   * @default {}
   */
  nodeSelector?: KyvernoHelmValuesReportsControllerNodeSelector;
  tolerations?: unknown[];
  /**
   * @default {"enabled":true}
   */
  antiAffinity?: KyvernoHelmValuesReportsControllerAntiAffinity;
  /**
   * Pod anti affinity constraints.
   *
   * @default {"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":1,"podAffinityTerm":{"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["reports-controller"]}]},"topologyKey":"kubernetes.io/hostname"}}]}
   */
  podAntiAffinity?: KyvernoHelmValuesReportsControllerPodAntiAffinity;
  /**
   * Pod affinity constraints.
   *
   * @default {}
   */
  podAffinity?: KyvernoHelmValuesReportsControllerPodAffinity;
  /**
   * Node affinity constraints.
   *
   * @default {}
   */
  nodeAffinity?: KyvernoHelmValuesReportsControllerNodeAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Security context for the pod
   *
   * @default {}
   */
  podSecurityContext?: KyvernoHelmValuesReportsControllerPodSecurityContext;
  /**
   * Security context for the containers
   *
   * @default {...} (6 keys)
   */
  securityContext?: KyvernoHelmValuesReportsControllerSecurityContext;
  /**
   * @default {"enabled":false,"minAvailable":1,"maxUnavailable":null}
   */
  podDisruptionBudget?: KyvernoHelmValuesReportsControllerPodDisruptionBudget;
  /**
   * @default "/.sigstore"
   */
  tufRootMountPath?: string;
  /**
   * Volume to be mounted in pods for TUF/cosign work.
   *
   * @default {"emptyDir":{}}
   */
  sigstoreVolume?: KyvernoHelmValuesReportsControllerSigstoreVolume;
  /**
   * @default {"data":null,"volume":{}}
   */
  caCertificates?: KyvernoHelmValuesReportsControllerCaCertificates;
  /**
   * @default {...} (5 keys)
   */
  metricsService?: KyvernoHelmValuesReportsControllerMetricsService;
  /**
   * @default {"enabled":false,"ingressFrom":[]}
   */
  networkPolicy?: KyvernoHelmValuesReportsControllerNetworkPolicy;
  /**
   * @default {...} (9 keys)
   */
  serviceMonitor?: KyvernoHelmValuesReportsControllerServiceMonitor;
  /**
   * @default {...} (4 keys)
   */
  tracing?: KyvernoHelmValuesReportsControllerTracing;
  /**
   * @default {...} (5 keys)
   */
  metering?: KyvernoHelmValuesReportsControllerMetering;
  /**
   * reportsController server port
   * in case you are using hostNetwork: true, you might want to change the port the reportsController is listening to
   *
   * @default {"port":9443}
   */
  server?: KyvernoHelmValuesReportsControllerServer;
  /**
   * @default {...} (4 keys)
   */
  profiling?: KyvernoHelmValuesReportsControllerProfiling;
  /**
   * @default true
   */
  sanityChecks?: boolean;
};

export type KyvernoHelmValuesReportsControllerFeaturesOverride = object;

export type KyvernoHelmValuesReportsControllerRbac = {
  /**
   * Create RBAC resources
   *
   * @default true
   */
  create?: boolean;
  /**
   * Create rolebinding to view role
   *
   * @default true
   */
  createViewRoleBinding?: boolean;
  /**
   * The view role to use in the rolebinding
   *
   * @default "view"
   */
  viewRoleName?: string;
  /**
   * @default {"name":null,"annotations":{}}
   */
  serviceAccount?: KyvernoHelmValuesReportsControllerRbacServiceAccount;
  /**
   * @default {"extraResources":[]}
   */
  coreClusterRole?: KyvernoHelmValuesReportsControllerRbacCoreClusterRole;
  /**
   * @default {"extraResources":[]}
   */
  clusterRole?: KyvernoHelmValuesReportsControllerRbacClusterRole;
};

export type KyvernoHelmValuesReportsControllerRbacServiceAccount = {
  name?: unknown;
  /**
   * Annotations for the ServiceAccount
   * example.com/annotation: value
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesReportsControllerRbacServiceAccountAnnotations;
};

export type KyvernoHelmValuesReportsControllerRbacServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesReportsControllerRbacCoreClusterRole = {
  extraResources?: unknown[];
};

export type KyvernoHelmValuesReportsControllerRbacClusterRole = {
  extraResources?: unknown[];
};

export type KyvernoHelmValuesReportsControllerImage = {
  registry?: unknown;
  /**
   * @default "ghcr.io"
   */
  defaultRegistry?: string;
  /**
   * Image repository
   *
   * @default "kyverno/reports-controller"
   */
  repository?: string;
  tag?: unknown;
  /**
   * Image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KyvernoHelmValuesReportsControllerPodLabels = object;

export type KyvernoHelmValuesReportsControllerPodAnnotations = object;

export type KyvernoHelmValuesReportsControllerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesReportsControllerUpdateStrategy = {
  /**
   * @default {"maxSurge":1,"maxUnavailable":"40%"}
   */
  rollingUpdate?: KyvernoHelmValuesReportsControllerUpdateStrategyRollingUpdate;
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type KyvernoHelmValuesReportsControllerUpdateStrategyRollingUpdate = {
  /**
   * @default 1
   */
  maxSurge?: number;
  /**
   * @default "40%"
   */
  maxUnavailable?: string;
};

export type KyvernoHelmValuesReportsControllerPriorityLevelConfigurationSpec = {
  /**
   * @default "Limited"
   */
  type?: string;
  /**
   * @default {"nominalConcurrencyShares":10,"limitResponse":{"queuing":{"queueLengthLimit":50},"type":"Queue"}}
   */
  limited?: KyvernoHelmValuesReportsControllerPriorityLevelConfigurationSpecLimited;
};

export type KyvernoHelmValuesReportsControllerPriorityLevelConfigurationSpecLimited = {
  /**
   * @default 10
   */
  nominalConcurrencyShares?: number;
  /**
   * @default {"queuing":{"queueLengthLimit":50},"type":"Queue"}
   */
  limitResponse?: KyvernoHelmValuesReportsControllerPriorityLevelConfigurationSpecLimitedLimitResponse;
};

export type KyvernoHelmValuesReportsControllerPriorityLevelConfigurationSpecLimitedLimitResponse = {
  /**
   * @default {"queueLengthLimit":50}
   */
  queuing?: KyvernoHelmValuesReportsControllerPriorityLevelConfigurationSpecLimitedLimitResponseQueuing;
  /**
   * @default "Queue"
   */
  type?: string;
};

export type KyvernoHelmValuesReportsControllerPriorityLevelConfigurationSpecLimitedLimitResponseQueuing = {
  /**
   * @default 50
   */
  queueLengthLimit?: number;
};

export type KyvernoHelmValuesReportsControllerExtraArgs = object;

export type KyvernoHelmValuesReportsControllerResources = {
  /**
   * Pod resource limits
   *
   * @default {"memory":"128Mi"}
   */
  limits?: KyvernoHelmValuesReportsControllerResourcesLimits;
  /**
   * Pod resource requests
   *
   * @default {"cpu":"100m","memory":"64Mi"}
   */
  requests?: KyvernoHelmValuesReportsControllerResourcesRequests;
};

export type KyvernoHelmValuesReportsControllerResourcesLimits = {
  /**
   * @default "128Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesReportsControllerResourcesRequests = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "64Mi"
   */
  memory?: string;
};

export type KyvernoHelmValuesReportsControllerNodeSelector = object;

export type KyvernoHelmValuesReportsControllerAntiAffinity = {
  /**
   * Pod antiAffinities toggle.
   * Enabled by default but can be disabled if you want to schedule pods to the same node.
   *
   * @default true
   */
  enabled?: boolean;
};

export type KyvernoHelmValuesReportsControllerPodAntiAffinity = {
  preferredDuringSchedulingIgnoredDuringExecution?: KyvernoHelmValuesReportsControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type KyvernoHelmValuesReportsControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default 1
   */
  weight?: number;
  /**
   * @default {"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["reports-controller"]}]},"topologyKey":"kubernetes.io/hostname"}
   */
  podAffinityTerm?: KyvernoHelmValuesReportsControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTerm;
};

export type KyvernoHelmValuesReportsControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTerm =
  {
    /**
     * @default {"matchExpressions":[{"key":"app.kubernetes.io/component","operator":"In","values":["reports-controller"]}]}
     */
    labelSelector?: KyvernoHelmValuesReportsControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelector;
    /**
     * @default "kubernetes.io/hostname"
     */
    topologyKey?: string;
  };

export type KyvernoHelmValuesReportsControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelector =
  {
    matchExpressions?: KyvernoHelmValuesReportsControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelectorMatchExpressionsElement[];
  };

export type KyvernoHelmValuesReportsControllerPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelectorMatchExpressionsElement =
  {
    /**
     * @default "app.kubernetes.io/component"
     */
    key?: string;
    /**
     * @default "In"
     */
    operator?: string;
    values?: string[];
  };

export type KyvernoHelmValuesReportsControllerPodAffinity = object;

export type KyvernoHelmValuesReportsControllerNodeAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesReportsControllerPodSecurityContext = object;

export type KyvernoHelmValuesReportsControllerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default false
   */
  privileged?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KyvernoHelmValuesReportsControllerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KyvernoHelmValuesReportsControllerSecurityContextSeccompProfile;
};

export type KyvernoHelmValuesReportsControllerSecurityContextCapabilities = {
  drop?: string[];
};

export type KyvernoHelmValuesReportsControllerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KyvernoHelmValuesReportsControllerPodDisruptionBudget = {
  /**
   * Enable PodDisruptionBudget.
   * Will always be enabled if replicas > 1. This non-declarative behavior should ideally be avoided, but changing it now would be breaking.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Configures the minimum available pods for disruptions.
   * Cannot be used if `maxUnavailable` is set.
   *
   * @default 1
   */
  minAvailable?: number;
  maxUnavailable?: unknown;
};

export type KyvernoHelmValuesReportsControllerSigstoreVolume = {
  /**
   * @default {}
   */
  emptyDir?: KyvernoHelmValuesReportsControllerSigstoreVolumeEmptyDir;
};

export type KyvernoHelmValuesReportsControllerSigstoreVolumeEmptyDir = object;

export type KyvernoHelmValuesReportsControllerCaCertificates = {
  data?: unknown;
  /**
   * Volume to be mounted for CA certificates
   * Not used when `.Values.reportsController.caCertificates.data` is defined
   *
   * @default {}
   */
  volume?: KyvernoHelmValuesReportsControllerCaCertificatesVolume;
};

export type KyvernoHelmValuesReportsControllerCaCertificatesVolume = object;

export type KyvernoHelmValuesReportsControllerMetricsService = {
  /**
   * Create service.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Service port.
   * Metrics server will be exposed at this port.
   *
   * @default 8000
   */
  port?: number;
  /**
   * Service type.
   *
   * @default "ClusterIP"
   */
  type?: string;
  nodePort?: unknown;
  /**
   * Service annotations.
   *
   * @default {}
   */
  annotations?: KyvernoHelmValuesReportsControllerMetricsServiceAnnotations;
};

export type KyvernoHelmValuesReportsControllerMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KyvernoHelmValuesReportsControllerNetworkPolicy = {
  /**
   * When true, use a NetworkPolicy to allow ingress to the webhook
   * This is useful on clusters using Calico and/or native k8s network policies in a default-deny setup.
   *
   * @default false
   */
  enabled?: boolean;
  ingressFrom?: unknown[];
};

export type KyvernoHelmValuesReportsControllerServiceMonitor = {
  /**
   * Create a `ServiceMonitor` to collect Prometheus metrics.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KyvernoHelmValuesReportsControllerServiceMonitorAdditionalLabels;
  namespace?: unknown;
  /**
   * Interval to scrape metrics
   *
   * @default "30s"
   */
  interval?: string;
  /**
   * Timeout if metrics can't be retrieved in given time interval
   *
   * @default "25s"
   */
  scrapeTimeout?: string;
  /**
   * Is TLS required for endpoint
   *
   * @default false
   */
  secure?: boolean;
  /**
   * TLS Configuration for endpoint
   *
   * @default {}
   */
  tlsConfig?: KyvernoHelmValuesReportsControllerServiceMonitorTlsConfig;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
};

export type KyvernoHelmValuesReportsControllerServiceMonitorAdditionalLabels = object;

export type KyvernoHelmValuesReportsControllerServiceMonitorTlsConfig = object;

export type KyvernoHelmValuesReportsControllerTracing = {
  /**
   * Enable tracing
   *
   * @default false
   */
  enabled?: boolean;
  address?: unknown;
  port?: unknown;
  creds?: unknown;
};

export type KyvernoHelmValuesReportsControllerMetering = {
  /**
   * Disable metrics export
   *
   * @default false
   */
  disabled?: boolean;
  /**
   * Otel configuration, can be `prometheus` or `grpc`
   *
   * @default "prometheus"
   */
  config?: string;
  /**
   * Prometheus endpoint port
   *
   * @default 8000
   */
  port?: number;
  collector?: unknown;
  creds?: unknown;
};

export type KyvernoHelmValuesReportsControllerServer = {
  /**
   * @default 9443
   */
  port?: number;
};

export type KyvernoHelmValuesReportsControllerProfiling = {
  /**
   * Enable profiling
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Profiling endpoint port
   *
   * @default 6060
   */
  port?: number;
  /**
   * Service type.
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  nodePort?: unknown;
};

export type KyvernoHelmValues = {
  /**
   * Internal settings used with `helm template` to generate install manifest
   * @ignored
   *
   * @default {"enabled":false,"debug":false,"version":null}
   */
  templating?: KyvernoHelmValuesTemplating;
  /**
   * @default {...} (7 keys)
   */
  global?: KyvernoHelmValuesGlobal;
  nameOverride?: unknown;
  fullnameOverride?: unknown;
  namespaceOverride?: unknown;
  /**
   * @default {"fromV2":false}
   */
  upgrade?: KyvernoHelmValuesUpgrade;
  /**
   * @default {"podDisruptionBudget":null}
   */
  apiVersionOverride?: KyvernoHelmValuesApiVersionOverride;
  /**
   * CRDs configuration
   *
   * @default {...} (5 keys)
   */
  crds?: KyvernoHelmValuesCrds;
  /**
   * Configuration
   *
   * @default {...} (22 keys)
   */
  config?: KyvernoHelmValuesConfig;
  /**
   * Metrics configuration
   *
   * @default {...} (7 keys)
   */
  metricsConfig?: KyvernoHelmValuesMetricsConfig;
  /**
   * Image pull secrets for image verification policies, this will define the `--imagePullSecrets` argument
   *
   * @default {}
   */
  imagePullSecrets?: KyvernoHelmValuesImagePullSecrets;
  existingImagePullSecrets?: unknown[];
  /**
   * Tests configuration
   *
   * @default {...} (5 keys)
   */
  test?: KyvernoHelmValuesTest;
  /**
   * Additional labels
   *
   * @default {}
   */
  customLabels?: KyvernoHelmValuesCustomLabels;
  /**
   * @default {...} (13 keys)
   */
  webhooksCleanup?: KyvernoHelmValuesWebhooksCleanup;
  /**
   * @default {...} (12 keys)
   */
  policyReportsCleanup?: KyvernoHelmValuesPolicyReportsCleanup;
  /**
   * @default {...} (6 keys)
   */
  grafana?: KyvernoHelmValuesGrafana;
  /**
   * Features configuration
   *
   * @default {...} (21 keys)
   */
  features?: KyvernoHelmValuesFeatures;
  /**
   * Admission controller configuration
   *
   * @default {...} (43 keys)
   */
  admissionController?: KyvernoHelmValuesAdmissionController;
  /**
   * @default {...} (36 keys)
   */
  backgroundController?: KyvernoHelmValuesBackgroundController;
  /**
   * @default {...} (41 keys)
   */
  cleanupController?: KyvernoHelmValuesCleanupController;
  /**
   * @default {...} (41 keys)
   */
  reportsController?: KyvernoHelmValuesReportsController;
};

export type KyvernoHelmParameters = {
  "templating.enabled"?: string;
  "templating.debug"?: string;
  "templating.version"?: string;
  "global.image.registry"?: string;
  "global.imagePullSecrets"?: string;
  "global.resyncPeriod"?: string;
  "global.caCertificates.data"?: string;
  "global.extraEnvVars"?: string;
  "global.tolerations"?: string;
  nameOverride?: string;
  fullnameOverride?: string;
  namespaceOverride?: string;
  "upgrade.fromV2"?: string;
  "apiVersionOverride.podDisruptionBudget"?: string;
  "crds.install"?: string;
  "crds.groups.kyverno.cleanuppolicies"?: string;
  "crds.groups.kyverno.clustercleanuppolicies"?: string;
  "crds.groups.kyverno.clusterpolicies"?: string;
  "crds.groups.kyverno.globalcontextentries"?: string;
  "crds.groups.kyverno.policies"?: string;
  "crds.groups.kyverno.policyexceptions"?: string;
  "crds.groups.kyverno.updaterequests"?: string;
  "crds.groups.reports.clusterephemeralreports"?: string;
  "crds.groups.reports.ephemeralreports"?: string;
  "crds.groups.wgpolicyk8s.clusterpolicyreports"?: string;
  "crds.groups.wgpolicyk8s.policyreports"?: string;
  "crds.migration.enabled"?: string;
  "crds.migration.resources"?: string;
  "crds.migration.image.registry"?: string;
  "crds.migration.image.defaultRegistry"?: string;
  "crds.migration.image.repository"?: string;
  "crds.migration.image.tag"?: string;
  "crds.migration.image.pullPolicy"?: string;
  "crds.migration.imagePullSecrets"?: string;
  "crds.migration.tolerations"?: string;
  "crds.migration.securityContext.runAsUser"?: string;
  "crds.migration.securityContext.runAsGroup"?: string;
  "crds.migration.securityContext.runAsNonRoot"?: string;
  "crds.migration.securityContext.privileged"?: string;
  "crds.migration.securityContext.allowPrivilegeEscalation"?: string;
  "crds.migration.securityContext.readOnlyRootFilesystem"?: string;
  "crds.migration.securityContext.capabilities.drop"?: string;
  "crds.migration.securityContext.seccompProfile.type"?: string;
  "config.create"?: string;
  "config.preserve"?: string;
  "config.name"?: string;
  "config.enableDefaultRegistryMutation"?: string;
  "config.defaultRegistry"?: string;
  "config.excludeGroups"?: string;
  "config.excludeUsernames"?: string;
  "config.excludeRoles"?: string;
  "config.excludeClusterRoles"?: string;
  "config.generateSuccessEvents"?: string;
  "config.resourceFilters"?: string;
  "config.updateRequestThreshold"?: string;
  "config.webhooks.namespaceSelector.matchExpressions.key"?: string;
  "config.webhooks.namespaceSelector.matchExpressions.operator"?: string;
  "config.webhooks.namespaceSelector.matchExpressions.values"?: string;
  "config.webhookAnnotations.admissions.enforcer/disabled"?: string;
  "config.matchConditions"?: string;
  "config.excludeKyvernoNamespace"?: string;
  "config.resourceFiltersExcludeNamespaces"?: string;
  "config.resourceFiltersExclude"?: string;
  "config.resourceFiltersIncludeNamespaces"?: string;
  "config.resourceFiltersInclude"?: string;
  "metricsConfig.create"?: string;
  "metricsConfig.name"?: string;
  "metricsConfig.namespaces.include"?: string;
  "metricsConfig.namespaces.exclude"?: string;
  "metricsConfig.metricsRefreshInterval"?: string;
  "metricsConfig.bucketBoundaries"?: string;
  "metricsConfig.metricsExposure.kyverno_policy_execution_duration_seconds.disabledLabelDimensions"?: string;
  "metricsConfig.metricsExposure.kyverno_admission_review_duration_seconds.disabledLabelDimensions"?: string;
  "metricsConfig.metricsExposure.kyverno_policy_rule_info_total.disabledLabelDimensions"?: string;
  "metricsConfig.metricsExposure.kyverno_policy_results_total.disabledLabelDimensions"?: string;
  "metricsConfig.metricsExposure.kyverno_admission_requests_total.disabledLabelDimensions"?: string;
  "metricsConfig.metricsExposure.kyverno_cleanup_controller_deletedobjects_total.disabledLabelDimensions"?: string;
  existingImagePullSecrets?: string;
  "test.sleep"?: string;
  "test.image.registry"?: string;
  "test.image.repository"?: string;
  "test.image.tag"?: string;
  "test.image.pullPolicy"?: string;
  "test.imagePullSecrets"?: string;
  "test.resources.limits.cpu"?: string;
  "test.resources.limits.memory"?: string;
  "test.resources.requests.cpu"?: string;
  "test.resources.requests.memory"?: string;
  "test.securityContext.runAsUser"?: string;
  "test.securityContext.runAsGroup"?: string;
  "test.securityContext.runAsNonRoot"?: string;
  "test.securityContext.privileged"?: string;
  "test.securityContext.allowPrivilegeEscalation"?: string;
  "test.securityContext.readOnlyRootFilesystem"?: string;
  "test.securityContext.capabilities.drop"?: string;
  "test.securityContext.seccompProfile.type"?: string;
  "webhooksCleanup.enabled"?: string;
  "webhooksCleanup.autoDeleteWebhooks.enabled"?: string;
  "webhooksCleanup.image.registry"?: string;
  "webhooksCleanup.image.repository"?: string;
  "webhooksCleanup.image.tag"?: string;
  "webhooksCleanup.image.pullPolicy"?: string;
  "webhooksCleanup.imagePullSecrets"?: string;
  "webhooksCleanup.tolerations"?: string;
  "webhooksCleanup.securityContext.runAsUser"?: string;
  "webhooksCleanup.securityContext.runAsGroup"?: string;
  "webhooksCleanup.securityContext.runAsNonRoot"?: string;
  "webhooksCleanup.securityContext.privileged"?: string;
  "webhooksCleanup.securityContext.allowPrivilegeEscalation"?: string;
  "webhooksCleanup.securityContext.readOnlyRootFilesystem"?: string;
  "webhooksCleanup.securityContext.capabilities.drop"?: string;
  "webhooksCleanup.securityContext.seccompProfile.type"?: string;
  "policyReportsCleanup.enabled"?: string;
  "policyReportsCleanup.image.registry"?: string;
  "policyReportsCleanup.image.repository"?: string;
  "policyReportsCleanup.image.tag"?: string;
  "policyReportsCleanup.image.pullPolicy"?: string;
  "policyReportsCleanup.imagePullSecrets"?: string;
  "policyReportsCleanup.tolerations"?: string;
  "policyReportsCleanup.securityContext.runAsUser"?: string;
  "policyReportsCleanup.securityContext.runAsGroup"?: string;
  "policyReportsCleanup.securityContext.runAsNonRoot"?: string;
  "policyReportsCleanup.securityContext.privileged"?: string;
  "policyReportsCleanup.securityContext.allowPrivilegeEscalation"?: string;
  "policyReportsCleanup.securityContext.readOnlyRootFilesystem"?: string;
  "policyReportsCleanup.securityContext.capabilities.drop"?: string;
  "policyReportsCleanup.securityContext.seccompProfile.type"?: string;
  "grafana.enabled"?: string;
  "grafana.configMapName"?: string;
  "grafana.namespace"?: string;
  "grafana.labels.grafana_dashboard"?: string;
  "grafana.grafanaDashboard.create"?: string;
  "grafana.grafanaDashboard.folder"?: string;
  "grafana.grafanaDashboard.allowCrossNamespaceImport"?: string;
  "grafana.grafanaDashboard.matchLabels.dashboards"?: string;
  "features.admissionReports.enabled"?: string;
  "features.aggregateReports.enabled"?: string;
  "features.policyReports.enabled"?: string;
  "features.validatingAdmissionPolicyReports.enabled"?: string;
  "features.reporting.validate"?: string;
  "features.reporting.mutate"?: string;
  "features.reporting.mutateExisting"?: string;
  "features.reporting.imageVerify"?: string;
  "features.reporting.generate"?: string;
  "features.autoUpdateWebhooks.enabled"?: string;
  "features.backgroundScan.enabled"?: string;
  "features.backgroundScan.backgroundScanWorkers"?: string;
  "features.backgroundScan.backgroundScanInterval"?: string;
  "features.backgroundScan.skipResourceFilters"?: string;
  "features.configMapCaching.enabled"?: string;
  "features.deferredLoading.enabled"?: string;
  "features.dumpPayload.enabled"?: string;
  "features.forceFailurePolicyIgnore.enabled"?: string;
  "features.generateValidatingAdmissionPolicy.enabled"?: string;
  "features.dumpPatches.enabled"?: string;
  "features.globalContext.maxApiCallResponseLength"?: string;
  "features.logging.format"?: string;
  "features.logging.verbosity"?: string;
  "features.omitEvents.eventTypes"?: string;
  "features.policyExceptions.enabled"?: string;
  "features.policyExceptions.namespace"?: string;
  "features.protectManagedResources.enabled"?: string;
  "features.registryClient.allowInsecure"?: string;
  "features.registryClient.credentialHelpers"?: string;
  "features.ttlController.reconciliationInterval"?: string;
  "features.tuf.enabled"?: string;
  "features.tuf.root"?: string;
  "features.tuf.rootRaw"?: string;
  "features.tuf.mirror"?: string;
  "admissionController.featuresOverride.admissionReports.backPressureThreshold"?: string;
  "admissionController.rbac.create"?: string;
  "admissionController.rbac.createViewRoleBinding"?: string;
  "admissionController.rbac.viewRoleName"?: string;
  "admissionController.rbac.serviceAccount.name"?: string;
  "admissionController.rbac.coreClusterRole.extraResources"?: string;
  "admissionController.rbac.clusterRole.extraResources"?: string;
  "admissionController.createSelfSignedCert"?: string;
  "admissionController.replicas"?: string;
  "admissionController.revisionHistoryLimit"?: string;
  "admissionController.resyncPeriod"?: string;
  "admissionController.updateStrategy.rollingUpdate.maxSurge"?: string;
  "admissionController.updateStrategy.rollingUpdate.maxUnavailable"?: string;
  "admissionController.updateStrategy.type"?: string;
  "admissionController.priorityClassName"?: string;
  "admissionController.apiPriorityAndFairness"?: string;
  "admissionController.priorityLevelConfigurationSpec.type"?: string;
  "admissionController.priorityLevelConfigurationSpec.limited.nominalConcurrencyShares"?: string;
  "admissionController.priorityLevelConfigurationSpec.limited.limitResponse.queuing.queueLengthLimit"?: string;
  "admissionController.priorityLevelConfigurationSpec.limited.limitResponse.type"?: string;
  "admissionController.hostNetwork"?: string;
  "admissionController.webhookServer.port"?: string;
  "admissionController.dnsPolicy"?: string;
  "admissionController.startupProbe.httpGet.path"?: string;
  "admissionController.startupProbe.httpGet.port"?: string;
  "admissionController.startupProbe.httpGet.scheme"?: string;
  "admissionController.startupProbe.failureThreshold"?: string;
  "admissionController.startupProbe.initialDelaySeconds"?: string;
  "admissionController.startupProbe.periodSeconds"?: string;
  "admissionController.livenessProbe.httpGet.path"?: string;
  "admissionController.livenessProbe.httpGet.port"?: string;
  "admissionController.livenessProbe.httpGet.scheme"?: string;
  "admissionController.livenessProbe.initialDelaySeconds"?: string;
  "admissionController.livenessProbe.periodSeconds"?: string;
  "admissionController.livenessProbe.timeoutSeconds"?: string;
  "admissionController.livenessProbe.failureThreshold"?: string;
  "admissionController.livenessProbe.successThreshold"?: string;
  "admissionController.readinessProbe.httpGet.path"?: string;
  "admissionController.readinessProbe.httpGet.port"?: string;
  "admissionController.readinessProbe.httpGet.scheme"?: string;
  "admissionController.readinessProbe.initialDelaySeconds"?: string;
  "admissionController.readinessProbe.periodSeconds"?: string;
  "admissionController.readinessProbe.timeoutSeconds"?: string;
  "admissionController.readinessProbe.failureThreshold"?: string;
  "admissionController.readinessProbe.successThreshold"?: string;
  "admissionController.tolerations"?: string;
  "admissionController.antiAffinity.enabled"?: string;
  "admissionController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.weight"?: string;
  "admissionController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.key"?: string;
  "admissionController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.operator"?: string;
  "admissionController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.values"?: string;
  "admissionController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.topologyKey"?: string;
  "admissionController.topologySpreadConstraints"?: string;
  "admissionController.podDisruptionBudget.enabled"?: string;
  "admissionController.podDisruptionBudget.minAvailable"?: string;
  "admissionController.podDisruptionBudget.maxUnavailable"?: string;
  "admissionController.tufRootMountPath"?: string;
  "admissionController.caCertificates.data"?: string;
  "admissionController.imagePullSecrets"?: string;
  "admissionController.initContainer.image.registry"?: string;
  "admissionController.initContainer.image.defaultRegistry"?: string;
  "admissionController.initContainer.image.repository"?: string;
  "admissionController.initContainer.image.tag"?: string;
  "admissionController.initContainer.image.pullPolicy"?: string;
  "admissionController.initContainer.resources.limits.cpu"?: string;
  "admissionController.initContainer.resources.limits.memory"?: string;
  "admissionController.initContainer.resources.requests.cpu"?: string;
  "admissionController.initContainer.resources.requests.memory"?: string;
  "admissionController.initContainer.securityContext.runAsNonRoot"?: string;
  "admissionController.initContainer.securityContext.privileged"?: string;
  "admissionController.initContainer.securityContext.allowPrivilegeEscalation"?: string;
  "admissionController.initContainer.securityContext.readOnlyRootFilesystem"?: string;
  "admissionController.initContainer.securityContext.capabilities.drop"?: string;
  "admissionController.initContainer.securityContext.seccompProfile.type"?: string;
  "admissionController.initContainer.extraEnvVars"?: string;
  "admissionController.container.image.registry"?: string;
  "admissionController.container.image.defaultRegistry"?: string;
  "admissionController.container.image.repository"?: string;
  "admissionController.container.image.tag"?: string;
  "admissionController.container.image.pullPolicy"?: string;
  "admissionController.container.resources.limits.memory"?: string;
  "admissionController.container.resources.requests.cpu"?: string;
  "admissionController.container.resources.requests.memory"?: string;
  "admissionController.container.securityContext.runAsNonRoot"?: string;
  "admissionController.container.securityContext.privileged"?: string;
  "admissionController.container.securityContext.allowPrivilegeEscalation"?: string;
  "admissionController.container.securityContext.readOnlyRootFilesystem"?: string;
  "admissionController.container.securityContext.capabilities.drop"?: string;
  "admissionController.container.securityContext.seccompProfile.type"?: string;
  "admissionController.container.extraEnvVars"?: string;
  "admissionController.extraInitContainers"?: string;
  "admissionController.extraContainers"?: string;
  "admissionController.service.port"?: string;
  "admissionController.service.type"?: string;
  "admissionController.service.nodePort"?: string;
  "admissionController.metricsService.create"?: string;
  "admissionController.metricsService.port"?: string;
  "admissionController.metricsService.type"?: string;
  "admissionController.metricsService.nodePort"?: string;
  "admissionController.networkPolicy.enabled"?: string;
  "admissionController.networkPolicy.ingressFrom"?: string;
  "admissionController.serviceMonitor.enabled"?: string;
  "admissionController.serviceMonitor.namespace"?: string;
  "admissionController.serviceMonitor.interval"?: string;
  "admissionController.serviceMonitor.scrapeTimeout"?: string;
  "admissionController.serviceMonitor.secure"?: string;
  "admissionController.serviceMonitor.relabelings"?: string;
  "admissionController.serviceMonitor.metricRelabelings"?: string;
  "admissionController.tracing.enabled"?: string;
  "admissionController.tracing.address"?: string;
  "admissionController.tracing.port"?: string;
  "admissionController.tracing.creds"?: string;
  "admissionController.metering.disabled"?: string;
  "admissionController.metering.config"?: string;
  "admissionController.metering.port"?: string;
  "admissionController.metering.collector"?: string;
  "admissionController.metering.creds"?: string;
  "admissionController.profiling.enabled"?: string;
  "admissionController.profiling.port"?: string;
  "admissionController.profiling.serviceType"?: string;
  "admissionController.profiling.nodePort"?: string;
  "backgroundController.enabled"?: string;
  "backgroundController.rbac.create"?: string;
  "backgroundController.rbac.createViewRoleBinding"?: string;
  "backgroundController.rbac.viewRoleName"?: string;
  "backgroundController.rbac.serviceAccount.name"?: string;
  "backgroundController.rbac.coreClusterRole.extraResources.apiGroups"?: string;
  "backgroundController.rbac.coreClusterRole.extraResources.resources"?: string;
  "backgroundController.rbac.coreClusterRole.extraResources.verbs"?: string;
  "backgroundController.rbac.clusterRole.extraResources"?: string;
  "backgroundController.image.registry"?: string;
  "backgroundController.image.defaultRegistry"?: string;
  "backgroundController.image.repository"?: string;
  "backgroundController.image.tag"?: string;
  "backgroundController.image.pullPolicy"?: string;
  "backgroundController.imagePullSecrets"?: string;
  "backgroundController.replicas"?: string;
  "backgroundController.revisionHistoryLimit"?: string;
  "backgroundController.resyncPeriod"?: string;
  "backgroundController.updateStrategy.rollingUpdate.maxSurge"?: string;
  "backgroundController.updateStrategy.rollingUpdate.maxUnavailable"?: string;
  "backgroundController.updateStrategy.type"?: string;
  "backgroundController.priorityClassName"?: string;
  "backgroundController.hostNetwork"?: string;
  "backgroundController.dnsPolicy"?: string;
  "backgroundController.extraEnvVars"?: string;
  "backgroundController.resources.limits.memory"?: string;
  "backgroundController.resources.requests.cpu"?: string;
  "backgroundController.resources.requests.memory"?: string;
  "backgroundController.tolerations"?: string;
  "backgroundController.antiAffinity.enabled"?: string;
  "backgroundController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.weight"?: string;
  "backgroundController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.key"?: string;
  "backgroundController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.operator"?: string;
  "backgroundController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.values"?: string;
  "backgroundController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.topologyKey"?: string;
  "backgroundController.topologySpreadConstraints"?: string;
  "backgroundController.securityContext.runAsNonRoot"?: string;
  "backgroundController.securityContext.privileged"?: string;
  "backgroundController.securityContext.allowPrivilegeEscalation"?: string;
  "backgroundController.securityContext.readOnlyRootFilesystem"?: string;
  "backgroundController.securityContext.capabilities.drop"?: string;
  "backgroundController.securityContext.seccompProfile.type"?: string;
  "backgroundController.podDisruptionBudget.enabled"?: string;
  "backgroundController.podDisruptionBudget.minAvailable"?: string;
  "backgroundController.podDisruptionBudget.maxUnavailable"?: string;
  "backgroundController.caCertificates.data"?: string;
  "backgroundController.metricsService.create"?: string;
  "backgroundController.metricsService.port"?: string;
  "backgroundController.metricsService.type"?: string;
  "backgroundController.metricsService.nodePort"?: string;
  "backgroundController.networkPolicy.enabled"?: string;
  "backgroundController.networkPolicy.ingressFrom"?: string;
  "backgroundController.serviceMonitor.enabled"?: string;
  "backgroundController.serviceMonitor.namespace"?: string;
  "backgroundController.serviceMonitor.interval"?: string;
  "backgroundController.serviceMonitor.scrapeTimeout"?: string;
  "backgroundController.serviceMonitor.secure"?: string;
  "backgroundController.serviceMonitor.relabelings"?: string;
  "backgroundController.serviceMonitor.metricRelabelings"?: string;
  "backgroundController.tracing.enabled"?: string;
  "backgroundController.tracing.address"?: string;
  "backgroundController.tracing.port"?: string;
  "backgroundController.tracing.creds"?: string;
  "backgroundController.metering.disabled"?: string;
  "backgroundController.metering.config"?: string;
  "backgroundController.metering.port"?: string;
  "backgroundController.metering.collector"?: string;
  "backgroundController.metering.creds"?: string;
  "backgroundController.server.port"?: string;
  "backgroundController.profiling.enabled"?: string;
  "backgroundController.profiling.port"?: string;
  "backgroundController.profiling.serviceType"?: string;
  "backgroundController.profiling.nodePort"?: string;
  "cleanupController.enabled"?: string;
  "cleanupController.rbac.create"?: string;
  "cleanupController.rbac.serviceAccount.name"?: string;
  "cleanupController.rbac.clusterRole.extraResources"?: string;
  "cleanupController.createSelfSignedCert"?: string;
  "cleanupController.image.registry"?: string;
  "cleanupController.image.defaultRegistry"?: string;
  "cleanupController.image.repository"?: string;
  "cleanupController.image.tag"?: string;
  "cleanupController.image.pullPolicy"?: string;
  "cleanupController.imagePullSecrets"?: string;
  "cleanupController.replicas"?: string;
  "cleanupController.revisionHistoryLimit"?: string;
  "cleanupController.resyncPeriod"?: string;
  "cleanupController.updateStrategy.rollingUpdate.maxSurge"?: string;
  "cleanupController.updateStrategy.rollingUpdate.maxUnavailable"?: string;
  "cleanupController.updateStrategy.type"?: string;
  "cleanupController.priorityClassName"?: string;
  "cleanupController.hostNetwork"?: string;
  "cleanupController.server.port"?: string;
  "cleanupController.webhookServer.port"?: string;
  "cleanupController.dnsPolicy"?: string;
  "cleanupController.extraEnvVars"?: string;
  "cleanupController.resources.limits.memory"?: string;
  "cleanupController.resources.requests.cpu"?: string;
  "cleanupController.resources.requests.memory"?: string;
  "cleanupController.startupProbe.httpGet.path"?: string;
  "cleanupController.startupProbe.httpGet.port"?: string;
  "cleanupController.startupProbe.httpGet.scheme"?: string;
  "cleanupController.startupProbe.failureThreshold"?: string;
  "cleanupController.startupProbe.initialDelaySeconds"?: string;
  "cleanupController.startupProbe.periodSeconds"?: string;
  "cleanupController.livenessProbe.httpGet.path"?: string;
  "cleanupController.livenessProbe.httpGet.port"?: string;
  "cleanupController.livenessProbe.httpGet.scheme"?: string;
  "cleanupController.livenessProbe.initialDelaySeconds"?: string;
  "cleanupController.livenessProbe.periodSeconds"?: string;
  "cleanupController.livenessProbe.timeoutSeconds"?: string;
  "cleanupController.livenessProbe.failureThreshold"?: string;
  "cleanupController.livenessProbe.successThreshold"?: string;
  "cleanupController.readinessProbe.httpGet.path"?: string;
  "cleanupController.readinessProbe.httpGet.port"?: string;
  "cleanupController.readinessProbe.httpGet.scheme"?: string;
  "cleanupController.readinessProbe.initialDelaySeconds"?: string;
  "cleanupController.readinessProbe.periodSeconds"?: string;
  "cleanupController.readinessProbe.timeoutSeconds"?: string;
  "cleanupController.readinessProbe.failureThreshold"?: string;
  "cleanupController.readinessProbe.successThreshold"?: string;
  "cleanupController.tolerations"?: string;
  "cleanupController.antiAffinity.enabled"?: string;
  "cleanupController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.weight"?: string;
  "cleanupController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.key"?: string;
  "cleanupController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.operator"?: string;
  "cleanupController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.values"?: string;
  "cleanupController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.topologyKey"?: string;
  "cleanupController.topologySpreadConstraints"?: string;
  "cleanupController.securityContext.runAsNonRoot"?: string;
  "cleanupController.securityContext.privileged"?: string;
  "cleanupController.securityContext.allowPrivilegeEscalation"?: string;
  "cleanupController.securityContext.readOnlyRootFilesystem"?: string;
  "cleanupController.securityContext.capabilities.drop"?: string;
  "cleanupController.securityContext.seccompProfile.type"?: string;
  "cleanupController.podDisruptionBudget.enabled"?: string;
  "cleanupController.podDisruptionBudget.minAvailable"?: string;
  "cleanupController.podDisruptionBudget.maxUnavailable"?: string;
  "cleanupController.service.port"?: string;
  "cleanupController.service.type"?: string;
  "cleanupController.service.nodePort"?: string;
  "cleanupController.metricsService.create"?: string;
  "cleanupController.metricsService.port"?: string;
  "cleanupController.metricsService.type"?: string;
  "cleanupController.metricsService.nodePort"?: string;
  "cleanupController.networkPolicy.enabled"?: string;
  "cleanupController.networkPolicy.ingressFrom"?: string;
  "cleanupController.serviceMonitor.enabled"?: string;
  "cleanupController.serviceMonitor.namespace"?: string;
  "cleanupController.serviceMonitor.interval"?: string;
  "cleanupController.serviceMonitor.scrapeTimeout"?: string;
  "cleanupController.serviceMonitor.secure"?: string;
  "cleanupController.serviceMonitor.relabelings"?: string;
  "cleanupController.serviceMonitor.metricRelabelings"?: string;
  "cleanupController.tracing.enabled"?: string;
  "cleanupController.tracing.address"?: string;
  "cleanupController.tracing.port"?: string;
  "cleanupController.tracing.creds"?: string;
  "cleanupController.metering.disabled"?: string;
  "cleanupController.metering.config"?: string;
  "cleanupController.metering.port"?: string;
  "cleanupController.metering.collector"?: string;
  "cleanupController.metering.creds"?: string;
  "cleanupController.profiling.enabled"?: string;
  "cleanupController.profiling.port"?: string;
  "cleanupController.profiling.serviceType"?: string;
  "cleanupController.profiling.nodePort"?: string;
  "reportsController.enabled"?: string;
  "reportsController.rbac.create"?: string;
  "reportsController.rbac.createViewRoleBinding"?: string;
  "reportsController.rbac.viewRoleName"?: string;
  "reportsController.rbac.serviceAccount.name"?: string;
  "reportsController.rbac.coreClusterRole.extraResources"?: string;
  "reportsController.rbac.clusterRole.extraResources"?: string;
  "reportsController.image.registry"?: string;
  "reportsController.image.defaultRegistry"?: string;
  "reportsController.image.repository"?: string;
  "reportsController.image.tag"?: string;
  "reportsController.image.pullPolicy"?: string;
  "reportsController.imagePullSecrets"?: string;
  "reportsController.replicas"?: string;
  "reportsController.revisionHistoryLimit"?: string;
  "reportsController.resyncPeriod"?: string;
  "reportsController.updateStrategy.rollingUpdate.maxSurge"?: string;
  "reportsController.updateStrategy.rollingUpdate.maxUnavailable"?: string;
  "reportsController.updateStrategy.type"?: string;
  "reportsController.priorityClassName"?: string;
  "reportsController.apiPriorityAndFairness"?: string;
  "reportsController.priorityLevelConfigurationSpec.type"?: string;
  "reportsController.priorityLevelConfigurationSpec.limited.nominalConcurrencyShares"?: string;
  "reportsController.priorityLevelConfigurationSpec.limited.limitResponse.queuing.queueLengthLimit"?: string;
  "reportsController.priorityLevelConfigurationSpec.limited.limitResponse.type"?: string;
  "reportsController.hostNetwork"?: string;
  "reportsController.dnsPolicy"?: string;
  "reportsController.extraEnvVars"?: string;
  "reportsController.resources.limits.memory"?: string;
  "reportsController.resources.requests.cpu"?: string;
  "reportsController.resources.requests.memory"?: string;
  "reportsController.tolerations"?: string;
  "reportsController.antiAffinity.enabled"?: string;
  "reportsController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.weight"?: string;
  "reportsController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.key"?: string;
  "reportsController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.operator"?: string;
  "reportsController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.values"?: string;
  "reportsController.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.topologyKey"?: string;
  "reportsController.topologySpreadConstraints"?: string;
  "reportsController.securityContext.runAsNonRoot"?: string;
  "reportsController.securityContext.privileged"?: string;
  "reportsController.securityContext.allowPrivilegeEscalation"?: string;
  "reportsController.securityContext.readOnlyRootFilesystem"?: string;
  "reportsController.securityContext.capabilities.drop"?: string;
  "reportsController.securityContext.seccompProfile.type"?: string;
  "reportsController.podDisruptionBudget.enabled"?: string;
  "reportsController.podDisruptionBudget.minAvailable"?: string;
  "reportsController.podDisruptionBudget.maxUnavailable"?: string;
  "reportsController.tufRootMountPath"?: string;
  "reportsController.caCertificates.data"?: string;
  "reportsController.metricsService.create"?: string;
  "reportsController.metricsService.port"?: string;
  "reportsController.metricsService.type"?: string;
  "reportsController.metricsService.nodePort"?: string;
  "reportsController.networkPolicy.enabled"?: string;
  "reportsController.networkPolicy.ingressFrom"?: string;
  "reportsController.serviceMonitor.enabled"?: string;
  "reportsController.serviceMonitor.namespace"?: string;
  "reportsController.serviceMonitor.interval"?: string;
  "reportsController.serviceMonitor.scrapeTimeout"?: string;
  "reportsController.serviceMonitor.secure"?: string;
  "reportsController.serviceMonitor.relabelings"?: string;
  "reportsController.serviceMonitor.metricRelabelings"?: string;
  "reportsController.tracing.enabled"?: string;
  "reportsController.tracing.address"?: string;
  "reportsController.tracing.port"?: string;
  "reportsController.tracing.creds"?: string;
  "reportsController.metering.disabled"?: string;
  "reportsController.metering.config"?: string;
  "reportsController.metering.port"?: string;
  "reportsController.metering.collector"?: string;
  "reportsController.metering.creds"?: string;
  "reportsController.server.port"?: string;
  "reportsController.profiling.enabled"?: string;
  "reportsController.profiling.port"?: string;
  "reportsController.profiling.serviceType"?: string;
  "reportsController.profiling.nodePort"?: string;
  "reportsController.sanityChecks"?: string;
};
