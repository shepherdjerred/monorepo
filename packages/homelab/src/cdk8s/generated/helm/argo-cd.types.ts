// Generated TypeScript types for argo-cd Helm chart

export type ArgocdHelmValuesApiVersionOverrides = object;

export type ArgocdHelmValuesOpenshift = {
  /**
   * enables using arbitrary uid for argo repo server
   *
   * @default false
   */
  enabled?: boolean;
};

export type ArgocdHelmValuesCrds = {
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
  annotations?: ArgocdHelmValuesCrdsAnnotations;
  /**
   * Additional labels to be added to all CRDs
   *
   * @default {}
   */
  additionalLabels?: ArgocdHelmValuesCrdsAdditionalLabels;
};

export type ArgocdHelmValuesCrdsAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesCrdsAdditionalLabels = object;

export type ArgocdHelmValuesGlobal = {
  /**
   * Default domain used by all components
   * Used for ingresses, certificates, SSO, notifications, etc.
   *
   * @default "argocd.example.com"
   */
  domain?: string;
  /**
   * Runtime class name for all components
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * Common labels for the all resources
   *
   * @default {}
   */
  additionalLabels?: ArgocdHelmValuesGlobalAdditionalLabels;
  /**
   * Number of old deployment ReplicaSets to retain. The rest will be garbage collected.
   *
   * @default 3
   */
  revisionHistoryLimit?: number;
  /**
   * Default image used by all components
   *
   * @default {"repository":"quay.io/argoproj/argocd","tag":"","imagePullPolicy":"IfNotPresent"}
   */
  image?: ArgocdHelmValuesGlobalImage;
  imagePullSecrets?: unknown[];
  /**
   * Default logging options used by all components
   *
   * @default {"format":"text","level":"info"}
   */
  logging?: ArgocdHelmValuesGlobalLogging;
  /**
   * Annotations for the all deployed Statefulsets
   *
   * @default {}
   */
  statefulsetAnnotations?: ArgocdHelmValuesGlobalStatefulsetAnnotations;
  /**
   * Annotations for the all deployed Deployments
   *
   * @default {}
   */
  deploymentAnnotations?: ArgocdHelmValuesGlobalDeploymentAnnotations;
  /**
   * Labels for the all deployed Deployments
   *
   * @default {}
   */
  deploymentLabels?: ArgocdHelmValuesGlobalDeploymentLabels;
  /**
   * Annotations for the all deployed pods
   *
   * @default {}
   */
  podAnnotations?: ArgocdHelmValuesGlobalPodAnnotations;
  /**
   * Labels for the all deployed pods
   *
   * @default {}
   */
  podLabels?: ArgocdHelmValuesGlobalPodLabels;
  /**
   * Add Prometheus scrape annotations to all metrics services. This can be used as an alternative to the ServiceMonitors.
   *
   * @default false
   */
  addPrometheusAnnotations?: boolean;
  /**
   * Toggle and define pod-level security context.
   *
   * @default {}
   */
  securityContext?: ArgocdHelmValuesGlobalSecurityContext;
  hostAliases?: unknown[];
  /**
   * Configure dual-stack used by all component services
   *
   * @default {"ipFamilyPolicy":"","ipFamilies":[]}
   */
  dualStack?: ArgocdHelmValuesGlobalDualStack;
  /**
   * Default network policy rules used by all components
   *
   * @default {"create":false,"defaultDenyIngress":false}
   */
  networkPolicy?: ArgocdHelmValuesGlobalNetworkPolicy;
  /**
   * Default priority class for all components
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Default node selector for all components
   *
   * @default {"kubernetes.io/os":"linux"}
   */
  nodeSelector?: ArgocdHelmValuesGlobalNodeSelector;
  tolerations?: unknown[];
  /**
   * Default affinity preset for all components
   *
   * @default {"podAntiAffinity":"soft","nodeAffinity":{"type":"hard","matchExpressions":[]}}
   */
  affinity?: ArgocdHelmValuesGlobalAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Deployment strategy for the all deployed Deployments
   *
   * @default {}
   */
  deploymentStrategy?: ArgocdHelmValuesGlobalDeploymentStrategy;
  env?: unknown[];
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  /**
   * Example of adding a custom CA bundle mount:
   * Annotations for the all deployed Certificates
   *
   * @default {}
   */
  certificateAnnotations?: ArgocdHelmValuesGlobalCertificateAnnotations;
};

export type ArgocdHelmValuesGlobalAdditionalLabels = object;

export type ArgocdHelmValuesGlobalImage = {
  /**
   * If defined, a repository applied to all Argo CD deployments
   *
   * @default "quay.io/argoproj/argocd"
   */
  repository?: string;
  /**
   * Overrides the global Argo CD image tag whose default is the chart appVersion
   *
   * @default ""
   */
  tag?: string;
  /**
   * If defined, a imagePullPolicy applied to all Argo CD deployments
   *
   * @default "IfNotPresent"
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesGlobalLogging = {
  /**
   * Set the global logging format. Either: `text` or `json`
   *
   * @default "text"
   */
  format?: string;
  /**
   * Set the global logging level. One of: `debug`, `info`, `warn` or `error`
   *
   * @default "info"
   */
  level?: string;
};

export type ArgocdHelmValuesGlobalStatefulsetAnnotations = object;

export type ArgocdHelmValuesGlobalDeploymentAnnotations = object;

export type ArgocdHelmValuesGlobalDeploymentLabels = object;

export type ArgocdHelmValuesGlobalPodAnnotations = object;

export type ArgocdHelmValuesGlobalPodLabels = object;

export type ArgocdHelmValuesGlobalSecurityContext = object;

export type ArgocdHelmValuesGlobalDualStack = {
  /**
   * IP family policy to configure dual-stack see [Configure dual-stack](https://kubernetes.io/docs/concepts/services-networking/dual-stack/#services)
   *
   * @default ""
   */
  ipFamilyPolicy?: string;
  ipFamilies?: unknown[];
};

export type ArgocdHelmValuesGlobalNetworkPolicy = {
  /**
   * Create NetworkPolicy objects for all components
   *
   * @default false
   */
  create?: boolean;
  /**
   * Default deny all ingress traffic
   *
   * @default false
   */
  defaultDenyIngress?: boolean;
};

export type ArgocdHelmValuesGlobalNodeSelector = {
  /**
   * @default "linux"
   */
  "kubernetes.io/os"?: string;
};

export type ArgocdHelmValuesGlobalAffinity = {
  /**
   * Default pod anti-affinity rules. Either: `none`, `soft` or `hard`
   *
   * @default "soft"
   */
  podAntiAffinity?: string;
  /**
   * Node affinity rules
   *
   * @default {"type":"hard","matchExpressions":[]}
   */
  nodeAffinity?: ArgocdHelmValuesGlobalAffinityNodeAffinity;
};

export type ArgocdHelmValuesGlobalAffinityNodeAffinity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Default node affinity rules. Either: `none`, `soft` or `hard`
   *
   * @default "hard"
   */
  type?: string;
  matchExpressions?: unknown[];
};

export type ArgocdHelmValuesGlobalDeploymentStrategy = object;

export type ArgocdHelmValuesGlobalCertificateAnnotations = object;

export type ArgocdHelmValuesConfigs = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * General Argo CD configuration. Any values you put under `.configs.cm` are passed to argocd-cm ConfigMap.
   * Ref: https://github.com/argoproj/argo-cd/blob/master/docs/operator-manual/argocd-cm.yaml
   *
   * @default {...} (18 keys)
   */
  cm?: ArgocdHelmValuesConfigsCm;
  /**
   * Ref: https://github.com/argoproj/argo-cd/blob/master/docs/operator-manual/argocd-cmd-params-cm.yaml
   * You can customize parameters by adding parameters here.
   * (e.g.)
   * Ref: https://github.com/argoproj/argo-cd/blob/master/docs/operator-manual/rbac.md
   *
   * @default {"create":true,"annotations":{}}
   */
  params?: ArgocdHelmValuesConfigsParams;
  /**
   * @default {...} (6 keys)
   */
  rbac?: ArgocdHelmValuesConfigsRbac;
  /**
   * GnuPG public keys for commit verification
   * Ref: https://argo-cd.readthedocs.io/en/stable/user-guide/gpg-verification/
   * SSH known hosts for Git repositories
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/#ssh-known-host-public-keys
   *
   * @default {"annotations":{},"keys":{}}
   */
  gpg?: ArgocdHelmValuesConfigsGpg;
  /**
   * @default {...} (4 keys)
   */
  ssh?: ArgocdHelmValuesConfigsSsh;
  /**
   * Repository TLS certificates
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/#repositories-using-self-signed-tls-certificates-or-are-signed-by-custom-ca
   *
   * @default {"annotations":{},"certificates":{},"create":true}
   */
  tls?: ArgocdHelmValuesConfigsTls;
  /**
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/config-management-plugins/
   *
   * @default {"create":false,"annotations":{},"plugins":{}}
   */
  cmp?: ArgocdHelmValuesConfigsCmp;
  /**
   * Provide one or multiple [external cluster credentials]
   *
   * @default {}
   */
  clusterCredentials?: ArgocdHelmValuesConfigsClusterCredentials;
  /**
   * Repository credentials to be used as Templates for other repos
   * Creates a secret for each key/value specified below to create repository credentials
   *
   * @default {}
   */
  credentialTemplates?: ArgocdHelmValuesConfigsCredentialTemplates;
  /**
   * @default {}
   */
  credentialTemplatesAnnotations?: ArgocdHelmValuesConfigsCredentialTemplatesAnnotations;
  /**
   * Repositories list to be used by applications
   * Creates a secret for each key/value specified below to create repositories
   * Note: the last example in the list would use a repository credential template, configured under "configs.credentialTemplates".
   *
   * @default {}
   */
  repositories?: ArgocdHelmValuesConfigsRepositories;
  /**
   * @default {}
   */
  repositoriesAnnotations?: ArgocdHelmValuesConfigsRepositoriesAnnotations;
  /**
   * Argo CD sensitive data
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/user-management/#sensitive-data-and-sso-client-secrets
   *
   * @default {...} (12 keys)
   */
  secret?: ArgocdHelmValuesConfigsSecret;
  /**
   * Define custom [CSS styles] for your argo instance.
   * This setting will automatically mount the provided CSS and reference it in the argo configuration.
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/custom-styles/
   *
   * @default ""
   */
  styles?: string;
};

export type ArgocdHelmValuesConfigsCm = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Create the argocd-cm configmap for [declarative setup]
   *
   * @default true
   */
  create?: boolean;
  /**
   * Annotations to be added to argocd-cm configmap
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesConfigsCmAnnotations;
  /**
   * The name of tracking label used by Argo CD for resource pruning
   *
   * @default "argocd.argoproj.io/instance"
   */
  "application.instanceLabelKey"?: string;
  /**
   * Enable control of the service account used for the sync operation (alpha)
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/app-sync-using-impersonation/
   *
   * @default false
   */
  "application.sync.impersonation.enabled"?: boolean;
  /**
   * Enable exec feature in Argo UI
   * Ref: https://argo-cd.readthedocs.io/en/latest/operator-manual/rbac/#exec-resource
   *
   * @default false
   */
  "exec.enabled"?: boolean;
  /**
   * Enable local admin user
   * Ref: https://argo-cd.readthedocs.io/en/latest/faq/#how-to-disable-admin-user
   *
   * @default true
   */
  "admin.enabled"?: boolean;
  /**
   * Timeout to discover if a new manifests version got published to the repository
   *
   * @default "180s"
   */
  "timeout.reconciliation"?: string;
  /**
   * Timeout to refresh application data as well as target manifests cache
   *
   * @default "0s"
   */
  "timeout.hard.reconciliation"?: string;
  /**
   * Enable Status Badge
   * Ref: https://argo-cd.readthedocs.io/en/stable/user-guide/status-badge/
   *
   * @default false
   */
  "statusbadge.enabled"?: boolean;
  /**
   * Default configuration for ignoreResourceUpdates.
   * The ignoreResourceUpdates list contains K8s resource's properties that are known to be frequently updated
   * by controllers and operators. These resources, when watched by argo, will cause many unnecessary updates.
   * Ignoring status for all resources. An update will still be sent if the status update causes the health to change.
   *
   * @default "jsonPointers:
  - /status
"
   */
  "resource.customizations.ignoreResourceUpdates.all"?: string;
  /**
   * Some Application fields are generated and not related to the application updates itself
   * The Application itself is already watched by the controller lister, but this configuration is applied for apps of apps
   *
   * @default "jqPathExpressions:
  - '.metadata.annotations."..."
   */
  "resource.customizations.ignoreResourceUpdates.argoproj.io_Application"?: string;
  /**
   * Ignore Argo Rollouts generated fields
   *
   * @default "jqPathExpressions:
  - '.metadata.annotations."..."
   */
  "resource.customizations.ignoreResourceUpdates.argoproj.io_Rollout"?: string;
  /**
   * Legacy annotations used on HPA autoscaling/v1
   *
   * @default "jqPathExpressions:
  - '.metadata.annotations."..."
   */
  "resource.customizations.ignoreResourceUpdates.autoscaling_HorizontalPodAutoscaler"?: string;
  /**
   * Ignore the cluster-autoscaler status
   *
   * @default "jqPathExpressions:
  # Ignore the cluster-autos..."
   */
  "resource.customizations.ignoreResourceUpdates.ConfigMap"?: string;
  /**
   * Ignore the common scaling annotations
   *
   * @default "jqPathExpressions:
  - '.metadata.annotations."..."
   */
  "resource.customizations.ignoreResourceUpdates.apps_ReplicaSet"?: string;
  /**
   * Ignores update if EndpointSlice is not excluded globally
   *
   * @default "jsonPointers:
  - /metadata
  - /endpoints
  - ..."
   */
  "resource.customizations.ignoreResourceUpdates.discovery.k8s.io_EndpointSlice"?: string;
  /**
   * Ignores update if Endpoints is not excluded globally
   *
   * @default "jsonPointers:
  - /metadata
  - /subsets
"
   */
  "resource.customizations.ignoreResourceUpdates.Endpoints"?: string;
  /**
   * Default configuration for exclusions.
   * The exclusion list are K8s resources that we assume will never be declared in Git,
   * and are never child objects of managed resources that need to be presented in the resource tree.
   * This list contains high volume and  high churn metadata objects which we exclude for performance
   * reasons, reducing connections and load to the K8s API servers of managed clusters.
   * Resource Exclusion/Inclusion
   *
   * @default "### Network resources created by the Kubernetes..."
   */
  "resource.exclusions"?: string;
};

export type ArgocdHelmValuesConfigsCmAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesConfigsParams = {
  /**
   * Create the argocd-cmd-params-cm configmap
   * If false, it is expected the configmap will be created by something else.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Annotations to be added to the argocd-cmd-params-cm ConfigMap
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesConfigsParamsAnnotations;
};

export type ArgocdHelmValuesConfigsParamsAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesConfigsRbac = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Create the argocd-rbac-cm configmap with ([Argo CD RBAC policy]) definitions.
   * If false, it is expected the configmap will be created by something else.
   * Argo CD will not work if there is no configmap created with the name above.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Annotations to be added to argocd-rbac-cm configmap
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesConfigsRbacAnnotations;
  /**
   * The name of the default role which Argo CD will falls back to, when authorizing API requests (optional).
   * If omitted or empty, users may be still be able to login, but will see no apps, projects, etc...
   *
   * @default ""
   */
  "policy.default"?: string;
  /**
   * File containing user-defined policies and role definitions.
   *
   * @default ""
   */
  "policy.csv"?: string;
  /**
   * Policy rules are in the form:
   * Role definitions and bindings are in the form:
   * OIDC scopes to examine during rbac enforcement (in addition to `sub` scope).
   * The scope value can be a string, or a list of strings.
   *
   * @default "[groups]"
   */
  scopes?: string;
  /**
   * Matcher function for Casbin, `glob` for glob matcher and `regex` for regex matcher.
   *
   * @default "glob"
   */
  "policy.matchMode"?: string;
};

export type ArgocdHelmValuesConfigsRbacAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesConfigsGpg = {
  /**
   * Annotations to be added to argocd-gpg-keys-cm configmap
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesConfigsGpgAnnotations;
  /**
   * [GnuPG] public keys to add to the keyring
   * Note: Public keys should be exported with `gpg --export --armor <KEY>`
   *
   * @default {}
   */
  keys?: ArgocdHelmValuesConfigsGpgKeys;
};

export type ArgocdHelmValuesConfigsGpgAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesConfigsGpgKeys = object;

export type ArgocdHelmValuesConfigsSsh = {
  /**
   * Specifies if the argocd-ssh-known-hosts-cm configmap should be created by Helm.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Annotations to be added to argocd-ssh-known-hosts-cm configmap
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesConfigsSshAnnotations;
  /**
   * Known hosts to be added to the known host list by default.
   *
   * @default "[ssh.github.com]:443 ecdsa-sha2-nistp256 AAAAE2..."
   */
  knownHosts?: string;
  /**
   * Additional known hosts for private repositories
   *
   * @default ""
   */
  extraHosts?: string;
};

export type ArgocdHelmValuesConfigsSshAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesConfigsTls = {
  /**
   * Annotations to be added to argocd-tls-certs-cm configmap
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesConfigsTlsAnnotations;
  /**
   * TLS certificates for Git repositories
   *
   * @default {}
   */
  certificates?: ArgocdHelmValuesConfigsTlsCertificates;
  /**
   * Specifies if the argocd-tls-certs-cm configmap should be created by Helm.
   *
   * @default true
   */
  create?: boolean;
};

export type ArgocdHelmValuesConfigsTlsAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesConfigsTlsCertificates = object;

export type ArgocdHelmValuesConfigsCmp = {
  /**
   * Create the argocd-cmp-cm configmap
   *
   * @default false
   */
  create?: boolean;
  /**
   * Annotations to be added to argocd-cmp-cm configmap
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesConfigsCmpAnnotations;
  /**
   * Plugin yaml files to be added to argocd-cmp-cm
   * - First plugin
   *
   * @default {}
   */
  plugins?: ArgocdHelmValuesConfigsCmpPlugins;
};

export type ArgocdHelmValuesConfigsCmpAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesConfigsCmpPlugins = object;

export type ArgocdHelmValuesConfigsClusterCredentials = object;

export type ArgocdHelmValuesConfigsCredentialTemplates = object;

export type ArgocdHelmValuesConfigsCredentialTemplatesAnnotations = object;

export type ArgocdHelmValuesConfigsRepositories = object;

export type ArgocdHelmValuesConfigsRepositoriesAnnotations = object;

export type ArgocdHelmValuesConfigsSecret = {
  /**
   * Create the argocd-secret
   *
   * @default true
   */
  createSecret?: boolean;
  /**
   * Labels to be added to argocd-secret
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesConfigsSecretLabels;
  /**
   * Annotations to be added to argocd-secret
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesConfigsSecretAnnotations;
  /**
   * Shared secret for authenticating GitHub webhook events
   *
   * @default ""
   */
  githubSecret?: string;
  /**
   * Shared secret for authenticating GitLab webhook events
   *
   * @default ""
   */
  gitlabSecret?: string;
  /**
   * Shared secret for authenticating BitbucketServer webhook events
   *
   * @default ""
   */
  bitbucketServerSecret?: string;
  /**
   * UUID for authenticating Bitbucket webhook events
   *
   * @default ""
   */
  bitbucketUUID?: string;
  /**
   * Shared secret for authenticating Gogs webhook events
   *
   * @default ""
   */
  gogsSecret?: string;
  /**
   * Azure DevOps
   *
   * @default {"username":"","password":""}
   */
  azureDevops?: ArgocdHelmValuesConfigsSecretAzureDevops;
  /**
   * add additional secrets to be added to argocd-secret
   * Custom secrets. Useful for injecting SSO secrets into environment variables.
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/user-management/#sensitive-data-and-sso-client-secrets
   * Note that all values must be non-empty.
   *
   * @default {}
   */
  extra?: ArgocdHelmValuesConfigsSecretExtra;
  /**
   * Bcrypt hashed admin password
   * Argo expects the password in the secret to be bcrypt hashed. You can create this hash with
   * `htpasswd -nbBC 10 "" $ARGO_PWD | tr -d ':\n' | sed 's/$2y/$2a/'`
   *
   * @default ""
   */
  argocdServerAdminPassword?: string;
  /**
   * Admin password modification time. Eg. `"2006-01-02T15:04:05Z"`
   *
   * @default ""
   */
  argocdServerAdminPasswordMtime?: string;
};

export type ArgocdHelmValuesConfigsSecretLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesConfigsSecretAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesConfigsSecretAzureDevops = {
  /**
   * Shared secret username for authenticating Azure DevOps webhook events
   *
   * @default ""
   */
  username?: string;
  /**
   * Shared secret password for authenticating Azure DevOps webhook events
   *
   * @default ""
   */
  password?: string;
};

export type ArgocdHelmValuesConfigsSecretExtra = object;

export type ArgocdHelmValuesController = {
  /**
   * Application controller name string
   *
   * @default "application-controller"
   */
  name?: string;
  /**
   * The number of application controller pods to run.
   * Additional replicas will cause sharding of managed clusters across number of replicas.
   * With dynamic cluster distribution turned on, sharding of the clusters will gracefully
   * rebalance if the number of replica's changes or one becomes unhealthy. (alpha)
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Enable dynamic cluster distribution (alpha)
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/dynamic-cluster-distribution
   * This is done using a deployment instead of a statefulSet
   * When replicas are added or removed, the sharding algorithm is re-run to ensure that the
   * clusters are distributed according to the algorithm. If the algorithm is well-balanced,
   * like round-robin, then the shards will be well-balanced.
   *
   * @default false
   */
  dynamicClusterDistribution?: boolean;
  /**
   * Runtime class name for the application controller
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * Application controller heartbeat time
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/dynamic-cluster-distribution/#working-of-dynamic-distribution
   *
   * @default 10
   */
  heartbeatTime?: number;
  /**
   * Maximum number of controller revisions that will be maintained in StatefulSet history
   *
   * @default 5
   */
  revisionHistoryLimit?: number;
  /**
   * Application controller Pod Disruption Budget
   * Ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {...} (5 keys)
   */
  pdb?: ArgocdHelmValuesControllerPdb;
  /**
   * Application controller Vertical Pod Autoscaler
   * Ref: https://kubernetes.io/docs/concepts/workloads/autoscaling/#scaling-workloads-vertically/
   *
   * @default {...} (5 keys)
   */
  vpa?: ArgocdHelmValuesControllerVpa;
  /**
   * Application controller image
   *
   * @default {"repository":"","tag":"","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesControllerImage;
  imagePullSecrets?: unknown[];
  extraArgs?: unknown[];
  env?: unknown[];
  envFrom?: unknown[];
  extraContainers?: unknown[];
  initContainers?: unknown[];
  volumeMounts?: unknown[];
  volumes?: unknown[];
  /**
   * Application controller emptyDir volumes
   *
   * @default {"sizeLimit":""}
   */
  emptyDir?: ArgocdHelmValuesControllerEmptyDir;
  /**
   * Annotations for the application controller StatefulSet
   *
   * @default {}
   */
  statefulsetAnnotations?: ArgocdHelmValuesControllerStatefulsetAnnotations;
  /**
   * Annotations for the application controller Deployment
   *
   * @default {}
   */
  deploymentAnnotations?: ArgocdHelmValuesControllerDeploymentAnnotations;
  /**
   * Labels for the application controller Deployment
   *
   * @default {}
   */
  deploymentLabels?: ArgocdHelmValuesControllerDeploymentLabels;
  /**
   * Annotations to be added to application controller pods
   *
   * @default {}
   */
  podAnnotations?: ArgocdHelmValuesControllerPodAnnotations;
  /**
   * Labels to be added to application controller pods
   *
   * @default {}
   */
  podLabels?: ArgocdHelmValuesControllerPodLabels;
  /**
   * Resource limits and requests for the application controller pods
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesControllerResources;
  /**
   * Application controller container ports
   *
   * @default {"metrics":8082}
   */
  containerPorts?: ArgocdHelmValuesControllerContainerPorts;
  /**
   * Host Network for application controller pods
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * [DNS configuration]
   *
   * @default {}
   */
  dnsConfig?: ArgocdHelmValuesControllerDnsConfig;
  /**
   * Alternative DNS policy for application controller pods
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Application controller container-level security context
   *
   * @default {...} (5 keys)
   */
  containerSecurityContext?: ArgocdHelmValuesControllerContainerSecurityContext;
  /**
   * Readiness probe for application controller
   * Ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
   *
   * @default {...} (5 keys)
   */
  readinessProbe?: ArgocdHelmValuesControllerReadinessProbe;
  /**
   * terminationGracePeriodSeconds for container lifecycle hook
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Priority class for the application controller pods
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * [Node selector]
   *
   * @default {}
   */
  nodeSelector?: ArgocdHelmValuesControllerNodeSelector;
  tolerations?: unknown[];
  /**
   * Assign custom [affinity] rules to the deployment
   *
   * @default {}
   */
  affinity?: ArgocdHelmValuesControllerAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Automount API credentials for the Service Account into the pod.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: ArgocdHelmValuesControllerServiceAccount;
  /**
   * Application controller metrics configuration
   *
   * @default {...} (6 keys)
   */
  metrics?: ArgocdHelmValuesControllerMetrics;
  /**
   * @default {"enabled":false,"rules":[]}
   */
  clusterRoleRules?: ArgocdHelmValuesControllerClusterRoleRules;
  roleRules?: unknown[];
  /**
   * Default application controller's network policy
   *
   * @default {"create":false}
   */
  networkPolicy?: ArgocdHelmValuesControllerNetworkPolicy;
};

