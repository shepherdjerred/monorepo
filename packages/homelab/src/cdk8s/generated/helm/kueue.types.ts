// Generated TypeScript types for kueue Helm chart

export type KueueHelmValuesCertManager = {
  /**
   * Override the default self-signed cert-manager issuer reference. When set, the chart skips creating its own Issuer and uses this reference for webhook, metrics, and visibility certificates. The referenced issuer must provide the CA data required by Kueue's cert-manager integration.
   *
   * @default {}
   */
  issuerRef?: KueueHelmValuesCertManagerIssuerRef;
};

export type KueueHelmValuesCertManagerIssuerRef = object;

export type KueueHelmValuesControllerManager = {
  featureGates?: unknown[];
  /**
   * @default {...} (7 keys)
   */
  manager?: KueueHelmValuesControllerManagerManager;
  /**
   * ControllerManager's replicas count
   *
   * @default 1
   */
  replicas?: number;
  imagePullSecrets?: unknown[];
  /**
   * @default {...} (5 keys)
   */
  readinessProbe?: KueueHelmValuesControllerManagerReadinessProbe;
  /**
   * @default {...} (5 keys)
   */
  livenessProbe?: KueueHelmValuesControllerManagerLivenessProbe;
  /**
   * ControllerManager's nodeSelector
   */
  nodeSelector?: Record<string, string>;
  /**
   * ControllerManager's tolerations
   */
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * @default {"enabled":false,"minAvailable":1}
   */
  podDisruptionBudget?: KueueHelmValuesControllerManagerPodDisruptionBudget;
};

export type KueueHelmValuesControllerManagerManager = {
  priorityClassName?: unknown;
  /**
   * @default {"repository":"registry.k8s.io/kueue/kueue","tag":"v0.18.2","pullPolicy":"IfNotPresent"}
   */
  image?: KueueHelmValuesControllerManagerManagerImage;
  /**
   * @default {}
   */
  podAnnotations?: KueueHelmValuesControllerManagerManagerPodAnnotations;
  /**
   * Zap log level. Higher values increase verbosity.
   *
   * @default 2
   */
  logLevel?: number;
  /**
   * ControllerManager's pod resources
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * ControllerManager's pod securityContext
   *
   * @default {"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}}
   */
  podSecurityContext?: KueueHelmValuesControllerManagerManagerPodSecurityContext;
  /**
   * ControllerManager's container securityContext
   *
   * @default {"readOnlyRootFilesystem":true,"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}
   */
  containerSecurityContext?: KueueHelmValuesControllerManagerManagerContainerSecurityContext;
};

export type KueueHelmValuesControllerManagerManagerImage = {
  /**
   * ControllerManager's image repository
   *
   * @default "registry.k8s.io/kueue/kueue"
   */
  repository?: string;
  /**
   * ControllerManager's image tag
   *
   * @default "v0.18.2"
   */
  tag?: string;
  /**
   * ControllerManager's image pullPolicy.
   * This should be set to 'IfNotPresent' for released version
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KueueHelmValuesControllerManagerManagerPodAnnotations = object;

export type KueueHelmValuesControllerManagerManagerPodSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KueueHelmValuesControllerManagerManagerPodSecurityContextSeccompProfile;
};

export type KueueHelmValuesControllerManagerManagerPodSecurityContextSeccompProfile =
  {
    /**
     * @default "RuntimeDefault"
     */
    type?: string;
  };

export type KueueHelmValuesControllerManagerManagerContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KueueHelmValuesControllerManagerManagerContainerSecurityContextCapabilities;
};

export type KueueHelmValuesControllerManagerManagerContainerSecurityContextCapabilities =
  {
    drop?: string[];
  };

export type KueueHelmValuesControllerManagerReadinessProbe = {
  /**
   * ControllerManager's readinessProbe initialDelaySeconds
   *
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * ControllerManager's readinessProbe periodSeconds
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * ControllerManager's readinessProbe timeoutSeconds
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * ControllerManager's readinessProbe failureThreshold
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * ControllerManager's readinessProbe successThreshold
   *
   * @default 1
   */
  successThreshold?: number;
};

