// Generated TypeScript types for seaweedfs Helm chart

export type SeaweedfsHelmValuesGlobal = {
  /**
   * @default true
   */
  createClusterRole?: boolean;
  /**
   * @default ""
   */
  registry?: string;
  /**
   * if repository is set, it overrides the namespace part of imageName
   *
   * @default ""
   */
  repository?: string;
  /**
   * @default "chrislusf/seaweedfs"
   */
  imageName?: string;
  /**
   * @default "IfNotPresent"
   */
  imagePullPolicy?: string;
  /**
   * @default ""
   */
  imagePullSecrets?: string;
  /**
   * @default "Always"
   */
  restartPolicy?: string;
  /**
   * @default 1
   */
  loggingLevel?: number;
  /**
   * @default false
   */
  enableSecurity?: boolean;
  masterServer?: unknown;
  /**
   * @default {"jwtSigning":{"volumeWrite":true,"volumeRead":false,"filerWrite":false,"filerRead":false}}
   */
  securityConfig?: SeaweedfsHelmValuesGlobalSecurityConfig;
  /**
   * we will use this serviceAccountName for all ClusterRoles/ClusterRoleBindings
   *
   * @default "seaweedfs"
   */
  serviceAccountName?: string;
  /**
   * @default true
   */
  automountServiceAccountToken?: boolean;
  /**
   * @default {"duration":"87600h","renewBefore":"720h","alphacrds":false}
   */
  certificates?: SeaweedfsHelmValuesGlobalCertificates;
  /**
   * @default {...} (4 keys)
   */
  monitoring?: SeaweedfsHelmValuesGlobalMonitoring;
  /**
   * if enabled will use global.replicationPlacement and override master & filer defaultReplicaPlacement config
   *
   * @default false
   */
  enableReplication?: boolean;
  /**
   * replication type is XYZ:
   * X number of replica in other data centers
   * Y number of replica in other racks in the same data center
   * Z number of replica in other servers in the same rack
   *
   * @default "001"
   */
  replicationPlacement?: number;
  /**
   * @default {"WEED_CLUSTER_DEFAULT":"sw","WEED_CLUSTER_SW_MASTER":"{{ include \"seaweedfs.cluster.masterAddress\" . }}","WEED_CLUSTER_SW_FILER":"{{ include \"seaweedfs.cluster.filerAddress\" . }}"}
   */
  extraEnvironmentVars?: SeaweedfsHelmValuesGlobalExtraEnvironmentVars;
};

export type SeaweedfsHelmValuesGlobalSecurityConfig = {
  /**
   * @default {...} (4 keys)
   */
  jwtSigning?: SeaweedfsHelmValuesGlobalSecurityConfigJwtSigning;
};

export type SeaweedfsHelmValuesGlobalSecurityConfigJwtSigning = {
  /**
   * @default true
   */
  volumeWrite?: boolean;
  /**
   * @default false
   */
  volumeRead?: boolean;
  /**
   * @default false
   */
  filerWrite?: boolean;
  /**
   * @default false
   */
  filerRead?: boolean;
};

export type SeaweedfsHelmValuesGlobalCertificates = {
  /**
   * @default "87600h"
   */
  duration?: string;
  /**
   * @default "720h"
   */
  renewBefore?: string;
  /**
   * @default false
   */
  alphacrds?: boolean;
};

export type SeaweedfsHelmValuesGlobalMonitoring = {
  /**
   * @default false
   */
  enabled?: boolean;
  gatewayHost?: unknown;
  gatewayPort?: unknown;
  /**
   * @default {}
   */
  additionalLabels?: SeaweedfsHelmValuesGlobalMonitoringAdditionalLabels;
};

export type SeaweedfsHelmValuesGlobalMonitoringAdditionalLabels = object;

export type SeaweedfsHelmValuesGlobalExtraEnvironmentVars = {
  /**
   * @default "sw"
   */
  WEED_CLUSTER_DEFAULT?: string;
  /**
   * @default "{{ include "seaweedfs.cluster.masterAddress" . }}"
   */
  WEED_CLUSTER_SW_MASTER?: string;
  /**
   * @default "{{ include "seaweedfs.cluster.filerAddress" . }}"
   */
  WEED_CLUSTER_SW_FILER?: string;
};

export type SeaweedfsHelmValuesImage = {
  /**
   * @default ""
   */
  registry?: string;
  /**
   * @default ""
   */
  repository?: string;
  /**
   * @default ""
   */
  tag?: string;
};

export type SeaweedfsHelmValuesMaster = {
  /**
   * @default true
   */
  enabled?: boolean;
  imageOverride?: unknown;
  restartPolicy?: unknown;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default 9333
   */
  port?: number;
  /**
   * @default 19333
   */
  grpcPort?: number;
  /**
   * @default 9327
   */
  metricsPort?: number;
  /**
   * Metrics listen IP. If empty, defaults to ipBind
   *
   * @default ""
   */
  metricsIp?: string;
  /**
   * @default "0.0.0.0"
   */
  ipBind?: string;
  /**
   * @default false
   */
  volumePreallocate?: boolean;
  /**
   * @default 1000
   */
  volumeSizeLimitMB?: number;
  loggingOverrideLevel?: unknown;
  garbageThreshold?: unknown;
  /**
   * Prometheus push interval in seconds, default 15
   *
   * @default 15
   */
  metricsIntervalSec?: number;
  /**
   * replication type is XYZ:
   * X number of replica in other data centers
   * Y number of replica in other racks in the same data center
   * Z number of replica in other servers in the same rack
   *
   * @default "000"
   */
  defaultReplication?: number;
  /**
   * Disable http request, only gRpc operations are allowed
   *
   * @default false
   */
  disableHttp?: boolean;
  /**
   * Resume previous state on start master server
   *
   * @default false
   */
  resumeState?: boolean;
  /**
   * Use Hashicorp Raft
   *
   * @default false
   */
  raftHashicorp?: boolean;
  /**
   * Whether to bootstrap the Raft cluster. Only use it when use Hashicorp Raft
   *
   * @default false
   */
  raftBootstrap?: boolean;
  /**
   * election timeout of master servers
   *
   * @default "10s"
   */
  electionTimeout?: string;
  /**
   * heartbeat interval of master servers, and will be randomly multiplied by [1, 1.25)
   *
   * @default "300ms"
   */
  heartbeatInterval?: string;
  extraArgs?: unknown[];
  /**
   * @default "# Enter any extra configuration for master.toml..."
   */
  config?: string;
  /**
   * You can also use emptyDir storage:
   *
   * @default {"type":"hostPath","storageClass":"","hostPathPrefix":"/ssd"}
   */
  data?: SeaweedfsHelmValuesMasterData;
  /**
   * You can also use emptyDir storage:
   *
   * @default {...} (4 keys)
   */
  logs?: SeaweedfsHelmValuesMasterLogs;
  sidecars?: unknown[];
  /**
   * @default ""
   */
  initContainers?: string;
  /**
   * @default ""
   */
  extraVolumes?: string;
  /**
   * @default ""
   */
  extraVolumeMounts?: string;
  /**
   * Labels to be added to the master pods
   *
   * @default {}
   */
  podLabels?: SeaweedfsHelmValuesMasterPodLabels;
  /**
   * Annotations to be added to the master pods
   *
   * @default {}
   */
  podAnnotations?: SeaweedfsHelmValuesMasterPodAnnotations;
  /**
   * Annotations to be added to the master resources
   *
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesMasterAnnotations;
  /**
   * Set podManagementPolicy
   *
   * @default "Parallel"
   */
  podManagementPolicy?: string;
  /**
   * Resource requests, limits, etc. for the master cluster placement. This
   * should map directly to the value of the resources field for a PodSpec,
   * formatted as a multi-line string. By default no direct resource request
   * is made.
   *
   * @default {}
   */
  resources?: SeaweedfsHelmValuesMasterResources;
  /**
   * updatePartition is used to control a careful rolling update of SeaweedFS
   * masters.
   *
   * @default 0
   */
  updatePartition?: number;
  /**
   * Affinity Settings
   * Commenting out or setting as empty the affinity variable, will allow
   * deployment to single node services such as Minikube
   *
   * @default "podAntiAffinity:
  requiredDuringSchedulingIgno..."
   */
  affinity?: string;
  /**
   * Topology Spread Constraints Settings
   * This should map directly to the value of the topologySpreadConstraints
   * for a PodSpec. By Default no constraints are set.
   *
   * @default ""
   */
  topologySpreadConstraints?: string;
  /**
   * Toleration Settings for master pods
   * This should be a multi-line string matching the Toleration array
   * in a PodSpec.
   *
   * @default ""
   */
  tolerations?: string;
  /**
   * nodeSelector labels for master pod assignment, formatted as a muli-line string.
   * ref: https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#nodeselector
   * Example:
   *
   * @default ""
   */
  nodeSelector?: string;
  /**
   * used to assign priority to master pods
   * ref: https://kubernetes.io/docs/concepts/configuration/pod-priority-preemption/
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * used to assign a service account.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default ""
   */
  serviceAccountName?: string;
  /**
   * Configure security context for Pod
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   * Example:
   * podSecurityContext:
   * fsGroup: 2000
   *
   * @default {}
   */
  podSecurityContext?: SeaweedfsHelmValuesMasterPodSecurityContext;
  /**
   * Configure security context for Container
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   * Example:
   * containerSecurityContext:
   * allowPrivilegeEscalation: false
   *
   * @default {}
   */
  containerSecurityContext?: SeaweedfsHelmValuesMasterContainerSecurityContext;
  /**
   * @default {...} (7 keys)
   */
  ingress?: SeaweedfsHelmValuesMasterIngress;
  /**
   * @default {...} (4 keys)
   */
  extraEnvironmentVars?: SeaweedfsHelmValuesMasterExtraEnvironmentVars;
  /**
   * used to configure livenessProbe on master-server containers
   *
   * @default {...} (7 keys)
   */
  livenessProbe?: SeaweedfsHelmValuesMasterLivenessProbe;
  /**
   * used to configure readinessProbe on master-server containers
   *
   * @default {...} (7 keys)
   */
  readinessProbe?: SeaweedfsHelmValuesMasterReadinessProbe;
};

export type SeaweedfsHelmValuesMasterData = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "hostPath"
   */
  type?: string;
  /**
   * @default ""
   */
  storageClass?: string;
  /**
   * @default "/ssd"
   */
  hostPathPrefix?: string;
};

export type SeaweedfsHelmValuesMasterLogs = {
  /**
   * @default "hostPath"
   */
  type?: string;
  /**
   * @default ""
   */
  size?: string;
  /**
   * @default ""
   */
  storageClass?: string;
  /**
   * @default "/storage"
   */
  hostPathPrefix?: string;
};

export type SeaweedfsHelmValuesMasterPodLabels = object;

export type SeaweedfsHelmValuesMasterPodAnnotations = object;

export type SeaweedfsHelmValuesMasterAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesMasterResources = object;

export type SeaweedfsHelmValuesMasterPodSecurityContext = object;

export type SeaweedfsHelmValuesMasterContainerSecurityContext = object;

export type SeaweedfsHelmValuesMasterIngress = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  className?: string;
  /**
   * @default "master.seaweedfs.local"
   */
  host?: string;
  /**
   * @default "/sw-master/?(.*)"
   */
  path?: string;
  /**
   * @default "ImplementationSpecific"
   */
  pathType?: string;
  /**
   * nginx.ingress.kubernetes.io/auth-type: "basic"
   * nginx.ingress.kubernetes.io/auth-secret: "default/ingress-basic-auth-secret"
   * nginx.ingress.kubernetes.io/auth-realm: 'Authentication Required - SW-Master'
   * nginx.ingress.kubernetes.io/service-upstream: "true"
   * nginx.ingress.kubernetes.io/rewrite-target: /$1
   * nginx.ingress.kubernetes.io/use-regex: "true"
   * nginx.ingress.kubernetes.io/enable-rewrite-log: "true"
   * nginx.ingress.kubernetes.io/ssl-redirect: "false"
   * nginx.ingress.kubernetes.io/force-ssl-redirect: "false"
   * nginx.ingress.kubernetes.io/configuration-snippet: |
   * sub_filter '<head>' '<head> <base href="/sw-master/">'; #add base url
   * sub_filter '="/' '="./';                                #make absolute paths to relative
   * sub_filter '=/' '=./';
   * sub_filter '/seaweedfsstatic' './seaweedfsstatic';
   * sub_filter_once off;
   *
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesMasterIngressAnnotations;
  tls?: unknown[];
};

export type SeaweedfsHelmValuesMasterIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesMasterExtraEnvironmentVars = {
  /**
   * @default "7"
   */
  WEED_MASTER_VOLUME_GROWTH_COPY_1?: number;
  /**
   * @default "6"
   */
  WEED_MASTER_VOLUME_GROWTH_COPY_2?: number;
  /**
   * @default "3"
   */
  WEED_MASTER_VOLUME_GROWTH_COPY_3?: number;
  /**
   * @default "1"
   */
  WEED_MASTER_VOLUME_GROWTH_COPY_OTHER?: number;
};

export type SeaweedfsHelmValuesMasterLivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/cluster/status","scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesMasterLivenessProbeHttpGet;
  /**
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * @default 30
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 4
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesMasterLivenessProbeHttpGet = {
  /**
   * @default "/cluster/status"
   */
  path?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesMasterReadinessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/cluster/status","scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesMasterReadinessProbeHttpGet;
  /**
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * @default 45
   */
  periodSeconds?: number;
  /**
   * @default 2
   */
  successThreshold?: number;
  /**
   * @default 100
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesMasterReadinessProbeHttpGet = {
  /**
   * @default "/cluster/status"
   */
  path?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesVolume = {
  /**
   * @default true
   */
  enabled?: boolean;
  imageOverride?: unknown;
  restartPolicy?: unknown;
  /**
   * @default 8080
   */
  port?: number;
  /**
   * @default 18080
   */
  grpcPort?: number;
  /**
   * @default 9327
   */
  metricsPort?: number;
  /**
   * Metrics listen IP. If empty, defaults to ipBind
   *
   * @default ""
   */
  metricsIp?: string;
  /**
   * @default "0.0.0.0"
   */
  ipBind?: string;
  /**
   * @default 1
   */
  replicas?: number;
  loggingOverrideLevel?: unknown;
  pulseSeconds?: unknown;
  index?: unknown;
  fileSizeLimitMB?: unknown;
  /**
   * minimum free disk space(in percents). If free disk space lower this value - all volumes marks as ReadOnly
   *
   * @default 1
   */
  minFreeSpacePercent?: number;
  extraArgs?: unknown[];
  dataDirs?: SeaweedfsHelmValuesVolumeDataDirsElement[];
  /**
   * This will automatically create a job for patching Kubernetes resources if the dataDirs type is 'persistentVolumeClaim' and the size has changed.
   *
   * @default {"enabled":true,"image":"alpine/k8s:1.28.4"}
   */
  resizeHook?: SeaweedfsHelmValuesVolumeResizeHook;
  /**
   * or
   * same applies to "logs"
   *
   * @default {}
   */
  idx?: SeaweedfsHelmValuesVolumeIdx;
  /**
   * @default {}
   */
  logs?: SeaweedfsHelmValuesVolumeLogs;
  /**
   * limit background compaction or copying speed in mega bytes per second
   *
   * @default "50"
   */
  compactionMBps?: number;
  rack?: unknown;
  id?: unknown;
  dataCenter?: unknown;
  /**
   * Redirect moved or non-local volumes. (default proxy)
   *
   * @default "proxy"
   */
  readMode?: string;
  whiteList?: unknown;
  /**
   * Adjust jpg orientation when uploading.
   *
   * @default false
   */
  imagesFixOrientation?: boolean;
  sidecars?: unknown[];
  /**
   * @default ""
   */
  initContainers?: string;
  /**
   * @default ""
   */
  extraVolumes?: string;
  /**
   * @default ""
   */
  extraVolumeMounts?: string;
  /**
   * Labels to be added to the volume pods
   *
   * @default {}
   */
  podLabels?: SeaweedfsHelmValuesVolumePodLabels;
  /**
   * Annotations to be added to the volume pods
   *
   * @default {}
   */
  podAnnotations?: SeaweedfsHelmValuesVolumePodAnnotations;
  /**
   * Annotations to be added to the volume resources
   *
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesVolumeAnnotations;
  /**
   * Set podManagementPolicy
   *
   * @default "Parallel"
   */
  podManagementPolicy?: string;
  /**
   * Affinity Settings
   * Commenting out or setting as empty the affinity variable, will allow
   * deployment to single node services such as Minikube
   *
   * @default "podAntiAffinity:
  requiredDuringSchedulingIgno..."
   */
  affinity?: string;
  /**
   * Topology Spread Constraints Settings
   * This should map directly to the value of the topologySpreadConstraints
   * for a PodSpec. By Default no constraints are set.
   *
   * @default ""
   */
  topologySpreadConstraints?: string;
  /**
   * Resource requests, limits, etc. for the server cluster placement. This
   * should map directly to the value of the resources field for a PodSpec,
   * formatted as a multi-line string. By default no direct resource request
   * is made.
   *
   * @default {}
   */
  resources?: SeaweedfsHelmValuesVolumeResources;
  /**
   * Toleration Settings for server pods
   * This should be a multi-line string matching the Toleration array
   * in a PodSpec.
   *
   * @default ""
   */
  tolerations?: string;
  /**
   * nodeSelector labels for server pod assignment, formatted as a muli-line string.
   * ref: https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#nodeselector
   * Example:
   *
   * @default ""
   */
  nodeSelector?: string;
  /**
   * used to assign priority to server pods
   * ref: https://kubernetes.io/docs/concepts/configuration/pod-priority-preemption/
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * used to assign a service account.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default ""
   */
  serviceAccountName?: string;
  extraEnvironmentVars?: unknown;
  /**
   * Configure security context for Pod
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   * Example:
   * podSecurityContext:
   * fsGroup: 2000
   *
   * @default {}
   */
  podSecurityContext?: SeaweedfsHelmValuesVolumePodSecurityContext;
  /**
   * Configure security context for Container
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   * Example:
   * containerSecurityContext:
   * allowPrivilegeEscalation: false
   *
   * @default {}
   */
  containerSecurityContext?: SeaweedfsHelmValuesVolumeContainerSecurityContext;
  /**
   * used to configure livenessProbe on volume-server containers
   *
   * @default {...} (7 keys)
   */
  livenessProbe?: SeaweedfsHelmValuesVolumeLivenessProbe;
  /**
   * used to configure readinessProbe on volume-server containers
   *
   * @default {...} (7 keys)
   */
  readinessProbe?: SeaweedfsHelmValuesVolumeReadinessProbe;
};

export type SeaweedfsHelmValuesVolumeDataDirsElement = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "data1"
   */
  name?: string;
  /**
   * @default "hostPath"
   */
  type?: string;
  /**
   * @default "/ssd"
   */
  hostPathPrefix?: string;
  /**
   * @default 0
   */
  maxVolumes?: number;
};

export type SeaweedfsHelmValuesVolumeResizeHook = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default "alpine/k8s:1.28.4"
   */
  image?: string;
};

export type SeaweedfsHelmValuesVolumeIdx = object;

export type SeaweedfsHelmValuesVolumeLogs = object;

export type SeaweedfsHelmValuesVolumePodLabels = object;

export type SeaweedfsHelmValuesVolumePodAnnotations = object;

export type SeaweedfsHelmValuesVolumeAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesVolumeResources = object;

export type SeaweedfsHelmValuesVolumePodSecurityContext = object;

export type SeaweedfsHelmValuesVolumeContainerSecurityContext = object;

export type SeaweedfsHelmValuesVolumeLivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/healthz","scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesVolumeLivenessProbeHttpGet;
  /**
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * @default 90
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 4
   */
  failureThreshold?: number;
  /**
   * @default 30
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesVolumeLivenessProbeHttpGet = {
  /**
   * @default "/healthz"
   */
  path?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesVolumeReadinessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/healthz","scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesVolumeReadinessProbeHttpGet;
  /**
   * @default 15
   */
  initialDelaySeconds?: number;
  /**
   * @default 15
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 100
   */
  failureThreshold?: number;
  /**
   * @default 30
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesVolumeReadinessProbeHttpGet = {
  /**
   * @default "/healthz"
   */
  path?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesVolumes = object;

export type SeaweedfsHelmValuesFiler = {
  /**
   * @default true
   */
  enabled?: boolean;
  imageOverride?: unknown;
  restartPolicy?: unknown;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default 8888
   */
  port?: number;
  /**
   * @default 18888
   */
  grpcPort?: number;
  /**
   * @default 9327
   */
  metricsPort?: number;
  /**
   * Metrics listen IP. If empty, defaults to ipBind
   *
   * @default ""
   */
  metricsIp?: string;
  /**
   * IP address to bind to. Set to 0.0.0.0 to allow external traffic
   *
   * @default "0.0.0.0"
   */
  ipBind?: string;
  loggingOverrideLevel?: unknown;
  /**
   * @default ""
   */
  filerGroup?: string;
  dataCenter?: unknown;
  rack?: unknown;
  /**
   * replication type is XYZ:
   * X number of replica in other data centers
   * Y number of replica in other racks in the same data center
   * Z number of replica in other servers in the same rack
   *
   * @default "000"
   */
  defaultReplicaPlacement?: number;
  /**
   * turn off directory listing
   *
   * @default false
   */
  disableDirListing?: boolean;
  maxMB?: unknown;
  /**
   * encrypt data on volume servers
   *
   * @default false
   */
  encryptVolumeData?: boolean;
  /**
   * Whether proxy or redirect to volume server during file GET request
   *
   * @default false
   */
  redirectOnRead?: boolean;
  /**
   * Limit sub dir listing size (default 100000)
   *
   * @default 100000
   */
  dirListLimit?: number;
  /**
   * Disable http request, only gRpc operations are allowed
   *
   * @default false
   */
  disableHttp?: boolean;
  extraArgs?: unknown[];
  /**
   * Add a custom notification.toml to configure filer notifications
   * Example:
   * notificationConfig: |-
   * [notification.kafka]
   * enabled = false
   * hosts = [
   * "localhost:9092"
   * ]
   * topic = "seaweedfs_filer"
   * offsetFile = "./last.offset"
   * offsetSaveIntervalSeconds = 10
   *
   * @default ""
   */
  notificationConfig?: string;
  /**
   * Consider replacing with filer.data section below instead.
   * Settings for configuring stateful storage of filer pods.
   * enablePVC will create a pvc for filer for data persistence.
   *
   * @default false
   */
  enablePVC?: boolean;
  /**
   * storage should be set to the disk size of the attached volume.
   *
   * @default "25Gi"
   */
  storage?: string;
  storageClass?: unknown;
  /**
   * You can also use emptyDir storage:
   *
   * @default {...} (4 keys)
   */
  data?: SeaweedfsHelmValuesFilerData;
  /**
   * You can also use emptyDir storage:
   *
   * @default {...} (4 keys)
   */
  logs?: SeaweedfsHelmValuesFilerLogs;
  sidecars?: unknown[];
  /**
   * @default ""
   */
  initContainers?: string;
  /**
   * @default ""
   */
  extraVolumes?: string;
  /**
   * @default ""
   */
  extraVolumeMounts?: string;
  /**
   * Labels to be added to the filer pods
   *
   * @default {}
   */
  podLabels?: SeaweedfsHelmValuesFilerPodLabels;
  /**
   * Annotations to be added to the filer pods
   *
   * @default {}
   */
  podAnnotations?: SeaweedfsHelmValuesFilerPodAnnotations;
  /**
   * Annotations to be added to the filer resource
   *
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesFilerAnnotations;
  /**
   * Set podManagementPolicy
   *
   * @default "Parallel"
   */
  podManagementPolicy?: string;
  /**
   * Affinity Settings
   * Commenting out or setting as empty the affinity variable, will allow
   * deployment to single node services such as Minikube
   *
   * @default "podAntiAffinity:
  requiredDuringSchedulingIgno..."
   */
  affinity?: string;
  /**
   * Topology Spread Constraints Settings
   * This should map directly to the value of the topologySpreadConstraints
   * for a PodSpec. By Default no constraints are set.
   *
   * @default ""
   */
  topologySpreadConstraints?: string;
  /**
   * updatePartition is used to control a careful rolling update of SeaweedFS
   * masters.
   *
   * @default 0
   */
  updatePartition?: number;
  /**
   * Resource requests, limits, etc. for the server cluster placement. This
   * should map directly to the value of the resources field for a PodSpec,
   * formatted as a multi-line string. By default no direct resource request
   * is made.
   *
   * @default {}
   */
  resources?: SeaweedfsHelmValuesFilerResources;
  /**
   * Toleration Settings for server pods
   * This should be a multi-line string matching the Toleration array
   * in a PodSpec.
   *
   * @default ""
   */
  tolerations?: string;
  /**
   * nodeSelector labels for server pod assignment, formatted as a muli-line string.
   * ref: https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#nodeselector
   * Example:
   *
   * @default ""
   */
  nodeSelector?: string;
  /**
   * used to assign priority to server pods
   * ref: https://kubernetes.io/docs/concepts/configuration/pod-priority-preemption/
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * used to assign a service account.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default ""
   */
  serviceAccountName?: string;
  /**
   * Configure security context for Pod
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   * Example:
   * podSecurityContext:
   * fsGroup: 2000
   *
   * @default {}
   */
  podSecurityContext?: SeaweedfsHelmValuesFilerPodSecurityContext;
  /**
   * Configure security context for Container
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   * Example:
   * containerSecurityContext:
   * allowPrivilegeEscalation: false
   *
   * @default {}
   */
  containerSecurityContext?: SeaweedfsHelmValuesFilerContainerSecurityContext;
  /**
   * @default {...} (6 keys)
   */
  ingress?: SeaweedfsHelmValuesFilerIngress;
  /**
   * extraEnvVars is a list of extra environment variables to set with the stateful set.
   *
   * @default {...} (11 keys)
   */
  extraEnvironmentVars?: SeaweedfsHelmValuesFilerExtraEnvironmentVars;
  /**
   * used to configure livenessProbe on filer containers
   *
   * @default {...} (7 keys)
   */
  livenessProbe?: SeaweedfsHelmValuesFilerLivenessProbe;
  /**
   * used to configure readinessProbe on filer containers
   *
   * @default {...} (7 keys)
   */
  readinessProbe?: SeaweedfsHelmValuesFilerReadinessProbe;
  /**
   * secret env variables
   *
   * @default {}
   */
  secretExtraEnvironmentVars?: SeaweedfsHelmValuesFilerSecretExtraEnvironmentVars;
  /**
   * You may specify buckets to be created during the install process.
   *
   * @default {...} (7 keys)
   */
  s3?: SeaweedfsHelmValuesFilerS3;
};

