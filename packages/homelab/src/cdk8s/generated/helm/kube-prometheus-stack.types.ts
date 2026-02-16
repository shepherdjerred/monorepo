// Generated TypeScript types for kube-prometheus-stack Helm chart

export type KubeprometheusstackHelmValuesCommonLabels = object;

export type KubeprometheusstackHelmValuesCrds = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * The CRD upgrade job mitigates the limitation of helm not being able to upgrade CRDs.
   * The job will apply the CRDs to the cluster before the operator is deployed, using helm hooks.
   * It deploys a corresponding clusterrole, clusterrolebinding and serviceaccount to apply the CRDs.
   * This feature is in preview, off by default and may change in the future.
   *
   * @default {...} (18 keys)
   */
  upgradeJob?: KubeprometheusstackHelmValuesCrdsUpgradeJob;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJob = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default false
   */
  forceConflicts?: boolean;
  /**
   * @default {"busybox":{"registry":"docker.io","repository":"busybox","tag":"latest","sha":"","pullPolicy":"IfNotPresent"},"kubectl":{"registry":"registry.k8s.io","repository":"kubectl","tag":"","sha":"","pullPolicy":"IfNotPresent"}}
   */
  image?: KubeprometheusstackHelmValuesCrdsUpgradeJobImage;
  /**
   * @default {}
   */
  env?: KubeprometheusstackHelmValuesCrdsUpgradeJobEnv;
  /**
   * Define resources requests and limits for single Pods.
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
   *
   * @default {}
   */
  resources?: KubeprometheusstackHelmValuesCrdsUpgradeJobResources;
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  /**
   * Define which Nodes the Pods are scheduled on.
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector
   *
   * @default {}
   */
  nodeSelector?: KubeprometheusstackHelmValuesCrdsUpgradeJobNodeSelector;
  /**
   * Assign custom affinity rules to the upgrade-crd job
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
   *
   * @default {}
   */
  affinity?: KubeprometheusstackHelmValuesCrdsUpgradeJobAffinity;
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * Labels to add to the upgrade-crd job
   *
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesCrdsUpgradeJobLabels;
  /**
   * Annotations to add to the upgrade-crd job
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesCrdsUpgradeJobAnnotations;
  /**
   * Labels to add to the upgrade-crd pod
   *
   * @default {}
   */
  podLabels?: KubeprometheusstackHelmValuesCrdsUpgradeJobPodLabels;
  /**
   * Annotations to add to the upgrade-crd pod
   *
   * @default {}
   */
  podAnnotations?: KubeprometheusstackHelmValuesCrdsUpgradeJobPodAnnotations;
  /**
   * Service account for upgrade crd job to use.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default {...} (5 keys)
   */
  serviceAccount?: KubeprometheusstackHelmValuesCrdsUpgradeJobServiceAccount;
  /**
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   *
   * @default {"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]}}
   */
  containerSecurityContext?: KubeprometheusstackHelmValuesCrdsUpgradeJobContainerSecurityContext;
  /**
   * SecurityContext holds pod-level security attributes and common container settings.
   * This defaults to non root user with uid 1000 and gid 2000. *v1.PodSecurityContext  false
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: KubeprometheusstackHelmValuesCrdsUpgradeJobPodSecurityContext;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobImage = {
  /**
   * @default {...} (5 keys)
   */
  busybox?: KubeprometheusstackHelmValuesCrdsUpgradeJobImageBusybox;
  /**
   * @default {...} (5 keys)
   */
  kubectl?: KubeprometheusstackHelmValuesCrdsUpgradeJobImageKubectl;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobImageBusybox = {
  /**
   * @default "docker.io"
   */
  registry?: string;
  /**
   * @default "busybox"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * @default ""
   */
  sha?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobImageKubectl = {
  /**
   * @default "registry.k8s.io"
   */
  registry?: string;
  /**
   * @default "kubectl"
   */
  repository?: string;
  /**
   * defaults to the Kubernetes version
   *
   * @default ""
   */
  tag?: string;
  /**
   * @default ""
   */
  sha?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobEnv = object;

export type KubeprometheusstackHelmValuesCrdsUpgradeJobResources = object;

export type KubeprometheusstackHelmValuesCrdsUpgradeJobNodeSelector = object;

export type KubeprometheusstackHelmValuesCrdsUpgradeJobAffinity = object;

export type KubeprometheusstackHelmValuesCrdsUpgradeJobLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobPodLabels = object;

export type KubeprometheusstackHelmValuesCrdsUpgradeJobPodAnnotations = object;

export type KubeprometheusstackHelmValuesCrdsUpgradeJobServiceAccount = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default ""
   */
  name?: string;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesCrdsUpgradeJobServiceAccountAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesCrdsUpgradeJobServiceAccountLabels;
  /**
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobServiceAccountLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobContainerSecurityContext = {
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
  capabilities?: KubeprometheusstackHelmValuesCrdsUpgradeJobContainerSecurityContextCapabilities;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobPodSecurityContext = {
  /**
   * @default 65534
   */
  fsGroup?: number;
  /**
   * @default 65534
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 65534
   */
  runAsUser?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KubeprometheusstackHelmValuesCrdsUpgradeJobPodSecurityContextSeccompProfile;
};

export type KubeprometheusstackHelmValuesCrdsUpgradeJobPodSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KubeprometheusstackHelmValuesCustomRules = object;

export type KubeprometheusstackHelmValuesDefaultRules = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default {...} (34 keys)
   */
  rules?: KubeprometheusstackHelmValuesDefaultRulesRules;
  /**
   * Defines the operator for namespace selection in rules
   * Use "=~" to include namespaces matching the pattern (default)
   * Use "!~" to exclude namespaces matching the pattern
   *
   * @default "=~"
   */
  appNamespacesOperator?: string;
  /**
   * Reduce app namespace alert scope
   *
   * @default ".*"
   */
  appNamespacesTarget?: string;
  /**
   * Set keep_firing_for for all alerts
   *
   * @default ""
   */
  keepFiringFor?: string;
  /**
   * Labels for default rules
   *
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesDefaultRulesLabels;
  /**
   * Annotations for default rules
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesDefaultRulesAnnotations;
  /**
   * Additional labels for PrometheusRule alerts
   *
   * @default {}
   */
  additionalRuleLabels?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleLabels;
  /**
   * Additional annotations for PrometheusRule alerts
   *
   * @default {}
   */
  additionalRuleAnnotations?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleAnnotations;
  /**
   * Additional labels for specific PrometheusRule alert groups
   *
   * @default {...} (32 keys)
   */
  additionalRuleGroupLabels?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabels;
  /**
   * Additional annotations for specific PrometheusRule alert groups
   *
   * @default {...} (32 keys)
   */
  additionalRuleGroupAnnotations?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotations;
  additionalAggregationLabels?: unknown[];
  /**
   * Prefix for runbook URLs. Use this to override the first part of the runbookURLs that is common to all rules.
   *
   * @default "https://runbooks.prometheus-operator.dev/runbooks"
   */
  runbookUrl?: string;
  /**
   * @default {"fsSelector":"fstype!=\"\""}
   */
  node?: KubeprometheusstackHelmValuesDefaultRulesNode;
  /**
   * Disabled PrometheusRule alerts
   *
   * @default {}
   */
  disabled?: KubeprometheusstackHelmValuesDefaultRulesDisabled;
};

export type KubeprometheusstackHelmValuesDefaultRulesRules = {
  /**
   * @default true
   */
  alertmanager?: boolean;
  /**
   * @default true
   */
  etcd?: boolean;
  /**
   * @default true
   */
  configReloaders?: boolean;
  /**
   * @default true
   */
  general?: boolean;
  /**
   * @default true
   */
  k8sContainerCpuUsageSecondsTotal?: boolean;
  /**
   * @default true
   */
  k8sContainerMemoryCache?: boolean;
  /**
   * @default true
   */
  k8sContainerMemoryRss?: boolean;
  /**
   * @default true
   */
  k8sContainerMemorySwap?: boolean;
  /**
   * @default true
   */
  k8sContainerResource?: boolean;
  /**
   * @default true
   */
  k8sContainerMemoryWorkingSetBytes?: boolean;
  /**
   * @default true
   */
  k8sPodOwner?: boolean;
  /**
   * @default true
   */
  kubeApiserverAvailability?: boolean;
  /**
   * @default true
   */
  kubeApiserverBurnrate?: boolean;
  /**
   * @default true
   */
  kubeApiserverHistogram?: boolean;
  /**
   * @default true
   */
  kubeApiserverSlos?: boolean;
  /**
   * @default true
   */
  kubeControllerManager?: boolean;
  /**
   * @default true
   */
  kubelet?: boolean;
  /**
   * @default true
   */
  kubeProxy?: boolean;
  /**
   * @default true
   */
  kubePrometheusGeneral?: boolean;
  /**
   * @default true
   */
  kubePrometheusNodeRecording?: boolean;
  /**
   * @default true
   */
  kubernetesApps?: boolean;
  /**
   * @default true
   */
  kubernetesResources?: boolean;
  /**
   * @default true
   */
  kubernetesStorage?: boolean;
  /**
   * @default true
   */
  kubernetesSystem?: boolean;
  /**
   * @default true
   */
  kubeSchedulerAlerting?: boolean;
  /**
   * @default true
   */
  kubeSchedulerRecording?: boolean;
  /**
   * @default true
   */
  kubeStateMetrics?: boolean;
  /**
   * @default true
   */
  network?: boolean;
  /**
   * @default true
   */
  node?: boolean;
  /**
   * @default true
   */
  nodeExporterAlerting?: boolean;
  /**
   * @default true
   */
  nodeExporterRecording?: boolean;
  /**
   * @default true
   */
  prometheus?: boolean;
  /**
   * @default true
   */
  prometheusOperator?: boolean;
  /**
   * @default true
   */
  windows?: boolean;
};

export type KubeprometheusstackHelmValuesDefaultRulesLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesDefaultRulesAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleLabels = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleAnnotations = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabels = {
  /**
   * @default {}
   */
  alertmanager?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsAlertmanager;
  /**
   * @default {}
   */
  etcd?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsEtcd;
  /**
   * @default {}
   */
  configReloaders?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsConfigReloaders;
  /**
   * @default {}
   */
  general?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsGeneral;
  /**
   * @default {}
   */
  k8sContainerCpuUsageSecondsTotal?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sContainerCpuUsageSecondsTotal;
  /**
   * @default {}
   */
  k8sContainerMemoryCache?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sContainerMemoryCache;
  /**
   * @default {}
   */
  k8sContainerMemoryRss?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sContainerMemoryRss;
  /**
   * @default {}
   */
  k8sContainerMemorySwap?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sContainerMemorySwap;
  /**
   * @default {}
   */
  k8sContainerResource?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sContainerResource;
  /**
   * @default {}
   */
  k8sPodOwner?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sPodOwner;
  /**
   * @default {}
   */
  kubeApiserverAvailability?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeApiserverAvailability;
  /**
   * @default {}
   */
  kubeApiserverBurnrate?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeApiserverBurnrate;
  /**
   * @default {}
   */
  kubeApiserverHistogram?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeApiserverHistogram;
  /**
   * @default {}
   */
  kubeApiserverSlos?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeApiserverSlos;
  /**
   * @default {}
   */
  kubeControllerManager?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeControllerManager;
  /**
   * @default {}
   */
  kubelet?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubelet;
  /**
   * @default {}
   */
  kubeProxy?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeProxy;
  /**
   * @default {}
   */
  kubePrometheusGeneral?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubePrometheusGeneral;
  /**
   * @default {}
   */
  kubePrometheusNodeRecording?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubePrometheusNodeRecording;
  /**
   * @default {}
   */
  kubernetesApps?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubernetesApps;
  /**
   * @default {}
   */
  kubernetesResources?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubernetesResources;
  /**
   * @default {}
   */
  kubernetesStorage?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubernetesStorage;
  /**
   * @default {}
   */
  kubernetesSystem?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubernetesSystem;
  /**
   * @default {}
   */
  kubeSchedulerAlerting?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeSchedulerAlerting;
  /**
   * @default {}
   */
  kubeSchedulerRecording?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeSchedulerRecording;
  /**
   * @default {}
   */
  kubeStateMetrics?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeStateMetrics;
  /**
   * @default {}
   */
  network?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsNetwork;
  /**
   * @default {}
   */
  node?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsNode;
  /**
   * @default {}
   */
  nodeExporterAlerting?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsNodeExporterAlerting;
  /**
   * @default {}
   */
  nodeExporterRecording?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsNodeExporterRecording;
  /**
   * @default {}
   */
  prometheus?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsPrometheus;
  /**
   * @default {}
   */
  prometheusOperator?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsPrometheusOperator;
};

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsAlertmanager = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsEtcd = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsConfigReloaders = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsGeneral = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sContainerCpuUsageSecondsTotal = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sContainerMemoryCache = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sContainerMemoryRss = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sContainerMemorySwap = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sContainerResource = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsK8sPodOwner = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeApiserverAvailability = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeApiserverBurnrate = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeApiserverHistogram = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeApiserverSlos = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeControllerManager = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubelet = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeProxy = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubePrometheusGeneral = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubePrometheusNodeRecording = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubernetesApps = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubernetesResources = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubernetesStorage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubernetesSystem = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeSchedulerAlerting = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeSchedulerRecording = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsKubeStateMetrics = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsNetwork = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsNode = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsNodeExporterAlerting = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsNodeExporterRecording = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsPrometheus = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupLabelsPrometheusOperator = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotations = {
  /**
   * @default {}
   */
  alertmanager?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsAlertmanager;
  /**
   * @default {}
   */
  etcd?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsEtcd;
  /**
   * @default {}
   */
  configReloaders?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsConfigReloaders;
  /**
   * @default {}
   */
  general?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsGeneral;
  /**
   * @default {}
   */
  k8sContainerCpuUsageSecondsTotal?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sContainerCpuUsageSecondsTotal;
  /**
   * @default {}
   */
  k8sContainerMemoryCache?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sContainerMemoryCache;
  /**
   * @default {}
   */
  k8sContainerMemoryRss?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sContainerMemoryRss;
  /**
   * @default {}
   */
  k8sContainerMemorySwap?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sContainerMemorySwap;
  /**
   * @default {}
   */
  k8sContainerResource?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sContainerResource;
  /**
   * @default {}
   */
  k8sPodOwner?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sPodOwner;
  /**
   * @default {}
   */
  kubeApiserverAvailability?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeApiserverAvailability;
  /**
   * @default {}
   */
  kubeApiserverBurnrate?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeApiserverBurnrate;
  /**
   * @default {}
   */
  kubeApiserverHistogram?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeApiserverHistogram;
  /**
   * @default {}
   */
  kubeApiserverSlos?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeApiserverSlos;
  /**
   * @default {}
   */
  kubeControllerManager?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeControllerManager;
  /**
   * @default {}
   */
  kubelet?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubelet;
  /**
   * @default {}
   */
  kubeProxy?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeProxy;
  /**
   * @default {}
   */
  kubePrometheusGeneral?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubePrometheusGeneral;
  /**
   * @default {}
   */
  kubePrometheusNodeRecording?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubePrometheusNodeRecording;
  /**
   * @default {}
   */
  kubernetesApps?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubernetesApps;
  /**
   * @default {}
   */
  kubernetesResources?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubernetesResources;
  /**
   * @default {}
   */
  kubernetesStorage?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubernetesStorage;
  /**
   * @default {}
   */
  kubernetesSystem?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubernetesSystem;
  /**
   * @default {}
   */
  kubeSchedulerAlerting?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeSchedulerAlerting;
  /**
   * @default {}
   */
  kubeSchedulerRecording?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeSchedulerRecording;
  /**
   * @default {}
   */
  kubeStateMetrics?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeStateMetrics;
  /**
   * @default {}
   */
  network?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsNetwork;
  /**
   * @default {}
   */
  node?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsNode;
  /**
   * @default {}
   */
  nodeExporterAlerting?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsNodeExporterAlerting;
  /**
   * @default {}
   */
  nodeExporterRecording?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsNodeExporterRecording;
  /**
   * @default {}
   */
  prometheus?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsPrometheus;
  /**
   * @default {}
   */
  prometheusOperator?: KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsPrometheusOperator;
};

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsAlertmanager = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsEtcd = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsConfigReloaders = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsGeneral = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sContainerCpuUsageSecondsTotal =
  object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sContainerMemoryCache = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sContainerMemoryRss = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sContainerMemorySwap = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sContainerResource = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsK8sPodOwner = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeApiserverAvailability = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeApiserverBurnrate = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeApiserverHistogram = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeApiserverSlos = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeControllerManager = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubelet = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeProxy = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubePrometheusGeneral = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubePrometheusNodeRecording = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubernetesApps = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubernetesResources = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubernetesStorage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubernetesSystem = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeSchedulerAlerting = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeSchedulerRecording = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsKubeStateMetrics = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsNetwork = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsNode = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsNodeExporterAlerting = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsNodeExporterRecording = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsPrometheus = object;

export type KubeprometheusstackHelmValuesDefaultRulesAdditionalRuleGroupAnnotationsPrometheusOperator = object;

export type KubeprometheusstackHelmValuesDefaultRulesNode = {
  /**
   * @default "fstype!="""
   */
  fsSelector?: string;
};

export type KubeprometheusstackHelmValuesDefaultRulesDisabled = object;

export type KubeprometheusstackHelmValuesAdditionalPrometheusRulesMap = object;

export type KubeprometheusstackHelmValuesGlobal = {
  /**
   * @default {"create":true,"createAggregateClusterRoles":false}
   */
  rbac?: KubeprometheusstackHelmValuesGlobalRbac;
  /**
   * Global image registry to use if it needs to be overridden for some specific use cases (e.g. local registries, custom images, ...)
   *
   * @default ""
   */
  imageRegistry?: string;
  imagePullSecrets?: unknown[];
};

export type KubeprometheusstackHelmValuesGlobalRbac = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * Create ClusterRoles that extend the existing view, edit and admin ClusterRoles to interact with prometheus-operator CRDs
   * Ref: https://kubernetes.io/docs/reference/access-authn-authz/rbac/#aggregated-clusterroles
   *
   * @default false
   */
  createAggregateClusterRoles?: boolean;
};

export type KubeprometheusstackHelmValuesWindowsMonitoring = {
  /**
   * Deploys the windows-exporter and Windows-specific dashboards and rules (job name must be 'windows-exporter')
   *
   * @default false
   */
  enabled?: boolean;
};

export type KubeprometheusstackHelmValuesPrometheuswindowsexporter = {
  /**
   * Enable ServiceMonitor and set Kubernetes label to use as a job label
   *
   * @default {"monitor":{"enabled":true,"jobLabel":"jobLabel"}}
   */
  prometheus?: KubeprometheusstackHelmValuesPrometheuswindowsexporterPrometheus;
  /**
   * @default true
   */
  releaseLabel?: boolean;
  /**
   * Set job label to 'windows-exporter' as required by the default Prometheus rules and Grafana dashboards
   *
   * @default {"jobLabel":"windows-exporter"}
   */
  podLabels?: KubeprometheusstackHelmValuesPrometheuswindowsexporterPodLabels;
  /**
   * Enable memory and container metrics as required by the default Prometheus rules and Grafana dashboards
   *
   * @default "collectors:
  enabled: '[defaults],memory,conta..."
   */
  config?: string;
};

export type KubeprometheusstackHelmValuesPrometheuswindowsexporterPrometheus = {
  /**
   * @default {"enabled":true,"jobLabel":"jobLabel"}
   */
  monitor?: KubeprometheusstackHelmValuesPrometheuswindowsexporterPrometheusMonitor;
};

export type KubeprometheusstackHelmValuesPrometheuswindowsexporterPrometheusMonitor = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "jobLabel"
   */
  jobLabel?: string;
};

export type KubeprometheusstackHelmValuesPrometheuswindowsexporterPodLabels = {
  /**
   * @default "windows-exporter"
   */
  jobLabel?: string;
};

export type KubeprometheusstackHelmValuesAlertmanager = {
  /**
   * Deploy alertmanager
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * Annotations for Alertmanager
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesAlertmanagerAnnotations;
  /**
   * Additional labels for Alertmanager
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesAlertmanagerAdditionalLabels;
  /**
   * API that Prometheus will use to communicate with alertmanager. Possible values are v1, v2
   *
   * @default "v2"
   */
  apiVersion?: string;
  enableFeatures?: unknown[];
  /**
   * Create dashboard configmap even if alertmanager deployment has been disabled
   *
   * @default false
   */
  forceDeployDashboards?: boolean;
  /**
   * Network Policy configuration
   *
   * @default {...} (7 keys)
   */
  networkPolicy?: KubeprometheusstackHelmValuesAlertmanagerNetworkPolicy;
  /**
   * Service account for Alertmanager to use.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default {...} (4 keys)
   */
  serviceAccount?: KubeprometheusstackHelmValuesAlertmanagerServiceAccount;
  /**
   * Configure pod disruption budgets for Alertmanager
   * ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/#specifying-a-poddisruptionbudget
   *
   * @default {"enabled":false,"minAvailable":1,"unhealthyPodEvictionPolicy":"AlwaysAllow"}
   */
  podDisruptionBudget?: KubeprometheusstackHelmValuesAlertmanagerPodDisruptionBudget;
  /**
   * ref: https://prometheus.io/docs/alerting/configuration/#configuration-file
   * https://prometheus.io/webtools/alerting/routing-tree-editor/
   *
   * @default {...} (5 keys)
   */
  config?: KubeprometheusstackHelmValuesAlertmanagerConfig;
  /**
   * Alertmanager configuration directives (as string type, preferred over the config hash map)
   * stringConfig will be used only if tplConfig is true
   * ref: https://prometheus.io/docs/alerting/configuration/#configuration-file
   * https://prometheus.io/webtools/alerting/routing-tree-editor/
   *
   * @default ""
   */
  stringConfig?: string;
  /**
   * Pass the Alertmanager configuration directives through Helm's templating
   * engine. If the Alertmanager configuration contains Alertmanager templates,
   * they'll need to be properly escaped so that they are not interpreted by
   * Helm
   * ref: https://helm.sh/docs/developing_charts/#using-the-tpl-function
   * https://prometheus.io/docs/alerting/configuration/#tmpl_string
   * https://prometheus.io/docs/alerting/notifications/
   * https://prometheus.io/docs/alerting/notification_examples/
   *
   * @default false
   */
  tplConfig?: boolean;
  /**
   * Alertmanager template files to format alerts
   * By default, templateFiles are placed in /etc/alertmanager/config/ and if
   * they have a .tmpl file suffix will be loaded. See config.templates above
   * to change, add other suffixes. If adding other suffixes, be sure to update
   * config.templates above to include those suffixes.
   * ref: https://prometheus.io/docs/alerting/notifications/
   * https://prometheus.io/docs/alerting/notification_examples/
   *
   * @default {}
   */
  templateFiles?: KubeprometheusstackHelmValuesAlertmanagerTemplateFiles;
  /**
   * {{ define "slack.myorg.text" }}
   * {{- $root := . -}}
   * {{ range .Alerts }}
   * *Alert:* {{ .Annotations.summary }} - `{{ .Labels.severity }}`
   * *Cluster:* {{ template "cluster" $root }}
   * *Description:* {{ .Annotations.description }}
   * *Graph:* <{{ .GeneratorURL }}|:chart_with_upwards_trend:>
   * *Runbook:* <{{ .Annotations.runbook }}|:spiral_note_pad:>
   * *Details:*
   * {{ range .Labels.SortedPairs }} - *{{ .Name }}:* `{{ .Value }}`
   * {{ end }}
   * {{ end }}
   * {{ end }}
   * BETA: Configure the gateway routes for the chart here.
   * More routes can be added by adding a dictionary key like the 'main' route.
   * Be aware that this is an early beta of this feature,
   * kube-prometheus-stack does not guarantee this works and is subject to change.
   * Being BETA this can/will change in the future without notice, do not use unless you want to take that risk
   * [[ref]](https://gateway-api.sigs.k8s.io/reference/spec/#gateway.networking.k8s.io%2fv1alpha2)
   *
   * @default {...} (7 keys)
   */
  ingress?: KubeprometheusstackHelmValuesAlertmanagerIngress;
  /**
   * @default {"main":{"enabled":false,"apiVersion":"gateway.networking.k8s.io/v1","kind":"HTTPRoute","annotations":{},"labels":{},"hostnames":[],"parentRefs":[],"httpsRedirect":false,"matches":[{"path":{"type":"PathPrefix","value":"/"}}],"filters":[],"additionalRules":[]}}
   */
  route?: KubeprometheusstackHelmValuesAlertmanagerRoute;
  /**
   * Configuration for Alertmanager secret
   *
   * @default {"annotations":{}}
   */
  secret?: KubeprometheusstackHelmValuesAlertmanagerSecret;
  /**
   * Configuration for creating an Ingress that will map to each Alertmanager replica service
   * alertmanager.servicePerReplica must be enabled
   *
   * @default {...} (9 keys)
   */
  ingressPerReplica?: KubeprometheusstackHelmValuesAlertmanagerIngressPerReplica;
  /**
   * Configuration for Alertmanager service
   *
   * @default {...} (16 keys)
   */
  service?: KubeprometheusstackHelmValuesAlertmanagerService;
  /**
   * Configuration for creating a separate Service for each statefulset Alertmanager replica
   *
   * @default {...} (8 keys)
   */
  servicePerReplica?: KubeprometheusstackHelmValuesAlertmanagerServicePerReplica;
  /**
   * Configuration for creating a ServiceMonitor for AlertManager
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#alertmanagerspec
   *
   * @default {...} (16 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesAlertmanagerServiceMonitor;
  /**
   * @default {...} (51 keys)
   */
  alertmanagerSpec?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpec;
  /**
   * ExtraSecret can be used to store various data in an extra secret
   * (use it for example to store hashed basic auth credentials)
   *
   * @default {"annotations":{},"data":{}}
   */
  extraSecret?: KubeprometheusstackHelmValuesAlertmanagerExtraSecret;
};

export type KubeprometheusstackHelmValuesAlertmanagerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerAdditionalLabels = object;

export type KubeprometheusstackHelmValuesAlertmanagerNetworkPolicy = {
  /**
   * Enable network policy for Alertmanager
   *
   * @default false
   */
  enabled?: boolean;
  policyTypes?: string[];
  /**
   * Gateway (formerly ingress controller) configuration
   * app.kubernetes.io/name: ingress-nginx
   * Additional custom ingress rules
   *
   * @default {"namespace":"","podLabels":{}}
   */
  gateway?: KubeprometheusstackHelmValuesAlertmanagerNetworkPolicyGateway;
  additionalIngress?: unknown[];
  /**
   * Configure egress rules
   *
   * @default {"enabled":false,"rules":[]}
   */
  egress?: KubeprometheusstackHelmValuesAlertmanagerNetworkPolicyEgress;
  /**
   * @default true
   */
  enableClusterRules?: boolean;
  /**
   * Configure monitoring component rules
   *
   * @default {"prometheus":true,"configReloader":true}
   */
  monitoringRules?: KubeprometheusstackHelmValuesAlertmanagerNetworkPolicyMonitoringRules;
};

export type KubeprometheusstackHelmValuesAlertmanagerNetworkPolicyGateway = {
  /**
   * Gateway namespace
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Gateway pod labels
   *
   * @default {}
   */
  podLabels?: KubeprometheusstackHelmValuesAlertmanagerNetworkPolicyGatewayPodLabels;
};

export type KubeprometheusstackHelmValuesAlertmanagerNetworkPolicyGatewayPodLabels = object;

export type KubeprometheusstackHelmValuesAlertmanagerNetworkPolicyEgress = {
  /**
   * Enable egress rules. When enabled, policyTypes will include Egress
   *
   * @default false
   */
  enabled?: boolean;
  rules?: unknown[];
};

export type KubeprometheusstackHelmValuesAlertmanagerNetworkPolicyMonitoringRules = {
  /**
   * Enable ingress from Prometheus
   *
   * @default true
   */
  prometheus?: boolean;
  /**
   * Enable ingress for config reloader metrics
   *
   * @default true
   */
  configReloader?: boolean;
};

export type KubeprometheusstackHelmValuesAlertmanagerServiceAccount = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default ""
   */
  name?: string;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesAlertmanagerServiceAccountAnnotations;
  /**
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type KubeprometheusstackHelmValuesAlertmanagerServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerPodDisruptionBudget = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  minAvailable?: number;
  /**
   * @default "AlwaysAllow"
   */
  unhealthyPodEvictionPolicy?: string;
};

export type KubeprometheusstackHelmValuesAlertmanagerConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"resolve_timeout":"5m"}
   */
  global?: KubeprometheusstackHelmValuesAlertmanagerConfigGlobal;
  inhibit_rules?: KubeprometheusstackHelmValuesAlertmanagerConfigInhibitrulesElement[];
  /**
   * @default {...} (6 keys)
   */
  route?: KubeprometheusstackHelmValuesAlertmanagerConfigRoute;
  receivers?: KubeprometheusstackHelmValuesAlertmanagerConfigReceiversElement[];
  templates?: string[];
};

export type KubeprometheusstackHelmValuesAlertmanagerConfigGlobal = {
  /**
   * @default "5m"
   */
  resolve_timeout?: string;
};

export type KubeprometheusstackHelmValuesAlertmanagerConfigInhibitrulesElement = {
  source_matchers?: string[];
  target_matchers?: string[];
  equal?: string[];
};

export type KubeprometheusstackHelmValuesAlertmanagerConfigRoute = {
  group_by?: string[];
  /**
   * @default "30s"
   */
  group_wait?: string;
  /**
   * @default "5m"
   */
  group_interval?: string;
  /**
   * @default "12h"
   */
  repeat_interval?: string;
  /**
   * @default "null"
   */
  receiver?: string;
  routes?: KubeprometheusstackHelmValuesAlertmanagerConfigRouteRoutesElement[];
};

export type KubeprometheusstackHelmValuesAlertmanagerConfigRouteRoutesElement = {
  /**
   * @default "null"
   */
  receiver?: string;
  matchers?: string[];
};

export type KubeprometheusstackHelmValuesAlertmanagerConfigReceiversElement = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "null"
   */
  name?: string;
};