export type KueueHelmValuesControllerManagerLivenessProbe = {
  /**
   * ControllerManager's livenessProbe initialDelaySeconds
   *
   * @default 15
   */
  initialDelaySeconds?: number;
  /**
   * ControllerManager's livenessProbe periodSeconds
   *
   * @default 20
   */
  periodSeconds?: number;
  /**
   * ControllerManager's livenessProbe timeoutSeconds
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * ControllerManager's livenessProbe failureThreshold
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * ControllerManager's livenessProbe successThreshold
   *
   * @default 1
   */
  successThreshold?: number;
};

export type KueueHelmValuesControllerManagerPodDisruptionBudget = {
  /**
   * Enable PodDisruptionBudget
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * PodDisruptionBudget's topologySpreadConstraints
   *
   * @default 1
   */
  minAvailable?: number;
};

export type KueueHelmValuesManagerConfig = {
  /**
   * controller_manager_config.yaml.
   * ControllerManager utilizes this yaml via manager-config Configmap.
   *
   * @default "apiVersion: config.kueue.x-k8s.io/v1beta2
kind:..."
   */
  controllerManagerConfigYaml?: string;
};

export type KueueHelmValuesMetricsService = {
  ports?: KueueHelmValuesMetricsServicePortsElement[];
  /**
   * metricsService's type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * metricsService's labels
   *
   * @default {}
   */
  labels?: KueueHelmValuesMetricsServiceLabels;
  /**
   * metricsService's annotations
   *
   * @default {}
   */
  annotations?: KueueHelmValuesMetricsServiceAnnotations;
};

export type KueueHelmValuesMetricsServicePortsElement = {
  /**
   * @default "https"
   */
  name?: string;
  /**
   * @default 8443
   */
  port?: number;
  /**
   * @default "TCP"
   */
  protocol?: string;
  /**
   * @default 8443
   */
  targetPort?: number;
};

export type KueueHelmValuesMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KueueHelmValuesMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type KueueHelmValuesWebhookService = {
  /**
   * @default {"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"}
   */
  ipDualStack?: KueueHelmValuesWebhookServiceIpDualStack;
  ports?: KueueHelmValuesWebhookServicePortsElement[];
  /**
   * webhookService's type
   *
   * @default "ClusterIP"
   */
  type?: string;
};

export type KueueHelmValuesWebhookServiceIpDualStack = {
  /**
   * webhookService's ipDualStack enabled
   *
   * @default false
   */
  enabled?: boolean;
  ipFamilies?: string[];
  /**
   * webhookService's ipDualStack ipFamilyPolicy
   *
   * @default "PreferDualStack"
   */
  ipFamilyPolicy?: string;
};

export type KueueHelmValuesWebhookServicePortsElement = {
  /**
   * @default 443
   */
  port?: number;
  /**
   * @default "TCP"
   */
  protocol?: string;
  /**
   * @default 9443
   */
  targetPort?: number;
};

export type KueueHelmValuesMutatingWebhook = {
  /**
   * MutatingWebhookConfiguration's reinvocationPolicy
   *
   * @default "Never"
   */
  reinvocationPolicy?: string;
};

export type KueueHelmValuesKueueViz = {
  /**
   * @default {...} (11 keys)
   */
  backend?: KueueHelmValuesKueueVizBackend;
  /**
   * @default {...} (10 keys)
   */
  frontend?: KueueHelmValuesKueueVizFrontend;
};

export type KueueHelmValuesKueueVizBackend = {
  /**
   * KueueViz backend nodeSelector
   */
  nodeSelector?: Record<string, string>;
  /**
   * KueueViz backend tolerations
   */
  tolerations?: unknown[];
  imagePullSecrets?: unknown[];
  priorityClassName?: unknown;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * KueueViz backend pod securityContext
   *
   * @default {"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}}
   */
  podSecurityContext?: KueueHelmValuesKueueVizBackendPodSecurityContext;
  /**
   * KueueViz backend container securityContext
   *
   * @default {"readOnlyRootFilesystem":true,"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}
   */
  containerSecurityContext?: KueueHelmValuesKueueVizBackendContainerSecurityContext;
  env?: KueueHelmValuesKueueVizBackendEnvElement[];
  /**
   * @default {...} (5 keys)
   */
  ingress?: KueueHelmValuesKueueVizBackendIngress;
  /**
   * @default {"mode":"Disabled","tokenReviewConfig":{"audiences":"","cacheTTL":"60s","negativeCacheTTL":"5s"}}
   */
  auth?: KueueHelmValuesKueueVizBackendAuth;
  /**
   * @default {"repository":"registry.k8s.io/kueue/kueueviz-backend","tag":"v0.18.2","pullPolicy":"IfNotPresent"}
   */
  image?: KueueHelmValuesKueueVizBackendImage;
};

export type KueueHelmValuesKueueVizBackendPodSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: KueueHelmValuesKueueVizBackendPodSecurityContextSeccompProfile;
};

