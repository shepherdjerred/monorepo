// Generated TypeScript types for prometheus-adapter Helm chart

export type PrometheusadapterHelmValuesAffinity = object;

export type PrometheusadapterHelmValuesImage = {
  /**
   * @default "registry.k8s.io/prometheus-adapter/prometheus-a..."
   */
  repository?: string;
  /**
   * if not set appVersion field from Chart.yaml is used
   *
   * @default ""
   */
  tag?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  pullSecrets?: unknown[];
};

export type PrometheusadapterHelmValuesNodeSelector = object;

export type PrometheusadapterHelmValuesCustomAnnotations = object;

export type PrometheusadapterHelmValuesCustomLabels = object;

export type PrometheusadapterHelmValuesPrometheus = {
  /**
   * Value is templated
   *
   * @default "http://prometheus.default.svc"
   */
  url?: string;
  /**
   * @default 9090
   */
  port?: number;
  /**
   * @default ""
   */
  path?: string;
};

export type PrometheusadapterHelmValuesPodSecurityContext = {
  /**
   * @default 10001
   */
  fsGroup?: number;
};

export type PrometheusadapterHelmValuesSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: PrometheusadapterHelmValuesSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
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
  seccompProfile?: PrometheusadapterHelmValuesSecurityContextSeccompProfile;
};

export type PrometheusadapterHelmValuesSecurityContextCapabilities = {
  drop?: string[];
};

export type PrometheusadapterHelmValuesSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type PrometheusadapterHelmValuesRbac = {
  /**
   * Specifies whether RBAC resources should be created
   *
   * @default true
   */
  create?: boolean;
  /**
   * Specifies if a Cluster Role should be used for the Auth Reader
   *
   * @default false
   */
  useAuthReaderClusterRole?: boolean;
  /**
   * @default {"resources":["*"]}
   */
  externalMetrics?: PrometheusadapterHelmValuesRbacExternalMetrics;
  /**
   * @default {"resources":["*"]}
   */
  customMetrics?: PrometheusadapterHelmValuesRbacCustomMetrics;
};

export type PrometheusadapterHelmValuesRbacExternalMetrics = {
  resources?: string[];
};

export type PrometheusadapterHelmValuesRbacCustomMetrics = {
  resources?: string[];
};

export type PrometheusadapterHelmValuesServiceAccount = {
  /**
   * Specifies whether a service account should be created
   *
   * @default true
   */
  create?: boolean;
  name?: unknown;
  /**
   * Use case: AWS EKS IAM roles for service accounts
   * ref: https://docs.aws.amazon.com/eks/latest/userguide/specify-service-account-role.html
   *
   * @default {}
   */
  annotations?: PrometheusadapterHelmValuesServiceAccountAnnotations;
  /**
   * If false then the user will opt out of automounting API credentials.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type PrometheusadapterHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusadapterHelmValuesDnsConfig = object;

export type PrometheusadapterHelmValuesResources = object;

export type PrometheusadapterHelmValuesLivenessProbe = {
  /**
   * @default {"path":"/healthz","port":"https","scheme":"HTTPS"}
   */
  httpGet?: PrometheusadapterHelmValuesLivenessProbeHttpGet;
  /**
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * @default 5
   */
  timeoutSeconds?: number;
};

export type PrometheusadapterHelmValuesLivenessProbeHttpGet = {
  /**
   * @default "/healthz"
   */
  path?: string;
  /**
   * @default "https"
   */
  port?: string;
  /**
   * @default "HTTPS"
   */
  scheme?: string;
};

export type PrometheusadapterHelmValuesReadinessProbe = {
  /**
   * @default {"path":"/healthz","port":"https","scheme":"HTTPS"}
   */
  httpGet?: PrometheusadapterHelmValuesReadinessProbeHttpGet;
  /**
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * @default 5
   */
  timeoutSeconds?: number;
};

export type PrometheusadapterHelmValuesReadinessProbeHttpGet = {
  /**
   * @default "/healthz"
   */
  path?: string;
  /**
   * @default "https"
   */
  port?: string;
  /**
   * @default "HTTPS"
   */
  scheme?: string;
};

export type PrometheusadapterHelmValuesStartupProbe = object;

export type PrometheusadapterHelmValuesRules = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default true
   */
  default?: boolean;
  custom?: unknown[];
  existing?: unknown;
  external?: unknown[];
};

export type PrometheusadapterHelmValuesService = {
  /**
   * @default {}
   */
  annotations?: PrometheusadapterHelmValuesServiceAnnotations;
  /**
   * @default 443
   */
  port?: number;
  /**
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: PrometheusadapterHelmValuesServiceIpDualStack;
};

export type PrometheusadapterHelmValuesServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PrometheusadapterHelmValuesServiceIpDualStack = {
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

export type PrometheusadapterHelmValuesTls = {
  /**
   * @default false
   */
  enable?: boolean;
  /**
   * @default "# Public CA file that signed the APIService"
   */
  ca?: string;
  /**
   * @default "# Private key of the APIService"
   */
  key?: string;
  /**
   * @default "# Public key of the APIService"
   */
  certificate?: string;
};