export type SeaweedfsHelmValuesFilerData = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "hostPath"
   */
  type?: string;
  /**
   * @default ""
   */
  size?: string;
  /**
   * @default ""
   */
  storageClass?: string;
  /**
   * @default "/storage"
   */
  hostPathPrefix?: string;
};

export type SeaweedfsHelmValuesFilerLogs = {
  /**
   * @default "hostPath"
   */
  type?: string;
  /**
   * @default ""
   */
  size?: string;
  /**
   * @default ""
   */
  storageClass?: string;
  /**
   * @default "/storage"
   */
  hostPathPrefix?: string;
};

export type SeaweedfsHelmValuesFilerPodLabels = object;

export type SeaweedfsHelmValuesFilerPodAnnotations = object;

export type SeaweedfsHelmValuesFilerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesFilerResources = object;

export type SeaweedfsHelmValuesFilerPodSecurityContext = object;

export type SeaweedfsHelmValuesFilerContainerSecurityContext = object;

export type SeaweedfsHelmValuesFilerIngress = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  className?: string;
  /**
   * @default "seaweedfs.cluster.local"
   */
  host?: string;
  /**
   * @default "/sw-filer/?(.*)"
   */
  path?: string;
  /**
   * @default "ImplementationSpecific"
   */
  pathType?: string;
  /**
   * nginx.ingress.kubernetes.io/backend-protocol: GRPC
   * nginx.ingress.kubernetes.io/auth-type: "basic"
   * nginx.ingress.kubernetes.io/auth-secret: "default/ingress-basic-auth-secret"
   * nginx.ingress.kubernetes.io/auth-realm: 'Authentication Required - SW-Filer'
   * nginx.ingress.kubernetes.io/service-upstream: "true"
   * nginx.ingress.kubernetes.io/rewrite-target: /$1
   * nginx.ingress.kubernetes.io/use-regex: "true"
   * nginx.ingress.kubernetes.io/enable-rewrite-log: "true"
   * nginx.ingress.kubernetes.io/ssl-redirect: "false"
   * nginx.ingress.kubernetes.io/force-ssl-redirect: "false"
   * nginx.ingress.kubernetes.io/configuration-snippet: |
   * sub_filter '<head>' '<head> <base href="/sw-filer/">'; #add base url
   * sub_filter '="/' '="./';                               #make absolute paths to relative
   * sub_filter '=/' '=./';
   * sub_filter '/seaweedfsstatic' './seaweedfsstatic';
   * sub_filter_once off;
   *
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesFilerIngressAnnotations;
};

export type SeaweedfsHelmValuesFilerIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesFilerExtraEnvironmentVars = {
  /**
   * @default "false"
   */
  WEED_MYSQL_ENABLED?: boolean;
  /**
   * @default "mysql-db-host"
   */
  WEED_MYSQL_HOSTNAME?: string;
  /**
   * @default "3306"
   */
  WEED_MYSQL_PORT?: number;
  /**
   * @default "sw_database"
   */
  WEED_MYSQL_DATABASE?: string;
  /**
   * @default "5"
   */
  WEED_MYSQL_CONNECTION_MAX_IDLE?: number;
  /**
   * @default "75"
   */
  WEED_MYSQL_CONNECTION_MAX_OPEN?: number;
  /**
   * "refresh" connection every 10 minutes, eliminating mysql closing "old" connections
   *
   * @default "600"
   */
  WEED_MYSQL_CONNECTION_MAX_LIFETIME_SECONDS?: number;
  /**
   * enable usage of memsql as filer backend
   *
   * @default "true"
   */
  WEED_MYSQL_INTERPOLATEPARAMS?: boolean;
  /**
   * if you want to use leveldb2, then should enable "enablePVC". or you may lose your data.
   *
   * @default "true"
   */
  WEED_LEVELDB2_ENABLED?: boolean;
  /**
   * with http DELETE, by default the filer would check whether a folder is empty.
   * recursive_delete will delete all sub folders and files, similar to "rm -Rf"
   *
   * @default "false"
   */
  WEED_FILER_OPTIONS_RECURSIVE_DELETE?: boolean;
  /**
   * directories under this folder will be automatically creating a separate bucket
   *
   * @default "/buckets"
   */
  WEED_FILER_BUCKETS_FOLDER?: string;
};

export type SeaweedfsHelmValuesFilerLivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/","scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesFilerLivenessProbeHttpGet;
  /**
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * @default 30
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 5
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesFilerLivenessProbeHttpGet = {
  /**
   * @default "/"
   */
  path?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesFilerReadinessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/","scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesFilerReadinessProbeHttpGet;
  /**
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * @default 15
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 100
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesFilerReadinessProbeHttpGet = {
  /**
   * @default "/"
   */
  path?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesFilerSecretExtraEnvironmentVars = object;

export type SeaweedfsHelmValuesFilerS3 = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 8333
   */
  port?: number;
  /**
   * add additional https port
   *
   * @default 0
   */
  httpsPort?: number;
  /**
   * Suffix of the host name, {bucket}.{domainName}
   *
   * @default ""
   */
  domainName?: string;
  /**
   * enable user & permission to s3 (need to inject to all services)
   *
   * @default false
   */
  enableAuth?: boolean;
  existingConfigSecret?: unknown;
  /**
   * @default {}
   */
  auditLogConfig?: SeaweedfsHelmValuesFilerS3AuditLogConfig;
};

export type SeaweedfsHelmValuesFilerS3AuditLogConfig = object;

export type SeaweedfsHelmValuesS3 = {
  /**
   * @default false
   */
  enabled?: boolean;
  imageOverride?: unknown;
  restartPolicy?: unknown;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "0.0.0.0"
   */
  bindAddress?: string;
  /**
   * @default 8333
   */
  port?: number;
  /**
   * add additional https port
   *
   * @default 0
   */
  httpsPort?: number;
  /**
   * @default 9327
   */
  metricsPort?: number;
  loggingOverrideLevel?: unknown;
  /**
   * enable user & permission to s3 (need to inject to all services)
   *
   * @default false
   */
  enableAuth?: boolean;
  existingConfigSecret?: unknown;
  /**
   * @default {}
   */
  auditLogConfig?: SeaweedfsHelmValuesS3AuditLogConfig;
  /**
   * Suffix of the host name, {bucket}.{domainName}
   *
   * @default ""
   */
  domainName?: string;
  sidecars?: unknown[];
  /**
   * @default ""
   */
  initContainers?: string;
  /**
   * @default ""
   */
  extraVolumes?: string;
  /**
   * @default ""
   */
  extraVolumeMounts?: string;
  /**
   * Labels to be added to the s3 pods
   *
   * @default {}
   */
  podLabels?: SeaweedfsHelmValuesS3PodLabels;
  /**
   * Annotations to be added to the s3 pods
   *
   * @default {}
   */
  podAnnotations?: SeaweedfsHelmValuesS3PodAnnotations;
  /**
   * Annotations to be added to the s3 resources
   *
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesS3Annotations;
  /**
   * Resource requests, limits, etc. for the server cluster placement. This
   * should map directly to the value of the resources field for a PodSpec,
   * formatted as a multi-line string. By default no direct resource request
   * is made.
   *
   * @default {}
   */
  resources?: SeaweedfsHelmValuesS3Resources;
  /**
   * Toleration Settings for server pods
   * This should be a multi-line string matching the Toleration array
   * in a PodSpec.
   *
   * @default ""
   */
  tolerations?: string;
  /**
   * nodeSelector labels for server pod assignment, formatted as a muli-line string.
   * ref: https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#nodeselector
   * Example:
   *
   * @default ""
   */
  nodeSelector?: string;
  /**
   * used to assign priority to server pods
   * ref: https://kubernetes.io/docs/concepts/configuration/pod-priority-preemption/
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * used to assign a service account.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default ""
   */
  serviceAccountName?: string;
  /**
   * Configure security context for Pod
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   * Example:
   * podSecurityContext:
   * fsGroup: 2000
   *
   * @default {}
   */
  podSecurityContext?: SeaweedfsHelmValuesS3PodSecurityContext;
  /**
   * Configure security context for Container
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   * Example:
   * containerSecurityContext:
   * allowPrivilegeEscalation: false
   *
   * @default {}
   */
  containerSecurityContext?: SeaweedfsHelmValuesS3ContainerSecurityContext;
  /**
   * You can also use emptyDir storage:
   *
   * @default {...} (4 keys)
   */
  logs?: SeaweedfsHelmValuesS3Logs;
  extraEnvironmentVars?: unknown;
  extraArgs?: unknown[];
  /**
   * used to configure livenessProbe on s3 containers
   *
   * @default {...} (7 keys)
   */
  livenessProbe?: SeaweedfsHelmValuesS3LivenessProbe;
  /**
   * used to configure readinessProbe on s3 containers
   *
   * @default {...} (7 keys)
   */
  readinessProbe?: SeaweedfsHelmValuesS3ReadinessProbe;
  /**
   * @default {...} (7 keys)
   */
  ingress?: SeaweedfsHelmValuesS3Ingress;
};

export type SeaweedfsHelmValuesS3AuditLogConfig = object;

export type SeaweedfsHelmValuesS3PodLabels = object;

export type SeaweedfsHelmValuesS3PodAnnotations = object;

export type SeaweedfsHelmValuesS3Annotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesS3Resources = object;

export type SeaweedfsHelmValuesS3PodSecurityContext = object;

export type SeaweedfsHelmValuesS3ContainerSecurityContext = object;

export type SeaweedfsHelmValuesS3Logs = {
  /**
   * @default "hostPath"
   */
  type?: string;
  /**
   * @default ""
   */
  size?: string;
  /**
   * @default ""
   */
  storageClass?: string;
  /**
   * @default "/storage"
   */
  hostPathPrefix?: string;
};

