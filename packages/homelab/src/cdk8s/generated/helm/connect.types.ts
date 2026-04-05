// Generated TypeScript types for connect Helm chart

export type ConnectHelmValuesCommonLabels = object;

export type ConnectHelmValuesConnect = {
  /**
   * Denotes whether the 1Password Connect server will be deployed
   *
   * @default true
   */
  create?: boolean;
  /**
   * The number of replicas to run the 1Password Connect deployment
   *
   * @default 1
   */
  replicas?: number;
  /**
   * The 1Password Connect API Specific Values
   *
   * @default {...} (8 keys)
   */
  api?: ConnectHelmValuesConnectApi;
  /**
   * The 1Password Connect Sync Specific Values
   *
   * @default {...} (6 keys)
   */
  sync?: ConnectHelmValuesConnectSync;
  /**
   * The name of 1Password Connect Application
   *
   * @default "onepassword-connect"
   */
  applicationName?: string;
  /**
   * The name of 1Password Connect Host
   *
   * @default "onepassword-connect"
   */
  host?: string;
  /**
   * The type of Service resource to create for the Connect API and sync services.
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  /**
   * Additional annotations to be added to the service.
   *
   * @default {}
   */
  serviceAnnotations?: ConnectHelmValuesConnectServiceAnnotations;
  /**
   * 1Password Connect Service Account Configuration
   *
   * @default {"create":false,"annotations":{},"name":"onepassword-connect"}
   */
  serviceAccount?: ConnectHelmValuesConnectServiceAccount;
  /**
   * The name of Kubernetes Secret containing the 1Password Connect credentials
   *
   * @default "op-credentials"
   */
  credentialsName?: string;
  /**
   * The key for the 1Password Connect Credentials stored in the credentials secret
   *
   * @default "1password-credentials.json"
   */
  credentialsKey?: string;
  credentials?: unknown;
  credentials_base64?: unknown;
  /**
   * The 1Password Connect API image pull policy
   *
   * @default "IfNotPresent"
   */
  imagePullPolicy?: string;
  imagePullSecrets?: unknown[];
  /**
   * The 1Password Connect version to pull
   *
   * @default "{{ .Chart.AppVersion }}"
   */
  version?: string;
  /**
   * [Node selector](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector) stanza for the Connect pod
   *
   * @default {}
   */
  nodeSelector?: ConnectHelmValuesConnectNodeSelector;
  /**
   * [Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) rules for the Connect pod
   *
   * @default {}
   */
  affinity?: ConnectHelmValuesConnectAffinity;
  /**
   * Horizontal Pod Autoscaling for the Connect pod
   *
   * @default {...} (7 keys)
   */
  hpa?: ConnectHelmValuesConnectHpa;
  /**
   * Pod Disruption Budget for the Connect pod
   *
   * @default {...} (4 keys)
   */
  pdb?: ConnectHelmValuesConnectPdb;
  /**
   * 1Password Connect API and Sync Service
   *
   * @default {"liveness":true,"readiness":true}
   */
  probes?: ConnectHelmValuesConnectProbes;
  /**
   * [priorityClassName](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/) to apply to the Connect API deployment resource.
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Additional annotations to be added to the Connect API deployment resource.
   *
   * @default {}
   */
  annotations?: ConnectHelmValuesConnectAnnotations;
  /**
   * Additional labels to be added to the Connect API deployment resource.
   *
   * @default {}
   */
  labels?: ConnectHelmValuesConnectLabels;
  /**
   * Additional annotations to be added to the Connect API pods.
   *
   * @default {}
   */
  podAnnotations?: ConnectHelmValuesConnectPodAnnotations;
  /**
   * Additional labels to be added to the Connect API pods.
   *
   * @default {}
   */
  podLabels?: ConnectHelmValuesConnectPodLabels;
  /**
   * Pod securityContext to be added to the Connect pods.
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: ConnectHelmValuesConnectPodSecurityContext;
  tolerations?: unknown[];
  /**
   * 1Password Connect volume shared between 1Password Connect Containers
   *
   * @default {"name":"shared-data","type":"emptyDir","values":{}}
   */
  dataVolume?: ConnectHelmValuesConnectDataVolume;
  /**
   * Determines if HTTPS Port if setup for the 1Password Connect
   *
   * @default {"enabled":false,"secret":"op-connect-tls"}
   */
  tls?: ConnectHelmValuesConnectTls;
  /**
   * Ingress allows ingress services to be created to allow external access
   * from Kubernetes to access 1Password Connect pods.
   * Optionally the internal profiler can be enabled to debug memory or performance issues.
   *
   * @default {...} (8 keys)
   */
  ingress?: ConnectHelmValuesConnectIngress;
  /**
   * @default {"enabled":false,"interval":"6h","keepLast":12}
   */
  profiler?: ConnectHelmValuesConnectProfiler;
  customEnvVars?: unknown[];
};

