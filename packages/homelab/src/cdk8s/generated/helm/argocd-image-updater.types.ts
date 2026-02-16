// Generated TypeScript types for argocd-image-updater Helm chart

export type ArgocdimageupdaterHelmValuesCrds = {
  /**
   * Install and upgrade CRDs
   *
   * @default true
   */
  install?: boolean;
  /**
   * Keep CRDs on chart uninstall
   *
   * @default true
   */
  keep?: boolean;
  /**
   * Annotations to be added to all CRDs
   *
   * @default {}
   */
  annotations?: ArgocdimageupdaterHelmValuesCrdsAnnotations;
  /**
   * Additional labels to be added to all CRDs
   *
   * @default {}
   */
  additionalLabels?: ArgocdimageupdaterHelmValuesCrdsAdditionalLabels;
};

export type ArgocdimageupdaterHelmValuesCrdsAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdimageupdaterHelmValuesCrdsAdditionalLabels = object;

export type ArgocdimageupdaterHelmValuesImage = {
  /**
   * Default image repository
   *
   * @default "quay.io/argoprojlabs/argocd-image-updater"
   */
  repository?: string;
  /**
   * Default image pull policy
   *
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * Overrides the image tag whose default is the chart appVersion
   *
   * @default ""
   */
  tag?: string;
};

export type ArgocdimageupdaterHelmValuesUpdateStrategy = {
  /**
   * @default "Recreate"
   */
  type?: string;
};

export type ArgocdimageupdaterHelmValuesConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Name of the ConfigMap
   *
   * @default "argocd-image-updater-config"
   */
  name?: string;
  /**
   * Disable kubernetes events
   *
   * @default false
   */
  "kube.events"?: boolean;
  /**
   * Username to use for Git commits
   *
   * @default ""
   */
  "git.user"?: string;
  /**
   * E-Mail address to use for Git commits
   *
   * @default ""
   */
  "git.email"?: string;
  /**
   * Changing the Git commit message
   *
   * @default ""
   */
  "git.commit-message-template"?: string;
  /**
   * Path to public SSH key mounted in container, or GPG key ID used to sign commits
   *
   * @default ""
   */
  "git.commit-signing-key"?: string;
  /**
   * Enables sign off on commits
   *
   * @default false
   */
  "git.commit-sign-off"?: boolean;
  /**
   * Method used to sign Git commits. `openpgp` or `ssh`
   *
   * @default ""
   */
  "git.commit-signing-method"?: string;
  /**
   * Argo CD Image Update log level
   *
   * @default "info"
   */
  "log.level"?: string;
  registries?: unknown[];
  /**
   * Host *
   * PubkeyAcceptedAlgorithms +ssh-rsa
   * HostkeyAlgorithms +ssh-rsa
   * whether to mount authentication scripts, if enabled, the authentication scripts will be mounted on /scripts that can be used to authenticate with registries (Azure, ECR)
   * refer to https://argocd-image-updater.readthedocs.io/en/stable/configuration/registries/#specifying-credentials-for-accessing-container-registries for more info
   *
   * @default {"name":"argocd-image-updater-ssh-config","config":""}
   */
  sshConfig?: ArgocdimageupdaterHelmValuesConfigSshConfig;
};

export type ArgocdimageupdaterHelmValuesConfigSshConfig = {
  /**
   * Name of the sshConfig ConfigMap
   *
   * @default "argocd-image-updater-ssh-config"
   */
  name?: string;
  /**
   * Argo CD Image Updater ssh client parameter configuration
   *
   * @default ""
   */
  config?: string;
};

export type ArgocdimageupdaterHelmValuesAuthScripts = {
  /**
   * Whether to mount the defined scripts that can be used to authenticate with a registry, the scripts will be mounted at `/scripts`
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Name of the authentication scripts ConfigMap
   *
   * @default "argocd-image-updater-authscripts"
   */
  name?: string;
  /**
   * Map of key-value pairs where the key consists of the name of the script and the value the contents.
   * Expect the script to output Docker credentials in the form: <username>:<password>
   * Authentication scripts can be used for various cloud providers like ECR or Azure Workload Identity.
   * For Azure Workload Identity, you can place your authentication script here to handle token acquisition.
   *
   * @default {}
   */
  scripts?: ArgocdimageupdaterHelmValuesAuthScriptsScripts;
};

export type ArgocdimageupdaterHelmValuesAuthScriptsScripts = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdimageupdaterHelmValuesServiceAccount = {
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
  annotations?: ArgocdimageupdaterHelmValuesServiceAccountAnnotations;
  /**
   * Example for Azure Workload Identity:
   * azure.workload.identity/client-id: "xxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   * Labels to add to the service account
   *
   * @default {}
   */
  labels?: ArgocdimageupdaterHelmValuesServiceAccountLabels;
  /**
   * Example for Azure Workload Identity:
   * azure.workload.identity/use: "true"
   * The name of the service account to use.
   * If not set and create is true, a name is generated using the fullname template.
   *
   * @default ""
   */
  name?: string;
};

