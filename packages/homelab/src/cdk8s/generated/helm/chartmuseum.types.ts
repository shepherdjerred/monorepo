// Generated TypeScript types for chartmuseum Helm chart

export type ChartmuseumHelmValuesStrategy = {
  /**
   * @default "RollingUpdate"
   */
  type?: string;
};

export type ChartmuseumHelmValuesImage = {
  /**
   * @default "ghcr.io/helm/chartmuseum"
   */
  repository?: string;
  /**
   * @default "v0.16.3"
   */
  tag?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type ChartmuseumHelmValuesSecret = {
  /**
   * @default {}
   */
  labels?: ChartmuseumHelmValuesSecretLabels;
};

export type ChartmuseumHelmValuesSecretLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ChartmuseumHelmValuesCommonLabels = object;

export type ChartmuseumHelmValuesEnv = {
  /**
   * @default {...} (40 keys)
   */
  open?: ChartmuseumHelmValuesEnvOpen;
  /**
   * @default {}
   */
  field?: ChartmuseumHelmValuesEnvField;
  /**
   * @default {...} (4 keys)
   */
  secret?: ChartmuseumHelmValuesEnvSecret;
  existingSecret?: unknown;
  /**
   * @default {...} (4 keys)
   */
  existingSecretMappings?: ChartmuseumHelmValuesEnvExistingSecretMappings;
};

export type ChartmuseumHelmValuesEnvOpen = {
  /**
   * storage backend, can be one of: local, alibaba, amazon, google, microsoft, oracle
   *
   * @default "local"
   */
  STORAGE?: string;
  STORAGE_ALIBABA_BUCKET?: unknown;
  STORAGE_ALIBABA_PREFIX?: unknown;
  STORAGE_ALIBABA_ENDPOINT?: unknown;
  STORAGE_ALIBABA_SSE?: unknown;
  STORAGE_AMAZON_BUCKET?: unknown;
  STORAGE_AMAZON_PREFIX?: unknown;
  STORAGE_AMAZON_REGION?: unknown;
  STORAGE_AMAZON_ENDPOINT?: unknown;
  STORAGE_AMAZON_SSE?: unknown;
  STORAGE_GOOGLE_BUCKET?: unknown;
  STORAGE_GOOGLE_PREFIX?: unknown;
  STORAGE_MICROSOFT_CONTAINER?: unknown;
  STORAGE_MICROSOFT_PREFIX?: unknown;
  STORAGE_OPENSTACK_CONTAINER?: unknown;
  STORAGE_OPENSTACK_PREFIX?: unknown;
  STORAGE_OPENSTACK_REGION?: unknown;
  STORAGE_OPENSTACK_CACERT?: unknown;
  STORAGE_ORACLE_COMPARTMENTID?: unknown;
  STORAGE_ORACLE_BUCKET?: unknown;
  STORAGE_ORACLE_PREFIX?: unknown;
  /**
   * @default "chart"
   */
  CHART_POST_FORM_FIELD_NAME?: string;
  /**
   * form field which will be queried for the provenance file content
   *
   * @default "prov"
   */
  PROV_POST_FORM_FIELD_NAME?: string;
  /**
   * levels of nested repos for multitenancy. The default depth is 0 (singletenant server)
   *
   * @default 0
   */
  DEPTH?: number;
  /**
   * show debug messages
   *
   * @default false
   */
  DEBUG?: boolean;
  /**
   * output structured logs as json
   *
   * @default true
   */
  LOG_JSON?: boolean;
  /**
   * disable use of index-cache.yaml
   *
   * @default false
   */
  DISABLE_STATEFILES?: boolean;
  /**
   * enable Prometheus metrics
   *
   * @default false
   */
  ENABLE_METRICS?: boolean;
  /**
   * disable all routes prefixed with /api
   *
   * @default true
   */
  DISABLE_API?: boolean;
  /**
   * allow chart versions to be re-uploaded
   *
   * @default false
   */
  ALLOW_OVERWRITE?: boolean;
  CHART_URL?: unknown;
  /**
   * @default false
   */
  AUTH_ANONYMOUS_GET?: boolean;
  CONTEXT_PATH?: unknown;
  /**
   * @default 0
   */
  INDEX_LIMIT?: number;
  CACHE?: unknown;
  CACHE_REDIS_ADDR?: unknown;
  /**
   * @default 0
   */
  CACHE_REDIS_DB?: number;
  /**
   * enable bearer auth
   *
   * @default false
   */
  BEARER_AUTH?: boolean;
  AUTH_REALM?: unknown;
  AUTH_SERVICE?: unknown;
};

export type ChartmuseumHelmValuesEnvField = object;

export type ChartmuseumHelmValuesEnvSecret = {
  BASIC_AUTH_USER?: unknown;
  BASIC_AUTH_PASS?: unknown;
  GOOGLE_CREDENTIALS_JSON?: unknown;
  CACHE_REDIS_PASSWORD?: unknown;
};

export type ChartmuseumHelmValuesEnvExistingSecretMappings = {
  BASIC_AUTH_USER?: unknown;
  BASIC_AUTH_PASS?: unknown;
  GOOGLE_CREDENTIALS_JSON?: unknown;
  CACHE_REDIS_PASSWORD?: unknown;
};

export type ChartmuseumHelmValuesDeployment = {
  /**
   * Chartmuseum Deployment annotations
   *
   * @default {}
   */
  annotations?: ChartmuseumHelmValuesDeploymentAnnotations;
  /**
   * @default {}
   */
  labels?: ChartmuseumHelmValuesDeploymentLabels;
  extraVolumes?: unknown[];
  extraVolumeMounts?: unknown[];
  /**
   * sidecarContainers for the Chartmuseum
   * Can be used to add a proxy to the pod that does
   * scanning for secrets, signing, authentication, validation
   * of the chart's content, send notifications...
   *
   * @default {}
   */
  sidecarContainers?: ChartmuseumHelmValuesDeploymentSidecarContainers;
};

export type ChartmuseumHelmValuesDeploymentAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ChartmuseumHelmValuesDeploymentLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ChartmuseumHelmValuesDeploymentSidecarContainers = object;

export type ChartmuseumHelmValuesPodAnnotations = object;

export type ChartmuseumHelmValuesPodLabels = object;

export type ChartmuseumHelmValuesService = {
  servicename?: unknown;
  /**
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default "Local"
   */
  externalTrafficPolicy?: string;
  loadBalancerIP?: unknown;
  loadBalancerSourceRanges?: unknown[];
  /**
   * @default 8080
   */
  externalPort?: number;
  targetPort?: unknown;
  nodePort?: unknown;
  /**
   * @default {}
   */
  annotations?: ChartmuseumHelmValuesServiceAnnotations;
  /**
   * @default {}
   */
  labels?: ChartmuseumHelmValuesServiceLabels;
};

export type ChartmuseumHelmValuesServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ChartmuseumHelmValuesServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ChartmuseumHelmValuesServiceMonitor = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {}
   */
  labels?: ChartmuseumHelmValuesServiceMonitorLabels;
  /**
   * @default "/metrics"
   */
  metricsPath?: string;
};

export type ChartmuseumHelmValuesServiceMonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ChartmuseumHelmValuesResources = object;

export type ChartmuseumHelmValuesProbes = {
  /**
   * @default {...} (5 keys)
   */
  liveness?: ChartmuseumHelmValuesProbesLiveness;
  /**
   * @default {"scheme":"HTTP"}
   */
  livenessHttpGetConfig?: ChartmuseumHelmValuesProbesLivenessHttpGetConfig;
  /**
   * @default {...} (5 keys)
   */
  readiness?: ChartmuseumHelmValuesProbesReadiness;
  /**
   * @default {"scheme":"HTTP"}
   */
  readinessHttpGetConfig?: ChartmuseumHelmValuesProbesReadinessHttpGetConfig;
};

export type ChartmuseumHelmValuesProbesLiveness = {
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
  timeoutSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 3
   */
  failureThreshold?: number;
};

export type ChartmuseumHelmValuesProbesLivenessHttpGetConfig = {
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type ChartmuseumHelmValuesProbesReadiness = {
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
  timeoutSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 3
   */
  failureThreshold?: number;
};

export type ChartmuseumHelmValuesProbesReadinessHttpGetConfig = {
  /**
   * @default "HTTP"
   */
  scheme?: string;
};

export type ChartmuseumHelmValuesServiceAccount = {
  /**
   * @default false
   */
  create?: boolean;
  /**
   * @default ""
   */
  name?: string;
  /**
   * @default false
   */
  automountServiceAccountToken?: boolean;
  /**
   * Annotations for the Service Account
   *
   * @default {}
   */
  annotations?: ChartmuseumHelmValuesServiceAccountAnnotations;
};

export type ChartmuseumHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ChartmuseumHelmValuesSecurityContext = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 1000
   */
  fsGroup?: number;
};

export type ChartmuseumHelmValuesContainerSecurityContext = object;

export type ChartmuseumHelmValuesNodeSelector = object;