export type KueueHelmValuesKueueVizBackendPodSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type KueueHelmValuesKueueVizBackendContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: KueueHelmValuesKueueVizBackendContainerSecurityContextCapabilities;
};

export type KueueHelmValuesKueueVizBackendContainerSecurityContextCapabilities =
  {
    drop?: string[];
  };

export type KueueHelmValuesKueueVizBackendEnvElement = {
  /**
   * @default "KUEUEVIZ_ALLOWED_ORIGINS"
   */
  name?: string;
  /**
   * @default "https://frontend.kueueviz.local"
   */
  value?: string;
};

export type KueueHelmValuesKueueVizBackendIngress = {
  /**
   * Enable KueueViz dashboard backend ingress
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * KueueViz dashboard backend ingress annotations
   *
   * @default {"nginx.ingress.kubernetes.io/rewrite-target":"/","nginx.ingress.kubernetes.io/ssl-redirect":"true"}
   */
  annotations?: KueueHelmValuesKueueVizBackendIngressAnnotations;
  ingressClassName?: unknown;
  /**
   * @default "backend.kueueviz.local"
   */
  host?: string;
  /**
   * KueueViz dashboard backend ingress tls secret name
   *
   * @default "kueueviz-backend-tls"
   */
  tlsSecretName?: string;
};

export type KueueHelmValuesKueueVizBackendIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "/"
   */
  "nginx.ingress.kubernetes.io/rewrite-target"?: string;
  /**
   * @default "true"
   */
  "nginx.ingress.kubernetes.io/ssl-redirect"?: boolean;
};

export type KueueHelmValuesKueueVizBackendAuth = {
  /**
   * Authentication mode: "Disabled" or "TokenReview" (Alpha, disabled by default)
   *
   * @default "Disabled"
   */
  mode?: string;
  /**
   * TokenReview-specific configuration (only used when mode is "TokenReview")
   *
   * @default {"audiences":"","cacheTTL":"60s","negativeCacheTTL":"5s"}
   */
  tokenReviewConfig?: KueueHelmValuesKueueVizBackendAuthTokenReviewConfig;
};

export type KueueHelmValuesKueueVizBackendAuthTokenReviewConfig = {
  /**
   * Optional comma-separated list of audiences for TokenReview
   *
   * @default ""
   */
  audiences?: string;
  /**
   * TTL for successful authentication cache
   *
   * @default "60s"
   */
  cacheTTL?: string;
  /**
   * TTL for failed authentication cache (prevents API server abuse)
   *
   * @default "5s"
   */
  negativeCacheTTL?: string;
};

export type KueueHelmValuesKueueVizBackendImage = {
  /**
   * KueueViz dashboard backend image repository
   *
   * @default "registry.k8s.io/kueue/kueueviz-backend"
   */
  repository?: string;
  /**
   * KueueViz dashboard backend image tag
   *
   * @default "v0.18.2"
   */
  tag?: string;
  /**
   * KueueViz dashboard backend image pullPolicy.
   * This should be set to 'IfNotPresent' for released version
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KueueHelmValuesKueueVizFrontend = {
  /**
   * KueueViz frontend nodeSelector
   */
  nodeSelector?: Record<string, string>;
  /**
   * KueueViz frontend tolerations
   */
  tolerations?: unknown[];
  imagePullSecrets?: unknown[];
  priorityClassName?: unknown;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * KueueViz frontend pod securityContext
   *
   * @default {}
   */
  podSecurityContext?: KueueHelmValuesKueueVizFrontendPodSecurityContext;
  /**
   * KueueViz frontend container securityContext
   *
   * @default {}
   */
  containerSecurityContext?: KueueHelmValuesKueueVizFrontendContainerSecurityContext;
  env?: unknown[];
  /**
   * @default {...} (5 keys)
   */
  ingress?: KueueHelmValuesKueueVizFrontendIngress;
  /**
   * @default {"repository":"registry.k8s.io/kueue/kueueviz-frontend","tag":"v0.18.2","pullPolicy":"IfNotPresent"}
   */
  image?: KueueHelmValuesKueueVizFrontendImage;
};