export type ArgocdimageupdaterHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdimageupdaterHelmValuesServiceAccountLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdimageupdaterHelmValuesPodAnnotations = object;

export type ArgocdimageupdaterHelmValuesPodLabels = object;

export type ArgocdimageupdaterHelmValuesPodSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
};

export type ArgocdimageupdaterHelmValuesSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ArgocdimageupdaterHelmValuesSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdimageupdaterHelmValuesSecurityContextSeccompProfile;
};

export type ArgocdimageupdaterHelmValuesSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdimageupdaterHelmValuesSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdimageupdaterHelmValuesRbac = {
  /**
   * Enable RBAC creation
   *
   * @default true
   */
  enabled?: boolean;
};

export type ArgocdimageupdaterHelmValuesResources = object;

export type ArgocdimageupdaterHelmValuesNodeSelector = object;

export type ArgocdimageupdaterHelmValuesAffinity = object;

export type ArgocdimageupdaterHelmValuesMetrics = {
  /**
   * Deploy metrics service
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"annotations":{},"labels":{},"servicePort":8443}
   */
  service?: ArgocdimageupdaterHelmValuesMetricsService;
  /**
   * @default {...} (7 keys)
   */
  serviceMonitor?: ArgocdimageupdaterHelmValuesMetricsServiceMonitor;
};

export type ArgocdimageupdaterHelmValuesMetricsService = {
  /**
   * Metrics service annotations
   *
   * @default {}
   */
  annotations?: ArgocdimageupdaterHelmValuesMetricsServiceAnnotations;
  /**
   * Metrics service labels
   *
   * @default {}
   */
  labels?: ArgocdimageupdaterHelmValuesMetricsServiceLabels;
  /**
   * Metrics service port
   *
   * @default 8443
   */
  servicePort?: number;
};

export type ArgocdimageupdaterHelmValuesMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdimageupdaterHelmValuesMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdimageupdaterHelmValuesMetricsServiceMonitor = {
  /**
   * Enable a prometheus ServiceMonitor
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Prometheus ServiceMonitor interval
   *
   * @default "30s"
   */
  interval?: string;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
  /**
   * Prometheus ServiceMonitor selector
   *
   * @default {}
   */
  selector?: ArgocdimageupdaterHelmValuesMetricsServiceMonitorSelector;
  /**
   * Prometheus ServiceMonitor namespace
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Prometheus ServiceMonitor labels
   *
   * @default {}
   */
  additionalLabels?: ArgocdimageupdaterHelmValuesMetricsServiceMonitorAdditionalLabels;
};

export type ArgocdimageupdaterHelmValuesMetricsServiceMonitorSelector = object;

export type ArgocdimageupdaterHelmValuesMetricsServiceMonitorAdditionalLabels = object;

export type ArgocdimageupdaterHelmValuesContainerPorts = {
  /**
   * Port for the webhook events
   *
   * @default 8082
   */
  webhook?: number;
  /**
   * Port for the probe endpoint
   *
   * @default 8081
   */
  health?: number;
  /**
   * Port for the metrics
   *
   * @default 8443
   */
  metrics?: number;
};

export type ArgocdimageupdaterHelmValuesService = {
  /**
   * Service annotations
   *
   * @default {}
   */
  annotations?: ArgocdimageupdaterHelmValuesServiceAnnotations;
  /**
   * Service labels
   *
   * @default {}
   */
  labels?: ArgocdimageupdaterHelmValuesServiceLabels;
  /**
   * Service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Service http port for NodePort service type (only if `service.type` is set to "NodePort")
   *
   * @default 30080
   */
  nodePortHttp?: number;
  /**
   * Service https port for NodePort service type (only if `service.type` is set to "NodePort")
   *
   * @default 30443
   */
  nodePortHttps?: number;
  /**
   * Service http port
   *
   * @default 8080
   */
  port?: number;
  /**
   * Service http port name, can be used to route traffic via istio
   *
   * @default "server-port"
   */
  servicePortHttpName?: string;
  /**
   * The class of the load balancer implementation
   *
   * @default ""
   */
  loadBalancerClass?: string;
  /**
   * LoadBalancer will get created with the IP specified in this field
   *
   * @default ""
   */
  loadBalancerIP?: string;
  loadBalancerSourceRanges?: unknown[];
  externalIPs?: unknown[];
  /**
   * Denotes if this Service desires to route external traffic to node-local or cluster-wide endpoints
   * Ref: https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/#preserving-the-client-source-ip
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * Used to maintain session affinity. Supports `ClientIP` and `None`
   * Ref: https://kubernetes.io/docs/concepts/services-networking/service/#virtual-ips-and-service-proxies
   *
   * @default "None"
   */
  sessionAffinity?: string;
};

export type ArgocdimageupdaterHelmValuesServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdimageupdaterHelmValuesServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdimageupdaterHelmValuesIngress = {
  /**
   * Enable an ingress resource for the deployment
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional ingress labels
   *
   * @default {}
   */
  labels?: ArgocdimageupdaterHelmValuesIngressLabels;
  /**
   * Additional ingress annotations
   *
   * @default {}
   */
  annotations?: ArgocdimageupdaterHelmValuesIngressAnnotations;
  /**
   * Defines which ingress controller will implement the resource
   *
   * @default ""
   */
  ingressClassName?: string;
  /**
   * deployment hostname
   *
   * @default ""
   */
  hostname?: string;
  /**
   * The path to deployment
   *
   * @default "/webhook"
   */
  path?: string;
  /**
   * Ingress path type. One of `Exact`, `Prefix` or `ImplementationSpecific`
   *
   * @default "Prefix"
   */
  pathType?: string;
  extraHosts?: unknown[];
  extraPaths?: unknown[];
  tls?: unknown[];
};

export type ArgocdimageupdaterHelmValuesIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdimageupdaterHelmValuesIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdimageupdaterHelmValuesDualStack = {
  /**
   * IP family policy to configure dual-stack see [Configure dual-stack](https://kubernetes.io/docs/concepts/services-networking/dual-stack/#services)
   *
   * @default ""
   */
  ipFamilyPolicy?: string;
  ipFamilies?: unknown[];
};

export type ArgocdimageupdaterHelmValues = {
  /**
   * Custom resource configuration
   *
   * @default {...} (4 keys)
   */
  crds?: ArgocdimageupdaterHelmValuesCrds;
  /**
   * Replica count for the deployment. It is not advised to run more than one replica.
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * @default {"repository":"quay.io/argoprojlabs/argocd-image-updater","pullPolicy":"Always","tag":""}
   */
  image?: ArgocdimageupdaterHelmValuesImage;
  /**
   * The deployment strategy to use to replace existing pods with new ones
   *
   * @default {"type":"Recreate"}
   */
  updateStrategy?: ArgocdimageupdaterHelmValuesUpdateStrategy;
  imagePullSecrets?: unknown[];
  /**
   * Global name (argocd-image-updater.name in _helpers.tpl) override
   *
   * @default ""
   */
  nameOverride?: string;
  /**
   * Global fullname (argocd-image-updater.fullname in _helpers.tpl) override
   *
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * Global namespace (argocd-image-updater.namespace in _helpers.tpl) override
   *
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * Create cluster roles for cluster-wide installation.
   * Used when you manage applications in the same cluster where Argo CD Image Updater runs.
   * If you want to use this, please set `.Values.rbac.enabled` true as well.
   *
   * @default true
   */
  createClusterRoles?: boolean;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraObjects?: unknown[];
  initContainers?: unknown[];
  /**
   * Priority class for the deployment
   *
   * @default ""
   */
  priorityClassName?: string;
  volumeMounts?: unknown[];
  volumes?: unknown[];
  /**
   * Argo CD Image Updater ssh client parameter configuration
   *
   * @default {...} (11 keys)
   */
  config?: ArgocdimageupdaterHelmValuesConfig;
  /**
   * !/bin/sh
   * Example script for Azure Workload Identity.
   * This script would typically use environment variables set by the workload identity
   * to acquire an Azure AD token and authenticate with Azure Container Registry (ACR).
   * It should output the Docker username and password on stdout, e.g., '00000000-0000-0000-0000-000000000000:<token>'
   *
   * @default {"enabled":false,"name":"argocd-image-updater-authscripts","scripts":{}}
   */
  authScripts?: ArgocdimageupdaterHelmValuesAuthScripts;
  /**
   * @default {...} (4 keys)
   */
  serviceAccount?: ArgocdimageupdaterHelmValuesServiceAccount;
  /**
   * Pod Annotations for the deployment
   *
   * @default {}
   */
  podAnnotations?: ArgocdimageupdaterHelmValuesPodAnnotations;
  /**
   * Pod Labels for the deployment
   * azure.workload.identity/use: "true"
   *
   * @default {}
   */
  podLabels?: ArgocdimageupdaterHelmValuesPodLabels;
  /**
   * Pod security context settings for the deployment
   *
   * @default {"runAsNonRoot":true}
   */
  podSecurityContext?: ArgocdimageupdaterHelmValuesPodSecurityContext;
  /**
   * Security context settings for the deployment
   *
   * @default {...} (5 keys)
   */
  securityContext?: ArgocdimageupdaterHelmValuesSecurityContext;
  /**
   * @default {"enabled":true}
   */
  rbac?: ArgocdimageupdaterHelmValuesRbac;
  /**
   * Pod memory and cpu resource settings for the deployment
   *
   * @default {}
   */
  resources?: ArgocdimageupdaterHelmValuesResources;
  /**
   * Kubernetes nodeSelector settings for the deployment
   *
   * @default {}
   */
  nodeSelector?: ArgocdimageupdaterHelmValuesNodeSelector;
  tolerations?: unknown[];
  /**
   * Kubernetes affinity settings for the deployment
   *
   * @default {}
   */
  affinity?: ArgocdimageupdaterHelmValuesAffinity;
  /**
   * Metrics configuration
   *
   * @default {"enabled":false,"service":{"annotations":{},"labels":{},"servicePort":8443},"serviceMonitor":{"enabled":false,"interval":"30s","relabelings":[],"metricRelabelings":[],"selector":{},"namespace":"","additionalLabels":{}}}
   */
  metrics?: ArgocdimageupdaterHelmValuesMetrics;
  /**
   * @default {"webhook":8082,"health":8081,"metrics":8443}
   */
  containerPorts?: ArgocdimageupdaterHelmValuesContainerPorts;
  /**
   * Service configuration
   *
   * @default {...} (13 keys)
   */
  service?: ArgocdimageupdaterHelmValuesService;
  /**
   * Ingress for the deployment
   *
   * @default {...} (10 keys)
   */
  ingress?: ArgocdimageupdaterHelmValuesIngress;
  /**
   * Configure dual-stack
   *
   * @default {"ipFamilyPolicy":"","ipFamilies":[]}
   */
  dualStack?: ArgocdimageupdaterHelmValuesDualStack;
};