export type ChartmuseumHelmValuesAffinity = object;

export type ChartmuseumHelmValuesPersistence = {
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
   * @default "ReadWriteOnce"
   */
  accessMode?: string;
  /**
   * @default "8Gi"
   */
  size?: string;
  /**
   * @default {}
   */
  labels?: ChartmuseumHelmValuesPersistenceLabels;
  /**
   * @default "/storage"
   */
  path?: string;
  /**
   * @default {...} (5 keys)
   */
  pv?: ChartmuseumHelmValuesPersistencePv;
};

export type ChartmuseumHelmValuesPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ChartmuseumHelmValuesPersistencePv = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default false
   */
  enabled?: boolean;
  pvname?: unknown;
  /**
   * @default {"storage":"8Gi"}
   */
  capacity?: ChartmuseumHelmValuesPersistencePvCapacity;
  /**
   * @default "ReadWriteOnce"
   */
  accessMode?: string;
  /**
   * @default {"server":null,"path":null}
   */
  nfs?: ChartmuseumHelmValuesPersistencePvNfs;
};

export type ChartmuseumHelmValuesPersistencePvCapacity = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "8Gi"
   */
  storage?: string;
};

export type ChartmuseumHelmValuesPersistencePvNfs = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  server?: unknown;
  path?: unknown;
};

export type ChartmuseumHelmValuesVolumePermissions = {
  /**
   * Optionally specify an array of imagePullSecrets.
   * Secrets must be manually created in the namespace.
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/
   * Ingress for load balancer
   *
   * @default {...} (4 keys)
   */
  image?: ChartmuseumHelmValuesVolumePermissionsImage;
};

export type ChartmuseumHelmValuesVolumePermissionsImage = {
  /**
   * @default "docker.io"
   */
  registry?: string;
  /**
   * @default "bitnami/minideb"
   */
  repository?: string;
  /**
   * @default "buster"
   */
  tag?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
};

export type ChartmuseumHelmValuesIngress = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "ImplementationSpecific"
   */
  pathType?: string;
  /**
   * Chartmuseum Ingress labels
   *
   * @default {}
   */
  labels?: ChartmuseumHelmValuesIngressLabels;
  /**
   * Chartmuseum Ingress annotations
   * kubernetes.io/ingress.class: nginx
   * kubernetes.io/tls-acme: "true"
   *
   * @default {}
   */
  annotations?: ChartmuseumHelmValuesIngressAnnotations;
  hosts?: unknown[];
  ingressClassName?: unknown;
};

export type ChartmuseumHelmValuesIngressLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ChartmuseumHelmValuesIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type ChartmuseumHelmValuesGcp = {
  /**
   * @default {"enabled":false,"name":null,"key":"credentials.json"}
   */
  secret?: ChartmuseumHelmValuesGcpSecret;
};

export type ChartmuseumHelmValuesGcpSecret = {
  /**
   * @default false
   */
  enabled?: boolean;
  name?: unknown;
  /**
   * @default "credentials.json"
   */
  key?: string;
};

export type ChartmuseumHelmValuesOracle = {
  /**
   * @default {...} (4 keys)
   */
  secret?: ChartmuseumHelmValuesOracleSecret;
};

export type ChartmuseumHelmValuesOracleSecret = {
  /**
   * @default false
   */
  enabled?: boolean;
  name?: unknown;
  /**
   * @default "config"
   */
  config?: string;
  /**
   * Secret key that holds the oci private key
   *
   * @default "key_file"
   */
  key_file?: string;
};

export type ChartmuseumHelmValuesBearerAuth = {
  /**
   * @default {"enabled":false,"publicKeySecret":"chartmuseum-public-key"}
   */
  secret?: ChartmuseumHelmValuesBearerAuthSecret;
};

export type ChartmuseumHelmValuesBearerAuthSecret = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "chartmuseum-public-key"
   */
  publicKeySecret?: string;
};