export type KubeprometheusstackHelmValuesAlertmanagerTemplateFiles = object;

export type KubeprometheusstackHelmValuesAlertmanagerIngress = {
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
  annotations?: KubeprometheusstackHelmValuesAlertmanagerIngressAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesAlertmanagerIngressLabels;
  hosts?: unknown[];
  paths?: unknown[];
  tls?: unknown[];
};

export type KubeprometheusstackHelmValuesAlertmanagerIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerRoute = {
  /**
   * @default {...} (11 keys)
   */
  main?: KubeprometheusstackHelmValuesAlertmanagerRouteMain;
};

export type KubeprometheusstackHelmValuesAlertmanagerRouteMain = {
  /**
   * Enables or disables the route
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Set the route apiVersion, e.g. gateway.networking.k8s.io/v1 or gateway.networking.k8s.io/v1alpha2
   *
   * @default "gateway.networking.k8s.io/v1"
   */
  apiVersion?: string;
  /**
   * Set the route kind
   * Valid options are GRPCRoute, HTTPRoute, TCPRoute, TLSRoute, UDPRoute
   *
   * @default "HTTPRoute"
   */
  kind?: string;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesAlertmanagerRouteMainAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesAlertmanagerRouteMainLabels;
  hostnames?: unknown[];
  parentRefs?: unknown[];
  /**
   * create http route for redirect (https://gateway-api.sigs.k8s.io/guides/http-redirect-rewrite/#http-to-https-redirects)
   * Take care that you only enable this on the http listener of the gateway to avoid an infinite redirect.
   * matches, filters and additionalRules will be ignored if this is set to true. Be are
   *
   * @default false
   */
  httpsRedirect?: boolean;
  matches?: KubeprometheusstackHelmValuesAlertmanagerRouteMainMatchesElement[];
  filters?: unknown[];
  additionalRules?: unknown[];
};

export type KubeprometheusstackHelmValuesAlertmanagerRouteMainAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerRouteMainLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerRouteMainMatchesElement = {
  /**
   * @default {"type":"PathPrefix","value":"/"}
   */
  path?: KubeprometheusstackHelmValuesAlertmanagerRouteMainMatchesPath;
};

export type KubeprometheusstackHelmValuesAlertmanagerRouteMainMatchesPath = {
  /**
   * @default "PathPrefix"
   */
  type?: string;
  /**
   * @default "/"
   */
  value?: string;
};

export type KubeprometheusstackHelmValuesAlertmanagerSecret = {
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesAlertmanagerSecretAnnotations;
};

export type KubeprometheusstackHelmValuesAlertmanagerSecretAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerIngressPerReplica = {
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
  annotations?: KubeprometheusstackHelmValuesAlertmanagerIngressPerReplicaAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesAlertmanagerIngressPerReplicaLabels;
  /**
   * Final form of the hostname for each per replica ingress is
   * {{ ingressPerReplica.hostPrefix }}-{{ $replicaNumber }}.{{ ingressPerReplica.hostDomain }}
   * Prefix for the per replica ingress that will have `-$replicaNumber`
   * appended to the end
   *
   * @default ""
   */
  hostPrefix?: string;
  /**
   * Domain that will be used for the per replica ingress
   *
   * @default ""
   */
  hostDomain?: string;
  paths?: unknown[];
  /**
   * - /
   * For Kubernetes >= 1.18 you should specify the pathType (determines how Ingress paths should be matched)
   * See https://kubernetes.io/blog/2020/04/02/improvements-to-the-ingress-api-in-kubernetes-1.18/#better-path-matching-with-path-types
   * Secret name containing the TLS certificate for alertmanager per replica ingress
   * Secret must be manually created in the namespace
   *
   * @default ""
   */
  tlsSecretName?: string;
  /**
   * Separated secret for each per replica Ingress. Can be used together with cert-manager
   *
   * @default {"enabled":false,"prefix":"alertmanager"}
   */
  tlsSecretPerReplica?: KubeprometheusstackHelmValuesAlertmanagerIngressPerReplicaTlsSecretPerReplica;
};

export type KubeprometheusstackHelmValuesAlertmanagerIngressPerReplicaAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerIngressPerReplicaLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerIngressPerReplicaTlsSecretPerReplica = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Final form of the secret for each per replica ingress is
   * {{ tlsSecretPerReplica.prefix }}-{{ $replicaNumber }}
   *
   * @default "alertmanager"
   */
  prefix?: string;
};

export type KubeprometheusstackHelmValuesAlertmanagerService = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesAlertmanagerServiceAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesAlertmanagerServiceLabels;
  /**
   * @default ""
   */
  clusterIP?: string;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesAlertmanagerServiceIpDualStack;
  /**
   * Port for Alertmanager Service to listen on
   *
   * @default 9093
   */
  port?: number;
  /**
   * Port for Alertmanager cluster communication
   * To be used with a proxy extraContainer port
   *
   * @default 9093
   */
  targetPort?: number;
  /**
   * Port to expose on each node
   * Only used if service.type is 'NodePort'
   *
   * @default 30903
   */
  nodePort?: number;
  additionalPorts?: unknown[];
  externalIPs?: unknown[];
  /**
   * @default ""
   */
  loadBalancerIP?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Denotes if this Service desires to route external traffic to node-local or cluster-wide endpoints
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * If you want to make sure that connections from a particular client are passed to the same Pod each time
   * Accepts 'ClientIP' or 'None'
   *
   * @default "None"
   */
  sessionAffinity?: string;
  /**
   * If you want to modify the ClientIP sessionAffinity timeout
   * The value must be >0 && <=86400(for 1 day) if ServiceAffinity == "ClientIP"
   *
   * @default {"clientIP":{"timeoutSeconds":10800}}
   */
  sessionAffinityConfig?: KubeprometheusstackHelmValuesAlertmanagerServiceSessionAffinityConfig;
  /**
   * Service type
   *
   * @default "ClusterIP"
   */
  type?: string;
};

export type KubeprometheusstackHelmValuesAlertmanagerServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesAlertmanagerServiceSessionAffinityConfig = {
  /**
   * @default {"timeoutSeconds":10800}
   */
  clientIP?: KubeprometheusstackHelmValuesAlertmanagerServiceSessionAffinityConfigClientIP;
};

export type KubeprometheusstackHelmValuesAlertmanagerServiceSessionAffinityConfigClientIP = {
  /**
   * @default 10800
   */
  timeoutSeconds?: number;
};

export type KubeprometheusstackHelmValuesAlertmanagerServicePerReplica = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesAlertmanagerServicePerReplicaAnnotations;
  /**
   * Port for Alertmanager Service per replica to listen on
   *
   * @default 9093
   */
  port?: number;
  /**
   * To be used with a proxy extraContainer port
   *
   * @default 9093
   */
  targetPort?: number;
  /**
   * Port to expose on each node
   * Only used if servicePerReplica.type is 'NodePort'
   *
   * @default 30904
   */
  nodePort?: number;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Denotes if this Service desires to route external traffic to node-local or cluster-wide endpoints
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * Service type
   *
   * @default "ClusterIP"
   */
  type?: string;
};

export type KubeprometheusstackHelmValuesAlertmanagerServicePerReplicaAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerServiceMonitor = {
  /**
   * If true, a ServiceMonitor will be created for the AlertManager service.
   *
   * @default true
   */
  selfMonitor?: boolean;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesAlertmanagerServiceMonitorAdditionalLabels;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  proxyUrl?: string;
  /**
   * @default ""
   */
  scheme?: string;
  /**
   * See https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#endpoint
   *
   * @default true
   */
  enableHttp2?: boolean;
  /**
   * Of type: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#tlsconfig
   *
   * @default {}
   */
  tlsConfig?: KubeprometheusstackHelmValuesAlertmanagerServiceMonitorTlsConfig;
  bearerTokenFile?: unknown;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
  additionalEndpoints?: unknown[];
};

export type KubeprometheusstackHelmValuesAlertmanagerServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesAlertmanagerServiceMonitorTlsConfig = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpec = {
  /**
   * Statefulset's persistent volume claim retention policy
   * whenDeleted and whenScaled determine whether
   * statefulset's PVCs are deleted (true) or retained (false)
   * on scaling down and deleting statefulset, respectively.
   * Requires Kubernetes version 1.27.0+.
   * Ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#persistentvolumeclaim-retention
   *
   * @default {}
   */
  persistentVolumeClaimRetentionPolicy?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecPersistentVolumeClaimRetentionPolicy;
  /**
   * Standard object's metadata. More info: https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#metadata
   * Metadata Labels and Annotations gets propagated to the Alertmanager pods.
   *
   * @default {}
   */
  podMetadata?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecPodMetadata;
  serviceName?: unknown;
  /**
   * Image of Alertmanager
   *
   * @default {...} (5 keys)
   */
  image?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecImage;
  /**
   * If true then the user will be responsible to provide a secret with alertmanager configuration
   * So when true the config part will be ignored (including templateFiles) and the one in the secret will be used
   *
   * @default false
   */
  useExistingSecret?: boolean;
  secrets?: unknown[];
  /**
   * If false then the user will opt out of automounting API credentials.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  configMaps?: unknown[];
  /**
   * ConfigSecret is the name of a Kubernetes Secret in the same namespace as the Alertmanager object, which contains configuration for
   * this Alertmanager instance. Defaults to 'alertmanager-' The secret is mounted into /etc/alertmanager/config.
   * WebTLSConfig defines the TLS parameters for HTTPS
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#alertmanagerwebspec
   *
   * @default {}
   */
  web?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecWeb;
  /**
   * AlertmanagerConfigs to be selected to merge and configure Alertmanager with.
   *
   * @default {}
   */
  alertmanagerConfigSelector?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAlertmanagerConfigSelector;
  /**
   * - example-config-2
   * Namespaces to be selected for AlertmanagerConfig discovery. If nil, only check own namespace.
   *
   * @default {}
   */
  alertmanagerConfigNamespaceSelector?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAlertmanagerConfigNamespaceSelector;
  /**
   * - example-namespace-2
   * AlermanagerConfig to be used as top level configuration
   *
   * @default {}
   */
  alertmanagerConfiguration?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAlertmanagerConfiguration;
  /**
   * Defines the strategy used by AlertmanagerConfig objects to match alerts. eg:
   *
   * @default {}
   */
  alertmanagerConfigMatcherStrategy?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAlertmanagerConfigMatcherStrategy;
  additionalArgs?: unknown[];
  /**
   * Define Log Format
   * Use logfmt (default) or json logging
   *
   * @default "logfmt"
   */
  logFormat?: string;
  /**
   * Log level for Alertmanager to be configured with.
   *
   * @default "info"
   */
  logLevel?: string;
  /**
   * Size is the expected size of the alertmanager cluster. The controller will eventually make the size of the
   * running cluster equal to the expected size.
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Time duration Alertmanager shall retain data for. Default is '120h', and must match the regular expression
   * [0-9]+(ms|s|m|h) (milliseconds seconds minutes hours).
   *
   * @default "120h"
   */
  retention?: string;
  /**
   * Storage is the definition of how storage will be used by the Alertmanager instances.
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/platform/storage.md
   *
   * @default {}
   */
  storage?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecStorage;
  externalUrl?: unknown;
  /**
   * The route prefix Alertmanager registers HTTP handlers for. This is useful, if using ExternalURL and a proxy is rewriting HTTP routes of a request, and the actual ExternalURL is still true,
   * but the server serves requests under a different route prefix. For example for use with kubectl proxy.
   *
   * @default "/"
   */
  routePrefix?: string;
  /**
   * @default ""
   */
  scheme?: string;
  /**
   * Of type: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#tlsconfig
   *
   * @default {}
   */
  tlsConfig?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecTlsConfig;
  /**
   * If set to true all actions on the underlying managed objects are not going to be performed, except for delete actions.
   *
   * @default false
   */
  paused?: boolean;
  /**
   * Define which Nodes the Pods are scheduled on.
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector
   *
   * @default {}
   */
  nodeSelector?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecNodeSelector;
  /**
   * Define resources requests and limits for single Pods.
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
   *
   * @default {}
   */
  resources?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecResources;
  /**
   * Pod anti-affinity can prevent the scheduler from placing Prometheus replicas on the same node.
   * The default value "soft" means that the scheduler should *prefer* to not schedule two replica pods onto the same node but no guarantee is provided.
   * The value "hard" means that the scheduler is *required* to not schedule two replica pods onto the same node.
   * The value "" will disable pod anti-affinity so that no anti-affinity rules will be configured.
   *
   * @default "soft"
   */
  podAntiAffinity?: string;
  /**
   * If anti-affinity is enabled sets the topologyKey to use for anti-affinity.
   * This can be changed to, for example, failure-domain.beta.kubernetes.io/zone
   *
   * @default "kubernetes.io/hostname"
   */
  podAntiAffinityTopologyKey?: string;
  /**
   * Assign custom affinity rules to the alertmanager instance
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
   *
   * @default {}
   */
  affinity?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAffinity;
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * SecurityContext holds pod-level security attributes and common container settings.
   * This defaults to non root user with uid 1000 and gid 2000. *v1.PodSecurityContext  false
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   *
   * @default {...} (5 keys)
   */
  securityContext?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecSecurityContext;
  /**
   * DNS configuration for Alertmanager.
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#monitoring.coreos.com/v1.PodDNSConfig
   *
   * @default {}
   */
  dnsConfig?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecDnsConfig;
  /**
   * DNS policy for Alertmanager.
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#dnspolicystring-alias
   *
   * @default ""
   */
  dnsPolicy?: string;
  /**
   * ListenLocal makes the Alertmanager server listen on loopback, so that it does not bind against the Pod IP.
   * Note this is only for the Alertmanager UI, not the gossip communication.
   *
   * @default false
   */
  listenLocal?: boolean;
  containers?: unknown[];
  volumes?: unknown[];
  volumeMounts?: unknown[];
  initContainers?: unknown[];
  /**
   * Priority class assigned to the Pods
   *
   * @default ""
   */
  priorityClassName?: string;
  additionalPeers?: unknown[];
  /**
   * PortName to use for Alert Manager.
   *
   * @default "http-web"
   */
  portName?: string;
  /**
   * ClusterAdvertiseAddress is the explicit address to advertise in cluster. Needs to be provided for non RFC1918 [1] (public) addresses. [1] RFC1918: https://tools.ietf.org/html/rfc1918
   *
   * @default false
   */
  clusterAdvertiseAddress?: boolean;
  /**
   * clusterGossipInterval determines interval between gossip attempts.
   * Needs to be specified as GoDuration, a time duration that can be parsed by Go's time.ParseDuration() (e.g. 45ms, 30s, 1m, 1h20m15s)
   *
   * @default ""
   */
  clusterGossipInterval?: string;
  /**
   * clusterPeerTimeout determines timeout for cluster peering.
   * Needs to be specified as GoDuration, a time duration that can be parsed by Go's time.ParseDuration() (e.g. 45ms, 30s, 1m, 1h20m15s)
   *
   * @default ""
   */
  clusterPeerTimeout?: string;
  /**
   * clusterPushpullInterval determines interval between pushpull attempts.
   * Needs to be specified as GoDuration, a time duration that can be parsed by Go's time.ParseDuration() (e.g. 45ms, 30s, 1m, 1h20m15s)
   *
   * @default ""
   */
  clusterPushpullInterval?: string;
  /**
   * clusterLabel defines the identifier that uniquely identifies the Alertmanager cluster.
   *
   * @default ""
   */
  clusterLabel?: string;
  /**
   * ForceEnableClusterMode ensures Alertmanager does not deactivate the cluster mode when running with a single replica.
   * Use case is e.g. spanning an Alertmanager cluster across Kubernetes clusters with a single replica in each.
   *
   * @default false
   */
  forceEnableClusterMode?: boolean;
  /**
   * Minimum number of seconds for which a newly created pod should be ready without any of its container crashing for it to
   * be considered available. Defaults to 0 (pod will be considered available as soon as it is ready).
   *
   * @default 0
   */
  minReadySeconds?: number;
  /**
   * Additional configuration which is not covered by the properties above. (passed through tpl)
   *
   * @default {}
   */
  additionalConfig?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAdditionalConfig;
  /**
   * Additional configuration which is not covered by the properties above.
   * Useful, if you need advanced templating inside alertmanagerSpec.
   * Otherwise, use alertmanager.alertmanagerSpec.additionalConfig (passed through tpl)
   *
   * @default ""
   */
  additionalConfigString?: string;
};

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecPersistentVolumeClaimRetentionPolicy = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecPodMetadata = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecImage = {
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "prometheus/alertmanager"
   */
  repository?: string;
  /**
   * @default "v0.30.1"
   */
  tag?: string;
  /**
   * @default ""
   */
  sha?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecWeb = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAlertmanagerConfigSelector = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAlertmanagerConfigNamespaceSelector = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAlertmanagerConfiguration = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAlertmanagerConfigMatcherStrategy = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecStorage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecTlsConfig = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecNodeSelector = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecResources = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAffinity = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecSecurityContext = {
  /**
   * @default 2000
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
  /**
   * @default 2000
   */
  fsGroup?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecSecurityContextSeccompProfile;
};

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecDnsConfig = object;

export type KubeprometheusstackHelmValuesAlertmanagerAlertmanagerSpecAdditionalConfig = object;

export type KubeprometheusstackHelmValuesAlertmanagerExtraSecret = {
  /**
   * if not set, name will be auto generated
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesAlertmanagerExtraSecretAnnotations;
  /**
   * @default {}
   */
  data?: KubeprometheusstackHelmValuesAlertmanagerExtraSecretData;
};

export type KubeprometheusstackHelmValuesAlertmanagerExtraSecretAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesAlertmanagerExtraSecretData = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesGrafana = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * ForceDeployDatasources Create datasource configmap even if grafana deployment has been disabled
   *
   * @default false
   */
  forceDeployDatasources?: boolean;
  /**
   * ForceDeployDashboard Create dashboard configmap even if grafana deployment has been disabled
   *
   * @default false
   */
  forceDeployDashboards?: boolean;
  /**
   * Deploy default dashboards
   *
   * @default true
   */
  defaultDashboardsEnabled?: boolean;
  /**
   * "timeInterval": "5s"
   *
   * @default {...} (7 keys)
   */
  operator?: KubeprometheusstackHelmValuesGrafanaOperator;
  /**
   * Timezone for the default dashboards
   * Other options are: browser or a specific timezone, i.e. Europe/Luxembourg
   *
   * @default "utc"
   */
  defaultDashboardsTimezone?: string;
  /**
   * Editable flag for the default dashboards
   *
   * @default true
   */
  defaultDashboardsEditable?: boolean;
  /**
   * Default interval for Grafana dashboards
   *
   * @default "1m"
   */
  defaultDashboardsInterval?: string;
  /**
   * Administrator credentials when not using an existing secret (see below)
   *
   * @default "admin"
   */
  adminUser?: string;
  /**
   * Use an existing secret for the admin user.
   *
   * @default {"existingSecret":"","userKey":"admin-user","passwordKey":"admin-password"}
   */
  admin?: KubeprometheusstackHelmValuesGrafanaAdmin;
  /**
   * @default {"pspEnabled":false}
   */
  rbac?: KubeprometheusstackHelmValuesGrafanaRbac;
  /**
   * To make Grafana persistent (Using Statefulset)
   *
   * @default {...} (6 keys)
   */
  ingress?: KubeprometheusstackHelmValuesGrafanaIngress;
  /**
   * @default {"create":true,"autoMount":true}
   */
  serviceAccount?: KubeprometheusstackHelmValuesGrafanaServiceAccount;
  /**
   * @default {"dashboards":{"enabled":true,"label":"grafana_dashboard","labelValue":"1","searchNamespace":"ALL","enableNewTablePanelSyntax":false,"annotations":{},"multicluster":{"global":{"enabled":false},"etcd":{"enabled":false}},"provider":{"allowUiUpdates":false}},"datasources":{"enabled":true,"defaultDatasourceEnabled":true,"isDefaultDatasource":true,"name":"Prometheus","uid":"prometheus","annotations":{},"httpMethod":"POST","createPrometheusReplicasDatasources":false,"prometheusServiceName":"prometheus-operated","label":"grafana_datasource","labelValue":"1","exemplarTraceIdDestinations":{},"alertmanager":{"enabled":true,"name":"Alertmanager","uid":"alertmanager","handleGrafanaManagedAlerts":false,"implementation":"prometheus"}}}
   */
  sidecar?: KubeprometheusstackHelmValuesGrafanaSidecar;
  extraConfigmapMounts?: unknown[];
  deleteDatasources?: unknown[];
  additionalDataSources?: unknown[];
  /**
   * Flag to mark provisioned data sources for deletion if they are no longer configured.
   * It takes no effect if data sources are already listed in the deleteDatasources section.
   * ref: https://grafana.com/docs/grafana/latest/administration/provisioning/#example-data-source-configuration-file
   *
   * @default false
   */
  prune?: boolean;
  /**
   * Passed to grafana subchart and used by servicemonitor below
   *
   * @default {"portName":"http-web","ipFamilies":[],"ipFamilyPolicy":""}
   */
  service?: KubeprometheusstackHelmValuesGrafanaService;
  /**
   * @default {...} (8 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesGrafanaServiceMonitor;
};

export type KubeprometheusstackHelmValuesGrafanaOperator = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable references to ConfigMaps containing dashboards in GrafanaDashboard CRs
   * Set to true to allow dashboards to be loaded from ConfigMap references
   *
   * @default false
   */
  dashboardsConfigMapRefEnabled?: boolean;
  /**
   * Annotations for GrafanaDashboard Cr
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesGrafanaOperatorAnnotations;
  /**
   * Labels that should be matched kind: Grafana instance
   * Example: { app: grafana, category: dashboard }
   *
   * @default {}
   */
  matchLabels?: KubeprometheusstackHelmValuesGrafanaOperatorMatchLabels;
  /**
   * How frequently the operator should resync resources (in duration format)
   * Controls how often dashboards are reconciled by the operator
   *
   * @default "10m"
   */
  resyncPeriod?: string;
  /**
   * Which folder contains all dashboards in Grafana
   * This folder will be created on the Root level
   * Only one of 'folder', 'folderUID' or 'folderRef' can be set
   *
   * @default "General"
   */
  folder?: string;
  folderUID?: unknown;
  folderRef?: unknown;
};

export type KubeprometheusstackHelmValuesGrafanaOperatorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesGrafanaOperatorMatchLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesGrafanaAdmin = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Name of the secret. Can be templated.
   *
   * @default ""
   */
  existingSecret?: string;
  /**
   * @default "admin-user"
   */
  userKey?: string;
  /**
   * @default "admin-password"
   */
  passwordKey?: string;
};

export type KubeprometheusstackHelmValuesGrafanaRbac = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * If true, Grafana PSPs will be created
   *
   * @default false
   */
  pspEnabled?: boolean;
};

export type KubeprometheusstackHelmValuesGrafanaIngress = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * If true, Grafana Ingress will be created
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * IngressClassName for Grafana Ingress.
   * Should be provided if Ingress is enable.
   * Annotations for Grafana Ingress
   * kubernetes.io/ingress.class: nginx
   * kubernetes.io/tls-acme: "true"
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesGrafanaIngressAnnotations;
  /**
   * Labels to be added to the Ingress
   *
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesGrafanaIngressLabels;
  hosts?: unknown[];
  /**
   * Path for grafana ingress
   *
   * @default "/"
   */
  path?: string;
  tls?: unknown[];
};

export type KubeprometheusstackHelmValuesGrafanaIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesGrafanaIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesGrafanaServiceAccount = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default true
   */
  autoMount?: boolean;
};

export type KubeprometheusstackHelmValuesGrafanaSidecar = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {...} (8 keys)
   */
  dashboards?: KubeprometheusstackHelmValuesGrafanaSidecarDashboards;
  /**
   * @default {...} (13 keys)
   */
  datasources?: KubeprometheusstackHelmValuesGrafanaSidecarDatasources;
};

export type KubeprometheusstackHelmValuesGrafanaSidecarDashboards = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "grafana_dashboard"
   */
  label?: string;
  /**
   * @default "1"
   */
  labelValue?: number;
  /**
   * Allow discovery in all namespaces for dashboards
   *
   * @default "ALL"
   */
  searchNamespace?: string;
  /**
   * Support for new table panels, when enabled grafana auto migrates the old table panels to newer table panels
   *
   * @default false
   */
  enableNewTablePanelSyntax?: boolean;
  /**
   * Annotations for Grafana dashboard configmaps
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesGrafanaSidecarDashboardsAnnotations;
  /**
   * @default {"global":{"enabled":false},"etcd":{"enabled":false}}
   */
  multicluster?: KubeprometheusstackHelmValuesGrafanaSidecarDashboardsMulticluster;
  /**
   * @default {"allowUiUpdates":false}
   */
  provider?: KubeprometheusstackHelmValuesGrafanaSidecarDashboardsProvider;
};

export type KubeprometheusstackHelmValuesGrafanaSidecarDashboardsAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesGrafanaSidecarDashboardsMulticluster = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"enabled":false}
   */
  global?: KubeprometheusstackHelmValuesGrafanaSidecarDashboardsMulticlusterGlobal;
  /**
   * @default {"enabled":false}
   */
  etcd?: KubeprometheusstackHelmValuesGrafanaSidecarDashboardsMulticlusterEtcd;
};

export type KubeprometheusstackHelmValuesGrafanaSidecarDashboardsMulticlusterGlobal = {
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

export type KubeprometheusstackHelmValuesGrafanaSidecarDashboardsMulticlusterEtcd = {
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

export type KubeprometheusstackHelmValuesGrafanaSidecarDashboardsProvider = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default false
   */
  allowUiUpdates?: boolean;
};

export type KubeprometheusstackHelmValuesGrafanaSidecarDatasources = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default true
   */
  defaultDatasourceEnabled?: boolean;
  /**
   * @default true
   */
  isDefaultDatasource?: boolean;
  /**
   * @default "Prometheus"
   */
  name?: string;
  /**
   * @default "prometheus"
   */
  uid?: string;
  /**
   * URL of prometheus datasource
   * url: http://prometheus-stack-prometheus:9090/
   * Prometheus request timeout in seconds
   * Query parameters to add, as a URL-encoded string,
   * to query Prometheus
   * If not defined, will use prometheus.prometheusSpec.scrapeInterval or its default
   * Annotations for Grafana datasource configmaps
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesGrafanaSidecarDatasourcesAnnotations;
  /**
   * Set method for HTTP to send query to datasource
   *
   * @default "POST"
   */
  httpMethod?: string;
  /**
   * Create datasource for each Pod of Prometheus StatefulSet;
   * this uses by default the headless service `prometheus-operated` which is
   * created by Prometheus Operator. In case you deployed your own Service for your
   * Prometheus instance, you can specify it with the field `prometheusServiceName`
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/0fee93e12dc7c2ea1218f19ae25ec6b893460590/pkg/prometheus/statefulset.go#L255-L286
   *
   * @default false
   */
  createPrometheusReplicasDatasources?: boolean;
  /**
   * @default "prometheus-operated"
   */
  prometheusServiceName?: string;
  /**
   * @default "grafana_datasource"
   */
  label?: string;
  /**
   * @default "1"
   */
  labelValue?: number;
  /**
   * Field with internal link pointing to existing data source in Grafana.
   * Can be provisioned via additionalDataSources
   *
   * @default {}
   */
  exemplarTraceIdDestinations?: KubeprometheusstackHelmValuesGrafanaSidecarDatasourcesExemplarTraceIdDestinations;
  /**
   * @default {...} (5 keys)
   */
  alertmanager?: KubeprometheusstackHelmValuesGrafanaSidecarDatasourcesAlertmanager;
};

export type KubeprometheusstackHelmValuesGrafanaSidecarDatasourcesAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesGrafanaSidecarDatasourcesExemplarTraceIdDestinations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesGrafanaSidecarDatasourcesAlertmanager = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "Alertmanager"
   */
  name?: string;
  /**
   * @default "alertmanager"
   */
  uid?: string;
  /**
   * @default false
   */
  handleGrafanaManagedAlerts?: boolean;
  /**
   * @default "prometheus"
   */
  implementation?: string;
};

export type KubeprometheusstackHelmValuesGrafanaService = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "http-web"
   */
  portName?: string;
  ipFamilies?: unknown[];
  /**
   * @default ""
   */
  ipFamilyPolicy?: string;
};

export type KubeprometheusstackHelmValuesGrafanaServiceMonitor = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * If true, a ServiceMonitor CRD is created for a prometheus operator
   * https://github.com/prometheus-operator/prometheus-operator
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Path to use for scraping metrics. Might be different if server.root_url is set
   * in grafana.ini
   *
   * @default "/metrics"
   */
  path?: string;
  /**
   * labels for the ServiceMonitor
   *
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesGrafanaServiceMonitorLabels;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * @default "http"
   */
  scheme?: string;
  /**
   * @default {}
   */
  tlsConfig?: KubeprometheusstackHelmValuesGrafanaServiceMonitorTlsConfig;
  /**
   * @default "30s"
   */
  scrapeTimeout?: string;
  relabelings?: unknown[];
};

export type KubeprometheusstackHelmValuesGrafanaServiceMonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesGrafanaServiceMonitorTlsConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesKubernetesServiceMonitors = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type KubeprometheusstackHelmValuesKubeApiServer = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"serverName":"kubernetes","insecureSkipVerify":false}
   */
  tlsConfig?: KubeprometheusstackHelmValuesKubeApiServerTlsConfig;
  /**
   * @default {...} (14 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesKubeApiServerServiceMonitor;
};

export type KubeprometheusstackHelmValuesKubeApiServerTlsConfig = {
  /**
   * @default "kubernetes"
   */
  serverName?: string;
  /**
   * @default false
   */
  insecureSkipVerify?: boolean;
};

export type KubeprometheusstackHelmValuesKubeApiServerServiceMonitor = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  proxyUrl?: string;
  /**
   * @default "component"
   */
  jobLabel?: string;
  /**
   * @default {"matchLabels":{"component":"apiserver","provider":"kubernetes"}}
   */
  selector?: KubeprometheusstackHelmValuesKubeApiServerServiceMonitorSelector;
  metricRelabelings?: KubeprometheusstackHelmValuesKubeApiServerServiceMonitorMetricRelabelingsElement[];
  relabelings?: unknown[];
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesKubeApiServerServiceMonitorAdditionalLabels;
  targetLabels?: unknown[];
};