export type ArgocdHelmValuesControllerPdb = {
  /**
   * Deploy a [PodDisruptionBudget] for the application controller
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Labels to be added to application controller pdb
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesControllerPdbLabels;
  /**
   * Annotations to be added to application controller pdb
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesControllerPdbAnnotations;
  /**
   * Number of pods that are available after eviction as number or percentage (eg.: 50%)
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * Number of pods that are unavailable after eviction as number or percentage (eg.: 50%).
   * Has higher precedence over `controller.pdb.minAvailable`
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type ArgocdHelmValuesControllerPdbLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesControllerPdbAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesControllerVpa = {
  /**
   * Deploy a [VerticalPodAutoscaler](https://kubernetes.io/docs/concepts/workloads/autoscaling/#scaling-workloads-vertically/) for the application controller
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Labels to be added to application controller vpa
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesControllerVpaLabels;
  /**
   * Annotations to be added to application controller vpa
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesControllerVpaAnnotations;
  /**
   * @default "Initial"
   */
  updateMode?: string;
  /**
   * Controls how VPA computes the recommended resources for application controller container
   * Ref: https://github.com/kubernetes/autoscaler/blob/master/vertical-pod-autoscaler/examples/hamster.yaml
   *
   * @default {}
   */
  containerPolicy?: ArgocdHelmValuesControllerVpaContainerPolicy;
};

export type ArgocdHelmValuesControllerVpaLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesControllerVpaAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesControllerVpaContainerPolicy = object;

export type ArgocdHelmValuesControllerImage = {
  /**
   * Repository to use for the application controller
   *
   * @default ""
   */
  repository?: string;
  /**
   * Tag to use for the application controller
   *
   * @default ""
   */
  tag?: string;
  /**
   * Image pull policy for the application controller
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesControllerEmptyDir = {
  /**
   * EmptyDir size limit for application controller
   *
   * @default ""
   */
  sizeLimit?: string;
};

export type ArgocdHelmValuesControllerStatefulsetAnnotations = object;

export type ArgocdHelmValuesControllerDeploymentAnnotations = object;

export type ArgocdHelmValuesControllerDeploymentLabels = object;

export type ArgocdHelmValuesControllerPodAnnotations = object;

export type ArgocdHelmValuesControllerPodLabels = object;

export type ArgocdHelmValuesControllerResources = object;

export type ArgocdHelmValuesControllerContainerPorts = {
  /**
   * Metrics container port
   *
   * @default 8082
   */
  metrics?: number;
};

export type ArgocdHelmValuesControllerDnsConfig = object;

export type ArgocdHelmValuesControllerContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdHelmValuesControllerContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ArgocdHelmValuesControllerContainerSecurityContextCapabilities;
};

export type ArgocdHelmValuesControllerContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesControllerContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesControllerReadinessProbe = {
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
};

export type ArgocdHelmValuesControllerNodeSelector = object;

export type ArgocdHelmValuesControllerAffinity = object;

export type ArgocdHelmValuesControllerServiceAccount = {
  /**
   * Create a service account for the application controller
   *
   * @default true
   */
  create?: boolean;
  /**
   * Service account name
   *
   * @default "argocd-application-controller"
   */
  name?: string;
  /**
   * Annotations applied to created service account
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesControllerServiceAccountAnnotations;
  /**
   * Labels applied to created service account
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesControllerServiceAccountLabels;
  /**
   * Automount API credentials for the Service Account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type ArgocdHelmValuesControllerServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesControllerServiceAccountLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesControllerMetrics = {
  /**
   * Deploy metrics service
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Prometheus ServiceMonitor scrapeTimeout. If empty, Prometheus uses the global scrape timeout unless it is less than the target's scrape interval value in which the latter is used.
   *
   * @default ""
   */
  scrapeTimeout?: string;
  /**
   * @default {"enabled":false,"labels":[]}
   */
  applicationLabels?: ArgocdHelmValuesControllerMetricsApplicationLabels;
  /**
   * @default {...} (6 keys)
   */
  service?: ArgocdHelmValuesControllerMetricsService;
  /**
   * @default {...} (11 keys)
   */
  serviceMonitor?: ArgocdHelmValuesControllerMetricsServiceMonitor;
  /**
   * Enable this and set the rules: to whatever custom rules you want for the Cluster Role resource.
   * Defaults to off
   *
   * @default {...} (6 keys)
   */
  rules?: ArgocdHelmValuesControllerMetricsRules;
};

export type ArgocdHelmValuesControllerMetricsApplicationLabels = {
  /**
   * Enables additional labels in argocd_app_labels metric
   *
   * @default false
   */
  enabled?: boolean;
  labels?: unknown[];
};

export type ArgocdHelmValuesControllerMetricsService = {
  /**
   * Metrics service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Metrics service clusterIP. `None` makes a "headless service" (no virtual IP)
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * Metrics service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesControllerMetricsServiceAnnotations;
  /**
   * Metrics service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesControllerMetricsServiceLabels;
  /**
   * Metrics service port
   *
   * @default 8082
   */
  servicePort?: number;
  /**
   * Metrics service port name
   *
   * @default "http-metrics"
   */
  portName?: string;
};

export type ArgocdHelmValuesControllerMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesControllerMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesControllerMetricsServiceMonitor = {
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
  /**
   * When true, honorLabels preserves the metric’s labels when they collide with the target’s labels.
   *
   * @default false
   */
  honorLabels?: boolean;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
  /**
   * Prometheus ServiceMonitor selector
   *
   * @default {}
   */
  selector?: ArgocdHelmValuesControllerMetricsServiceMonitorSelector;
  /**
   * Prometheus ServiceMonitor scheme
   *
   * @default ""
   */
  scheme?: string;
  /**
   * Prometheus ServiceMonitor tlsConfig
   *
   * @default {}
   */
  tlsConfig?: ArgocdHelmValuesControllerMetricsServiceMonitorTlsConfig;
  /**
   * Prometheus ServiceMonitor namespace
   * "monitoring"
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Prometheus ServiceMonitor labels
   *
   * @default {}
   */
  additionalLabels?: ArgocdHelmValuesControllerMetricsServiceMonitorAdditionalLabels;
  /**
   * Prometheus ServiceMonitor annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesControllerMetricsServiceMonitorAnnotations;
};

export type ArgocdHelmValuesControllerMetricsServiceMonitorSelector = object;

export type ArgocdHelmValuesControllerMetricsServiceMonitorTlsConfig = object;

export type ArgocdHelmValuesControllerMetricsServiceMonitorAdditionalLabels = object;

export type ArgocdHelmValuesControllerMetricsServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesControllerMetricsRules = {
  /**
   * Deploy a PrometheusRule for the application controller
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * PrometheusRule namespace
   * "monitoring"
   *
   * @default ""
   */
  namespace?: string;
  /**
   * PrometheusRule selector
   *
   * @default {}
   */
  selector?: ArgocdHelmValuesControllerMetricsRulesSelector;
  /**
   * PrometheusRule labels
   *
   * @default {}
   */
  additionalLabels?: ArgocdHelmValuesControllerMetricsRulesAdditionalLabels;
  /**
   * PrometheusRule annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesControllerMetricsRulesAnnotations;
  spec?: unknown[];
};

export type ArgocdHelmValuesControllerMetricsRulesSelector = object;

export type ArgocdHelmValuesControllerMetricsRulesAdditionalLabels = object;

export type ArgocdHelmValuesControllerMetricsRulesAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesControllerClusterRoleRules = {
  /**
   * Enable custom rules for the application controller's ClusterRole resource
   *
   * @default false
   */
  enabled?: boolean;
  rules?: unknown[];
};

export type ArgocdHelmValuesControllerNetworkPolicy = {
  /**
   * Default network policy rules used by application controller
   *
   * @default false
   */
  create?: boolean;
};

export type ArgocdHelmValuesDex = {
  /**
   * Enable dex
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Dex name
   *
   * @default "dex-server"
   */
  name?: string;
  extraArgs?: unknown[];
  /**
   * Runtime class name for Dex
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * @default {"enabled":false,"service":{"annotations":{},"labels":{},"portName":"http-metrics"},"serviceMonitor":{"enabled":false,"interval":"30s","honorLabels":false,"relabelings":[],"metricRelabelings":[],"selector":{},"scheme":"","tlsConfig":{},"namespace":"","additionalLabels":{},"annotations":{}}}
   */
  metrics?: ArgocdHelmValuesDexMetrics;
  /**
   * Dex Pod Disruption Budget
   * Ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {...} (5 keys)
   */
  pdb?: ArgocdHelmValuesDexPdb;
  /**
   * Dex image
   *
   * @default {"repository":"ghcr.io/dexidp/dex","tag":"v2.44.0","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesDexImage;
  imagePullSecrets?: unknown[];
  /**
   * Argo CD init image that creates Dex config
   *
   * @default {...} (4 keys)
   */
  initImage?: ArgocdHelmValuesDexInitImage;
  env?: unknown[];
  envFrom?: unknown[];
  extraContainers?: unknown[];
  initContainers?: unknown[];
  volumeMounts?: unknown[];
  volumes?: unknown[];
  /**
   * Dex server emptyDir volumes
   *
   * @default {"sizeLimit":""}
   */
  emptyDir?: ArgocdHelmValuesDexEmptyDir;
  /**
   * @default {...} (6 keys)
   */
  certificateSecret?: ArgocdHelmValuesDexCertificateSecret;
  /**
   * Annotations to be added to the Dex server Deployment
   *
   * @default {}
   */
  deploymentAnnotations?: ArgocdHelmValuesDexDeploymentAnnotations;
  /**
   * Labels for the Dex server Deployment
   *
   * @default {}
   */
  deploymentLabels?: ArgocdHelmValuesDexDeploymentLabels;
  /**
   * Annotations to be added to the Dex server pods
   *
   * @default {}
   */
  podAnnotations?: ArgocdHelmValuesDexPodAnnotations;
  /**
   * Labels to be added to the Dex server pods
   *
   * @default {}
   */
  podLabels?: ArgocdHelmValuesDexPodLabels;
  /**
   * Resource limits and requests for dex
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesDexResources;
  /**
   * Dex container ports
   * NOTE: These ports are currently hardcoded and cannot be changed
   *
   * @default {"http":5556,"grpc":5557,"metrics":5558}
   */
  containerPorts?: ArgocdHelmValuesDexContainerPorts;
  /**
   * [DNS configuration]
   *
   * @default {}
   */
  dnsConfig?: ArgocdHelmValuesDexDnsConfig;
  /**
   * Alternative DNS policy for Dex server pods
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Dex container-level security context
   *
   * @default {...} (5 keys)
   */
  containerSecurityContext?: ArgocdHelmValuesDexContainerSecurityContext;
  /**
   * Probes for Dex server
   * Supported from Dex >= 2.28.0
   *
   * @default {...} (9 keys)
   */
  livenessProbe?: ArgocdHelmValuesDexLivenessProbe;
  /**
   * @default {...} (9 keys)
   */
  readinessProbe?: ArgocdHelmValuesDexReadinessProbe;
  /**
   * terminationGracePeriodSeconds for container lifecycle hook
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Automount API credentials for the Service Account into the pod.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default {...} (4 keys)
   */
  serviceAccount?: ArgocdHelmValuesDexServiceAccount;
  /**
   * Service port for HTTP access
   *
   * @default 5556
   */
  servicePortHttp?: number;
  /**
   * Service port name for HTTP access
   *
   * @default "http"
   */
  servicePortHttpName?: string;
  /**
   * Service port for gRPC access
   *
   * @default 5557
   */
  servicePortGrpc?: number;
  /**
   * Service port name for gRPC access
   *
   * @default "grpc"
   */
  servicePortGrpcName?: string;
  /**
   * Service port for metrics access
   *
   * @default 5558
   */
  servicePortMetrics?: number;
  /**
   * Priority class for the dex pods
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * [Node selector]
   *
   * @default {}
   */
  nodeSelector?: ArgocdHelmValuesDexNodeSelector;
  tolerations?: unknown[];
  /**
   * Assign custom [affinity] rules to the deployment
   *
   * @default {}
   */
  affinity?: ArgocdHelmValuesDexAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Deployment strategy to be added to the Dex server Deployment
   *
   * @default {}
   */
  deploymentStrategy?: ArgocdHelmValuesDexDeploymentStrategy;
  /**
   * Default Dex server's network policy
   *
   * @default {"create":false}
   */
  networkPolicy?: ArgocdHelmValuesDexNetworkPolicy;
};

export type ArgocdHelmValuesDexMetrics = {
  /**
   * Deploy metrics service
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"annotations":{},"labels":{},"portName":"http-metrics"}
   */
  service?: ArgocdHelmValuesDexMetricsService;
  /**
   * @default {...} (11 keys)
   */
  serviceMonitor?: ArgocdHelmValuesDexMetricsServiceMonitor;
};

export type ArgocdHelmValuesDexMetricsService = {
  /**
   * Metrics service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesDexMetricsServiceAnnotations;
  /**
   * Metrics service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesDexMetricsServiceLabels;
  /**
   * Metrics service port name
   *
   * @default "http-metrics"
   */
  portName?: string;
};

export type ArgocdHelmValuesDexMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesDexMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesDexMetricsServiceMonitor = {
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
  /**
   * When true, honorLabels preserves the metric’s labels when they collide with the target’s labels.
   *
   * @default false
   */
  honorLabels?: boolean;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
  /**
   * Prometheus ServiceMonitor selector
   *
   * @default {}
   */
  selector?: ArgocdHelmValuesDexMetricsServiceMonitorSelector;
  /**
   * Prometheus ServiceMonitor scheme
   *
   * @default ""
   */
  scheme?: string;
  /**
   * Prometheus ServiceMonitor tlsConfig
   *
   * @default {}
   */
  tlsConfig?: ArgocdHelmValuesDexMetricsServiceMonitorTlsConfig;
  /**
   * Prometheus ServiceMonitor namespace
   * "monitoring"
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Prometheus ServiceMonitor labels
   *
   * @default {}
   */
  additionalLabels?: ArgocdHelmValuesDexMetricsServiceMonitorAdditionalLabels;
  /**
   * Prometheus ServiceMonitor annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesDexMetricsServiceMonitorAnnotations;
};

export type ArgocdHelmValuesDexMetricsServiceMonitorSelector = object;

export type ArgocdHelmValuesDexMetricsServiceMonitorTlsConfig = object;

export type ArgocdHelmValuesDexMetricsServiceMonitorAdditionalLabels = object;

export type ArgocdHelmValuesDexMetricsServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesDexPdb = {
  /**
   * Deploy a [PodDisruptionBudget] for the Dex server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Labels to be added to Dex server pdb
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesDexPdbLabels;
  /**
   * Annotations to be added to Dex server pdb
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesDexPdbAnnotations;
  /**
   * Number of pods that are available after eviction as number or percentage (eg.: 50%)
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * Number of pods that are unavailble after eviction as number or percentage (eg.: 50%).
   * Has higher precedence over `dex.pdb.minAvailable`
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type ArgocdHelmValuesDexPdbLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesDexPdbAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesDexImage = {
  /**
   * Dex image repository
   *
   * @default "ghcr.io/dexidp/dex"
   */
  repository?: string;
  /**
   * Dex image tag
   *
   * @default "v2.44.0"
   */
  tag?: string;
  /**
   * Dex imagePullPolicy
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesDexInitImage = {
  /**
   * Argo CD init image repository
   *
   * @default ""
   */
  repository?: string;
  /**
   * Argo CD init image tag
   *
   * @default ""
   */
  tag?: string;
  /**
   * Argo CD init image imagePullPolicy
   *
   * @default ""
   */
  imagePullPolicy?: string;
  /**
   * Argo CD init image resources
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesDexInitImageResources;
};

export type ArgocdHelmValuesDexInitImageResources = object;

export type ArgocdHelmValuesDexEmptyDir = {
  /**
   * EmptyDir size limit for Dex server
   *
   * @default ""
   */
  sizeLimit?: string;
};

export type ArgocdHelmValuesDexCertificateSecret = {
  /**
   * Create argocd-dex-server-tls secret
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Labels to be added to argocd-dex-server-tls secret
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesDexCertificateSecretLabels;
  /**
   * Annotations to be added to argocd-dex-server-tls secret
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesDexCertificateSecretAnnotations;
  /**
   * Certificate authority. Required for self-signed certificates.
   *
   * @default ""
   */
  ca?: string;
  /**
   * Certificate private key
   *
   * @default ""
   */
  key?: string;
  /**
   * Certificate data. Must contain SANs of Dex service (ie: argocd-dex-server, argocd-dex-server.argo-cd.svc)
   *
   * @default ""
   */
  crt?: string;
};

export type ArgocdHelmValuesDexCertificateSecretLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesDexCertificateSecretAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesDexDeploymentAnnotations = object;

export type ArgocdHelmValuesDexDeploymentLabels = object;

export type ArgocdHelmValuesDexPodAnnotations = object;

export type ArgocdHelmValuesDexPodLabels = object;

export type ArgocdHelmValuesDexResources = object;

export type ArgocdHelmValuesDexContainerPorts = {
  /**
   * HTTP container port
   *
   * @default 5556
   */
  http?: number;
  /**
   * gRPC container port
   *
   * @default 5557
   */
  grpc?: number;
  /**
   * Metrics container port
   *
   * @default 5558
   */
  metrics?: number;
};

export type ArgocdHelmValuesDexDnsConfig = object;

export type ArgocdHelmValuesDexContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdHelmValuesDexContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ArgocdHelmValuesDexContainerSecurityContextCapabilities;
};

export type ArgocdHelmValuesDexContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesDexContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesDexLivenessProbe = {
  /**
   * Enable Kubernetes liveness probe for Dex >= 2.28.0
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Http path to use for the liveness probe
   *
   * @default "/healthz/live"
   */
  httpPath?: string;
  /**
   * Http port to use for the liveness probe
   *
   * @default "metrics"
   */
  httpPort?: string;
  /**
   * Scheme to use for for the liveness probe (can be HTTP or HTTPS)
   *
   * @default "HTTP"
   */
  httpScheme?: string;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
};

export type ArgocdHelmValuesDexReadinessProbe = {
  /**
   * Enable Kubernetes readiness probe for Dex >= 2.28.0
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Http path to use for the readiness probe
   *
   * @default "/healthz/ready"
   */
  httpPath?: string;
  /**
   * Http port to use for the readiness probe
   *
   * @default "metrics"
   */
  httpPort?: string;
  /**
   * Scheme to use for for the liveness probe (can be HTTP or HTTPS)
   *
   * @default "HTTP"
   */
  httpScheme?: string;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
};

export type ArgocdHelmValuesDexServiceAccount = {
  /**
   * Create dex service account
   *
   * @default true
   */
  create?: boolean;
  /**
   * Dex service account name
   *
   * @default "argocd-dex-server"
   */
  name?: string;
  /**
   * Annotations applied to created service account
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesDexServiceAccountAnnotations;
  /**
   * Automount API credentials for the Service Account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type ArgocdHelmValuesDexServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesDexNodeSelector = object;

export type ArgocdHelmValuesDexAffinity = object;

export type ArgocdHelmValuesDexDeploymentStrategy = object;

export type ArgocdHelmValuesDexNetworkPolicy = {
  /**
   * Default network policy rules used by Dex server
   *
   * @default false
   */
  create?: boolean;
};