export type ConnectHelmValuesConnectApi = {
  /**
   * The name of the 1Password Connect API container
   *
   * @default "connect-api"
   */
  name?: string;
  /**
   * The 1Password Connect API repository
   *
   * @default "1password/connect-api"
   */
  imageRepository?: string;
  /**
   * The resources requests/limits for the 1Password Connect API pod
   *
   * @default {"limits":{"memory":"128Mi"},"requests":{"cpu":0.2}}
   */
  resources?: ConnectHelmValuesConnectApiResources;
  /**
   * The port the Connect API is served on when TLS is disabled
   *
   * @default 8080
   */
  httpPort?: number;
  /**
   * The port the Connect API is served on when TLS is enabled
   *
   * @default 8443
   */
  httpsPort?: number;
  /**
   * Log level of the Connect API container. Valid options are: trace, debug, info, warn, error.
   *
   * @default "info"
   */
  logLevel?: string;
  /**
   * Prometheus Service Monitor
   * ref: https://github.com/coreos/prometheus-operator
   *
   * @default {...} (5 keys)
   */
  serviceMonitor?: ConnectHelmValuesConnectApiServiceMonitor;
  /**
   * Container securityContext to be added to the Connect API containers.
   *
   * @default {"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true,"allowPrivilegeEscalation":false}
   */
  securityContext?: ConnectHelmValuesConnectApiSecurityContext;
};

export type ConnectHelmValuesConnectApiResources = {
  /**
   * @default {"memory":"128Mi"}
   */
  limits?: ConnectHelmValuesConnectApiResourcesLimits;
  /**
   * @default {"cpu":0.2}
   */
  requests?: ConnectHelmValuesConnectApiResourcesRequests;
};

export type ConnectHelmValuesConnectApiResourcesLimits = {
  /**
   * @default "128Mi"
   */
  memory?: string;
};

export type ConnectHelmValuesConnectApiResourcesRequests = {
  /**
   * @default 0.2
   */
  cpu?: number;
};

export type ConnectHelmValuesConnectApiServiceMonitor = {
  /**
   * Create ServiceMonitor Resource for scraping metrics using PrometheusOperator
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Specify the interval at which metrics should be scraped
   *
   * @default "30s"
   */
  interval?: string;
  /**
   * Define the path used by ServiceMonitor to scrape metrics
   *
   * @default "/metrics"
   */
  path?: string;
  /**
   * Define the HTTP URL parameters used by ServiceMonitor
   *
   * @default {}
   */
  params?: ConnectHelmValuesConnectApiServiceMonitorParams;
  /**
   * Extra annotations for the ServiceMonitor
   *
   * @default {}
   */
  annotations?: ConnectHelmValuesConnectApiServiceMonitorAnnotations;
};

export type ConnectHelmValuesConnectApiServiceMonitorParams = object;

export type ConnectHelmValuesConnectApiServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesConnectApiSecurityContext = {
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ConnectHelmValuesConnectApiSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type ConnectHelmValuesConnectApiSecurityContextCapabilities = {
  drop?: string[];
};

export type ConnectHelmValuesConnectSync = {
  /**
   * The name of the 1Password Connect Sync container
   *
   * @default "connect-sync"
   */
  name?: string;
  /**
   * The 1Password Connect Sync repository
   *
   * @default "1password/connect-sync"
   */
  imageRepository?: string;
  /**
   * The resources requests/limits for the 1Password Connect Sync pod
   *
   * @default {}
   */
  resources?: ConnectHelmValuesConnectSyncResources;
  /**
   * The port serving the health of the Sync container
   *
   * @default 8081
   */
  httpPort?: number;
  /**
   * Log level of the Connect Sync container. Valid options are: trace, debug, info, warn, error.
   *
   * @default "info"
   */
  logLevel?: string;
  /**
   * Container securityContext to be added to the Connect Sync containers.
   *
   * @default {"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true,"allowPrivilegeEscalation":false}
   */
  securityContext?: ConnectHelmValuesConnectSyncSecurityContext;
};

export type ConnectHelmValuesConnectSyncResources = object;

export type ConnectHelmValuesConnectSyncSecurityContext = {
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ConnectHelmValuesConnectSyncSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type ConnectHelmValuesConnectSyncSecurityContextCapabilities = {
  drop?: string[];
};

export type ConnectHelmValuesConnectServiceAnnotations = object;

export type ConnectHelmValuesConnectServiceAccount = {
  /**
   * Create service account for the 1Password Connect deployment
   *
   * @default false
   */
  create?: boolean;
  /**
   * Annotations for the 1Password Connect Service Account
   *
   * @default {}
   */
  annotations?: ConnectHelmValuesConnectServiceAccountAnnotations;
  /**
   * The name of the 1Password Connect Service Account
   *
   * @default "onepassword-connect"
   */
  name?: string;
};

export type ConnectHelmValuesConnectServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesConnectNodeSelector = object;

export type ConnectHelmValuesConnectAffinity = object;

export type ConnectHelmValuesConnectHpa = {
  /**
   * Enable Horizontal Pod Autoscaling for the Connect pod
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional annotations to be added to the HPA Connect
   *
   * @default {}
   */
  annotations?: ConnectHelmValuesConnectHpaAnnotations;
  /**
   * Minimum number of replicas for the Connect pod
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum number of replicas for the Connect pod
   *
   * @default 3
   */
  maxReplicas?: number;
  /**
   * Average Memory utilization percentage for the Connect pod
   *
   * @default 50
   */
  avgMemoryUtilization?: number;
  /**
   * Average CPU utilization percentage for the Connect pod
   *
   * @default 50
   */
  avgCpuUtilization?: number;
  /**
   * Defines the Autoscaling Behavior in up/down directions
   *
   * @default {}
   */
  behavior?: ConnectHelmValuesConnectHpaBehavior;
};

export type ConnectHelmValuesConnectHpaAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesConnectHpaBehavior = object;

export type ConnectHelmValuesConnectPdb = {
  /**
   * Enable Pod Disruption Budget for the Connect pod
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional annotations to be added to the PDB Connect
   *
   * @default {}
   */
  annotations?: ConnectHelmValuesConnectPdbAnnotations;
  /**
   * Number of pods that are unavailable after eviction as number or percentage (eg.: 50%)
   *
   * @default 1
   */
  maxUnavailable?: number;
  /**
   * Number of pods that are available after eviction as number or percentage (eg.: 50%)
   *
   * @default 0
   */
  minAvailable?: number;
};

export type ConnectHelmValuesConnectPdbAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesConnectProbes = {
  /**
   * Denotes whether the 1Password Connect API will be continually checked by Kubernetes for liveness and restarted if the pod becomes unresponsive
   *
   * @default true
   */
  liveness?: boolean;
  /**
   * Denotes whether the 1Password Connect API readiness probe will operate and ensure the pod is ready before serving traffic
   *
   * @default true
   */
  readiness?: boolean;
};

export type ConnectHelmValuesConnectAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesConnectLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesConnectPodAnnotations = object;

export type ConnectHelmValuesConnectPodLabels = object;

export type ConnectHelmValuesConnectPodSecurityContext = {
  /**
   * @default 999
   */
  fsGroup?: number;
  /**
   * @default 999
   */
  runAsUser?: number;
  /**
   * @default 999
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ConnectHelmValuesConnectPodSecurityContextSeccompProfile;
};

export type ConnectHelmValuesConnectPodSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ConnectHelmValuesConnectDataVolume = {
  /**
   * The name of the shared volume used between 1Password Connect Containers
   *
   * @default "shared-data"
   */
  name?: string;
  /**
   * The type of the shared volume used between 1Password Connect Containers
   *
   * @default "emptyDir"
   */
  type?: string;
  /**
   * Describes the fields and values for configuration of shared volume for 1Password Connect
   *
   * @default {}
   */
  values?: ConnectHelmValuesConnectDataVolumeValues;
};

export type ConnectHelmValuesConnectDataVolumeValues = object;

export type ConnectHelmValuesConnectTls = {
  /**
   * Denotes whether the Connect API is secured with TLS
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * The name of the secret containing the TLS key (`tls.key`) and certificate (`tls.crt`)
   *
   * @default "op-connect-tls"
   */
  secret?: string;
};

export type ConnectHelmValuesConnectIngress = {
  /**
   * The boolean value to enable/disable the 1Password Connect Ingress
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Ingress labels for 1Password Connect
   *
   * @default {}
   */
  labels?: ConnectHelmValuesConnectIngressLabels;
  /**
   * The 1Password Connect Ingress Annotations
   *
   * @default {}
   */
  annotations?: ConnectHelmValuesConnectIngressAnnotations;
  /**
   * Optionally use ingressClassName instead of deprecated annotation.
   *
   * @default ""
   */
  ingressClassName?: string;
  /**
   * Ingress PathType see [docs](https://kubernetes.io/docs/concepts/services-networking/ingress/#path-types)
   *
   * @default "Prefix"
   */
  pathType?: string;
  hosts?: ConnectHelmValuesConnectIngressHostsElement[];
  extraPaths?: unknown[];
  tls?: unknown[];
};

export type ConnectHelmValuesConnectIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesConnectIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesConnectIngressHostsElement = {
  /**
   * @default "chart-example.local"
   */
  host?: string;
  paths?: unknown[];
};

export type ConnectHelmValuesConnectProfiler = {
  /**
   * Enable the internal profiler to debug memory or performance issues. For normal operation this does not have to be enabled.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * The interval at which profiler snapshots are taken.
   *
   * @default "6h"
   */
  interval?: string;
  /**
   * Number of profiler snapshots to keep.
   *
   * @default 12
   */
  keepLast?: number;
};

export type ConnectHelmValuesOperator = {
  /**
   * Denotes whether the 1Password Operator will be deployed
   *
   * @default false
   */
  create?: boolean;
  /**
   * Authentication method for the Operator. Valid values: `connect` (uses Connect token) or `service-account` (uses 1Password Service Account token)
   *
   * Denotes authentication method that 1Password Operator will use to access 1Password secrets.
   *
   * @default "connect"
   */
  authMethod?: "connect" | "service-account";
  /**
   * The number of replicas to run the 1Password Operator deployment
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Denotes whether the 1Password Operator will automatically restart deployments based on associated updated secrets.
   *
   * @default false
   */
  autoRestart?: boolean;
  /**
   * The name of 1Password Operator Application
   *
   * @default "onepassword-connect-operator"
   */
  applicationName?: string;
  /**
   * The 1Password Operator image pull policy
   *
   * @default "IfNotPresent"
   */
  imagePullPolicy?: string;
  imagePullSecrets?: unknown[];
  /**
   * The 1Password Operator repository
   *
   * @default "1password/onepassword-operator"
   */
  imageRepository?: string;
  /**
   * How often the 1Password Operator will poll for secrets updates.
   *
   * @default 600
   */
  pollingInterval?: number;
  /**
   * The 1Password Operator version to pull
   *
   * @default "1.12.0"
   */
  version?: string;
  /**
   * Pod securityContext to be added to the Operator pods.
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: ConnectHelmValuesOperatorPodSecurityContext;
  /**
   * Container securityContext to be added to the 1Password Operator containers.
   *
   * @default {"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true,"allowPrivilegeEscalation":false}
   */
  securityContext?: ConnectHelmValuesOperatorSecurityContext;
  /**
   * [Node selector](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector) stanza for the operator pod
   *
   * @default {}
   */
  nodeSelector?: ConnectHelmValuesOperatorNodeSelector;
  /**
   * [Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity) rules for the Operator pod
   *
   * @default {}
   */
  affinity?: ConnectHelmValuesOperatorAffinity;
  /**
   * Horizontal Pod Autoscaling for the Operator pod
   *
   * @default {...} (7 keys)
   */
  hpa?: ConnectHelmValuesOperatorHpa;
  /**
   * Pod Disruption Budget for the Operator pod
   *
   * @default {...} (4 keys)
   */
  pdb?: ConnectHelmValuesOperatorPdb;
  /**
   * Additional annotations to be added to the Operator deployment resource.
   *
   * @default {}
   */
  annotations?: ConnectHelmValuesOperatorAnnotations;
  /**
   * Additional labels to be added to the Operator deployment resource.
   *
   * @default {}
   */
  labels?: ConnectHelmValuesOperatorLabels;
  /**
   * Additional annotations to be added to the Operator pods.
   *
   * @default {}
   */
  podAnnotations?: ConnectHelmValuesOperatorPodAnnotations;
  /**
   * Additional labels to be added to the Operator pods.
   *
   * @default {}
   */
  podLabels?: ConnectHelmValuesOperatorPodLabels;
  /**
   * [priorityClassName](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/) to apply to the Operator pods.
   *
   * @default ""
   */
  priorityClassName?: string;
  tolerations?: unknown[];
  watchNamespace?: unknown[];
  /**
   * The resources requests/limits for the 1Password Operator pod
   *
   * @default {}
   */
  resources?: ConnectHelmValuesOperatorResources;
  /**
   * 1Password Operator Health Probes
   *
   * @default {"port":8081,"liveness":{"create":true,"failureThreshold":3,"periodSeconds":20,"initialDelaySeconds":15},"readiness":{"create":true,"initialDelaySeconds":5,"periodSeconds":10}}
   */
  probes?: ConnectHelmValuesOperatorProbes;
  /**
   * 1Password Operator Connect Token Configuration
   *
   * @default {"name":"onepassword-token","key":"token","value":null}
   */
  token?: ConnectHelmValuesOperatorToken;
  /**
   * @default {"name":"onepassword-service-account-token","key":"token","value":null}
   */
  serviceAccountToken?: ConnectHelmValuesOperatorServiceAccountToken;
  /**
   * @default {"create":"{{ .Values.operator.create }}","annotations":{},"name":"onepassword-connect-operator"}
   */
  serviceAccount?: ConnectHelmValuesOperatorServiceAccount;
  /**
   * 1Password Operator Role Binding Configuration
   *
   * @default {"create":"{{ .Values.operator.create }}","name":"onepassword-connect-operator"}
   */
  roleBinding?: ConnectHelmValuesOperatorRoleBinding;
  /**
   * 1Password Operator Cluster Role Configuration
   *
   * @default {"create":"{{ .Values.operator.create }}","name":"onepassword-connect-operator"}
   */
  clusterRole?: ConnectHelmValuesOperatorClusterRole;
  /**
   * 1Password Operator Cluster Role Binding Configuration
   *
   * @default {"create":"{{ .Values.operator.create }}","name":"onepassword-connect-operator"}
   */
  clusterRoleBinding?: ConnectHelmValuesOperatorClusterRoleBinding;
  /**
   * Log level of the Operator container. Valid options are: debug, info and error.
   *
   * @default "info"
   */
  logLevel?: string;
  /**
   * Passes the `--enable-annotations` flag to the Operator container when true.
   *
   * Passes the --enable-annotations flag to the Operator container when true.
   *
   * @default false
   */
  enableAnnotations?: boolean;
  /**
   * Passes the `--allow-empty-values` flag to the Operator container that allows adding fields with empty values to Kubernetes secrets when true
   *
   * Passes the --allow-empty-values flag to the Operator when true, allowing fields with empty values to be added to Kubernetes secrets.
   *
   * @default false
   */
  allowEmptyValues?: boolean;
  customEnvVars?: unknown[];
  /**
   * 1Password Operator TLS settings
   *
   * @default {"trust":{}}
   */
  tls?: ConnectHelmValuesOperatorTls;
};

export type ConnectHelmValuesOperatorPodSecurityContext = {
  /**
   * @default 65532
   */
  fsGroup?: number;
  /**
   * @default 65532
   */
  runAsUser?: number;
  /**
   * @default 65532
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ConnectHelmValuesOperatorPodSecurityContextSeccompProfile;
};

export type ConnectHelmValuesOperatorPodSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ConnectHelmValuesOperatorSecurityContext = {
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ConnectHelmValuesOperatorSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type ConnectHelmValuesOperatorSecurityContextCapabilities = {
  drop?: string[];
};

export type ConnectHelmValuesOperatorNodeSelector = object;

export type ConnectHelmValuesOperatorAffinity = object;

export type ConnectHelmValuesOperatorHpa = {
  /**
   * Enable Horizontal Pod Autoscaling for the Operator pod
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional annotations to be added to the HPA Operator
   *
   * @default {}
   */
  annotations?: ConnectHelmValuesOperatorHpaAnnotations;
  /**
   * Minimum number of replicas for the Operator pod
   *
   * @default 1
   */
  minReplicas?: number;
  /**
   * Maximum number of replicas for the Operator pod
   *
   * @default 3
   */
  maxReplicas?: number;
  /**
   * Average Memory utilization percentage for the Operator pod
   *
   * @default 50
   */
  avgMemoryUtilization?: number;
  /**
   * Average CPU utilization percentage for the Operator pod
   *
   * @default 50
   */
  avgCpuUtilization?: number;
  /**
   * Defines the Autoscaling Behavior in up/down directions
   *
   * @default {}
   */
  behavior?: ConnectHelmValuesOperatorHpaBehavior;
};

export type ConnectHelmValuesOperatorHpaAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesOperatorHpaBehavior = object;

export type ConnectHelmValuesOperatorPdb = {
  /**
   * Enable Pod Disruption Budget for the Operator pod
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Additional annotations to be added to the PDB Operator
   *
   * @default {}
   */
  annotations?: ConnectHelmValuesOperatorPdbAnnotations;
  /**
   * Number of pods that are unavailable after eviction as number or percentage (eg.: 50%)
   *
   * @default 1
   */
  maxUnavailable?: number;
  /**
   * Number of pods that are available after eviction as number or percentage (eg.: 50%)
   *
   * @default 0
   */
  minAvailable?: number;
};

export type ConnectHelmValuesOperatorPdbAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesOperatorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesOperatorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesOperatorPodAnnotations = object;

export type ConnectHelmValuesOperatorPodLabels = object;

export type ConnectHelmValuesOperatorResources = object;

export type ConnectHelmValuesOperatorProbes = {
  /**
   * The port the health probe endpoints are served on for the Operator pod
   *
   * @default 8081
   */
  port?: number;
  /**
   * @default {...} (4 keys)
   */
  liveness?: ConnectHelmValuesOperatorProbesLiveness;
  /**
   * @default {"create":true,"initialDelaySeconds":5,"periodSeconds":10}
   */
  readiness?: ConnectHelmValuesOperatorProbesReadiness;
};

export type ConnectHelmValuesOperatorProbesLiveness = {
  /**
   * Denotes whether the 1Password Operator will be continually checked by Kubernetes for liveness and restarted if the pod becomes unresponsive
   *
   * @default true
   */
  create?: boolean;
  /**
   * Number of consecutive failures before Kubernetes restarts the container
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Number of seconds between liveness probe checks
   *
   * @default 20
   */
  periodSeconds?: number;
  /**
   * Number of seconds to wait before starting liveness probes
   *
   * @default 15
   */
  initialDelaySeconds?: number;
};

export type ConnectHelmValuesOperatorProbesReadiness = {
  /**
   * Denotes whether the 1Password Operator readiness probe will operate and ensure the pod is ready before serving traffic
   *
   * @default true
   */
  create?: boolean;
  /**
   * Number of seconds to wait before starting readiness probes
   *
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * Number of seconds between readiness probe checks
   *
   * @default 10
   */
  periodSeconds?: number;
};

export type ConnectHelmValuesOperatorToken = {
  /**
   * The name of Kubernetes Secret containing the 1Password Connect API token
   *
   * @default "onepassword-token"
   */
  name?: string;
  /**
   * The key for the 1Password Connect token stored in the 1Password token secret
   *
   * @default "token"
   */
  key?: string;
  value?: unknown;
};

export type ConnectHelmValuesOperatorServiceAccountToken = {
  /**
   * The name of Kubernetes Secret containing the 1Password Service Account token
   *
   * @default "onepassword-service-account-token"
   */
  name?: string;
  /**
   * The key for the 1Password Service Account token stored in the 1Password token secret
   *
   * @default "token"
   */
  key?: string;
  value?: unknown;
};

export type ConnectHelmValuesOperatorServiceAccount = {
  /**
   * Denotes whether or not a service account will be created for the 1Password Operator
   *
   * @default "{{ .Values.operator.create }}"
   */
  create?: string;
  /**
   * Annotations for the 1Password Connect Service Account
   *
   * @default {}
   */
  annotations?: ConnectHelmValuesOperatorServiceAccountAnnotations;
  /**
   * The name of the 1Password Connect Operator Service Account
   *
   * @default "onepassword-connect-operator"
   */
  name?: string;
};

export type ConnectHelmValuesOperatorServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ConnectHelmValuesOperatorRoleBinding = {
  /**
   * Denotes whether or not a role binding will be created for each Namespace for the 1Password Operator Service Account
   *
   * @default "{{ .Values.operator.create }}"
   */
  create?: string;
  /**
   * The name of the 1Password Operator Role Binding
   *
   * @default "onepassword-connect-operator"
   */
  name?: string;
};

export type ConnectHelmValuesOperatorClusterRole = {
  /**
   * Denotes whether or not a cluster role will be created for each for the 1Password Operator
   *
   * @default "{{ .Values.operator.create }}"
   */
  create?: string;
  /**
   * The name of the 1Password Operator Cluster Role
   *
   * @default "onepassword-connect-operator"
   */
  name?: string;
};

export type ConnectHelmValuesOperatorClusterRoleBinding = {
  /**
   * Denotes whether or not a Cluster role binding will be created for the 1Password Operator Service Account
   *
   * @default "{{ .Values.operator.create }}"
   */
  create?: string;
  /**
   * The name of the 1Password Operator Cluster Role Binding
   *
   * @default "onepassword-connect-operator"
   */
  name?: string;
};

export type ConnectHelmValuesOperatorTls = {
  /**
   * Set trust.secret to the secret name containing the Connect TLS cert when using a self-signed cert.
   *
   * @default {}
   */
  trust?: ConnectHelmValuesOperatorTlsTrust;
};

export type ConnectHelmValuesOperatorTlsTrust = object;

export type ConnectHelmValuesAcceptanceTests = {
  /**
   * Enable acceptance tests for the chart
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Test fixtures configuration for acceptance tests
   *
   * @default {}
   */
  fixtures?: ConnectHelmValuesAcceptanceTestsFixtures;
  /**
   * @default {"enabled":true,"image":{"repository":"curlimages/curl","tag":"latest"}}
   */
  healthCheck?: ConnectHelmValuesAcceptanceTestsHealthCheck;
  /**
   * Pod securityContext to be added to the acceptance test pods.
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: ConnectHelmValuesAcceptanceTestsPodSecurityContext;
  /**
   * Container securityContext to be added to the acceptance test containers.
   *
   * @default {"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true,"allowPrivilegeEscalation":false}
   */
  securityContext?: ConnectHelmValuesAcceptanceTestsSecurityContext;
};

export type ConnectHelmValuesAcceptanceTestsFixtures = object;

export type ConnectHelmValuesAcceptanceTestsHealthCheck = {
  /**
   * Enable the health check test
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"repository":"curlimages/curl","tag":"latest"}
   */
  image?: ConnectHelmValuesAcceptanceTestsHealthCheckImage;
};

export type ConnectHelmValuesAcceptanceTestsHealthCheckImage = {
  /**
   * The image repository for the health check test container
   *
   * @default "curlimages/curl"
   */
  repository?: string;
  /**
   * The image tag for the health check test container
   *
   * @default "latest"
   */
  tag?: string;
};

export type ConnectHelmValuesAcceptanceTestsPodSecurityContext = {
  /**
   * @default 65532
   */
  fsGroup?: number;
  /**
   * @default 65532
   */
  runAsUser?: number;
  /**
   * @default 65532
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: ConnectHelmValuesAcceptanceTestsPodSecurityContextSeccompProfile;
};

export type ConnectHelmValuesAcceptanceTestsPodSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type ConnectHelmValuesAcceptanceTestsSecurityContext = {
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: ConnectHelmValuesAcceptanceTestsSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type ConnectHelmValuesAcceptanceTestsSecurityContextCapabilities = {
  drop?: string[];
};

export type ConnectHelmValues = {
  /**
   * Note: values.yaml files don't support templating out of the box, so that means
   * that every value "{{ .Between.Curly.Braces }}" in this file needs to be
   * explicitly interpolated on the template side by using the `tpl` function.
   * Global common labels, applied to all resources
   *
   * @default {}
   */
  commonLabels?: ConnectHelmValuesCommonLabels;
  /**
   * This section of values is for 1Password Connect API and Sync Configuration
   *
   * @default {...} (33 keys)
   */
  connect?: ConnectHelmValuesConnect;
  /**
   * This section of values is for 1Password Operator Configuration
   *
   * @default {...} (36 keys)
   */
  operator?: ConnectHelmValuesOperator;
  /**
   * 1Password Acceptance Tests Functionality
   *
   * @default {...} (5 keys)
   */
  acceptanceTests?: ConnectHelmValuesAcceptanceTests;
};

export type ConnectHelmParameters = {
  "connect.create"?: string;
  "connect.replicas"?: string;
  "connect.api.name"?: string;
  "connect.api.imageRepository"?: string;
  "connect.api.resources.limits.memory"?: string;
  "connect.api.resources.requests.cpu"?: string;
  "connect.api.httpPort"?: string;
  "connect.api.httpsPort"?: string;
  "connect.api.logLevel"?: string;
  "connect.api.serviceMonitor.enabled"?: string;
  "connect.api.serviceMonitor.interval"?: string;
  "connect.api.serviceMonitor.path"?: string;
  "connect.api.securityContext.capabilities.drop"?: string;
  "connect.api.securityContext.readOnlyRootFilesystem"?: string;
  "connect.api.securityContext.allowPrivilegeEscalation"?: string;
  "connect.sync.name"?: string;
  "connect.sync.imageRepository"?: string;
  "connect.sync.httpPort"?: string;
  "connect.sync.logLevel"?: string;
  "connect.sync.securityContext.capabilities.drop"?: string;
  "connect.sync.securityContext.readOnlyRootFilesystem"?: string;
  "connect.sync.securityContext.allowPrivilegeEscalation"?: string;
  "connect.applicationName"?: string;
  "connect.host"?: string;
  "connect.serviceType"?: string;
  "connect.serviceAccount.create"?: string;
  "connect.serviceAccount.name"?: string;
  "connect.credentialsName"?: string;
  "connect.credentialsKey"?: string;
  "connect.credentials"?: string;
  "connect.credentials_base64"?: string;
  "connect.imagePullPolicy"?: string;
  "connect.imagePullSecrets"?: string;
  "connect.version"?: string;
  "connect.hpa.enabled"?: string;
  "connect.hpa.minReplicas"?: string;
  "connect.hpa.maxReplicas"?: string;
  "connect.hpa.avgMemoryUtilization"?: string;
  "connect.hpa.avgCpuUtilization"?: string;
  "connect.pdb.enabled"?: string;
  "connect.pdb.maxUnavailable"?: string;
  "connect.pdb.minAvailable"?: string;
  "connect.probes.liveness"?: string;
  "connect.probes.readiness"?: string;
  "connect.priorityClassName"?: string;
  "connect.podSecurityContext.fsGroup"?: string;
  "connect.podSecurityContext.runAsUser"?: string;
  "connect.podSecurityContext.runAsGroup"?: string;
  "connect.podSecurityContext.runAsNonRoot"?: string;
  "connect.podSecurityContext.seccompProfile.type"?: string;
  "connect.tolerations"?: string;
  "connect.dataVolume.name"?: string;
  "connect.dataVolume.type"?: string;
  "connect.tls.enabled"?: string;
  "connect.tls.secret"?: string;
  "connect.ingress.enabled"?: string;
  "connect.ingress.ingressClassName"?: string;
  "connect.ingress.pathType"?: string;
  "connect.ingress.hosts.host"?: string;
  "connect.ingress.hosts.paths"?: string;
  "connect.ingress.extraPaths"?: string;
  "connect.ingress.tls"?: string;
  "connect.profiler.enabled"?: string;
  "connect.profiler.interval"?: string;
  "connect.profiler.keepLast"?: string;
  "connect.customEnvVars"?: string;
  "operator.create"?: string;
  "operator.authMethod"?: string;
  "operator.replicas"?: string;
  "operator.autoRestart"?: string;
  "operator.applicationName"?: string;
  "operator.imagePullPolicy"?: string;
  "operator.imagePullSecrets"?: string;
  "operator.imageRepository"?: string;
  "operator.pollingInterval"?: string;
  "operator.version"?: string;
  "operator.podSecurityContext.fsGroup"?: string;
  "operator.podSecurityContext.runAsUser"?: string;
  "operator.podSecurityContext.runAsGroup"?: string;
  "operator.podSecurityContext.runAsNonRoot"?: string;
  "operator.podSecurityContext.seccompProfile.type"?: string;
  "operator.securityContext.capabilities.drop"?: string;
  "operator.securityContext.readOnlyRootFilesystem"?: string;
  "operator.securityContext.allowPrivilegeEscalation"?: string;
  "operator.hpa.enabled"?: string;
  "operator.hpa.minReplicas"?: string;
  "operator.hpa.maxReplicas"?: string;
  "operator.hpa.avgMemoryUtilization"?: string;
  "operator.hpa.avgCpuUtilization"?: string;
  "operator.pdb.enabled"?: string;
  "operator.pdb.maxUnavailable"?: string;
  "operator.pdb.minAvailable"?: string;
  "operator.priorityClassName"?: string;
  "operator.tolerations"?: string;
  "operator.watchNamespace"?: string;
  "operator.probes.port"?: string;
  "operator.probes.liveness.create"?: string;
  "operator.probes.liveness.failureThreshold"?: string;
  "operator.probes.liveness.periodSeconds"?: string;
  "operator.probes.liveness.initialDelaySeconds"?: string;
  "operator.probes.readiness.create"?: string;
  "operator.probes.readiness.initialDelaySeconds"?: string;
  "operator.probes.readiness.periodSeconds"?: string;
  "operator.token.name"?: string;
  "operator.token.key"?: string;
  "operator.token.value"?: string;
  "operator.serviceAccountToken.name"?: string;
  "operator.serviceAccountToken.key"?: string;
  "operator.serviceAccountToken.value"?: string;
  "operator.serviceAccount.create"?: string;
  "operator.serviceAccount.name"?: string;
  "operator.roleBinding.create"?: string;
  "operator.roleBinding.name"?: string;
  "operator.clusterRole.create"?: string;
  "operator.clusterRole.name"?: string;
  "operator.clusterRoleBinding.create"?: string;
  "operator.clusterRoleBinding.name"?: string;
  "operator.logLevel"?: string;
  "operator.enableAnnotations"?: string;
  "operator.allowEmptyValues"?: string;
  "operator.customEnvVars"?: string;
  "acceptanceTests.enabled"?: string;
  "acceptanceTests.healthCheck.enabled"?: string;
  "acceptanceTests.healthCheck.image.repository"?: string;
  "acceptanceTests.healthCheck.image.tag"?: string;
  "acceptanceTests.podSecurityContext.fsGroup"?: string;
  "acceptanceTests.podSecurityContext.runAsUser"?: string;
  "acceptanceTests.podSecurityContext.runAsGroup"?: string;
  "acceptanceTests.podSecurityContext.runAsNonRoot"?: string;
  "acceptanceTests.podSecurityContext.seccompProfile.type"?: string;
  "acceptanceTests.securityContext.capabilities.drop"?: string;
  "acceptanceTests.securityContext.readOnlyRootFilesystem"?: string;
  "acceptanceTests.securityContext.allowPrivilegeEscalation"?: string;
};