export type ChartmuseumHelmValues = {
  extraArgs?: unknown[];
  /**
   * - --storage-timestamp-tolerance 1s
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * @default {"type":"RollingUpdate"}
   */
  strategy?: ChartmuseumHelmValuesStrategy;
  /**
   * @default {"repository":"ghcr.io/helm/chartmuseum","tag":"v0.16.3","pullPolicy":"IfNotPresent"}
   */
  image?: ChartmuseumHelmValuesImage;
  /**
   * @default {"labels":{}}
   */
  secret?: ChartmuseumHelmValuesSecret;
  /**
   * Labels to apply to all resources
   *
   * @default {}
   */
  commonLabels?: ChartmuseumHelmValuesCommonLabels;
  /**
   * @default {...} (5 keys)
   */
  env?: ChartmuseumHelmValuesEnv;
  /**
   * @default {...} (5 keys)
   */
  deployment?: ChartmuseumHelmValuesDeployment;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
   * Read more about kube2iam to provide access to s3 https://github.com/jtblin/kube2iam
   * iam.amazonaws.com/role: role-arn
   *
   * @default {}
   */
  podAnnotations?: ChartmuseumHelmValuesPodAnnotations;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * @default {}
   */
  podLabels?: ChartmuseumHelmValuesPodLabels;
  /**
   * @default {...} (10 keys)
   */
  service?: ChartmuseumHelmValuesService;
  /**
   * @default {"enabled":false,"labels":{},"metricsPath":"/metrics"}
   */
  serviceMonitor?: ChartmuseumHelmValuesServiceMonitor;
  /**
   * @default {}
   */
  resources?: ChartmuseumHelmValuesResources;
  /**
   * @default {...} (4 keys)
   */
  probes?: ChartmuseumHelmValuesProbes;
  /**
   * @default {...} (4 keys)
   */
  serviceAccount?: ChartmuseumHelmValuesServiceAccount;
  /**
   * UID/GID 1000 is the default user "chartmuseum" used in
   * the container image starting in v0.8.0 and above. This
   * is required for local persistent storage. If your cluster
   * does not allow this, try setting securityContext: {}
   *
   * @default {"enabled":true,"fsGroup":1000}
   */
  securityContext?: ChartmuseumHelmValuesSecurityContext;
  /**
   * @default {}
   */
  containerSecurityContext?: ChartmuseumHelmValuesContainerSecurityContext;
  /**
   * @default ""
   */
  priorityClassName?: string;
  /**
   * @default {}
   */
  nodeSelector?: ChartmuseumHelmValuesNodeSelector;
  tolerations?: unknown[];
  /**
   * @default {}
   */
  affinity?: ChartmuseumHelmValuesAffinity;
  /**
   * @default {...} (6 keys)
   */
  persistence?: ChartmuseumHelmValuesPersistence;
  /**
   * @default {"image":{"registry":"docker.io","repository":"bitnami/minideb","tag":"buster","pullPolicy":"Always"}}
   */
  volumePermissions?: ChartmuseumHelmValuesVolumePermissions;
  /**
   * @default {...} (6 keys)
   */
  ingress?: ChartmuseumHelmValuesIngress;
  /**
   * @default {"secret":{"enabled":false,"name":null,"key":"credentials.json"}}
   */
  gcp?: ChartmuseumHelmValuesGcp;
  /**
   * @default {"secret":{"enabled":false,"name":null,"config":"config","key_file":"key_file"}}
   */
  oracle?: ChartmuseumHelmValuesOracle;
  /**
   * @default {"secret":{"enabled":false,"publicKeySecret":"chartmuseum-public-key"}}
   */
  bearerAuth?: ChartmuseumHelmValuesBearerAuth;
};