export type ArgocdHelmValuesRedis = {
  /**
   * Enable redis
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Redis name
   *
   * @default "redis"
   */
  name?: string;
  /**
   * Runtime class name for redis
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * Redis Pod Disruption Budget
   * Ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {...} (5 keys)
   */
  pdb?: ArgocdHelmValuesRedisPdb;
  /**
   * Redis image
   *
   * @default {"repository":"ecr-public.aws.com/docker/library/redis","tag":"8.2.2-alpine","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesRedisImage;
  /**
   * Prometheus redis-exporter sidecar
   *
   * @default {...} (7 keys)
   */
  exporter?: ArgocdHelmValuesRedisExporter;
  imagePullSecrets?: unknown[];
  extraArgs?: unknown[];
  env?: unknown[];
  envFrom?: unknown[];
  /**
   * Probes for Redis server (optional)
   * Ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: ArgocdHelmValuesRedisReadinessProbe;
  /**
   * @default {...} (6 keys)
   */
  livenessProbe?: ArgocdHelmValuesRedisLivenessProbe;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  volumeMounts?: unknown[];
  volumes?: unknown[];
  /**
   * Annotations to be added to the Redis server Deployment
   *
   * @default {}
   */
  deploymentAnnotations?: ArgocdHelmValuesRedisDeploymentAnnotations;
  /**
   * Labels for the Redis server Deployment
   *
   * @default {}
   */
  deploymentLabels?: ArgocdHelmValuesRedisDeploymentLabels;
  /**
   * Annotations to be added to the Redis server pods
   *
   * @default {}
   */
  podAnnotations?: ArgocdHelmValuesRedisPodAnnotations;
  /**
   * Labels to be added to the Redis server pods
   *
   * @default {}
   */
  podLabels?: ArgocdHelmValuesRedisPodLabels;
  /**
   * Resource limits and requests for redis
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesRedisResources;
  /**
   * Redis pod-level security context
   *
   * @default {"runAsNonRoot":true,"runAsUser":999,"seccompProfile":{"type":"RuntimeDefault"}}
   */
  securityContext?: ArgocdHelmValuesRedisSecurityContext;
  /**
   * Redis container ports
   *
   * @default {"redis":6379,"metrics":9121}
   */
  containerPorts?: ArgocdHelmValuesRedisContainerPorts;
  /**
   * [DNS configuration]
   *
   * @default {}
   */
  dnsConfig?: ArgocdHelmValuesRedisDnsConfig;
  /**
   * Alternative DNS policy for Redis server pods
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Redis container-level security context
   *
   * @default {"readOnlyRootFilesystem":true,"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}
   */
  containerSecurityContext?: ArgocdHelmValuesRedisContainerSecurityContext;
  /**
   * Redis service port
   *
   * @default 6379
   */
  servicePort?: number;
  /**
   * Priority class for redis pods
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * [Node selector]
   *
   * @default {}
   */
  nodeSelector?: ArgocdHelmValuesRedisNodeSelector;
  tolerations?: unknown[];
  /**
   * Assign custom [affinity] rules to the deployment
   *
   * @default {}
   */
  affinity?: ArgocdHelmValuesRedisAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * terminationGracePeriodSeconds for container lifecycle hook
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Automount API credentials for the Service Account into the pod.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default {...} (4 keys)
   */
  serviceAccount?: ArgocdHelmValuesRedisServiceAccount;
  /**
   * @default {"annotations":{},"labels":{}}
   */
  service?: ArgocdHelmValuesRedisService;
  /**
   * @default {"enabled":false,"service":{"type":"ClusterIP","clusterIP":"None","annotations":{},"labels":{},"servicePort":9121,"portName":"http-metrics"},"serviceMonitor":{"enabled":false,"interval":"30s","honorLabels":false,"relabelings":[],"metricRelabelings":[],"selector":{},"scheme":"","tlsConfig":{},"namespace":"","additionalLabels":{},"annotations":{}}}
   */
  metrics?: ArgocdHelmValuesRedisMetrics;
  /**
   * Default redis's network policy
   *
   * @default {"create":false}
   */
  networkPolicy?: ArgocdHelmValuesRedisNetworkPolicy;
};