export type SeaweedfsHelmValuesS3LivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/status","scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesS3LivenessProbeHttpGet;
  /**
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * @default 60
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 20
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesS3LivenessProbeHttpGet = {
  /**
   * @default "/status"
   */
  path?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesS3ReadinessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/status","scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesS3ReadinessProbeHttpGet;
  /**
   * @default 15
   */
  initialDelaySeconds?: number;
  /**
   * @default 15
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 100
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesS3ReadinessProbeHttpGet = {
  /**
   * @default "/status"
   */
  path?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesS3Ingress = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  className?: string;
  /**
   * @default "seaweedfs.cluster.local"
   */
  host?: string;
  /**
   * @default "/"
   */
  path?: string;
  /**
   * @default "Prefix"
   */
  pathType?: string;
  /**
   * additional ingress annotations for the s3 endpoint
   *
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesS3IngressAnnotations;
  tls?: unknown[];
};

export type SeaweedfsHelmValuesS3IngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesSftp = {
  /**
   * @default false
   */
  enabled?: boolean;
  imageOverride?: unknown;
  restartPolicy?: unknown;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "0.0.0.0"
   */
  bindAddress?: string;
  /**
   * Default SFTP port
   *
   * @default 2022
   */
  port?: number;
  /**
   * @default 9327
   */
  metricsPort?: number;
  /**
   * If empty, defaults to bindAddress
   *
   * @default ""
   */
  metricsIp?: string;
  loggingOverrideLevel?: unknown;
  /**
   * SSH server configuration
   * Path to the SSH private key file for host authentication
   *
   * @default "/etc/sw/seaweedfs_sftp_ssh_private_key"
   */
  sshPrivateKey?: string;
  /**
   * path to folder containing SSH private key files for host authentication
   *
   * @default "/etc/sw/ssh"
   */
  hostKeysFolder?: string;
  /**
   * Comma-separated list of allowed auth methods: password, publickey, keyboard-interactive
   *
   * @default "password,publickey"
   */
  authMethods?: string;
  /**
   * Maximum number of authentication attempts per connection
   *
   * @default 6
   */
  maxAuthTries?: number;
  /**
   * Message displayed before authentication
   *
   * @default "SeaweedFS SFTP Server"
   */
  bannerMessage?: string;
  /**
   * Timeout for authentication
   *
   * @default "2m"
   */
  loginGraceTime?: string;
  /**
   * Interval for sending keep-alive messages
   *
   * @default "5s"
   */
  clientAliveInterval?: string;
  /**
   * Maximum number of missed keep-alive messages before disconnecting
   *
   * @default 3
   */
  clientAliveCountMax?: number;
  /**
   * Prefer to read and write to volumes in this data center
   *
   * @default ""
   */
  dataCenter?: string;
  /**
   * Default to /tmp/seaweedfs-sftp-<port>.sock
   *
   * @default ""
   */
  localSocket?: string;
  /**
   * User authentication
   *
   * @default false
   */
  enableAuth?: boolean;
  existingConfigSecret?: unknown;
  existingSshConfigSecret?: unknown;
  sidecars?: unknown[];
  /**
   * @default ""
   */
  initContainers?: string;
  /**
   * @default ""
   */
  extraVolumes?: string;
  /**
   * @default ""
   */
  extraVolumeMounts?: string;
  /**
   * @default {}
   */
  podLabels?: SeaweedfsHelmValuesSftpPodLabels;
  /**
   * @default {}
   */
  podAnnotations?: SeaweedfsHelmValuesSftpPodAnnotations;
  /**
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesSftpAnnotations;
  /**
   * @default {}
   */
  resources?: SeaweedfsHelmValuesSftpResources;
  /**
   * @default ""
   */
  tolerations?: string;
  /**
   * @default ""
   */
  nodeSelector?: string;
  /**
   * @default ""
   */
  priorityClassName?: string;
  /**
   * @default ""
   */
  serviceAccountName?: string;
  /**
   * @default {}
   */
  podSecurityContext?: SeaweedfsHelmValuesSftpPodSecurityContext;
  /**
   * @default {}
   */
  containerSecurityContext?: SeaweedfsHelmValuesSftpContainerSecurityContext;
  /**
   * @default {"type":"hostPath","hostPathPrefix":"/storage"}
   */
  logs?: SeaweedfsHelmValuesSftpLogs;
  /**
   * @default {}
   */
  extraEnvironmentVars?: SeaweedfsHelmValuesSftpExtraEnvironmentVars;
  /**
   * Health checks
   * Health checks for SFTP - using tcpSocket instead of httpGet
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: SeaweedfsHelmValuesSftpLivenessProbe;
  /**
   * Health checks for SFTP - using tcpSocket instead of httpGet
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: SeaweedfsHelmValuesSftpReadinessProbe;
};

export type SeaweedfsHelmValuesSftpPodLabels = object;

export type SeaweedfsHelmValuesSftpPodAnnotations = object;

export type SeaweedfsHelmValuesSftpAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesSftpResources = object;

export type SeaweedfsHelmValuesSftpPodSecurityContext = object;

export type SeaweedfsHelmValuesSftpContainerSecurityContext = object;

export type SeaweedfsHelmValuesSftpLogs = {
  /**
   * @default "hostPath"
   */
  type?: string;
  /**
   * @default "/storage"
   */
  hostPathPrefix?: string;
};

export type SeaweedfsHelmValuesSftpExtraEnvironmentVars = object;

export type SeaweedfsHelmValuesSftpLivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * @default 60
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 20
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesSftpReadinessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 15
   */
  initialDelaySeconds?: number;
  /**
   * @default 15
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 100
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesAdmin = {
  /**
   * @default false
   */
  enabled?: boolean;
  imageOverride?: unknown;
  restartPolicy?: unknown;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * Default admin port
   *
   * @default 23646
   */
  port?: number;
  /**
   * Default gRPC port for worker connections
   *
   * @default 33646
   */
  grpcPort?: number;
  loggingOverrideLevel?: unknown;
  /**
   * Admin authentication
   *
   * @default {...} (5 keys)
   */
  secret?: SeaweedfsHelmValuesAdminSecret;
  /**
   * Data directory for admin configuration and maintenance data
   * If empty, configuration is kept in memory only
   *
   * @default ""
   */
  dataDir?: string;
  /**
   * Master servers to connect to
   * If empty, uses global.masterServer or auto-discovers from master statefulset
   *
   * @default ""
   */
  masters?: string;
  extraArgs?: unknown[];
  /**
   * Storage configuration
   *
   * @default {...} (6 keys)
   */
  data?: SeaweedfsHelmValuesAdminData;
  /**
   * @default {...} (6 keys)
   */
  logs?: SeaweedfsHelmValuesAdminLogs;
  sidecars?: unknown[];
  /**
   * @default ""
   */
  initContainers?: string;
  /**
   * @default ""
   */
  extraVolumes?: string;
  /**
   * @default ""
   */
  extraVolumeMounts?: string;
  /**
   * @default {}
   */
  podLabels?: SeaweedfsHelmValuesAdminPodLabels;
  /**
   * @default {}
   */
  podAnnotations?: SeaweedfsHelmValuesAdminPodAnnotations;
  /**
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesAdminAnnotations;
  /**
   * Set podManagementPolicy
   *
   * @default "Parallel"
   */
  podManagementPolicy?: string;
  /**
   * Affinity Settings
   * Commenting out or setting as empty the affinity variable, will allow
   * deployment to single node services such as Minikube
   *
   * @default "podAntiAffinity:
  requiredDuringSchedulingIgno..."
   */
  affinity?: string;
  /**
   * Topology Spread Constraints Settings
   * This should map directly to the value of the topologySpreadConstraints
   * for a PodSpec. By Default no constraints are set.
   *
   * @default ""
   */
  topologySpreadConstraints?: string;
  /**
   * @default {}
   */
  resources?: SeaweedfsHelmValuesAdminResources;
  /**
   * @default ""
   */
  tolerations?: string;
  /**
   * @default ""
   */
  nodeSelector?: string;
  /**
   * @default ""
   */
  priorityClassName?: string;
  /**
   * @default ""
   */
  serviceAccountName?: string;
  /**
   * @default {}
   */
  podSecurityContext?: SeaweedfsHelmValuesAdminPodSecurityContext;
  /**
   * @default {}
   */
  containerSecurityContext?: SeaweedfsHelmValuesAdminContainerSecurityContext;
  /**
   * @default {}
   */
  extraEnvironmentVars?: SeaweedfsHelmValuesAdminExtraEnvironmentVars;
  /**
   * Health checks
   *
   * @default {...} (7 keys)
   */
  livenessProbe?: SeaweedfsHelmValuesAdminLivenessProbe;
  /**
   * @default {...} (7 keys)
   */
  readinessProbe?: SeaweedfsHelmValuesAdminReadinessProbe;
  /**
   * @default {...} (7 keys)
   */
  ingress?: SeaweedfsHelmValuesAdminIngress;
  /**
   * @default {"type":"ClusterIP","annotations":{}}
   */
  service?: SeaweedfsHelmValuesAdminService;
  /**
   * ServiceMonitor annotations (separate from pod/deployment annotations)
   *
   * @default {"annotations":{}}
   */
  serviceMonitor?: SeaweedfsHelmValuesAdminServiceMonitor;
};

export type SeaweedfsHelmValuesAdminSecret = {
  /**
   * Name of an existing secret containing admin credentials. If set, adminUser and adminPassword below are ignored.
   *
   * @default ""
   */
  existingSecret?: string;
  /**
   * Key in the existing secret for the admin username. Required if existingSecret is set.
   *
   * @default ""
   */
  userKey?: string;
  /**
   * Key in the existing secret for the admin password. Required if existingSecret is set.
   *
   * @default ""
   */
  pwKey?: string;
  /**
   * @default "admin"
   */
  adminUser?: string;
  /**
   * If empty, authentication is disabled.
   *
   * @default ""
   */
  adminPassword?: string;
};