export type KueueHelmValuesKueueVizFrontendPodSecurityContext = object;

export type KueueHelmValuesKueueVizFrontendContainerSecurityContext = object;

export type KueueHelmValuesKueueVizFrontendIngress = {
  /**
   * Enable KueueViz dashboard frontend ingress
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * KueueViz dashboard frontend ingress annotations
   *
   * @default {"nginx.ingress.kubernetes.io/rewrite-target":"/","nginx.ingress.kubernetes.io/ssl-redirect":"true"}
   */
  annotations?: KueueHelmValuesKueueVizFrontendIngressAnnotations;
  ingressClassName?: unknown;
  /**
   * @default "frontend.kueueviz.local"
   */
  host?: string;
  /**
   * KueueViz dashboard frontend ingress tls secret name
   *
   * @default "kueueviz-frontend-tls"
   */
  tlsSecretName?: string;
};

export type KueueHelmValuesKueueVizFrontendIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "/"
   */
  "nginx.ingress.kubernetes.io/rewrite-target"?: string;
  /**
   * @default "true"
   */
  "nginx.ingress.kubernetes.io/ssl-redirect"?: boolean;
};

export type KueueHelmValuesKueueVizFrontendImage = {
  /**
   * KueueViz dashboard frontend image repository
   *
   * @default "registry.k8s.io/kueue/kueueviz-frontend"
   */
  repository?: string;
  /**
   * KueueViz dashboard frontend image tag
   *
   * @default "v0.18.2"
   */
  tag?: string;
  /**
   * KueueViz dashboard frontend image pullPolicy.
   * This should be set to 'IfNotPresent' for released version
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type KueueHelmValuesMetrics = {
  /**
   * Prometheus namespace
   *
   * @default "monitoring"
   */
  prometheusNamespace?: string;
  /**
   * @default {"tlsConfig":{"insecureSkipVerify":true}}
   */
  serviceMonitor?: KueueHelmValuesMetricsServiceMonitor;
};

export type KueueHelmValuesMetricsServiceMonitor = {
  /**
   * ServiceMonitor's tlsConfig
   *
   * @default {"insecureSkipVerify":true}
   */
  tlsConfig?: KueueHelmValuesMetricsServiceMonitorTlsConfig;
};

export type KueueHelmValuesMetricsServiceMonitorTlsConfig = {
  /**
   * @default true
   */
  insecureSkipVerify?: boolean;
};