export type PrometheusadapterHelmValuesPodLabels = object;

export type PrometheusadapterHelmValuesPodAnnotations = object;

export type PrometheusadapterHelmValuesDeploymentAnnotations = object;

export type PrometheusadapterHelmValuesHostNetwork = {
  /**
   * Specifies if prometheus-adapter should be started in hostNetwork mode.
   * You would require this enabled if you use alternate overlay networking for pods and
   * API server unable to communicate with metrics-server. As an example, this is required
   * if you use Weave network on EKS. See also dnsPolicy
   *
   * @default false
   */
  enabled?: boolean;
};

export type PrometheusadapterHelmValuesStrategy = {
  /**
   * @default "RollingUpdate"
   */
  type?: string;
  /**
   * @default {"maxUnavailable":"25%","maxSurge":"25%"}
   */
  rollingUpdate?: PrometheusadapterHelmValuesStrategyRollingUpdate;
};

export type PrometheusadapterHelmValuesStrategyRollingUpdate = {
  /**
   * @default "25%"
   */
  maxUnavailable?: string;
  /**
   * @default "25%"
   */
  maxSurge?: string;
};

export type PrometheusadapterHelmValuesPodDisruptionBudget = {
  /**
   * Specifies if PodDisruptionBudget should be enabled
   * When enabled, minAvailable or maxUnavailable should also be defined.
   *
   * @default false
   */
  enabled?: boolean;
  minAvailable?: unknown;
  /**
   * @default 1
   */
  maxUnavailable?: number;
  unhealthyPodEvictionPolicy?: unknown;
};

export type PrometheusadapterHelmValuesCertManager = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "43800h0m0s"
   */
  caCertDuration?: string;
  /**
   * @default "8760h0m0s"
   */
  certDuration?: string;
  caCertRevisionHistoryLimit?: unknown;
  certRevisionHistoryLimit?: unknown;
};