export type SeaweedfsHelmValuesAdminData = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Options: "hostPath", "persistentVolumeClaim", "emptyDir", "existingClaim"
   *
   * @default "emptyDir"
   */
  type?: string;
  /**
   * @default "10Gi"
   */
  size?: string;
  /**
   * @default ""
   */
  storageClass?: string;
  /**
   * @default "/storage"
   */
  hostPathPrefix?: string;
  /**
   * @default ""
   */
  claimName?: string;
  /**
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesAdminDataAnnotations;
};

export type SeaweedfsHelmValuesAdminDataAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesAdminLogs = {
  /**
   * Options: "hostPath", "persistentVolumeClaim", "emptyDir", "existingClaim"
   *
   * @default "emptyDir"
   */
  type?: string;
  /**
   * @default "5Gi"
   */
  size?: string;
  /**
   * @default ""
   */
  storageClass?: string;
  /**
   * @default "/storage"
   */
  hostPathPrefix?: string;
  /**
   * @default ""
   */
  claimName?: string;
  /**
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesAdminLogsAnnotations;
};

export type SeaweedfsHelmValuesAdminLogsAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesAdminPodLabels = object;

export type SeaweedfsHelmValuesAdminPodAnnotations = object;

export type SeaweedfsHelmValuesAdminAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesAdminResources = object;

export type SeaweedfsHelmValuesAdminPodSecurityContext = object;

export type SeaweedfsHelmValuesAdminContainerSecurityContext = object;

export type SeaweedfsHelmValuesAdminExtraEnvironmentVars = object;

export type SeaweedfsHelmValuesAdminLivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/health","scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesAdminLivenessProbeHttpGet;
  /**
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * @default 60
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 5
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesAdminLivenessProbeHttpGet = {
  /**
   * @default "/health"
   */
  path?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesAdminReadinessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/health","scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesAdminReadinessProbeHttpGet;
  /**
   * @default 15
   */
  initialDelaySeconds?: number;
  /**
   * @default 15
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesAdminReadinessProbeHttpGet = {
  /**
   * @default "/health"
   */
  path?: string;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesAdminIngress = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "nginx"
   */
  className?: string;
  /**
   * @default "admin.seaweedfs.local"
   */
  host?: string;
  /**
   * @default "/"
   */
  path?: string;
  /**
   * @default "Prefix"
   */
  pathType?: string;
  /**
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesAdminIngressAnnotations;
  tls?: unknown[];
};

export type SeaweedfsHelmValuesAdminIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesAdminService = {
  /**
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesAdminServiceAnnotations;
};

export type SeaweedfsHelmValuesAdminServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesAdminServiceMonitor = {
  /**
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesAdminServiceMonitorAnnotations;
};

export type SeaweedfsHelmValuesAdminServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesWorker = {
  /**
   * @default false
   */
  enabled?: boolean;
  imageOverride?: unknown;
  restartPolicy?: unknown;
  /**
   * @default 1
   */
  replicas?: number;
  loggingOverrideLevel?: unknown;
  /**
   * @default 9327
   */
  metricsPort?: number;
  /**
   * Admin server to connect to
   *
   * @default ""
   */
  adminServer?: string;
  /**
   * @default "vacuum,balance,erasure_coding"
   */
  capabilities?: string;
  /**
   * Maximum number of concurrent tasks
   *
   * @default 3
   */
  maxConcurrent?: number;
  /**
   * Working directory for task execution
   *
   * @default "/tmp/seaweedfs-worker"
   */
  workingDir?: string;
  extraArgs?: unknown[];
  /**
   * Note: Workers use Deployment, so use "emptyDir", "hostPath", or "existingClaim"
   * Do NOT use "persistentVolumeClaim" - use "existingClaim" with pre-provisioned PVC instead
   *
   * @default {"type":"emptyDir","hostPathPrefix":"/storage","claimName":""}
   */
  data?: SeaweedfsHelmValuesWorkerData;
  /**
   * @default {"type":"emptyDir","hostPathPrefix":"/storage","claimName":""}
   */
  logs?: SeaweedfsHelmValuesWorkerLogs;
  sidecars?: unknown[];
  /**
   * @default ""
   */
  initContainers?: string;
  /**
   * @default ""
   */
  extraVolumes?: string;
  /**
   * @default ""
   */
  extraVolumeMounts?: string;
  /**
   * @default {}
   */
  podLabels?: SeaweedfsHelmValuesWorkerPodLabels;
  /**
   * @default {}
   */
  podAnnotations?: SeaweedfsHelmValuesWorkerPodAnnotations;
  /**
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesWorkerAnnotations;
  /**
   * Affinity Settings
   * Commenting out or setting as empty the affinity variable, will allow
   * deployment to single node services such as Minikube
   *
   * @default "podAntiAffinity:
  requiredDuringSchedulingIgno..."
   */
  affinity?: string;
  /**
   * Topology Spread Constraints Settings
   * This should map directly to the value of the topologySpreadConstraints
   * for a PodSpec. By Default no constraints are set.
   *
   * @default ""
   */
  topologySpreadConstraints?: string;
  /**
   * @default {"requests":{"cpu":"500m","memory":"512Mi"},"limits":{"cpu":"2","memory":"2Gi"}}
   */
  resources?: SeaweedfsHelmValuesWorkerResources;
  /**
   * @default ""
   */
  tolerations?: string;
  /**
   * @default ""
   */
  nodeSelector?: string;
  /**
   * @default ""
   */
  priorityClassName?: string;
  /**
   * @default ""
   */
  serviceAccountName?: string;
  /**
   * @default {}
   */
  podSecurityContext?: SeaweedfsHelmValuesWorkerPodSecurityContext;
  /**
   * @default {}
   */
  containerSecurityContext?: SeaweedfsHelmValuesWorkerContainerSecurityContext;
  /**
   * @default {}
   */
  extraEnvironmentVars?: SeaweedfsHelmValuesWorkerExtraEnvironmentVars;
  /**
   * Health checks for worker pods
   * Workers expose /health (liveness) and /ready (readiness) endpoints on the metricsPort
   *
   * @default {...} (7 keys)
   */
  livenessProbe?: SeaweedfsHelmValuesWorkerLivenessProbe;
  /**
   * @default {...} (7 keys)
   */
  readinessProbe?: SeaweedfsHelmValuesWorkerReadinessProbe;
  /**
   * ServiceMonitor annotations (separate from pod/deployment annotations)
   *
   * @default {"annotations":{}}
   */
  serviceMonitor?: SeaweedfsHelmValuesWorkerServiceMonitor;
};

export type SeaweedfsHelmValuesWorkerData = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "emptyDir"
   */
  type?: string;
  /**
   * @default "/storage"
   */
  hostPathPrefix?: string;
  /**
   * For existingClaim type
   *
   * @default ""
   */
  claimName?: string;
};

export type SeaweedfsHelmValuesWorkerLogs = {
  /**
   * @default "emptyDir"
   */
  type?: string;
  /**
   * @default "/storage"
   */
  hostPathPrefix?: string;
  /**
   * For existingClaim type
   *
   * @default ""
   */
  claimName?: string;
};

export type SeaweedfsHelmValuesWorkerPodLabels = object;

export type SeaweedfsHelmValuesWorkerPodAnnotations = object;

export type SeaweedfsHelmValuesWorkerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesWorkerResources = {
  /**
   * @default {"cpu":"500m","memory":"512Mi"}
   */
  requests?: SeaweedfsHelmValuesWorkerResourcesRequests;
  /**
   * @default {"cpu":"2","memory":"2Gi"}
   */
  limits?: SeaweedfsHelmValuesWorkerResourcesLimits;
};

export type SeaweedfsHelmValuesWorkerResourcesRequests = {
  /**
   * @default "500m"
   */
  cpu?: string;
  /**
   * @default "512Mi"
   */
  memory?: string;
};

export type SeaweedfsHelmValuesWorkerResourcesLimits = {
  /**
   * @default "2"
   */
  cpu?: number;
  /**
   * @default "2Gi"
   */
  memory?: string;
};

export type SeaweedfsHelmValuesWorkerPodSecurityContext = object;

export type SeaweedfsHelmValuesWorkerContainerSecurityContext = object;

export type SeaweedfsHelmValuesWorkerExtraEnvironmentVars = object;

export type SeaweedfsHelmValuesWorkerLivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/health","port":"metrics"}
   */
  httpGet?: SeaweedfsHelmValuesWorkerLivenessProbeHttpGet;
  /**
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * @default 60
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 5
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesWorkerLivenessProbeHttpGet = {
  /**
   * @default "/health"
   */
  path?: string;
  /**
   * @default "metrics"
   */
  port?: string;
};

export type SeaweedfsHelmValuesWorkerReadinessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/ready","port":"metrics"}
   */
  httpGet?: SeaweedfsHelmValuesWorkerReadinessProbeHttpGet;
  /**
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * @default 15
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesWorkerReadinessProbeHttpGet = {
  /**
   * @default "/ready"
   */
  path?: string;
  /**
   * @default "metrics"
   */
  port?: string;
};

export type SeaweedfsHelmValuesWorkerServiceMonitor = {
  /**
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesWorkerServiceMonitorAnnotations;
};

export type SeaweedfsHelmValuesWorkerServiceMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesAllInOne = {
  /**
   * @default false
   */
  enabled?: boolean;
  imageOverride?: unknown;
  /**
   * @default "Always"
   */
  restartPolicy?: string;
  /**
   * Number of replicas (note: multiple replicas may require shared storage)
   *
   * @default 1
   */
  replicas?: number;
  /**
   * Core configuration
   * Connection idle seconds
   *
   * @default 30
   */
  idleTimeout?: number;
  /**
   * Current volume server's data center name
   *
   * @default ""
   */
  dataCenter?: string;
  /**
   * Current volume server's rack name
   *
   * @default ""
   */
  rack?: string;
  /**
   * Comma separated IP addresses having write permission
   *
   * @default ""
   */
  whiteList?: string;
  /**
   * Disable HTTP requests, only gRPC operations are allowed
   *
   * @default false
   */
  disableHttp?: boolean;
  /**
   * Prometheus metrics listen port
   *
   * @default 9324
   */
  metricsPort?: number;
  /**
   * Metrics listen IP. If empty, defaults to bindAddress
   *
   * @default ""
   */
  metricsIp?: string;
  loggingOverrideLevel?: unknown;
  extraArgs?: unknown[];
  /**
   * For single replica, Recreate is recommended to avoid data conflicts.
   * For multiple replicas with RollingUpdate, you MUST use shared storage
   * (e.g., data.type: persistentVolumeClaim with ReadWriteMany access mode)
   * to avoid data loss or inconsistency between pods.
   *
   * @default {"type":"Recreate"}
   */
  updateStrategy?: SeaweedfsHelmValuesAllInOneUpdateStrategy;
  /**
   * Note: Most parameters below default to null, which means they inherit from
   * the global s3.* settings. Set explicit values here to override for allInOne only.
   * You may specify buckets to be created during the install process.
   * Note: Most parameters below default to null, which means they inherit from
   * the global sftp.* settings. Set explicit values here to override for allInOne only.
   *
   * @default {...} (7 keys)
   */
  s3?: SeaweedfsHelmValuesAllInOneS3;
  /**
   * @default {...} (13 keys)
   */
  sftp?: SeaweedfsHelmValuesAllInOneSftp;
  /**
   * Service settings
   *
   * @default {"annotations":{},"type":"ClusterIP","internalTrafficPolicy":"Cluster"}
   */
  service?: SeaweedfsHelmValuesAllInOneService;
  /**
   * filer.ingress settings. The templates automatically detect all-in-one mode
   * and point to the correct service (seaweedfs-all-in-one instead of
   * seaweedfs-s3 or seaweedfs-filer).
   * Storage configuration
   *
   * @default {...} (7 keys)
   */
  data?: SeaweedfsHelmValuesAllInOneData;
  /**
   * Health checks
   *
   * @default {...} (7 keys)
   */
  readinessProbe?: SeaweedfsHelmValuesAllInOneReadinessProbe;
  /**
   * @default {...} (7 keys)
   */
  livenessProbe?: SeaweedfsHelmValuesAllInOneLivenessProbe;
  /**
   * Additional resources
   * Additional environment variables
   *
   * @default {}
   */
  extraEnvironmentVars?: SeaweedfsHelmValuesAllInOneExtraEnvironmentVars;
  /**
   * Secret environment variables (for database credentials, etc.)
   * Example:
   * secretExtraEnvironmentVars:
   * WEED_POSTGRES_USERNAME:
   * secretKeyRef:
   * WEED_POSTGRES_PASSWORD:
   * secretKeyRef:
   * key: password
   *
   * @default {}
   */
  secretExtraEnvironmentVars?: SeaweedfsHelmValuesAllInOneSecretExtraEnvironmentVars;
  /**
   * Additional volume mounts
   *
   * @default ""
   */
  extraVolumeMounts?: string;
  /**
   * Additional volumes
   *
   * @default ""
   */
  extraVolumes?: string;
  /**
   * Init containers
   *
   * @default ""
   */
  initContainers?: string;
  /**
   * Sidecar containers
   *
   * @default ""
   */
  sidecars?: string;
  /**
   * Annotations for the deployment
   *
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesAllInOneAnnotations;
  /**
   * Annotations for the pods
   *
   * @default {}
   */
  podAnnotations?: SeaweedfsHelmValuesAllInOnePodAnnotations;
  /**
   * Labels for the pods
   *
   * @default {}
   */
  podLabels?: SeaweedfsHelmValuesAllInOnePodLabels;
  /**
   * Scheduling configuration
   * Affinity Settings
   * Commenting out or setting as empty the affinity variable, will allow
   * deployment to single node services such as Minikube
   *
   * @default "podAntiAffinity:
  requiredDuringSchedulingIgno..."
   */
  affinity?: string;
  /**
   * Topology Spread Constraints Settings
   * This should map directly to the value of the topologySpreadConstraints
   * for a PodSpec. By Default no constraints are set.
   *
   * @default ""
   */
  topologySpreadConstraints?: string;
  /**
   * Toleration Settings for pods
   * This should be a multi-line string matching the Toleration array
   * in a PodSpec.
   *
   * @default ""
   */
  tolerations?: string;
  /**
   * nodeSelector labels for pod assignment, formatted as a muli-line string.
   * ref: https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#nodeselector
   *
   * @default ""
   */
  nodeSelector?: string;
  /**
   * Used to assign priority to pods
   * ref: https://kubernetes.io/docs/concepts/configuration/pod-priority-preemption/
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Used to assign a service account.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default ""
   */
  serviceAccountName?: string;
  /**
   * Configure security context for Pod
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   * Example:
   * podSecurityContext:
   * fsGroup: 2000
   *
   * @default {}
   */
  podSecurityContext?: SeaweedfsHelmValuesAllInOnePodSecurityContext;
  /**
   * Configure security context for Container
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
   * Example:
   * containerSecurityContext:
   * allowPrivilegeEscalation: false
   *
   * @default {}
   */
  containerSecurityContext?: SeaweedfsHelmValuesAllInOneContainerSecurityContext;
  /**
   * Resource management
   *
   * @default {"limits":{"cpu":"2","memory":"2Gi"},"requests":{"cpu":"500m","memory":"1Gi"}}
   */
  resources?: SeaweedfsHelmValuesAllInOneResources;
};