export type KubeprometheusstackHelmValuesKubeApiServerServiceMonitorSelector = {
  /**
   * @default {"component":"apiserver","provider":"kubernetes"}
   */
  matchLabels?: KubeprometheusstackHelmValuesKubeApiServerServiceMonitorSelectorMatchLabels;
};

export type KubeprometheusstackHelmValuesKubeApiServerServiceMonitorSelectorMatchLabels = {
  /**
   * @default "apiserver"
   */
  component?: string;
  /**
   * @default "kubernetes"
   */
  provider?: string;
};

export type KubeprometheusstackHelmValuesKubeApiServerServiceMonitorMetricRelabelingsElement = {
  /**
   * @default "drop"
   */
  action?: string;
  /**
   * @default "(etcd_request|apiserver_request_slo|apiserver_r..."
   */
  regex?: string;
  sourceLabels?: string[];
};

export type KubeprometheusstackHelmValuesKubeApiServerServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesKubelet = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "kube-system"
   */
  namespace?: string;
  /**
   * Overrides the job selector in Grafana dashboards and Prometheus rules
   * For k3s clusters, change to k3s-server
   *
   * @default ""
   */
  jobNameOverride?: string;
  /**
   * @default {...} (30 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesKubeletServiceMonitor;
};

export type KubeprometheusstackHelmValuesKubeletServiceMonitor = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Enable scraping /metrics from kubelet's service
   *
   * @default true
   */
  kubelet?: boolean;
  /**
   * Attach metadata to discovered targets. Requires Prometheus v2.45 for endpoints created by the operator.
   *
   * @default {"node":false}
   */
  attachMetadata?: KubeprometheusstackHelmValuesKubeletServiceMonitorAttachMetadata;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * If true, Prometheus use (respect) labels provided by exporter.
   *
   * @default true
   */
  honorLabels?: boolean;
  /**
   * If true, Prometheus ingests metrics with timestamp provided by exporter. If false, Prometheus ingests metrics with timestamp of scrape.
   *
   * @default true
   */
  honorTimestamps?: boolean;
  /**
   * If true, defines whether Prometheus tracks staleness of the metrics that have an explicit timestamp present in scraped data. Has no effect if `honorTimestamps` is false.
   * We recommend enabling this if you want the best possible accuracy for container_ metrics scraped from cadvisor.
   * For more details see: https://github.com/prometheus-community/helm-charts/pull/5063#issuecomment-2545374849
   *
   * @default true
   */
  trackTimestampsStaleness?: boolean;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  proxyUrl?: string;
  /**
   * Enable scraping the kubelet over https. For requirements to enable this see
   * https://github.com/prometheus-operator/prometheus-operator/issues/926
   *
   * @default true
   */
  https?: boolean;
  /**
   * Skip TLS certificate validation when scraping.
   * This is enabled by default because kubelet serving certificate deployed by kubeadm is by default self-signed
   * ref: https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/#kubelet-serving-certs
   *
   * @default true
   */
  insecureSkipVerify?: boolean;
  /**
   * Enable scraping /metrics/probes from kubelet's service
   *
   * @default true
   */
  probes?: boolean;
  /**
   * Enable scraping /metrics/resource from kubelet's service
   * This is disabled by default because container metrics are already exposed by cAdvisor
   *
   * @default false
   */
  resource?: boolean;
  /**
   * From kubernetes 1.18, /metrics/resource/v1alpha1 renamed to /metrics/resource
   *
   * @default "/metrics/resource/v1alpha1"
   */
  resourcePath?: string;
  /**
   * Configure the scrape interval for resource metrics. This is configured to the default Kubelet cAdvisor
   * minimum housekeeping interval in order to avoid missing samples. Note, this value is ignored
   * if kubelet.serviceMonitor.interval is not empty.
   *
   * @default "10s"
   */
  resourceInterval?: string;
  /**
   * Enable scraping /metrics/cadvisor from kubelet's service
   *
   * @default true
   */
  cAdvisor?: boolean;
  /**
   * Configure the scrape interval for cAdvisor. This is configured to the default Kubelet cAdvisor
   * minimum housekeeping interval in order to avoid missing samples. Note, this value is ignored
   * if kubelet.serviceMonitor.interval is not empty.
   *
   * @default "10s"
   */
  cAdvisorInterval?: string;
  cAdvisorMetricRelabelings?: KubeprometheusstackHelmValuesKubeletServiceMonitorCAdvisorMetricRelabelingsElement[];
  probesMetricRelabelings?: unknown[];
  cAdvisorRelabelings?: KubeprometheusstackHelmValuesKubeletServiceMonitorCAdvisorRelabelingsElement[];
  probesRelabelings?: KubeprometheusstackHelmValuesKubeletServiceMonitorProbesRelabelingsElement[];
  resourceRelabelings?: KubeprometheusstackHelmValuesKubeletServiceMonitorResourceRelabelingsElement[];
  metricRelabelings?: KubeprometheusstackHelmValuesKubeletServiceMonitorMetricRelabelingsElement[];
  relabelings?: KubeprometheusstackHelmValuesKubeletServiceMonitorRelabelingsElement[];
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesKubeletServiceMonitorAdditionalLabels;
  targetLabels?: unknown[];
};

export type KubeprometheusstackHelmValuesKubeletServiceMonitorAttachMetadata = {
  /**
   * @default false
   */
  node?: boolean;
};

export type KubeprometheusstackHelmValuesKubeletServiceMonitorCAdvisorMetricRelabelingsElement = {
  sourceLabels?: string[];
  /**
   * @default "drop"
   */
  action?: string;
  /**
   * @default "container_cpu_(cfs_throttled_seconds_total|load..."
   */
  regex?: string;
};

export type KubeprometheusstackHelmValuesKubeletServiceMonitorCAdvisorRelabelingsElement = {
  /**
   * @default "replace"
   */
  action?: string;
  sourceLabels?: string[];
  /**
   * @default "metrics_path"
   */
  targetLabel?: string;
};

export type KubeprometheusstackHelmValuesKubeletServiceMonitorProbesRelabelingsElement = {
  /**
   * @default "replace"
   */
  action?: string;
  sourceLabels?: string[];
  /**
   * @default "metrics_path"
   */
  targetLabel?: string;
};

export type KubeprometheusstackHelmValuesKubeletServiceMonitorResourceRelabelingsElement = {
  /**
   * @default "replace"
   */
  action?: string;
  sourceLabels?: string[];
  /**
   * @default "metrics_path"
   */
  targetLabel?: string;
};

export type KubeprometheusstackHelmValuesKubeletServiceMonitorMetricRelabelingsElement = {
  /**
   * @default "drop"
   */
  action?: string;
  sourceLabels?: string[];
  /**
   * @default "(csi_operations|storage_operation_duration)_sec..."
   */
  regex?: string;
};

export type KubeprometheusstackHelmValuesKubeletServiceMonitorRelabelingsElement = {
  /**
   * @default "replace"
   */
  action?: string;
  sourceLabels?: string[];
  /**
   * @default "metrics_path"
   */
  targetLabel?: string;
};

export type KubeprometheusstackHelmValuesKubeletServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesKubeControllerManager = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Overrides the job selector in Grafana dashboards and Prometheus rules
   * For k3s clusters, change to k3s-server
   *
   * @default ""
   */
  jobNameOverride?: string;
  endpoints?: unknown[];
  /**
   * - 10.141.4.22
   * - 10.141.4.23
   * - 10.141.4.24
   * If using kubeControllerManager.endpoints only the port and targetPort are used
   *
   * @default {...} (4 keys)
   */
  service?: KubeprometheusstackHelmValuesKubeControllerManagerService;
  /**
   * @default {...} (18 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesKubeControllerManagerServiceMonitor;
};

export type KubeprometheusstackHelmValuesKubeControllerManagerService = {
  /**
   * @default true
   */
  enabled?: boolean;
  port?: unknown;
  targetPort?: unknown;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesKubeControllerManagerServiceIpDualStack;
};

export type KubeprometheusstackHelmValuesKubeControllerManagerServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesKubeControllerManagerServiceMonitor = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  proxyUrl?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
  /**
   * @default "jobLabel"
   */
  jobLabel?: string;
  /**
   * @default {}
   */
  selector?: KubeprometheusstackHelmValuesKubeControllerManagerServiceMonitorSelector;
  https?: unknown;
  insecureSkipVerify?: unknown;
  serverName?: unknown;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesKubeControllerManagerServiceMonitorAdditionalLabels;
  targetLabels?: unknown[];
};

export type KubeprometheusstackHelmValuesKubeControllerManagerServiceMonitorSelector = object;

export type KubeprometheusstackHelmValuesKubeControllerManagerServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesCoreDns = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {...} (4 keys)
   */
  service?: KubeprometheusstackHelmValuesCoreDnsService;
  /**
   * @default {...} (15 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesCoreDnsServiceMonitor;
};

export type KubeprometheusstackHelmValuesCoreDnsService = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 9153
   */
  port?: number;
  /**
   * @default 9153
   */
  targetPort?: number;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesCoreDnsServiceIpDualStack;
};

export type KubeprometheusstackHelmValuesCoreDnsServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesCoreDnsServiceMonitor = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  proxyUrl?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
  /**
   * @default "jobLabel"
   */
  jobLabel?: string;
  /**
   * @default {}
   */
  selector?: KubeprometheusstackHelmValuesCoreDnsServiceMonitorSelector;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesCoreDnsServiceMonitorAdditionalLabels;
  targetLabels?: unknown[];
};

export type KubeprometheusstackHelmValuesCoreDnsServiceMonitorSelector = object;

export type KubeprometheusstackHelmValuesCoreDnsServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesKubeDns = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"dnsmasq":{"port":10054,"targetPort":10054},"skydns":{"port":10055,"targetPort":10055},"ipDualStack":{"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}}
   */
  service?: KubeprometheusstackHelmValuesKubeDnsService;
  /**
   * @default {...} (15 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesKubeDnsServiceMonitor;
};

export type KubeprometheusstackHelmValuesKubeDnsService = {
  /**
   * @default {"port":10054,"targetPort":10054}
   */
  dnsmasq?: KubeprometheusstackHelmValuesKubeDnsServiceDnsmasq;
  /**
   * @default {"port":10055,"targetPort":10055}
   */
  skydns?: KubeprometheusstackHelmValuesKubeDnsServiceSkydns;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesKubeDnsServiceIpDualStack;
};

export type KubeprometheusstackHelmValuesKubeDnsServiceDnsmasq = {
  /**
   * @default 10054
   */
  port?: number;
  /**
   * @default 10054
   */
  targetPort?: number;
};

export type KubeprometheusstackHelmValuesKubeDnsServiceSkydns = {
  /**
   * @default 10055
   */
  port?: number;
  /**
   * @default 10055
   */
  targetPort?: number;
};

export type KubeprometheusstackHelmValuesKubeDnsServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesKubeDnsServiceMonitor = {
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  proxyUrl?: string;
  /**
   * @default "jobLabel"
   */
  jobLabel?: string;
  /**
   * @default {}
   */
  selector?: KubeprometheusstackHelmValuesKubeDnsServiceMonitorSelector;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
  dnsmasqMetricRelabelings?: unknown[];
  dnsmasqRelabelings?: unknown[];
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesKubeDnsServiceMonitorAdditionalLabels;
  targetLabels?: unknown[];
};

export type KubeprometheusstackHelmValuesKubeDnsServiceMonitorSelector = object;

export type KubeprometheusstackHelmValuesKubeDnsServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesKubeEtcd = {
  /**
   * @default true
   */
  enabled?: boolean;
  endpoints?: unknown[];
  /**
   * - 10.141.4.22
   * - 10.141.4.23
   * - 10.141.4.24
   * Etcd service. If using kubeEtcd.endpoints only the port and targetPort are used
   *
   * @default {...} (4 keys)
   */
  service?: KubeprometheusstackHelmValuesKubeEtcdService;
  /**
   * @default {...} (21 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesKubeEtcdServiceMonitor;
};

export type KubeprometheusstackHelmValuesKubeEtcdService = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 2381
   */
  port?: number;
  /**
   * @default 2381
   */
  targetPort?: number;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesKubeEtcdServiceIpDualStack;
};

export type KubeprometheusstackHelmValuesKubeEtcdServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesKubeEtcdServiceMonitor = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  proxyUrl?: string;
  /**
   * @default "http"
   */
  scheme?: string;
  /**
   * @default false
   */
  insecureSkipVerify?: boolean;
  /**
   * @default ""
   */
  serverName?: string;
  /**
   * @default ""
   */
  caFile?: string;
  /**
   * @default ""
   */
  certFile?: string;
  /**
   * @default ""
   */
  keyFile?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
  /**
   * @default "jobLabel"
   */
  jobLabel?: string;
  /**
   * @default {}
   */
  selector?: KubeprometheusstackHelmValuesKubeEtcdServiceMonitorSelector;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesKubeEtcdServiceMonitorAdditionalLabels;
  targetLabels?: unknown[];
};

export type KubeprometheusstackHelmValuesKubeEtcdServiceMonitorSelector = object;

export type KubeprometheusstackHelmValuesKubeEtcdServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesKubeScheduler = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Overrides the job selector in Grafana dashboards and Prometheus rules
   * For k3s clusters, change to k3s-server
   *
   * @default ""
   */
  jobNameOverride?: string;
  endpoints?: unknown[];
  /**
   * - 10.141.4.22
   * - 10.141.4.23
   * - 10.141.4.24
   * If using kubeScheduler.endpoints only the port and targetPort are used
   *
   * @default {...} (4 keys)
   */
  service?: KubeprometheusstackHelmValuesKubeSchedulerService;
  /**
   * @default {...} (18 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesKubeSchedulerServiceMonitor;
};

export type KubeprometheusstackHelmValuesKubeSchedulerService = {
  /**
   * @default true
   */
  enabled?: boolean;
  port?: unknown;
  targetPort?: unknown;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesKubeSchedulerServiceIpDualStack;
};

export type KubeprometheusstackHelmValuesKubeSchedulerServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesKubeSchedulerServiceMonitor = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  proxyUrl?: string;
  https?: unknown;
  /**
   * @default "http-metrics"
   */
  port?: string;
  /**
   * @default "jobLabel"
   */
  jobLabel?: string;
  /**
   * @default {}
   */
  selector?: KubeprometheusstackHelmValuesKubeSchedulerServiceMonitorSelector;
  insecureSkipVerify?: unknown;
  serverName?: unknown;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesKubeSchedulerServiceMonitorAdditionalLabels;
  targetLabels?: unknown[];
};

export type KubeprometheusstackHelmValuesKubeSchedulerServiceMonitorSelector = object;

export type KubeprometheusstackHelmValuesKubeSchedulerServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesKubeProxy = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Overrides the job selector in Grafana dashboards and Prometheus rules
   * For k3s clusters, change to k3s-server
   *
   * @default ""
   */
  jobNameOverride?: string;
  endpoints?: unknown[];
  /**
   * - 10.141.4.22
   * - 10.141.4.23
   * - 10.141.4.24
   *
   * @default {...} (4 keys)
   */
  service?: KubeprometheusstackHelmValuesKubeProxyService;
  /**
   * @default {...} (16 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesKubeProxyServiceMonitor;
};

export type KubeprometheusstackHelmValuesKubeProxyService = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 10249
   */
  port?: number;
  /**
   * @default 10249
   */
  targetPort?: number;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesKubeProxyServiceIpDualStack;
};

export type KubeprometheusstackHelmValuesKubeProxyServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesKubeProxyServiceMonitor = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  proxyUrl?: string;
  /**
   * @default "http-metrics"
   */
  port?: string;
  /**
   * @default "jobLabel"
   */
  jobLabel?: string;
  /**
   * @default {}
   */
  selector?: KubeprometheusstackHelmValuesKubeProxyServiceMonitorSelector;
  /**
   * Enable scraping kube-proxy over https.
   * Requires proper certs (not self-signed) and delegated authentication/authorization checks
   *
   * @default false
   */
  https?: boolean;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesKubeProxyServiceMonitorAdditionalLabels;
  targetLabels?: unknown[];
};

export type KubeprometheusstackHelmValuesKubeProxyServiceMonitorSelector = object;

export type KubeprometheusstackHelmValuesKubeProxyServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesKubeStateMetrics = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type KubeprometheusstackHelmValuesKubestatemetrics = {
  /**
   * set to true to add the release label so scraping of the servicemonitor with kube-prometheus-stack works out of the box
   *
   * @default true
   */
  releaseLabel?: boolean;
  /**
   * Enable scraping via kubernetes-service-endpoints
   * Disabled by default as we service monitor is enabled below
   *
   * @default false
   */
  prometheusScrape?: boolean;
  /**
   * @default {"monitor":{"enabled":true,"http":{"honorLabels":true},"metrics":{"honorLabels":true}}}
   */
  prometheus?: KubeprometheusstackHelmValuesKubestatemetricsPrometheus;
};

export type KubeprometheusstackHelmValuesKubestatemetricsPrometheus = {
  /**
   * @default {"enabled":true,"http":{"honorLabels":true},"metrics":{"honorLabels":true}}
   */
  monitor?: KubeprometheusstackHelmValuesKubestatemetricsPrometheusMonitor;
};

export type KubeprometheusstackHelmValuesKubestatemetricsPrometheusMonitor = {
  /**
   * Enable scraping via service monitor
   * Disable to prevent duplication if you enable prometheusScrape above
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * kube-state-metrics endpoint
   *
   * @default {"honorLabels":true}
   */
  http?: KubeprometheusstackHelmValuesKubestatemetricsPrometheusMonitorHttp;
  /**
   * selfMonitor endpoint
   *
   * @default {"honorLabels":true}
   */
  metrics?: KubeprometheusstackHelmValuesKubestatemetricsPrometheusMonitorMetrics;
};

export type KubeprometheusstackHelmValuesKubestatemetricsPrometheusMonitorHttp = {
  /**
   * Keep labels from scraped data, overriding server-side labels
   *
   * @default true
   */
  honorLabels?: boolean;
};

export type KubeprometheusstackHelmValuesKubestatemetricsPrometheusMonitorMetrics = {
  /**
   * Keep labels from scraped data, overriding server-side labels
   *
   * @default true
   */
  honorLabels?: boolean;
};

export type KubeprometheusstackHelmValuesNodeExporter = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"linux":{"enabled":true},"aix":{"enabled":true},"darwin":{"enabled":true}}
   */
  operatingSystems?: KubeprometheusstackHelmValuesNodeExporterOperatingSystems;
  /**
   * ForceDeployDashboard Create dashboard configmap even if nodeExporter deployment has been disabled
   *
   * @default false
   */
  forceDeployDashboards?: boolean;
};

export type KubeprometheusstackHelmValuesNodeExporterOperatingSystems = {
  /**
   * @default {"enabled":true}
   */
  linux?: KubeprometheusstackHelmValuesNodeExporterOperatingSystemsLinux;
  /**
   * @default {"enabled":true}
   */
  aix?: KubeprometheusstackHelmValuesNodeExporterOperatingSystemsAix;
  /**
   * @default {"enabled":true}
   */
  darwin?: KubeprometheusstackHelmValuesNodeExporterOperatingSystemsDarwin;
};

export type KubeprometheusstackHelmValuesNodeExporterOperatingSystemsLinux = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type KubeprometheusstackHelmValuesNodeExporterOperatingSystemsAix = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type KubeprometheusstackHelmValuesNodeExporterOperatingSystemsDarwin = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type KubeprometheusstackHelmValuesPrometheusnodeexporter = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * @default {"jobLabel":"node-exporter"}
   */
  podLabels?: KubeprometheusstackHelmValuesPrometheusnodeexporterPodLabels;
  /**
   * @default true
   */
  releaseLabel?: boolean;
  extraArgs?: string[];
  /**
   * @default {"portName":"http-metrics","ipDualStack":{"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"},"labels":{"jobLabel":"node-exporter"}}
   */
  service?: KubeprometheusstackHelmValuesPrometheusnodeexporterService;
  /**
   * @default {"monitor":{"enabled":true,"jobLabel":"jobLabel","interval":"","sampleLimit":0,"targetLimit":0,"labelLimit":0,"labelNameLengthLimit":0,"labelValueLengthLimit":0,"scrapeTimeout":"","proxyUrl":"","metricRelabelings":[],"relabelings":[]},"podMonitor":{"enabled":false,"jobLabel":"jobLabel"}}
   */
  prometheus?: KubeprometheusstackHelmValuesPrometheusnodeexporterPrometheus;
  /**
   * @default {"pspEnabled":false}
   */
  rbac?: KubeprometheusstackHelmValuesPrometheusnodeexporterRbac;
};

export type KubeprometheusstackHelmValuesPrometheusnodeexporterPodLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Add the 'node-exporter' label to be used by serviceMonitor and podMonitor to match standard common usage in rules and grafana dashboards
   *
   * @default "node-exporter"
   */
  jobLabel?: string;
};

export type KubeprometheusstackHelmValuesPrometheusnodeexporterService = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "http-metrics"
   */
  portName?: string;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesPrometheusnodeexporterServiceIpDualStack;
  /**
   * @default {"jobLabel":"node-exporter"}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusnodeexporterServiceLabels;
};

export type KubeprometheusstackHelmValuesPrometheusnodeexporterServiceIpDualStack = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
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

export type KubeprometheusstackHelmValuesPrometheusnodeexporterServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "node-exporter"
   */
  jobLabel?: string;
};

export type KubeprometheusstackHelmValuesPrometheusnodeexporterPrometheus = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Attach node metadata to discovered targets. Requires Prometheus v2.35.0 and above.
   *
   * @default {...} (12 keys)
   */
  monitor?: KubeprometheusstackHelmValuesPrometheusnodeexporterPrometheusMonitor;
  /**
   * @default {"enabled":false,"jobLabel":"jobLabel"}
   */
  podMonitor?: KubeprometheusstackHelmValuesPrometheusnodeexporterPrometheusPodMonitor;
};

export type KubeprometheusstackHelmValuesPrometheusnodeexporterPrometheusMonitor = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "jobLabel"
   */
  jobLabel?: string;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * How long until a scrape request times out. If not set, the Prometheus default scape timeout is used.
   *
   * @default ""
   */
  scrapeTimeout?: string;
  /**
   * @default ""
   */
  proxyUrl?: string;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusnodeexporterPrometheusPodMonitor = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "jobLabel"
   */
  jobLabel?: string;
};

export type KubeprometheusstackHelmValuesPrometheusnodeexporterRbac = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * If true, create PSPs for node-exporter
   *
   * @default false
   */
  pspEnabled?: boolean;
};

export type KubeprometheusstackHelmValuesPrometheusOperator = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Use '{{ template "kube-prometheus-stack.fullname" . }}-operator' by default
   *
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * Number of old replicasets to retain ##
   * The default value is 10, 0 will garbage-collect old replicasets ##
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * Strategy of the deployment
   *
   * @default {}
   */
  strategy?: KubeprometheusstackHelmValuesPrometheusOperatorStrategy;
  /**
   * Prometheus-Operator v0.39.0 and later support TLS natively.
   *
   * @default {"enabled":true,"tlsMinVersion":"VersionTLS13","internalPort":10250}
   */
  tls?: KubeprometheusstackHelmValuesPrometheusOperatorTls;
  /**
   * Liveness probe for the prometheusOperator deployment
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: KubeprometheusstackHelmValuesPrometheusOperatorLivenessProbe;
  /**
   * Readiness probe for the prometheusOperator deployment
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: KubeprometheusstackHelmValuesPrometheusOperatorReadinessProbe;
  /**
   * Admission webhook support for PrometheusRules resources added in Prometheus Operator 0.30 can be enabled to prevent incorrectly formatted
   * rules from making their way into prometheus and potentially preventing the container from starting
   *
   * @default {...} (15 keys)
   */
  admissionWebhooks?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooks;
  /**
   * Namespaces to scope the interaction of the Prometheus Operator and the apiserver (allow list).
   * This is mutually exclusive with denyNamespaces. Setting this to an empty object will disable the configuration
   *
   * @default {}
   */
  namespaces?: KubeprometheusstackHelmValuesPrometheusOperatorNamespaces;
  denyNamespaces?: unknown[];
  alertmanagerInstanceNamespaces?: unknown[];
  alertmanagerConfigNamespaces?: unknown[];
  prometheusInstanceNamespaces?: unknown[];
  thanosRulerInstanceNamespaces?: unknown[];
  /**
   * The clusterDomain value will be added to the cluster.peer option of the alertmanager.
   * Without this specified option cluster.peer will have value alertmanager-monitoring-alertmanager-0.alertmanager-operated:9094 (default value)
   * With this specified option cluster.peer will have value alertmanager-monitoring-alertmanager-0.alertmanager-operated.namespace.svc.cluster-domain:9094
   *
   * @default {"enabled":false,"flavor":"kubernetes"}
   */
  networkPolicy?: KubeprometheusstackHelmValuesPrometheusOperatorNetworkPolicy;
  /**
   * @default {...} (4 keys)
   */
  serviceAccount?: KubeprometheusstackHelmValuesPrometheusOperatorServiceAccount;
  /**
   * terminationGracePeriodSeconds for container lifecycle hook
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Specify lifecycle hooks for the  controller
   *
   * @default {}
   */
  lifecycle?: KubeprometheusstackHelmValuesPrometheusOperatorLifecycle;
  /**
   * Configuration for Prometheus operator service
   *
   * @default {...} (12 keys)
   */
  service?: KubeprometheusstackHelmValuesPrometheusOperatorService;
  /**
   * Labels to add to the operator deployment
   *
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusOperatorLabels;
  /**
   * Annotations to add to the operator deployment
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorAnnotations;
  /**
   * Labels to add to the operator pod
   *
   * @default {}
   */
  podLabels?: KubeprometheusstackHelmValuesPrometheusOperatorPodLabels;
  /**
   * Annotations to add to the operator pod
   *
   * @default {}
   */
  podAnnotations?: KubeprometheusstackHelmValuesPrometheusOperatorPodAnnotations;
  /**
   * Assign a podDisruptionBudget to the operator
   *
   * @default {"enabled":false,"minAvailable":1,"unhealthyPodEvictionPolicy":"AlwaysAllow"}
   */
  podDisruptionBudget?: KubeprometheusstackHelmValuesPrometheusOperatorPodDisruptionBudget;
  /**
   * Assign a PriorityClassName to pods if set
   * Define Log Format
   * Use logfmt (default) or json logging
   * Decrease log verbosity to errors only
   *
   * @default {...} (4 keys)
   */
  kubeletService?: KubeprometheusstackHelmValuesPrometheusOperatorKubeletService;
  /**
   * Create Endpoints objects for kubelet targets.
   *
   * @default true
   */
  kubeletEndpointsEnabled?: boolean;
  /**
   * Create EndpointSlice objects for kubelet targets.
   *
   * @default false
   */
  kubeletEndpointSliceEnabled?: boolean;
  extraArgs?: unknown[];
  /**
   * - --labels="cluster=talos-cluster"
   * Create a servicemonitor for the operator
   *
   * @default {...} (11 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesPrometheusOperatorServiceMonitor;
  /**
   * Resource limits & requests
   *
   * @default {}
   */
  resources?: KubeprometheusstackHelmValuesPrometheusOperatorResources;
  /**
   * @default {"GOGC":"30"}
   */
  env?: KubeprometheusstackHelmValuesPrometheusOperatorEnv;
  /**
   * Required for use in managed kubernetes clusters (such as AWS EKS) with custom CNI (such as calico),
   * because control-plane managed by AWS cannot communicate with pods' IP CIDR and admission webhooks are not working
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * Define which Nodes the Pods are scheduled on.
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector
   *
   * @default {}
   */
  nodeSelector?: KubeprometheusstackHelmValuesPrometheusOperatorNodeSelector;
  tolerations?: unknown[];
  /**
   * Assign custom affinity rules to the prometheus operator
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
   *
   * @default {}
   */
  affinity?: KubeprometheusstackHelmValuesPrometheusOperatorAffinity;
  /**
   * @default {}
   */
  dnsConfig?: KubeprometheusstackHelmValuesPrometheusOperatorDnsConfig;
  /**
   * @default {...} (5 keys)
   */
  securityContext?: KubeprometheusstackHelmValuesPrometheusOperatorSecurityContext;
  hostUsers?: unknown;
  /**
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   *
   * @default {"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]}}
   */
  containerSecurityContext?: KubeprometheusstackHelmValuesPrometheusOperatorContainerSecurityContext;
  /**
   * Enable vertical pod autoscaler support for prometheus-operator
   *
   * @default {...} (5 keys)
   */
  verticalPodAutoscaler?: KubeprometheusstackHelmValuesPrometheusOperatorVerticalPodAutoscaler;
  /**
   * Prometheus-operator image
   *
   * @default {...} (5 keys)
   */
  image?: KubeprometheusstackHelmValuesPrometheusOperatorImage;
  /**
   * Prometheus image to use for prometheuses managed by the operator
   * Prometheus image registry to use for prometheuses managed by the operator
   * Alertmanager image to use for alertmanagers managed by the operator
   * Alertmanager image registry to use for alertmanagers managed by the operator
   * Prometheus-config-reloader
   *
   * @default {"image":{"registry":"quay.io","repository":"prometheus-operator/prometheus-config-reloader","tag":"","sha":""},"enableProbe":false,"resources":{}}
   */
  prometheusConfigReloader?: KubeprometheusstackHelmValuesPrometheusOperatorPrometheusConfigReloader;
  /**
   * Thanos side-car image when configured
   *
   * @default {...} (4 keys)
   */
  thanosImage?: KubeprometheusstackHelmValuesPrometheusOperatorThanosImage;
  /**
   * Set a Label Selector to filter watched prometheus and prometheusAgent
   *
   * @default ""
   */
  prometheusInstanceSelector?: string;
  /**
   * Set a Label Selector to filter watched alertmanager
   *
   * @default ""
   */
  alertmanagerInstanceSelector?: string;
  /**
   * Set a Label Selector to filter watched thanosRuler
   *
   * @default ""
   */
  thanosRulerInstanceSelector?: string;
  /**
   * Set a Field Selector to filter watched secrets
   *
   * @default "type!=kubernetes.io/dockercfg,type!=kubernetes...."
   */
  secretFieldSelector?: string;
  /**
   * If false then the user will opt out of automounting API credentials.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusOperatorStrategy = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorTls = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Value must match version names from https://pkg.go.dev/crypto/tls#pkg-constants
   *
   * @default "VersionTLS13"
   */
  tlsMinVersion?: string;
  /**
   * The default webhook port is 10250 in order to work out-of-the-box in GKE private clusters and avoid adding firewall rules.
   *
   * @default 10250
   */
  internalPort?: number;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorLivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 0
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