export type KueueHelmValues = {
  /**
   * Default values for kueue.
   * This is a YAML-formatted file.
   * Declare variables to be passed into your templates.
   * Override the resource name
   *
   * @default ""
   */
  nameOverride?: string;
  /**
   * Override the resource name
   *
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * Enable Prometheus
   *
   * @default false
   */
  enablePrometheus?: boolean;
  /**
   * Enable x509 automated certificate management using cert-manager (cert-manager.io)
   *
   * @default false
   */
  enableCertManager?: boolean;
  /**
   * @default {"issuerRef":{}}
   */
  certManager?: KueueHelmValuesCertManager;
  /**
   * Enable API Priority and Fairness configuration for the visibility API
   *
   * @default false
   */
  enableVisibilityAPF?: boolean;
  /**
   * Enable KueueViz dashboard
   *
   * @default false
   */
  enableKueueViz?: boolean;
  /**
   * Kubernetes cluster's domain
   *
   * @default "cluster.local"
   */
  kubernetesClusterDomain?: string;
  /**
   * @default {...} (10 keys)
   */
  controllerManager?: KueueHelmValuesControllerManager;
  /**
   * @default {"controllerManagerConfigYaml":"apiVersion: config.kueue.x-k8s.io/v1beta2\nkind: Configuration\nhealth:\n  healthProbeBindAddress: :8081\nmetrics:\n  bindAddress: :8443\n# enableClusterQueueResources: true\nwebhook:\n  port: 9443\nleaderElection:\n  leaderElect: true\n  resourceName: c1f6bfd2.kueue.x-k8s.io\ncontroller:\n  groupKindConcurrency:\n    Job.batch: 5\n    Pod: 5\n    Workload.kueue.x-k8s.io: 5\n    LocalQueue.kueue.x-k8s.io: 1\n    ClusterQueue.kueue.x-k8s.io: 1\n    ResourceFlavor.kueue.x-k8s.io: 1\nclientConnection:\n  qps: 50\n  burst: 100\n#pprofBindAddress: :8083\n#waitForPodsReady:\n#  timeout: 5m\n#  recoveryTimeout: 3m\n#  blockAdmission: false\n#  requeuingStrategy:\n#    timestamp: Eviction\n#    backoffLimitCount: null # null indicates infinite requeuing\n#    backoffBaseSeconds: 60\n#    backoffMaxSeconds: 3600\n#manageJobsWithoutQueueName: true\n# See \"Opt-in Namespace Management\" for guidance on namespace management:\n# https://kueue.sigs.k8s.io/docs/tasks/manage/enforce_job_management/opt_in_namespace_management/\n#managedJobsNamespaceSelector:\n#  matchExpressions:\n#    - key: kubernetes.io/metadata.name\n#      operator: NotIn\n#      values: [ kube-system, kueue-system ]\n#internalCertManagement:\n#  enable: false\n#  webhookServiceName: \"\"\n#  webhookSecretName: \"\"\nintegrations:\n  frameworks:\n  - \"batch/job\"\n  - \"kubeflow.org/mpijob\"\n  - \"ray.io/rayjob\"\n  - \"ray.io/rayservice\"\n  - \"ray.io/raycluster\"\n  - \"jobset.x-k8s.io/jobset\"\n  - \"trainer.kubeflow.org/trainjob\"\n  - \"kubeflow.org/paddlejob\"\n  - \"kubeflow.org/pytorchjob\"\n  - \"kubeflow.org/tfjob\"\n  - \"kubeflow.org/xgboostjob\"\n  - \"kubeflow.org/jaxjob\"\n  - \"workload.codeflare.dev/appwrapper\"\n#  - \"sparkoperator.k8s.io/sparkapplication\"\n  - \"pod\"\n  - \"deployment\"\n  - \"statefulset\"\n  - \"leaderworkerset.x-k8s.io/leaderworkerset\"\n#  externalFrameworks:\n#  - \"Foo.v1.example.com\"\n#fairSharing:\n#  preemptionStrategies: [LessThanOrEqualToFinalShare, LessThanInitialShare]\n#admissionFairSharing:\n#  usageHalfLifeTime: \"168h\" # 7 days\n#  usageSamplingInterval: \"5m\"\n#  resourceWeights: # optional, defaults to 1 for all resources if not specified\n#    cpu: 0    # if you want to completely ignore cpu usage\n#    memory: 0 # ignore completely memory usage\n#    example.com/gpu: 100 # and you care only about GPUs usage\n#resources:\n#  excludeResourcePrefixes: []\n#  quotaCheckStrategy: \"BlockUndeclared\"\n# transformations:\n# - input: nvidia.com/mig-4g.5gb\n#   strategy: Replace | Retain\n#   outputs:\n#     example.com/accelerator-memory: 5Gi\n#     example.com/accelerator-gpc: 4\n#objectRetentionPolicies:\n#  workloads:\n#    afterFinished: null # null indicates infinite retention, 0s means no retention at all\n#    afterDeactivatedByKueue: null # null indicates infinite retention, 0s means no retention at all"}
   */
  managerConfig?: KueueHelmValuesManagerConfig;
  /**
   * @default {...} (4 keys)
   */
  metricsService?: KueueHelmValuesMetricsService;
  /**
   * @default {"ipDualStack":{"enabled":false,"ipFamilies":["IPv6","IPv4"],"ipFamilyPolicy":"PreferDualStack"},"ports":[{"port":443,"protocol":"TCP","targetPort":9443}],"type":"ClusterIP"}
   */
  webhookService?: KueueHelmValuesWebhookService;
  /**
   * @default {"reinvocationPolicy":"Never"}
   */
  mutatingWebhook?: KueueHelmValuesMutatingWebhook;
  /**
   * @default {"backend":{"nodeSelector":{},"tolerations":[],"imagePullSecrets":[],"priorityClassName":null,"resources":{"limits":{"cpu":"500m","memory":"512Mi"},"requests":{"cpu":"500m","memory":"512Mi"}},"podSecurityContext":{"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}},"containerSecurityContext":{"readOnlyRootFilesystem":true,"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}},"env":[{"name":"KUEUEVIZ_ALLOWED_ORIGINS","value":"https://frontend.kueueviz.local"}],"ingress":{"enabled":true,"annotations":{"nginx.ingress.kubernetes.io/rewrite-target":"/","nginx.ingress.kubernetes.io/ssl-redirect":"true"},"ingressClassName":null,"host":"backend.kueueviz.local","tlsSecretName":"kueueviz-backend-tls"},"auth":{"mode":"Disabled","tokenReviewConfig":{"audiences":"","cacheTTL":"60s","negativeCacheTTL":"5s"}},"image":{"repository":"registry.k8s.io/kueue/kueueviz-backend","tag":"v0.18.2","pullPolicy":"IfNotPresent"}},"frontend":{"nodeSelector":{},"tolerations":[],"imagePullSecrets":[],"priorityClassName":null,"resources":{"limits":{"cpu":"500m","memory":"512Mi"},"requests":{"cpu":"500m","memory":"512Mi"}},"podSecurityContext":{},"containerSecurityContext":{},"env":[],"ingress":{"enabled":true,"annotations":{"nginx.ingress.kubernetes.io/rewrite-target":"/","nginx.ingress.kubernetes.io/ssl-redirect":"true"},"ingressClassName":null,"host":"frontend.kueueviz.local","tlsSecretName":"kueueviz-frontend-tls"},"image":{"repository":"registry.k8s.io/kueue/kueueviz-frontend","tag":"v0.18.2","pullPolicy":"IfNotPresent"}}}
   */
  kueueViz?: KueueHelmValuesKueueViz;
  /**
   * @default {"prometheusNamespace":"monitoring","serviceMonitor":{"tlsConfig":{"insecureSkipVerify":true}}}
   */
  metrics?: KueueHelmValuesMetrics;
};