export type SeaweedfsHelmValuesAllInOneUpdateStrategy = {
  /**
   * @default "Recreate"
   */
  type?: string;
};

export type SeaweedfsHelmValuesAllInOneS3 = {
  /**
   * Whether to enable S3 gateway
   *
   * @default false
   */
  enabled?: boolean;
  port?: unknown;
  httpsPort?: unknown;
  domainName?: unknown;
  /**
   * Enable user & permission to S3
   *
   * @default false
   */
  enableAuth?: boolean;
  existingConfigSecret?: unknown;
  auditLogConfig?: unknown;
};

export type SeaweedfsHelmValuesAllInOneSftp = {
  /**
   * Whether to enable SFTP server
   *
   * @default false
   */
  enabled?: boolean;
  port?: unknown;
  sshPrivateKey?: unknown;
  hostKeysFolder?: unknown;
  authMethods?: unknown;
  maxAuthTries?: unknown;
  bannerMessage?: unknown;
  loginGraceTime?: unknown;
  clientAliveInterval?: unknown;
  clientAliveCountMax?: unknown;
  /**
   * Enable SFTP authentication
   *
   * @default false
   */
  enableAuth?: boolean;
  existingConfigSecret?: unknown;
  existingSshConfigSecret?: unknown;
};

export type SeaweedfsHelmValuesAllInOneService = {
  /**
   * Annotations for the service
   *
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesAllInOneServiceAnnotations;
  /**
   * Service type (ClusterIP, NodePort, LoadBalancer)
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Internal traffic policy
   *
   * @default "Cluster"
   */
  internalTrafficPolicy?: string;
};

export type SeaweedfsHelmValuesAllInOneServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesAllInOneData = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Options: "hostPath", "persistentVolumeClaim", "emptyDir", "existingClaim"
   *
   * @default "emptyDir"
   */
  type?: string;
  /**
   * Path prefix for hostPath volumes
   *
   * @default "/mnt/data"
   */
  hostPathPrefix?: string;
  /**
   * Name of the PVC to use (for existingClaim type)
   *
   * @default "seaweedfs-data-pvc"
   */
  claimName?: string;
  size?: unknown;
  storageClass?: unknown;
  accessModes?: unknown[];
  /**
   * Annotations for the PVC
   *
   * @default {}
   */
  annotations?: SeaweedfsHelmValuesAllInOneDataAnnotations;
};

export type SeaweedfsHelmValuesAllInOneDataAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesAllInOneReadinessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/cluster/status","port":9333,"scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesAllInOneReadinessProbeHttpGet;
  /**
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * @default 15
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 5
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesAllInOneReadinessProbeHttpGet = {
  /**
   * @default "/cluster/status"
   */
  path?: string;
  /**
   * @default 9333
   */
  port?: number;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesAllInOneLivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"path":"/cluster/status","port":9333,"scheme":"HTTP"}
   */
  httpGet?: SeaweedfsHelmValuesAllInOneLivenessProbeHttpGet;
  /**
   * @default 20
   */
  initialDelaySeconds?: number;
  /**
   * @default 30
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 5
   */
  failureThreshold?: number;
  /**
   * @default 5
   */
  timeoutSeconds?: number;
};

export type SeaweedfsHelmValuesAllInOneLivenessProbeHttpGet = {
  /**
   * @default "/cluster/status"
   */
  path?: string;
  /**
   * @default 9333
   */
  port?: number;
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type SeaweedfsHelmValuesAllInOneExtraEnvironmentVars = object;

export type SeaweedfsHelmValuesAllInOneSecretExtraEnvironmentVars = object;

export type SeaweedfsHelmValuesAllInOneAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type SeaweedfsHelmValuesAllInOnePodAnnotations = object;

export type SeaweedfsHelmValuesAllInOnePodLabels = object;

export type SeaweedfsHelmValuesAllInOnePodSecurityContext = object;

export type SeaweedfsHelmValuesAllInOneContainerSecurityContext = object;

export type SeaweedfsHelmValuesAllInOneResources = {
  /**
   * @default {"cpu":"2","memory":"2Gi"}
   */
  limits?: SeaweedfsHelmValuesAllInOneResourcesLimits;
  /**
   * @default {"cpu":"500m","memory":"1Gi"}
   */
  requests?: SeaweedfsHelmValuesAllInOneResourcesRequests;
};

export type SeaweedfsHelmValuesAllInOneResourcesLimits = {
  /**
   * @default "2"
   */
  cpu?: number;
  /**
   * @default "2Gi"
   */
  memory?: string;
};

export type SeaweedfsHelmValuesAllInOneResourcesRequests = {
  /**
   * @default "500m"
   */
  cpu?: string;
  /**
   * @default "1Gi"
   */
  memory?: string;
};

export type SeaweedfsHelmValuesCosi = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "ghcr.io/seaweedfs/seaweedfs-cosi-driver:v0.1.2"
   */
  image?: string;
  /**
   * @default "seaweedfs.objectstorage.k8s.io"
   */
  driverName?: string;
  /**
   * @default "seaweedfs"
   */
  bucketClassName?: string;
  /**
   * @default ""
   */
  endpoint?: string;
  /**
   * @default ""
   */
  region?: string;
  /**
   * @default {"image":"gcr.io/k8s-staging-sig-storage/objectstorage-sidecar:v20250711-controllerv0.2.0-rc1-80-gc2f6e65","resources":{}}
   */
  sidecar?: SeaweedfsHelmValuesCosiSidecar;
  /**
   * enable user & permission to s3 (need to inject to all services)
   *
   * @default false
   */
  enableAuth?: boolean;
  existingConfigSecret?: unknown;
  /**
   * @default {}
   */
  podSecurityContext?: SeaweedfsHelmValuesCosiPodSecurityContext;
  /**
   * @default {}
   */
  containerSecurityContext?: SeaweedfsHelmValuesCosiContainerSecurityContext;
  /**
   * @default ""
   */
  extraVolumes?: string;
  /**
   * @default ""
   */
  extraVolumeMounts?: string;
  /**
   * Resource requests, limits, etc. for the server cluster placement. This
   * should map directly to the value of the resources field for a PodSpec,
   * formatted as a multi-line string. By default no direct resource request
   * is made.
   *
   * @default {}
   */
  resources?: SeaweedfsHelmValuesCosiResources;
};

export type SeaweedfsHelmValuesCosiSidecar = {
  /**
   * @default "gcr.io/k8s-staging-sig-storage/objectstorage-si..."
   */
  image?: string;
  /**
   * Resource requests, limits, etc. for the server cluster placement. This
   * should map directly to the value of the resources field for a PodSpec,
   * formatted as a multi-line string. By default no direct resource request
   * is made.
   *
   * @default {}
   */
  resources?: SeaweedfsHelmValuesCosiSidecarResources;
};

export type SeaweedfsHelmValuesCosiSidecarResources = object;

export type SeaweedfsHelmValuesCosiPodSecurityContext = object;

export type SeaweedfsHelmValuesCosiContainerSecurityContext = object;

export type SeaweedfsHelmValuesCosiResources = object;

export type SeaweedfsHelmValuesCertificates = {
  /**
   * @default "SeaweedFS CA"
   */
  commonName?: string;
  ipAddresses?: unknown[];
  /**
   * @default "RSA"
   */
  keyAlgorithm?: string;
  /**
   * @default 2048
   */
  keySize?: number;
  /**
   * 90d
   *
   * @default "2160h"
   */
  duration?: string;
  /**
   * 15d
   *
   * @default "360h"
   */
  renewBefore?: string;
  /**
   * @default {"duration":"87600h","renewBefore":"720h"}
   */
  ca?: SeaweedfsHelmValuesCertificatesCa;
  /**
   * @default {"enabled":false}
   */
  externalCertificates?: SeaweedfsHelmValuesCertificatesExternalCertificates;
};

export type SeaweedfsHelmValuesCertificatesCa = {
  /**
   * 10 years
   *
   * @default "87600h"
   */
  duration?: string;
  /**
   * 30d
   *
   * @default "720h"
   */
  renewBefore?: string;
};

export type SeaweedfsHelmValuesCertificatesExternalCertificates = {
  /**
   * This will avoid the need to use cert-manager and will rely on providing your own external certificates and CA
   * you will need to store your provided certificates in the secret read by the different services:
   * seaweedfs-master-cert, seaweedfs-filer-cert, etc. Can see any statefulset definition to see secret names
   *
   * @default false
   */
  enabled?: boolean;
};

export type SeaweedfsHelmValuesPodLabels = object;

export type SeaweedfsHelmValuesPodAnnotations = object;

export type SeaweedfsHelmValues = {
  /**
   * @default {...} (18 keys)
   */
  global?: SeaweedfsHelmValuesGlobal;
  /**
   * @default {"registry":"","repository":"","tag":""}
   */
  image?: SeaweedfsHelmValuesImage;
  /**
   * @default {...} (47 keys)
   */
  master?: SeaweedfsHelmValuesMaster;
  /**
   * @default {...} (46 keys)
   */
  volume?: SeaweedfsHelmValuesVolume;
  /**
   * Map of named volume groups for topology-aware deployments.
   * Each key inherits all fields from the `volume` section but can override
   * them locally—for example, replicas, nodeSelector, dataCenter, etc.
   * To switch entirely to this scheme, set `volume.enabled: false`
   * and define one entry per zone/data-center under `volumes`.
   *
   * @default {}
   */
  volumes?: SeaweedfsHelmValuesVolumes;
  /**
   * @default {...} (51 keys)
   */
  filer?: SeaweedfsHelmValuesFiler;
  /**
   * @default {...} (33 keys)
   */
  s3?: SeaweedfsHelmValuesS3;
  /**
   * @default {...} (40 keys)
   */
  sftp?: SeaweedfsHelmValuesSftp;
  /**
   * @default {...} (36 keys)
   */
  admin?: SeaweedfsHelmValuesAdmin;
  /**
   * @default {...} (33 keys)
   */
  worker?: SeaweedfsHelmValuesWorker;
  /**
   * All-in-one deployment configuration
   *
   * @default {...} (38 keys)
   */
  allInOne?: SeaweedfsHelmValuesAllInOne;
  /**
   * Deploy Kubernetes COSI Driver for SeaweedFS
   * Requires COSI CRDs and controller to be installed in the cluster
   * For more information, visit: https://container-object-storage-interface.github.io/docs/deployment-guide
   *
   * @default {...} (14 keys)
   */
  cosi?: SeaweedfsHelmValuesCosi;
  /**
   * @default {...} (8 keys)
   */
  certificates?: SeaweedfsHelmValuesCertificates;
  /**
   * Labels to be added to all the created pods
   *
   * @default {}
   */
  podLabels?: SeaweedfsHelmValuesPodLabels;
  /**
   * Annotations to be added to all the created pods
   *
   * @default {}
   */
  podAnnotations?: SeaweedfsHelmValuesPodAnnotations;
};