export type ArgocdimageupdaterHelmParameters = {
  "crds.install"?: string;
  "crds.keep"?: string;
  replicaCount?: string;
  "image.repository"?: string;
  "image.pullPolicy"?: string;
  "image.tag"?: string;
  "updateStrategy.type"?: string;
  imagePullSecrets?: string;
  nameOverride?: string;
  fullnameOverride?: string;
  namespaceOverride?: string;
  createClusterRoles?: string;
  extraArgs?: string;
  extraEnv?: string;
  extraEnvFrom?: string;
  extraObjects?: string;
  initContainers?: string;
  priorityClassName?: string;
  volumeMounts?: string;
  volumes?: string;
  "config.name"?: string;
  "config.kube.events"?: string;
  "config.git.user"?: string;
  "config.git.email"?: string;
  "config.git.commit-message-template"?: string;
  "config.git.commit-signing-key"?: string;
  "config.git.commit-sign-off"?: string;
  "config.git.commit-signing-method"?: string;
  "config.log.level"?: string;
  "config.registries"?: string;
  "config.sshConfig.name"?: string;
  "config.sshConfig.config"?: string;
  "authScripts.enabled"?: string;
  "authScripts.name"?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "podSecurityContext.runAsNonRoot"?: string;
  "securityContext.allowPrivilegeEscalation"?: string;
  "securityContext.capabilities.drop"?: string;
  "securityContext.readOnlyRootFilesystem"?: string;
  "securityContext.runAsNonRoot"?: string;
  "securityContext.seccompProfile.type"?: string;
  "rbac.enabled"?: string;
  tolerations?: string;
  "metrics.enabled"?: string;
  "metrics.service.servicePort"?: string;
  "metrics.serviceMonitor.enabled"?: string;
  "metrics.serviceMonitor.interval"?: string;
  "metrics.serviceMonitor.relabelings"?: string;
  "metrics.serviceMonitor.metricRelabelings"?: string;
  "metrics.serviceMonitor.namespace"?: string;
  "containerPorts.webhook"?: string;
  "containerPorts.health"?: string;
  "containerPorts.metrics"?: string;
  "service.type"?: string;
  "service.nodePortHttp"?: string;
  "service.nodePortHttps"?: string;
  "service.port"?: string;
  "service.servicePortHttpName"?: string;
  "service.loadBalancerClass"?: string;
  "service.loadBalancerIP"?: string;
  "service.loadBalancerSourceRanges"?: string;
  "service.externalIPs"?: string;
  "service.externalTrafficPolicy"?: string;
  "service.sessionAffinity"?: string;
  "ingress.enabled"?: string;
  "ingress.ingressClassName"?: string;
  "ingress.hostname"?: string;
  "ingress.path"?: string;
  "ingress.pathType"?: string;
  "ingress.extraHosts"?: string;
  "ingress.extraPaths"?: string;
  "ingress.tls"?: string;
  "dualStack.ipFamilyPolicy"?: string;
  "dualStack.ipFamilies"?: string;
};