export type KubeprometheusstackHelmValuesPrometheusOperatorReadinessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 0
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

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooks = {
  /**
   * Valid values: Fail, Ignore, IgnoreOnInstallOnly
   * IgnoreOnInstallOnly - If Release.IsInstall returns "true", set "Ignore" otherwise "Fail"
   *
   * @default ""
   */
  failurePolicy?: string;
  /**
   * The default timeoutSeconds is 10 and the maximum value is 30.
   *
   * @default 10
   */
  timeoutSeconds?: number;
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * A PEM encoded CA bundle which will be used to validate the webhook's server certificate.
   * If unspecified, system trust roots on the apiserver are used.
   *
   * @default ""
   */
  caBundle?: string;
  /**
   * If enabled, generate a self-signed certificate, then patch the webhook configurations with the generated data.
   * On chart upgrades (or if the secret exists) the cert will not be re-generated. You can use this to provide your own
   * certs ahead of time if you wish.
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksAnnotations;
  /**
   * argocd.argoproj.io/hook: PreSync
   * argocd.argoproj.io/hook-delete-policy: HookSucceeded
   *
   * @default {}
   */
  namespaceSelector?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksNamespaceSelector;
  /**
   * @default {}
   */
  objectSelector?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksObjectSelector;
  /**
   * @default {}
   */
  matchConditions?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksMatchConditions;
  /**
   * argocd.argoproj.io/hook: PreSync
   *
   * @default {"annotations":{}}
   */
  mutatingWebhookConfiguration?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksMutatingWebhookConfiguration;
  /**
   * argocd.argoproj.io/hook: PreSync
   *
   * @default {"annotations":{}}
   */
  validatingWebhookConfiguration?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksValidatingWebhookConfiguration;
  /**
   * @default {...} (24 keys)
   */
  deployment?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeployment;
  /**
   * @default {...} (12 keys)
   */
  patch?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatch;
  /**
   * Security context for create job container
   * Security context for patch job container
   *
   * @default {"securityContext":{"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]}}}
   */
  createSecretJob?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCreateSecretJob;
  /**
   * @default {"securityContext":{"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]}}}
   */
  patchWebhookJob?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchWebhookJob;
  /**
   * Use certmanager to generate webhook certs
   *
   * @default {"enabled":false,"rootCert":{"duration":"","revisionHistoryLimit":null},"admissionCert":{"duration":"","revisionHistoryLimit":null}}
   */
  certManager?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCertManager;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksNamespaceSelector = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksObjectSelector = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksMatchConditions = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksMutatingWebhookConfiguration = {
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksMutatingWebhookConfigurationAnnotations;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksMutatingWebhookConfigurationAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksValidatingWebhookConfiguration = {
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksValidatingWebhookConfigurationAnnotations;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksValidatingWebhookConfigurationAnnotations =
  {
    /**
     * This type allows arbitrary additional properties beyond those defined below.
     * This is common for config maps, custom settings, and extensible configurations.
     */
    [key: string]: unknown;
  };

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeployment = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Number of replicas
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Strategy of the deployment
   *
   * @default {}
   */
  strategy?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentStrategy;
  /**
   * Ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {"enabled":false,"minAvailable":1,"unhealthyPodEvictionPolicy":"AlwaysAllow"}
   */
  podDisruptionBudget?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentPodDisruptionBudget;
  /**
   * Number of old replicasets to retain ##
   * The default value is 10, 0 will garbage-collect old replicasets ##
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * Prometheus-Operator v0.39.0 and later support TLS natively.
   *
   * @default {"enabled":true,"tlsMinVersion":"VersionTLS13","internalPort":10250}
   */
  tls?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentTls;
  /**
   * Service account for Prometheus Operator Webhook to use.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default {...} (4 keys)
   */
  serviceAccount?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentServiceAccount;
  /**
   * Configuration for Prometheus operator Webhook service
   *
   * @default {...} (12 keys)
   */
  service?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentService;
  /**
   * Labels to add to the operator webhook deployment
   *
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentLabels;
  /**
   * Annotations to add to the operator webhook deployment
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentAnnotations;
  /**
   * Labels to add to the operator webhook pod
   *
   * @default {}
   */
  podLabels?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentPodLabels;
  /**
   * Annotations to add to the operator webhook pod
   *
   * @default {}
   */
  podAnnotations?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentPodAnnotations;
  /**
   * Assign a PriorityClassName to pods if set
   * Define Log Format
   * Use logfmt (default) or json logging
   * Decrease log verbosity to errors only
   * Prometheus-operator webhook image
   *
   * @default {...} (5 keys)
   */
  image?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentImage;
  /**
   * Define Log Format
   * Use logfmt (default) or json logging
   * Decrease log verbosity to errors only
   * Liveness probe
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentLivenessProbe;
  /**
   * Readiness probe
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentReadinessProbe;
  /**
   * Resource limits & requests
   *
   * @default {}
   */
  resources?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentResources;
  /**
   * Required for use in managed kubernetes clusters (such as AWS EKS) with custom CNI (such as calico),
   * because control-plane managed by AWS cannot communicate with pods' IP CIDR and admission webhooks are not working
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * Define which Nodes the Pods are scheduled on.
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector
   *
   * @default {}
   */
  nodeSelector?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentNodeSelector;
  tolerations?: unknown[];
  /**
   * Assign custom affinity rules to the prometheus operator
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
   *
   * @default {}
   */
  affinity?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentAffinity;
  /**
   * @default {}
   */
  dnsConfig?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentDnsConfig;
  /**
   * @default {...} (5 keys)
   */
  securityContext?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentSecurityContext;
  /**
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   *
   * @default {"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]}}
   */
  containerSecurityContext?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentContainerSecurityContext;
  /**
   * If false then the user will opt out of automounting API credentials.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentStrategy = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentPodDisruptionBudget = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  minAvailable?: number;
  /**
   * @default "AlwaysAllow"
   */
  unhealthyPodEvictionPolicy?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentTls = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Value must match version names from https://pkg.go.dev/crypto/tls#pkg-constants
   *
   * @default "VersionTLS13"
   */
  tlsMinVersion?: string;
  /**
   * The default webhook port is 10250 in order to work out-of-the-box in GKE private clusters and avoid adding firewall rules.
   *
   * @default 10250
   */
  internalPort?: number;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentServiceAccount = {
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentServiceAccountAnnotations;
  /**
   * @default false
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default ""
   */
  name?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentService = {
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentServiceAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentServiceLabels;
  /**
   * @default ""
   */
  clusterIP?: string;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentServiceIpDualStack;
  /**
   * Port to expose on each node
   * Only used if service.type is 'NodePort'
   *
   * @default 31080
   */
  nodePort?: number;
  /**
   * @default 31443
   */
  nodePortTls?: number;
  additionalPorts?: unknown[];
  /**
   * Loadbalancer IP
   * Only use if service.type is "LoadBalancer"
   *
   * @default ""
   */
  loadBalancerIP?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Denotes if this Service desires to route external traffic to node-local or cluster-wide endpoints
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * Service type
   * NodePort, ClusterIP, LoadBalancer
   *
   * @default "ClusterIP"
   */
  type?: string;
  externalIPs?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentPodLabels = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentPodAnnotations = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentImage = {
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "prometheus-operator/admission-webhook"
   */
  repository?: string;
  /**
   * if not set appVersion field from Chart.yaml is used
   *
   * @default ""
   */
  tag?: string;
  /**
   * @default ""
   */
  sha?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentLivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 30
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

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentReadinessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 5
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

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentResources = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentNodeSelector = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentAffinity = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentDnsConfig = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentSecurityContext = {
  /**
   * @default 65534
   */
  fsGroup?: number;
  /**
   * @default 65534
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 65534
   */
  runAsUser?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentSecurityContextSeccompProfile;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentContainerSecurityContext = {
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
  capabilities?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentContainerSecurityContextCapabilities;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksDeploymentContainerSecurityContextCapabilities =
  {
    drop?: string[];
  };

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatch = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {...} (5 keys)
   */
  image?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchImage;
  /**
   * @default {}
   */
  resources?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchResources;
  /**
   * Provide a priority class name to the webhook patching job
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * @default 60
   */
  ttlSecondsAfterFinished?: number;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchAnnotations;
  /**
   * argocd.argoproj.io/hook: PreSync
   * argocd.argoproj.io/hook-delete-policy: HookSucceeded
   *
   * @default {}
   */
  podAnnotations?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchPodAnnotations;
  /**
   * @default {}
   */
  nodeSelector?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchNodeSelector;
  /**
   * @default {}
   */
  affinity?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchAffinity;
  tolerations?: unknown[];
  /**
   * SecurityContext holds pod-level security attributes and common container settings.
   * This defaults to non root user with uid 2000 and gid 2000. *v1.PodSecurityContext  false
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   *
   * @default {...} (4 keys)
   */
  securityContext?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchSecurityContext;
  /**
   * Service account for Prometheus Operator Webhook Job Patch to use.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default {"create":true,"annotations":{},"automountServiceAccountToken":true}
   */
  serviceAccount?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchServiceAccount;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchImage = {
  /**
   * @default "ghcr.io"
   */
  registry?: string;
  /**
   * @default "jkroepke/kube-webhook-certgen"
   */
  repository?: string;
  /**
   * @default "1.7.4"
   */
  tag?: string;
  /**
   * @default ""
   */
  sha?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchResources = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchPodAnnotations = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchNodeSelector = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchAffinity = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchSecurityContext = {
  /**
   * @default 2000
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 2000
   */
  runAsUser?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchSecurityContextSeccompProfile;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchServiceAccount = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchServiceAccountAnnotations;
  /**
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCreateSecretJob = {
  /**
   * @default {"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]}}
   */
  securityContext?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCreateSecretJobSecurityContext;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCreateSecretJobSecurityContext = {
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
  capabilities?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCreateSecretJobSecurityContextCapabilities;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCreateSecretJobSecurityContextCapabilities =
  {
    drop?: string[];
  };

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchWebhookJob = {
  /**
   * @default {"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]}}
   */
  securityContext?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchWebhookJobSecurityContext;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchWebhookJobSecurityContext = {
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
  capabilities?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchWebhookJobSecurityContextCapabilities;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksPatchWebhookJobSecurityContextCapabilities =
  {
    drop?: string[];
  };

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCertManager = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * self-signed root certificate
   *
   * @default {"duration":"","revisionHistoryLimit":null}
   */
  rootCert?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCertManagerRootCert;
  /**
   * @default {"duration":"","revisionHistoryLimit":null}
   */
  admissionCert?: KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCertManagerAdmissionCert;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCertManagerRootCert = {
  /**
   * default to be 5y
   *
   * @default ""
   */
  duration?: string;
  revisionHistoryLimit?: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAdmissionWebhooksCertManagerAdmissionCert = {
  /**
   * default to be 1y
   *
   * @default ""
   */
  duration?: string;
  revisionHistoryLimit?: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorNamespaces = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorNetworkPolicy = {
  /**
   * Enable creation of NetworkPolicy resources.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Flavor of the network policy to use.
   * Can be:
   * * kubernetes for networking.k8s.io/v1/NetworkPolicy
   * * cilium     for cilium.io/v2/CiliumNetworkPolicy
   *
   * @default "kubernetes"
   */
  flavor?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorServiceAccount = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default ""
   */
  name?: string;
  /**
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorServiceAccountAnnotations;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorLifecycle = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorService = {
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusOperatorServiceAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusOperatorServiceLabels;
  /**
   * @default ""
   */
  clusterIP?: string;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesPrometheusOperatorServiceIpDualStack;
  /**
   * Port to expose on each node
   * Only used if service.type is 'NodePort'
   *
   * @default 30080
   */
  nodePort?: number;
  /**
   * @default 30443
   */
  nodePortTls?: number;
  additionalPorts?: unknown[];
  /**
   * Loadbalancer IP
   * Only use if service.type is "LoadBalancer"
   *
   * @default ""
   */
  loadBalancerIP?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Denotes if this Service desires to route external traffic to node-local or cluster-wide endpoints
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * Service type
   * NodePort, ClusterIP, LoadBalancer
   *
   * @default "ClusterIP"
   */
  type?: string;
  externalIPs?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusOperatorServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesPrometheusOperatorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorPodLabels = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorPodAnnotations = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorPodDisruptionBudget = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  minAvailable?: number;
  /**
   * @default "AlwaysAllow"
   */
  unhealthyPodEvictionPolicy?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorKubeletService = {
  /**
   * If true, the operator will create and maintain a service for scraping kubelets
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/helm/prometheus-operator/README.md
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "kube-system"
   */
  namespace?: string;
  /**
   * @default ""
   */
  selector?: string;
  /**
   * Use '{{ template "kube-prometheus-stack.fullname" . }}-kubelet' by default
   *
   * @default ""
   */
  name?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorServiceMonitor = {
  /**
   * If true, create a serviceMonitor for prometheus operator
   *
   * @default true
   */
  selfMonitor?: boolean;
  /**
   * Labels for ServiceMonitor
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesPrometheusOperatorServiceMonitorAdditionalLabels;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * Scrape timeout. If not set, the Prometheus default scrape timeout is used.
   *
   * @default ""
   */
  scrapeTimeout?: string;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusOperatorServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorResources = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorEnv = {
  /**
   * @default "30"
   */
  GOGC?: number;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorNodeSelector = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorAffinity = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorDnsConfig = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorSecurityContext = {
  /**
   * @default 65534
   */
  fsGroup?: number;
  /**
   * @default 65534
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 65534
   */
  runAsUser?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KubeprometheusstackHelmValuesPrometheusOperatorSecurityContextSeccompProfile;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorContainerSecurityContext = {
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
  capabilities?: KubeprometheusstackHelmValuesPrometheusOperatorContainerSecurityContextCapabilities;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type KubeprometheusstackHelmValuesPrometheusOperatorVerticalPodAutoscaler = {
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
  maxAllowed?: KubeprometheusstackHelmValuesPrometheusOperatorVerticalPodAutoscalerMaxAllowed;
  /**
   * Define the min allowed resources for the pod
   *
   * @default {}
   */
  minAllowed?: KubeprometheusstackHelmValuesPrometheusOperatorVerticalPodAutoscalerMinAllowed;
  /**
   * @default {"updateMode":"Auto"}
   */
  updatePolicy?: KubeprometheusstackHelmValuesPrometheusOperatorVerticalPodAutoscalerUpdatePolicy;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorVerticalPodAutoscalerMaxAllowed = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorVerticalPodAutoscalerMinAllowed = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorVerticalPodAutoscalerUpdatePolicy = {
  /**
   * Specifies minimal number of replicas which need to be alive for VPA Updater to attempt pod eviction
   * Specifies whether recommended updates are applied when a Pod is started and whether recommended updates
   * are applied during the life of a Pod. Possible values are "Off", "Initial", "Recreate", and "Auto".
   *
   * @default "Auto"
   */
  updateMode?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorImage = {
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "prometheus-operator/prometheus-operator"
   */
  repository?: string;
  /**
   * if not set appVersion field from Chart.yaml is used
   *
   * @default ""
   */
  tag?: string;
  /**
   * @default ""
   */
  sha?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorPrometheusConfigReloader = {
  /**
   * @default {...} (4 keys)
   */
  image?: KubeprometheusstackHelmValuesPrometheusOperatorPrometheusConfigReloaderImage;
  /**
   * add prometheus config reloader liveness and readiness probe. Default: false
   *
   * @default false
   */
  enableProbe?: boolean;
  /**
   * resource config for prometheusConfigReloader
   *
   * @default {}
   */
  resources?: KubeprometheusstackHelmValuesPrometheusOperatorPrometheusConfigReloaderResources;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorPrometheusConfigReloaderImage = {
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "prometheus-operator/prometheus-config-reloader"
   */
  repository?: string;
  /**
   * if not set appVersion field from Chart.yaml is used
   *
   * @default ""
   */
  tag?: string;
  /**
   * @default ""
   */
  sha?: string;
};

export type KubeprometheusstackHelmValuesPrometheusOperatorPrometheusConfigReloaderResources = object;

export type KubeprometheusstackHelmValuesPrometheusOperatorThanosImage = {
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "thanos/thanos"
   */
  repository?: string;
  /**
   * @default "v0.40.1"
   */
  tag?: string;
  /**
   * @default ""
   */
  sha?: string;
};

export type KubeprometheusstackHelmValuesPrometheus = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Toggle prometheus into agent mode
   * Note many of features described below (e.g. rules, query, alerting, remote read, thanos) will not work in agent mode.
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/platform/prometheus-agent.md
   *
   * @default false
   */
  agentMode?: boolean;
  /**
   * Annotations for Prometheus
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusAnnotations;
  /**
   * Additional labels for Prometheus
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesPrometheusAdditionalLabels;
  /**
   * Configure network policy for the prometheus
   *
   * @default {"enabled":false,"flavor":"kubernetes","namespace":null}
   */
  networkPolicy?: KubeprometheusstackHelmValuesPrometheusNetworkPolicy;
  /**
   * @default {...} (4 keys)
   */
  serviceAccount?: KubeprometheusstackHelmValuesPrometheusServiceAccount;
  /**
   * Service for thanos service discovery on sidecar
   * Enable this can make Thanos Query can use
   * `--store=dnssrv+_grpc._tcp.${kube-prometheus-stack.fullname}-thanos-discovery.${namespace}.svc.cluster.local` to discovery
   * Thanos sidecar on prometheus nodes
   * (Please remember to change ${kube-prometheus-stack.fullname} and ${namespace}. Not just copy and paste!)
   *
   * @default {...} (15 keys)
   */
  thanosService?: KubeprometheusstackHelmValuesPrometheusThanosService;
  /**
   * ServiceMonitor to scrape Sidecar metrics
   * Needs thanosService to be enabled as well
   *
   * @default {...} (8 keys)
   */
  thanosServiceMonitor?: KubeprometheusstackHelmValuesPrometheusThanosServiceMonitor;
  /**
   * Service for external access to sidecar
   * Enabling this creates a service to expose thanos-sidecar outside the cluster.
   *
   * @default {...} (15 keys)
   */
  thanosServiceExternal?: KubeprometheusstackHelmValuesPrometheusThanosServiceExternal;
  /**
   * Configuration for Prometheus service
   *
   * @default {...} (18 keys)
   */
  service?: KubeprometheusstackHelmValuesPrometheusService;
  /**
   * Configuration for creating a separate Service for each statefulset Prometheus replica
   *
   * @default {...} (9 keys)
   */
  servicePerReplica?: KubeprometheusstackHelmValuesPrometheusServicePerReplica;
  /**
   * Configure pod disruption budgets for Prometheus
   * ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/#specifying-a-poddisruptionbudget
   *
   * @default {"enabled":false,"minAvailable":1,"unhealthyPodEvictionPolicy":"AlwaysAllow"}
   */
  podDisruptionBudget?: KubeprometheusstackHelmValuesPrometheusPodDisruptionBudget;
  /**
   * Ingress exposes thanos sidecar outside the cluster
   * ExtraSecret can be used to store various data in an extra secret
   * (use it for example to store hashed basic auth credentials)
   *
   * @default {...} (9 keys)
   */
  thanosIngress?: KubeprometheusstackHelmValuesPrometheusThanosIngress;
  /**
   * @default {"annotations":{},"data":{}}
   */
  extraSecret?: KubeprometheusstackHelmValuesPrometheusExtraSecret;
  /**
   * foo:$apr1$OFG3Xybp$ckL0FHDAkoXYIlH9.cysT0
   * someoneelse:$apr1$DMZX2Z4q$6SbQIfyuLQd.xmo/P0m2c.
   *
   * @default {...} (7 keys)
   */
  ingress?: KubeprometheusstackHelmValuesPrometheusIngress;
  /**
   * BETA: Configure the gateway routes for the chart here.
   * More routes can be added by adding a dictionary key like the 'main' route.
   * Be aware that this is an early beta of this feature,
   * kube-prometheus-stack does not guarantee this works and is subject to change.
   * Being BETA this can/will change in the future without notice, do not use unless you want to take that risk
   * [[ref]](https://gateway-api.sigs.k8s.io/reference/spec/#gateway.networking.k8s.io%2fv1alpha2)
   *
   * @default {"main":{"enabled":false,"apiVersion":"gateway.networking.k8s.io/v1","kind":"HTTPRoute","annotations":{},"labels":{},"hostnames":[],"parentRefs":[],"httpsRedirect":false,"matches":[{"path":{"type":"PathPrefix","value":"/"}}],"filters":[],"additionalRules":[]}}
   */
  route?: KubeprometheusstackHelmValuesPrometheusRoute;
  /**
   * Configuration for creating an Ingress that will map to each Prometheus replica service
   * prometheus.servicePerReplica must be enabled
   *
   * @default {...} (9 keys)
   */
  ingressPerReplica?: KubeprometheusstackHelmValuesPrometheusIngressPerReplica;
  /**
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#prometheusspec
   *
   * @default {...} (14 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesPrometheusServiceMonitor;
  /**
   * @default {...} (117 keys)
   */
  prometheusSpec?: KubeprometheusstackHelmValuesPrometheusPrometheusSpec;
  additionalRulesForClusterRole?: unknown[];
  additionalServiceMonitors?: unknown[];
  additionalPodMonitors?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusAdditionalLabels = object;

export type KubeprometheusstackHelmValuesPrometheusNetworkPolicy = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Flavor of the network policy to use.
   * Can be:
   * * kubernetes for networking.k8s.io/v1/NetworkPolicy
   * * cilium     for cilium.io/v2/CiliumNetworkPolicy
   *
   * @default "kubernetes"
   */
  flavor?: string;
  namespace?: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusServiceAccount = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default ""
   */
  name?: string;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusServiceAccountAnnotations;
  /**
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type KubeprometheusstackHelmValuesPrometheusServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusThanosService = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusThanosServiceAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusThanosServiceLabels;
  /**
   * Denotes if this Service desires to route external traffic to node-local or cluster-wide endpoints
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * Service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Service dual stack
   *
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesPrometheusThanosServiceIpDualStack;
  /**
   * gRPC port config
   *
   * @default "grpc"
   */
  portName?: string;
  /**
   * @default 10901
   */
  port?: number;
  /**
   * @default "grpc"
   */
  targetPort?: string;
  /**
   * HTTP port config (for metrics)
   *
   * @default "http"
   */
  httpPortName?: string;
  /**
   * @default 10902
   */
  httpPort?: number;
  /**
   * @default "http"
   */
  targetHttpPort?: string;
  /**
   * ClusterIP to assign
   * Default is to make this a headless service ("None")
   *
   * @default "None"
   */
  clusterIP?: string;
  /**
   * Port to expose on each node, if service type is NodePort
   *
   * @default 30901
   */
  nodePort?: number;
  /**
   * @default 30902
   */
  httpNodePort?: number;
};

export type KubeprometheusstackHelmValuesPrometheusThanosServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusThanosServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusThanosServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesPrometheusThanosServiceMonitor = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  interval?: string;
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesPrometheusThanosServiceMonitorAdditionalLabels;
  /**
   * @default ""
   */
  scheme?: string;
  /**
   * Of type: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#tlsconfig
   *
   * @default {}
   */
  tlsConfig?: KubeprometheusstackHelmValuesPrometheusThanosServiceMonitorTlsConfig;
  bearerTokenFile?: unknown;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusThanosServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesPrometheusThanosServiceMonitorTlsConfig = object;

export type KubeprometheusstackHelmValuesPrometheusThanosServiceExternal = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusThanosServiceExternalAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusThanosServiceExternalLabels;
  /**
   * @default ""
   */
  loadBalancerIP?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * gRPC port config
   *
   * @default "grpc"
   */
  portName?: string;
  /**
   * @default 10901
   */
  port?: number;
  /**
   * @default "grpc"
   */
  targetPort?: string;
  /**
   * HTTP port config (for metrics)
   *
   * @default "http"
   */
  httpPortName?: string;
  /**
   * @default 10902
   */
  httpPort?: number;
  /**
   * @default "http"
   */
  targetHttpPort?: string;
  /**
   * Denotes if this Service desires to route external traffic to node-local or cluster-wide endpoints
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * Service type
   *
   * @default "LoadBalancer"
   */
  type?: string;
  /**
   * Port to expose on each node
   *
   * @default 30901
   */
  nodePort?: number;
  /**
   * @default 30902
   */
  httpNodePort?: number;
};

export type KubeprometheusstackHelmValuesPrometheusThanosServiceExternalAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusThanosServiceExternalLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusService = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusServiceAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusServiceLabels;
  /**
   * @default ""
   */
  clusterIP?: string;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesPrometheusServiceIpDualStack;
  /**
   * Port for Prometheus Service to listen on
   *
   * @default 9090
   */
  port?: number;
  /**
   * To be used with a proxy extraContainer port
   *
   * @default 9090
   */
  targetPort?: number;
  /**
   * Port for Prometheus Reloader to listen on
   *
   * @default 8080
   */
  reloaderWebPort?: number;
  externalIPs?: unknown[];
  /**
   * Port to expose on each node
   * Only used if service.type is 'NodePort'
   *
   * @default 30090
   */
  nodePort?: number;
  /**
   * Loadbalancer IP
   * Only use if service.type is "LoadBalancer"
   *
   * @default ""
   */
  loadBalancerIP?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Denotes if this Service desires to route external traffic to node-local or cluster-wide endpoints
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * Service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  additionalPorts?: unknown[];
  /**
   * Consider that all endpoints are considered "ready" even if the Pods themselves are not
   * Ref: https://kubernetes.io/docs/reference/kubernetes-api/service-resources/service-v1/#ServiceSpec
   *
   * @default false
   */
  publishNotReadyAddresses?: boolean;
  /**
   * If you want to make sure that connections from a particular client are passed to the same Pod each time
   * Accepts 'ClientIP' or 'None'
   *
   * @default "None"
   */
  sessionAffinity?: string;
  /**
   * If you want to modify the ClientIP sessionAffinity timeout
   * The value must be >0 && <=86400(for 1 day) if ServiceAffinity == "ClientIP"
   *
   * @default {"clientIP":{"timeoutSeconds":10800}}
   */
  sessionAffinityConfig?: KubeprometheusstackHelmValuesPrometheusServiceSessionAffinityConfig;
};

export type KubeprometheusstackHelmValuesPrometheusServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesPrometheusServiceSessionAffinityConfig = {
  /**
   * @default {"timeoutSeconds":10800}
   */
  clientIP?: KubeprometheusstackHelmValuesPrometheusServiceSessionAffinityConfigClientIP;
};

export type KubeprometheusstackHelmValuesPrometheusServiceSessionAffinityConfigClientIP = {
  /**
   * @default 10800
   */
  timeoutSeconds?: number;
};

export type KubeprometheusstackHelmValuesPrometheusServicePerReplica = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusServicePerReplicaAnnotations;
  /**
   * Port for Prometheus Service per replica to listen on
   *
   * @default 9090
   */
  port?: number;
  /**
   * To be used with a proxy extraContainer port
   *
   * @default 9090
   */
  targetPort?: number;
  /**
   * Port to expose on each node
   * Only used if servicePerReplica.type is 'NodePort'
   *
   * @default 30091
   */
  nodePort?: number;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Denotes if this Service desires to route external traffic to node-local or cluster-wide endpoints
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * Service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Service dual stack
   *
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesPrometheusServicePerReplicaIpDualStack;
};

export type KubeprometheusstackHelmValuesPrometheusServicePerReplicaAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusServicePerReplicaIpDualStack = {
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

export type KubeprometheusstackHelmValuesPrometheusPodDisruptionBudget = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  minAvailable?: number;
  /**
   * @default "AlwaysAllow"
   */
  unhealthyPodEvictionPolicy?: string;
};

export type KubeprometheusstackHelmValuesPrometheusThanosIngress = {
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
  annotations?: KubeprometheusstackHelmValuesPrometheusThanosIngressAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusThanosIngressLabels;
  /**
   * @default 10901
   */
  servicePort?: number;
  /**
   * Port to expose on each node
   * Only used if service.type is 'NodePort'
   *
   * @default 30901
   */
  nodePort?: number;
  hosts?: unknown[];
  paths?: unknown[];
  tls?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusThanosIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusThanosIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusExtraSecret = {
  /**
   * if not set, name will be auto generated
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusExtraSecretAnnotations;
  /**
   * @default {}
   */
  data?: KubeprometheusstackHelmValuesPrometheusExtraSecretData;
};

export type KubeprometheusstackHelmValuesPrometheusExtraSecretAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusExtraSecretData = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusIngress = {
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
  annotations?: KubeprometheusstackHelmValuesPrometheusIngressAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusIngressLabels;
  hosts?: unknown[];
  paths?: unknown[];
  tls?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusRoute = {
  /**
   * @default {...} (11 keys)
   */
  main?: KubeprometheusstackHelmValuesPrometheusRouteMain;
};

export type KubeprometheusstackHelmValuesPrometheusRouteMain = {
  /**
   * Enables or disables the route
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Set the route apiVersion, e.g. gateway.networking.k8s.io/v1 or gateway.networking.k8s.io/v1alpha2
   *
   * @default "gateway.networking.k8s.io/v1"
   */
  apiVersion?: string;
  /**
   * Set the route kind
   * Valid options are GRPCRoute, HTTPRoute, TCPRoute, TLSRoute, UDPRoute
   *
   * @default "HTTPRoute"
   */
  kind?: string;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesPrometheusRouteMainAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusRouteMainLabels;
  hostnames?: unknown[];
  parentRefs?: unknown[];
  /**
   * create http route for redirect (https://gateway-api.sigs.k8s.io/guides/http-redirect-rewrite/#http-to-https-redirects)
   * Take care that you only enable this on the http listener of the gateway to avoid an infinite redirect.
   * matches, filters and additionalRules will be ignored if this is set to true. Be are
   *
   * @default false
   */
  httpsRedirect?: boolean;
  matches?: KubeprometheusstackHelmValuesPrometheusRouteMainMatchesElement[];
  filters?: unknown[];
  additionalRules?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusRouteMainAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusRouteMainLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusRouteMainMatchesElement = {
  /**
   * @default {"type":"PathPrefix","value":"/"}
   */
  path?: KubeprometheusstackHelmValuesPrometheusRouteMainMatchesPath;
};

export type KubeprometheusstackHelmValuesPrometheusRouteMainMatchesPath = {
  /**
   * @default "PathPrefix"
   */
  type?: string;
  /**
   * @default "/"
   */
  value?: string;
};

export type KubeprometheusstackHelmValuesPrometheusIngressPerReplica = {
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
  annotations?: KubeprometheusstackHelmValuesPrometheusIngressPerReplicaAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesPrometheusIngressPerReplicaLabels;
  /**
   * Final form of the hostname for each per replica ingress is
   * {{ ingressPerReplica.hostPrefix }}-{{ $replicaNumber }}.{{ ingressPerReplica.hostDomain }}
   * Prefix for the per replica ingress that will have `-$replicaNumber`
   * appended to the end
   *
   * @default ""
   */
  hostPrefix?: string;
  /**
   * Domain that will be used for the per replica ingress
   *
   * @default ""
   */
  hostDomain?: string;
  paths?: unknown[];
  /**
   * - /
   * For Kubernetes >= 1.18 you should specify the pathType (determines how Ingress paths should be matched)
   * See https://kubernetes.io/blog/2020/04/02/improvements-to-the-ingress-api-in-kubernetes-1.18/#better-path-matching-with-path-types
   * Secret name containing the TLS certificate for Prometheus per replica ingress
   * Secret must be manually created in the namespace
   *
   * @default ""
   */
  tlsSecretName?: string;
  /**
   * Separated secret for each per replica Ingress. Can be used together with cert-manager
   *
   * @default {"enabled":false,"prefix":"prometheus"}
   */
  tlsSecretPerReplica?: KubeprometheusstackHelmValuesPrometheusIngressPerReplicaTlsSecretPerReplica;
};

export type KubeprometheusstackHelmValuesPrometheusIngressPerReplicaAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusIngressPerReplicaLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusIngressPerReplicaTlsSecretPerReplica = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Final form of the secret for each per replica ingress is
   * {{ tlsSecretPerReplica.prefix }}-{{ $replicaNumber }}
   *
   * @default "prometheus"
   */
  prefix?: string;
};

export type KubeprometheusstackHelmValuesPrometheusServiceMonitor = {
  /**
   * If true, create a serviceMonitor for prometheus
   *
   * @default true
   */
  selfMonitor?: boolean;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesPrometheusServiceMonitorAdditionalLabels;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  scheme?: string;
  /**
   * Of type: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#tlsconfig
   *
   * @default {}
   */
  tlsConfig?: KubeprometheusstackHelmValuesPrometheusServiceMonitorTlsConfig;
  bearerTokenFile?: unknown;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
  additionalEndpoints?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesPrometheusServiceMonitorTlsConfig = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpec = {
  /**
   * Statefulset's persistent volume claim retention policy
   * whenDeleted and whenScaled determine whether
   * statefulset's PVCs are deleted (true) or retained (false)
   * on scaling down and deleting statefulset, respectively.
   * Requires Kubernetes version 1.27.0+.
   * Ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#persistentvolumeclaim-retention
   *
   * @default {}
   */
  persistentVolumeClaimRetentionPolicy?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecPersistentVolumeClaimRetentionPolicy;
  /**
   * If true, pass --storage.tsdb.max-block-duration=2h to prometheus. This is already done if using Thanos
   *
   * @default false
   */
  disableCompaction?: boolean;
  /**
   * AutomountServiceAccountToken indicates whether a service account token should be automatically mounted in the pod,
   * If the field isn't set, the operator mounts the service account token by default.
   * Warning: be aware that by default, Prometheus requires the service account token for Kubernetes service discovery,
   * It is possible to use strategic merge patch to project the service account token into the 'prometheus' container.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * APIServerConfig
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#apiserverconfig
   *
   * @default {}
   */
  apiserverConfig?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecApiserverConfig;
  additionalArgs?: unknown[];
  /**
   * Convert all classic histograms to native histograms with custom buckets.
   * This corresponds to the 'convert_classic_histograms_to_nhcb' field in Prometheus configuration.
   *
   * @default false
   */
  convertClassicHistogramsToNHCB?: boolean;
  /**
   * Enable scraping of classic histograms that are also exposed as native histograms.
   * This corresponds to the 'always_scrape_classic_histograms' field in Prometheus configuration.
   *
   * @default false
   */
  scrapeClassicHistograms?: boolean;
  /**
   * Enable scraping of native histograms.
   * This corresponds to the 'scrape_native_histograms' field in Prometheus configuration.
   *
   * @default false
   */
  scrapeNativeHistograms?: boolean;
  /**
   * File to which scrape failures are logged.
   * Reloading the configuration will reopen the file.
   * Defaults to empty (disabled)
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#monitoring.coreos.com/v1.Prometheus
   *
   * @default ""
   */
  scrapeFailureLogFile?: string;
  /**
   * Interval between consecutive scrapes.
   * Defaults to 30s.
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/release-0.44/pkg/prometheus/promcfg.go#L180-L183
   *
   * @default ""
   */
  scrapeInterval?: string;
  /**
   * Number of seconds to wait for target to respond before erroring
   *
   * @default ""
   */
  scrapeTimeout?: string;
  scrapeClasses?: unknown[];
  podTargetLabels?: unknown[];
  /**
   * - customlabel
   * Interval between consecutive evaluations.
   *
   * @default ""
   */
  evaluationInterval?: string;
  /**
   * ListenLocal makes the Prometheus server listen on loopback, so that it does not bind against the Pod IP.
   *
   * @default false
   */
  listenLocal?: boolean;
  /**
   * enableOTLPReceiver enables the OTLP receiver for Prometheus.
   *
   * @default false
   */
  enableOTLPReceiver?: boolean;
  /**
   * EnableAdminAPI enables Prometheus the administrative HTTP API which includes functionality such as deleting time series.
   * This is disabled by default.
   * ref: https://prometheus.io/docs/prometheus/latest/querying/api/#tsdb-admin-apis
   *
   * @default false
   */
  enableAdminAPI?: boolean;
  /**
   * Sets version of Prometheus overriding the Prometheus version as derived
   * from the image tag. Useful in cases where the tag does not follow semver v2.
   *
   * @default ""
   */
  version?: string;
  /**
   * WebTLSConfig defines the TLS parameters for HTTPS
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#webtlsconfig
   *
   * @default {}
   */
  web?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecWeb;
  /**
   * Exemplars related settings that are runtime reloadable.
   * It requires to enable the exemplar storage feature to be effective.
   * Maximum number of exemplars stored in memory for all series.
   * If not set, Prometheus uses its default value.
   * A value of zero or less than zero disables the storage.
   *
   * @default {}
   */
  exemplars?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecExemplars;
  enableFeatures?: unknown[];
  /**
   * - exemplar-storage
   * https://prometheus.io/docs/guides/opentelemetry
   *
   * @default {}
   */
  otlp?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecOtlp;
  serviceName?: unknown;
  /**
   * Image of Prometheus.
   *
   * @default {...} (5 keys)
   */
  image?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecImage;
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  alertingEndpoints?: unknown[];
  /**
   * External labels to add to any time series or alerts when communicating with external systems
   *
   * @default {}
   */
  externalLabels?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecExternalLabels;
  /**
   * enable --web.enable-remote-write-receiver flag on prometheus-server
   *
   * @default false
   */
  enableRemoteWriteReceiver?: boolean;
  /**
   * Name of the external label used to denote replica name
   *
   * @default ""
   */
  replicaExternalLabelName?: string;
  /**
   * If true, the Operator won't add the external label used to denote replica name
   *
   * @default false
   */
  replicaExternalLabelNameClear?: boolean;
  /**
   * Name of the external label used to denote Prometheus instance name
   *
   * @default ""
   */
  prometheusExternalLabelName?: string;
  /**
   * If true, the Operator won't add the external label used to denote Prometheus instance name
   *
   * @default false
   */
  prometheusExternalLabelNameClear?: boolean;
  /**
   * External URL at which Prometheus will be reachable.
   *
   * @default ""
   */
  externalUrl?: string;
  /**
   * Define which Nodes the Pods are scheduled on.
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector
   *
   * @default {}
   */
  nodeSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecNodeSelector;
  secrets?: unknown[];
  configMaps?: unknown[];
  /**
   * QuerySpec defines the query command line flags when starting Prometheus.
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#queryspec
   *
   * @default {}
   */
  query?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecQuery;
  /**
   * If nil, select own namespace. Namespaces to be selected for PrometheusRules discovery.
   *
   * @default {}
   */
  ruleNamespaceSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecRuleNamespaceSelector;
  /**
   * If true, a nil or {} value for prometheus.prometheusSpec.ruleSelector will cause the
   * prometheus resource to be created with selectors based on values in the helm deployment,
   * which will also match the PrometheusRule resources created
   *
   * @default true
   */
  ruleSelectorNilUsesHelmValues?: boolean;
  /**
   * PrometheusRules to be selected for target discovery.
   * If {}, select all PrometheusRules
   *
   * @default {}
   */
  ruleSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecRuleSelector;
  /**
   * - example-rules-2
   * If true, a nil or {} value for prometheus.prometheusSpec.serviceMonitorSelector will cause the
   * prometheus resource to be created with selectors based on values in the helm deployment,
   * which will also match the servicemonitors created
   *
   * @default true
   */
  serviceMonitorSelectorNilUsesHelmValues?: boolean;
  /**
   * ServiceMonitors to be selected for target discovery.
   * If {}, select all ServiceMonitors
   *
   * @default {}
   */
  serviceMonitorSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecServiceMonitorSelector;
  /**
   * Namespaces to be selected for ServiceMonitor discovery.
   *
   * @default {}
   */
  serviceMonitorNamespaceSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecServiceMonitorNamespaceSelector;
  /**
   * If true, a nil or {} value for prometheus.prometheusSpec.podMonitorSelector will cause the
   * prometheus resource to be created with selectors based on values in the helm deployment,
   * which will also match the podmonitors created
   *
   * @default true
   */
  podMonitorSelectorNilUsesHelmValues?: boolean;
  /**
   * PodMonitors to be selected for target discovery.
   * If {}, select all PodMonitors
   *
   * @default {}
   */
  podMonitorSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecPodMonitorSelector;
  /**
   * If nil, select own namespace. Namespaces to be selected for PodMonitor discovery.
   *
   * @default {}
   */
  podMonitorNamespaceSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecPodMonitorNamespaceSelector;
  /**
   * If true, a nil or {} value for prometheus.prometheusSpec.probeSelector will cause the
   * prometheus resource to be created with selectors based on values in the helm deployment,
   * which will also match the probes created
   *
   * @default true
   */
  probeSelectorNilUsesHelmValues?: boolean;
  /**
   * Probes to be selected for target discovery.
   * If {}, select all Probes
   *
   * @default {}
   */
  probeSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecProbeSelector;
  /**
   * If nil, select own namespace. Namespaces to be selected for Probe discovery.
   *
   * @default {}
   */
  probeNamespaceSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecProbeNamespaceSelector;
  /**
   * If true, a nil or {} value for prometheus.prometheusSpec.scrapeConfigSelector will cause the
   * prometheus resource to be created with selectors based on values in the helm deployment,
   * which will also match the scrapeConfigs created
   * If null and scrapeConfigSelector is also null, exclude field from the prometheusSpec
   * (keeping downward compatibility with older versions of CRD)
   *
   * @default true
   */
  scrapeConfigSelectorNilUsesHelmValues?: boolean;
  /**
   * scrapeConfigs to be selected for target discovery.
   * If {}, select all scrapeConfigs
   *
   * @default {}
   */
  scrapeConfigSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecScrapeConfigSelector;
  /**
   * If nil, select own namespace. Namespaces to be selected for scrapeConfig discovery.
   * If null, exclude the field from the prometheusSpec (keeping downward compatibility with older versions of CRD)
   *
   * @default {}
   */
  scrapeConfigNamespaceSelector?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecScrapeConfigNamespaceSelector;
  /**
   * How long to retain metrics
   *
   * @default "10d"
   */
  retention?: string;
  /**
   * Maximum size of metrics
   * Unit format should be in the form of "50GiB"
   *
   * @default ""
   */
  retentionSize?: string;
  /**
   * Allow out-of-order/out-of-bounds samples ingested into Prometheus for a specified duration
   * See https://prometheus.io/docs/prometheus/latest/configuration/configuration/#tsdb
   *
   * @default {"outOfOrderTimeWindow":"0s"}
   */
  tsdb?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecTsdb;
  /**
   * Enable compression of the write-ahead log using Snappy.
   *
   * @default true
   */
  walCompression?: boolean;
  /**
   * If true, the Operator won't process any Prometheus configuration changes
   *
   * @default false
   */
  paused?: boolean;
  /**
   * Number of replicas of each shard to deploy for a Prometheus deployment.
   * Number of replicas multiplied by shards is the total number of Pods created.
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Number of replicas multiplied by shards is the total number of Pods created.
   * Note that scaling down shards will not reshard data onto remaining instances, it must be manually moved.
   * Increasing shards will not reshard data either but it will continue to be available from the same instances.
   * To query globally use Thanos sidecar and Thanos querier or remote write data to a central location.
   * Sharding is done on the content of the `__address__` target meta-label.
   *
   * @default 1
   */
  shards?: number;
  /**
   * Log level for Prometheus be configured in
   *
   * @default "info"
   */
  logLevel?: string;
  /**
   * Log format for Prometheus be configured in
   *
   * @default "logfmt"
   */
  logFormat?: string;
  /**
   * Prefix used to register routes, overriding externalUrl route.
   * Useful for proxies that rewrite URLs.
   *
   * @default "/"
   */
  routePrefix?: string;
  /**
   * Standard object's metadata. More info: https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#metadata
   * Metadata Labels and Annotations gets propagated to the prometheus pods.
   *
   * @default {}
   */
  podMetadata?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecPodMetadata;
  /**
   * Pod anti-affinity can prevent the scheduler from placing Prometheus replicas on the same node.
   * The default value "soft" means that the scheduler should *prefer* to not schedule two replica pods onto the same node but no guarantee is provided.
   * The value "hard" means that the scheduler is *required* to not schedule two replica pods onto the same node.
   * The value "" will disable pod anti-affinity so that no anti-affinity rules will be configured.
   *
   * @default "soft"
   */
  podAntiAffinity?: string;
  /**
   * If anti-affinity is enabled sets the topologyKey to use for anti-affinity.
   * This can be changed to, for example, failure-domain.beta.kubernetes.io/zone
   *
   * @default "kubernetes.io/hostname"
   */
  podAntiAffinityTopologyKey?: string;
  /**
   * Assign custom affinity rules to the prometheus instance
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
   *
   * @default {}
   */
  affinity?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecAffinity;
  remoteRead?: unknown[];
  additionalRemoteRead?: unknown[];
  remoteWrite?: unknown[];
  additionalRemoteWrite?: unknown[];
  /**
   * Enable/Disable Grafana dashboards provisioning for prometheus remote write feature
   *
   * @default false
   */
  remoteWriteDashboards?: boolean;
  /**
   * Resource limits & requests
   *
   * @default {}
   */
  resources?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecResources;
  /**
   * Prometheus StorageSpec for persistent data
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/platform/storage.md
   *
   * @default {}
   */
  storageSpec?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecStorageSpec;
  volumes?: unknown[];
  volumeMounts?: unknown[];
  additionalScrapeConfigs?: unknown[];
  /**
   * If scrape config contains a repetitive section, you may want to use a template.
   * If additional scrape configurations are already deployed in a single secret file you can use this section.
   * Expected values are the secret name and key
   * Cannot be used with additionalScrapeConfigs
   *
   * @default {}
   */
  additionalScrapeConfigsSecret?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecAdditionalScrapeConfigsSecret;
  /**
   * additionalPrometheusSecretsAnnotations allows to add annotations to the kubernetes secret. This can be useful
   * when deploying via spinnaker to disable versioning on the secret, strategy.spinnaker.io/versioned: 'false'
   *
   * @default {}
   */
  additionalPrometheusSecretsAnnotations?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecAdditionalPrometheusSecretsAnnotations;
  additionalAlertManagerConfigs?: unknown[];
  /**
   * If additional alertmanager configurations are already deployed in a single secret, or you want to manage
   * them separately from the helm deployment, you can use this section.
   * Expected values are the secret name and key
   * Cannot be used with additionalAlertManagerConfigs
   *
   * @default {}
   */
  additionalAlertManagerConfigsSecret?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecAdditionalAlertManagerConfigsSecret;
  additionalAlertRelabelConfigs?: unknown[];
  /**
   * If additional alert relabel configurations are already deployed in a single secret, or you want to manage
   * them separately from the helm deployment, you can use this section.
   * Expected values are the secret name and key
   * Cannot be used with additionalAlertRelabelConfigs
   *
   * @default {}
   */
  additionalAlertRelabelConfigsSecret?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecAdditionalAlertRelabelConfigsSecret;
  /**
   * SecurityContext holds pod-level security attributes and common container settings.
   * This defaults to non root user with uid 1000 and gid 2000.
   * https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md
   *
   * @default {...} (5 keys)
   */
  securityContext?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecSecurityContext;
  /**
   * DNS configuration for Prometheus.
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#monitoring.coreos.com/v1.PodDNSConfig
   *
   * @default {}
   */
  dnsConfig?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecDnsConfig;
  /**
   * DNS policy for Prometheus.
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#dnspolicystring-alias
   *
   * @default ""
   */
  dnsPolicy?: string;
  /**
   * Priority class assigned to the Pods
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Thanos configuration allows configuring various aspects of a Prometheus server in a Thanos environment.
   * This section is experimental, it may change significantly without deprecation notice in any release.
   * This is experimental and may change significantly without backward compatibility in any release.
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#thanosspec
   *
   * @default {}
   */
  thanos?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecThanos;
  containers?: unknown[];
  initContainers?: unknown[];
  /**
   * PortName to use for Prometheus.
   *
   * @default "http-web"
   */
  portName?: string;
  /**
   * ArbitraryFSAccessThroughSMs configures whether configuration based on a service monitor can access arbitrary files
   * on the file system of the Prometheus container e.g. bearer token files.
   *
   * @default false
   */
  arbitraryFSAccessThroughSMs?: boolean;
  /**
   * OverrideHonorLabels if set to true overrides all user configured honor_labels. If HonorLabels is set in ServiceMonitor
   * or PodMonitor to true, this overrides honor_labels to false.
   *
   * @default false
   */
  overrideHonorLabels?: boolean;
  /**
   * OverrideHonorTimestamps allows to globally enforce honoring timestamps in all scrape configs.
   *
   * @default false
   */
  overrideHonorTimestamps?: boolean;
  /**
   * When ignoreNamespaceSelectors is set to true, namespaceSelector from all PodMonitor, ServiceMonitor and Probe objects will be ignored,
   * they will only discover targets within the namespace of the PodMonitor, ServiceMonitor and Probe object,
   * and servicemonitors will be installed in the default service namespace.
   * Defaults to false.
   *
   * @default false
   */
  ignoreNamespaceSelectors?: boolean;
  /**
   * EnforcedNamespaceLabel enforces adding a namespace label of origin for each alert and metric that is user created.
   * The label value will always be the namespace of the object that is being created.
   * Disabled by default
   *
   * @default ""
   */
  enforcedNamespaceLabel?: string;
  prometheusRulesExcludedFromEnforce?: unknown[];
  excludedFromEnforcement?: unknown[];
  /**
   * QueryLogFile specifies the file to which PromQL queries are logged. Note that this location must be writable,
   * and can be persisted using an attached volume. Alternatively, the location can be set to a stdout location such
   * as /dev/stdout to log querie information to the default Prometheus log stream. This is only available in versions
   * of Prometheus >= 2.16.0. For more details, see the Prometheus docs (https://prometheus.io/docs/guides/query-log/)
   *
   * @default false
   */
  queryLogFile?: boolean;
  /**
   * Use to set global sample_limit for Prometheus. This act as default SampleLimit for ServiceMonitor or/and PodMonitor.
   * Set to 'false' to disable global sample_limit. or set to a number to override the default value.
   *
   * @default false
   */
  sampleLimit?: boolean;
  /**
   * EnforcedKeepDroppedTargetsLimit defines on the number of targets dropped by relabeling that will be kept in memory.
   * The value overrides any spec.keepDroppedTargets set by ServiceMonitor, PodMonitor, Probe objects unless spec.keepDroppedTargets
   * is greater than zero and less than spec.enforcedKeepDroppedTargets. 0 means no limit.
   *
   * @default 0
   */
  enforcedKeepDroppedTargets?: number;
  /**
   * EnforcedSampleLimit defines global limit on number of scraped samples that will be accepted. This overrides any SampleLimit
   * set per ServiceMonitor or/and PodMonitor. It is meant to be used by admins to enforce the SampleLimit to keep overall
   * number of samples/series under the desired limit. Note that if SampleLimit is lower that value will be taken instead.
   *
   * @default false
   */
  enforcedSampleLimit?: boolean;
  /**
   * EnforcedTargetLimit defines a global limit on the number of scraped targets. This overrides any TargetLimit set
   * per ServiceMonitor or/and PodMonitor. It is meant to be used by admins to enforce the TargetLimit to keep the overall
   * number of targets under the desired limit. Note that if TargetLimit is lower, that value will be taken instead, except
   * if either value is zero, in which case the non-zero value will be used. If both values are zero, no limit is enforced.
   *
   * @default false
   */
  enforcedTargetLimit?: boolean;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. If more than this number of labels are present
   * post metric-relabeling, the entire scrape will be treated as failed. 0 means no limit. Only valid in Prometheus versions
   * 2.27.0 and newer.
   *
   * @default false
   */
  enforcedLabelLimit?: boolean;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. If a label name is longer than this number
   * post metric-relabeling, the entire scrape will be treated as failed. 0 means no limit. Only valid in Prometheus versions
   * 2.27.0 and newer.
   *
   * @default false
   */
  enforcedLabelNameLengthLimit?: boolean;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. If a label value is longer than this
   * number post metric-relabeling, the entire scrape will be treated as failed. 0 means no limit. Only valid in Prometheus
   * versions 2.27.0 and newer.
   *
   * @default false
   */
  enforcedLabelValueLengthLimit?: boolean;
  /**
   * AllowOverlappingBlocks enables vertical compaction and vertical query merge in Prometheus. This is still experimental
   * in Prometheus so it may change in any upcoming release.
   *
   * @default false
   */
  allowOverlappingBlocks?: boolean;
  /**
   * Specifies the validation scheme for metric and label names.
   * Supported values are: Legacy, UTF8
   *
   * @default ""
   */
  nameValidationScheme?: string;
  /**
   * Minimum number of seconds for which a newly created pod should be ready without any of its container crashing for it to
   * be considered available. Defaults to 0 (pod will be considered available as soon as it is ready).
   *
   * @default 0
   */
  minReadySeconds?: number;
  /**
   * Required for use in managed kubernetes clusters (such as AWS EKS) with custom CNI (such as calico),
   * because control-plane managed by AWS cannot communicate with pods' IP CIDR and admission webhooks are not working
   * Use the host's network namespace if true. Make sure to understand the security implications if you want to enable it.
   * When hostNetwork is enabled, this will set dnsPolicy to ClusterFirstWithHostNet automatically.
   *
   * @default false
   */
  hostNetwork?: boolean;
  hostAliases?: unknown[];
  /**
   * TracingConfig configures tracing in Prometheus.
   * See https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#prometheustracingconfig
   *
   * @default {}
   */
  tracingConfig?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecTracingConfig;
  /**
   * Defines the service discovery role used to discover targets from ServiceMonitor objects and Alertmanager endpoints.
   * If set, the value should be either "Endpoints" or "EndpointSlice". If unset, the operator assumes the "Endpoints" role.
   *
   * @default ""
   */
  serviceDiscoveryRole?: string;
  /**
   * Additional configuration which is not covered by the properties above. (passed through tpl)
   *
   * @default {}
   */
  additionalConfig?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecAdditionalConfig;
  /**
   * Additional configuration which is not covered by the properties above.
   * Useful, if you need advanced templating inside alertmanagerSpec.
   * Otherwise, use prometheus.prometheusSpec.additionalConfig (passed through tpl)
   *
   * @default ""
   */
  additionalConfigString?: string;
  /**
   * Defines the maximum time that the `prometheus` container's startup probe
   * will wait before being considered failed. The startup probe will return
   * success after the WAL replay is complete. If set, the value should be
   * greater than 60 (seconds). Otherwise it will be equal to 900 seconds (15
   * minutes).
   *
   * @default 0
   */
  maximumStartupDurationSeconds?: number;
  scrapeProtocols?: unknown[];
};

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecPersistentVolumeClaimRetentionPolicy = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecApiserverConfig = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecWeb = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecExemplars = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecOtlp = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecImage = {
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "prometheus/prometheus"
   */
  repository?: string;
  /**
   * @default "v3.9.1"
   */
  tag?: string;
  /**
   * @default ""
   */
  sha?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecExternalLabels = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecNodeSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecQuery = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecRuleNamespaceSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecRuleSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecServiceMonitorSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecServiceMonitorNamespaceSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecPodMonitorSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecPodMonitorNamespaceSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecProbeSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecProbeNamespaceSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecScrapeConfigSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecScrapeConfigNamespaceSelector = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecTsdb = {
  /**
   * @default "0s"
   */
  outOfOrderTimeWindow?: string;
};

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecPodMetadata = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecAffinity = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecResources = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecStorageSpec = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecAdditionalScrapeConfigsSecret = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecAdditionalPrometheusSecretsAnnotations = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecAdditionalAlertManagerConfigsSecret = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecAdditionalAlertRelabelConfigsSecret = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecSecurityContext = {
  /**
   * @default 2000
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
  /**
   * @default 2000
   */
  fsGroup?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KubeprometheusstackHelmValuesPrometheusPrometheusSpecSecurityContextSeccompProfile;
};

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecDnsConfig = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecThanos = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecTracingConfig = object;

export type KubeprometheusstackHelmValuesPrometheusPrometheusSpecAdditionalConfig = object;

export type KubeprometheusstackHelmValuesThanosRuler = {
  /**
   * Deploy thanosRuler
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Annotations for ThanosRuler
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesThanosRulerAnnotations;
  /**
   * Service account for ThanosRuler to use.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default {"create":true,"name":"","annotations":{}}
   */
  serviceAccount?: KubeprometheusstackHelmValuesThanosRulerServiceAccount;
  /**
   * Configure pod disruption budgets for ThanosRuler
   * ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/#specifying-a-poddisruptionbudget
   *
   * @default {"enabled":false,"minAvailable":1,"unhealthyPodEvictionPolicy":"AlwaysAllow"}
   */
  podDisruptionBudget?: KubeprometheusstackHelmValuesThanosRulerPodDisruptionBudget;
  /**
   * BETA: Configure the gateway routes for the chart here.
   * More routes can be added by adding a dictionary key like the 'main' route.
   * Be aware that this is an early beta of this feature,
   * kube-prometheus-stack does not guarantee this works and is subject to change.
   * Being BETA this can/will change in the future without notice, do not use unless you want to take that risk
   * [[ref]](https://gateway-api.sigs.k8s.io/reference/spec/#gateway.networking.k8s.io%2fv1alpha2)
   *
   * @default {...} (7 keys)
   */
  ingress?: KubeprometheusstackHelmValuesThanosRulerIngress;
  /**
   * @default {"main":{"enabled":false,"apiVersion":"gateway.networking.k8s.io/v1","kind":"HTTPRoute","annotations":{},"labels":{},"hostnames":[],"parentRefs":[],"httpsRedirect":false,"matches":[{"path":{"type":"PathPrefix","value":"/"}}],"filters":[],"additionalRules":[]}}
   */
  route?: KubeprometheusstackHelmValuesThanosRulerRoute;
  /**
   * Configuration for ThanosRuler service
   *
   * @default {...} (14 keys)
   */
  service?: KubeprometheusstackHelmValuesThanosRulerService;
  /**
   * Configuration for creating a ServiceMonitor for the ThanosRuler service
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#thanosrulerspec
   *
   * @default {...} (15 keys)
   */
  serviceMonitor?: KubeprometheusstackHelmValuesThanosRulerServiceMonitor;
  /**
   * @default {...} (41 keys)
   */
  thanosRulerSpec?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpec;
  /**
   * ExtraSecret can be used to store various data in an extra secret
   * (use it for example to store hashed basic auth credentials)
   *
   * @default {"annotations":{},"data":{}}
   */
  extraSecret?: KubeprometheusstackHelmValuesThanosRulerExtraSecret;
};

export type KubeprometheusstackHelmValuesThanosRulerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerServiceAccount = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default ""
   */
  name?: string;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesThanosRulerServiceAccountAnnotations;
};

export type KubeprometheusstackHelmValuesThanosRulerServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerPodDisruptionBudget = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  minAvailable?: number;
  /**
   * @default "AlwaysAllow"
   */
  unhealthyPodEvictionPolicy?: string;
};

export type KubeprometheusstackHelmValuesThanosRulerIngress = {
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
  annotations?: KubeprometheusstackHelmValuesThanosRulerIngressAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesThanosRulerIngressLabels;
  hosts?: unknown[];
  paths?: unknown[];
  tls?: unknown[];
};

export type KubeprometheusstackHelmValuesThanosRulerIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerRoute = {
  /**
   * @default {...} (11 keys)
   */
  main?: KubeprometheusstackHelmValuesThanosRulerRouteMain;
};

export type KubeprometheusstackHelmValuesThanosRulerRouteMain = {
  /**
   * Enables or disables the route
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Set the route apiVersion, e.g. gateway.networking.k8s.io/v1 or gateway.networking.k8s.io/v1alpha2
   *
   * @default "gateway.networking.k8s.io/v1"
   */
  apiVersion?: string;
  /**
   * Set the route kind
   * Valid options are GRPCRoute, HTTPRoute, TCPRoute, TLSRoute, UDPRoute
   *
   * @default "HTTPRoute"
   */
  kind?: string;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesThanosRulerRouteMainAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesThanosRulerRouteMainLabels;
  hostnames?: unknown[];
  parentRefs?: unknown[];
  /**
   * create http route for redirect (https://gateway-api.sigs.k8s.io/guides/http-redirect-rewrite/#http-to-https-redirects)
   * Take care that you only enable this on the http listener of the gateway to avoid an infinite redirect.
   * matches, filters and additionalRules will be ignored if this is set to true. Be are
   *
   * @default false
   */
  httpsRedirect?: boolean;
  matches?: KubeprometheusstackHelmValuesThanosRulerRouteMainMatchesElement[];
  filters?: unknown[];
  additionalRules?: unknown[];
};

export type KubeprometheusstackHelmValuesThanosRulerRouteMainAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerRouteMainLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerRouteMainMatchesElement = {
  /**
   * @default {"type":"PathPrefix","value":"/"}
   */
  path?: KubeprometheusstackHelmValuesThanosRulerRouteMainMatchesPath;
};

export type KubeprometheusstackHelmValuesThanosRulerRouteMainMatchesPath = {
  /**
   * @default "PathPrefix"
   */
  type?: string;
  /**
   * @default "/"
   */
  value?: string;
};

export type KubeprometheusstackHelmValuesThanosRulerService = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesThanosRulerServiceAnnotations;
  /**
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesThanosRulerServiceLabels;
  /**
   * @default ""
   */
  clusterIP?: string;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KubeprometheusstackHelmValuesThanosRulerServiceIpDualStack;
  /**
   * Port for ThanosRuler Service to listen on
   *
   * @default 10902
   */
  port?: number;
  /**
   * To be used with a proxy extraContainer port
   *
   * @default 10902
   */
  targetPort?: number;
  /**
   * Port to expose on each node
   * Only used if service.type is 'NodePort'
   *
   * @default 30905
   */
  nodePort?: number;
  additionalPorts?: unknown[];
  externalIPs?: unknown[];
  /**
   * @default ""
   */
  loadBalancerIP?: string;
  loadBalancerSourceRanges?: unknown[];
  /**
   * Denotes if this Service desires to route external traffic to node-local or cluster-wide endpoints
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * Service type
   *
   * @default "ClusterIP"
   */
  type?: string;
};

export type KubeprometheusstackHelmValuesThanosRulerServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerServiceIpDualStack = {
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

export type KubeprometheusstackHelmValuesThanosRulerServiceMonitor = {
  /**
   * If true, create a serviceMonitor for thanosRuler
   *
   * @default true
   */
  selfMonitor?: boolean;
  /**
   * Scrape interval. If not set, the Prometheus default scrape interval is used.
   *
   * @default ""
   */
  interval?: string;
  /**
   * Additional labels
   *
   * @default {}
   */
  additionalLabels?: KubeprometheusstackHelmValuesThanosRulerServiceMonitorAdditionalLabels;
  /**
   * SampleLimit defines per-scrape limit on number of scraped samples that will be accepted.
   *
   * @default 0
   */
  sampleLimit?: number;
  /**
   * TargetLimit defines a limit on the number of scraped targets that will be accepted.
   *
   * @default 0
   */
  targetLimit?: number;
  /**
   * Per-scrape limit on number of labels that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelLimit?: number;
  /**
   * Per-scrape limit on length of labels name that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelNameLengthLimit?: number;
  /**
   * Per-scrape limit on length of labels value that will be accepted for a sample. Only valid in Prometheus versions 2.27.0 and newer.
   *
   * @default 0
   */
  labelValueLengthLimit?: number;
  /**
   * @default ""
   */
  proxyUrl?: string;
  /**
   * @default ""
   */
  scheme?: string;
  /**
   * Of type: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#tlsconfig
   *
   * @default {}
   */
  tlsConfig?: KubeprometheusstackHelmValuesThanosRulerServiceMonitorTlsConfig;
  bearerTokenFile?: unknown;
  metricRelabelings?: unknown[];
  relabelings?: unknown[];
  additionalEndpoints?: unknown[];
};

export type KubeprometheusstackHelmValuesThanosRulerServiceMonitorAdditionalLabels = object;

export type KubeprometheusstackHelmValuesThanosRulerServiceMonitorTlsConfig = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpec = {
  /**
   * Standard object's metadata. More info: https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#metadata
   * Metadata Labels and Annotations gets propagated to the ThanosRuler pods.
   *
   * @default {}
   */
  podMetadata?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecPodMetadata;
  serviceName?: unknown;
  /**
   * Image of ThanosRuler
   *
   * @default {...} (4 keys)
   */
  image?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecImage;
  /**
   * Namespaces to be selected for PrometheusRules discovery.
   * If nil, select own namespace. Namespaces to be selected for ServiceMonitor discovery.
   * See https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#namespaceselector for usage
   *
   * @default {}
   */
  ruleNamespaceSelector?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecRuleNamespaceSelector;
  /**
   * If true, a nil or {} value for thanosRuler.thanosRulerSpec.ruleSelector will cause the
   * prometheus resource to be created with selectors based on values in the helm deployment,
   * which will also match the PrometheusRule resources created
   *
   * @default true
   */
  ruleSelectorNilUsesHelmValues?: boolean;
  /**
   * PrometheusRules to be selected for target discovery.
   * If {}, select all PrometheusRules
   *
   * @default {}
   */
  ruleSelector?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecRuleSelector;
  /**
   * - example-rules-2
   * Define Log Format
   * Use logfmt (default) or json logging
   *
   * @default "logfmt"
   */
  logFormat?: string;
  /**
   * Log level for ThanosRuler to be configured with.
   *
   * @default "info"
   */
  logLevel?: string;
  /**
   * Size is the expected size of the thanosRuler cluster. The controller will eventually make the size of the
   * running cluster equal to the expected size.
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Time duration ThanosRuler shall retain data for. Default is '24h', and must match the regular expression
   * [0-9]+(ms|s|m|h) (milliseconds seconds minutes hours).
   *
   * @default "24h"
   */
  retention?: string;
  /**
   * Interval between consecutive evaluations.
   *
   * @default ""
   */
  evaluationInterval?: string;
  /**
   * Storage is the definition of how storage will be used by the ThanosRuler instances.
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/platform/storage.md
   *
   * @default {}
   */
  storage?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecStorage;
  /**
   * AlertmanagerConfig define configuration for connecting to alertmanager.
   * Only available with Thanos v0.10.0 and higher. Maps to the alertmanagers.config Thanos Ruler arg.
   *
   * @default {"existingSecret":{},"secret":{}}
   */
  alertmanagersConfig?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecAlertmanagersConfig;
  externalPrefix?: unknown;
  /**
   * If true, http://{{ template "kube-prometheus-stack.thanosRuler.name" . }}.{{ template "kube-prometheus-stack.namespace" . }}:{{ .Values.thanosRuler.service.port }}
   * will be used as value for externalPrefix
   *
   * @default true
   */
  externalPrefixNilUsesHelmValues?: boolean;
  /**
   * The route prefix ThanosRuler registers HTTP handlers for. This is useful, if using ExternalURL and a proxy is rewriting HTTP routes of a request, and the actual ExternalURL is still true,
   * but the server serves requests under a different route prefix. For example for use with kubectl proxy.
   *
   * @default "/"
   */
  routePrefix?: string;
  /**
   * ObjectStorageConfig configures object storage in Thanos
   *
   * @default {"existingSecret":{},"secret":{}}
   */
  objectStorageConfig?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecObjectStorageConfig;
  alertDropLabels?: unknown[];
  queryEndpoints?: unknown[];
  /**
   * Define configuration for connecting to thanos query instances. If this is defined, the queryEndpoints field will be ignored.
   * Maps to the query.config CLI argument. Only available with thanos v0.11.0 and higher.
   *
   * @default {"existingSecret":{},"secret":{}}
   */
  queryConfig?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecQueryConfig;
  /**
   * Labels configure the external label pairs to ThanosRuler. A default replica
   * label `thanos_ruler_replica` will be always added as a label with the value
   * of the pod's name and it will be dropped in the alerts.
   *
   * @default {}
   */
  labels?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecLabels;
  /**
   * If set to true all actions on the underlying managed objects are not going to be performed, except for delete actions.
   *
   * @default false
   */
  paused?: boolean;
  additionalArgs?: unknown[];
  /**
   * Define which Nodes the Pods are scheduled on.
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector
   *
   * @default {}
   */
  nodeSelector?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecNodeSelector;
  /**
   * Define resources requests and limits for single Pods.
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
   *
   * @default {}
   */
  resources?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecResources;
  /**
   * Pod anti-affinity can prevent the scheduler from placing Prometheus replicas on the same node.
   * The default value "soft" means that the scheduler should *prefer* to not schedule two replica pods onto the same node but no guarantee is provided.
   * The value "hard" means that the scheduler is *required* to not schedule two replica pods onto the same node.
   * The value "" will disable pod anti-affinity so that no anti-affinity rules will be configured.
   *
   * @default "soft"
   */
  podAntiAffinity?: string;
  /**
   * If anti-affinity is enabled sets the topologyKey to use for anti-affinity.
   * This can be changed to, for example, failure-domain.beta.kubernetes.io/zone
   *
   * @default "kubernetes.io/hostname"
   */
  podAntiAffinityTopologyKey?: string;
  /**
   * Assign custom affinity rules to the thanosRuler instance
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
   *
   * @default {}
   */
  affinity?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecAffinity;
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * SecurityContext holds pod-level security attributes and common container settings.
   * This defaults to non root user with uid 1000 and gid 2000. *v1.PodSecurityContext  false
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   *
   * @default {...} (5 keys)
   */
  securityContext?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecSecurityContext;
  /**
   * ListenLocal makes the ThanosRuler server listen on loopback, so that it does not bind against the Pod IP.
   * Note this is only for the ThanosRuler UI, not the gossip communication.
   *
   * @default false
   */
  listenLocal?: boolean;
  containers?: unknown[];
  volumes?: unknown[];
  volumeMounts?: unknown[];
  initContainers?: unknown[];
  /**
   * Priority class assigned to the Pods
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * PortName to use for ThanosRuler.
   *
   * @default "web"
   */
  portName?: string;
  /**
   * WebTLSConfig defines the TLS parameters for HTTPS
   * ref: https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/api-reference/api.md#thanosrulerwebspec
   *
   * @default {}
   */
  web?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecWeb;
  /**
   * Additional configuration which is not covered by the properties above. (passed through tpl)
   *
   * @default {}
   */
  additionalConfig?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecAdditionalConfig;
  /**
   * Additional configuration which is not covered by the properties above.
   * Useful, if you need advanced templating
   *
   * @default ""
   */
  additionalConfigString?: string;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecPodMetadata = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecImage = {
  /**
   * @default "quay.io"
   */
  registry?: string;
  /**
   * @default "thanos/thanos"
   */
  repository?: string;
  /**
   * @default "v0.40.1"
   */
  tag?: string;
  /**
   * @default ""
   */
  sha?: string;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecRuleNamespaceSelector = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecRuleSelector = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecStorage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecAlertmanagersConfig = {
  /**
   * use existing secret, if configured, alertmanagersConfig.secret will not be used
   *
   * @default {}
   */
  existingSecret?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecAlertmanagersConfigExistingSecret;
  /**
   * will render alertmanagersConfig secret data and configure it to be used by Thanos Ruler custom resource, ignored when alertmanagersConfig.existingSecret is set
   * https://thanos.io/tip/components/rule.md/#alertmanager
   *
   * @default {}
   */
  secret?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecAlertmanagersConfigSecret;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecAlertmanagersConfigExistingSecret = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecAlertmanagersConfigSecret = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecObjectStorageConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * use existing secret, if configured, objectStorageConfig.secret will not be used
   *
   * @default {}
   */
  existingSecret?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecObjectStorageConfigExistingSecret;
  /**
   * will render objectStorageConfig secret data and configure it to be used by Thanos Ruler custom resource, ignored when objectStorageConfig.existingSecret is set
   * https://thanos.io/tip/thanos/storage.md/#s3
   *
   * @default {}
   */
  secret?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecObjectStorageConfigSecret;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecObjectStorageConfigExistingSecret = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecObjectStorageConfigSecret = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecQueryConfig = {
  /**
   * use existing secret, if configured, queryConfig.secret will not be used
   *
   * @default {}
   */
  existingSecret?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecQueryConfigExistingSecret;
  /**
   * render queryConfig secret data and configure it to be used by Thanos Ruler custom resource, ignored when queryConfig.existingSecret is set
   * https://thanos.io/tip/components/rule.md/#query-api
   *
   * @default {}
   */
  secret?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecQueryConfigSecret;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecQueryConfigExistingSecret = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecQueryConfigSecret = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecNodeSelector = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecResources = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecAffinity = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecSecurityContext = {
  /**
   * @default 2000
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
  /**
   * @default 2000
   */
  fsGroup?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecSecurityContextSeccompProfile;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecWeb = object;

export type KubeprometheusstackHelmValuesThanosRulerThanosRulerSpecAdditionalConfig = object;

export type KubeprometheusstackHelmValuesThanosRulerExtraSecret = {
  /**
   * if not set, name will be auto generated
   *
   * @default {}
   */
  annotations?: KubeprometheusstackHelmValuesThanosRulerExtraSecretAnnotations;
  /**
   * @default {}
   */
  data?: KubeprometheusstackHelmValuesThanosRulerExtraSecretData;
};

export type KubeprometheusstackHelmValuesThanosRulerExtraSecretAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValuesThanosRulerExtraSecretData = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KubeprometheusstackHelmValues = {
  /**
   * Default values for kube-prometheus-stack.
   * This is a YAML-formatted file.
   * Declare variables to be passed into your templates.
   * Provide a name in place of kube-prometheus-stack for `app:` labels
   *
   * @default ""
   */
  nameOverride?: string;
  /**
   * Override the deployment namespace
   *
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * Provide a k8s version to auto dashboard import script example: kubeTargetVersionOverride: 1.26.6
   *
   * @default ""
   */
  kubeTargetVersionOverride?: string;
  /**
   * Allow kubeVersion to be overridden while creating the ingress
   *
   * @default ""
   */
  kubeVersionOverride?: string;
  /**
   * Provide a name to substitute for the full names of resources
   *
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * Labels to apply to all resources
   *
   * @default {}
   */
  commonLabels?: KubeprometheusstackHelmValuesCommonLabels;
  /**
   * Install Prometheus Operator CRDs
   *
   * @default {"enabled":true,"upgradeJob":{"enabled":false,"forceConflicts":false,"image":{"busybox":{"registry":"docker.io","repository":"busybox","tag":"latest","sha":"","pullPolicy":"IfNotPresent"},"kubectl":{"registry":"registry.k8s.io","repository":"kubectl","tag":"","sha":"","pullPolicy":"IfNotPresent"}},"env":{},"resources":{},"extraVolumes":[],"extraVolumeMounts":[],"nodeSelector":{},"affinity":{},"tolerations":[],"topologySpreadConstraints":[],"labels":{},"annotations":{},"podLabels":{},"podAnnotations":{},"serviceAccount":{"create":true,"name":"","annotations":{},"labels":{},"automountServiceAccountToken":true},"containerSecurityContext":{"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"capabilities":{"drop":["ALL"]}},"podSecurityContext":{"fsGroup":65534,"runAsGroup":65534,"runAsNonRoot":true,"runAsUser":65534,"seccompProfile":{"type":"RuntimeDefault"}}}}
   */
  crds?: KubeprometheusstackHelmValuesCrds;
  /**
   * Custom rules to override "for" and "severity" in defaultRules
   *
   * @default {}
   */
  customRules?: KubeprometheusstackHelmValuesCustomRules;
  /**
   * Create default rules for monitoring the cluster
   *
   * @default {...} (15 keys)
   */
  defaultRules?: KubeprometheusstackHelmValuesDefaultRules;
  /**
   * Deprecated way to provide custom recording or alerting rules to be deployed into the cluster.
   * Provide custom recording or alerting rules to be deployed into the cluster.
   *
   * @default {}
   */
  additionalPrometheusRulesMap?: KubeprometheusstackHelmValuesAdditionalPrometheusRulesMap;
  /**
   * @default {"rbac":{"create":true,"createAggregateClusterRoles":false},"imageRegistry":"","imagePullSecrets":[]}
   */
  global?: KubeprometheusstackHelmValuesGlobal;
  /**
   * @default {"enabled":false}
   */
  windowsMonitoring?: KubeprometheusstackHelmValuesWindowsMonitoring;
  /**
   * ref: https://github.com/prometheus-community/helm-charts/tree/main/charts/prometheus-windows-exporter
   *
   * @default {...} (4 keys)
   */
  "prometheus-windows-exporter"?: KubeprometheusstackHelmValuesPrometheuswindowsexporter;
  /**
   * ref: https://prometheus.io/docs/alerting/alertmanager/
   * foo:$apr1$OFG3Xybp$ckL0FHDAkoXYIlH9.cysT0
   * someoneelse:$apr1$DMZX2Z4q$6SbQIfyuLQd.xmo/P0m2c.
   * Using default values from https://github.com/grafana/helm-charts/blob/main/charts/grafana/values.yaml
   *
   * @default {...} (23 keys)
   */
  alertmanager?: KubeprometheusstackHelmValuesAlertmanager;
  /**
   * @default {...} (21 keys)
   */
  grafana?: KubeprometheusstackHelmValuesGrafana;
  /**
   * Flag to disable all the kubernetes component scrapers
   *
   * @default {"enabled":true}
   */
  kubernetesServiceMonitors?: KubeprometheusstackHelmValuesKubernetesServiceMonitors;
  /**
   * Component scraping the kube api server
   *
   * @default {"enabled":true,"tlsConfig":{"serverName":"kubernetes","insecureSkipVerify":false},"serviceMonitor":{"enabled":true,"interval":"","sampleLimit":0,"targetLimit":0,"labelLimit":0,"labelNameLengthLimit":0,"labelValueLengthLimit":0,"proxyUrl":"","jobLabel":"component","selector":{"matchLabels":{"component":"apiserver","provider":"kubernetes"}},"metricRelabelings":[{"action":"drop","regex":"(etcd_request|apiserver_request_slo|apiserver_request_sli|apiserver_request)_duration_seconds_bucket;(0\\.15|0\\.2|0\\.3|0\\.35|0\\.4|0\\.45|0\\.6|0\\.7|0\\.8|0\\.9|1\\.25|1\\.5|1\\.75|2|3|3\\.5|4|4\\.5|6|7|8|9|15|20|40|45|50)(\\.0)?","sourceLabels":["__name__","le"]}],"relabelings":[],"additionalLabels":{},"targetLabels":[]}}
   */
  kubeApiServer?: KubeprometheusstackHelmValuesKubeApiServer;
  /**
   * Component scraping the kubelet and kubelet-hosted cAdvisor
   *
   * @default {...} (4 keys)
   */
  kubelet?: KubeprometheusstackHelmValuesKubelet;
  /**
   * Component scraping the kube controller manager
   *
   * @default {...} (5 keys)
   */
  kubeControllerManager?: KubeprometheusstackHelmValuesKubeControllerManager;
  /**
   * Component scraping coreDns. Use either this or kubeDns
   *
   * @default {"enabled":true,"service":{"enabled":true,"port":9153,"targetPort":9153,"ipDualStack":{"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}},"serviceMonitor":{"enabled":true,"interval":"","sampleLimit":0,"targetLimit":0,"labelLimit":0,"labelNameLengthLimit":0,"labelValueLengthLimit":0,"proxyUrl":"","port":"http-metrics","jobLabel":"jobLabel","selector":{},"metricRelabelings":[],"relabelings":[],"additionalLabels":{},"targetLabels":[]}}
   */
  coreDns?: KubeprometheusstackHelmValuesCoreDns;
  /**
   * Component scraping kubeDns. Use either this or coreDns
   *
   * @default {"enabled":false,"service":{"dnsmasq":{"port":10054,"targetPort":10054},"skydns":{"port":10055,"targetPort":10055},"ipDualStack":{"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}},"serviceMonitor":{"interval":"","sampleLimit":0,"targetLimit":0,"labelLimit":0,"labelNameLengthLimit":0,"labelValueLengthLimit":0,"proxyUrl":"","jobLabel":"jobLabel","selector":{},"metricRelabelings":[],"relabelings":[],"dnsmasqMetricRelabelings":[],"dnsmasqRelabelings":[],"additionalLabels":{},"targetLabels":[]}}
   */
  kubeDns?: KubeprometheusstackHelmValuesKubeDns;
  /**
   * Component scraping etcd
   *
   * @default {...} (4 keys)
   */
  kubeEtcd?: KubeprometheusstackHelmValuesKubeEtcd;
  /**
   * Component scraping kube scheduler
   *
   * @default {...} (5 keys)
   */
  kubeScheduler?: KubeprometheusstackHelmValuesKubeScheduler;
  /**
   * Component scraping kube proxy
   *
   * @default {...} (5 keys)
   */
  kubeProxy?: KubeprometheusstackHelmValuesKubeProxy;
  /**
   * Component scraping kube state metrics
   *
   * @default {"enabled":true}
   */
  kubeStateMetrics?: KubeprometheusstackHelmValuesKubeStateMetrics;
  /**
   * Configuration for kube-state-metrics subchart
   *
   * @default {"releaseLabel":true,"prometheusScrape":false,"prometheus":{"monitor":{"enabled":true,"http":{"honorLabels":true},"metrics":{"honorLabels":true}}}}
   */
  "kube-state-metrics"?: KubeprometheusstackHelmValuesKubestatemetrics;
  /**
   * Deploy node exporter as a daemonset to all nodes
   *
   * @default {"enabled":true,"operatingSystems":{"linux":{"enabled":true},"aix":{"enabled":true},"darwin":{"enabled":true}},"forceDeployDashboards":false}
   */
  nodeExporter?: KubeprometheusstackHelmValuesNodeExporter;
  /**
   * Configuration for prometheus-node-exporter subchart
   *
   * @default {...} (7 keys)
   */
  "prometheus-node-exporter"?: KubeprometheusstackHelmValuesPrometheusnodeexporter;
  /**
   * Manages Prometheus and Alertmanager components
   *
   * @default {...} (50 keys)
   */
  prometheusOperator?: KubeprometheusstackHelmValuesPrometheusOperator;
  /**
   * Deploy a Prometheus instance
   *
   * @default {...} (22 keys)
   */
  prometheus?: KubeprometheusstackHelmValuesPrometheus;
  /**
   * foo:$apr1$OFG3Xybp$ckL0FHDAkoXYIlH9.cysT0
   * someoneelse:$apr1$DMZX2Z4q$6SbQIfyuLQd.xmo/P0m2c.
   * Setting to true produces cleaner resource names, but requires a data migration because the name of the persistent volume changes. Therefore this should only be set once on initial installation.
   *
   * @default {...} (10 keys)
   */
  thanosRuler?: KubeprometheusstackHelmValuesThanosRuler;
  /**
   * foo:$apr1$OFG3Xybp$ckL0FHDAkoXYIlH9.cysT0
   * someoneelse:$apr1$DMZX2Z4q$6SbQIfyuLQd.xmo/P0m2c.
   * Setting to true produces cleaner resource names, but requires a data migration because the name of the persistent volume changes. Therefore this should only be set once on initial installation.
   *
   * @default false
   */
  cleanPrometheusOperatorObjectNames?: boolean;
  extraManifests?: unknown;
};

export type KubeprometheusstackHelmParameters = {
  nameOverride?: string;
  namespaceOverride?: string;
  kubeTargetVersionOverride?: string;
  kubeVersionOverride?: string;
  fullnameOverride?: string;
  "crds.enabled"?: string;
  "crds.upgradeJob.enabled"?: string;
  "crds.upgradeJob.forceConflicts"?: string;
  "crds.upgradeJob.image.busybox.registry"?: string;
  "crds.upgradeJob.image.busybox.repository"?: string;
  "crds.upgradeJob.image.busybox.tag"?: string;
  "crds.upgradeJob.image.busybox.sha"?: string;
  "crds.upgradeJob.image.busybox.pullPolicy"?: string;
  "crds.upgradeJob.image.kubectl.registry"?: string;
  "crds.upgradeJob.image.kubectl.repository"?: string;
  "crds.upgradeJob.image.kubectl.tag"?: string;
  "crds.upgradeJob.image.kubectl.sha"?: string;
  "crds.upgradeJob.image.kubectl.pullPolicy"?: string;
  "crds.upgradeJob.extraVolumes"?: string;
  "crds.upgradeJob.extraVolumeMounts"?: string;
  "crds.upgradeJob.tolerations"?: string;
  "crds.upgradeJob.topologySpreadConstraints"?: string;
  "crds.upgradeJob.serviceAccount.create"?: string;
  "crds.upgradeJob.serviceAccount.name"?: string;
  "crds.upgradeJob.serviceAccount.automountServiceAccountToken"?: string;
  "crds.upgradeJob.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "crds.upgradeJob.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "crds.upgradeJob.containerSecurityContext.capabilities.drop"?: string;
  "crds.upgradeJob.podSecurityContext.fsGroup"?: string;
  "crds.upgradeJob.podSecurityContext.runAsGroup"?: string;
  "crds.upgradeJob.podSecurityContext.runAsNonRoot"?: string;
  "crds.upgradeJob.podSecurityContext.runAsUser"?: string;
  "crds.upgradeJob.podSecurityContext.seccompProfile.type"?: string;
  "defaultRules.create"?: string;
  "defaultRules.rules.alertmanager"?: string;
  "defaultRules.rules.etcd"?: string;
  "defaultRules.rules.configReloaders"?: string;
  "defaultRules.rules.general"?: string;
  "defaultRules.rules.k8sContainerCpuUsageSecondsTotal"?: string;
  "defaultRules.rules.k8sContainerMemoryCache"?: string;
  "defaultRules.rules.k8sContainerMemoryRss"?: string;
  "defaultRules.rules.k8sContainerMemorySwap"?: string;
  "defaultRules.rules.k8sContainerResource"?: string;
  "defaultRules.rules.k8sContainerMemoryWorkingSetBytes"?: string;
  "defaultRules.rules.k8sPodOwner"?: string;
  "defaultRules.rules.kubeApiserverAvailability"?: string;
  "defaultRules.rules.kubeApiserverBurnrate"?: string;
  "defaultRules.rules.kubeApiserverHistogram"?: string;
  "defaultRules.rules.kubeApiserverSlos"?: string;
  "defaultRules.rules.kubeControllerManager"?: string;
  "defaultRules.rules.kubelet"?: string;
  "defaultRules.rules.kubeProxy"?: string;
  "defaultRules.rules.kubePrometheusGeneral"?: string;
  "defaultRules.rules.kubePrometheusNodeRecording"?: string;
  "defaultRules.rules.kubernetesApps"?: string;
  "defaultRules.rules.kubernetesResources"?: string;
  "defaultRules.rules.kubernetesStorage"?: string;
  "defaultRules.rules.kubernetesSystem"?: string;
  "defaultRules.rules.kubeSchedulerAlerting"?: string;
  "defaultRules.rules.kubeSchedulerRecording"?: string;
  "defaultRules.rules.kubeStateMetrics"?: string;
  "defaultRules.rules.network"?: string;
  "defaultRules.rules.node"?: string;
  "defaultRules.rules.nodeExporterAlerting"?: string;
  "defaultRules.rules.nodeExporterRecording"?: string;
  "defaultRules.rules.prometheus"?: string;
  "defaultRules.rules.prometheusOperator"?: string;
  "defaultRules.rules.windows"?: string;
  "defaultRules.appNamespacesOperator"?: string;
  "defaultRules.appNamespacesTarget"?: string;
  "defaultRules.keepFiringFor"?: string;
  "defaultRules.additionalAggregationLabels"?: string;
  "defaultRules.runbookUrl"?: string;
  "defaultRules.node.fsSelector"?: string;
  "global.rbac.create"?: string;
  "global.rbac.createAggregateClusterRoles"?: string;
  "global.imageRegistry"?: string;
  "global.imagePullSecrets"?: string;
  "windowsMonitoring.enabled"?: string;
  "prometheus-windows-exporter.prometheus.monitor.enabled"?: string;
  "prometheus-windows-exporter.prometheus.monitor.jobLabel"?: string;
  "prometheus-windows-exporter.releaseLabel"?: string;
  "prometheus-windows-exporter.podLabels.jobLabel"?: string;
  "prometheus-windows-exporter.config"?: string;
  "alertmanager.enabled"?: string;
  "alertmanager.namespaceOverride"?: string;
  "alertmanager.apiVersion"?: string;
  "alertmanager.enableFeatures"?: string;
  "alertmanager.forceDeployDashboards"?: string;
  "alertmanager.networkPolicy.enabled"?: string;
  "alertmanager.networkPolicy.policyTypes"?: string;
  "alertmanager.networkPolicy.gateway.namespace"?: string;
  "alertmanager.networkPolicy.additionalIngress"?: string;
  "alertmanager.networkPolicy.egress.enabled"?: string;
  "alertmanager.networkPolicy.egress.rules"?: string;
  "alertmanager.networkPolicy.enableClusterRules"?: string;
  "alertmanager.networkPolicy.monitoringRules.prometheus"?: string;
  "alertmanager.networkPolicy.monitoringRules.configReloader"?: string;
  "alertmanager.serviceAccount.create"?: string;
  "alertmanager.serviceAccount.name"?: string;
  "alertmanager.serviceAccount.automountServiceAccountToken"?: string;
  "alertmanager.podDisruptionBudget.enabled"?: string;
  "alertmanager.podDisruptionBudget.minAvailable"?: string;
  "alertmanager.podDisruptionBudget.unhealthyPodEvictionPolicy"?: string;
  "alertmanager.config.global.resolve_timeout"?: string;
  "alertmanager.config.inhibit_rules.source_matchers"?: string;
  "alertmanager.config.inhibit_rules.target_matchers"?: string;
  "alertmanager.config.inhibit_rules.equal"?: string;
  "alertmanager.config.route.group_by"?: string;
  "alertmanager.config.route.group_wait"?: string;
  "alertmanager.config.route.group_interval"?: string;
  "alertmanager.config.route.repeat_interval"?: string;
  "alertmanager.config.route.receiver"?: string;
  "alertmanager.config.route.routes.receiver"?: string;
  "alertmanager.config.route.routes.matchers"?: string;
  "alertmanager.config.receivers.name"?: string;
  "alertmanager.config.templates"?: string;
  "alertmanager.stringConfig"?: string;
  "alertmanager.tplConfig"?: string;
  "alertmanager.ingress.enabled"?: string;
  "alertmanager.ingress.ingressClassName"?: string;
  "alertmanager.ingress.hosts"?: string;
  "alertmanager.ingress.paths"?: string;
  "alertmanager.ingress.tls"?: string;
  "alertmanager.route.main.enabled"?: string;
  "alertmanager.route.main.apiVersion"?: string;
  "alertmanager.route.main.kind"?: string;
  "alertmanager.route.main.hostnames"?: string;
  "alertmanager.route.main.parentRefs"?: string;
  "alertmanager.route.main.httpsRedirect"?: string;
  "alertmanager.route.main.matches.path.type"?: string;
  "alertmanager.route.main.matches.path.value"?: string;
  "alertmanager.route.main.filters"?: string;
  "alertmanager.route.main.additionalRules"?: string;
  "alertmanager.ingressPerReplica.enabled"?: string;
  "alertmanager.ingressPerReplica.ingressClassName"?: string;
  "alertmanager.ingressPerReplica.hostPrefix"?: string;
  "alertmanager.ingressPerReplica.hostDomain"?: string;
  "alertmanager.ingressPerReplica.paths"?: string;
  "alertmanager.ingressPerReplica.tlsSecretName"?: string;
  "alertmanager.ingressPerReplica.tlsSecretPerReplica.enabled"?: string;
  "alertmanager.ingressPerReplica.tlsSecretPerReplica.prefix"?: string;
  "alertmanager.service.enabled"?: string;
  "alertmanager.service.clusterIP"?: string;
  "alertmanager.service.ipDualStack.enabled"?: string;
  "alertmanager.service.ipDualStack.ipFamilies"?: string;
  "alertmanager.service.ipDualStack.ipFamilyPolicy"?: string;
  "alertmanager.service.port"?: string;
  "alertmanager.service.targetPort"?: string;
  "alertmanager.service.nodePort"?: string;
  "alertmanager.service.additionalPorts"?: string;
  "alertmanager.service.externalIPs"?: string;
  "alertmanager.service.loadBalancerIP"?: string;
  "alertmanager.service.loadBalancerSourceRanges"?: string;
  "alertmanager.service.externalTrafficPolicy"?: string;
  "alertmanager.service.sessionAffinity"?: string;
  "alertmanager.service.sessionAffinityConfig.clientIP.timeoutSeconds"?: string;
  "alertmanager.service.type"?: string;
  "alertmanager.servicePerReplica.enabled"?: string;
  "alertmanager.servicePerReplica.port"?: string;
  "alertmanager.servicePerReplica.targetPort"?: string;
  "alertmanager.servicePerReplica.nodePort"?: string;
  "alertmanager.servicePerReplica.loadBalancerSourceRanges"?: string;
  "alertmanager.servicePerReplica.externalTrafficPolicy"?: string;
  "alertmanager.servicePerReplica.type"?: string;
  "alertmanager.serviceMonitor.selfMonitor"?: string;
  "alertmanager.serviceMonitor.interval"?: string;
  "alertmanager.serviceMonitor.sampleLimit"?: string;
  "alertmanager.serviceMonitor.targetLimit"?: string;
  "alertmanager.serviceMonitor.labelLimit"?: string;
  "alertmanager.serviceMonitor.labelNameLengthLimit"?: string;
  "alertmanager.serviceMonitor.labelValueLengthLimit"?: string;
  "alertmanager.serviceMonitor.proxyUrl"?: string;
  "alertmanager.serviceMonitor.scheme"?: string;
  "alertmanager.serviceMonitor.enableHttp2"?: string;
  "alertmanager.serviceMonitor.bearerTokenFile"?: string;
  "alertmanager.serviceMonitor.metricRelabelings"?: string;
  "alertmanager.serviceMonitor.relabelings"?: string;
  "alertmanager.serviceMonitor.additionalEndpoints"?: string;
  "alertmanager.alertmanagerSpec.serviceName"?: string;
  "alertmanager.alertmanagerSpec.image.registry"?: string;
  "alertmanager.alertmanagerSpec.image.repository"?: string;
  "alertmanager.alertmanagerSpec.image.tag"?: string;
  "alertmanager.alertmanagerSpec.image.sha"?: string;
  "alertmanager.alertmanagerSpec.image.pullPolicy"?: string;
  "alertmanager.alertmanagerSpec.useExistingSecret"?: string;
  "alertmanager.alertmanagerSpec.secrets"?: string;
  "alertmanager.alertmanagerSpec.automountServiceAccountToken"?: string;
  "alertmanager.alertmanagerSpec.configMaps"?: string;
  "alertmanager.alertmanagerSpec.additionalArgs"?: string;
  "alertmanager.alertmanagerSpec.logFormat"?: string;
  "alertmanager.alertmanagerSpec.logLevel"?: string;
  "alertmanager.alertmanagerSpec.replicas"?: string;
  "alertmanager.alertmanagerSpec.retention"?: string;
  "alertmanager.alertmanagerSpec.externalUrl"?: string;
  "alertmanager.alertmanagerSpec.routePrefix"?: string;
  "alertmanager.alertmanagerSpec.scheme"?: string;
  "alertmanager.alertmanagerSpec.paused"?: string;
  "alertmanager.alertmanagerSpec.podAntiAffinity"?: string;
  "alertmanager.alertmanagerSpec.podAntiAffinityTopologyKey"?: string;
  "alertmanager.alertmanagerSpec.tolerations"?: string;
  "alertmanager.alertmanagerSpec.topologySpreadConstraints"?: string;
  "alertmanager.alertmanagerSpec.securityContext.runAsGroup"?: string;
  "alertmanager.alertmanagerSpec.securityContext.runAsNonRoot"?: string;
  "alertmanager.alertmanagerSpec.securityContext.runAsUser"?: string;
  "alertmanager.alertmanagerSpec.securityContext.fsGroup"?: string;
  "alertmanager.alertmanagerSpec.securityContext.seccompProfile.type"?: string;
  "alertmanager.alertmanagerSpec.dnsPolicy"?: string;
  "alertmanager.alertmanagerSpec.listenLocal"?: string;
  "alertmanager.alertmanagerSpec.containers"?: string;
  "alertmanager.alertmanagerSpec.volumes"?: string;
  "alertmanager.alertmanagerSpec.volumeMounts"?: string;
  "alertmanager.alertmanagerSpec.initContainers"?: string;
  "alertmanager.alertmanagerSpec.priorityClassName"?: string;
  "alertmanager.alertmanagerSpec.additionalPeers"?: string;
  "alertmanager.alertmanagerSpec.portName"?: string;
  "alertmanager.alertmanagerSpec.clusterAdvertiseAddress"?: string;
  "alertmanager.alertmanagerSpec.clusterGossipInterval"?: string;
  "alertmanager.alertmanagerSpec.clusterPeerTimeout"?: string;
  "alertmanager.alertmanagerSpec.clusterPushpullInterval"?: string;
  "alertmanager.alertmanagerSpec.clusterLabel"?: string;
  "alertmanager.alertmanagerSpec.forceEnableClusterMode"?: string;
  "alertmanager.alertmanagerSpec.minReadySeconds"?: string;
  "alertmanager.alertmanagerSpec.additionalConfigString"?: string;
  "grafana.enabled"?: string;
  "grafana.namespaceOverride"?: string;
  "grafana.forceDeployDatasources"?: string;
  "grafana.forceDeployDashboards"?: string;
  "grafana.defaultDashboardsEnabled"?: string;
  "grafana.operator.dashboardsConfigMapRefEnabled"?: string;
  "grafana.operator.resyncPeriod"?: string;
  "grafana.operator.folder"?: string;
  "grafana.operator.folderUID"?: string;
  "grafana.operator.folderRef"?: string;
  "grafana.defaultDashboardsTimezone"?: string;
  "grafana.defaultDashboardsEditable"?: string;
  "grafana.defaultDashboardsInterval"?: string;
  "grafana.adminUser"?: string;
  "grafana.admin.existingSecret"?: string;
  "grafana.admin.userKey"?: string;
  "grafana.admin.passwordKey"?: string;
  "grafana.rbac.pspEnabled"?: string;
  "grafana.ingress.enabled"?: string;
  "grafana.ingress.hosts"?: string;
  "grafana.ingress.path"?: string;
  "grafana.ingress.tls"?: string;
  "grafana.serviceAccount.create"?: string;
  "grafana.serviceAccount.autoMount"?: string;
  "grafana.sidecar.dashboards.enabled"?: string;
  "grafana.sidecar.dashboards.label"?: string;
  "grafana.sidecar.dashboards.labelValue"?: string;
  "grafana.sidecar.dashboards.searchNamespace"?: string;
  "grafana.sidecar.dashboards.enableNewTablePanelSyntax"?: string;
  "grafana.sidecar.dashboards.multicluster.global.enabled"?: string;
  "grafana.sidecar.dashboards.multicluster.etcd.enabled"?: string;
  "grafana.sidecar.dashboards.provider.allowUiUpdates"?: string;
  "grafana.sidecar.datasources.enabled"?: string;
  "grafana.sidecar.datasources.defaultDatasourceEnabled"?: string;
  "grafana.sidecar.datasources.isDefaultDatasource"?: string;
  "grafana.sidecar.datasources.name"?: string;
  "grafana.sidecar.datasources.uid"?: string;
  "grafana.sidecar.datasources.httpMethod"?: string;
  "grafana.sidecar.datasources.createPrometheusReplicasDatasources"?: string;
  "grafana.sidecar.datasources.prometheusServiceName"?: string;
  "grafana.sidecar.datasources.label"?: string;
  "grafana.sidecar.datasources.labelValue"?: string;
  "grafana.sidecar.datasources.alertmanager.enabled"?: string;
  "grafana.sidecar.datasources.alertmanager.name"?: string;
  "grafana.sidecar.datasources.alertmanager.uid"?: string;
  "grafana.sidecar.datasources.alertmanager.handleGrafanaManagedAlerts"?: string;
  "grafana.sidecar.datasources.alertmanager.implementation"?: string;
  "grafana.extraConfigmapMounts"?: string;
  "grafana.deleteDatasources"?: string;
  "grafana.additionalDataSources"?: string;
  "grafana.prune"?: string;
  "grafana.service.portName"?: string;
  "grafana.service.ipFamilies"?: string;
  "grafana.service.ipFamilyPolicy"?: string;
  "grafana.serviceMonitor.enabled"?: string;
  "grafana.serviceMonitor.path"?: string;
  "grafana.serviceMonitor.interval"?: string;
  "grafana.serviceMonitor.scheme"?: string;
  "grafana.serviceMonitor.scrapeTimeout"?: string;
  "grafana.serviceMonitor.relabelings"?: string;
  "kubernetesServiceMonitors.enabled"?: string;
  "kubeApiServer.enabled"?: string;
  "kubeApiServer.tlsConfig.serverName"?: string;
  "kubeApiServer.tlsConfig.insecureSkipVerify"?: string;
  "kubeApiServer.serviceMonitor.enabled"?: string;
  "kubeApiServer.serviceMonitor.interval"?: string;
  "kubeApiServer.serviceMonitor.sampleLimit"?: string;
  "kubeApiServer.serviceMonitor.targetLimit"?: string;
  "kubeApiServer.serviceMonitor.labelLimit"?: string;
  "kubeApiServer.serviceMonitor.labelNameLengthLimit"?: string;
  "kubeApiServer.serviceMonitor.labelValueLengthLimit"?: string;
  "kubeApiServer.serviceMonitor.proxyUrl"?: string;
  "kubeApiServer.serviceMonitor.jobLabel"?: string;
  "kubeApiServer.serviceMonitor.selector.matchLabels.component"?: string;
  "kubeApiServer.serviceMonitor.selector.matchLabels.provider"?: string;
  "kubeApiServer.serviceMonitor.metricRelabelings.action"?: string;
  "kubeApiServer.serviceMonitor.metricRelabelings.regex"?: string;
  "kubeApiServer.serviceMonitor.metricRelabelings.sourceLabels"?: string;
  "kubeApiServer.serviceMonitor.relabelings"?: string;
  "kubeApiServer.serviceMonitor.targetLabels"?: string;
  "kubelet.enabled"?: string;
  "kubelet.namespace"?: string;
  "kubelet.jobNameOverride"?: string;
  "kubelet.serviceMonitor.enabled"?: string;
  "kubelet.serviceMonitor.kubelet"?: string;
  "kubelet.serviceMonitor.attachMetadata.node"?: string;
  "kubelet.serviceMonitor.interval"?: string;
  "kubelet.serviceMonitor.honorLabels"?: string;
  "kubelet.serviceMonitor.honorTimestamps"?: string;
  "kubelet.serviceMonitor.trackTimestampsStaleness"?: string;
  "kubelet.serviceMonitor.sampleLimit"?: string;
  "kubelet.serviceMonitor.targetLimit"?: string;
  "kubelet.serviceMonitor.labelLimit"?: string;
  "kubelet.serviceMonitor.labelNameLengthLimit"?: string;
  "kubelet.serviceMonitor.labelValueLengthLimit"?: string;
  "kubelet.serviceMonitor.proxyUrl"?: string;
  "kubelet.serviceMonitor.https"?: string;
  "kubelet.serviceMonitor.insecureSkipVerify"?: string;
  "kubelet.serviceMonitor.probes"?: string;
  "kubelet.serviceMonitor.resource"?: string;
  "kubelet.serviceMonitor.resourcePath"?: string;
  "kubelet.serviceMonitor.resourceInterval"?: string;
  "kubelet.serviceMonitor.cAdvisor"?: string;
  "kubelet.serviceMonitor.cAdvisorInterval"?: string;
  "kubelet.serviceMonitor.cAdvisorMetricRelabelings.sourceLabels"?: string;
  "kubelet.serviceMonitor.cAdvisorMetricRelabelings.action"?: string;
  "kubelet.serviceMonitor.cAdvisorMetricRelabelings.regex"?: string;
  "kubelet.serviceMonitor.probesMetricRelabelings"?: string;
  "kubelet.serviceMonitor.cAdvisorRelabelings.action"?: string;
  "kubelet.serviceMonitor.cAdvisorRelabelings.sourceLabels"?: string;
  "kubelet.serviceMonitor.cAdvisorRelabelings.targetLabel"?: string;
  "kubelet.serviceMonitor.probesRelabelings.action"?: string;
  "kubelet.serviceMonitor.probesRelabelings.sourceLabels"?: string;
  "kubelet.serviceMonitor.probesRelabelings.targetLabel"?: string;
  "kubelet.serviceMonitor.resourceRelabelings.action"?: string;
  "kubelet.serviceMonitor.resourceRelabelings.sourceLabels"?: string;
  "kubelet.serviceMonitor.resourceRelabelings.targetLabel"?: string;
  "kubelet.serviceMonitor.metricRelabelings.action"?: string;
  "kubelet.serviceMonitor.metricRelabelings.sourceLabels"?: string;
  "kubelet.serviceMonitor.metricRelabelings.regex"?: string;
  "kubelet.serviceMonitor.relabelings.action"?: string;
  "kubelet.serviceMonitor.relabelings.sourceLabels"?: string;
  "kubelet.serviceMonitor.relabelings.targetLabel"?: string;
  "kubelet.serviceMonitor.targetLabels"?: string;
  "kubeControllerManager.enabled"?: string;
  "kubeControllerManager.jobNameOverride"?: string;
  "kubeControllerManager.endpoints"?: string;
  "kubeControllerManager.service.enabled"?: string;
  "kubeControllerManager.service.port"?: string;
  "kubeControllerManager.service.targetPort"?: string;
  "kubeControllerManager.service.ipDualStack.enabled"?: string;
  "kubeControllerManager.service.ipDualStack.ipFamilies"?: string;
  "kubeControllerManager.service.ipDualStack.ipFamilyPolicy"?: string;
  "kubeControllerManager.serviceMonitor.enabled"?: string;
  "kubeControllerManager.serviceMonitor.interval"?: string;
  "kubeControllerManager.serviceMonitor.sampleLimit"?: string;
  "kubeControllerManager.serviceMonitor.targetLimit"?: string;
  "kubeControllerManager.serviceMonitor.labelLimit"?: string;
  "kubeControllerManager.serviceMonitor.labelNameLengthLimit"?: string;
  "kubeControllerManager.serviceMonitor.labelValueLengthLimit"?: string;
  "kubeControllerManager.serviceMonitor.proxyUrl"?: string;
  "kubeControllerManager.serviceMonitor.port"?: string;
  "kubeControllerManager.serviceMonitor.jobLabel"?: string;
  "kubeControllerManager.serviceMonitor.https"?: string;
  "kubeControllerManager.serviceMonitor.insecureSkipVerify"?: string;
  "kubeControllerManager.serviceMonitor.serverName"?: string;
  "kubeControllerManager.serviceMonitor.metricRelabelings"?: string;
  "kubeControllerManager.serviceMonitor.relabelings"?: string;
  "kubeControllerManager.serviceMonitor.targetLabels"?: string;
  "coreDns.enabled"?: string;
  "coreDns.service.enabled"?: string;
  "coreDns.service.port"?: string;
  "coreDns.service.targetPort"?: string;
  "coreDns.service.ipDualStack.enabled"?: string;
  "coreDns.service.ipDualStack.ipFamilies"?: string;
  "coreDns.service.ipDualStack.ipFamilyPolicy"?: string;
  "coreDns.serviceMonitor.enabled"?: string;
  "coreDns.serviceMonitor.interval"?: string;
  "coreDns.serviceMonitor.sampleLimit"?: string;
  "coreDns.serviceMonitor.targetLimit"?: string;
  "coreDns.serviceMonitor.labelLimit"?: string;
  "coreDns.serviceMonitor.labelNameLengthLimit"?: string;
  "coreDns.serviceMonitor.labelValueLengthLimit"?: string;
  "coreDns.serviceMonitor.proxyUrl"?: string;
  "coreDns.serviceMonitor.port"?: string;
  "coreDns.serviceMonitor.jobLabel"?: string;
  "coreDns.serviceMonitor.metricRelabelings"?: string;
  "coreDns.serviceMonitor.relabelings"?: string;
  "coreDns.serviceMonitor.targetLabels"?: string;
  "kubeDns.enabled"?: string;
  "kubeDns.service.dnsmasq.port"?: string;
  "kubeDns.service.dnsmasq.targetPort"?: string;
  "kubeDns.service.skydns.port"?: string;
  "kubeDns.service.skydns.targetPort"?: string;
  "kubeDns.service.ipDualStack.enabled"?: string;
  "kubeDns.service.ipDualStack.ipFamilies"?: string;
  "kubeDns.service.ipDualStack.ipFamilyPolicy"?: string;
  "kubeDns.serviceMonitor.interval"?: string;
  "kubeDns.serviceMonitor.sampleLimit"?: string;
  "kubeDns.serviceMonitor.targetLimit"?: string;
  "kubeDns.serviceMonitor.labelLimit"?: string;
  "kubeDns.serviceMonitor.labelNameLengthLimit"?: string;
  "kubeDns.serviceMonitor.labelValueLengthLimit"?: string;
  "kubeDns.serviceMonitor.proxyUrl"?: string;
  "kubeDns.serviceMonitor.jobLabel"?: string;
  "kubeDns.serviceMonitor.metricRelabelings"?: string;
  "kubeDns.serviceMonitor.relabelings"?: string;
  "kubeDns.serviceMonitor.dnsmasqMetricRelabelings"?: string;
  "kubeDns.serviceMonitor.dnsmasqRelabelings"?: string;
  "kubeDns.serviceMonitor.targetLabels"?: string;
  "kubeEtcd.enabled"?: string;
  "kubeEtcd.endpoints"?: string;
  "kubeEtcd.service.enabled"?: string;
  "kubeEtcd.service.port"?: string;
  "kubeEtcd.service.targetPort"?: string;
  "kubeEtcd.service.ipDualStack.enabled"?: string;
  "kubeEtcd.service.ipDualStack.ipFamilies"?: string;
  "kubeEtcd.service.ipDualStack.ipFamilyPolicy"?: string;
  "kubeEtcd.serviceMonitor.enabled"?: string;
  "kubeEtcd.serviceMonitor.interval"?: string;
  "kubeEtcd.serviceMonitor.sampleLimit"?: string;
  "kubeEtcd.serviceMonitor.targetLimit"?: string;
  "kubeEtcd.serviceMonitor.labelLimit"?: string;
  "kubeEtcd.serviceMonitor.labelNameLengthLimit"?: string;
  "kubeEtcd.serviceMonitor.labelValueLengthLimit"?: string;
  "kubeEtcd.serviceMonitor.proxyUrl"?: string;
  "kubeEtcd.serviceMonitor.scheme"?: string;
  "kubeEtcd.serviceMonitor.insecureSkipVerify"?: string;
  "kubeEtcd.serviceMonitor.serverName"?: string;
  "kubeEtcd.serviceMonitor.caFile"?: string;
  "kubeEtcd.serviceMonitor.certFile"?: string;
  "kubeEtcd.serviceMonitor.keyFile"?: string;
  "kubeEtcd.serviceMonitor.port"?: string;
  "kubeEtcd.serviceMonitor.jobLabel"?: string;
  "kubeEtcd.serviceMonitor.metricRelabelings"?: string;
  "kubeEtcd.serviceMonitor.relabelings"?: string;
  "kubeEtcd.serviceMonitor.targetLabels"?: string;
  "kubeScheduler.enabled"?: string;
  "kubeScheduler.jobNameOverride"?: string;
  "kubeScheduler.endpoints"?: string;
  "kubeScheduler.service.enabled"?: string;
  "kubeScheduler.service.port"?: string;
  "kubeScheduler.service.targetPort"?: string;
  "kubeScheduler.service.ipDualStack.enabled"?: string;
  "kubeScheduler.service.ipDualStack.ipFamilies"?: string;
  "kubeScheduler.service.ipDualStack.ipFamilyPolicy"?: string;
  "kubeScheduler.serviceMonitor.enabled"?: string;
  "kubeScheduler.serviceMonitor.interval"?: string;
  "kubeScheduler.serviceMonitor.sampleLimit"?: string;
  "kubeScheduler.serviceMonitor.targetLimit"?: string;
  "kubeScheduler.serviceMonitor.labelLimit"?: string;
  "kubeScheduler.serviceMonitor.labelNameLengthLimit"?: string;
  "kubeScheduler.serviceMonitor.labelValueLengthLimit"?: string;
  "kubeScheduler.serviceMonitor.proxyUrl"?: string;
  "kubeScheduler.serviceMonitor.https"?: string;
  "kubeScheduler.serviceMonitor.port"?: string;
  "kubeScheduler.serviceMonitor.jobLabel"?: string;
  "kubeScheduler.serviceMonitor.insecureSkipVerify"?: string;
  "kubeScheduler.serviceMonitor.serverName"?: string;
  "kubeScheduler.serviceMonitor.metricRelabelings"?: string;
  "kubeScheduler.serviceMonitor.relabelings"?: string;
  "kubeScheduler.serviceMonitor.targetLabels"?: string;
  "kubeProxy.enabled"?: string;
  "kubeProxy.jobNameOverride"?: string;
  "kubeProxy.endpoints"?: string;
  "kubeProxy.service.enabled"?: string;
  "kubeProxy.service.port"?: string;
  "kubeProxy.service.targetPort"?: string;
  "kubeProxy.service.ipDualStack.enabled"?: string;
  "kubeProxy.service.ipDualStack.ipFamilies"?: string;
  "kubeProxy.service.ipDualStack.ipFamilyPolicy"?: string;
  "kubeProxy.serviceMonitor.enabled"?: string;
  "kubeProxy.serviceMonitor.interval"?: string;
  "kubeProxy.serviceMonitor.sampleLimit"?: string;
  "kubeProxy.serviceMonitor.targetLimit"?: string;
  "kubeProxy.serviceMonitor.labelLimit"?: string;
  "kubeProxy.serviceMonitor.labelNameLengthLimit"?: string;
  "kubeProxy.serviceMonitor.labelValueLengthLimit"?: string;
  "kubeProxy.serviceMonitor.proxyUrl"?: string;
  "kubeProxy.serviceMonitor.port"?: string;
  "kubeProxy.serviceMonitor.jobLabel"?: string;
  "kubeProxy.serviceMonitor.https"?: string;
  "kubeProxy.serviceMonitor.metricRelabelings"?: string;
  "kubeProxy.serviceMonitor.relabelings"?: string;
  "kubeProxy.serviceMonitor.targetLabels"?: string;
  "kubeStateMetrics.enabled"?: string;
  "kube-state-metrics.releaseLabel"?: string;
  "kube-state-metrics.prometheusScrape"?: string;
  "kube-state-metrics.prometheus.monitor.enabled"?: string;
  "kube-state-metrics.prometheus.monitor.http.honorLabels"?: string;
  "kube-state-metrics.prometheus.monitor.metrics.honorLabels"?: string;
  "nodeExporter.enabled"?: string;
  "nodeExporter.operatingSystems.linux.enabled"?: string;
  "nodeExporter.operatingSystems.aix.enabled"?: string;
  "nodeExporter.operatingSystems.darwin.enabled"?: string;
  "nodeExporter.forceDeployDashboards"?: string;
  "prometheus-node-exporter.namespaceOverride"?: string;
  "prometheus-node-exporter.podLabels.jobLabel"?: string;
  "prometheus-node-exporter.releaseLabel"?: string;
  "prometheus-node-exporter.extraArgs"?: string;
  "prometheus-node-exporter.service.portName"?: string;
  "prometheus-node-exporter.service.ipDualStack.enabled"?: string;
  "prometheus-node-exporter.service.ipDualStack.ipFamilies"?: string;
  "prometheus-node-exporter.service.ipDualStack.ipFamilyPolicy"?: string;
  "prometheus-node-exporter.service.labels.jobLabel"?: string;
  "prometheus-node-exporter.prometheus.monitor.enabled"?: string;
  "prometheus-node-exporter.prometheus.monitor.jobLabel"?: string;
  "prometheus-node-exporter.prometheus.monitor.interval"?: string;
  "prometheus-node-exporter.prometheus.monitor.sampleLimit"?: string;
  "prometheus-node-exporter.prometheus.monitor.targetLimit"?: string;
  "prometheus-node-exporter.prometheus.monitor.labelLimit"?: string;
  "prometheus-node-exporter.prometheus.monitor.labelNameLengthLimit"?: string;
  "prometheus-node-exporter.prometheus.monitor.labelValueLengthLimit"?: string;
  "prometheus-node-exporter.prometheus.monitor.scrapeTimeout"?: string;
  "prometheus-node-exporter.prometheus.monitor.proxyUrl"?: string;
  "prometheus-node-exporter.prometheus.monitor.metricRelabelings"?: string;
  "prometheus-node-exporter.prometheus.monitor.relabelings"?: string;
  "prometheus-node-exporter.prometheus.podMonitor.enabled"?: string;
  "prometheus-node-exporter.prometheus.podMonitor.jobLabel"?: string;
  "prometheus-node-exporter.rbac.pspEnabled"?: string;
  "prometheusOperator.enabled"?: string;
  "prometheusOperator.fullnameOverride"?: string;
  "prometheusOperator.revisionHistoryLimit"?: string;
  "prometheusOperator.tls.enabled"?: string;
  "prometheusOperator.tls.tlsMinVersion"?: string;
  "prometheusOperator.tls.internalPort"?: string;
  "prometheusOperator.livenessProbe.enabled"?: string;
  "prometheusOperator.livenessProbe.failureThreshold"?: string;
  "prometheusOperator.livenessProbe.initialDelaySeconds"?: string;
  "prometheusOperator.livenessProbe.periodSeconds"?: string;
  "prometheusOperator.livenessProbe.successThreshold"?: string;
  "prometheusOperator.livenessProbe.timeoutSeconds"?: string;
  "prometheusOperator.readinessProbe.enabled"?: string;
  "prometheusOperator.readinessProbe.failureThreshold"?: string;
  "prometheusOperator.readinessProbe.initialDelaySeconds"?: string;
  "prometheusOperator.readinessProbe.periodSeconds"?: string;
  "prometheusOperator.readinessProbe.successThreshold"?: string;
  "prometheusOperator.readinessProbe.timeoutSeconds"?: string;
  "prometheusOperator.admissionWebhooks.failurePolicy"?: string;
  "prometheusOperator.admissionWebhooks.timeoutSeconds"?: string;
  "prometheusOperator.admissionWebhooks.enabled"?: string;
  "prometheusOperator.admissionWebhooks.caBundle"?: string;
  "prometheusOperator.admissionWebhooks.deployment.enabled"?: string;
  "prometheusOperator.admissionWebhooks.deployment.replicas"?: string;
  "prometheusOperator.admissionWebhooks.deployment.podDisruptionBudget.enabled"?: string;
  "prometheusOperator.admissionWebhooks.deployment.podDisruptionBudget.minAvailable"?: string;
  "prometheusOperator.admissionWebhooks.deployment.podDisruptionBudget.unhealthyPodEvictionPolicy"?: string;
  "prometheusOperator.admissionWebhooks.deployment.revisionHistoryLimit"?: string;
  "prometheusOperator.admissionWebhooks.deployment.tls.enabled"?: string;
  "prometheusOperator.admissionWebhooks.deployment.tls.tlsMinVersion"?: string;
  "prometheusOperator.admissionWebhooks.deployment.tls.internalPort"?: string;
  "prometheusOperator.admissionWebhooks.deployment.serviceAccount.automountServiceAccountToken"?: string;
  "prometheusOperator.admissionWebhooks.deployment.serviceAccount.create"?: string;
  "prometheusOperator.admissionWebhooks.deployment.serviceAccount.name"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.clusterIP"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.ipDualStack.enabled"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.ipDualStack.ipFamilies"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.ipDualStack.ipFamilyPolicy"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.nodePort"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.nodePortTls"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.additionalPorts"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.loadBalancerIP"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.loadBalancerSourceRanges"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.externalTrafficPolicy"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.type"?: string;
  "prometheusOperator.admissionWebhooks.deployment.service.externalIPs"?: string;
  "prometheusOperator.admissionWebhooks.deployment.image.registry"?: string;
  "prometheusOperator.admissionWebhooks.deployment.image.repository"?: string;
  "prometheusOperator.admissionWebhooks.deployment.image.tag"?: string;
  "prometheusOperator.admissionWebhooks.deployment.image.sha"?: string;
  "prometheusOperator.admissionWebhooks.deployment.image.pullPolicy"?: string;
  "prometheusOperator.admissionWebhooks.deployment.livenessProbe.enabled"?: string;
  "prometheusOperator.admissionWebhooks.deployment.livenessProbe.failureThreshold"?: string;
  "prometheusOperator.admissionWebhooks.deployment.livenessProbe.initialDelaySeconds"?: string;
  "prometheusOperator.admissionWebhooks.deployment.livenessProbe.periodSeconds"?: string;
  "prometheusOperator.admissionWebhooks.deployment.livenessProbe.successThreshold"?: string;
  "prometheusOperator.admissionWebhooks.deployment.livenessProbe.timeoutSeconds"?: string;
  "prometheusOperator.admissionWebhooks.deployment.readinessProbe.enabled"?: string;
  "prometheusOperator.admissionWebhooks.deployment.readinessProbe.failureThreshold"?: string;
  "prometheusOperator.admissionWebhooks.deployment.readinessProbe.initialDelaySeconds"?: string;
  "prometheusOperator.admissionWebhooks.deployment.readinessProbe.periodSeconds"?: string;
  "prometheusOperator.admissionWebhooks.deployment.readinessProbe.successThreshold"?: string;
  "prometheusOperator.admissionWebhooks.deployment.readinessProbe.timeoutSeconds"?: string;
  "prometheusOperator.admissionWebhooks.deployment.hostNetwork"?: string;
  "prometheusOperator.admissionWebhooks.deployment.tolerations"?: string;
  "prometheusOperator.admissionWebhooks.deployment.securityContext.fsGroup"?: string;
  "prometheusOperator.admissionWebhooks.deployment.securityContext.runAsGroup"?: string;
  "prometheusOperator.admissionWebhooks.deployment.securityContext.runAsNonRoot"?: string;
  "prometheusOperator.admissionWebhooks.deployment.securityContext.runAsUser"?: string;
  "prometheusOperator.admissionWebhooks.deployment.securityContext.seccompProfile.type"?: string;
  "prometheusOperator.admissionWebhooks.deployment.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "prometheusOperator.admissionWebhooks.deployment.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "prometheusOperator.admissionWebhooks.deployment.containerSecurityContext.capabilities.drop"?: string;
  "prometheusOperator.admissionWebhooks.deployment.automountServiceAccountToken"?: string;
  "prometheusOperator.admissionWebhooks.patch.enabled"?: string;
  "prometheusOperator.admissionWebhooks.patch.image.registry"?: string;
  "prometheusOperator.admissionWebhooks.patch.image.repository"?: string;
  "prometheusOperator.admissionWebhooks.patch.image.tag"?: string;
  "prometheusOperator.admissionWebhooks.patch.image.sha"?: string;
  "prometheusOperator.admissionWebhooks.patch.image.pullPolicy"?: string;
  "prometheusOperator.admissionWebhooks.patch.priorityClassName"?: string;
  "prometheusOperator.admissionWebhooks.patch.ttlSecondsAfterFinished"?: string;
  "prometheusOperator.admissionWebhooks.patch.tolerations"?: string;
  "prometheusOperator.admissionWebhooks.patch.securityContext.runAsGroup"?: string;
  "prometheusOperator.admissionWebhooks.patch.securityContext.runAsNonRoot"?: string;
  "prometheusOperator.admissionWebhooks.patch.securityContext.runAsUser"?: string;
  "prometheusOperator.admissionWebhooks.patch.securityContext.seccompProfile.type"?: string;
  "prometheusOperator.admissionWebhooks.patch.serviceAccount.create"?: string;
  "prometheusOperator.admissionWebhooks.patch.serviceAccount.automountServiceAccountToken"?: string;
  "prometheusOperator.admissionWebhooks.createSecretJob.securityContext.allowPrivilegeEscalation"?: string;
  "prometheusOperator.admissionWebhooks.createSecretJob.securityContext.readOnlyRootFilesystem"?: string;
  "prometheusOperator.admissionWebhooks.createSecretJob.securityContext.capabilities.drop"?: string;
  "prometheusOperator.admissionWebhooks.patchWebhookJob.securityContext.allowPrivilegeEscalation"?: string;
  "prometheusOperator.admissionWebhooks.patchWebhookJob.securityContext.readOnlyRootFilesystem"?: string;
  "prometheusOperator.admissionWebhooks.patchWebhookJob.securityContext.capabilities.drop"?: string;
  "prometheusOperator.admissionWebhooks.certManager.enabled"?: string;
  "prometheusOperator.admissionWebhooks.certManager.rootCert.duration"?: string;
  "prometheusOperator.admissionWebhooks.certManager.rootCert.revisionHistoryLimit"?: string;
  "prometheusOperator.admissionWebhooks.certManager.admissionCert.duration"?: string;
  "prometheusOperator.admissionWebhooks.certManager.admissionCert.revisionHistoryLimit"?: string;
  "prometheusOperator.denyNamespaces"?: string;
  "prometheusOperator.alertmanagerInstanceNamespaces"?: string;
  "prometheusOperator.alertmanagerConfigNamespaces"?: string;
  "prometheusOperator.prometheusInstanceNamespaces"?: string;
  "prometheusOperator.thanosRulerInstanceNamespaces"?: string;
  "prometheusOperator.networkPolicy.enabled"?: string;
  "prometheusOperator.networkPolicy.flavor"?: string;
  "prometheusOperator.serviceAccount.create"?: string;
  "prometheusOperator.serviceAccount.name"?: string;
  "prometheusOperator.serviceAccount.automountServiceAccountToken"?: string;
  "prometheusOperator.terminationGracePeriodSeconds"?: string;
  "prometheusOperator.service.clusterIP"?: string;
  "prometheusOperator.service.ipDualStack.enabled"?: string;
  "prometheusOperator.service.ipDualStack.ipFamilies"?: string;
  "prometheusOperator.service.ipDualStack.ipFamilyPolicy"?: string;
  "prometheusOperator.service.nodePort"?: string;
  "prometheusOperator.service.nodePortTls"?: string;
  "prometheusOperator.service.additionalPorts"?: string;
  "prometheusOperator.service.loadBalancerIP"?: string;
  "prometheusOperator.service.loadBalancerSourceRanges"?: string;
  "prometheusOperator.service.externalTrafficPolicy"?: string;
  "prometheusOperator.service.type"?: string;
  "prometheusOperator.service.externalIPs"?: string;
  "prometheusOperator.podDisruptionBudget.enabled"?: string;
  "prometheusOperator.podDisruptionBudget.minAvailable"?: string;
  "prometheusOperator.podDisruptionBudget.unhealthyPodEvictionPolicy"?: string;
  "prometheusOperator.kubeletService.enabled"?: string;
  "prometheusOperator.kubeletService.namespace"?: string;
  "prometheusOperator.kubeletService.selector"?: string;
  "prometheusOperator.kubeletService.name"?: string;
  "prometheusOperator.kubeletEndpointsEnabled"?: string;
  "prometheusOperator.kubeletEndpointSliceEnabled"?: string;
  "prometheusOperator.extraArgs"?: string;
  "prometheusOperator.serviceMonitor.selfMonitor"?: string;
  "prometheusOperator.serviceMonitor.interval"?: string;
  "prometheusOperator.serviceMonitor.sampleLimit"?: string;
  "prometheusOperator.serviceMonitor.targetLimit"?: string;
  "prometheusOperator.serviceMonitor.labelLimit"?: string;
  "prometheusOperator.serviceMonitor.labelNameLengthLimit"?: string;
  "prometheusOperator.serviceMonitor.labelValueLengthLimit"?: string;
  "prometheusOperator.serviceMonitor.scrapeTimeout"?: string;
  "prometheusOperator.serviceMonitor.metricRelabelings"?: string;
  "prometheusOperator.serviceMonitor.relabelings"?: string;
  "prometheusOperator.env.GOGC"?: string;
  "prometheusOperator.hostNetwork"?: string;
  "prometheusOperator.tolerations"?: string;
  "prometheusOperator.securityContext.fsGroup"?: string;
  "prometheusOperator.securityContext.runAsGroup"?: string;
  "prometheusOperator.securityContext.runAsNonRoot"?: string;
  "prometheusOperator.securityContext.runAsUser"?: string;
  "prometheusOperator.securityContext.seccompProfile.type"?: string;
  "prometheusOperator.hostUsers"?: string;
  "prometheusOperator.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "prometheusOperator.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "prometheusOperator.containerSecurityContext.capabilities.drop"?: string;
  "prometheusOperator.verticalPodAutoscaler.enabled"?: string;
  "prometheusOperator.verticalPodAutoscaler.controlledResources"?: string;
  "prometheusOperator.verticalPodAutoscaler.updatePolicy.updateMode"?: string;
  "prometheusOperator.image.registry"?: string;
  "prometheusOperator.image.repository"?: string;
  "prometheusOperator.image.tag"?: string;
  "prometheusOperator.image.sha"?: string;
  "prometheusOperator.image.pullPolicy"?: string;
  "prometheusOperator.prometheusConfigReloader.image.registry"?: string;
  "prometheusOperator.prometheusConfigReloader.image.repository"?: string;
  "prometheusOperator.prometheusConfigReloader.image.tag"?: string;
  "prometheusOperator.prometheusConfigReloader.image.sha"?: string;
  "prometheusOperator.prometheusConfigReloader.enableProbe"?: string;
  "prometheusOperator.thanosImage.registry"?: string;
  "prometheusOperator.thanosImage.repository"?: string;
  "prometheusOperator.thanosImage.tag"?: string;
  "prometheusOperator.thanosImage.sha"?: string;
  "prometheusOperator.prometheusInstanceSelector"?: string;
  "prometheusOperator.alertmanagerInstanceSelector"?: string;
  "prometheusOperator.thanosRulerInstanceSelector"?: string;
  "prometheusOperator.secretFieldSelector"?: string;
  "prometheusOperator.automountServiceAccountToken"?: string;
  "prometheusOperator.extraVolumes"?: string;
  "prometheusOperator.extraVolumeMounts"?: string;
  "prometheus.enabled"?: string;
  "prometheus.agentMode"?: string;
  "prometheus.networkPolicy.enabled"?: string;
  "prometheus.networkPolicy.flavor"?: string;
  "prometheus.networkPolicy.namespace"?: string;
  "prometheus.serviceAccount.create"?: string;
  "prometheus.serviceAccount.name"?: string;
  "prometheus.serviceAccount.automountServiceAccountToken"?: string;
  "prometheus.thanosService.enabled"?: string;
  "prometheus.thanosService.externalTrafficPolicy"?: string;
  "prometheus.thanosService.type"?: string;
  "prometheus.thanosService.ipDualStack.enabled"?: string;
  "prometheus.thanosService.ipDualStack.ipFamilies"?: string;
  "prometheus.thanosService.ipDualStack.ipFamilyPolicy"?: string;
  "prometheus.thanosService.portName"?: string;
  "prometheus.thanosService.port"?: string;
  "prometheus.thanosService.targetPort"?: string;
  "prometheus.thanosService.httpPortName"?: string;
  "prometheus.thanosService.httpPort"?: string;
  "prometheus.thanosService.targetHttpPort"?: string;
  "prometheus.thanosService.clusterIP"?: string;
  "prometheus.thanosService.nodePort"?: string;
  "prometheus.thanosService.httpNodePort"?: string;
  "prometheus.thanosServiceMonitor.enabled"?: string;
  "prometheus.thanosServiceMonitor.interval"?: string;
  "prometheus.thanosServiceMonitor.scheme"?: string;
  "prometheus.thanosServiceMonitor.bearerTokenFile"?: string;
  "prometheus.thanosServiceMonitor.metricRelabelings"?: string;
  "prometheus.thanosServiceMonitor.relabelings"?: string;
  "prometheus.thanosServiceExternal.enabled"?: string;
  "prometheus.thanosServiceExternal.loadBalancerIP"?: string;
  "prometheus.thanosServiceExternal.loadBalancerSourceRanges"?: string;
  "prometheus.thanosServiceExternal.portName"?: string;
  "prometheus.thanosServiceExternal.port"?: string;
  "prometheus.thanosServiceExternal.targetPort"?: string;
  "prometheus.thanosServiceExternal.httpPortName"?: string;
  "prometheus.thanosServiceExternal.httpPort"?: string;
  "prometheus.thanosServiceExternal.targetHttpPort"?: string;
  "prometheus.thanosServiceExternal.externalTrafficPolicy"?: string;
  "prometheus.thanosServiceExternal.type"?: string;
  "prometheus.thanosServiceExternal.nodePort"?: string;
  "prometheus.thanosServiceExternal.httpNodePort"?: string;
  "prometheus.service.enabled"?: string;
  "prometheus.service.clusterIP"?: string;
  "prometheus.service.ipDualStack.enabled"?: string;
  "prometheus.service.ipDualStack.ipFamilies"?: string;
  "prometheus.service.ipDualStack.ipFamilyPolicy"?: string;
  "prometheus.service.port"?: string;
  "prometheus.service.targetPort"?: string;
  "prometheus.service.reloaderWebPort"?: string;
  "prometheus.service.externalIPs"?: string;
  "prometheus.service.nodePort"?: string;
  "prometheus.service.loadBalancerIP"?: string;
  "prometheus.service.loadBalancerSourceRanges"?: string;
  "prometheus.service.externalTrafficPolicy"?: string;
  "prometheus.service.type"?: string;
  "prometheus.service.additionalPorts"?: string;
  "prometheus.service.publishNotReadyAddresses"?: string;
  "prometheus.service.sessionAffinity"?: string;
  "prometheus.service.sessionAffinityConfig.clientIP.timeoutSeconds"?: string;
  "prometheus.servicePerReplica.enabled"?: string;
  "prometheus.servicePerReplica.port"?: string;
  "prometheus.servicePerReplica.targetPort"?: string;
  "prometheus.servicePerReplica.nodePort"?: string;
  "prometheus.servicePerReplica.loadBalancerSourceRanges"?: string;
  "prometheus.servicePerReplica.externalTrafficPolicy"?: string;
  "prometheus.servicePerReplica.type"?: string;
  "prometheus.servicePerReplica.ipDualStack.enabled"?: string;
  "prometheus.servicePerReplica.ipDualStack.ipFamilies"?: string;
  "prometheus.servicePerReplica.ipDualStack.ipFamilyPolicy"?: string;
  "prometheus.podDisruptionBudget.enabled"?: string;
  "prometheus.podDisruptionBudget.minAvailable"?: string;
  "prometheus.podDisruptionBudget.unhealthyPodEvictionPolicy"?: string;
  "prometheus.thanosIngress.enabled"?: string;
  "prometheus.thanosIngress.ingressClassName"?: string;
  "prometheus.thanosIngress.servicePort"?: string;
  "prometheus.thanosIngress.nodePort"?: string;
  "prometheus.thanosIngress.hosts"?: string;
  "prometheus.thanosIngress.paths"?: string;
  "prometheus.thanosIngress.tls"?: string;
  "prometheus.ingress.enabled"?: string;
  "prometheus.ingress.ingressClassName"?: string;
  "prometheus.ingress.hosts"?: string;
  "prometheus.ingress.paths"?: string;
  "prometheus.ingress.tls"?: string;
  "prometheus.route.main.enabled"?: string;
  "prometheus.route.main.apiVersion"?: string;
  "prometheus.route.main.kind"?: string;
  "prometheus.route.main.hostnames"?: string;
  "prometheus.route.main.parentRefs"?: string;
  "prometheus.route.main.httpsRedirect"?: string;
  "prometheus.route.main.matches.path.type"?: string;
  "prometheus.route.main.matches.path.value"?: string;
  "prometheus.route.main.filters"?: string;
  "prometheus.route.main.additionalRules"?: string;
  "prometheus.ingressPerReplica.enabled"?: string;
  "prometheus.ingressPerReplica.ingressClassName"?: string;
  "prometheus.ingressPerReplica.hostPrefix"?: string;
  "prometheus.ingressPerReplica.hostDomain"?: string;
  "prometheus.ingressPerReplica.paths"?: string;
  "prometheus.ingressPerReplica.tlsSecretName"?: string;
  "prometheus.ingressPerReplica.tlsSecretPerReplica.enabled"?: string;
  "prometheus.ingressPerReplica.tlsSecretPerReplica.prefix"?: string;
  "prometheus.serviceMonitor.selfMonitor"?: string;
  "prometheus.serviceMonitor.interval"?: string;
  "prometheus.serviceMonitor.sampleLimit"?: string;
  "prometheus.serviceMonitor.targetLimit"?: string;
  "prometheus.serviceMonitor.labelLimit"?: string;
  "prometheus.serviceMonitor.labelNameLengthLimit"?: string;
  "prometheus.serviceMonitor.labelValueLengthLimit"?: string;
  "prometheus.serviceMonitor.scheme"?: string;
  "prometheus.serviceMonitor.bearerTokenFile"?: string;
  "prometheus.serviceMonitor.metricRelabelings"?: string;
  "prometheus.serviceMonitor.relabelings"?: string;
  "prometheus.serviceMonitor.additionalEndpoints"?: string;
  "prometheus.prometheusSpec.disableCompaction"?: string;
  "prometheus.prometheusSpec.automountServiceAccountToken"?: string;
  "prometheus.prometheusSpec.additionalArgs"?: string;
  "prometheus.prometheusSpec.convertClassicHistogramsToNHCB"?: string;
  "prometheus.prometheusSpec.scrapeClassicHistograms"?: string;
  "prometheus.prometheusSpec.scrapeNativeHistograms"?: string;
  "prometheus.prometheusSpec.scrapeFailureLogFile"?: string;
  "prometheus.prometheusSpec.scrapeInterval"?: string;
  "prometheus.prometheusSpec.scrapeTimeout"?: string;
  "prometheus.prometheusSpec.scrapeClasses"?: string;
  "prometheus.prometheusSpec.podTargetLabels"?: string;
  "prometheus.prometheusSpec.evaluationInterval"?: string;
  "prometheus.prometheusSpec.listenLocal"?: string;
  "prometheus.prometheusSpec.enableOTLPReceiver"?: string;
  "prometheus.prometheusSpec.enableAdminAPI"?: string;
  "prometheus.prometheusSpec.version"?: string;
  "prometheus.prometheusSpec.enableFeatures"?: string;
  "prometheus.prometheusSpec.serviceName"?: string;
  "prometheus.prometheusSpec.image.registry"?: string;
  "prometheus.prometheusSpec.image.repository"?: string;
  "prometheus.prometheusSpec.image.tag"?: string;
  "prometheus.prometheusSpec.image.sha"?: string;
  "prometheus.prometheusSpec.image.pullPolicy"?: string;
  "prometheus.prometheusSpec.tolerations"?: string;
  "prometheus.prometheusSpec.topologySpreadConstraints"?: string;
  "prometheus.prometheusSpec.alertingEndpoints"?: string;
  "prometheus.prometheusSpec.enableRemoteWriteReceiver"?: string;
  "prometheus.prometheusSpec.replicaExternalLabelName"?: string;
  "prometheus.prometheusSpec.replicaExternalLabelNameClear"?: string;
  "prometheus.prometheusSpec.prometheusExternalLabelName"?: string;
  "prometheus.prometheusSpec.prometheusExternalLabelNameClear"?: string;
  "prometheus.prometheusSpec.externalUrl"?: string;
  "prometheus.prometheusSpec.secrets"?: string;
  "prometheus.prometheusSpec.configMaps"?: string;
  "prometheus.prometheusSpec.ruleSelectorNilUsesHelmValues"?: string;
  "prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues"?: string;
  "prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues"?: string;
  "prometheus.prometheusSpec.probeSelectorNilUsesHelmValues"?: string;
  "prometheus.prometheusSpec.scrapeConfigSelectorNilUsesHelmValues"?: string;
  "prometheus.prometheusSpec.retention"?: string;
  "prometheus.prometheusSpec.retentionSize"?: string;
  "prometheus.prometheusSpec.tsdb.outOfOrderTimeWindow"?: string;
  "prometheus.prometheusSpec.walCompression"?: string;
  "prometheus.prometheusSpec.paused"?: string;
  "prometheus.prometheusSpec.replicas"?: string;
  "prometheus.prometheusSpec.shards"?: string;
  "prometheus.prometheusSpec.logLevel"?: string;
  "prometheus.prometheusSpec.logFormat"?: string;
  "prometheus.prometheusSpec.routePrefix"?: string;
  "prometheus.prometheusSpec.podAntiAffinity"?: string;
  "prometheus.prometheusSpec.podAntiAffinityTopologyKey"?: string;
  "prometheus.prometheusSpec.remoteRead"?: string;
  "prometheus.prometheusSpec.additionalRemoteRead"?: string;
  "prometheus.prometheusSpec.remoteWrite"?: string;
  "prometheus.prometheusSpec.additionalRemoteWrite"?: string;
  "prometheus.prometheusSpec.remoteWriteDashboards"?: string;
  "prometheus.prometheusSpec.volumes"?: string;
  "prometheus.prometheusSpec.volumeMounts"?: string;
  "prometheus.prometheusSpec.additionalScrapeConfigs"?: string;
  "prometheus.prometheusSpec.additionalAlertManagerConfigs"?: string;
  "prometheus.prometheusSpec.additionalAlertRelabelConfigs"?: string;
  "prometheus.prometheusSpec.securityContext.runAsGroup"?: string;
  "prometheus.prometheusSpec.securityContext.runAsNonRoot"?: string;
  "prometheus.prometheusSpec.securityContext.runAsUser"?: string;
  "prometheus.prometheusSpec.securityContext.fsGroup"?: string;
  "prometheus.prometheusSpec.securityContext.seccompProfile.type"?: string;
  "prometheus.prometheusSpec.dnsPolicy"?: string;
  "prometheus.prometheusSpec.priorityClassName"?: string;
  "prometheus.prometheusSpec.containers"?: string;
  "prometheus.prometheusSpec.initContainers"?: string;
  "prometheus.prometheusSpec.portName"?: string;
  "prometheus.prometheusSpec.arbitraryFSAccessThroughSMs"?: string;
  "prometheus.prometheusSpec.overrideHonorLabels"?: string;
  "prometheus.prometheusSpec.overrideHonorTimestamps"?: string;
  "prometheus.prometheusSpec.ignoreNamespaceSelectors"?: string;
  "prometheus.prometheusSpec.enforcedNamespaceLabel"?: string;
  "prometheus.prometheusSpec.prometheusRulesExcludedFromEnforce"?: string;
  "prometheus.prometheusSpec.excludedFromEnforcement"?: string;
  "prometheus.prometheusSpec.queryLogFile"?: string;
  "prometheus.prometheusSpec.sampleLimit"?: string;
  "prometheus.prometheusSpec.enforcedKeepDroppedTargets"?: string;
  "prometheus.prometheusSpec.enforcedSampleLimit"?: string;
  "prometheus.prometheusSpec.enforcedTargetLimit"?: string;
  "prometheus.prometheusSpec.enforcedLabelLimit"?: string;
  "prometheus.prometheusSpec.enforcedLabelNameLengthLimit"?: string;
  "prometheus.prometheusSpec.enforcedLabelValueLengthLimit"?: string;
  "prometheus.prometheusSpec.allowOverlappingBlocks"?: string;
  "prometheus.prometheusSpec.nameValidationScheme"?: string;
  "prometheus.prometheusSpec.minReadySeconds"?: string;
  "prometheus.prometheusSpec.hostNetwork"?: string;
  "prometheus.prometheusSpec.hostAliases"?: string;
  "prometheus.prometheusSpec.serviceDiscoveryRole"?: string;
  "prometheus.prometheusSpec.additionalConfigString"?: string;
  "prometheus.prometheusSpec.maximumStartupDurationSeconds"?: string;
  "prometheus.prometheusSpec.scrapeProtocols"?: string;
  "prometheus.additionalRulesForClusterRole"?: string;
  "prometheus.additionalServiceMonitors"?: string;
  "prometheus.additionalPodMonitors"?: string;
  "thanosRuler.enabled"?: string;
  "thanosRuler.serviceAccount.create"?: string;
  "thanosRuler.serviceAccount.name"?: string;
  "thanosRuler.podDisruptionBudget.enabled"?: string;
  "thanosRuler.podDisruptionBudget.minAvailable"?: string;
  "thanosRuler.podDisruptionBudget.unhealthyPodEvictionPolicy"?: string;
  "thanosRuler.ingress.enabled"?: string;
  "thanosRuler.ingress.ingressClassName"?: string;
  "thanosRuler.ingress.hosts"?: string;
  "thanosRuler.ingress.paths"?: string;
  "thanosRuler.ingress.tls"?: string;
  "thanosRuler.route.main.enabled"?: string;
  "thanosRuler.route.main.apiVersion"?: string;
  "thanosRuler.route.main.kind"?: string;
  "thanosRuler.route.main.hostnames"?: string;
  "thanosRuler.route.main.parentRefs"?: string;
  "thanosRuler.route.main.httpsRedirect"?: string;
  "thanosRuler.route.main.matches.path.type"?: string;
  "thanosRuler.route.main.matches.path.value"?: string;
  "thanosRuler.route.main.filters"?: string;
  "thanosRuler.route.main.additionalRules"?: string;
  "thanosRuler.service.enabled"?: string;
  "thanosRuler.service.clusterIP"?: string;
  "thanosRuler.service.ipDualStack.enabled"?: string;
  "thanosRuler.service.ipDualStack.ipFamilies"?: string;
  "thanosRuler.service.ipDualStack.ipFamilyPolicy"?: string;
  "thanosRuler.service.port"?: string;
  "thanosRuler.service.targetPort"?: string;
  "thanosRuler.service.nodePort"?: string;
  "thanosRuler.service.additionalPorts"?: string;
  "thanosRuler.service.externalIPs"?: string;
  "thanosRuler.service.loadBalancerIP"?: string;
  "thanosRuler.service.loadBalancerSourceRanges"?: string;
  "thanosRuler.service.externalTrafficPolicy"?: string;
  "thanosRuler.service.type"?: string;
  "thanosRuler.serviceMonitor.selfMonitor"?: string;
  "thanosRuler.serviceMonitor.interval"?: string;
  "thanosRuler.serviceMonitor.sampleLimit"?: string;
  "thanosRuler.serviceMonitor.targetLimit"?: string;
  "thanosRuler.serviceMonitor.labelLimit"?: string;
  "thanosRuler.serviceMonitor.labelNameLengthLimit"?: string;
  "thanosRuler.serviceMonitor.labelValueLengthLimit"?: string;
  "thanosRuler.serviceMonitor.proxyUrl"?: string;
  "thanosRuler.serviceMonitor.scheme"?: string;
  "thanosRuler.serviceMonitor.bearerTokenFile"?: string;
  "thanosRuler.serviceMonitor.metricRelabelings"?: string;
  "thanosRuler.serviceMonitor.relabelings"?: string;
  "thanosRuler.serviceMonitor.additionalEndpoints"?: string;
  "thanosRuler.thanosRulerSpec.serviceName"?: string;
  "thanosRuler.thanosRulerSpec.image.registry"?: string;
  "thanosRuler.thanosRulerSpec.image.repository"?: string;
  "thanosRuler.thanosRulerSpec.image.tag"?: string;
  "thanosRuler.thanosRulerSpec.image.sha"?: string;
  "thanosRuler.thanosRulerSpec.ruleSelectorNilUsesHelmValues"?: string;
  "thanosRuler.thanosRulerSpec.logFormat"?: string;
  "thanosRuler.thanosRulerSpec.logLevel"?: string;
  "thanosRuler.thanosRulerSpec.replicas"?: string;
  "thanosRuler.thanosRulerSpec.retention"?: string;
  "thanosRuler.thanosRulerSpec.evaluationInterval"?: string;
  "thanosRuler.thanosRulerSpec.externalPrefix"?: string;
  "thanosRuler.thanosRulerSpec.externalPrefixNilUsesHelmValues"?: string;
  "thanosRuler.thanosRulerSpec.routePrefix"?: string;
  "thanosRuler.thanosRulerSpec.alertDropLabels"?: string;
  "thanosRuler.thanosRulerSpec.queryEndpoints"?: string;
  "thanosRuler.thanosRulerSpec.paused"?: string;
  "thanosRuler.thanosRulerSpec.additionalArgs"?: string;
  "thanosRuler.thanosRulerSpec.podAntiAffinity"?: string;
  "thanosRuler.thanosRulerSpec.podAntiAffinityTopologyKey"?: string;
  "thanosRuler.thanosRulerSpec.tolerations"?: string;
  "thanosRuler.thanosRulerSpec.topologySpreadConstraints"?: string;
  "thanosRuler.thanosRulerSpec.securityContext.runAsGroup"?: string;
  "thanosRuler.thanosRulerSpec.securityContext.runAsNonRoot"?: string;
  "thanosRuler.thanosRulerSpec.securityContext.runAsUser"?: string;
  "thanosRuler.thanosRulerSpec.securityContext.fsGroup"?: string;
  "thanosRuler.thanosRulerSpec.securityContext.seccompProfile.type"?: string;
  "thanosRuler.thanosRulerSpec.listenLocal"?: string;
  "thanosRuler.thanosRulerSpec.containers"?: string;
  "thanosRuler.thanosRulerSpec.volumes"?: string;
  "thanosRuler.thanosRulerSpec.volumeMounts"?: string;
  "thanosRuler.thanosRulerSpec.initContainers"?: string;
  "thanosRuler.thanosRulerSpec.priorityClassName"?: string;
  "thanosRuler.thanosRulerSpec.portName"?: string;
  "thanosRuler.thanosRulerSpec.additionalConfigString"?: string;
  cleanPrometheusOperatorObjectNames?: string;
  extraManifests?: string;
};