export type ChartmuseumHelmParameters = {
  extraArgs?: string;
  replicaCount?: string;
  "strategy.type"?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "image.pullPolicy"?: string;
  "env.open.STORAGE"?: string;
  "env.open.STORAGE_ALIBABA_BUCKET"?: string;
  "env.open.STORAGE_ALIBABA_PREFIX"?: string;
  "env.open.STORAGE_ALIBABA_ENDPOINT"?: string;
  "env.open.STORAGE_ALIBABA_SSE"?: string;
  "env.open.STORAGE_AMAZON_BUCKET"?: string;
  "env.open.STORAGE_AMAZON_PREFIX"?: string;
  "env.open.STORAGE_AMAZON_REGION"?: string;
  "env.open.STORAGE_AMAZON_ENDPOINT"?: string;
  "env.open.STORAGE_AMAZON_SSE"?: string;
  "env.open.STORAGE_GOOGLE_BUCKET"?: string;
  "env.open.STORAGE_GOOGLE_PREFIX"?: string;
  "env.open.STORAGE_MICROSOFT_CONTAINER"?: string;
  "env.open.STORAGE_MICROSOFT_PREFIX"?: string;
  "env.open.STORAGE_OPENSTACK_CONTAINER"?: string;
  "env.open.STORAGE_OPENSTACK_PREFIX"?: string;
  "env.open.STORAGE_OPENSTACK_REGION"?: string;
  "env.open.STORAGE_OPENSTACK_CACERT"?: string;
  "env.open.STORAGE_ORACLE_COMPARTMENTID"?: string;
  "env.open.STORAGE_ORACLE_BUCKET"?: string;
  "env.open.STORAGE_ORACLE_PREFIX"?: string;
  "env.open.CHART_POST_FORM_FIELD_NAME"?: string;
  "env.open.PROV_POST_FORM_FIELD_NAME"?: string;
  "env.open.DEPTH"?: string;
  "env.open.DEBUG"?: string;
  "env.open.LOG_JSON"?: string;
  "env.open.DISABLE_STATEFILES"?: string;
  "env.open.ENABLE_METRICS"?: string;
  "env.open.DISABLE_API"?: string;
  "env.open.ALLOW_OVERWRITE"?: string;
  "env.open.CHART_URL"?: string;
  "env.open.AUTH_ANONYMOUS_GET"?: string;
  "env.open.CONTEXT_PATH"?: string;
  "env.open.INDEX_LIMIT"?: string;
  "env.open.CACHE"?: string;
  "env.open.CACHE_REDIS_ADDR"?: string;
  "env.open.CACHE_REDIS_DB"?: string;
  "env.open.BEARER_AUTH"?: string;
  "env.open.AUTH_REALM"?: string;
  "env.open.AUTH_SERVICE"?: string;
  "env.secret.BASIC_AUTH_USER"?: string;
  "env.secret.BASIC_AUTH_PASS"?: string;
  "env.secret.GOOGLE_CREDENTIALS_JSON"?: string;
  "env.secret.CACHE_REDIS_PASSWORD"?: string;
  "env.existingSecret"?: string;
  "env.existingSecretMappings.BASIC_AUTH_USER"?: string;
  "env.existingSecretMappings.BASIC_AUTH_PASS"?: string;
  "env.existingSecretMappings.GOOGLE_CREDENTIALS_JSON"?: string;
  "env.existingSecretMappings.CACHE_REDIS_PASSWORD"?: string;
  "deployment.extraVolumes"?: string;
  "deployment.extraVolumeMounts"?: string;
  "service.servicename"?: string;
  "service.type"?: string;
  "service.externalTrafficPolicy"?: string;
  "service.loadBalancerIP"?: string;
  "service.loadBalancerSourceRanges"?: string;
  "service.externalPort"?: string;
  "service.targetPort"?: string;
  "service.nodePort"?: string;
  "serviceMonitor.enabled"?: string;
  "serviceMonitor.metricsPath"?: string;
  "probes.liveness.initialDelaySeconds"?: string;
  "probes.liveness.periodSeconds"?: string;
  "probes.liveness.timeoutSeconds"?: string;
  "probes.liveness.successThreshold"?: string;
  "probes.liveness.failureThreshold"?: string;
  "probes.livenessHttpGetConfig.scheme"?: string;
  "probes.readiness.initialDelaySeconds"?: string;
  "probes.readiness.periodSeconds"?: string;
  "probes.readiness.timeoutSeconds"?: string;
  "probes.readiness.successThreshold"?: string;
  "probes.readiness.failureThreshold"?: string;
  "probes.readinessHttpGetConfig.scheme"?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "serviceAccount.automountServiceAccountToken"?: string;
  "securityContext.enabled"?: string;
  "securityContext.fsGroup"?: string;
  priorityClassName?: string;
  tolerations?: string;
  "persistence.enabled"?: string;
  "persistence.accessMode"?: string;
  "persistence.size"?: string;
  "persistence.path"?: string;
  "persistence.pv.enabled"?: string;
  "persistence.pv.pvname"?: string;
  "persistence.pv.capacity.storage"?: string;
  "persistence.pv.accessMode"?: string;
  "persistence.pv.nfs.server"?: string;
  "persistence.pv.nfs.path"?: string;
  "volumePermissions.image.registry"?: string;
  "volumePermissions.image.repository"?: string;
  "volumePermissions.image.tag"?: string;
  "volumePermissions.image.pullPolicy"?: string;
  "ingress.enabled"?: string;
  "ingress.pathType"?: string;
  "ingress.hosts"?: string;
  "ingress.ingressClassName"?: string;
  "gcp.secret.enabled"?: string;
  "gcp.secret.name"?: string;
  "gcp.secret.key"?: string;
  "oracle.secret.enabled"?: string;
  "oracle.secret.name"?: string;
  "oracle.secret.config"?: string;
  "oracle.secret.key_file"?: string;
  "bearerAuth.secret.enabled"?: string;
  "bearerAuth.secret.publicKeySecret"?: string;
};