export type KueueHelmParameters = {
  nameOverride?: string;
  fullnameOverride?: string;
  enablePrometheus?: string;
  enableCertManager?: string;
  enableVisibilityAPF?: string;
  enableKueueViz?: string;
  kubernetesClusterDomain?: string;
  "controllerManager.featureGates"?: string;
  "controllerManager.manager.priorityClassName"?: string;
  "controllerManager.manager.image.repository"?: string;
  "controllerManager.manager.image.tag"?: string;
  "controllerManager.manager.image.pullPolicy"?: string;
  "controllerManager.manager.logLevel"?: string;
  "controllerManager.manager.resources"?: string;
  "controllerManager.manager.podSecurityContext.runAsNonRoot"?: string;
  "controllerManager.manager.podSecurityContext.seccompProfile.type"?: string;
  "controllerManager.manager.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "controllerManager.manager.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "controllerManager.manager.containerSecurityContext.capabilities.drop"?: string;
  "controllerManager.replicas"?: string;
  "controllerManager.imagePullSecrets"?: string;
  "controllerManager.readinessProbe.initialDelaySeconds"?: string;
  "controllerManager.readinessProbe.periodSeconds"?: string;
  "controllerManager.readinessProbe.timeoutSeconds"?: string;
  "controllerManager.readinessProbe.failureThreshold"?: string;
  "controllerManager.readinessProbe.successThreshold"?: string;
  "controllerManager.livenessProbe.initialDelaySeconds"?: string;
  "controllerManager.livenessProbe.periodSeconds"?: string;
  "controllerManager.livenessProbe.timeoutSeconds"?: string;
  "controllerManager.livenessProbe.failureThreshold"?: string;
  "controllerManager.livenessProbe.successThreshold"?: string;
  "controllerManager.nodeSelector"?: string;
  "controllerManager.tolerations"?: string;
  "controllerManager.topologySpreadConstraints"?: string;
  "controllerManager.podDisruptionBudget.enabled"?: string;
  "controllerManager.podDisruptionBudget.minAvailable"?: string;
  "managerConfig.controllerManagerConfigYaml"?: string;
  "metricsService.ports.name"?: string;
  "metricsService.ports.port"?: string;
  "metricsService.ports.protocol"?: string;
  "metricsService.ports.targetPort"?: string;
  "metricsService.type"?: string;
  "webhookService.ipDualStack.enabled"?: string;
  "webhookService.ipDualStack.ipFamilies"?: string;
  "webhookService.ipDualStack.ipFamilyPolicy"?: string;
  "webhookService.ports.port"?: string;
  "webhookService.ports.protocol"?: string;
  "webhookService.ports.targetPort"?: string;
  "webhookService.type"?: string;
  "mutatingWebhook.reinvocationPolicy"?: string;
  "kueueViz.backend.nodeSelector"?: string;
  "kueueViz.backend.tolerations"?: string;
  "kueueViz.backend.imagePullSecrets"?: string;
  "kueueViz.backend.priorityClassName"?: string;
  "kueueViz.backend.resources"?: string;
  "kueueViz.backend.podSecurityContext.runAsNonRoot"?: string;
  "kueueViz.backend.podSecurityContext.seccompProfile.type"?: string;
  "kueueViz.backend.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "kueueViz.backend.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "kueueViz.backend.containerSecurityContext.capabilities.drop"?: string;
  "kueueViz.backend.env.name"?: string;
  "kueueViz.backend.env.value"?: string;
  "kueueViz.backend.ingress.enabled"?: string;
  "kueueViz.backend.ingress.annotations.nginx.ingress.kubernetes.io/rewrite-target"?: string;
  "kueueViz.backend.ingress.annotations.nginx.ingress.kubernetes.io/ssl-redirect"?: string;
  "kueueViz.backend.ingress.ingressClassName"?: string;
  "kueueViz.backend.ingress.host"?: string;
  "kueueViz.backend.ingress.tlsSecretName"?: string;
  "kueueViz.backend.auth.mode"?: string;
  "kueueViz.backend.auth.tokenReviewConfig.audiences"?: string;
  "kueueViz.backend.auth.tokenReviewConfig.cacheTTL"?: string;
  "kueueViz.backend.auth.tokenReviewConfig.negativeCacheTTL"?: string;
  "kueueViz.backend.image.repository"?: string;
  "kueueViz.backend.image.tag"?: string;
  "kueueViz.backend.image.pullPolicy"?: string;
  "kueueViz.frontend.nodeSelector"?: string;
  "kueueViz.frontend.tolerations"?: string;
  "kueueViz.frontend.imagePullSecrets"?: string;
  "kueueViz.frontend.priorityClassName"?: string;
  "kueueViz.frontend.resources"?: string;
  "kueueViz.frontend.env"?: string;
  "kueueViz.frontend.ingress.enabled"?: string;
  "kueueViz.frontend.ingress.annotations.nginx.ingress.kubernetes.io/rewrite-target"?: string;
  "kueueViz.frontend.ingress.annotations.nginx.ingress.kubernetes.io/ssl-redirect"?: string;
  "kueueViz.frontend.ingress.ingressClassName"?: string;
  "kueueViz.frontend.ingress.host"?: string;
  "kueueViz.frontend.ingress.tlsSecretName"?: string;
  "kueueViz.frontend.image.repository"?: string;
  "kueueViz.frontend.image.tag"?: string;
  "kueueViz.frontend.image.pullPolicy"?: string;
  "metrics.prometheusNamespace"?: string;
  "metrics.serviceMonitor.tlsConfig.insecureSkipVerify"?: string;
};