export type SeaweedfsHelmParameters = {
  "global.createClusterRole"?: string;
  "global.registry"?: string;
  "global.repository"?: string;
  "global.imageName"?: string;
  "global.imagePullPolicy"?: string;
  "global.imagePullSecrets"?: string;
  "global.restartPolicy"?: string;
  "global.loggingLevel"?: string;
  "global.enableSecurity"?: string;
  "global.masterServer"?: string;
  "global.securityConfig.jwtSigning.volumeWrite"?: string;
  "global.securityConfig.jwtSigning.volumeRead"?: string;
  "global.securityConfig.jwtSigning.filerWrite"?: string;
  "global.securityConfig.jwtSigning.filerRead"?: string;
  "global.serviceAccountName"?: string;
  "global.automountServiceAccountToken"?: string;
  "global.certificates.duration"?: string;
  "global.certificates.renewBefore"?: string;
  "global.certificates.alphacrds"?: string;
  "global.monitoring.enabled"?: string;
  "global.monitoring.gatewayHost"?: string;
  "global.monitoring.gatewayPort"?: string;
  "global.enableReplication"?: string;
  "global.replicationPlacement"?: string;
  "global.extraEnvironmentVars.WEED_CLUSTER_DEFAULT"?: string;
  "global.extraEnvironmentVars.WEED_CLUSTER_SW_MASTER"?: string;
  "global.extraEnvironmentVars.WEED_CLUSTER_SW_FILER"?: string;
  "image.registry"?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "master.enabled"?: string;
  "master.imageOverride"?: string;
  "master.restartPolicy"?: string;
  "master.replicas"?: string;
  "master.port"?: string;
  "master.grpcPort"?: string;
  "master.metricsPort"?: string;
  "master.metricsIp"?: string;
  "master.ipBind"?: string;
  "master.volumePreallocate"?: string;
  "master.volumeSizeLimitMB"?: string;
  "master.loggingOverrideLevel"?: string;
  "master.garbageThreshold"?: string;
  "master.metricsIntervalSec"?: string;
  "master.defaultReplication"?: string;
  "master.disableHttp"?: string;
  "master.resumeState"?: string;
  "master.raftHashicorp"?: string;
  "master.raftBootstrap"?: string;
  "master.electionTimeout"?: string;
  "master.heartbeatInterval"?: string;
  "master.extraArgs"?: string;
  "master.config"?: string;
  "master.data.type"?: string;
  "master.data.storageClass"?: string;
  "master.data.hostPathPrefix"?: string;
  "master.logs.type"?: string;
  "master.logs.size"?: string;
  "master.logs.storageClass"?: string;
  "master.logs.hostPathPrefix"?: string;
  "master.sidecars"?: string;
  "master.initContainers"?: string;
  "master.extraVolumes"?: string;
  "master.extraVolumeMounts"?: string;
  "master.podManagementPolicy"?: string;
  "master.updatePartition"?: string;
  "master.affinity"?: string;
  "master.topologySpreadConstraints"?: string;
  "master.tolerations"?: string;
  "master.nodeSelector"?: string;
  "master.priorityClassName"?: string;
  "master.serviceAccountName"?: string;
  "master.ingress.enabled"?: string;
  "master.ingress.className"?: string;
  "master.ingress.host"?: string;
  "master.ingress.path"?: string;
  "master.ingress.pathType"?: string;
  "master.ingress.tls"?: string;
  "master.extraEnvironmentVars.WEED_MASTER_VOLUME_GROWTH_COPY_1"?: string;
  "master.extraEnvironmentVars.WEED_MASTER_VOLUME_GROWTH_COPY_2"?: string;
  "master.extraEnvironmentVars.WEED_MASTER_VOLUME_GROWTH_COPY_3"?: string;
  "master.extraEnvironmentVars.WEED_MASTER_VOLUME_GROWTH_COPY_OTHER"?: string;
  "master.livenessProbe.enabled"?: string;
  "master.livenessProbe.httpGet.path"?: string;
  "master.livenessProbe.httpGet.scheme"?: string;
  "master.livenessProbe.initialDelaySeconds"?: string;
  "master.livenessProbe.periodSeconds"?: string;
  "master.livenessProbe.successThreshold"?: string;
  "master.livenessProbe.failureThreshold"?: string;
  "master.livenessProbe.timeoutSeconds"?: string;
  "master.readinessProbe.enabled"?: string;
  "master.readinessProbe.httpGet.path"?: string;
  "master.readinessProbe.httpGet.scheme"?: string;
  "master.readinessProbe.initialDelaySeconds"?: string;
  "master.readinessProbe.periodSeconds"?: string;
  "master.readinessProbe.successThreshold"?: string;
  "master.readinessProbe.failureThreshold"?: string;
  "master.readinessProbe.timeoutSeconds"?: string;
  "volume.enabled"?: string;
  "volume.imageOverride"?: string;
  "volume.restartPolicy"?: string;
  "volume.port"?: string;
  "volume.grpcPort"?: string;
  "volume.metricsPort"?: string;
  "volume.metricsIp"?: string;
  "volume.ipBind"?: string;
  "volume.replicas"?: string;
  "volume.loggingOverrideLevel"?: string;
  "volume.pulseSeconds"?: string;
  "volume.index"?: string;
  "volume.fileSizeLimitMB"?: string;
  "volume.minFreeSpacePercent"?: string;
  "volume.extraArgs"?: string;
  "volume.dataDirs.name"?: string;
  "volume.dataDirs.type"?: string;
  "volume.dataDirs.hostPathPrefix"?: string;
  "volume.dataDirs.maxVolumes"?: string;
  "volume.resizeHook.enabled"?: string;
  "volume.resizeHook.image"?: string;
  "volume.compactionMBps"?: string;
  "volume.rack"?: string;
  "volume.id"?: string;
  "volume.dataCenter"?: string;
  "volume.readMode"?: string;
  "volume.whiteList"?: string;
  "volume.imagesFixOrientation"?: string;
  "volume.sidecars"?: string;
  "volume.initContainers"?: string;
  "volume.extraVolumes"?: string;
  "volume.extraVolumeMounts"?: string;
  "volume.podManagementPolicy"?: string;
  "volume.affinity"?: string;
  "volume.topologySpreadConstraints"?: string;
  "volume.tolerations"?: string;
  "volume.nodeSelector"?: string;
  "volume.priorityClassName"?: string;
  "volume.serviceAccountName"?: string;
  "volume.extraEnvironmentVars"?: string;
  "volume.livenessProbe.enabled"?: string;
  "volume.livenessProbe.httpGet.path"?: string;
  "volume.livenessProbe.httpGet.scheme"?: string;
  "volume.livenessProbe.initialDelaySeconds"?: string;
  "volume.livenessProbe.periodSeconds"?: string;
  "volume.livenessProbe.successThreshold"?: string;
  "volume.livenessProbe.failureThreshold"?: string;
  "volume.livenessProbe.timeoutSeconds"?: string;
  "volume.readinessProbe.enabled"?: string;
  "volume.readinessProbe.httpGet.path"?: string;
  "volume.readinessProbe.httpGet.scheme"?: string;
  "volume.readinessProbe.initialDelaySeconds"?: string;
  "volume.readinessProbe.periodSeconds"?: string;
  "volume.readinessProbe.successThreshold"?: string;
  "volume.readinessProbe.failureThreshold"?: string;
  "volume.readinessProbe.timeoutSeconds"?: string;
  "filer.enabled"?: string;
  "filer.imageOverride"?: string;
  "filer.restartPolicy"?: string;
  "filer.replicas"?: string;
  "filer.port"?: string;
  "filer.grpcPort"?: string;
  "filer.metricsPort"?: string;
  "filer.metricsIp"?: string;
  "filer.ipBind"?: string;
  "filer.loggingOverrideLevel"?: string;
  "filer.filerGroup"?: string;
  "filer.dataCenter"?: string;
  "filer.rack"?: string;
  "filer.defaultReplicaPlacement"?: string;
  "filer.disableDirListing"?: string;
  "filer.maxMB"?: string;
  "filer.encryptVolumeData"?: string;
  "filer.redirectOnRead"?: string;
  "filer.dirListLimit"?: string;
  "filer.disableHttp"?: string;
  "filer.extraArgs"?: string;
  "filer.notificationConfig"?: string;
  "filer.enablePVC"?: string;
  "filer.storage"?: string;
  "filer.storageClass"?: string;
  "filer.data.type"?: string;
  "filer.data.size"?: string;
  "filer.data.storageClass"?: string;
  "filer.data.hostPathPrefix"?: string;
  "filer.logs.type"?: string;
  "filer.logs.size"?: string;
  "filer.logs.storageClass"?: string;
  "filer.logs.hostPathPrefix"?: string;
  "filer.sidecars"?: string;
  "filer.initContainers"?: string;
  "filer.extraVolumes"?: string;
  "filer.extraVolumeMounts"?: string;
  "filer.podManagementPolicy"?: string;
  "filer.affinity"?: string;
  "filer.topologySpreadConstraints"?: string;
  "filer.updatePartition"?: string;
  "filer.tolerations"?: string;
  "filer.nodeSelector"?: string;
  "filer.priorityClassName"?: string;
  "filer.serviceAccountName"?: string;
  "filer.ingress.enabled"?: string;
  "filer.ingress.className"?: string;
  "filer.ingress.host"?: string;
  "filer.ingress.path"?: string;
  "filer.ingress.pathType"?: string;
  "filer.extraEnvironmentVars.WEED_MYSQL_ENABLED"?: string;
  "filer.extraEnvironmentVars.WEED_MYSQL_HOSTNAME"?: string;
  "filer.extraEnvironmentVars.WEED_MYSQL_PORT"?: string;
  "filer.extraEnvironmentVars.WEED_MYSQL_DATABASE"?: string;
  "filer.extraEnvironmentVars.WEED_MYSQL_CONNECTION_MAX_IDLE"?: string;
  "filer.extraEnvironmentVars.WEED_MYSQL_CONNECTION_MAX_OPEN"?: string;
  "filer.extraEnvironmentVars.WEED_MYSQL_CONNECTION_MAX_LIFETIME_SECONDS"?: string;
  "filer.extraEnvironmentVars.WEED_MYSQL_INTERPOLATEPARAMS"?: string;
  "filer.extraEnvironmentVars.WEED_LEVELDB2_ENABLED"?: string;
  "filer.extraEnvironmentVars.WEED_FILER_OPTIONS_RECURSIVE_DELETE"?: string;
  "filer.extraEnvironmentVars.WEED_FILER_BUCKETS_FOLDER"?: string;
  "filer.livenessProbe.enabled"?: string;
  "filer.livenessProbe.httpGet.path"?: string;
  "filer.livenessProbe.httpGet.scheme"?: string;
  "filer.livenessProbe.initialDelaySeconds"?: string;
  "filer.livenessProbe.periodSeconds"?: string;
  "filer.livenessProbe.successThreshold"?: string;
  "filer.livenessProbe.failureThreshold"?: string;
  "filer.livenessProbe.timeoutSeconds"?: string;
  "filer.readinessProbe.enabled"?: string;
  "filer.readinessProbe.httpGet.path"?: string;
  "filer.readinessProbe.httpGet.scheme"?: string;
  "filer.readinessProbe.initialDelaySeconds"?: string;
  "filer.readinessProbe.periodSeconds"?: string;
  "filer.readinessProbe.successThreshold"?: string;
  "filer.readinessProbe.failureThreshold"?: string;
  "filer.readinessProbe.timeoutSeconds"?: string;
  "filer.s3.enabled"?: string;
  "filer.s3.port"?: string;
  "filer.s3.httpsPort"?: string;
  "filer.s3.domainName"?: string;
  "filer.s3.enableAuth"?: string;
  "filer.s3.existingConfigSecret"?: string;
  "s3.enabled"?: string;
  "s3.imageOverride"?: string;
  "s3.restartPolicy"?: string;
  "s3.replicas"?: string;
  "s3.bindAddress"?: string;
  "s3.port"?: string;
  "s3.httpsPort"?: string;
  "s3.metricsPort"?: string;
  "s3.loggingOverrideLevel"?: string;
  "s3.enableAuth"?: string;
  "s3.existingConfigSecret"?: string;
  "s3.domainName"?: string;
  "s3.sidecars"?: string;
  "s3.initContainers"?: string;
  "s3.extraVolumes"?: string;
  "s3.extraVolumeMounts"?: string;
  "s3.tolerations"?: string;
  "s3.nodeSelector"?: string;
  "s3.priorityClassName"?: string;
  "s3.serviceAccountName"?: string;
  "s3.logs.type"?: string;
  "s3.logs.size"?: string;
  "s3.logs.storageClass"?: string;
  "s3.logs.hostPathPrefix"?: string;
  "s3.extraEnvironmentVars"?: string;
  "s3.extraArgs"?: string;
  "s3.livenessProbe.enabled"?: string;
  "s3.livenessProbe.httpGet.path"?: string;
  "s3.livenessProbe.httpGet.scheme"?: string;
  "s3.livenessProbe.initialDelaySeconds"?: string;
  "s3.livenessProbe.periodSeconds"?: string;
  "s3.livenessProbe.successThreshold"?: string;
  "s3.livenessProbe.failureThreshold"?: string;
  "s3.livenessProbe.timeoutSeconds"?: string;
  "s3.readinessProbe.enabled"?: string;
  "s3.readinessProbe.httpGet.path"?: string;
  "s3.readinessProbe.httpGet.scheme"?: string;
  "s3.readinessProbe.initialDelaySeconds"?: string;
  "s3.readinessProbe.periodSeconds"?: string;
  "s3.readinessProbe.successThreshold"?: string;
  "s3.readinessProbe.failureThreshold"?: string;
  "s3.readinessProbe.timeoutSeconds"?: string;
  "s3.ingress.enabled"?: string;
  "s3.ingress.className"?: string;
  "s3.ingress.host"?: string;
  "s3.ingress.path"?: string;
  "s3.ingress.pathType"?: string;
  "s3.ingress.tls"?: string;
  "sftp.enabled"?: string;
  "sftp.imageOverride"?: string;
  "sftp.restartPolicy"?: string;
  "sftp.replicas"?: string;
  "sftp.bindAddress"?: string;
  "sftp.port"?: string;
  "sftp.metricsPort"?: string;
  "sftp.metricsIp"?: string;
  "sftp.loggingOverrideLevel"?: string;
  "sftp.sshPrivateKey"?: string;
  "sftp.hostKeysFolder"?: string;
  "sftp.authMethods"?: string;
  "sftp.maxAuthTries"?: string;
  "sftp.bannerMessage"?: string;
  "sftp.loginGraceTime"?: string;
  "sftp.clientAliveInterval"?: string;
  "sftp.clientAliveCountMax"?: string;
  "sftp.dataCenter"?: string;
  "sftp.localSocket"?: string;
  "sftp.enableAuth"?: string;
  "sftp.existingConfigSecret"?: string;
  "sftp.existingSshConfigSecret"?: string;
  "sftp.sidecars"?: string;
  "sftp.initContainers"?: string;
  "sftp.extraVolumes"?: string;
  "sftp.extraVolumeMounts"?: string;
  "sftp.tolerations"?: string;
  "sftp.nodeSelector"?: string;
  "sftp.priorityClassName"?: string;
  "sftp.serviceAccountName"?: string;
  "sftp.logs.type"?: string;
  "sftp.logs.hostPathPrefix"?: string;
  "sftp.livenessProbe.enabled"?: string;
  "sftp.livenessProbe.initialDelaySeconds"?: string;
  "sftp.livenessProbe.periodSeconds"?: string;
  "sftp.livenessProbe.successThreshold"?: string;
  "sftp.livenessProbe.failureThreshold"?: string;
  "sftp.livenessProbe.timeoutSeconds"?: string;
  "sftp.readinessProbe.enabled"?: string;
  "sftp.readinessProbe.initialDelaySeconds"?: string;
  "sftp.readinessProbe.periodSeconds"?: string;
  "sftp.readinessProbe.successThreshold"?: string;
  "sftp.readinessProbe.failureThreshold"?: string;
  "sftp.readinessProbe.timeoutSeconds"?: string;
  "admin.enabled"?: string;
  "admin.imageOverride"?: string;
  "admin.restartPolicy"?: string;
  "admin.replicas"?: string;
  "admin.port"?: string;
  "admin.grpcPort"?: string;
  "admin.loggingOverrideLevel"?: string;
  "admin.secret.existingSecret"?: string;
  "admin.secret.userKey"?: string;
  "admin.secret.pwKey"?: string;
  "admin.secret.adminUser"?: string;
  "admin.secret.adminPassword"?: string;
  "admin.dataDir"?: string;
  "admin.masters"?: string;
  "admin.extraArgs"?: string;
  "admin.data.type"?: string;
  "admin.data.size"?: string;
  "admin.data.storageClass"?: string;
  "admin.data.hostPathPrefix"?: string;
  "admin.data.claimName"?: string;
  "admin.logs.type"?: string;
  "admin.logs.size"?: string;
  "admin.logs.storageClass"?: string;
  "admin.logs.hostPathPrefix"?: string;
  "admin.logs.claimName"?: string;
  "admin.sidecars"?: string;
  "admin.initContainers"?: string;
  "admin.extraVolumes"?: string;
  "admin.extraVolumeMounts"?: string;
  "admin.podManagementPolicy"?: string;
  "admin.affinity"?: string;
  "admin.topologySpreadConstraints"?: string;
  "admin.tolerations"?: string;
  "admin.nodeSelector"?: string;
  "admin.priorityClassName"?: string;
  "admin.serviceAccountName"?: string;
  "admin.livenessProbe.enabled"?: string;
  "admin.livenessProbe.httpGet.path"?: string;
  "admin.livenessProbe.httpGet.scheme"?: string;
  "admin.livenessProbe.initialDelaySeconds"?: string;
  "admin.livenessProbe.periodSeconds"?: string;
  "admin.livenessProbe.successThreshold"?: string;
  "admin.livenessProbe.failureThreshold"?: string;
  "admin.livenessProbe.timeoutSeconds"?: string;
  "admin.readinessProbe.enabled"?: string;
  "admin.readinessProbe.httpGet.path"?: string;
  "admin.readinessProbe.httpGet.scheme"?: string;
  "admin.readinessProbe.initialDelaySeconds"?: string;
  "admin.readinessProbe.periodSeconds"?: string;
  "admin.readinessProbe.successThreshold"?: string;
  "admin.readinessProbe.failureThreshold"?: string;
  "admin.readinessProbe.timeoutSeconds"?: string;
  "admin.ingress.enabled"?: string;
  "admin.ingress.className"?: string;
  "admin.ingress.host"?: string;
  "admin.ingress.path"?: string;
  "admin.ingress.pathType"?: string;
  "admin.ingress.tls"?: string;
  "admin.service.type"?: string;
  "worker.enabled"?: string;
  "worker.imageOverride"?: string;
  "worker.restartPolicy"?: string;
  "worker.replicas"?: string;
  "worker.loggingOverrideLevel"?: string;
  "worker.metricsPort"?: string;
  "worker.adminServer"?: string;
  "worker.capabilities"?: string;
  "worker.maxConcurrent"?: string;
  "worker.workingDir"?: string;
  "worker.extraArgs"?: string;
  "worker.data.type"?: string;
  "worker.data.hostPathPrefix"?: string;
  "worker.data.claimName"?: string;
  "worker.logs.type"?: string;
  "worker.logs.hostPathPrefix"?: string;
  "worker.logs.claimName"?: string;
  "worker.sidecars"?: string;
  "worker.initContainers"?: string;
  "worker.extraVolumes"?: string;
  "worker.extraVolumeMounts"?: string;
  "worker.affinity"?: string;
  "worker.topologySpreadConstraints"?: string;
  "worker.resources.requests.cpu"?: string;
  "worker.resources.requests.memory"?: string;
  "worker.resources.limits.cpu"?: string;
  "worker.resources.limits.memory"?: string;
  "worker.tolerations"?: string;
  "worker.nodeSelector"?: string;
  "worker.priorityClassName"?: string;
  "worker.serviceAccountName"?: string;
  "worker.livenessProbe.enabled"?: string;
  "worker.livenessProbe.httpGet.path"?: string;
  "worker.livenessProbe.httpGet.port"?: string;
  "worker.livenessProbe.initialDelaySeconds"?: string;
  "worker.livenessProbe.periodSeconds"?: string;
  "worker.livenessProbe.successThreshold"?: string;
  "worker.livenessProbe.failureThreshold"?: string;
  "worker.livenessProbe.timeoutSeconds"?: string;
  "worker.readinessProbe.enabled"?: string;
  "worker.readinessProbe.httpGet.path"?: string;
  "worker.readinessProbe.httpGet.port"?: string;
  "worker.readinessProbe.initialDelaySeconds"?: string;
  "worker.readinessProbe.periodSeconds"?: string;
  "worker.readinessProbe.successThreshold"?: string;
  "worker.readinessProbe.failureThreshold"?: string;
  "worker.readinessProbe.timeoutSeconds"?: string;
  "allInOne.enabled"?: string;
  "allInOne.imageOverride"?: string;
  "allInOne.restartPolicy"?: string;
  "allInOne.replicas"?: string;
  "allInOne.idleTimeout"?: string;
  "allInOne.dataCenter"?: string;
  "allInOne.rack"?: string;
  "allInOne.whiteList"?: string;
  "allInOne.disableHttp"?: string;
  "allInOne.metricsPort"?: string;
  "allInOne.metricsIp"?: string;
  "allInOne.loggingOverrideLevel"?: string;
  "allInOne.extraArgs"?: string;
  "allInOne.updateStrategy.type"?: string;
  "allInOne.s3.enabled"?: string;
  "allInOne.s3.port"?: string;
  "allInOne.s3.httpsPort"?: string;
  "allInOne.s3.domainName"?: string;
  "allInOne.s3.enableAuth"?: string;
  "allInOne.s3.existingConfigSecret"?: string;
  "allInOne.s3.auditLogConfig"?: string;
  "allInOne.sftp.enabled"?: string;
  "allInOne.sftp.port"?: string;
  "allInOne.sftp.sshPrivateKey"?: string;
  "allInOne.sftp.hostKeysFolder"?: string;
  "allInOne.sftp.authMethods"?: string;
  "allInOne.sftp.maxAuthTries"?: string;
  "allInOne.sftp.bannerMessage"?: string;
  "allInOne.sftp.loginGraceTime"?: string;
  "allInOne.sftp.clientAliveInterval"?: string;
  "allInOne.sftp.clientAliveCountMax"?: string;
  "allInOne.sftp.enableAuth"?: string;
  "allInOne.sftp.existingConfigSecret"?: string;
  "allInOne.sftp.existingSshConfigSecret"?: string;
  "allInOne.service.type"?: string;
  "allInOne.service.internalTrafficPolicy"?: string;
  "allInOne.data.type"?: string;
  "allInOne.data.hostPathPrefix"?: string;
  "allInOne.data.claimName"?: string;
  "allInOne.data.size"?: string;
  "allInOne.data.storageClass"?: string;
  "allInOne.data.accessModes"?: string;
  "allInOne.readinessProbe.enabled"?: string;
  "allInOne.readinessProbe.httpGet.path"?: string;
  "allInOne.readinessProbe.httpGet.port"?: string;
  "allInOne.readinessProbe.httpGet.scheme"?: string;
  "allInOne.readinessProbe.initialDelaySeconds"?: string;
  "allInOne.readinessProbe.periodSeconds"?: string;
  "allInOne.readinessProbe.successThreshold"?: string;
  "allInOne.readinessProbe.failureThreshold"?: string;
  "allInOne.readinessProbe.timeoutSeconds"?: string;
  "allInOne.livenessProbe.enabled"?: string;
  "allInOne.livenessProbe.httpGet.path"?: string;
  "allInOne.livenessProbe.httpGet.port"?: string;
  "allInOne.livenessProbe.httpGet.scheme"?: string;
  "allInOne.livenessProbe.initialDelaySeconds"?: string;
  "allInOne.livenessProbe.periodSeconds"?: string;
  "allInOne.livenessProbe.successThreshold"?: string;
  "allInOne.livenessProbe.failureThreshold"?: string;
  "allInOne.livenessProbe.timeoutSeconds"?: string;
  "allInOne.extraVolumeMounts"?: string;
  "allInOne.extraVolumes"?: string;
  "allInOne.initContainers"?: string;
  "allInOne.sidecars"?: string;
  "allInOne.affinity"?: string;
  "allInOne.topologySpreadConstraints"?: string;
  "allInOne.tolerations"?: string;
  "allInOne.nodeSelector"?: string;
  "allInOne.priorityClassName"?: string;
  "allInOne.serviceAccountName"?: string;
  "allInOne.resources.limits.cpu"?: string;
  "allInOne.resources.limits.memory"?: string;
  "allInOne.resources.requests.cpu"?: string;
  "allInOne.resources.requests.memory"?: string;
  "cosi.enabled"?: string;
  "cosi.image"?: string;
  "cosi.driverName"?: string;
  "cosi.bucketClassName"?: string;
  "cosi.endpoint"?: string;
  "cosi.region"?: string;
  "cosi.sidecar.image"?: string;
  "cosi.enableAuth"?: string;
  "cosi.existingConfigSecret"?: string;
  "cosi.extraVolumes"?: string;
  "cosi.extraVolumeMounts"?: string;
  "certificates.commonName"?: string;
  "certificates.ipAddresses"?: string;
  "certificates.keyAlgorithm"?: string;
  "certificates.keySize"?: string;
  "certificates.duration"?: string;
  "certificates.renewBefore"?: string;
  "certificates.ca.duration"?: string;
  "certificates.ca.renewBefore"?: string;
  "certificates.externalCertificates.enabled"?: string;
};