export type PrometheusadapterHelmValues = {
  /**
   * @default {}
   */
  affinity?: PrometheusadapterHelmValuesAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * @default {...} (4 keys)
   */
  image?: PrometheusadapterHelmValuesImage;
  /**
   * @default 4
   */
  logLevel?: number;
  /**
   * @default "1m"
   */
  metricsRelistInterval?: string;
  /**
   * @default 6443
   */
  listenPort?: number;
  /**
   * @default {}
   */
  nodeSelector?: PrometheusadapterHelmValuesNodeSelector;
  /**
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Override the release namespace (for multi-namespace deployments in combined charts)
   *
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * Additional annotations to add to all resources
   *
   * @default {}
   */
  customAnnotations?: PrometheusadapterHelmValuesCustomAnnotations;
  /**
   * Additional labels to add to all resources
   *
   * @default {}
   */
  customLabels?: PrometheusadapterHelmValuesCustomLabels;
  /**
   * Url to access prometheus
   *
   * @default {"url":"http://prometheus.default.svc","port":9090,"path":""}
   */
  prometheus?: PrometheusadapterHelmValuesPrometheus;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * k8s 1.21 needs fsGroup to be set for non root deployments
   * ref: https://github.com/kubernetes/kubernetes/issues/70679
   *
   * @default {"fsGroup":10001}
   */
  podSecurityContext?: PrometheusadapterHelmValuesPodSecurityContext;
  /**
   * SecurityContext of the container
   * ref. https://kubernetes.io/docs/tasks/configure-pod-container/security-context
   *
   * @default {...} (6 keys)
   */
  securityContext?: PrometheusadapterHelmValuesSecurityContext;
  /**
   * @default {...} (4 keys)
   */
  rbac?: PrometheusadapterHelmValuesRbac;
  /**
   * If false then the user will opt out of automounting API credentials.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default {...} (4 keys)
   */
  serviceAccount?: PrometheusadapterHelmValuesServiceAccount;
  /**
   * Custom DNS configuration to be added to prometheus-adapter pods
   *
   * @default {}
   */
  dnsConfig?: PrometheusadapterHelmValuesDnsConfig;
  /**
   * @default {}
   */
  resources?: PrometheusadapterHelmValuesResources;
  /**
   * Configure liveness probe
   * https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-v1/#Probe
   *
   * @default {"httpGet":{"path":"/healthz","port":"https","scheme":"HTTPS"},"initialDelaySeconds":30,"timeoutSeconds":5}
   */
  livenessProbe?: PrometheusadapterHelmValuesLivenessProbe;
  /**
   * Configure readiness probe
   *
   * @default {"httpGet":{"path":"/healthz","port":"https","scheme":"HTTPS"},"initialDelaySeconds":30,"timeoutSeconds":5}
   */
  readinessProbe?: PrometheusadapterHelmValuesReadinessProbe;
  /**
   * Configure startup probe
   * Use if prometheus-adapter takes a long time to finish startup e.g. polling a lot of API versions in cluster
   *
   * @default {}
   */
  startupProbe?: PrometheusadapterHelmValuesStartupProbe;
  /**
   * @default {...} (4 keys)
   */
  rules?: PrometheusadapterHelmValuesRules;
  /**
   * @default {...} (4 keys)
   */
  service?: PrometheusadapterHelmValuesService;
  /**
   * @default {...} (4 keys)
   */
  tls?: PrometheusadapterHelmValuesTls;
  env?: unknown[];
  extraArguments?: unknown[];
  extraContainers?: unknown[];
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  tolerations?: unknown[];
  /**
   * Labels added to the pod
   *
   * @default {}
   */
  podLabels?: PrometheusadapterHelmValuesPodLabels;
  /**
   * Annotations added to the pod
   *
   * @default {}
   */
  podAnnotations?: PrometheusadapterHelmValuesPodAnnotations;
  /**
   * Annotations added to the deployment
   *
   * @default {}
   */
  deploymentAnnotations?: PrometheusadapterHelmValuesDeploymentAnnotations;
  /**
   * @default {"enabled":false}
   */
  hostNetwork?: PrometheusadapterHelmValuesHostNetwork;
  /**
   * When hostNetwork is enabled, you probably want to set this to ClusterFirstWithHostNet
   * Deployment strategy type
   *
   * @default {"type":"RollingUpdate","rollingUpdate":{"maxUnavailable":"25%","maxSurge":"25%"}}
   */
  strategy?: PrometheusadapterHelmValuesStrategy;
  /**
   * @default {...} (4 keys)
   */
  podDisruptionBudget?: PrometheusadapterHelmValuesPodDisruptionBudget;
  /**
   * @default {...} (5 keys)
   */
  certManager?: PrometheusadapterHelmValuesCertManager;
  extraManifests?: unknown[];
  /**
   * Optional: set revisionHistoryLimit for the Deployment
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
};

export type PrometheusadapterHelmParameters = {
  topologySpreadConstraints?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "image.pullPolicy"?: string;
  "image.pullSecrets"?: string;
  logLevel?: string;
  metricsRelistInterval?: string;
  listenPort?: string;
  priorityClassName?: string;
  namespaceOverride?: string;
  "prometheus.url"?: string;
  "prometheus.port"?: string;
  "prometheus.path"?: string;
  replicas?: string;
  "podSecurityContext.fsGroup"?: string;
  "securityContext.allowPrivilegeEscalation"?: string;
  "securityContext.capabilities.drop"?: string;
  "securityContext.readOnlyRootFilesystem"?: string;
  "securityContext.runAsNonRoot"?: string;
  "securityContext.runAsUser"?: string;
  "securityContext.seccompProfile.type"?: string;
  "rbac.create"?: string;
  "rbac.useAuthReaderClusterRole"?: string;
  "rbac.externalMetrics.resources"?: string;
  "rbac.customMetrics.resources"?: string;
  automountServiceAccountToken?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "serviceAccount.automountServiceAccountToken"?: string;
  "livenessProbe.httpGet.path"?: string;
  "livenessProbe.httpGet.port"?: string;
  "livenessProbe.httpGet.scheme"?: string;
  "livenessProbe.initialDelaySeconds"?: string;
  "livenessProbe.timeoutSeconds"?: string;
  "readinessProbe.httpGet.path"?: string;
  "readinessProbe.httpGet.port"?: string;
  "readinessProbe.httpGet.scheme"?: string;
  "readinessProbe.initialDelaySeconds"?: string;
  "readinessProbe.timeoutSeconds"?: string;
  "rules.default"?: string;
  "rules.custom"?: string;
  "rules.existing"?: string;
  "rules.external"?: string;
  "service.port"?: string;
  "service.type"?: string;
  "service.ipDualStack.enabled"?: string;
  "service.ipDualStack.ipFamilies"?: string;
  "service.ipDualStack.ipFamilyPolicy"?: string;
  "tls.enable"?: string;
  "tls.ca"?: string;
  "tls.key"?: string;
  "tls.certificate"?: string;
  env?: string;
  extraArguments?: string;
  extraContainers?: string;
  extraVolumes?: string;
  extraVolumeMounts?: string;
  tolerations?: string;
  "hostNetwork.enabled"?: string;
  "strategy.type"?: string;
  "strategy.rollingUpdate.maxUnavailable"?: string;
  "strategy.rollingUpdate.maxSurge"?: string;
  "podDisruptionBudget.enabled"?: string;
  "podDisruptionBudget.minAvailable"?: string;
  "podDisruptionBudget.maxUnavailable"?: string;
  "podDisruptionBudget.unhealthyPodEvictionPolicy"?: string;
  "certManager.enabled"?: string;
  "certManager.caCertDuration"?: string;
  "certManager.certDuration"?: string;
  "certManager.caCertRevisionHistoryLimit"?: string;
  "certManager.certRevisionHistoryLimit"?: string;
  extraManifests?: string;
  revisionHistoryLimit?: string;
};