export type ArgocdHelmValuesRedisPdb = {
  /**
   * Deploy a [PodDisruptionBudget] for the Redis
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Labels to be added to Redis pdb
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesRedisPdbLabels;
  /**
   * Annotations to be added to Redis pdb
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRedisPdbAnnotations;
  /**
   * Number of pods that are available after eviction as number or percentage (eg.: 50%)
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * Number of pods that are unavailble after eviction as number or percentage (eg.: 50%).
   * Has higher precedence over `redis.pdb.minAvailable`
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type ArgocdHelmValuesRedisPdbLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRedisPdbAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRedisImage = {
  /**
   * Redis repository
   *
   * @default "ecr-public.aws.com/docker/library/redis"
   */
  repository?: string;
  /**
   * Redis tag
   * Do not use 7.4.0 <= v < 8.0.0, otherwise you are no longer using an open source version of Redis
   *
   * @default "8.2.2-alpine"
   */
  tag?: string;
  /**
   * Redis image pull policy
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesRedisExporter = {
  /**
   * Enable Prometheus redis-exporter sidecar
   *
   * @default false
   */
  enabled?: boolean;
  env?: unknown[];
  /**
   * Prometheus redis-exporter image
   *
   * @default {"repository":"ghcr.io/oliver006/redis_exporter","tag":"v1.80.1","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesRedisExporterImage;
  /**
   * Redis exporter security context
   *
   * @default {...} (5 keys)
   */
  containerSecurityContext?: ArgocdHelmValuesRedisExporterContainerSecurityContext;
  /**
   * Probes for Redis exporter (optional)
   * Ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: ArgocdHelmValuesRedisExporterReadinessProbe;
  /**
   * @default {...} (6 keys)
   */
  livenessProbe?: ArgocdHelmValuesRedisExporterLivenessProbe;
  /**
   * Resource limits and requests for redis-exporter sidecar
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesRedisExporterResources;
};

export type ArgocdHelmValuesRedisExporterImage = {
  /**
   * Repository to use for the redis-exporter
   *
   * @default "ghcr.io/oliver006/redis_exporter"
   */
  repository?: string;
  /**
   * Tag to use for the redis-exporter
   *
   * @default "v1.80.1"
   */
  tag?: string;
  /**
   * Image pull policy for the redis-exporter
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesRedisExporterContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdHelmValuesRedisExporterContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ArgocdHelmValuesRedisExporterContainerSecurityContextCapabilities;
};

export type ArgocdHelmValuesRedisExporterContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesRedisExporterContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesRedisExporterReadinessProbe = {
  /**
   * Enable Kubernetes liveness probe for Redis exporter (optional)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 15
   */
  periodSeconds?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 15
   */
  timeoutSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type ArgocdHelmValuesRedisExporterLivenessProbe = {
  /**
   * Enable Kubernetes liveness probe for Redis exporter
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 15
   */
  periodSeconds?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 15
   */
  timeoutSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type ArgocdHelmValuesRedisExporterResources = object;

export type ArgocdHelmValuesRedisReadinessProbe = {
  /**
   * Enable Kubernetes liveness probe for Redis server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 15
   */
  periodSeconds?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 15
   */
  timeoutSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type ArgocdHelmValuesRedisLivenessProbe = {
  /**
   * Enable Kubernetes liveness probe for Redis server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 15
   */
  periodSeconds?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 15
   */
  timeoutSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 5
   */
  failureThreshold?: number;
};

export type ArgocdHelmValuesRedisDeploymentAnnotations = object;

export type ArgocdHelmValuesRedisDeploymentLabels = object;

export type ArgocdHelmValuesRedisPodAnnotations = object;

export type ArgocdHelmValuesRedisPodLabels = object;

export type ArgocdHelmValuesRedisResources = object;

export type ArgocdHelmValuesRedisSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 999
   */
  runAsUser?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdHelmValuesRedisSecurityContextSeccompProfile;
};

export type ArgocdHelmValuesRedisSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesRedisContainerPorts = {
  /**
   * Redis container port
   *
   * @default 6379
   */
  redis?: number;
  /**
   * Metrics container port
   *
   * @default 9121
   */
  metrics?: number;
};

export type ArgocdHelmValuesRedisDnsConfig = object;

export type ArgocdHelmValuesRedisContainerSecurityContext = {
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
  capabilities?: ArgocdHelmValuesRedisContainerSecurityContextCapabilities;
};

export type ArgocdHelmValuesRedisContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesRedisNodeSelector = object;

export type ArgocdHelmValuesRedisAffinity = object;

export type ArgocdHelmValuesRedisServiceAccount = {
  /**
   * Create a service account for the redis pod
   *
   * @default false
   */
  create?: boolean;
  /**
   * Service account name for redis pod
   *
   * @default ""
   */
  name?: string;
  /**
   * Annotations applied to created service account
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRedisServiceAccountAnnotations;
  /**
   * Automount API credentials for the Service Account
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
};

export type ArgocdHelmValuesRedisServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRedisService = {
  /**
   * Redis service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRedisServiceAnnotations;
  /**
   * Additional redis service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesRedisServiceLabels;
};

export type ArgocdHelmValuesRedisServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRedisServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRedisMetrics = {
  /**
   * Deploy metrics service
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Redis metrics service configuration
   *
   * @default {...} (6 keys)
   */
  service?: ArgocdHelmValuesRedisMetricsService;
  /**
   * @default {...} (11 keys)
   */
  serviceMonitor?: ArgocdHelmValuesRedisMetricsServiceMonitor;
};

export type ArgocdHelmValuesRedisMetricsService = {
  /**
   * Metrics service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Metrics service clusterIP. `None` makes a "headless service" (no virtual IP)
   *
   * @default "None"
   */
  clusterIP?: string;
  /**
   * Metrics service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRedisMetricsServiceAnnotations;
  /**
   * Metrics service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesRedisMetricsServiceLabels;
  /**
   * Metrics service port
   *
   * @default 9121
   */
  servicePort?: number;
  /**
   * Metrics service port name
   *
   * @default "http-metrics"
   */
  portName?: string;
};

export type ArgocdHelmValuesRedisMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRedisMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRedisMetricsServiceMonitor = {
  /**
   * Enable a prometheus ServiceMonitor
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Interval at which metrics should be scraped
   *
   * @default "30s"
   */
  interval?: string;
  /**
   * When true, honorLabels preserves the metric’s labels when they collide with the target’s labels.
   *
   * @default false
   */
  honorLabels?: boolean;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
  /**
   * Prometheus ServiceMonitor selector
   *
   * @default {}
   */
  selector?: ArgocdHelmValuesRedisMetricsServiceMonitorSelector;
  /**
   * Prometheus ServiceMonitor scheme
   *
   * @default ""
   */
  scheme?: string;
  /**
   * Prometheus ServiceMonitor tlsConfig
   *
   * @default {}
   */
  tlsConfig?: ArgocdHelmValuesRedisMetricsServiceMonitorTlsConfig;
  /**
   * Prometheus ServiceMonitor namespace
   * "monitoring"
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Prometheus ServiceMonitor labels
   *
   * @default {}
   */
  additionalLabels?: ArgocdHelmValuesRedisMetricsServiceMonitorAdditionalLabels;
  /**
   * Prometheus ServiceMonitor annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRedisMetricsServiceMonitorAnnotations;
};

export type ArgocdHelmValuesRedisMetricsServiceMonitorSelector = object;

export type ArgocdHelmValuesRedisMetricsServiceMonitorTlsConfig = object;

export type ArgocdHelmValuesRedisMetricsServiceMonitorAdditionalLabels = object;

export type ArgocdHelmValuesRedisMetricsServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRedisNetworkPolicy = {
  /**
   * Default network policy rules used by redis
   *
   * @default false
   */
  create?: boolean;
};

export type ArgocdHelmValuesRedisha = {
  /**
   * Enables the Redis HA subchart and disables the custom Redis single node deployment
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Redis image
   *
   * @default {"repository":"ecr-public.aws.com/docker/library/redis","tag":"8.2.2-alpine"}
   */
  image?: ArgocdHelmValuesRedishaImage;
  /**
   * Prometheus redis-exporter sidecar
   *
   * @default {"enabled":false,"image":"ghcr.io/oliver006/redis_exporter","tag":"v1.75.0"}
   */
  exporter?: ArgocdHelmValuesRedishaExporter;
  /**
   * @default {"enabled":false}
   */
  persistentVolume?: ArgocdHelmValuesRedishaPersistentVolume;
  /**
   * Redis specific configuration options
   *
   * @default {"masterGroupName":"argocd","config":{"save":"\"\""}}
   */
  redis?: ArgocdHelmValuesRedishaRedis;
  /**
   * Enables a HA Proxy for better LoadBalancing / Sentinel Master support. Automatically proxies to Redis master.
   *
   * @default {...} (9 keys)
   */
  haproxy?: ArgocdHelmValuesRedishaHaproxy;
  /**
   * Configures redis-ha with AUTH
   *
   * @default true
   */
  auth?: boolean;
  /**
   * Existing Secret to use for redis-ha authentication.
   * By default the redis-secret-init Job is generating this Secret.
   *
   * @default "argocd-redis"
   */
  existingSecret?: string;
  /**
   * Whether the Redis server pods should be forced to run on separate nodes.
   *
   * @default true
   */
  hardAntiAffinity?: boolean;
  /**
   * Additional affinities to add to the Redis server pods.
   *
   * @default {}
   */
  additionalAffinities?: ArgocdHelmValuesRedishaAdditionalAffinities;
  /**
   * Assign custom [affinity] rules to the Redis pods.
   *
   * @default ""
   */
  affinity?: string;
  tolerations?: unknown[];
  /**
   * Assign custom [TopologySpreadConstraints] rules to the Redis pods.
   * https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/
   *
   * @default {...} (4 keys)
   */
  topologySpreadConstraints?: ArgocdHelmValuesRedishaTopologySpreadConstraints;
  /**
   * Redis HA statefulset container-level security context
   *
   * @default {"readOnlyRootFilesystem":true}
   */
  containerSecurityContext?: ArgocdHelmValuesRedishaContainerSecurityContext;
};

export type ArgocdHelmValuesRedishaImage = {
  /**
   * Redis repository
   *
   * @default "ecr-public.aws.com/docker/library/redis"
   */
  repository?: string;
  /**
   * Redis tag
   * Do not upgrade to >= 7.4.0, otherwise you are no longer using an open source version of Redis
   *
   * @default "8.2.2-alpine"
   */
  tag?: string;
};

export type ArgocdHelmValuesRedishaExporter = {
  /**
   * Enable Prometheus redis-exporter sidecar
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Repository to use for the redis-exporter
   *
   * @default "ghcr.io/oliver006/redis_exporter"
   */
  image?: string;
  /**
   * Tag to use for the redis-exporter
   *
   * @default "v1.75.0"
   */
  tag?: string;
};

export type ArgocdHelmValuesRedishaPersistentVolume = {
  /**
   * Configures persistence on Redis nodes
   *
   * @default false
   */
  enabled?: boolean;
};

export type ArgocdHelmValuesRedishaRedis = {
  /**
   * Redis convention for naming the cluster group: must match `^[\\w-\\.]+$` and can be templated
   *
   * @default "argocd"
   */
  masterGroupName?: string;
  /**
   * Any valid redis config options in this section will be applied to each server (see `redis-ha` chart)
   *
   * @default {"save":"\"\""}
   */
  config?: ArgocdHelmValuesRedishaRedisConfig;
};

export type ArgocdHelmValuesRedishaRedisConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Will save the DB if both the given number of seconds and the given number of write operations against the DB occurred. `""`  is disabled
   *
   * @default """"
   */
  save?: string;
};

export type ArgocdHelmValuesRedishaHaproxy = {
  /**
   * Enabled HAProxy LoadBalancing/Proxy
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Custom labels for the haproxy pod. This is relevant for Argo CD CLI.
   *
   * @default {"app.kubernetes.io/name":"argocd-redis-ha-haproxy"}
   */
  labels?: ArgocdHelmValuesRedishaHaproxyLabels;
  /**
   * @default {"repository":"ecr-public.aws.com/docker/library/haproxy"}
   */
  image?: ArgocdHelmValuesRedishaHaproxyImage;
  /**
   * @default {"enabled":true}
   */
  metrics?: ArgocdHelmValuesRedishaHaproxyMetrics;
  /**
   * Whether the haproxy pods should be forced to run on separate nodes.
   *
   * @default true
   */
  hardAntiAffinity?: boolean;
  /**
   * Additional affinities to add to the haproxy pods.
   *
   * @default {}
   */
  additionalAffinities?: ArgocdHelmValuesRedishaHaproxyAdditionalAffinities;
  /**
   * Assign custom [affinity] rules to the haproxy pods.
   *
   * @default ""
   */
  affinity?: string;
  tolerations?: unknown[];
  /**
   * HAProxy container-level security context
   *
   * @default {"readOnlyRootFilesystem":true}
   */
  containerSecurityContext?: ArgocdHelmValuesRedishaHaproxyContainerSecurityContext;
};

export type ArgocdHelmValuesRedishaHaproxyLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "argocd-redis-ha-haproxy"
   */
  "app.kubernetes.io/name"?: string;
};

export type ArgocdHelmValuesRedishaHaproxyImage = {
  /**
   * HAProxy Image Repository
   *
   * @default "ecr-public.aws.com/docker/library/haproxy"
   */
  repository?: string;
};

export type ArgocdHelmValuesRedishaHaproxyMetrics = {
  /**
   * HAProxy enable prometheus metric scraping
   *
   * @default true
   */
  enabled?: boolean;
};

export type ArgocdHelmValuesRedishaHaproxyAdditionalAffinities = object;

export type ArgocdHelmValuesRedishaHaproxyContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
};

export type ArgocdHelmValuesRedishaAdditionalAffinities = object;

export type ArgocdHelmValuesRedishaTopologySpreadConstraints = {
  /**
   * Enable Redis HA topology spread constraints
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Max skew of pods tolerated
   *
   * @default ""
   */
  maxSkew?: string;
  /**
   * Topology key for spread
   *
   * @default ""
   */
  topologyKey?: string;
  /**
   * Enforcement policy, hard or soft
   *
   * @default ""
   */
  whenUnsatisfiable?: string;
};

export type ArgocdHelmValuesRedishaContainerSecurityContext = {
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
};

export type ArgocdHelmValuesExternalRedis = {
  /**
   * External Redis server host
   *
   * @default ""
   */
  host?: string;
  /**
   * External Redis username
   *
   * @default ""
   */
  username?: string;
  /**
   * External Redis password
   *
   * @default ""
   */
  password?: string;
  /**
   * External Redis server port
   *
   * @default 6379
   */
  port?: number;
  /**
   * The name of an existing secret with Redis (must contain key `redis-password`. And should contain `redis-username` if username is not `default`) and Sentinel credentials.
   * When it's set, the `externalRedis.username` and `externalRedis.password` parameters are ignored
   *
   * @default ""
   */
  existingSecret?: string;
  /**
   * External Redis Secret annotations
   *
   * @default {}
   */
  secretAnnotations?: ArgocdHelmValuesExternalRedisSecretAnnotations;
};

export type ArgocdHelmValuesExternalRedisSecretAnnotations = object;

export type ArgocdHelmValuesRedisSecretInit = {
  /**
   * Enable Redis secret initialization. If disabled, secret must be provisioned by alternative methods
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Redis secret-init name
   *
   * @default "redis-secret-init"
   */
  name?: string;
  /**
   * @default {"repository":"","tag":"","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesRedisSecretInitImage;
  extraArgs?: unknown[];
  imagePullSecrets?: unknown[];
  /**
   * Runtime class name for the Redis secret-init Job
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * Annotations to be added to the Redis secret-init Job
   *
   * @default {}
   */
  jobAnnotations?: ArgocdHelmValuesRedisSecretInitJobAnnotations;
  /**
   * Annotations to be added to the Redis secret-init Job
   *
   * @default {}
   */
  podAnnotations?: ArgocdHelmValuesRedisSecretInitPodAnnotations;
  /**
   * Labels to be added to the Redis secret-init Job
   *
   * @default {}
   */
  podLabels?: ArgocdHelmValuesRedisSecretInitPodLabels;
  /**
   * Resource limits and requests for Redis secret-init Job
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesRedisSecretInitResources;
  /**
   * Application controller container-level security context
   *
   * @default {...} (5 keys)
   */
  containerSecurityContext?: ArgocdHelmValuesRedisSecretInitContainerSecurityContext;
  /**
   * Redis secret-init Job pod-level security context
   *
   * @default {}
   */
  securityContext?: ArgocdHelmValuesRedisSecretInitSecurityContext;
  /**
   * @default {...} (4 keys)
   */
  serviceAccount?: ArgocdHelmValuesRedisSecretInitServiceAccount;
  /**
   * Priority class for Redis secret-init Job
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Assign custom [affinity] rules to the Redis secret-init Job
   *
   * @default {}
   */
  affinity?: ArgocdHelmValuesRedisSecretInitAffinity;
  /**
   * Node selector to be added to the Redis secret-init Job
   *
   * @default {}
   */
  nodeSelector?: ArgocdHelmValuesRedisSecretInitNodeSelector;
  tolerations?: unknown[];
};

export type ArgocdHelmValuesRedisSecretInitImage = {
  /**
   * defaults to global.image.repository
   *
   * @default ""
   */
  repository?: string;
  /**
   * Tag to use for the Redis secret-init Job
   * defaults to global.image.tag
   *
   * @default ""
   */
  tag?: string;
  /**
   * Image pull policy for the Redis secret-init Job
   * IfNotPresent
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesRedisSecretInitJobAnnotations = object;

export type ArgocdHelmValuesRedisSecretInitPodAnnotations = object;

export type ArgocdHelmValuesRedisSecretInitPodLabels = object;

export type ArgocdHelmValuesRedisSecretInitResources = object;

export type ArgocdHelmValuesRedisSecretInitContainerSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ArgocdHelmValuesRedisSecretInitContainerSecurityContextCapabilities;
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
  seccompProfile?: ArgocdHelmValuesRedisSecretInitContainerSecurityContextSeccompProfile;
};

export type ArgocdHelmValuesRedisSecretInitContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesRedisSecretInitContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesRedisSecretInitSecurityContext = object;

export type ArgocdHelmValuesRedisSecretInitServiceAccount = {
  /**
   * Create a service account for the redis pod
   *
   * @default true
   */
  create?: boolean;
  /**
   * Service account name for redis pod
   *
   * @default ""
   */
  name?: string;
  /**
   * Annotations applied to created service account
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRedisSecretInitServiceAccountAnnotations;
  /**
   * Automount API credentials for the Service Account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type ArgocdHelmValuesRedisSecretInitServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRedisSecretInitAffinity = object;

export type ArgocdHelmValuesRedisSecretInitNodeSelector = object;

export type ArgocdHelmValuesServer = {
  /**
   * Argo CD server name
   *
   * @default "server"
   */
  name?: string;
  /**
   * The number of server pods to run
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Runtime class name for the Argo CD server
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * Argo CD server Horizontal Pod Autoscaler
   *
   * @default {...} (7 keys)
   */
  autoscaling?: ArgocdHelmValuesServerAutoscaling;
  /**
   * Argo CD server Pod Disruption Budget
   * Ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {...} (5 keys)
   */
  pdb?: ArgocdHelmValuesServerPdb;
  /**
   * Argo CD server image
   *
   * @default {"repository":"","tag":"","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesServerImage;
  imagePullSecrets?: unknown[];
  extraArgs?: unknown[];
  env?: unknown[];
  envFrom?: unknown[];
  /**
   * Specify postStart and preStop lifecycle hooks for your argo-cd-server container
   *
   * @default {}
   */
  lifecycle?: ArgocdHelmValuesServerLifecycle;
  /**
   * Argo CD extensions
   * This function in tech preview stage, do expect instability or breaking changes in newer versions.
   * Ref: https://github.com/argoproj-labs/argocd-extension-installer
   * When you enable extensions, you need to configure RBAC of logged in Argo CD user.
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/#the-extensions-resource
   *
   * @default {...} (5 keys)
   */
  extensions?: ArgocdHelmValuesServerExtensions;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  volumeMounts?: unknown[];
  volumes?: unknown[];
  /**
   * Argo CD server emptyDir volumes
   *
   * @default {"sizeLimit":""}
   */
  emptyDir?: ArgocdHelmValuesServerEmptyDir;
  /**
   * Annotations to be added to server Deployment
   *
   * @default {}
   */
  deploymentAnnotations?: ArgocdHelmValuesServerDeploymentAnnotations;
  /**
   * Labels for the server Deployment
   *
   * @default {}
   */
  deploymentLabels?: ArgocdHelmValuesServerDeploymentLabels;
  /**
   * Annotations to be added to server pods
   *
   * @default {}
   */
  podAnnotations?: ArgocdHelmValuesServerPodAnnotations;
  /**
   * Labels to be added to server pods
   *
   * @default {}
   */
  podLabels?: ArgocdHelmValuesServerPodLabels;
  /**
   * Resource limits and requests for the Argo CD server
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesServerResources;
  /**
   * Server container ports
   *
   * @default {"server":8080,"metrics":8083}
   */
  containerPorts?: ArgocdHelmValuesServerContainerPorts;
  /**
   * Host Network for Server pods
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * [DNS configuration]
   *
   * @default {}
   */
  dnsConfig?: ArgocdHelmValuesServerDnsConfig;
  /**
   * Alternative DNS policy for Server pods
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Server container-level security context
   *
   * @default {...} (5 keys)
   */
  containerSecurityContext?: ArgocdHelmValuesServerContainerSecurityContext;
  /**
   * Readiness and liveness probes for default backend
   * Ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: ArgocdHelmValuesServerReadinessProbe;
  /**
   * @default {...} (6 keys)
   */
  livenessProbe?: ArgocdHelmValuesServerLivenessProbe;
  /**
   * terminationGracePeriodSeconds for container lifecycle hook
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * Priority class for the Argo CD server pods
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * [Node selector]
   *
   * @default {}
   */
  nodeSelector?: ArgocdHelmValuesServerNodeSelector;
  tolerations?: unknown[];
  /**
   * Assign custom [affinity] rules to the deployment
   *
   * @default {}
   */
  affinity?: ArgocdHelmValuesServerAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Deployment strategy to be added to the server Deployment
   *
   * @default {}
   */
  deploymentStrategy?: ArgocdHelmValuesServerDeploymentStrategy;
  /**
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/tls/#tls-certificates-used-by-argocd-server
   *
   * @default {...} (10 keys)
   */
  certificate?: ArgocdHelmValuesServerCertificate;
  /**
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/tls/#tls-certificates-used-by-argocd-server
   *
   * @default {...} (5 keys)
   */
  certificateSecret?: ArgocdHelmValuesServerCertificateSecret;
  /**
   * Server service configuration
   *
   * @default {...} (16 keys)
   */
  service?: ArgocdHelmValuesServerService;
  /**
   * Server metrics service configuration
   *
   * @default {"enabled":false,"service":{"type":"ClusterIP","clusterIP":"","annotations":{},"labels":{},"servicePort":8083,"portName":"http-metrics"},"serviceMonitor":{"enabled":false,"interval":"30s","scrapeTimeout":"","honorLabels":false,"relabelings":[],"metricRelabelings":[],"selector":{},"scheme":"","tlsConfig":{},"namespace":"","additionalLabels":{},"annotations":{}}}
   */
  metrics?: ArgocdHelmValuesServerMetrics;
  /**
   * Automount API credentials for the Service Account into the pod.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: ArgocdHelmValuesServerServiceAccount;
  /**
   * Argo CD server ingress configuration
   *
   * @default {...} (15 keys)
   */
  ingress?: ArgocdHelmValuesServerIngress;
  /**
   * Dedicated gRPC ingress for ingress controllers that supports only single backend protocol per Ingress resource
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/ingress/#option-2-multiple-ingress-objects-and-hosts
   *
   * @default {...} (12 keys)
   */
  ingressGrpc?: ArgocdHelmValuesServerIngressGrpc;
  /**
   * Create a OpenShift Route with SSL passthrough for UI and CLI
   * Consider setting 'hostname' e.g. https://argocd.apps-crc.testing/ using your Default Ingress Controller Domain
   * Find your domain with: kubectl describe --namespace=openshift-ingress-operator ingresscontroller/default | grep Domain:
   * If 'hostname' is an empty string "" OpenShift will create a hostname for you.
   *
   * @default {...} (5 keys)
   */
  route?: ArgocdHelmValuesServerRoute;
  /**
   * NOTE: Gateway API support is in EXPERIMENTAL status
   * Support depends on your Gateway controller implementation
   * Some controllers may require additional configuration (e.g., BackendTLSPolicy for HTTPS backends)
   * Refer to https://gateway-api.sigs.k8s.io/implementations/ for controller-specific details
   *
   * @default {...} (6 keys)
   */
  httproute?: ArgocdHelmValuesServerHttproute;
  /**
   * @default {...} (6 keys)
   */
  grpcroute?: ArgocdHelmValuesServerGrpcroute;
  /**
   * @default {...} (5 keys)
   */
  backendTLSPolicy?: ArgocdHelmValuesServerBackendTLSPolicy;
  /**
   * Enable this and set the rules: to whatever custom rules you want for the Cluster Role resource.
   * Defaults to off
   *
   * @default {"enabled":false,"rules":[]}
   */
  clusterRoleRules?: ArgocdHelmValuesServerClusterRoleRules;
  /**
   * Default ArgoCD Server's network policy
   *
   * @default {"create":false}
   */
  networkPolicy?: ArgocdHelmValuesServerNetworkPolicy;
};

export type ArgocdHelmValuesServerAutoscaling = {
  /**
   * Enable Horizontal Pod Autoscaler ([HPA]) for the Argo CD server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum number of replicas for the Argo CD server [HPA]
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum number of replicas for the Argo CD server [HPA]
   *
   * @default 5
   */
  maxReplicas?: number;
  /**
   * Average CPU utilization percentage for the Argo CD server [HPA]
   *
   * @default 50
   */
  targetCPUUtilizationPercentage?: number;
  /**
   * Average memory utilization percentage for the Argo CD server [HPA]
   *
   * @default 50
   */
  targetMemoryUtilizationPercentage?: number;
  /**
   * Configures the scaling behavior of the target in both Up and Down directions.
   *
   * @default {}
   */
  behavior?: ArgocdHelmValuesServerAutoscalingBehavior;
  metrics?: unknown[];
};

export type ArgocdHelmValuesServerAutoscalingBehavior = object;

export type ArgocdHelmValuesServerPdb = {
  /**
   * Deploy a [PodDisruptionBudget] for the Argo CD server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Labels to be added to Argo CD server pdb
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesServerPdbLabels;
  /**
   * Annotations to be added to Argo CD server pdb
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerPdbAnnotations;
  /**
   * Number of pods that are available after eviction as number or percentage (eg.: 50%)
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * Number of pods that are unavailable after eviction as number or percentage (eg.: 50%).
   * Has higher precedence over `server.pdb.minAvailable`
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type ArgocdHelmValuesServerPdbLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerPdbAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerImage = {
  /**
   * defaults to global.image.repository
   *
   * @default ""
   */
  repository?: string;
  /**
   * Tag to use for the Argo CD server
   * defaults to global.image.tag
   *
   * @default ""
   */
  tag?: string;
  /**
   * Image pull policy for the Argo CD server
   * IfNotPresent
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesServerLifecycle = object;

export type ArgocdHelmValuesServerExtensions = {
  /**
   * Enable support for Argo CD extensions
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Argo CD extension installer image
   *
   * @default {"repository":"quay.io/argoprojlabs/argocd-extension-installer","tag":"v0.0.9","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesServerExtensionsImage;
  extensionList?: unknown[];
  /**
   * Server UI extensions container-level security context
   *
   * @default {...} (6 keys)
   */
  containerSecurityContext?: ArgocdHelmValuesServerExtensionsContainerSecurityContext;
  /**
   * Resource limits and requests for the argocd-extensions container
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesServerExtensionsResources;
};

export type ArgocdHelmValuesServerExtensionsImage = {
  /**
   * Repository to use for extension installer image
   *
   * @default "quay.io/argoprojlabs/argocd-extension-installer"
   */
  repository?: string;
  /**
   * Tag to use for extension installer image
   *
   * @default "v0.0.9"
   */
  tag?: string;
  /**
   * Image pull policy for extensions
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesServerExtensionsContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default 1000
   */
  runAsUser?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdHelmValuesServerExtensionsContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ArgocdHelmValuesServerExtensionsContainerSecurityContextCapabilities;
};

export type ArgocdHelmValuesServerExtensionsContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesServerExtensionsContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesServerExtensionsResources = object;

export type ArgocdHelmValuesServerEmptyDir = {
  /**
   * EmptyDir size limit for the Argo CD server
   *
   * @default ""
   */
  sizeLimit?: string;
};

export type ArgocdHelmValuesServerDeploymentAnnotations = object;

export type ArgocdHelmValuesServerDeploymentLabels = object;

export type ArgocdHelmValuesServerPodAnnotations = object;

export type ArgocdHelmValuesServerPodLabels = object;

export type ArgocdHelmValuesServerResources = object;

export type ArgocdHelmValuesServerContainerPorts = {
  /**
   * Server container port
   *
   * @default 8080
   */
  server?: number;
  /**
   * Metrics container port
   *
   * @default 8083
   */
  metrics?: number;
};

export type ArgocdHelmValuesServerDnsConfig = object;

export type ArgocdHelmValuesServerContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdHelmValuesServerContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ArgocdHelmValuesServerContainerSecurityContextCapabilities;
};

export type ArgocdHelmValuesServerContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesServerContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesServerReadinessProbe = {
  /**
   * Enable Kubernetes readiness probe for default backend
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
};

export type ArgocdHelmValuesServerLivenessProbe = {
  /**
   * Enable Kubernetes liveness probe for default backend
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
};

export type ArgocdHelmValuesServerNodeSelector = object;

export type ArgocdHelmValuesServerAffinity = object;

export type ArgocdHelmValuesServerDeploymentStrategy = object;

export type ArgocdHelmValuesServerCertificate = {
  /**
   * Deploy a Certificate resource (requires cert-manager)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Certificate primary domain (commonName)
   *
   * @default ""
   */
  domain?: string;
  additionalHosts?: unknown[];
  /**
   * The requested 'duration' (i.e. lifetime) of the certificate.
   * Ref: https://cert-manager.io/docs/usage/certificate/#renewal
   *
   * @default ""
   */
  duration?: string;
  /**
   * How long before the expiry a certificate should be renewed.
   * Ref: https://cert-manager.io/docs/usage/certificate/#renewal
   *
   * @default ""
   */
  renewBefore?: string;
  /**
   * Ref: https://cert-manager.io/docs/concepts/issuer
   *
   * @default {"group":"","kind":"","name":""}
   */
  issuer?: ArgocdHelmValuesServerCertificateIssuer;
  /**
   * Private key of the certificate
   *
   * @default {...} (4 keys)
   */
  privateKey?: ArgocdHelmValuesServerCertificatePrivateKey;
  /**
   * Annotations to be applied to the Server Certificate
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerCertificateAnnotations;
  usages?: unknown[];
  /**
   * Annotations that allow the certificate to be composed from data residing in existing Kubernetes Resources
   *
   * @default {}
   */
  secretTemplateAnnotations?: ArgocdHelmValuesServerCertificateSecretTemplateAnnotations;
};

export type ArgocdHelmValuesServerCertificateIssuer = {
  /**
   * Certificate issuer group. Set if using an external issuer. Eg. `cert-manager.io`
   *
   * @default ""
   */
  group?: string;
  /**
   * Certificate issuer kind. Either `Issuer` or `ClusterIssuer`
   *
   * @default ""
   */
  kind?: string;
  /**
   * Certificate issuer name. Eg. `letsencrypt`
   *
   * @default ""
   */
  name?: string;
};

export type ArgocdHelmValuesServerCertificatePrivateKey = {
  /**
   * Rotation policy of private key when certificate is re-issued. Either: `Never` or `Always`
   *
   * @default "Never"
   */
  rotationPolicy?: string;
  /**
   * The private key cryptography standards (PKCS) encoding for private key. Either: `PCKS1` or `PKCS8`
   *
   * @default "PKCS1"
   */
  encoding?: string;
  /**
   * Algorithm used to generate certificate private key. One of: `RSA`, `Ed25519` or `ECDSA`
   *
   * @default "RSA"
   */
  algorithm?: string;
  /**
   * Key bit size of the private key. If algorithm is set to `Ed25519`, size is ignored.
   *
   * @default 2048
   */
  size?: number;
};

export type ArgocdHelmValuesServerCertificateAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerCertificateSecretTemplateAnnotations = object;

export type ArgocdHelmValuesServerCertificateSecret = {
  /**
   * Create argocd-server-tls secret
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Annotations to be added to argocd-server-tls secret
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerCertificateSecretAnnotations;
  /**
   * Labels to be added to argocd-server-tls secret
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesServerCertificateSecretLabels;
  /**
   * Private Key of the certificate
   *
   * @default ""
   */
  key?: string;
  /**
   * Certificate data
   *
   * @default ""
   */
  crt?: string;
};

export type ArgocdHelmValuesServerCertificateSecretAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerCertificateSecretLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerService = {
  /**
   * Server service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerServiceAnnotations;
  /**
   * Server service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesServerServiceLabels;
  /**
   * Server service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Server service http port for NodePort service type (only if `server.service.type` is set to "NodePort")
   *
   * @default 30080
   */
  nodePortHttp?: number;
  /**
   * Server service https port for NodePort service type (only if `server.service.type` is set to "NodePort")
   *
   * @default 30443
   */
  nodePortHttps?: number;
  /**
   * Server service http port
   *
   * @default 80
   */
  servicePortHttp?: number;
  /**
   * Server service https port
   *
   * @default 443
   */
  servicePortHttps?: number;
  /**
   * Server service http port name, can be used to route traffic via istio
   *
   * @default "http"
   */
  servicePortHttpName?: string;
  /**
   * Server service https port name, can be used to route traffic via istio
   *
   * @default "https"
   */
  servicePortHttpsName?: string;
  /**
   * Server service https port appProtocol
   * Ref: https://kubernetes.io/docs/concepts/services-networking/service/#application-protocol
   *
   * @default ""
   */
  servicePortHttpsAppProtocol?: string;
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

export type ArgocdHelmValuesServerServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerMetrics = {
  /**
   * Deploy metrics service
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {...} (6 keys)
   */
  service?: ArgocdHelmValuesServerMetricsService;
  /**
   * @default {...} (12 keys)
   */
  serviceMonitor?: ArgocdHelmValuesServerMetricsServiceMonitor;
};

export type ArgocdHelmValuesServerMetricsService = {
  /**
   * Metrics service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Metrics service clusterIP. `None` makes a "headless service" (no virtual IP)
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * Metrics service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerMetricsServiceAnnotations;
  /**
   * Metrics service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesServerMetricsServiceLabels;
  /**
   * Metrics service port
   *
   * @default 8083
   */
  servicePort?: number;
  /**
   * Metrics service port name
   *
   * @default "http-metrics"
   */
  portName?: string;
};

export type ArgocdHelmValuesServerMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerMetricsServiceMonitor = {
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
  /**
   * Prometheus ServiceMonitor scrapeTimeout. If empty, Prometheus uses the global scrape timeout unless it is less than the target's scrape interval value in which the latter is used.
   *
   * @default ""
   */
  scrapeTimeout?: string;
  /**
   * When true, honorLabels preserves the metric’s labels when they collide with the target’s labels.
   *
   * @default false
   */
  honorLabels?: boolean;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
  /**
   * Prometheus ServiceMonitor selector
   *
   * @default {}
   */
  selector?: ArgocdHelmValuesServerMetricsServiceMonitorSelector;
  /**
   * Prometheus ServiceMonitor scheme
   *
   * @default ""
   */
  scheme?: string;
  /**
   * Prometheus ServiceMonitor tlsConfig
   *
   * @default {}
   */
  tlsConfig?: ArgocdHelmValuesServerMetricsServiceMonitorTlsConfig;
  /**
   * Prometheus ServiceMonitor namespace
   * monitoring
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Prometheus ServiceMonitor labels
   *
   * @default {}
   */
  additionalLabels?: ArgocdHelmValuesServerMetricsServiceMonitorAdditionalLabels;
  /**
   * Prometheus ServiceMonitor annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerMetricsServiceMonitorAnnotations;
};

export type ArgocdHelmValuesServerMetricsServiceMonitorSelector = object;

export type ArgocdHelmValuesServerMetricsServiceMonitorTlsConfig = object;

export type ArgocdHelmValuesServerMetricsServiceMonitorAdditionalLabels = object;

export type ArgocdHelmValuesServerMetricsServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerServiceAccount = {
  /**
   * Create server service account
   *
   * @default true
   */
  create?: boolean;
  /**
   * Server service account name
   *
   * @default "argocd-server"
   */
  name?: string;
  /**
   * Annotations applied to created service account
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerServiceAccountAnnotations;
  /**
   * Labels applied to created service account
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesServerServiceAccountLabels;
  /**
   * Automount API credentials for the Service Account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type ArgocdHelmValuesServerServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerServiceAccountLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerIngress = {
  /**
   * Enable an ingress resource for the Argo CD server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Specific implementation for ingress controller. One of `generic`, `aws` or `gke`
   * Additional configuration might be required in related configuration sections
   *
   * @default "generic"
   */
  controller?: string;
  /**
   * Additional ingress labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesServerIngressLabels;
  /**
   * Additional ingress annotations
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/ingress/#option-1-ssl-passthrough
   * nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
   * nginx.ingress.kubernetes.io/ssl-passthrough: "true"
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerIngressAnnotations;
  /**
   * Defines which ingress controller will implement the resource
   *
   * @default ""
   */
  ingressClassName?: string;
  /**
   * Argo CD server hostname
   *
   * @default ""
   */
  hostname?: string;
  /**
   * The path to Argo CD server
   *
   * @default "/"
   */
  path?: string;
  /**
   * Ingress path type. One of `Exact`, `Prefix` or `ImplementationSpecific`
   *
   * @default "Prefix"
   */
  pathType?: string;
  /**
   * Enable TLS configuration for the hostname defined at `server.ingress.hostname`
   * TLS certificate will be retrieved from a TLS secret `argocd-server-tls`
   * You can create this secret via `certificate` or `certificateSecret` option
   *
   * @default false
   */
  tls?: boolean;
  extraHosts?: unknown[];
  extraPaths?: unknown[];
  extraRules?: unknown[];
  extraTls?: unknown[];
  /**
   * AWS specific options for Application Load Balancer
   * Applies only when `serv.ingress.controller` is set to `aws`
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/ingress/#aws-application-load-balancers-albs-and-classic-elb-http-mode
   *
   * @default {"backendProtocolVersion":"GRPC","serviceType":"NodePort","serviceAnnotations":{}}
   */
  aws?: ArgocdHelmValuesServerIngressAws;
  /**
   * Google specific options for Google Application Load Balancer
   * Applies only when `server.ingress.controller` is set to `gke`
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/ingress/#google-cloud-load-balancers-with-kubernetes-ingress
   *
   * @default {"backendConfig":{},"frontendConfig":{},"managedCertificate":{"create":true,"extraDomains":[]}}
   */
  gke?: ArgocdHelmValuesServerIngressGke;
};

export type ArgocdHelmValuesServerIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerIngressAws = {
  /**
   * Backend protocol version for the AWS ALB gRPC service
   * This tells AWS to send traffic from the ALB using gRPC.
   * For more information: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html#health-check-settings
   *
   * @default "GRPC"
   */
  backendProtocolVersion?: string;
  /**
   * Service type for the AWS ALB gRPC service
   * Can be of type NodePort or ClusterIP depending on which mode you are running.
   * Instance mode needs type NodePort, IP mode needs type ClusterIP
   * Ref: https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.2/how-it-works/#ingress-traffic
   *
   * @default "NodePort"
   */
  serviceType?: string;
  /**
   * Annotations for the AWS ALB gRPC service
   * Allows adding custom annotations to the gRPC service for integrations like DataDog, Prometheus, etc.
   *
   * @default {}
   */
  serviceAnnotations?: ArgocdHelmValuesServerIngressAwsServiceAnnotations;
};

export type ArgocdHelmValuesServerIngressAwsServiceAnnotations = object;

export type ArgocdHelmValuesServerIngressGke = {
  /**
   * Google [BackendConfig] resource, for use with the GKE Ingress Controller
   * Ref: https://cloud.google.com/kubernetes-engine/docs/how-to/ingress-features#configuring_ingress_features_through_frontendconfig_parameters
   *
   * @default {}
   */
  backendConfig?: ArgocdHelmValuesServerIngressGkeBackendConfig;
  /**
   * @default {}
   */
  frontendConfig?: ArgocdHelmValuesServerIngressGkeFrontendConfig;
  /**
   * Managed GKE certificate for ingress hostname
   *
   * @default {"create":true,"extraDomains":[]}
   */
  managedCertificate?: ArgocdHelmValuesServerIngressGkeManagedCertificate;
};

export type ArgocdHelmValuesServerIngressGkeBackendConfig = object;

export type ArgocdHelmValuesServerIngressGkeFrontendConfig = object;

export type ArgocdHelmValuesServerIngressGkeManagedCertificate = {
  /**
   * Create ManagedCertificate resource and annotations for Google Load balancer
   * Ref: https://cloud.google.com/kubernetes-engine/docs/how-to/managed-certs
   *
   * @default true
   */
  create?: boolean;
  extraDomains?: unknown[];
};

export type ArgocdHelmValuesServerIngressGrpc = {
  /**
   * Enable an ingress resource for the Argo CD server for dedicated [gRPC-ingress]
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional ingress annotations for dedicated [gRPC-ingress]
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerIngressGrpcAnnotations;
  /**
   * Additional ingress labels for dedicated [gRPC-ingress]
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesServerIngressGrpcLabels;
  /**
   * Defines which ingress controller will implement the resource [gRPC-ingress]
   *
   * @default ""
   */
  ingressClassName?: string;
  /**
   * Argo CD server hostname for dedicated [gRPC-ingress]
   *
   * @default ""
   */
  hostname?: string;
  /**
   * Argo CD server ingress path for dedicated [gRPC-ingress]
   *
   * @default "/"
   */
  path?: string;
  /**
   * Ingress path type for dedicated [gRPC-ingress]. One of `Exact`, `Prefix` or `ImplementationSpecific`
   *
   * @default "Prefix"
   */
  pathType?: string;
  /**
   * Enable TLS configuration for the hostname defined at `server.ingressGrpc.hostname`
   * TLS certificate will be retrieved from a TLS secret with name: `argocd-server-grpc-tls`
   *
   * @default false
   */
  tls?: boolean;
  extraHosts?: unknown[];
  extraPaths?: unknown[];
  extraRules?: unknown[];
  extraTls?: unknown[];
};

export type ArgocdHelmValuesServerIngressGrpcAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerIngressGrpcLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerRoute = {
  /**
   * Enable an OpenShift Route for the Argo CD server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Openshift Route annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerRouteAnnotations;
  /**
   * Hostname of OpenShift Route
   *
   * @default ""
   */
  hostname?: string;
  /**
   * Termination type of Openshift Route
   *
   * @default "passthrough"
   */
  termination_type?: string;
  /**
   * Termination policy of Openshift Route
   *
   * @default "None"
   */
  termination_policy?: string;
};

export type ArgocdHelmValuesServerRouteAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerHttproute = {
  /**
   * Enable HTTPRoute resource for Argo CD server (Gateway API)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional HTTPRoute labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesServerHttprouteLabels;
  /**
   * Additional HTTPRoute annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerHttprouteAnnotations;
  parentRefs?: unknown[];
  hostnames?: unknown[];
  rules?: ArgocdHelmValuesServerHttprouteRulesElement[];
};

export type ArgocdHelmValuesServerHttprouteLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerHttprouteAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerHttprouteRulesElement = {
  matches?: ArgocdHelmValuesServerHttprouteRulesMatchesElement[];
};

export type ArgocdHelmValuesServerHttprouteRulesMatchesElement = {
  /**
   * @default {"type":"PathPrefix","value":"/"}
   */
  path?: ArgocdHelmValuesServerHttprouteRulesMatchesPath;
};

export type ArgocdHelmValuesServerHttprouteRulesMatchesPath = {
  /**
   * @default "PathPrefix"
   */
  type?: string;
  /**
   * @default "/"
   */
  value?: string;
};

export type ArgocdHelmValuesServerGrpcroute = {
  /**
   * Enable GRPCRoute resource for Argo CD server (Gateway API)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional GRPCRoute labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesServerGrpcrouteLabels;
  /**
   * Additional GRPCRoute annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerGrpcrouteAnnotations;
  parentRefs?: unknown[];
  hostnames?: unknown[];
  rules?: ArgocdHelmValuesServerGrpcrouteRulesElement[];
};

export type ArgocdHelmValuesServerGrpcrouteLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerGrpcrouteAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerGrpcrouteRulesElement = {
  matches?: ArgocdHelmValuesServerGrpcrouteRulesMatchesElement[];
};

export type ArgocdHelmValuesServerGrpcrouteRulesMatchesElement = {
  /**
   * @default {"type":"Exact"}
   */
  method?: ArgocdHelmValuesServerGrpcrouteRulesMatchesMethod;
};

export type ArgocdHelmValuesServerGrpcrouteRulesMatchesMethod = {
  /**
   * @default "Exact"
   */
  type?: string;
};

export type ArgocdHelmValuesServerBackendTLSPolicy = {
  /**
   * Enable BackendTLSPolicy resource for Argo CD server (Gateway API)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional BackendTLSPolicy labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesServerBackendTLSPolicyLabels;
  /**
   * Additional BackendTLSPolicy annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesServerBackendTLSPolicyAnnotations;
  targetRefs?: unknown[];
  /**
   * TLS validation configuration
   *
   * @default {}
   */
  validation?: ArgocdHelmValuesServerBackendTLSPolicyValidation;
};

export type ArgocdHelmValuesServerBackendTLSPolicyLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerBackendTLSPolicyAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesServerBackendTLSPolicyValidation = object;

export type ArgocdHelmValuesServerClusterRoleRules = {
  /**
   * Enable custom rules for the server's ClusterRole resource
   *
   * @default false
   */
  enabled?: boolean;
  rules?: unknown[];
};

export type ArgocdHelmValuesServerNetworkPolicy = {
  /**
   * Default network policy rules used by ArgoCD Server
   *
   * @default false
   */
  create?: boolean;
};

export type ArgocdHelmValuesRepoServer = {
  /**
   * Repo server name
   *
   * @default "repo-server"
   */
  name?: string;
  /**
   * The number of repo server pods to run
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Runtime class name for the repo server
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * Repo server Horizontal Pod Autoscaler
   *
   * @default {...} (7 keys)
   */
  autoscaling?: ArgocdHelmValuesRepoServerAutoscaling;
  /**
   * Repo server Pod Disruption Budget
   * Ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {...} (5 keys)
   */
  pdb?: ArgocdHelmValuesRepoServerPdb;
  /**
   * Repo server image
   *
   * @default {"repository":"","tag":"","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesRepoServerImage;
  imagePullSecrets?: unknown[];
  extraArgs?: unknown[];
  env?: unknown[];
  envFrom?: unknown[];
  /**
   * Specify postStart and preStop lifecycle hooks for your argo-repo-server container
   *
   * @default {}
   */
  lifecycle?: ArgocdHelmValuesRepoServerLifecycle;
  extraContainers?: unknown[];
  initContainers?: unknown[];
  /**
   * @default {"resources":{}}
   */
  copyutil?: ArgocdHelmValuesRepoServerCopyutil;
  volumeMounts?: unknown[];
  volumes?: unknown[];
  /**
   * Volumes to be used in replacement of emptydir on default volumes
   *
   * @default {}
   */
  existingVolumes?: ArgocdHelmValuesRepoServerExistingVolumes;
  /**
   * RepoServer emptyDir volumes
   *
   * @default {"sizeLimit":""}
   */
  emptyDir?: ArgocdHelmValuesRepoServerEmptyDir;
  /**
   * Toggle the usage of a ephemeral Helm working directory
   *
   * @default true
   */
  useEphemeralHelmWorkingDir?: boolean;
  /**
   * Annotations to be added to repo server Deployment
   *
   * @default {}
   */
  deploymentAnnotations?: ArgocdHelmValuesRepoServerDeploymentAnnotations;
  /**
   * Labels for the repo server Deployment
   *
   * @default {}
   */
  deploymentLabels?: ArgocdHelmValuesRepoServerDeploymentLabels;
  /**
   * Annotations to be added to repo server pods
   *
   * @default {}
   */
  podAnnotations?: ArgocdHelmValuesRepoServerPodAnnotations;
  /**
   * Labels to be added to repo server pods
   *
   * @default {}
   */
  podLabels?: ArgocdHelmValuesRepoServerPodLabels;
  /**
   * Resource limits and requests for the repo server pods
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesRepoServerResources;
  /**
   * Repo server container ports
   *
   * @default {"server":8081,"metrics":8084}
   */
  containerPorts?: ArgocdHelmValuesRepoServerContainerPorts;
  /**
   * Host Network for Repo server pods
   * [DNS configuration]
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * @default {}
   */
  dnsConfig?: ArgocdHelmValuesRepoServerDnsConfig;
  /**
   * Alternative DNS policy for Repo server pods
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Repo server container-level security context
   *
   * @default {...} (5 keys)
   */
  containerSecurityContext?: ArgocdHelmValuesRepoServerContainerSecurityContext;
  /**
   * Readiness and liveness probes for Repo Server
   * Ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: ArgocdHelmValuesRepoServerReadinessProbe;
  /**
   * @default {...} (6 keys)
   */
  livenessProbe?: ArgocdHelmValuesRepoServerLivenessProbe;
  /**
   * terminationGracePeriodSeconds for container lifecycle hook
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * [Node selector]
   *
   * @default {}
   */
  nodeSelector?: ArgocdHelmValuesRepoServerNodeSelector;
  tolerations?: unknown[];
  /**
   * Assign custom [affinity] rules to the deployment
   *
   * @default {}
   */
  affinity?: ArgocdHelmValuesRepoServerAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Deployment strategy to be added to the repo server Deployment
   *
   * @default {}
   */
  deploymentStrategy?: ArgocdHelmValuesRepoServerDeploymentStrategy;
  /**
   * Priority class for the repo server pods
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * @default {...} (6 keys)
   */
  certificateSecret?: ArgocdHelmValuesRepoServerCertificateSecret;
  /**
   * Repo server service configuration
   *
   * @default {...} (5 keys)
   */
  service?: ArgocdHelmValuesRepoServerService;
  /**
   * Repo server metrics service configuration
   *
   * @default {"enabled":false,"service":{"type":"ClusterIP","clusterIP":"","annotations":{},"labels":{},"servicePort":8084,"portName":"http-metrics"},"serviceMonitor":{"enabled":false,"interval":"30s","scrapeTimeout":"","honorLabels":false,"relabelings":[],"metricRelabelings":[],"selector":{},"scheme":"","tlsConfig":{},"namespace":"","additionalLabels":{},"annotations":{}}}
   */
  metrics?: ArgocdHelmValuesRepoServerMetrics;
  /**
   * Enable Custom Rules for the Repo server's Cluster Role resource
   * Enable this and set the rules: to whatever custom rules you want for the Cluster Role resource.
   * Defaults to off
   *
   * @default {"enabled":false,"rules":[]}
   */
  clusterRoleRules?: ArgocdHelmValuesRepoServerClusterRoleRules;
  /**
   * Automount API credentials for the Service Account into the pod.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * Repo server service account
   * If create is set to true, make sure to uncomment the name and update the rbac section below
   *
   * @default {...} (5 keys)
   */
  serviceAccount?: ArgocdHelmValuesRepoServerServiceAccount;
  rbac?: unknown[];
  /**
   * Default repo server's network policy
   *
   * @default {"create":false}
   */
  networkPolicy?: ArgocdHelmValuesRepoServerNetworkPolicy;
};

export type ArgocdHelmValuesRepoServerAutoscaling = {
  /**
   * Enable Horizontal Pod Autoscaler ([HPA]) for the repo server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Minimum number of replicas for the repo server [HPA]
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum number of replicas for the repo server [HPA]
   *
   * @default 5
   */
  maxReplicas?: number;
  /**
   * Average CPU utilization percentage for the repo server [HPA]
   *
   * @default 50
   */
  targetCPUUtilizationPercentage?: number;
  /**
   * Average memory utilization percentage for the repo server [HPA]
   *
   * @default 50
   */
  targetMemoryUtilizationPercentage?: number;
  /**
   * Configures the scaling behavior of the target in both Up and Down directions.
   *
   * @default {}
   */
  behavior?: ArgocdHelmValuesRepoServerAutoscalingBehavior;
  metrics?: unknown[];
};

export type ArgocdHelmValuesRepoServerAutoscalingBehavior = object;

export type ArgocdHelmValuesRepoServerPdb = {
  /**
   * Deploy a [PodDisruptionBudget] for the repo server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Labels to be added to repo server pdb
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesRepoServerPdbLabels;
  /**
   * Annotations to be added to repo server pdb
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRepoServerPdbAnnotations;
  /**
   * Number of pods that are available after eviction as number or percentage (eg.: 50%)
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * Number of pods that are unavailable after eviction as number or percentage (eg.: 50%).
   * Has higher precedence over `repoServer.pdb.minAvailable`
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type ArgocdHelmValuesRepoServerPdbLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerPdbAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerImage = {
  /**
   * Repository to use for the repo server
   *
   * @default ""
   */
  repository?: string;
  /**
   * Tag to use for the repo server
   *
   * @default ""
   */
  tag?: string;
  /**
   * Image pull policy for the repo server
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesRepoServerLifecycle = object;

export type ArgocdHelmValuesRepoServerCopyutil = {
  /**
   * Resource limits and requests for the repo server copyutil initContainer
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesRepoServerCopyutilResources;
};

export type ArgocdHelmValuesRepoServerCopyutilResources = object;

export type ArgocdHelmValuesRepoServerExistingVolumes = object;

export type ArgocdHelmValuesRepoServerEmptyDir = {
  /**
   * EmptyDir size limit for repo server
   *
   * @default ""
   */
  sizeLimit?: string;
};

export type ArgocdHelmValuesRepoServerDeploymentAnnotations = object;

export type ArgocdHelmValuesRepoServerDeploymentLabels = object;

export type ArgocdHelmValuesRepoServerPodAnnotations = object;

export type ArgocdHelmValuesRepoServerPodLabels = object;

export type ArgocdHelmValuesRepoServerResources = object;

export type ArgocdHelmValuesRepoServerContainerPorts = {
  /**
   * Repo server container port
   *
   * @default 8081
   */
  server?: number;
  /**
   * Metrics container port
   *
   * @default 8084
   */
  metrics?: number;
};

export type ArgocdHelmValuesRepoServerDnsConfig = object;

export type ArgocdHelmValuesRepoServerContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdHelmValuesRepoServerContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ArgocdHelmValuesRepoServerContainerSecurityContextCapabilities;
};

export type ArgocdHelmValuesRepoServerContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesRepoServerContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesRepoServerReadinessProbe = {
  /**
   * Enable Kubernetes readiness probe for Repo Server
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
};

export type ArgocdHelmValuesRepoServerLivenessProbe = {
  /**
   * Enable Kubernetes liveness probe for Repo Server
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
};

export type ArgocdHelmValuesRepoServerNodeSelector = object;

export type ArgocdHelmValuesRepoServerAffinity = object;

export type ArgocdHelmValuesRepoServerDeploymentStrategy = object;

export type ArgocdHelmValuesRepoServerCertificateSecret = {
  /**
   * Create argocd-repo-server-tls secret
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Annotations to be added to argocd-repo-server-tls secret
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRepoServerCertificateSecretAnnotations;
  /**
   * Labels to be added to argocd-repo-server-tls secret
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesRepoServerCertificateSecretLabels;
  /**
   * Certificate authority. Required for self-signed certificates.
   *
   * @default ""
   */
  ca?: string;
  /**
   * Certificate private key
   *
   * @default ""
   */
  key?: string;
  /**
   * Certificate data. Must contain SANs of Repo service (ie: argocd-repo-server, argocd-repo-server.argo-cd.svc)
   *
   * @default ""
   */
  crt?: string;
};

export type ArgocdHelmValuesRepoServerCertificateSecretAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerCertificateSecretLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerService = {
  /**
   * Repo server service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRepoServerServiceAnnotations;
  /**
   * Repo server service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesRepoServerServiceLabels;
  /**
   * Repo server service port
   *
   * @default 8081
   */
  port?: number;
  /**
   * Repo server service port name
   *
   * @default "tcp-repo-server"
   */
  portName?: string;
  /**
   * Traffic distribution preference for the repo server service. If the field is not set, the implementation will apply its default routing strategy.
   *
   * @default ""
   */
  trafficDistribution?: string;
};

export type ArgocdHelmValuesRepoServerServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerMetrics = {
  /**
   * Deploy metrics service
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {...} (6 keys)
   */
  service?: ArgocdHelmValuesRepoServerMetricsService;
  /**
   * @default {...} (12 keys)
   */
  serviceMonitor?: ArgocdHelmValuesRepoServerMetricsServiceMonitor;
};

export type ArgocdHelmValuesRepoServerMetricsService = {
  /**
   * Metrics service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Metrics service clusterIP. `None` makes a "headless service" (no virtual IP)
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * Metrics service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRepoServerMetricsServiceAnnotations;
  /**
   * Metrics service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesRepoServerMetricsServiceLabels;
  /**
   * Metrics service port
   *
   * @default 8084
   */
  servicePort?: number;
  /**
   * Metrics service port name
   *
   * @default "http-metrics"
   */
  portName?: string;
};

export type ArgocdHelmValuesRepoServerMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerMetricsServiceMonitor = {
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
  /**
   * Prometheus ServiceMonitor scrapeTimeout. If empty, Prometheus uses the global scrape timeout unless it is less than the target's scrape interval value in which the latter is used.
   *
   * @default ""
   */
  scrapeTimeout?: string;
  /**
   * When true, honorLabels preserves the metric’s labels when they collide with the target’s labels.
   *
   * @default false
   */
  honorLabels?: boolean;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
  /**
   * Prometheus ServiceMonitor selector
   *
   * @default {}
   */
  selector?: ArgocdHelmValuesRepoServerMetricsServiceMonitorSelector;
  /**
   * Prometheus ServiceMonitor scheme
   *
   * @default ""
   */
  scheme?: string;
  /**
   * Prometheus ServiceMonitor tlsConfig
   *
   * @default {}
   */
  tlsConfig?: ArgocdHelmValuesRepoServerMetricsServiceMonitorTlsConfig;
  /**
   * Prometheus ServiceMonitor namespace
   * "monitoring"
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Prometheus ServiceMonitor labels
   *
   * @default {}
   */
  additionalLabels?: ArgocdHelmValuesRepoServerMetricsServiceMonitorAdditionalLabels;
  /**
   * Prometheus ServiceMonitor annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRepoServerMetricsServiceMonitorAnnotations;
};

export type ArgocdHelmValuesRepoServerMetricsServiceMonitorSelector = object;

export type ArgocdHelmValuesRepoServerMetricsServiceMonitorTlsConfig = object;

export type ArgocdHelmValuesRepoServerMetricsServiceMonitorAdditionalLabels = object;

export type ArgocdHelmValuesRepoServerMetricsServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerClusterRoleRules = {
  /**
   * Enable custom rules for the Repo server's Cluster Role resource
   *
   * @default false
   */
  enabled?: boolean;
  rules?: unknown[];
};

export type ArgocdHelmValuesRepoServerServiceAccount = {
  /**
   * Create repo server service account
   *
   * @default true
   */
  create?: boolean;
  /**
   * Repo server service account name
   * "argocd-repo-server"
   *
   * @default ""
   */
  name?: string;
  /**
   * Annotations applied to created service account
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesRepoServerServiceAccountAnnotations;
  /**
   * Labels applied to created service account
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesRepoServerServiceAccountLabels;
  /**
   * Automount API credentials for the Service Account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type ArgocdHelmValuesRepoServerServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerServiceAccountLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesRepoServerNetworkPolicy = {
  /**
   * Default network policy rules used by repo server
   *
   * @default false
   */
  create?: boolean;
};

export type ArgocdHelmValuesApplicationSet = {
  /**
   * ApplicationSet controller name string
   *
   * @default "applicationset-controller"
   */
  name?: string;
  /**
   * The number of ApplicationSet controller pods to run
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Runtime class name for the ApplicationSet controller
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * ApplicationSet controller Pod Disruption Budget
   * Ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {...} (5 keys)
   */
  pdb?: ArgocdHelmValuesApplicationSetPdb;
  /**
   * ApplicationSet controller image
   *
   * @default {"repository":"","tag":"","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesApplicationSetImage;
  imagePullSecrets?: unknown[];
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraContainers?: unknown[];
  initContainers?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * ApplicationSet controller emptyDir volumes
   *
   * @default {"sizeLimit":""}
   */
  emptyDir?: ArgocdHelmValuesApplicationSetEmptyDir;
  /**
   * Metrics service configuration
   *
   * @default {"enabled":false,"service":{"type":"ClusterIP","clusterIP":"","annotations":{},"labels":{},"servicePort":8080,"portName":"http-metrics"},"serviceMonitor":{"enabled":false,"interval":"30s","scrapeTimeout":"","honorLabels":false,"relabelings":[],"metricRelabelings":[],"selector":{},"scheme":"","tlsConfig":{},"namespace":"","additionalLabels":{},"annotations":{}}}
   */
  metrics?: ArgocdHelmValuesApplicationSetMetrics;
  /**
   * ApplicationSet service configuration
   *
   * @default {...} (5 keys)
   */
  service?: ArgocdHelmValuesApplicationSetService;
  /**
   * Automount API credentials for the Service Account into the pod.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: ArgocdHelmValuesApplicationSetServiceAccount;
  /**
   * Annotations to be added to ApplicationSet controller Deployment
   *
   * @default {}
   */
  deploymentAnnotations?: ArgocdHelmValuesApplicationSetDeploymentAnnotations;
  /**
   * Labels for the ApplicationSet controller Deployment
   *
   * @default {}
   */
  deploymentLabels?: ArgocdHelmValuesApplicationSetDeploymentLabels;
  /**
   * Annotations for the ApplicationSet controller pods
   *
   * @default {}
   */
  podAnnotations?: ArgocdHelmValuesApplicationSetPodAnnotations;
  /**
   * Labels for the ApplicationSet controller pods
   *
   * @default {}
   */
  podLabels?: ArgocdHelmValuesApplicationSetPodLabels;
  /**
   * Resource limits and requests for the ApplicationSet controller pods.
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesApplicationSetResources;
  /**
   * ApplicationSet controller container ports
   *
   * @default {"metrics":8080,"probe":8081,"webhook":7000}
   */
  containerPorts?: ArgocdHelmValuesApplicationSetContainerPorts;
  /**
   * [DNS configuration]
   *
   * @default {}
   */
  dnsConfig?: ArgocdHelmValuesApplicationSetDnsConfig;
  /**
   * Alternative DNS policy for ApplicationSet controller pods
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * ApplicationSet controller container-level security context
   *
   * @default {...} (5 keys)
   */
  containerSecurityContext?: ArgocdHelmValuesApplicationSetContainerSecurityContext;
  /**
   * Probes for ApplicationSet controller (optional)
   * Ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: ArgocdHelmValuesApplicationSetReadinessProbe;
  /**
   * @default {...} (6 keys)
   */
  livenessProbe?: ArgocdHelmValuesApplicationSetLivenessProbe;
  /**
   * terminationGracePeriodSeconds for container lifecycle hook
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * [Node selector]
   *
   * @default {}
   */
  nodeSelector?: ArgocdHelmValuesApplicationSetNodeSelector;
  tolerations?: unknown[];
  /**
   * Assign custom [affinity] rules
   *
   * @default {}
   */
  affinity?: ArgocdHelmValuesApplicationSetAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Deployment strategy to be added to the ApplicationSet controller Deployment
   *
   * @default {}
   */
  deploymentStrategy?: ArgocdHelmValuesApplicationSetDeploymentStrategy;
  /**
   * Priority class for the ApplicationSet controller pods
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Ref: https://argo-cd.readthedocs.io/en/stable/operator-manual/tls/#tls-configuration
   *
   * @default {...} (8 keys)
   */
  certificate?: ArgocdHelmValuesApplicationSetCertificate;
  /**
   * Ingress for the Git Generator webhook
   * Ref: https://argocd-applicationset.readthedocs.io/en/master/Generators-Git/#webhook-configuration)
   *
   * @default {...} (12 keys)
   */
  ingress?: ArgocdHelmValuesApplicationSetIngress;
  /**
   * Enable ApplicationSet in any namespace feature
   *
   * @default false
   */
  allowAnyNamespace?: boolean;
  /**
   * Default ApplicationSet controller's network policy
   *
   * @default {"create":false}
   */
  networkPolicy?: ArgocdHelmValuesApplicationSetNetworkPolicy;
};

export type ArgocdHelmValuesApplicationSetPdb = {
  /**
   * Deploy a [PodDisruptionBudget] for the ApplicationSet controller
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Labels to be added to ApplicationSet controller pdb
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesApplicationSetPdbLabels;
  /**
   * Annotations to be added to ApplicationSet controller pdb
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesApplicationSetPdbAnnotations;
  /**
   * Number of pods that are available after eviction as number or percentage (eg.: 50%)
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * Number of pods that are unavailable after eviction as number or percentage (eg.: 50%).
   * Has higher precedence over `applicationSet.pdb.minAvailable`
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type ArgocdHelmValuesApplicationSetPdbLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetPdbAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetImage = {
  /**
   * Repository to use for the ApplicationSet controller
   *
   * @default ""
   */
  repository?: string;
  /**
   * Tag to use for the ApplicationSet controller
   *
   * @default ""
   */
  tag?: string;
  /**
   * Image pull policy for the ApplicationSet controller
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesApplicationSetEmptyDir = {
  /**
   * EmptyDir size limit for applicationSet controller
   *
   * @default ""
   */
  sizeLimit?: string;
};

export type ArgocdHelmValuesApplicationSetMetrics = {
  /**
   * Deploy metrics service
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {...} (6 keys)
   */
  service?: ArgocdHelmValuesApplicationSetMetricsService;
  /**
   * @default {...} (12 keys)
   */
  serviceMonitor?: ArgocdHelmValuesApplicationSetMetricsServiceMonitor;
};

export type ArgocdHelmValuesApplicationSetMetricsService = {
  /**
   * Metrics service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Metrics service clusterIP. `None` makes a "headless service" (no virtual IP)
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * Metrics service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesApplicationSetMetricsServiceAnnotations;
  /**
   * Metrics service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesApplicationSetMetricsServiceLabels;
  /**
   * Metrics service port
   *
   * @default 8080
   */
  servicePort?: number;
  /**
   * Metrics service port name
   *
   * @default "http-metrics"
   */
  portName?: string;
};

export type ArgocdHelmValuesApplicationSetMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetMetricsServiceMonitor = {
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
  /**
   * Prometheus ServiceMonitor scrapeTimeout. If empty, Prometheus uses the global scrape timeout unless it is less than the target's scrape interval value in which the latter is used.
   *
   * @default ""
   */
  scrapeTimeout?: string;
  /**
   * When true, honorLabels preserves the metric’s labels when they collide with the target’s labels.
   *
   * @default false
   */
  honorLabels?: boolean;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
  /**
   * Prometheus ServiceMonitor selector
   *
   * @default {}
   */
  selector?: ArgocdHelmValuesApplicationSetMetricsServiceMonitorSelector;
  /**
   * Prometheus ServiceMonitor scheme
   *
   * @default ""
   */
  scheme?: string;
  /**
   * Prometheus ServiceMonitor tlsConfig
   *
   * @default {}
   */
  tlsConfig?: ArgocdHelmValuesApplicationSetMetricsServiceMonitorTlsConfig;
  /**
   * Prometheus ServiceMonitor namespace
   * monitoring
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Prometheus ServiceMonitor labels
   *
   * @default {}
   */
  additionalLabels?: ArgocdHelmValuesApplicationSetMetricsServiceMonitorAdditionalLabels;
  /**
   * Prometheus ServiceMonitor annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesApplicationSetMetricsServiceMonitorAnnotations;
};

export type ArgocdHelmValuesApplicationSetMetricsServiceMonitorSelector = object;

export type ArgocdHelmValuesApplicationSetMetricsServiceMonitorTlsConfig = object;

export type ArgocdHelmValuesApplicationSetMetricsServiceMonitorAdditionalLabels = object;

export type ArgocdHelmValuesApplicationSetMetricsServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetService = {
  /**
   * ApplicationSet service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesApplicationSetServiceAnnotations;
  /**
   * ApplicationSet service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesApplicationSetServiceLabels;
  /**
   * ApplicationSet service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * ApplicationSet service port
   *
   * @default 7000
   */
  port?: number;
  /**
   * ApplicationSet service port name
   *
   * @default "http-webhook"
   */
  portName?: string;
};

export type ArgocdHelmValuesApplicationSetServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetServiceAccount = {
  /**
   * Create ApplicationSet controller service account
   *
   * @default true
   */
  create?: boolean;
  /**
   * ApplicationSet controller service account name
   *
   * @default "argocd-applicationset-controller"
   */
  name?: string;
  /**
   * Annotations applied to created service account
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesApplicationSetServiceAccountAnnotations;
  /**
   * Labels applied to created service account
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesApplicationSetServiceAccountLabels;
  /**
   * Automount API credentials for the Service Account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type ArgocdHelmValuesApplicationSetServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetServiceAccountLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetDeploymentAnnotations = object;

export type ArgocdHelmValuesApplicationSetDeploymentLabels = object;

export type ArgocdHelmValuesApplicationSetPodAnnotations = object;

export type ArgocdHelmValuesApplicationSetPodLabels = object;

export type ArgocdHelmValuesApplicationSetResources = object;

export type ArgocdHelmValuesApplicationSetContainerPorts = {
  /**
   * Metrics container port
   *
   * @default 8080
   */
  metrics?: number;
  /**
   * Probe container port
   *
   * @default 8081
   */
  probe?: number;
  /**
   * Webhook container port
   *
   * @default 7000
   */
  webhook?: number;
};

export type ArgocdHelmValuesApplicationSetDnsConfig = object;

export type ArgocdHelmValuesApplicationSetContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdHelmValuesApplicationSetContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ArgocdHelmValuesApplicationSetContainerSecurityContextCapabilities;
};

export type ArgocdHelmValuesApplicationSetContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesApplicationSetContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesApplicationSetReadinessProbe = {
  /**
   * Enable Kubernetes liveness probe for ApplicationSet controller
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
};

export type ArgocdHelmValuesApplicationSetLivenessProbe = {
  /**
   * Enable Kubernetes liveness probe for ApplicationSet controller
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
};

export type ArgocdHelmValuesApplicationSetNodeSelector = object;

export type ArgocdHelmValuesApplicationSetAffinity = object;

export type ArgocdHelmValuesApplicationSetDeploymentStrategy = object;

export type ArgocdHelmValuesApplicationSetCertificate = {
  /**
   * Deploy a Certificate resource (requires cert-manager)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Certificate primary domain (commonName)
   *
   * @default ""
   */
  domain?: string;
  additionalHosts?: unknown[];
  /**
   * The requested 'duration' (i.e. lifetime) of the certificate.
   * Ref: https://cert-manager.io/docs/usage/certificate/#renewal
   *
   * @default ""
   */
  duration?: string;
  /**
   * How long before the expiry a certificate should be renewed.
   * Ref: https://cert-manager.io/docs/usage/certificate/#renewal
   *
   * @default ""
   */
  renewBefore?: string;
  /**
   * Ref: https://cert-manager.io/docs/concepts/issuer
   *
   * @default {"group":"","kind":"","name":""}
   */
  issuer?: ArgocdHelmValuesApplicationSetCertificateIssuer;
  /**
   * Private key of the certificate
   *
   * @default {...} (4 keys)
   */
  privateKey?: ArgocdHelmValuesApplicationSetCertificatePrivateKey;
  /**
   * Annotations to be applied to the ApplicationSet Certificate
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesApplicationSetCertificateAnnotations;
};

export type ArgocdHelmValuesApplicationSetCertificateIssuer = {
  /**
   * Certificate issuer group. Set if using an external issuer. Eg. `cert-manager.io`
   *
   * @default ""
   */
  group?: string;
  /**
   * Certificate issuer kind. Either `Issuer` or `ClusterIssuer`
   *
   * @default ""
   */
  kind?: string;
  /**
   * Certificate issuer name. Eg. `letsencrypt`
   *
   * @default ""
   */
  name?: string;
};

export type ArgocdHelmValuesApplicationSetCertificatePrivateKey = {
  /**
   * Rotation policy of private key when certificate is re-issued. Either: `Never` or `Always`
   *
   * @default "Never"
   */
  rotationPolicy?: string;
  /**
   * The private key cryptography standards (PKCS) encoding for private key. Either: `PCKS1` or `PKCS8`
   *
   * @default "PKCS1"
   */
  encoding?: string;
  /**
   * Algorithm used to generate certificate private key. One of: `RSA`, `Ed25519` or `ECDSA`
   *
   * @default "RSA"
   */
  algorithm?: string;
  /**
   * Key bit size of the private key. If algorithm is set to `Ed25519`, size is ignored.
   *
   * @default 2048
   */
  size?: number;
};

export type ArgocdHelmValuesApplicationSetCertificateAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetIngress = {
  /**
   * Enable an ingress resource for ApplicationSet webhook
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional ingress labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesApplicationSetIngressLabels;
  /**
   * Additional ingress annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesApplicationSetIngressAnnotations;
  /**
   * Defines which ingress ApplicationSet controller will implement the resource
   *
   * @default ""
   */
  ingressClassName?: string;
  /**
   * Argo CD ApplicationSet hostname
   *
   * @default ""
   */
  hostname?: string;
  /**
   * List of ingress paths
   *
   * @default "/api/webhook"
   */
  path?: string;
  /**
   * Ingress path type. One of `Exact`, `Prefix` or `ImplementationSpecific`
   *
   * @default "Prefix"
   */
  pathType?: string;
  /**
   * Enable TLS configuration for the hostname defined at `applicationSet.webhook.ingress.hostname`
   * TLS certificate will be retrieved from a TLS secret with name:`argocd-applicationset-controller-tls`
   *
   * @default false
   */
  tls?: boolean;
  extraHosts?: unknown[];
  extraPaths?: unknown[];
  extraRules?: unknown[];
  extraTls?: unknown[];
};

export type ArgocdHelmValuesApplicationSetIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesApplicationSetNetworkPolicy = {
  /**
   * Default network policy rules used by ApplicationSet controller
   *
   * @default false
   */
  create?: boolean;
};

export type ArgocdHelmValuesNotifications = {
  /**
   * Enable notifications controller
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Notifications controller name string
   *
   * @default "notifications-controller"
   */
  name?: string;
  /**
   * Argo CD dashboard url; used in place of {{.context.argocdUrl}} in templates
   *
   * @default ""
   */
  argocdUrl?: string;
  /**
   * Runtime class name for the notifications controller
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * Notifications controller Pod Disruption Budget
   * Ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {...} (5 keys)
   */
  pdb?: ArgocdHelmValuesNotificationsPdb;
  /**
   * Notifications controller image
   *
   * @default {"repository":"","tag":"","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesNotificationsImage;
  imagePullSecrets?: unknown[];
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraContainers?: unknown[];
  initContainers?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * Define user-defined context
   * For more information: https://argo-cd.readthedocs.io/en/stable/operator-manual/notifications/templates/#defining-user-defined-context
   *
   * @default {}
   */
  context?: ArgocdHelmValuesNotificationsContext;
  /**
   * @default {...} (5 keys)
   */
  secret?: ArgocdHelmValuesNotificationsSecret;
  /**
   * @default {...} (4 keys)
   */
  metrics?: ArgocdHelmValuesNotificationsMetrics;
  /**
   * Configures notification services such as slack, email or custom webhook
   * For more information: https://argo-cd.readthedocs.io/en/stable/operator-manual/notifications/services/overview/
   *
   * @default {}
   */
  notifiers?: ArgocdHelmValuesNotificationsNotifiers;
  /**
   * Annotations to be applied to the notifications controller Deployment
   *
   * @default {}
   */
  deploymentAnnotations?: ArgocdHelmValuesNotificationsDeploymentAnnotations;
  /**
   * Labels for the notifications controller Deployment
   *
   * @default {}
   */
  deploymentLabels?: ArgocdHelmValuesNotificationsDeploymentLabels;
  /**
   * Annotations to be applied to the notifications controller Pods
   *
   * @default {}
   */
  podAnnotations?: ArgocdHelmValuesNotificationsPodAnnotations;
  /**
   * Labels to be applied to the notifications controller Pods
   *
   * @default {}
   */
  podLabels?: ArgocdHelmValuesNotificationsPodLabels;
  /**
   * Resource limits and requests for the notifications controller
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesNotificationsResources;
  /**
   * Notification controller container ports
   *
   * @default {"metrics":9001}
   */
  containerPorts?: ArgocdHelmValuesNotificationsContainerPorts;
  /**
   * [DNS configuration]
   *
   * @default {}
   */
  dnsConfig?: ArgocdHelmValuesNotificationsDnsConfig;
  /**
   * Alternative DNS policy for notifications controller Pods
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * Notification controller container-level security Context
   *
   * @default {...} (5 keys)
   */
  containerSecurityContext?: ArgocdHelmValuesNotificationsContainerSecurityContext;
  /**
   * Probes for notifications controller Pods (optional)
   * Ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: ArgocdHelmValuesNotificationsReadinessProbe;
  /**
   * @default {...} (6 keys)
   */
  livenessProbe?: ArgocdHelmValuesNotificationsLivenessProbe;
  /**
   * terminationGracePeriodSeconds for container lifecycle hook
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * [Node selector]
   *
   * @default {}
   */
  nodeSelector?: ArgocdHelmValuesNotificationsNodeSelector;
  tolerations?: unknown[];
  /**
   * Assign custom [affinity] rules
   *
   * @default {}
   */
  affinity?: ArgocdHelmValuesNotificationsAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Deployment strategy to be added to the notifications controller Deployment
   *
   * @default {"type":"Recreate"}
   */
  deploymentStrategy?: ArgocdHelmValuesNotificationsDeploymentStrategy;
  /**
   * Priority class for the notifications controller pods
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Automount API credentials for the Service Account into the pod.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: ArgocdHelmValuesNotificationsServiceAccount;
  /**
   * @default {"create":true}
   */
  cm?: ArgocdHelmValuesNotificationsCm;
  /**
   * Enable this and set the rules: to whatever custom rules you want for the Cluster Role resource.
   * Defaults to off
   *
   * @default {"rules":[]}
   */
  clusterRoleRules?: ArgocdHelmValuesNotificationsClusterRoleRules;
  subscriptions?: unknown[];
  /**
   * The notification template is used to generate the notification content
   * For more information: https://argo-cd.readthedocs.io/en/stable/operator-manual/notifications/templates/
   *
   * @default {}
   */
  templates?: ArgocdHelmValuesNotificationsTemplates;
  /**
   * The trigger defines the condition when the notification should be sent
   * For more information: https://argo-cd.readthedocs.io/en/stable/operator-manual/notifications/triggers/
   *
   * @default {}
   */
  triggers?: ArgocdHelmValuesNotificationsTriggers;
  /**
   * For more information: https://argo-cd.readthedocs.io/en/stable/operator-manual/notifications/triggers/#default-triggers
   * Default notifications controller's network policy
   *
   * @default {"create":false}
   */
  networkPolicy?: ArgocdHelmValuesNotificationsNetworkPolicy;
};

export type ArgocdHelmValuesNotificationsPdb = {
  /**
   * Deploy a [PodDisruptionBudget] for the notifications controller
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Labels to be added to notifications controller pdb
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesNotificationsPdbLabels;
  /**
   * Annotations to be added to notifications controller pdb
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesNotificationsPdbAnnotations;
  /**
   * Number of pods that are available after eviction as number or percentage (eg.: 50%)
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * Number of pods that are unavailable after eviction as number or percentage (eg.: 50%).
   * Has higher precedence over `notifications.pdb.minAvailable`
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type ArgocdHelmValuesNotificationsPdbLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesNotificationsPdbAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesNotificationsImage = {
  /**
   * Repository to use for the notifications controller
   *
   * @default ""
   */
  repository?: string;
  /**
   * Tag to use for the notifications controller
   *
   * @default ""
   */
  tag?: string;
  /**
   * Image pull policy for the notifications controller
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesNotificationsContext = object;

export type ArgocdHelmValuesNotificationsSecret = {
  /**
   * Whether helm chart creates notifications controller secret
   * If true, will create a secret with the name below. Otherwise, will assume existence of a secret with that name.
   *
   * @default true
   */
  create?: boolean;
  /**
   * notifications controller Secret name
   *
   * @default "argocd-notifications-secret"
   */
  name?: string;
  /**
   * key:value pairs of annotations to be added to the secret
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesNotificationsSecretAnnotations;
  /**
   * key:value pairs of labels to be added to the secret
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesNotificationsSecretLabels;
  /**
   * Generic key:value pairs to be inserted into the secret
   * Can be used for templates, notification services etc. Some examples given below.
   * For more information: https://argo-cd.readthedocs.io/en/stable/operator-manual/notifications/services/overview/
   *
   * @default {}
   */
  items?: ArgocdHelmValuesNotificationsSecretItems;
};

export type ArgocdHelmValuesNotificationsSecretAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesNotificationsSecretLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesNotificationsSecretItems = object;

export type ArgocdHelmValuesNotificationsMetrics = {
  /**
   * Enables prometheus metrics server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Metrics port
   *
   * @default 9001
   */
  port?: number;
  /**
   * @default {...} (5 keys)
   */
  service?: ArgocdHelmValuesNotificationsMetricsService;
  /**
   * @default {...} (9 keys)
   */
  serviceMonitor?: ArgocdHelmValuesNotificationsMetricsServiceMonitor;
};

export type ArgocdHelmValuesNotificationsMetricsService = {
  /**
   * Metrics service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Metrics service clusterIP. `None` makes a "headless service" (no virtual IP)
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * Metrics service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesNotificationsMetricsServiceAnnotations;
  /**
   * Metrics service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesNotificationsMetricsServiceLabels;
  /**
   * Metrics service port name
   *
   * @default "http-metrics"
   */
  portName?: string;
};

export type ArgocdHelmValuesNotificationsMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesNotificationsMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesNotificationsMetricsServiceMonitor = {
  /**
   * Enable a prometheus ServiceMonitor
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Prometheus ServiceMonitor selector
   *
   * @default {}
   */
  selector?: ArgocdHelmValuesNotificationsMetricsServiceMonitorSelector;
  /**
   * Prometheus ServiceMonitor labels
   *
   * @default {}
   */
  additionalLabels?: ArgocdHelmValuesNotificationsMetricsServiceMonitorAdditionalLabels;
  /**
   * Prometheus ServiceMonitor annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesNotificationsMetricsServiceMonitorAnnotations;
  /**
   * Prometheus ServiceMonitor scheme
   *
   * @default ""
   */
  scheme?: string;
  /**
   * Prometheus ServiceMonitor tlsConfig
   *
   * @default {}
   */
  tlsConfig?: ArgocdHelmValuesNotificationsMetricsServiceMonitorTlsConfig;
  /**
   * When true, honorLabels preserves the metric’s labels when they collide with the target’s labels.
   *
   * @default false
   */
  honorLabels?: boolean;
  relabelings?: unknown[];
  metricRelabelings?: unknown[];
};

export type ArgocdHelmValuesNotificationsMetricsServiceMonitorSelector = object;

export type ArgocdHelmValuesNotificationsMetricsServiceMonitorAdditionalLabels = object;

export type ArgocdHelmValuesNotificationsMetricsServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesNotificationsMetricsServiceMonitorTlsConfig = object;

export type ArgocdHelmValuesNotificationsNotifiers = object;

export type ArgocdHelmValuesNotificationsDeploymentAnnotations = object;

export type ArgocdHelmValuesNotificationsDeploymentLabels = object;

export type ArgocdHelmValuesNotificationsPodAnnotations = object;

export type ArgocdHelmValuesNotificationsPodLabels = object;

export type ArgocdHelmValuesNotificationsResources = object;

export type ArgocdHelmValuesNotificationsContainerPorts = {
  /**
   * Metrics container port
   *
   * @default 9001
   */
  metrics?: number;
};

export type ArgocdHelmValuesNotificationsDnsConfig = object;

export type ArgocdHelmValuesNotificationsContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdHelmValuesNotificationsContainerSecurityContextSeccompProfile;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ArgocdHelmValuesNotificationsContainerSecurityContextCapabilities;
};

export type ArgocdHelmValuesNotificationsContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesNotificationsContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesNotificationsReadinessProbe = {
  /**
   * Enable Kubernetes liveness probe for notifications controller Pods
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
};

export type ArgocdHelmValuesNotificationsLivenessProbe = {
  /**
   * Enable Kubernetes liveness probe for notifications controller Pods
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Minimum consecutive successes for the [probe] to be considered successful after having failed
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
};

export type ArgocdHelmValuesNotificationsNodeSelector = object;

export type ArgocdHelmValuesNotificationsAffinity = object;

export type ArgocdHelmValuesNotificationsDeploymentStrategy = {
  /**
   * @default "Recreate"
   */
  type?: string;
};

export type ArgocdHelmValuesNotificationsServiceAccount = {
  /**
   * Create notifications controller service account
   *
   * @default true
   */
  create?: boolean;
  /**
   * Notification controller service account name
   *
   * @default "argocd-notifications-controller"
   */
  name?: string;
  /**
   * Annotations applied to created service account
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesNotificationsServiceAccountAnnotations;
  /**
   * Labels applied to created service account
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesNotificationsServiceAccountLabels;
  /**
   * Automount API credentials for the Service Account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type ArgocdHelmValuesNotificationsServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesNotificationsServiceAccountLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesNotificationsCm = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Whether helm chart creates notifications controller config map
   *
   * @default true
   */
  create?: boolean;
};

export type ArgocdHelmValuesNotificationsClusterRoleRules = {
  rules?: unknown[];
};

export type ArgocdHelmValuesNotificationsTemplates = object;

export type ArgocdHelmValuesNotificationsTriggers = object;

export type ArgocdHelmValuesNotificationsNetworkPolicy = {
  /**
   * Default network policy rules used by notifications controller
   *
   * @default false
   */
  create?: boolean;
};

export type ArgocdHelmValuesCommitServer = {
  /**
   * Enable commit server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Commit server name
   *
   * @default "commit-server"
   */
  name?: string;
  /**
   * Runtime class name for the commit server
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * commit server controller image
   *
   * @default {"repository":"","tag":"","imagePullPolicy":""}
   */
  image?: ArgocdHelmValuesCommitServerImage;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  extraEnvFrom?: unknown[];
  extraVolumeMounts?: unknown[];
  extraVolumes?: unknown[];
  /**
   * @default {"enabled":false,"service":{"type":"ClusterIP","clusterIP":"","annotations":{},"labels":{},"servicePort":8087,"portName":"metrics"}}
   */
  metrics?: ArgocdHelmValuesCommitServerMetrics;
  /**
   * commit server service configuration
   *
   * @default {...} (4 keys)
   */
  service?: ArgocdHelmValuesCommitServerService;
  /**
   * Automount API credentials for the Service Account into the pod.
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default {...} (5 keys)
   */
  serviceAccount?: ArgocdHelmValuesCommitServerServiceAccount;
  /**
   * Annotations to be added to commit server Deployment
   *
   * @default {}
   */
  deploymentAnnotations?: ArgocdHelmValuesCommitServerDeploymentAnnotations;
  /**
   * Labels for the commit server Deployment
   *
   * @default {}
   */
  deploymentLabels?: ArgocdHelmValuesCommitServerDeploymentLabels;
  /**
   * Annotations for the commit server pods
   *
   * @default {}
   */
  podAnnotations?: ArgocdHelmValuesCommitServerPodAnnotations;
  /**
   * Labels for the commit server pods
   *
   * @default {}
   */
  podLabels?: ArgocdHelmValuesCommitServerPodLabels;
  /**
   * Resource limits and requests for the commit server pods.
   *
   * @default {}
   */
  resources?: ArgocdHelmValuesCommitServerResources;
  /**
   * [DNS configuration]
   *
   * @default {}
   */
  dnsConfig?: ArgocdHelmValuesCommitServerDnsConfig;
  /**
   * Alternative DNS policy for commit server pods
   *
   * @default "ClusterFirst"
   */
  dnsPolicy?: string;
  /**
   * commit server container-level security context
   *
   * @default {...} (5 keys)
   */
  containerSecurityContext?: ArgocdHelmValuesCommitServerContainerSecurityContext;
  /**
   * Probes for commit server (optional)
   * Ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
   *
   * @default {...} (5 keys)
   */
  readinessProbe?: ArgocdHelmValuesCommitServerReadinessProbe;
  /**
   * @default {...} (5 keys)
   */
  livenessProbe?: ArgocdHelmValuesCommitServerLivenessProbe;
  /**
   * terminationGracePeriodSeconds for container lifecycle hook
   *
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
  /**
   * [Node selector]
   *
   * @default {}
   */
  nodeSelector?: ArgocdHelmValuesCommitServerNodeSelector;
  tolerations?: unknown[];
  /**
   * Assign custom [affinity] rules
   *
   * @default {}
   */
  affinity?: ArgocdHelmValuesCommitServerAffinity;
  topologySpreadConstraints?: unknown[];
  /**
   * Deployment strategy to be added to the commit server Deployment
   *
   * @default {}
   */
  deploymentStrategy?: ArgocdHelmValuesCommitServerDeploymentStrategy;
  /**
   * Priority class for the commit server pods
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Default commit server's network policy
   *
   * @default {"create":false}
   */
  networkPolicy?: ArgocdHelmValuesCommitServerNetworkPolicy;
};

export type ArgocdHelmValuesCommitServerImage = {
  /**
   * Repository to use for the commit server
   *
   * @default ""
   */
  repository?: string;
  /**
   * Tag to use for the commit server
   *
   * @default ""
   */
  tag?: string;
  /**
   * Image pull policy for the commit server
   *
   * @default ""
   */
  imagePullPolicy?: string;
};

export type ArgocdHelmValuesCommitServerMetrics = {
  /**
   * Enables prometheus metrics server
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {...} (6 keys)
   */
  service?: ArgocdHelmValuesCommitServerMetricsService;
};

export type ArgocdHelmValuesCommitServerMetricsService = {
  /**
   * Metrics service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Metrics service clusterIP. `None` makes a "headless service" (no virtual IP)
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * Metrics service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesCommitServerMetricsServiceAnnotations;
  /**
   * Metrics service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesCommitServerMetricsServiceLabels;
  /**
   * Metrics service port
   *
   * @default 8087
   */
  servicePort?: number;
  /**
   * Metrics service port name
   *
   * @default "metrics"
   */
  portName?: string;
};

export type ArgocdHelmValuesCommitServerMetricsServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesCommitServerMetricsServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesCommitServerService = {
  /**
   * commit server service annotations
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesCommitServerServiceAnnotations;
  /**
   * commit server service labels
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesCommitServerServiceLabels;
  /**
   * commit server service port
   *
   * @default 8086
   */
  port?: number;
  /**
   * commit server service port name
   *
   * @default "server"
   */
  portName?: string;
};

export type ArgocdHelmValuesCommitServerServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesCommitServerServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesCommitServerServiceAccount = {
  /**
   * Create commit server service account
   *
   * @default true
   */
  create?: boolean;
  /**
   * commit server service account name
   *
   * @default "argocd-commit-server"
   */
  name?: string;
  /**
   * Annotations applied to created service account
   *
   * @default {}
   */
  annotations?: ArgocdHelmValuesCommitServerServiceAccountAnnotations;
  /**
   * Labels applied to created service account
   *
   * @default {}
   */
  labels?: ArgocdHelmValuesCommitServerServiceAccountLabels;
  /**
   * Automount API credentials for the Service Account
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type ArgocdHelmValuesCommitServerServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesCommitServerServiceAccountLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ArgocdHelmValuesCommitServerDeploymentAnnotations = object;

export type ArgocdHelmValuesCommitServerDeploymentLabels = object;

export type ArgocdHelmValuesCommitServerPodAnnotations = object;

export type ArgocdHelmValuesCommitServerPodLabels = object;

export type ArgocdHelmValuesCommitServerResources = object;

export type ArgocdHelmValuesCommitServerDnsConfig = object;

export type ArgocdHelmValuesCommitServerContainerSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
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
  capabilities?: ArgocdHelmValuesCommitServerContainerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ArgocdHelmValuesCommitServerContainerSecurityContextSeccompProfile;
};

export type ArgocdHelmValuesCommitServerContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type ArgocdHelmValuesCommitServerContainerSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ArgocdHelmValuesCommitServerReadinessProbe = {
  /**
   * Enable Kubernetes liveness probe for commit server
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
};

export type ArgocdHelmValuesCommitServerLivenessProbe = {
  /**
   * Enable Kubernetes liveness probe for commit server
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Number of seconds after the container has started before [probe] is initiated
   *
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * How often (in seconds) to perform the [probe]
   *
   * @default 30
   */
  periodSeconds?: number;
  /**
   * Number of seconds after which the [probe] times out
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Minimum consecutive failures for the [probe] to be considered failed after having succeeded
   *
   * @default 3
   */
  failureThreshold?: number;
};

export type ArgocdHelmValuesCommitServerNodeSelector = object;

export type ArgocdHelmValuesCommitServerAffinity = object;

export type ArgocdHelmValuesCommitServerDeploymentStrategy = object;

export type ArgocdHelmValuesCommitServerNetworkPolicy = {
  /**
   * Default network policy rules used by commit server
   *
   * @default false
   */
  create?: boolean;
};

export type ArgocdHelmValues = {
  /**
   * Ref: https://github.com/argoproj/argo-cd
   * Provide a name in place of `argocd`
   *
   * @default "argocd"
   */
  nameOverride?: string;
  /**
   * String to fully override `"argo-cd.fullname"`
   *
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * Override the namespace
   *
   * @default ""
   */
  namespaceOverride?: string;
  /**
   * Override the Kubernetes version, which is used to evaluate certain manifests
   *
   * @default ""
   */
  kubeVersionOverride?: string;
  /**
   * Override APIVersions
   * If you want to template helm charts but cannot access k8s API server
   * you can set api versions here
   *
   * @default {}
   */
  apiVersionOverrides?: ArgocdHelmValuesApiVersionOverrides;
  /**
   * Create aggregated roles that extend existing cluster roles to interact with argo-cd resources
   * Ref: https://kubernetes.io/docs/reference/access-authn-authz/rbac/#aggregated-clusterroles
   *
   * @default false
   */
  createAggregateRoles?: boolean;
  /**
   * Create cluster roles for cluster-wide installation.
   * Used when you manage applications in the same cluster where Argo CD runs
   *
   * @default true
   */
  createClusterRoles?: boolean;
  /**
   * @default {"enabled":false}
   */
  openshift?: ArgocdHelmValuesOpenshift;
  /**
   * Custom resource configuration
   *
   * @default {...} (4 keys)
   */
  crds?: ArgocdHelmValuesCrds;
  /**
   * Globally shared configuration
   *
   * @default {...} (27 keys)
   */
  global?: ArgocdHelmValuesGlobal;
  /**
   * Argo Configs
   * background: linear-gradient(to bottom, #999, #777, #333, #222, #111);
   * }
   * Array of extra K8s manifests to deploy
   * Note: Supports use of custom Helm templates
   *
   * @default {...} (14 keys)
   */
  configs?: ArgocdHelmValuesConfigs;
  extraObjects?: unknown[];
  /**
   * Specific implementation for ingress controller. One of `generic`, `aws` or `gke`
   * Additional configuration might be required in related configuration sections
   *
   * @default {...} (42 keys)
   */
  controller?: ArgocdHelmValuesController;
  /**
   * Dex
   * DEPRECATED - Use configs.params to override
   * Dex log format. Either `text` or `json`
   * Dex log level. One of: `debug`, `info`, `warn`, `error`
   * Redis
   *
   * @default {...} (43 keys)
   */
  dex?: ArgocdHelmValuesDex;
  /**
   * Redis container port
   *
   * @default {...} (38 keys)
   */
  redis?: ArgocdHelmValuesRedis;
  /**
   * Redis-HA subchart replaces custom redis deployment when `redis-ha.enabled=true`
   * Ref: https://github.com/DandyDeveloper/charts/blob/master/charts/redis-ha/values.yaml
   *
   * @default {...} (14 keys)
   */
  "redis-ha"?: ArgocdHelmValuesRedisha;
  /**
   * External Redis parameters
   *
   * @default {...} (6 keys)
   */
  externalRedis?: ArgocdHelmValuesExternalRedis;
  /**
   * @default {...} (17 keys)
   */
  redisSecretInit?: ArgocdHelmValuesRedisSecretInit;
  /**
   * Server
   *
   * @default {...} (50 keys)
   */
  server?: ArgocdHelmValuesServer;
  /**
   * Repo Server
   *
   * @default {...} (46 keys)
   */
  repoServer?: ArgocdHelmValuesRepoServer;
  /**
   * ApplicationSet controller
   *
   * @default {...} (40 keys)
   */
  applicationSet?: ArgocdHelmValuesApplicationSet;
  /**
   * Notifications controller
   *
   * @default {...} (44 keys)
   */
  notifications?: ArgocdHelmValuesNotifications;
  /**
   * @default {...} (31 keys)
   */
  commitServer?: ArgocdHelmValuesCommitServer;
};

export type ArgocdHelmParameters = {
  nameOverride?: string;
  fullnameOverride?: string;
  namespaceOverride?: string;
  kubeVersionOverride?: string;
  createAggregateRoles?: string;
  createClusterRoles?: string;
  "openshift.enabled"?: string;
  "crds.install"?: string;
  "crds.keep"?: string;
  "global.domain"?: string;
  "global.runtimeClassName"?: string;
  "global.revisionHistoryLimit"?: string;
  "global.image.repository"?: string;
  "global.image.tag"?: string;
  "global.image.imagePullPolicy"?: string;
  "global.imagePullSecrets"?: string;
  "global.logging.format"?: string;
  "global.logging.level"?: string;
  "global.addPrometheusAnnotations"?: string;
  "global.hostAliases"?: string;
  "global.dualStack.ipFamilyPolicy"?: string;
  "global.dualStack.ipFamilies"?: string;
  "global.networkPolicy.create"?: string;
  "global.networkPolicy.defaultDenyIngress"?: string;
  "global.priorityClassName"?: string;
  "global.nodeSelector.kubernetes.io/os"?: string;
  "global.tolerations"?: string;
  "global.affinity.podAntiAffinity"?: string;
  "global.affinity.nodeAffinity.type"?: string;
  "global.affinity.nodeAffinity.matchExpressions"?: string;
  "global.topologySpreadConstraints"?: string;
  "global.env"?: string;
  "global.extraVolumes"?: string;
  "global.extraVolumeMounts"?: string;
  "configs.cm.create"?: string;
  "configs.cm.application.instanceLabelKey"?: string;
  "configs.cm.application.sync.impersonation.enabled"?: string;
  "configs.cm.exec.enabled"?: string;
  "configs.cm.admin.enabled"?: string;
  "configs.cm.timeout.reconciliation"?: string;
  "configs.cm.timeout.hard.reconciliation"?: string;
  "configs.cm.statusbadge.enabled"?: string;
  "configs.cm.resource.customizations.ignoreResourceUpdates.all"?: string;
  "configs.cm.resource.customizations.ignoreResourceUpdates.argoproj.io_Application"?: string;
  "configs.cm.resource.customizations.ignoreResourceUpdates.argoproj.io_Rollout"?: string;
  "configs.cm.resource.customizations.ignoreResourceUpdates.autoscaling_HorizontalPodAutoscaler"?: string;
  "configs.cm.resource.customizations.ignoreResourceUpdates.ConfigMap"?: string;
  "configs.cm.resource.customizations.ignoreResourceUpdates.apps_ReplicaSet"?: string;
  "configs.cm.resource.customizations.ignoreResourceUpdates.discovery.k8s.io_EndpointSlice"?: string;
  "configs.cm.resource.customizations.ignoreResourceUpdates.Endpoints"?: string;
  "configs.cm.resource.exclusions"?: string;
  "configs.params.create"?: string;
  "configs.rbac.create"?: string;
  "configs.rbac.policy.default"?: string;
  "configs.rbac.policy.csv"?: string;
  "configs.rbac.scopes"?: string;
  "configs.rbac.policy.matchMode"?: string;
  "configs.ssh.create"?: string;
  "configs.ssh.knownHosts"?: string;
  "configs.ssh.extraHosts"?: string;
  "configs.tls.create"?: string;
  "configs.cmp.create"?: string;
  "configs.secret.createSecret"?: string;
  "configs.secret.githubSecret"?: string;
  "configs.secret.gitlabSecret"?: string;
  "configs.secret.bitbucketServerSecret"?: string;
  "configs.secret.bitbucketUUID"?: string;
  "configs.secret.gogsSecret"?: string;
  "configs.secret.azureDevops.username"?: string;
  "configs.secret.azureDevops.password"?: string;
  "configs.secret.argocdServerAdminPassword"?: string;
  "configs.secret.argocdServerAdminPasswordMtime"?: string;
  "configs.styles"?: string;
  extraObjects?: string;
  "controller.name"?: string;
  "controller.replicas"?: string;
  "controller.dynamicClusterDistribution"?: string;
  "controller.runtimeClassName"?: string;
  "controller.heartbeatTime"?: string;
  "controller.revisionHistoryLimit"?: string;
  "controller.pdb.enabled"?: string;
  "controller.pdb.minAvailable"?: string;
  "controller.pdb.maxUnavailable"?: string;
  "controller.vpa.enabled"?: string;
  "controller.vpa.updateMode"?: string;
  "controller.image.repository"?: string;
  "controller.image.tag"?: string;
  "controller.image.imagePullPolicy"?: string;
  "controller.imagePullSecrets"?: string;
  "controller.extraArgs"?: string;
  "controller.env"?: string;
  "controller.envFrom"?: string;
  "controller.extraContainers"?: string;
  "controller.initContainers"?: string;
  "controller.volumeMounts"?: string;
  "controller.volumes"?: string;
  "controller.emptyDir.sizeLimit"?: string;
  "controller.containerPorts.metrics"?: string;
  "controller.hostNetwork"?: string;
  "controller.dnsPolicy"?: string;
  "controller.containerSecurityContext.runAsNonRoot"?: string;
  "controller.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "controller.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "controller.containerSecurityContext.seccompProfile.type"?: string;
  "controller.containerSecurityContext.capabilities.drop"?: string;
  "controller.readinessProbe.failureThreshold"?: string;
  "controller.readinessProbe.initialDelaySeconds"?: string;
  "controller.readinessProbe.periodSeconds"?: string;
  "controller.readinessProbe.successThreshold"?: string;
  "controller.readinessProbe.timeoutSeconds"?: string;
  "controller.terminationGracePeriodSeconds"?: string;
  "controller.priorityClassName"?: string;
  "controller.tolerations"?: string;
  "controller.topologySpreadConstraints"?: string;
  "controller.automountServiceAccountToken"?: string;
  "controller.serviceAccount.create"?: string;
  "controller.serviceAccount.name"?: string;
  "controller.serviceAccount.automountServiceAccountToken"?: string;
  "controller.metrics.enabled"?: string;
  "controller.metrics.scrapeTimeout"?: string;
  "controller.metrics.applicationLabels.enabled"?: string;
  "controller.metrics.applicationLabels.labels"?: string;
  "controller.metrics.service.type"?: string;
  "controller.metrics.service.clusterIP"?: string;
  "controller.metrics.service.servicePort"?: string;
  "controller.metrics.service.portName"?: string;
  "controller.metrics.serviceMonitor.enabled"?: string;
  "controller.metrics.serviceMonitor.interval"?: string;
  "controller.metrics.serviceMonitor.honorLabels"?: string;
  "controller.metrics.serviceMonitor.relabelings"?: string;
  "controller.metrics.serviceMonitor.metricRelabelings"?: string;
  "controller.metrics.serviceMonitor.scheme"?: string;
  "controller.metrics.serviceMonitor.namespace"?: string;
  "controller.metrics.rules.enabled"?: string;
  "controller.metrics.rules.namespace"?: string;
  "controller.metrics.rules.spec"?: string;
  "controller.clusterRoleRules.enabled"?: string;
  "controller.clusterRoleRules.rules"?: string;
  "controller.roleRules"?: string;
  "controller.networkPolicy.create"?: string;
  "dex.enabled"?: string;
  "dex.name"?: string;
  "dex.extraArgs"?: string;
  "dex.runtimeClassName"?: string;
  "dex.metrics.enabled"?: string;
  "dex.metrics.service.portName"?: string;
  "dex.metrics.serviceMonitor.enabled"?: string;
  "dex.metrics.serviceMonitor.interval"?: string;
  "dex.metrics.serviceMonitor.honorLabels"?: string;
  "dex.metrics.serviceMonitor.relabelings"?: string;
  "dex.metrics.serviceMonitor.metricRelabelings"?: string;
  "dex.metrics.serviceMonitor.scheme"?: string;
  "dex.metrics.serviceMonitor.namespace"?: string;
  "dex.pdb.enabled"?: string;
  "dex.pdb.minAvailable"?: string;
  "dex.pdb.maxUnavailable"?: string;
  "dex.image.repository"?: string;
  "dex.image.tag"?: string;
  "dex.image.imagePullPolicy"?: string;
  "dex.imagePullSecrets"?: string;
  "dex.initImage.repository"?: string;
  "dex.initImage.tag"?: string;
  "dex.initImage.imagePullPolicy"?: string;
  "dex.env"?: string;
  "dex.envFrom"?: string;
  "dex.extraContainers"?: string;
  "dex.initContainers"?: string;
  "dex.volumeMounts"?: string;
  "dex.volumes"?: string;
  "dex.emptyDir.sizeLimit"?: string;
  "dex.certificateSecret.enabled"?: string;
  "dex.certificateSecret.ca"?: string;
  "dex.certificateSecret.key"?: string;
  "dex.certificateSecret.crt"?: string;
  "dex.containerPorts.http"?: string;
  "dex.containerPorts.grpc"?: string;
  "dex.containerPorts.metrics"?: string;
  "dex.dnsPolicy"?: string;
  "dex.containerSecurityContext.runAsNonRoot"?: string;
  "dex.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "dex.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "dex.containerSecurityContext.seccompProfile.type"?: string;
  "dex.containerSecurityContext.capabilities.drop"?: string;
  "dex.livenessProbe.enabled"?: string;
  "dex.livenessProbe.httpPath"?: string;
  "dex.livenessProbe.httpPort"?: string;
  "dex.livenessProbe.httpScheme"?: string;
  "dex.livenessProbe.failureThreshold"?: string;
  "dex.livenessProbe.initialDelaySeconds"?: string;
  "dex.livenessProbe.periodSeconds"?: string;
  "dex.livenessProbe.successThreshold"?: string;
  "dex.livenessProbe.timeoutSeconds"?: string;
  "dex.readinessProbe.enabled"?: string;
  "dex.readinessProbe.httpPath"?: string;
  "dex.readinessProbe.httpPort"?: string;
  "dex.readinessProbe.httpScheme"?: string;
  "dex.readinessProbe.failureThreshold"?: string;
  "dex.readinessProbe.initialDelaySeconds"?: string;
  "dex.readinessProbe.periodSeconds"?: string;
  "dex.readinessProbe.successThreshold"?: string;
  "dex.readinessProbe.timeoutSeconds"?: string;
  "dex.terminationGracePeriodSeconds"?: string;
  "dex.automountServiceAccountToken"?: string;
  "dex.serviceAccount.create"?: string;
  "dex.serviceAccount.name"?: string;
  "dex.serviceAccount.automountServiceAccountToken"?: string;
  "dex.servicePortHttp"?: string;
  "dex.servicePortHttpName"?: string;
  "dex.servicePortGrpc"?: string;
  "dex.servicePortGrpcName"?: string;
  "dex.servicePortMetrics"?: string;
  "dex.priorityClassName"?: string;
  "dex.tolerations"?: string;
  "dex.topologySpreadConstraints"?: string;
  "dex.networkPolicy.create"?: string;
  "redis.enabled"?: string;
  "redis.name"?: string;
  "redis.runtimeClassName"?: string;
  "redis.pdb.enabled"?: string;
  "redis.pdb.minAvailable"?: string;
  "redis.pdb.maxUnavailable"?: string;
  "redis.image.repository"?: string;
  "redis.image.tag"?: string;
  "redis.image.imagePullPolicy"?: string;
  "redis.exporter.enabled"?: string;
  "redis.exporter.env"?: string;
  "redis.exporter.image.repository"?: string;
  "redis.exporter.image.tag"?: string;
  "redis.exporter.image.imagePullPolicy"?: string;
  "redis.exporter.containerSecurityContext.runAsNonRoot"?: string;
  "redis.exporter.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "redis.exporter.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "redis.exporter.containerSecurityContext.seccompProfile.type"?: string;
  "redis.exporter.containerSecurityContext.capabilities.drop"?: string;
  "redis.exporter.readinessProbe.enabled"?: string;
  "redis.exporter.readinessProbe.initialDelaySeconds"?: string;
  "redis.exporter.readinessProbe.periodSeconds"?: string;
  "redis.exporter.readinessProbe.timeoutSeconds"?: string;
  "redis.exporter.readinessProbe.successThreshold"?: string;
  "redis.exporter.readinessProbe.failureThreshold"?: string;
  "redis.exporter.livenessProbe.enabled"?: string;
  "redis.exporter.livenessProbe.initialDelaySeconds"?: string;
  "redis.exporter.livenessProbe.periodSeconds"?: string;
  "redis.exporter.livenessProbe.timeoutSeconds"?: string;
  "redis.exporter.livenessProbe.successThreshold"?: string;
  "redis.exporter.livenessProbe.failureThreshold"?: string;
  "redis.imagePullSecrets"?: string;
  "redis.extraArgs"?: string;
  "redis.env"?: string;
  "redis.envFrom"?: string;
  "redis.readinessProbe.enabled"?: string;
  "redis.readinessProbe.initialDelaySeconds"?: string;
  "redis.readinessProbe.periodSeconds"?: string;
  "redis.readinessProbe.timeoutSeconds"?: string;
  "redis.readinessProbe.successThreshold"?: string;
  "redis.readinessProbe.failureThreshold"?: string;
  "redis.livenessProbe.enabled"?: string;
  "redis.livenessProbe.initialDelaySeconds"?: string;
  "redis.livenessProbe.periodSeconds"?: string;
  "redis.livenessProbe.timeoutSeconds"?: string;
  "redis.livenessProbe.successThreshold"?: string;
  "redis.livenessProbe.failureThreshold"?: string;
  "redis.extraContainers"?: string;
  "redis.initContainers"?: string;
  "redis.volumeMounts"?: string;
  "redis.volumes"?: string;
  "redis.securityContext.runAsNonRoot"?: string;
  "redis.securityContext.runAsUser"?: string;
  "redis.securityContext.seccompProfile.type"?: string;
  "redis.containerPorts.redis"?: string;
  "redis.containerPorts.metrics"?: string;
  "redis.dnsPolicy"?: string;
  "redis.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "redis.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "redis.containerSecurityContext.capabilities.drop"?: string;
  "redis.servicePort"?: string;
  "redis.priorityClassName"?: string;
  "redis.tolerations"?: string;
  "redis.topologySpreadConstraints"?: string;
  "redis.terminationGracePeriodSeconds"?: string;
  "redis.automountServiceAccountToken"?: string;
  "redis.serviceAccount.create"?: string;
  "redis.serviceAccount.name"?: string;
  "redis.serviceAccount.automountServiceAccountToken"?: string;
  "redis.metrics.enabled"?: string;
  "redis.metrics.service.type"?: string;
  "redis.metrics.service.clusterIP"?: string;
  "redis.metrics.service.servicePort"?: string;
  "redis.metrics.service.portName"?: string;
  "redis.metrics.serviceMonitor.enabled"?: string;
  "redis.metrics.serviceMonitor.interval"?: string;
  "redis.metrics.serviceMonitor.honorLabels"?: string;
  "redis.metrics.serviceMonitor.relabelings"?: string;
  "redis.metrics.serviceMonitor.metricRelabelings"?: string;
  "redis.metrics.serviceMonitor.scheme"?: string;
  "redis.metrics.serviceMonitor.namespace"?: string;
  "redis.networkPolicy.create"?: string;
  "redis-ha.enabled"?: string;
  "redis-ha.image.repository"?: string;
  "redis-ha.image.tag"?: string;
  "redis-ha.exporter.enabled"?: string;
  "redis-ha.exporter.image"?: string;
  "redis-ha.exporter.tag"?: string;
  "redis-ha.persistentVolume.enabled"?: string;
  "redis-ha.redis.masterGroupName"?: string;
  "redis-ha.redis.config.save"?: string;
  "redis-ha.haproxy.enabled"?: string;
  "redis-ha.haproxy.labels.app.kubernetes.io/name"?: string;
  "redis-ha.haproxy.image.repository"?: string;
  "redis-ha.haproxy.metrics.enabled"?: string;
  "redis-ha.haproxy.hardAntiAffinity"?: string;
  "redis-ha.haproxy.affinity"?: string;
  "redis-ha.haproxy.tolerations"?: string;
  "redis-ha.haproxy.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "redis-ha.auth"?: string;
  "redis-ha.existingSecret"?: string;
  "redis-ha.hardAntiAffinity"?: string;
  "redis-ha.affinity"?: string;
  "redis-ha.tolerations"?: string;
  "redis-ha.topologySpreadConstraints.enabled"?: string;
  "redis-ha.topologySpreadConstraints.maxSkew"?: string;
  "redis-ha.topologySpreadConstraints.topologyKey"?: string;
  "redis-ha.topologySpreadConstraints.whenUnsatisfiable"?: string;
  "redis-ha.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "externalRedis.host"?: string;
  "externalRedis.username"?: string;
  "externalRedis.password"?: string;
  "externalRedis.port"?: string;
  "externalRedis.existingSecret"?: string;
  "redisSecretInit.enabled"?: string;
  "redisSecretInit.name"?: string;
  "redisSecretInit.image.repository"?: string;
  "redisSecretInit.image.tag"?: string;
  "redisSecretInit.image.imagePullPolicy"?: string;
  "redisSecretInit.extraArgs"?: string;
  "redisSecretInit.imagePullSecrets"?: string;
  "redisSecretInit.runtimeClassName"?: string;
  "redisSecretInit.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "redisSecretInit.containerSecurityContext.capabilities.drop"?: string;
  "redisSecretInit.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "redisSecretInit.containerSecurityContext.runAsNonRoot"?: string;
  "redisSecretInit.containerSecurityContext.seccompProfile.type"?: string;
  "redisSecretInit.serviceAccount.create"?: string;
  "redisSecretInit.serviceAccount.name"?: string;
  "redisSecretInit.serviceAccount.automountServiceAccountToken"?: string;
  "redisSecretInit.priorityClassName"?: string;
  "redisSecretInit.tolerations"?: string;
  "server.name"?: string;
  "server.replicas"?: string;
  "server.runtimeClassName"?: string;
  "server.autoscaling.enabled"?: string;
  "server.autoscaling.minReplicas"?: string;
  "server.autoscaling.maxReplicas"?: string;
  "server.autoscaling.targetCPUUtilizationPercentage"?: string;
  "server.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "server.autoscaling.metrics"?: string;
  "server.pdb.enabled"?: string;
  "server.pdb.minAvailable"?: string;
  "server.pdb.maxUnavailable"?: string;
  "server.image.repository"?: string;
  "server.image.tag"?: string;
  "server.image.imagePullPolicy"?: string;
  "server.imagePullSecrets"?: string;
  "server.extraArgs"?: string;
  "server.env"?: string;
  "server.envFrom"?: string;
  "server.extensions.enabled"?: string;
  "server.extensions.image.repository"?: string;
  "server.extensions.image.tag"?: string;
  "server.extensions.image.imagePullPolicy"?: string;
  "server.extensions.extensionList"?: string;
  "server.extensions.containerSecurityContext.runAsNonRoot"?: string;
  "server.extensions.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "server.extensions.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "server.extensions.containerSecurityContext.runAsUser"?: string;
  "server.extensions.containerSecurityContext.seccompProfile.type"?: string;
  "server.extensions.containerSecurityContext.capabilities.drop"?: string;
  "server.extraContainers"?: string;
  "server.initContainers"?: string;
  "server.volumeMounts"?: string;
  "server.volumes"?: string;
  "server.emptyDir.sizeLimit"?: string;
  "server.containerPorts.server"?: string;
  "server.containerPorts.metrics"?: string;
  "server.hostNetwork"?: string;
  "server.dnsPolicy"?: string;
  "server.containerSecurityContext.runAsNonRoot"?: string;
  "server.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "server.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "server.containerSecurityContext.seccompProfile.type"?: string;
  "server.containerSecurityContext.capabilities.drop"?: string;
  "server.readinessProbe.enabled"?: string;
  "server.readinessProbe.failureThreshold"?: string;
  "server.readinessProbe.initialDelaySeconds"?: string;
  "server.readinessProbe.periodSeconds"?: string;
  "server.readinessProbe.successThreshold"?: string;
  "server.readinessProbe.timeoutSeconds"?: string;
  "server.livenessProbe.enabled"?: string;
  "server.livenessProbe.failureThreshold"?: string;
  "server.livenessProbe.initialDelaySeconds"?: string;
  "server.livenessProbe.periodSeconds"?: string;
  "server.livenessProbe.successThreshold"?: string;
  "server.livenessProbe.timeoutSeconds"?: string;
  "server.terminationGracePeriodSeconds"?: string;
  "server.priorityClassName"?: string;
  "server.tolerations"?: string;
  "server.topologySpreadConstraints"?: string;
  "server.certificate.enabled"?: string;
  "server.certificate.domain"?: string;
  "server.certificate.additionalHosts"?: string;
  "server.certificate.duration"?: string;
  "server.certificate.renewBefore"?: string;
  "server.certificate.issuer.group"?: string;
  "server.certificate.issuer.kind"?: string;
  "server.certificate.issuer.name"?: string;
  "server.certificate.privateKey.rotationPolicy"?: string;
  "server.certificate.privateKey.encoding"?: string;
  "server.certificate.privateKey.algorithm"?: string;
  "server.certificate.privateKey.size"?: string;
  "server.certificate.usages"?: string;
  "server.certificateSecret.enabled"?: string;
  "server.certificateSecret.key"?: string;
  "server.certificateSecret.crt"?: string;
  "server.service.type"?: string;
  "server.service.nodePortHttp"?: string;
  "server.service.nodePortHttps"?: string;
  "server.service.servicePortHttp"?: string;
  "server.service.servicePortHttps"?: string;
  "server.service.servicePortHttpName"?: string;
  "server.service.servicePortHttpsName"?: string;
  "server.service.servicePortHttpsAppProtocol"?: string;
  "server.service.loadBalancerClass"?: string;
  "server.service.loadBalancerIP"?: string;
  "server.service.loadBalancerSourceRanges"?: string;
  "server.service.externalIPs"?: string;
  "server.service.externalTrafficPolicy"?: string;
  "server.service.sessionAffinity"?: string;
  "server.metrics.enabled"?: string;
  "server.metrics.service.type"?: string;
  "server.metrics.service.clusterIP"?: string;
  "server.metrics.service.servicePort"?: string;
  "server.metrics.service.portName"?: string;
  "server.metrics.serviceMonitor.enabled"?: string;
  "server.metrics.serviceMonitor.interval"?: string;
  "server.metrics.serviceMonitor.scrapeTimeout"?: string;
  "server.metrics.serviceMonitor.honorLabels"?: string;
  "server.metrics.serviceMonitor.relabelings"?: string;
  "server.metrics.serviceMonitor.metricRelabelings"?: string;
  "server.metrics.serviceMonitor.scheme"?: string;
  "server.metrics.serviceMonitor.namespace"?: string;
  "server.automountServiceAccountToken"?: string;
  "server.serviceAccount.create"?: string;
  "server.serviceAccount.name"?: string;
  "server.serviceAccount.automountServiceAccountToken"?: string;
  "server.ingress.enabled"?: string;
  "server.ingress.controller"?: string;
  "server.ingress.ingressClassName"?: string;
  "server.ingress.hostname"?: string;
  "server.ingress.path"?: string;
  "server.ingress.pathType"?: string;
  "server.ingress.tls"?: string;
  "server.ingress.extraHosts"?: string;
  "server.ingress.extraPaths"?: string;
  "server.ingress.extraRules"?: string;
  "server.ingress.extraTls"?: string;
  "server.ingress.aws.backendProtocolVersion"?: string;
  "server.ingress.aws.serviceType"?: string;
  "server.ingress.gke.managedCertificate.create"?: string;
  "server.ingress.gke.managedCertificate.extraDomains"?: string;
  "server.ingressGrpc.enabled"?: string;
  "server.ingressGrpc.ingressClassName"?: string;
  "server.ingressGrpc.hostname"?: string;
  "server.ingressGrpc.path"?: string;
  "server.ingressGrpc.pathType"?: string;
  "server.ingressGrpc.tls"?: string;
  "server.ingressGrpc.extraHosts"?: string;
  "server.ingressGrpc.extraPaths"?: string;
  "server.ingressGrpc.extraRules"?: string;
  "server.ingressGrpc.extraTls"?: string;
  "server.route.enabled"?: string;
  "server.route.hostname"?: string;
  "server.route.termination_type"?: string;
  "server.route.termination_policy"?: string;
  "server.httproute.enabled"?: string;
  "server.httproute.parentRefs"?: string;
  "server.httproute.hostnames"?: string;
  "server.httproute.rules.matches.path.type"?: string;
  "server.httproute.rules.matches.path.value"?: string;
  "server.grpcroute.enabled"?: string;
  "server.grpcroute.parentRefs"?: string;
  "server.grpcroute.hostnames"?: string;
  "server.grpcroute.rules.matches.method.type"?: string;
  "server.backendTLSPolicy.enabled"?: string;
  "server.backendTLSPolicy.targetRefs"?: string;
  "server.clusterRoleRules.enabled"?: string;
  "server.clusterRoleRules.rules"?: string;
  "server.networkPolicy.create"?: string;
  "repoServer.name"?: string;
  "repoServer.replicas"?: string;
  "repoServer.runtimeClassName"?: string;
  "repoServer.autoscaling.enabled"?: string;
  "repoServer.autoscaling.minReplicas"?: string;
  "repoServer.autoscaling.maxReplicas"?: string;
  "repoServer.autoscaling.targetCPUUtilizationPercentage"?: string;
  "repoServer.autoscaling.targetMemoryUtilizationPercentage"?: string;
  "repoServer.autoscaling.metrics"?: string;
  "repoServer.pdb.enabled"?: string;
  "repoServer.pdb.minAvailable"?: string;
  "repoServer.pdb.maxUnavailable"?: string;
  "repoServer.image.repository"?: string;
  "repoServer.image.tag"?: string;
  "repoServer.image.imagePullPolicy"?: string;
  "repoServer.imagePullSecrets"?: string;
  "repoServer.extraArgs"?: string;
  "repoServer.env"?: string;
  "repoServer.envFrom"?: string;
  "repoServer.extraContainers"?: string;
  "repoServer.initContainers"?: string;
  "repoServer.volumeMounts"?: string;
  "repoServer.volumes"?: string;
  "repoServer.emptyDir.sizeLimit"?: string;
  "repoServer.useEphemeralHelmWorkingDir"?: string;
  "repoServer.containerPorts.server"?: string;
  "repoServer.containerPorts.metrics"?: string;
  "repoServer.hostNetwork"?: string;
  "repoServer.dnsPolicy"?: string;
  "repoServer.containerSecurityContext.runAsNonRoot"?: string;
  "repoServer.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "repoServer.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "repoServer.containerSecurityContext.seccompProfile.type"?: string;
  "repoServer.containerSecurityContext.capabilities.drop"?: string;
  "repoServer.readinessProbe.enabled"?: string;
  "repoServer.readinessProbe.failureThreshold"?: string;
  "repoServer.readinessProbe.initialDelaySeconds"?: string;
  "repoServer.readinessProbe.periodSeconds"?: string;
  "repoServer.readinessProbe.successThreshold"?: string;
  "repoServer.readinessProbe.timeoutSeconds"?: string;
  "repoServer.livenessProbe.enabled"?: string;
  "repoServer.livenessProbe.failureThreshold"?: string;
  "repoServer.livenessProbe.initialDelaySeconds"?: string;
  "repoServer.livenessProbe.periodSeconds"?: string;
  "repoServer.livenessProbe.successThreshold"?: string;
  "repoServer.livenessProbe.timeoutSeconds"?: string;
  "repoServer.terminationGracePeriodSeconds"?: string;
  "repoServer.tolerations"?: string;
  "repoServer.topologySpreadConstraints"?: string;
  "repoServer.priorityClassName"?: string;
  "repoServer.certificateSecret.enabled"?: string;
  "repoServer.certificateSecret.ca"?: string;
  "repoServer.certificateSecret.key"?: string;
  "repoServer.certificateSecret.crt"?: string;
  "repoServer.service.port"?: string;
  "repoServer.service.portName"?: string;
  "repoServer.service.trafficDistribution"?: string;
  "repoServer.metrics.enabled"?: string;
  "repoServer.metrics.service.type"?: string;
  "repoServer.metrics.service.clusterIP"?: string;
  "repoServer.metrics.service.servicePort"?: string;
  "repoServer.metrics.service.portName"?: string;
  "repoServer.metrics.serviceMonitor.enabled"?: string;
  "repoServer.metrics.serviceMonitor.interval"?: string;
  "repoServer.metrics.serviceMonitor.scrapeTimeout"?: string;
  "repoServer.metrics.serviceMonitor.honorLabels"?: string;
  "repoServer.metrics.serviceMonitor.relabelings"?: string;
  "repoServer.metrics.serviceMonitor.metricRelabelings"?: string;
  "repoServer.metrics.serviceMonitor.scheme"?: string;
  "repoServer.metrics.serviceMonitor.namespace"?: string;
  "repoServer.clusterRoleRules.enabled"?: string;
  "repoServer.clusterRoleRules.rules"?: string;
  "repoServer.automountServiceAccountToken"?: string;
  "repoServer.serviceAccount.create"?: string;
  "repoServer.serviceAccount.name"?: string;
  "repoServer.serviceAccount.automountServiceAccountToken"?: string;
  "repoServer.rbac"?: string;
  "repoServer.networkPolicy.create"?: string;
  "applicationSet.name"?: string;
  "applicationSet.replicas"?: string;
  "applicationSet.runtimeClassName"?: string;
  "applicationSet.pdb.enabled"?: string;
  "applicationSet.pdb.minAvailable"?: string;
  "applicationSet.pdb.maxUnavailable"?: string;
  "applicationSet.image.repository"?: string;
  "applicationSet.image.tag"?: string;
  "applicationSet.image.imagePullPolicy"?: string;
  "applicationSet.imagePullSecrets"?: string;
  "applicationSet.extraArgs"?: string;
  "applicationSet.extraEnv"?: string;
  "applicationSet.extraEnvFrom"?: string;
  "applicationSet.extraContainers"?: string;
  "applicationSet.initContainers"?: string;
  "applicationSet.extraVolumeMounts"?: string;
  "applicationSet.extraVolumes"?: string;
  "applicationSet.emptyDir.sizeLimit"?: string;
  "applicationSet.metrics.enabled"?: string;
  "applicationSet.metrics.service.type"?: string;
  "applicationSet.metrics.service.clusterIP"?: string;
  "applicationSet.metrics.service.servicePort"?: string;
  "applicationSet.metrics.service.portName"?: string;
  "applicationSet.metrics.serviceMonitor.enabled"?: string;
  "applicationSet.metrics.serviceMonitor.interval"?: string;
  "applicationSet.metrics.serviceMonitor.scrapeTimeout"?: string;
  "applicationSet.metrics.serviceMonitor.honorLabels"?: string;
  "applicationSet.metrics.serviceMonitor.relabelings"?: string;
  "applicationSet.metrics.serviceMonitor.metricRelabelings"?: string;
  "applicationSet.metrics.serviceMonitor.scheme"?: string;
  "applicationSet.metrics.serviceMonitor.namespace"?: string;
  "applicationSet.service.type"?: string;
  "applicationSet.service.port"?: string;
  "applicationSet.service.portName"?: string;
  "applicationSet.automountServiceAccountToken"?: string;
  "applicationSet.serviceAccount.create"?: string;
  "applicationSet.serviceAccount.name"?: string;
  "applicationSet.serviceAccount.automountServiceAccountToken"?: string;
  "applicationSet.containerPorts.metrics"?: string;
  "applicationSet.containerPorts.probe"?: string;
  "applicationSet.containerPorts.webhook"?: string;
  "applicationSet.dnsPolicy"?: string;
  "applicationSet.containerSecurityContext.runAsNonRoot"?: string;
  "applicationSet.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "applicationSet.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "applicationSet.containerSecurityContext.seccompProfile.type"?: string;
  "applicationSet.containerSecurityContext.capabilities.drop"?: string;
  "applicationSet.readinessProbe.enabled"?: string;
  "applicationSet.readinessProbe.initialDelaySeconds"?: string;
  "applicationSet.readinessProbe.periodSeconds"?: string;
  "applicationSet.readinessProbe.timeoutSeconds"?: string;
  "applicationSet.readinessProbe.successThreshold"?: string;
  "applicationSet.readinessProbe.failureThreshold"?: string;
  "applicationSet.livenessProbe.enabled"?: string;
  "applicationSet.livenessProbe.initialDelaySeconds"?: string;
  "applicationSet.livenessProbe.periodSeconds"?: string;
  "applicationSet.livenessProbe.timeoutSeconds"?: string;
  "applicationSet.livenessProbe.successThreshold"?: string;
  "applicationSet.livenessProbe.failureThreshold"?: string;
  "applicationSet.terminationGracePeriodSeconds"?: string;
  "applicationSet.tolerations"?: string;
  "applicationSet.topologySpreadConstraints"?: string;
  "applicationSet.priorityClassName"?: string;
  "applicationSet.certificate.enabled"?: string;
  "applicationSet.certificate.domain"?: string;
  "applicationSet.certificate.additionalHosts"?: string;
  "applicationSet.certificate.duration"?: string;
  "applicationSet.certificate.renewBefore"?: string;
  "applicationSet.certificate.issuer.group"?: string;
  "applicationSet.certificate.issuer.kind"?: string;
  "applicationSet.certificate.issuer.name"?: string;
  "applicationSet.certificate.privateKey.rotationPolicy"?: string;
  "applicationSet.certificate.privateKey.encoding"?: string;
  "applicationSet.certificate.privateKey.algorithm"?: string;
  "applicationSet.certificate.privateKey.size"?: string;
  "applicationSet.ingress.enabled"?: string;
  "applicationSet.ingress.ingressClassName"?: string;
  "applicationSet.ingress.hostname"?: string;
  "applicationSet.ingress.path"?: string;
  "applicationSet.ingress.pathType"?: string;
  "applicationSet.ingress.tls"?: string;
  "applicationSet.ingress.extraHosts"?: string;
  "applicationSet.ingress.extraPaths"?: string;
  "applicationSet.ingress.extraRules"?: string;
  "applicationSet.ingress.extraTls"?: string;
  "applicationSet.allowAnyNamespace"?: string;
  "applicationSet.networkPolicy.create"?: string;
  "notifications.enabled"?: string;
  "notifications.name"?: string;
  "notifications.argocdUrl"?: string;
  "notifications.runtimeClassName"?: string;
  "notifications.pdb.enabled"?: string;
  "notifications.pdb.minAvailable"?: string;
  "notifications.pdb.maxUnavailable"?: string;
  "notifications.image.repository"?: string;
  "notifications.image.tag"?: string;
  "notifications.image.imagePullPolicy"?: string;
  "notifications.imagePullSecrets"?: string;
  "notifications.extraArgs"?: string;
  "notifications.extraEnv"?: string;
  "notifications.extraEnvFrom"?: string;
  "notifications.extraContainers"?: string;
  "notifications.initContainers"?: string;
  "notifications.extraVolumeMounts"?: string;
  "notifications.extraVolumes"?: string;
  "notifications.secret.create"?: string;
  "notifications.secret.name"?: string;
  "notifications.metrics.enabled"?: string;
  "notifications.metrics.port"?: string;
  "notifications.metrics.service.type"?: string;
  "notifications.metrics.service.clusterIP"?: string;
  "notifications.metrics.service.portName"?: string;
  "notifications.metrics.serviceMonitor.enabled"?: string;
  "notifications.metrics.serviceMonitor.scheme"?: string;
  "notifications.metrics.serviceMonitor.honorLabels"?: string;
  "notifications.metrics.serviceMonitor.relabelings"?: string;
  "notifications.metrics.serviceMonitor.metricRelabelings"?: string;
  "notifications.containerPorts.metrics"?: string;
  "notifications.dnsPolicy"?: string;
  "notifications.containerSecurityContext.runAsNonRoot"?: string;
  "notifications.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "notifications.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "notifications.containerSecurityContext.seccompProfile.type"?: string;
  "notifications.containerSecurityContext.capabilities.drop"?: string;
  "notifications.readinessProbe.enabled"?: string;
  "notifications.readinessProbe.initialDelaySeconds"?: string;
  "notifications.readinessProbe.periodSeconds"?: string;
  "notifications.readinessProbe.timeoutSeconds"?: string;
  "notifications.readinessProbe.successThreshold"?: string;
  "notifications.readinessProbe.failureThreshold"?: string;
  "notifications.livenessProbe.enabled"?: string;
  "notifications.livenessProbe.initialDelaySeconds"?: string;
  "notifications.livenessProbe.periodSeconds"?: string;
  "notifications.livenessProbe.timeoutSeconds"?: string;
  "notifications.livenessProbe.successThreshold"?: string;
  "notifications.livenessProbe.failureThreshold"?: string;
  "notifications.terminationGracePeriodSeconds"?: string;
  "notifications.tolerations"?: string;
  "notifications.topologySpreadConstraints"?: string;
  "notifications.deploymentStrategy.type"?: string;
  "notifications.priorityClassName"?: string;
  "notifications.automountServiceAccountToken"?: string;
  "notifications.serviceAccount.create"?: string;
  "notifications.serviceAccount.name"?: string;
  "notifications.serviceAccount.automountServiceAccountToken"?: string;
  "notifications.cm.create"?: string;
  "notifications.clusterRoleRules.rules"?: string;
  "notifications.subscriptions"?: string;
  "notifications.networkPolicy.create"?: string;
  "commitServer.enabled"?: string;
  "commitServer.name"?: string;
  "commitServer.runtimeClassName"?: string;
  "commitServer.image.repository"?: string;
  "commitServer.image.tag"?: string;
  "commitServer.image.imagePullPolicy"?: string;
  "commitServer.extraArgs"?: string;
  "commitServer.extraEnv"?: string;
  "commitServer.extraEnvFrom"?: string;
  "commitServer.extraVolumeMounts"?: string;
  "commitServer.extraVolumes"?: string;
  "commitServer.metrics.enabled"?: string;
  "commitServer.metrics.service.type"?: string;
  "commitServer.metrics.service.clusterIP"?: string;
  "commitServer.metrics.service.servicePort"?: string;
  "commitServer.metrics.service.portName"?: string;
  "commitServer.service.port"?: string;
  "commitServer.service.portName"?: string;
  "commitServer.automountServiceAccountToken"?: string;
  "commitServer.serviceAccount.create"?: string;
  "commitServer.serviceAccount.name"?: string;
  "commitServer.serviceAccount.automountServiceAccountToken"?: string;
  "commitServer.dnsPolicy"?: string;
  "commitServer.containerSecurityContext.runAsNonRoot"?: string;
  "commitServer.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "commitServer.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "commitServer.containerSecurityContext.capabilities.drop"?: string;
  "commitServer.containerSecurityContext.seccompProfile.type"?: string;
  "commitServer.readinessProbe.enabled"?: string;
  "commitServer.readinessProbe.initialDelaySeconds"?: string;
  "commitServer.readinessProbe.periodSeconds"?: string;
  "commitServer.readinessProbe.timeoutSeconds"?: string;
  "commitServer.readinessProbe.failureThreshold"?: string;
  "commitServer.livenessProbe.enabled"?: string;
  "commitServer.livenessProbe.initialDelaySeconds"?: string;
  "commitServer.livenessProbe.periodSeconds"?: string;
  "commitServer.livenessProbe.timeoutSeconds"?: string;
  "commitServer.livenessProbe.failureThreshold"?: string;
  "commitServer.terminationGracePeriodSeconds"?: string;
  "commitServer.tolerations"?: string;
  "commitServer.topologySpreadConstraints"?: string;
  "commitServer.priorityClassName"?: string;
  "commitServer.networkPolicy.create"?: string;
};
