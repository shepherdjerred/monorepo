// Generated TypeScript types for plane-enterprise Helm chart

export type PlaneenterpriseHelmValuesDockerRegistry = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "index.docker.io/v1/"
   */
  registry?: string;
  /**
   * @default ""
   */
  loginid?: string;
  /**
   * @default ""
   */
  password?: string;
  /**
   * Name of an existing Kubernetes secret containing docker registry credentials
   *
   * @default ""
   */
  existingSecret?: string;
};

export type PlaneenterpriseHelmValuesLicense = {
  /**
   * @default "https://prime.plane.so"
   */
  licenseServer?: string;
  /**
   * @default "plane.example.com"
   */
  licenseDomain?: string;
};

export type PlaneenterpriseHelmValuesAirgapped = {
  /**
   * @default false
   */
  enabled?: boolean;
  s3Secrets?: unknown[];
  /**
   * Deprecated (backward compatibility): use a single secret for custom S3 CA.
   * If set, used when s3Secrets is empty. Prefer migrating to s3Secrets.
   * Example:
   * s3SecretKey: s3-custom-ca.crt
   *
   * @default ""
   */
  s3SecretName?: string;
  /**
   * @default ""
   */
  s3SecretKey?: string;
};

export type PlaneenterpriseHelmValuesIngress = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  minioHost?: string;
  /**
   * @default ""
   */
  rabbitmqHost?: string;
  /**
   * @default "traefik"
   */
  ingressClass?: string;
  /**
   * If using nginx ingress controller, set this to 'nginx' and add the appropriate annotations to set the proxy body size limit.
   * These annotations are ONLY rendered when ingressClass is 'nginx' (the nginx Ingress template is gated on
   * ingressClass == "nginx"); they have no effect with traefik. Example:
   *
   * @default {"maxRequestBodyBytes":20971520}
   */
  traefik?: PlaneenterpriseHelmValuesIngressTraefik;
};

export type PlaneenterpriseHelmValuesIngressTraefik = {
  /**
   * in bytes (default: 20 MiB)
   *
   * @default 20971520
   */
  maxRequestBodyBytes?: number;
};

export type PlaneenterpriseHelmValuesSsl = {
  /**
   * If you have a custom TLS secret name
   *
   * @default ""
   */
  tls_secret_name?: string;
  /**
   * If you want to use Let's Encrypt, set createIssuer and generateCerts to true
   *
   * @default false
   */
  createIssuer?: boolean;
  /**
   * Allowed : cloudflare, digitalocean, http
   *
   * @default "http"
   */
  issuer?: string;
  /**
   * not required for http
   *
   * @default ""
   */
  token?: string;
  /**
   * @default "https://acme-v02.api.letsencrypt.org/directory"
   */
  server?: string;
  /**
   * @default "plane@example.com"
   */
  email?: string;
  /**
   * @default false
   */
  generateCerts?: boolean;
};

export type PlaneenterpriseHelmValuesSecurityContext = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * Rendered at spec.template.spec.securityContext (pod level).
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: PlaneenterpriseHelmValuesSecurityContextPodSecurityContext;
  /**
   * Rendered at each container's / initContainer's securityContext.
   *
   * @default {...} (5 keys)
   */
  containerSecurityContext?: PlaneenterpriseHelmValuesSecurityContextContainerSecurityContext;
};

export type PlaneenterpriseHelmValuesSecurityContextPodSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 1000
   */
  runAsUser?: number;
  /**
   * @default 1000
   */
  runAsGroup?: number;
  /**
   * @default 1000
   */
  fsGroup?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: PlaneenterpriseHelmValuesSecurityContextPodSecurityContextSeccompProfile;
};

export type PlaneenterpriseHelmValuesSecurityContextPodSecurityContextSeccompProfile =
  {
    /**
     * @default "RuntimeDefault"
     */
    type?: string;
  };

export type PlaneenterpriseHelmValuesSecurityContextContainerSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 1000
   */
  runAsUser?: number;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: PlaneenterpriseHelmValuesSecurityContextContainerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: PlaneenterpriseHelmValuesSecurityContextContainerSecurityContextSeccompProfile;
};

export type PlaneenterpriseHelmValuesSecurityContextContainerSecurityContextCapabilities =
  {
    drop?: string[];
  };

export type PlaneenterpriseHelmValuesSecurityContextContainerSecurityContextSeccompProfile =
  {
    /**
     * @default "RuntimeDefault"
     */
    type?: string;
  };

export type PlaneenterpriseHelmValuesServices = {
  /**
   * @default {...} (11 keys)
   */
  redis?: PlaneenterpriseHelmValuesServicesRedis;
  /**
   * @default {...} (12 keys)
   */
  postgres?: PlaneenterpriseHelmValuesServicesPostgres;
  /**
   * @default {...} (15 keys)
   */
  rabbitmq?: PlaneenterpriseHelmValuesServicesRabbitmq;
  /**
   * @default {...} (17 keys)
   */
  opensearch?: PlaneenterpriseHelmValuesServicesOpensearch;
  /**
   * @default {...} (14 keys)
   */
  minio?: PlaneenterpriseHelmValuesServicesMinio;
  /**
   * @default {...} (14 keys)
   */
  iframely?: PlaneenterpriseHelmValuesServicesIframely;
  /**
   * @default {...} (13 keys)
   */
  web?: PlaneenterpriseHelmValuesServicesWeb;
  /**
   * @default {...} (13 keys)
   */
  monitor?: PlaneenterpriseHelmValuesServicesMonitor;
  /**
   * @default {...} (13 keys)
   */
  space?: PlaneenterpriseHelmValuesServicesSpace;
  /**
   * @default {...} (13 keys)
   */
  admin?: PlaneenterpriseHelmValuesServicesAdmin;
  /**
   * @default {...} (13 keys)
   */
  live?: PlaneenterpriseHelmValuesServicesLive;
  /**
   * @default {...} (13 keys)
   */
  api?: PlaneenterpriseHelmValuesServicesApi;
  /**
   * @default {...} (12 keys)
   */
  external_api?: PlaneenterpriseHelmValuesServicesExternalapi;
  /**
   * @default {...} (10 keys)
   */
  worker?: PlaneenterpriseHelmValuesServicesWorker;
  /**
   * @default {...} (11 keys)
   */
  worker_importers?: PlaneenterpriseHelmValuesServicesWorkerimporters;
  /**
   * @default {...} (10 keys)
   */
  beatworker?: PlaneenterpriseHelmValuesServicesBeatworker;
  /**
   * @default {...} (15 keys)
   */
  silo?: PlaneenterpriseHelmValuesServicesSilo;
  /**
   * @default {...} (13 keys)
   */
  email_service?: PlaneenterpriseHelmValuesServicesEmailservice;
  /**
   * @default {...} (13 keys)
   */
  outbox_poller?: PlaneenterpriseHelmValuesServicesOutboxpoller;
  /**
   * @default {...} (12 keys)
   */
  automation_consumer?: PlaneenterpriseHelmValuesServicesAutomationconsumer;
  /**
   * @default {...} (12 keys)
   */
  webhook_consumer?: PlaneenterpriseHelmValuesServicesWebhookconsumer;
  /**
   * @default {...} (12 keys)
   */
  agent_consumer?: PlaneenterpriseHelmValuesServicesAgentconsumer;
  /**
   * @default {...} (15 keys)
   */
  pi?: PlaneenterpriseHelmValuesServicesPi;
  /**
   * @default {...} (10 keys)
   */
  pi_beat_worker?: PlaneenterpriseHelmValuesServicesPibeatworker;
  /**
   * @default {...} (10 keys)
   */
  pi_worker?: PlaneenterpriseHelmValuesServicesPiworker;
  /**
   * @default {...} (14 keys)
   */
  runner?: PlaneenterpriseHelmValuesServicesRunner;
};

export type PlaneenterpriseHelmValuesServicesRedis = {
  /**
   * @default true
   */
  local_setup?: boolean;
  /**
   * @default "valkey/valkey:7.2.11-alpine"
   */
  image?: string;
  /**
   * @default 6379
   */
  servicePort?: number;
  /**
   * @default "500Mi"
   */
  volumeSize?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesRedisLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesRedisAnnotations;
};

export type PlaneenterpriseHelmValuesServicesRedisLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesRedisAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesPostgres = {
  /**
   * @default true
   */
  local_setup?: boolean;
  /**
   * @default "postgres:15.7-alpine"
   */
  image?: string;
  /**
   * @default 5432
   */
  servicePort?: number;
  /**
   * @default "2Gi"
   */
  volumeSize?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesPostgresLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesPostgresAnnotations;
  /**
   * @default {"enabled":false,"remote_url":""}
   */
  read_replica?: PlaneenterpriseHelmValuesServicesPostgresReadreplica;
};

export type PlaneenterpriseHelmValuesServicesPostgresLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesPostgresAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesPostgresReadreplica = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * INCASE OF REMOTE PG DB URL ONLY
   *
   * @default ""
   */
  remote_url?: string;
};

export type PlaneenterpriseHelmValuesServicesRabbitmq = {
  /**
   * @default true
   */
  local_setup?: boolean;
  /**
   * @default "rabbitmq:3.13.6-management-alpine"
   */
  image?: string;
  /**
   * @default 5672
   */
  servicePort?: number;
  /**
   * @default 15672
   */
  managementPort?: number;
  /**
   * @default "100Mi"
   */
  volumeSize?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * @default "plane"
   */
  default_user?: string;
  /**
   * @default "plane"
   */
  default_password?: string;
  /**
   * @default ""
   */
  external_rabbitmq_url?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesRabbitmqLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesRabbitmqAnnotations;
};

export type PlaneenterpriseHelmValuesServicesRabbitmqLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesRabbitmqAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesOpensearch = {
  /**
   * @default false
   */
  local_setup?: boolean;
  /**
   * @default "opensearchproject/opensearch:3.3.2"
   */
  image?: string;
  /**
   * @default 9200
   */
  servicePort?: number;
  /**
   * @default "5Gi"
   */
  volumeSize?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * @default "plane"
   */
  username?: string;
  /**
   * @default "Secure@Pass#123!%^&*"
   */
  password?: string;
  /**
   * @default "3Gi"
   */
  memoryLimit?: string;
  /**
   * @default "750m"
   */
  cpuLimit?: string;
  /**
   * @default "2Gi"
   */
  memoryRequest?: string;
  /**
   * @default "500m"
   */
  cpuRequest?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesOpensearchLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesOpensearchAnnotations;
};

export type PlaneenterpriseHelmValuesServicesOpensearchLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesOpensearchAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesMinio = {
  /**
   * @default true
   */
  local_setup?: boolean;
  /**
   * @default "minio/minio:latest"
   */
  image?: string;
  /**
   * @default "minio/mc:latest"
   */
  image_mc?: string;
  /**
   * @default "3Gi"
   */
  volumeSize?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * @default "admin"
   */
  root_user?: string;
  /**
   * @default "password"
   */
  root_password?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * @default {"minio_endpoint_ssl":false}
   */
  env?: PlaneenterpriseHelmValuesServicesMinioEnv;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesMinioLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesMinioAnnotations;
};

export type PlaneenterpriseHelmValuesServicesMinioEnv = {
  /**
   * @default false
   */
  minio_endpoint_ssl?: boolean;
};

export type PlaneenterpriseHelmValuesServicesMinioLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesMinioAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesIframely = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/iframely:v1.2.0"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesIframelyLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesIframelyAnnotations;
};

export type PlaneenterpriseHelmValuesServicesIframelyLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesIframelyAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesWeb = {
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/web-commercial"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesWebLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesWebAnnotations;
};

export type PlaneenterpriseHelmValuesServicesWebLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesWebAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesMonitor = {
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/monitor-commercial"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default "100Mi"
   */
  volumeSize?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesMonitorLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesMonitorAnnotations;
};

export type PlaneenterpriseHelmValuesServicesMonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesMonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesSpace = {
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/space-commercial"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesSpaceLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesSpaceAnnotations;
};

export type PlaneenterpriseHelmValuesServicesSpaceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesSpaceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesAdmin = {
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/admin-commercial"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesAdminLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesAdminAnnotations;
};

export type PlaneenterpriseHelmValuesServicesAdminLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesAdminAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesLive = {
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/live-commercial"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesLiveLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesLiveAnnotations;
};

export type PlaneenterpriseHelmValuesServicesLiveLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesLiveAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesApi = {
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/backend-commercial"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesApiLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesApiAnnotations;
};

export type PlaneenterpriseHelmValuesServicesApiLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesApiAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesExternalapi = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesExternalapiLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesExternalapiAnnotations;
};

export type PlaneenterpriseHelmValuesServicesExternalapiLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesExternalapiAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesWorker = {
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesWorkerLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesWorkerAnnotations;
};

export type PlaneenterpriseHelmValuesServicesWorkerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesWorkerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesWorkerimporters = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesWorkerimportersLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesWorkerimportersAnnotations;
};

export type PlaneenterpriseHelmValuesServicesWorkerimportersLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesWorkerimportersAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesBeatworker = {
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesBeatworkerLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesBeatworkerAnnotations;
};

export type PlaneenterpriseHelmValuesServicesBeatworkerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesBeatworkerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesSilo = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/silo-commercial"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesSiloLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesSiloAnnotations;
  /**
   * @default {...} (4 keys)
   */
  connectors?: PlaneenterpriseHelmValuesServicesSiloConnectors;
};

export type PlaneenterpriseHelmValuesServicesSiloLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesSiloAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesSiloConnectors = {
  /**
   * @default {...} (4 keys)
   */
  slack?: PlaneenterpriseHelmValuesServicesSiloConnectorsSlack;
  /**
   * @default {...} (6 keys)
   */
  github?: PlaneenterpriseHelmValuesServicesSiloConnectorsGithub;
  /**
   * @default {"enabled":false,"client_id":"","client_secret":""}
   */
  gitlab?: PlaneenterpriseHelmValuesServicesSiloConnectorsGitlab;
  /**
   * @default {...} (5 keys)
   */
  sentry?: PlaneenterpriseHelmValuesServicesSiloConnectorsSentry;
};

export type PlaneenterpriseHelmValuesServicesSiloConnectorsSlack = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  client_id?: string;
  /**
   * @default ""
   */
  client_secret?: string;
  /**
   * @default ""
   */
  base_url?: string;
};

export type PlaneenterpriseHelmValuesServicesSiloConnectorsGithub = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  client_id?: string;
  /**
   * @default ""
   */
  client_secret?: string;
  /**
   * @default ""
   */
  app_name?: string;
  /**
   * @default ""
   */
  app_id?: string;
  /**
   * @default ""
   */
  private_key?: string;
};

export type PlaneenterpriseHelmValuesServicesSiloConnectorsGitlab = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  client_id?: string;
  /**
   * @default ""
   */
  client_secret?: string;
};

export type PlaneenterpriseHelmValuesServicesSiloConnectorsSentry = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  base_url?: string;
  /**
   * @default ""
   */
  client_id?: string;
  /**
   * @default ""
   */
  client_secret?: string;
  /**
   * @default ""
   */
  integration_slug?: string;
};

export type PlaneenterpriseHelmValuesServicesEmailservice = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/email-commercial"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesEmailserviceLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesEmailserviceAnnotations;
};

export type PlaneenterpriseHelmValuesServicesEmailserviceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesEmailserviceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesOutboxpoller = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesOutboxpollerLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesOutboxpollerAnnotations;
};

export type PlaneenterpriseHelmValuesServicesOutboxpollerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesOutboxpollerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesAutomationconsumer = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesAutomationconsumerLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesAutomationconsumerAnnotations;
};

export type PlaneenterpriseHelmValuesServicesAutomationconsumerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesAutomationconsumerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesWebhookconsumer = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "500Mi"
   */
  memoryRequest?: string;
  /**
   * @default "250m"
   */
  cpuRequest?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesWebhookconsumerLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesWebhookconsumerAnnotations;
};

export type PlaneenterpriseHelmValuesServicesWebhookconsumerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesWebhookconsumerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesAgentconsumer = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "500Mi"
   */
  memoryRequest?: string;
  /**
   * @default "250m"
   */
  cpuRequest?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesAgentconsumerLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesAgentconsumerAnnotations;
};

export type PlaneenterpriseHelmValuesServicesAgentconsumerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesAgentconsumerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesPi = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/plane-pi-commercial"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesPiLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesPiAnnotations;
  /**
   * @default {...} (6 keys)
   */
  ai_providers?: PlaneenterpriseHelmValuesServicesPiAiproviders;
};

export type PlaneenterpriseHelmValuesServicesPiLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesPiAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesPiAiproviders = {
  /**
   * @default {"enabled":false,"base_url":"","api_key":""}
   */
  openai?: PlaneenterpriseHelmValuesServicesPiAiprovidersOpenai;
  /**
   * @default {"enabled":false,"base_url":"","api_key":""}
   */
  claude?: PlaneenterpriseHelmValuesServicesPiAiprovidersClaude;
  /**
   * @default {"enabled":false,"base_url":"","api_key":""}
   */
  groq?: PlaneenterpriseHelmValuesServicesPiAiprovidersGroq;
  /**
   * @default {"enabled":false,"base_url":"","api_key":""}
   */
  cohere?: PlaneenterpriseHelmValuesServicesPiAiprovidersCohere;
  /**
   * @default {...} (8 keys)
   */
  custom_llm?: PlaneenterpriseHelmValuesServicesPiAiprovidersCustomllm;
  /**
   * @default {...} (8 keys)
   */
  embedding_model?: PlaneenterpriseHelmValuesServicesPiAiprovidersEmbeddingmodel;
};

export type PlaneenterpriseHelmValuesServicesPiAiprovidersOpenai = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  base_url?: string;
  /**
   * @default ""
   */
  api_key?: string;
};

export type PlaneenterpriseHelmValuesServicesPiAiprovidersClaude = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  base_url?: string;
  /**
   * @default ""
   */
  api_key?: string;
};

export type PlaneenterpriseHelmValuesServicesPiAiprovidersGroq = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  base_url?: string;
  /**
   * @default ""
   */
  api_key?: string;
};

export type PlaneenterpriseHelmValuesServicesPiAiprovidersCohere = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  base_url?: string;
  /**
   * @default ""
   */
  api_key?: string;
};

export type PlaneenterpriseHelmValuesServicesPiAiprovidersCustomllm = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  api_key?: string;
  /**
   * @default ""
   */
  base_url?: string;
  /**
   * @default "gpt-oss-120b"
   */
  model_key?: string;
  /**
   * @default "GPT-OSS-120B"
   */
  name?: string;
  /**
   * @default 128000
   */
  max_tokens?: number;
  /**
   * @default ""
   */
  provider?: string;
  /**
   * @default ""
   */
  aws_region?: string;
};

export type PlaneenterpriseHelmValuesServicesPiAiprovidersEmbeddingmodel = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default ""
   */
  name?: string;
  /**
   * @default ""
   */
  model_id?: string;
  /**
   * @default 1536
   */
  embedding_dimension?: number;
  /**
   * @default ""
   */
  aws_access_key?: string;
  /**
   * @default ""
   */
  aws_secret_access_key?: string;
  /**
   * @default "us-east-1"
   */
  aws_region?: string;
  /**
   * @default ""
   */
  aws_session_token?: string;
};

export type PlaneenterpriseHelmValuesServicesPibeatworker = {
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesPibeatworkerLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesPibeatworkerAnnotations;
};

export type PlaneenterpriseHelmValuesServicesPibeatworkerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesPibeatworkerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesPiworker = {
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "1000Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "50Mi"
   */
  memoryRequest?: string;
  /**
   * @default "50m"
   */
  cpuRequest?: string;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesPiworkerLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesPiworkerAnnotations;
};

export type PlaneenterpriseHelmValuesServicesPiworkerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesPiworkerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesRunner = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  replicas?: number;
  /**
   * @default "512Mi"
   */
  memoryLimit?: string;
  /**
   * @default "500m"
   */
  cpuLimit?: string;
  /**
   * @default "128Mi"
   */
  memoryRequest?: string;
  /**
   * @default "100m"
   */
  cpuRequest?: string;
  /**
   * @default "makeplane/node-runner-commercial"
   */
  image?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
  /**
   * @default false
   */
  assign_cluster_ip?: boolean;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * Kubernetes affinity (standard Affinity object)
   */
  affinity?: Record<string, unknown>;
  /**
   * @default {}
   */
  labels?: PlaneenterpriseHelmValuesServicesRunnerLabels;
  /**
   * @default {}
   */
  annotations?: PlaneenterpriseHelmValuesServicesRunnerAnnotations;
};

export type PlaneenterpriseHelmValuesServicesRunnerLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesServicesRunnerAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type PlaneenterpriseHelmValuesExternalsecrets = {
  /**
   * Name of the existing Kubernetes Secret resource; see README for more details
   *
   * @default ""
   */
  rabbitmq_existingSecret?: string;
  /**
   * @default ""
   */
  pgdb_existingSecret?: string;
  /**
   * @default ""
   */
  opensearch_existingSecret?: string;
  /**
   * @default ""
   */
  doc_store_existingSecret?: string;
  /**
   * @default ""
   */
  app_env_existingSecret?: string;
  /**
   * @default ""
   */
  live_env_existingSecret?: string;
  /**
   * @default ""
   */
  silo_env_existingSecret?: string;
  /**
   * @default ""
   */
  pi_api_env_existingSecret?: string;
  /**
   * @default ""
   */
  runner_env_existingSecret?: string;
};

export type PlaneenterpriseHelmValuesEnv = {
  /**
   * @default ""
   */
  storageClass?: string;
  /**
   * Kubernetes internal cluster domain used to build in-cluster service URLs
   *
   * @default "cluster.local"
   */
  default_cluster_domain?: string;
  /**
   * REDIS
   * INCASE OF REMOTE REDIS ONLY
   *
   * @default ""
   */
  remote_redis_url?: string;
  /**
   * POSTGRES DB VALUES
   *
   * @default "plane"
   */
  pgdb_username?: string;
  /**
   * @default "plane"
   */
  pgdb_password?: string;
  /**
   * @default "plane"
   */
  pgdb_name?: string;
  /**
   * @default "plane_pi"
   */
  pg_pi_db_name?: string;
  /**
   * INCASE OF REMOTE PG DB URL ONLY
   *
   * @default ""
   */
  pgdb_remote_url?: string;
  /**
   * INCASE OF REMOTE Plane AI (PI) PG DB URL ONLY
   *
   * @default ""
   */
  pg_pi_db_remote_url?: string;
  /**
   * DATA STORE
   *
   * @default "uploads"
   */
  docstore_bucket?: string;
  /**
   * 5MB
   *
   * @default "5242880"
   */
  doc_upload_size_limit?: number;
  /**
   * Storage backend selection: 'S3' (default; covers MinIO and S3-compatible
   * services) or 'GCS' (Google Cloud Storage native mode).
   *
   * @default "S3"
   */
  storage_provider?: string;
  /**
   * REQUIRED IF MINIO LOCAL SETUP IS FALSE
   *
   * @default ""
   */
  aws_access_key?: string;
  /**
   * @default ""
   */
  aws_secret_access_key?: string;
  /**
   * @default ""
   */
  aws_region?: string;
  /**
   * @default ""
   */
  aws_s3_endpoint_url?: string;
  /**
   * GCS (Google Cloud Storage) — used only when storage_provider is 'GCS'.
   * When using GCS, set use_storage_proxy: true so browser uploads are proxied
   * server-side through the API (the bucket then needs no CORS configuration).
   * Defaults to docstore_bucket when left empty.
   *
   * @default ""
   */
  gcs_bucket_name?: string;
  /**
   * @default ""
   */
  gcs_project_id?: string;
  /**
   * Credentials are resolved in this order (first match wins):
   * 1. gcs_credentials_json — inline service-account JSON (stored in a Secret)
   * 2. gcs_credentials_path  — path to a service-account file you mount yourself
   * 3. neither — Application Default Credentials (e.g. GKE Workload Identity)
   *
   * @default ""
   */
  gcs_credentials_json?: string;
  /**
   * @default ""
   */
  gcs_credentials_path?: string;
  /**
   * @default false
   */
  use_storage_proxy?: boolean;
  /**
   * @default false
   */
  allow_all_attachment_types?: boolean;
  /**
   * @default false
   */
  enable_drf_spectacular?: boolean;
  /**
   * OPENSEARCH ENVS
   *
   * @default ""
   */
  opensearch_remote_url?: string;
  /**
   * @default ""
   */
  opensearch_remote_username?: string;
  /**
   * @default ""
   */
  opensearch_remote_password?: string;
  /**
   * @default ""
   */
  opensearch_index_prefix?: string;
  /**
   * @default 1536
   */
  opensearch_embedding_dimension?: number;
  /**
   * API KEYS
   *
   * @default "60gp0byfz2dvffa45cxl20p1scy9xbpf6d8c5y0geejgkyp1b5"
   */
  secret_key?: string;
  /**
   * @default "60/minute"
   */
  api_key_rate_limit?: string;
  /**
   * @default ""
   */
  sentry_dsn?: string;
  /**
   * @default ""
   */
  sentry_environment?: string;
  /**
   * @default ""
   */
  cors_allowed_origins?: string;
  /**
   * @default ""
   */
  instance_admin_email?: string;
  /**
   * @default ""
   */
  web_url?: string;
  /**
   * Comma-separated list of IPs/CIDRs and hostnames that webhooks are allowed to target.
   * Leave empty to allow all (no restriction).
   *
   * @default ""
   */
  webhook_allowed_ips?: string;
  /**
   * @default ""
   */
  webhook_allowed_hosts?: string;
  /**
   * @default ""
   */
  live_sentry_dsn?: string;
  /**
   * @default ""
   */
  live_sentry_environment?: string;
  /**
   * @default ""
   */
  live_sentry_traces_sample_rate?: string;
  /**
   * @default "htbqvBJAgpm9bzvf3r4urJer0ENReatceh"
   */
  live_server_secret_key?: string;
  /**
   * @default ""
   */
  external_iframely_url?: string;
  /**
   * @default {...} (13 keys)
   */
  silo_envs?: PlaneenterpriseHelmValuesEnvSiloenvs;
  /**
   * @default {"smtp_domain":"","max_attachment_size":"10485760"}
   */
  email_service_envs?: PlaneenterpriseHelmValuesEnvEmailserviceenvs;
  /**
   * @default {...} (6 keys)
   */
  outbox_poller_envs?: PlaneenterpriseHelmValuesEnvOutboxpollerenvs;
  /**
   * @default {...} (4 keys)
   */
  automation_consumer_envs?: PlaneenterpriseHelmValuesEnvAutomationconsumerenvs;
  /**
   * @default {"queue_name":"plane.webhook","prefetch_count":10}
   */
  webhook_consumer_envs?: PlaneenterpriseHelmValuesEnvWebhookconsumerenvs;
  /**
   * @default {"queue_name":"plane.agent","prefetch_count":10}
   */
  agent_consumer_envs?: PlaneenterpriseHelmValuesEnvAgentconsumerenvs;
  /**
   * @default {...} (5 keys)
   */
  runner_envs?: PlaneenterpriseHelmValuesEnvRunnerenvs;
  /**
   * @default {...} (7 keys)
   */
  pi_envs?: PlaneenterpriseHelmValuesEnvPienvs;
};

export type PlaneenterpriseHelmValuesEnvSiloenvs = {
  /**
   * @default ""
   */
  sentry_dsn?: string;
  /**
   * @default ""
   */
  sentry_environment?: string;
  /**
   * @default ""
   */
  sentry_traces_sample_rate?: string;
  /**
   * @default 100
   */
  batch_size?: number;
  /**
   * @default 1
   */
  mq_prefetch_count?: number;
  /**
   * @default 400
   */
  request_interval?: number;
  /**
   * @default "celery"
   */
  importers_queue_name?: string;
  /**
   * @default "gzb7MRLr0FoN129NyWARZEs84P9LzQ"
   */
  hmac_secret_key?: string;
  /**
   * @default "dsOdt7YrvxsTIFJ37pOaEVvLxN8KGBCr"
   */
  aes_secret_key?: string;
  /**
   * @default ""
   */
  cors_allowed_origins?: string;
  /**
   * @default 50
   */
  jira_server_issues_page_size?: number;
  /**
   * @default 1
   */
  jira_server_issues_parallel_pages?: number;
  /**
   * @default "TTqazTcoBajYKzIAeIKFZeTX9czAoUsG"
   */
  cursor_webhook_secret?: string;
};

export type PlaneenterpriseHelmValuesEnvEmailserviceenvs = {
  /**
   * @default ""
   */
  smtp_domain?: string;
  /**
   * 10MB in bytes
   *
   * @default "10485760"
   */
  max_attachment_size?: number;
};

export type PlaneenterpriseHelmValuesEnvOutboxpollerenvs = {
  /**
   * @default 400
   */
  memory_limit_mb?: number;
  /**
   * @default 0.25
   */
  interval_min?: number;
  /**
   * @default 2
   */
  interval_max?: number;
  /**
   * @default 250
   */
  batch_size?: number;
  /**
   * @default 30
   */
  memory_check_interval?: number;
  /**
   * @default {...} (8 keys)
   */
  pool?: PlaneenterpriseHelmValuesEnvOutboxpollerenvsPool;
};

export type PlaneenterpriseHelmValuesEnvOutboxpollerenvsPool = {
  /**
   * @default 4
   */
  size?: number;
  /**
   * @default 2
   */
  min_size?: number;
  /**
   * @default 10
   */
  max_size?: number;
  /**
   * @default 30
   */
  timeout?: number;
  /**
   * @default 300
   */
  max_idle?: number;
  /**
   * @default 3600
   */
  max_lifetime?: number;
  /**
   * @default 5
   */
  reconnect_timeout?: number;
  /**
   * @default 60
   */
  health_check_interval?: number;
};

export type PlaneenterpriseHelmValuesEnvAutomationconsumerenvs = {
  /**
   * @default "plane.event_stream.automations"
   */
  event_stream_queue_name?: string;
  /**
   * @default 10
   */
  event_stream_prefetch?: number;
  /**
   * @default "plane.event_stream"
   */
  exchange_name?: string;
  /**
   * @default "issue"
   */
  event_types?: string;
};

export type PlaneenterpriseHelmValuesEnvWebhookconsumerenvs = {
  /**
   * @default "plane.webhook"
   */
  queue_name?: string;
  /**
   * @default 10
   */
  prefetch_count?: number;
};

export type PlaneenterpriseHelmValuesEnvAgentconsumerenvs = {
  /**
   * @default "plane.agent"
   */
  queue_name?: string;
  /**
   * @default 10
   */
  prefetch_count?: number;
};

export type PlaneenterpriseHelmValuesEnvRunnerenvs = {
  /**
   * @default "10000"
   */
  execution_timeout_ms?: number;
  /**
   * @default "5000"
   */
  init_timeout_ms?: number;
  /**
   * @default "128"
   */
  isolate_memory_mb?: number;
  /**
   * @default ""
   */
  control_service_base_url?: string;
  /**
   * @default ""
   */
  hmac_secret_key?: string;
};

export type PlaneenterpriseHelmValuesEnvPienvs = {
  /**
   * @default {"state_expiry_seconds":82800}
   */
  plane_oauth?: PlaneenterpriseHelmValuesEnvPienvsPlaneoauth;
  /**
   * @default ""
   */
  plane_api_host?: string;
  /**
   * @default ""
   */
  follower_postgres_uri?: string;
  /**
   * @default ""
   */
  cors_allowed_origins?: string;
  /**
   * @default "tyfvfqvBJAgpm9bzvf3r4urJer0Ehfdubk"
   */
  internal_secret?: string;
  /**
   * @default "DEBUG"
   */
  log_level?: string;
  /**
   * @default {...} (6 keys)
   */
  celery?: PlaneenterpriseHelmValuesEnvPienvsCelery;
};

export type PlaneenterpriseHelmValuesEnvPienvsPlaneoauth = {
  /**
   * @default 82800
   */
  state_expiry_seconds?: number;
};

export type PlaneenterpriseHelmValuesEnvPienvsCelery = {
  /**
   * @default false
   */
  vector_sync_enabled?: boolean;
  /**
   * @default 3
   */
  vector_sync_interval?: number;
  /**
   * @default false
   */
  workspace_plan_sync_enabled?: boolean;
  /**
   * @default 86400
   */
  workspace_plan_sync_interval?: number;
  /**
   * @default false
   */
  docs_sync_enabled?: boolean;
  /**
   * @default 86400
   */
  docs_sync_interval?: number;
};

export type PlaneenterpriseHelmValues = {
  /**
   * @default "v3.0.1"
   */
  planeVersion?: string;
  /**
   * @default {...} (5 keys)
   */
  dockerRegistry?: PlaneenterpriseHelmValuesDockerRegistry;
  /**
   * @default {"licenseServer":"https://prime.plane.so","licenseDomain":"plane.example.com"}
   */
  license?: PlaneenterpriseHelmValuesLicense;
  /**
   * @default {...} (4 keys)
   */
  airgapped?: PlaneenterpriseHelmValuesAirgapped;
  /**
   * @default {...} (5 keys)
   */
  ingress?: PlaneenterpriseHelmValuesIngress;
  /**
   * @default {...} (7 keys)
   */
  ssl?: PlaneenterpriseHelmValuesSsl;
  /**
   * ============================================================
   * Pod Security (Kubernetes Pod Security Admission "restricted")
   * ============================================================
   * When enabled, applies a hardened pod- and container-level securityContext to
   * all first-party Plane workloads: api, web, space, admin, live, worker,
   * beat-worker, automation-consumer, outbox-poller, silo, monitor, iframely,
   * runner, pi-api/beat/worker, and the migration Jobs (including their busybox
   * init containers). Plane's images run fine as non-root, so these defaults
   * satisfy the PSA "restricted" profile.
   * NOT applied to:
   * - The bundled local infrastructure (postgres, redis, rabbitmq, minio,
   * opensearch): third-party images with their own UID/GID requirements,
   * intended for local/dev use. In hardened clusters run those externally
   * (managed RDS, ElastiCache, etc.) and leave local_setup off.
   * Mirrors the kustomize `nonroot-security-context` component. Override runAsUser/
   * runAsGroup/fsGroup below if your environment pins a specific UID (e.g. 10001).
   *
   * @default {"enabled":false,"podSecurityContext":{"runAsNonRoot":true,"runAsUser":1000,"runAsGroup":1000,"fsGroup":1000,"seccompProfile":{"type":"RuntimeDefault"}},"containerSecurityContext":{"allowPrivilegeEscalation":false,"runAsNonRoot":true,"runAsUser":1000,"capabilities":{"drop":["ALL"]},"seccompProfile":{"type":"RuntimeDefault"}}}
   */
  securityContext?: PlaneenterpriseHelmValuesSecurityContext;
  /**
   * @default {...} (26 keys)
   */
  services?: PlaneenterpriseHelmValuesServices;
  /**
   * @default {...} (9 keys)
   */
  external_secrets?: PlaneenterpriseHelmValuesExternalsecrets;
  /**
   * @default {...} (50 keys)
   */
  env?: PlaneenterpriseHelmValuesEnv;
  extraEnv?: unknown[];
};

export type PlaneenterpriseHelmParameters = {
  planeVersion?: string;
  "dockerRegistry.enabled"?: string;
  "dockerRegistry.registry"?: string;
  "dockerRegistry.loginid"?: string;
  "dockerRegistry.password"?: string;
  "dockerRegistry.existingSecret"?: string;
  "license.licenseServer"?: string;
  "license.licenseDomain"?: string;
  "airgapped.enabled"?: string;
  "airgapped.s3Secrets"?: string;
  "airgapped.s3SecretName"?: string;
  "airgapped.s3SecretKey"?: string;
  "ingress.enabled"?: string;
  "ingress.minioHost"?: string;
  "ingress.rabbitmqHost"?: string;
  "ingress.ingressClass"?: string;
  "ingress.traefik.maxRequestBodyBytes"?: string;
  "ssl.tls_secret_name"?: string;
  "ssl.createIssuer"?: string;
  "ssl.issuer"?: string;
  "ssl.token"?: string;
  "ssl.server"?: string;
  "ssl.email"?: string;
  "ssl.generateCerts"?: string;
  "securityContext.enabled"?: string;
  "securityContext.podSecurityContext.runAsNonRoot"?: string;
  "securityContext.podSecurityContext.runAsUser"?: string;
  "securityContext.podSecurityContext.runAsGroup"?: string;
  "securityContext.podSecurityContext.fsGroup"?: string;
  "securityContext.podSecurityContext.seccompProfile.type"?: string;
  "securityContext.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "securityContext.containerSecurityContext.runAsNonRoot"?: string;
  "securityContext.containerSecurityContext.runAsUser"?: string;
  "securityContext.containerSecurityContext.capabilities.drop"?: string;
  "securityContext.containerSecurityContext.seccompProfile.type"?: string;
  "services.redis.local_setup"?: string;
  "services.redis.image"?: string;
  "services.redis.servicePort"?: string;
  "services.redis.volumeSize"?: string;
  "services.redis.pullPolicy"?: string;
  "services.redis.assign_cluster_ip"?: string;
  "services.redis.nodeSelector"?: string;
  "services.redis.tolerations"?: string;
  "services.redis.affinity"?: string;
  "services.postgres.local_setup"?: string;
  "services.postgres.image"?: string;
  "services.postgres.servicePort"?: string;
  "services.postgres.volumeSize"?: string;
  "services.postgres.pullPolicy"?: string;
  "services.postgres.assign_cluster_ip"?: string;
  "services.postgres.nodeSelector"?: string;
  "services.postgres.tolerations"?: string;
  "services.postgres.affinity"?: string;
  "services.postgres.read_replica.enabled"?: string;
  "services.postgres.read_replica.remote_url"?: string;
  "services.rabbitmq.local_setup"?: string;
  "services.rabbitmq.image"?: string;
  "services.rabbitmq.servicePort"?: string;
  "services.rabbitmq.managementPort"?: string;
  "services.rabbitmq.volumeSize"?: string;
  "services.rabbitmq.pullPolicy"?: string;
  "services.rabbitmq.default_user"?: string;
  "services.rabbitmq.default_password"?: string;
  "services.rabbitmq.external_rabbitmq_url"?: string;
  "services.rabbitmq.assign_cluster_ip"?: string;
  "services.rabbitmq.nodeSelector"?: string;
  "services.rabbitmq.tolerations"?: string;
  "services.rabbitmq.affinity"?: string;
  "services.opensearch.local_setup"?: string;
  "services.opensearch.image"?: string;
  "services.opensearch.servicePort"?: string;
  "services.opensearch.volumeSize"?: string;
  "services.opensearch.pullPolicy"?: string;
  "services.opensearch.username"?: string;
  "services.opensearch.password"?: string;
  "services.opensearch.memoryLimit"?: string;
  "services.opensearch.cpuLimit"?: string;
  "services.opensearch.memoryRequest"?: string;
  "services.opensearch.cpuRequest"?: string;
  "services.opensearch.assign_cluster_ip"?: string;
  "services.opensearch.nodeSelector"?: string;
  "services.opensearch.tolerations"?: string;
  "services.opensearch.affinity"?: string;
  "services.minio.local_setup"?: string;
  "services.minio.image"?: string;
  "services.minio.image_mc"?: string;
  "services.minio.volumeSize"?: string;
  "services.minio.pullPolicy"?: string;
  "services.minio.root_user"?: string;
  "services.minio.root_password"?: string;
  "services.minio.assign_cluster_ip"?: string;
  "services.minio.env.minio_endpoint_ssl"?: string;
  "services.minio.nodeSelector"?: string;
  "services.minio.tolerations"?: string;
  "services.minio.affinity"?: string;
  "services.iframely.enabled"?: string;
  "services.iframely.replicas"?: string;
  "services.iframely.memoryLimit"?: string;
  "services.iframely.cpuLimit"?: string;
  "services.iframely.memoryRequest"?: string;
  "services.iframely.cpuRequest"?: string;
  "services.iframely.image"?: string;
  "services.iframely.pullPolicy"?: string;
  "services.iframely.assign_cluster_ip"?: string;
  "services.iframely.nodeSelector"?: string;
  "services.iframely.tolerations"?: string;
  "services.iframely.affinity"?: string;
  "services.web.replicas"?: string;
  "services.web.memoryLimit"?: string;
  "services.web.cpuLimit"?: string;
  "services.web.memoryRequest"?: string;
  "services.web.cpuRequest"?: string;
  "services.web.image"?: string;
  "services.web.pullPolicy"?: string;
  "services.web.assign_cluster_ip"?: string;
  "services.web.nodeSelector"?: string;
  "services.web.tolerations"?: string;
  "services.web.affinity"?: string;
  "services.monitor.memoryLimit"?: string;
  "services.monitor.cpuLimit"?: string;
  "services.monitor.memoryRequest"?: string;
  "services.monitor.cpuRequest"?: string;
  "services.monitor.image"?: string;
  "services.monitor.pullPolicy"?: string;
  "services.monitor.volumeSize"?: string;
  "services.monitor.assign_cluster_ip"?: string;
  "services.monitor.nodeSelector"?: string;
  "services.monitor.tolerations"?: string;
  "services.monitor.affinity"?: string;
  "services.space.replicas"?: string;
  "services.space.memoryLimit"?: string;
  "services.space.cpuLimit"?: string;
  "services.space.memoryRequest"?: string;
  "services.space.cpuRequest"?: string;
  "services.space.image"?: string;
  "services.space.pullPolicy"?: string;
  "services.space.assign_cluster_ip"?: string;
  "services.space.nodeSelector"?: string;
  "services.space.tolerations"?: string;
  "services.space.affinity"?: string;
  "services.admin.replicas"?: string;
  "services.admin.memoryLimit"?: string;
  "services.admin.cpuLimit"?: string;
  "services.admin.memoryRequest"?: string;
  "services.admin.cpuRequest"?: string;
  "services.admin.image"?: string;
  "services.admin.pullPolicy"?: string;
  "services.admin.assign_cluster_ip"?: string;
  "services.admin.nodeSelector"?: string;
  "services.admin.tolerations"?: string;
  "services.admin.affinity"?: string;
  "services.live.replicas"?: string;
  "services.live.memoryLimit"?: string;
  "services.live.cpuLimit"?: string;
  "services.live.memoryRequest"?: string;
  "services.live.cpuRequest"?: string;
  "services.live.image"?: string;
  "services.live.pullPolicy"?: string;
  "services.live.assign_cluster_ip"?: string;
  "services.live.nodeSelector"?: string;
  "services.live.tolerations"?: string;
  "services.live.affinity"?: string;
  "services.api.replicas"?: string;
  "services.api.memoryLimit"?: string;
  "services.api.cpuLimit"?: string;
  "services.api.memoryRequest"?: string;
  "services.api.cpuRequest"?: string;
  "services.api.image"?: string;
  "services.api.pullPolicy"?: string;
  "services.api.assign_cluster_ip"?: string;
  "services.api.nodeSelector"?: string;
  "services.api.tolerations"?: string;
  "services.api.affinity"?: string;
  "services.external_api.enabled"?: string;
  "services.external_api.replicas"?: string;
  "services.external_api.memoryLimit"?: string;
  "services.external_api.cpuLimit"?: string;
  "services.external_api.memoryRequest"?: string;
  "services.external_api.cpuRequest"?: string;
  "services.external_api.assign_cluster_ip"?: string;
  "services.external_api.nodeSelector"?: string;
  "services.external_api.tolerations"?: string;
  "services.external_api.affinity"?: string;
  "services.worker.replicas"?: string;
  "services.worker.memoryLimit"?: string;
  "services.worker.cpuLimit"?: string;
  "services.worker.memoryRequest"?: string;
  "services.worker.cpuRequest"?: string;
  "services.worker.nodeSelector"?: string;
  "services.worker.tolerations"?: string;
  "services.worker.affinity"?: string;
  "services.worker_importers.enabled"?: string;
  "services.worker_importers.replicas"?: string;
  "services.worker_importers.memoryLimit"?: string;
  "services.worker_importers.cpuLimit"?: string;
  "services.worker_importers.memoryRequest"?: string;
  "services.worker_importers.cpuRequest"?: string;
  "services.worker_importers.nodeSelector"?: string;
  "services.worker_importers.tolerations"?: string;
  "services.worker_importers.affinity"?: string;
  "services.beatworker.replicas"?: string;
  "services.beatworker.memoryLimit"?: string;
  "services.beatworker.cpuLimit"?: string;
  "services.beatworker.memoryRequest"?: string;
  "services.beatworker.cpuRequest"?: string;
  "services.beatworker.nodeSelector"?: string;
  "services.beatworker.tolerations"?: string;
  "services.beatworker.affinity"?: string;
  "services.silo.enabled"?: string;
  "services.silo.replicas"?: string;
  "services.silo.memoryLimit"?: string;
  "services.silo.cpuLimit"?: string;
  "services.silo.memoryRequest"?: string;
  "services.silo.cpuRequest"?: string;
  "services.silo.image"?: string;
  "services.silo.pullPolicy"?: string;
  "services.silo.assign_cluster_ip"?: string;
  "services.silo.nodeSelector"?: string;
  "services.silo.tolerations"?: string;
  "services.silo.affinity"?: string;
  "services.silo.connectors.slack.enabled"?: string;
  "services.silo.connectors.slack.client_id"?: string;
  "services.silo.connectors.slack.client_secret"?: string;
  "services.silo.connectors.slack.base_url"?: string;
  "services.silo.connectors.github.enabled"?: string;
  "services.silo.connectors.github.client_id"?: string;
  "services.silo.connectors.github.client_secret"?: string;
  "services.silo.connectors.github.app_name"?: string;
  "services.silo.connectors.github.app_id"?: string;
  "services.silo.connectors.github.private_key"?: string;
  "services.silo.connectors.gitlab.enabled"?: string;
  "services.silo.connectors.gitlab.client_id"?: string;
  "services.silo.connectors.gitlab.client_secret"?: string;
  "services.silo.connectors.sentry.enabled"?: string;
  "services.silo.connectors.sentry.base_url"?: string;
  "services.silo.connectors.sentry.client_id"?: string;
  "services.silo.connectors.sentry.client_secret"?: string;
  "services.silo.connectors.sentry.integration_slug"?: string;
  "services.email_service.enabled"?: string;
  "services.email_service.replicas"?: string;
  "services.email_service.memoryLimit"?: string;
  "services.email_service.cpuLimit"?: string;
  "services.email_service.memoryRequest"?: string;
  "services.email_service.cpuRequest"?: string;
  "services.email_service.image"?: string;
  "services.email_service.pullPolicy"?: string;
  "services.email_service.nodeSelector"?: string;
  "services.email_service.tolerations"?: string;
  "services.email_service.affinity"?: string;
  "services.outbox_poller.enabled"?: string;
  "services.outbox_poller.replicas"?: string;
  "services.outbox_poller.memoryLimit"?: string;
  "services.outbox_poller.cpuLimit"?: string;
  "services.outbox_poller.memoryRequest"?: string;
  "services.outbox_poller.cpuRequest"?: string;
  "services.outbox_poller.pullPolicy"?: string;
  "services.outbox_poller.assign_cluster_ip"?: string;
  "services.outbox_poller.nodeSelector"?: string;
  "services.outbox_poller.tolerations"?: string;
  "services.outbox_poller.affinity"?: string;
  "services.automation_consumer.enabled"?: string;
  "services.automation_consumer.replicas"?: string;
  "services.automation_consumer.memoryLimit"?: string;
  "services.automation_consumer.cpuLimit"?: string;
  "services.automation_consumer.memoryRequest"?: string;
  "services.automation_consumer.cpuRequest"?: string;
  "services.automation_consumer.assign_cluster_ip"?: string;
  "services.automation_consumer.nodeSelector"?: string;
  "services.automation_consumer.tolerations"?: string;
  "services.automation_consumer.affinity"?: string;
  "services.webhook_consumer.enabled"?: string;
  "services.webhook_consumer.replicas"?: string;
  "services.webhook_consumer.memoryLimit"?: string;
  "services.webhook_consumer.cpuLimit"?: string;
  "services.webhook_consumer.memoryRequest"?: string;
  "services.webhook_consumer.cpuRequest"?: string;
  "services.webhook_consumer.assign_cluster_ip"?: string;
  "services.webhook_consumer.nodeSelector"?: string;
  "services.webhook_consumer.tolerations"?: string;
  "services.webhook_consumer.affinity"?: string;
  "services.agent_consumer.enabled"?: string;
  "services.agent_consumer.replicas"?: string;
  "services.agent_consumer.memoryLimit"?: string;
  "services.agent_consumer.cpuLimit"?: string;
  "services.agent_consumer.memoryRequest"?: string;
  "services.agent_consumer.cpuRequest"?: string;
  "services.agent_consumer.assign_cluster_ip"?: string;
  "services.agent_consumer.nodeSelector"?: string;
  "services.agent_consumer.tolerations"?: string;
  "services.agent_consumer.affinity"?: string;
  "services.pi.enabled"?: string;
  "services.pi.replicas"?: string;
  "services.pi.memoryLimit"?: string;
  "services.pi.cpuLimit"?: string;
  "services.pi.memoryRequest"?: string;
  "services.pi.cpuRequest"?: string;
  "services.pi.image"?: string;
  "services.pi.pullPolicy"?: string;
  "services.pi.assign_cluster_ip"?: string;
  "services.pi.nodeSelector"?: string;
  "services.pi.tolerations"?: string;
  "services.pi.affinity"?: string;
  "services.pi.ai_providers.openai.enabled"?: string;
  "services.pi.ai_providers.openai.base_url"?: string;
  "services.pi.ai_providers.openai.api_key"?: string;
  "services.pi.ai_providers.claude.enabled"?: string;
  "services.pi.ai_providers.claude.base_url"?: string;
  "services.pi.ai_providers.claude.api_key"?: string;
  "services.pi.ai_providers.groq.enabled"?: string;
  "services.pi.ai_providers.groq.base_url"?: string;
  "services.pi.ai_providers.groq.api_key"?: string;
  "services.pi.ai_providers.cohere.enabled"?: string;
  "services.pi.ai_providers.cohere.base_url"?: string;
  "services.pi.ai_providers.cohere.api_key"?: string;
  "services.pi.ai_providers.custom_llm.enabled"?: string;
  "services.pi.ai_providers.custom_llm.api_key"?: string;
  "services.pi.ai_providers.custom_llm.base_url"?: string;
  "services.pi.ai_providers.custom_llm.model_key"?: string;
  "services.pi.ai_providers.custom_llm.name"?: string;
  "services.pi.ai_providers.custom_llm.max_tokens"?: string;
  "services.pi.ai_providers.custom_llm.provider"?: string;
  "services.pi.ai_providers.custom_llm.aws_region"?: string;
  "services.pi.ai_providers.embedding_model.enabled"?: string;
  "services.pi.ai_providers.embedding_model.name"?: string;
  "services.pi.ai_providers.embedding_model.model_id"?: string;
  "services.pi.ai_providers.embedding_model.embedding_dimension"?: string;
  "services.pi.ai_providers.embedding_model.aws_access_key"?: string;
  "services.pi.ai_providers.embedding_model.aws_secret_access_key"?: string;
  "services.pi.ai_providers.embedding_model.aws_region"?: string;
  "services.pi.ai_providers.embedding_model.aws_session_token"?: string;
  "services.pi_beat_worker.replicas"?: string;
  "services.pi_beat_worker.memoryLimit"?: string;
  "services.pi_beat_worker.cpuLimit"?: string;
  "services.pi_beat_worker.memoryRequest"?: string;
  "services.pi_beat_worker.cpuRequest"?: string;
  "services.pi_beat_worker.nodeSelector"?: string;
  "services.pi_beat_worker.tolerations"?: string;
  "services.pi_beat_worker.affinity"?: string;
  "services.pi_worker.replicas"?: string;
  "services.pi_worker.memoryLimit"?: string;
  "services.pi_worker.cpuLimit"?: string;
  "services.pi_worker.memoryRequest"?: string;
  "services.pi_worker.cpuRequest"?: string;
  "services.pi_worker.nodeSelector"?: string;
  "services.pi_worker.tolerations"?: string;
  "services.pi_worker.affinity"?: string;
  "services.runner.enabled"?: string;
  "services.runner.replicas"?: string;
  "services.runner.memoryLimit"?: string;
  "services.runner.cpuLimit"?: string;
  "services.runner.memoryRequest"?: string;
  "services.runner.cpuRequest"?: string;
  "services.runner.image"?: string;
  "services.runner.pullPolicy"?: string;
  "services.runner.assign_cluster_ip"?: string;
  "services.runner.nodeSelector"?: string;
  "services.runner.tolerations"?: string;
  "services.runner.affinity"?: string;
  "external_secrets.rabbitmq_existingSecret"?: string;
  "external_secrets.pgdb_existingSecret"?: string;
  "external_secrets.opensearch_existingSecret"?: string;
  "external_secrets.doc_store_existingSecret"?: string;
  "external_secrets.app_env_existingSecret"?: string;
  "external_secrets.live_env_existingSecret"?: string;
  "external_secrets.silo_env_existingSecret"?: string;
  "external_secrets.pi_api_env_existingSecret"?: string;
  "external_secrets.runner_env_existingSecret"?: string;
  "env.storageClass"?: string;
  "env.default_cluster_domain"?: string;
  "env.remote_redis_url"?: string;
  "env.pgdb_username"?: string;
  "env.pgdb_password"?: string;
  "env.pgdb_name"?: string;
  "env.pg_pi_db_name"?: string;
  "env.pgdb_remote_url"?: string;
  "env.pg_pi_db_remote_url"?: string;
  "env.docstore_bucket"?: string;
  "env.doc_upload_size_limit"?: string;
  "env.storage_provider"?: string;
  "env.aws_access_key"?: string;
  "env.aws_secret_access_key"?: string;
  "env.aws_region"?: string;
  "env.aws_s3_endpoint_url"?: string;
  "env.gcs_bucket_name"?: string;
  "env.gcs_project_id"?: string;
  "env.gcs_credentials_json"?: string;
  "env.gcs_credentials_path"?: string;
  "env.use_storage_proxy"?: string;
  "env.allow_all_attachment_types"?: string;
  "env.enable_drf_spectacular"?: string;
  "env.opensearch_remote_url"?: string;
  "env.opensearch_remote_username"?: string;
  "env.opensearch_remote_password"?: string;
  "env.opensearch_index_prefix"?: string;
  "env.opensearch_embedding_dimension"?: string;
  "env.secret_key"?: string;
  "env.api_key_rate_limit"?: string;
  "env.sentry_dsn"?: string;
  "env.sentry_environment"?: string;
  "env.cors_allowed_origins"?: string;
  "env.instance_admin_email"?: string;
  "env.web_url"?: string;
  "env.webhook_allowed_ips"?: string;
  "env.webhook_allowed_hosts"?: string;
  "env.live_sentry_dsn"?: string;
  "env.live_sentry_environment"?: string;
  "env.live_sentry_traces_sample_rate"?: string;
  "env.live_server_secret_key"?: string;
  "env.external_iframely_url"?: string;
  "env.silo_envs.sentry_dsn"?: string;
  "env.silo_envs.sentry_environment"?: string;
  "env.silo_envs.sentry_traces_sample_rate"?: string;
  "env.silo_envs.batch_size"?: string;
  "env.silo_envs.mq_prefetch_count"?: string;
  "env.silo_envs.request_interval"?: string;
  "env.silo_envs.importers_queue_name"?: string;
  "env.silo_envs.hmac_secret_key"?: string;
  "env.silo_envs.aes_secret_key"?: string;
  "env.silo_envs.cors_allowed_origins"?: string;
  "env.silo_envs.jira_server_issues_page_size"?: string;
  "env.silo_envs.jira_server_issues_parallel_pages"?: string;
  "env.silo_envs.cursor_webhook_secret"?: string;
  "env.email_service_envs.smtp_domain"?: string;
  "env.email_service_envs.max_attachment_size"?: string;
  "env.outbox_poller_envs.memory_limit_mb"?: string;
  "env.outbox_poller_envs.interval_min"?: string;
  "env.outbox_poller_envs.interval_max"?: string;
  "env.outbox_poller_envs.batch_size"?: string;
  "env.outbox_poller_envs.memory_check_interval"?: string;
  "env.outbox_poller_envs.pool.size"?: string;
  "env.outbox_poller_envs.pool.min_size"?: string;
  "env.outbox_poller_envs.pool.max_size"?: string;
  "env.outbox_poller_envs.pool.timeout"?: string;
  "env.outbox_poller_envs.pool.max_idle"?: string;
  "env.outbox_poller_envs.pool.max_lifetime"?: string;
  "env.outbox_poller_envs.pool.reconnect_timeout"?: string;
  "env.outbox_poller_envs.pool.health_check_interval"?: string;
  "env.automation_consumer_envs.event_stream_queue_name"?: string;
  "env.automation_consumer_envs.event_stream_prefetch"?: string;
  "env.automation_consumer_envs.exchange_name"?: string;
  "env.automation_consumer_envs.event_types"?: string;
  "env.webhook_consumer_envs.queue_name"?: string;
  "env.webhook_consumer_envs.prefetch_count"?: string;
  "env.agent_consumer_envs.queue_name"?: string;
  "env.agent_consumer_envs.prefetch_count"?: string;
  "env.runner_envs.execution_timeout_ms"?: string;
  "env.runner_envs.init_timeout_ms"?: string;
  "env.runner_envs.isolate_memory_mb"?: string;
  "env.runner_envs.control_service_base_url"?: string;
  "env.runner_envs.hmac_secret_key"?: string;
  "env.pi_envs.plane_oauth.state_expiry_seconds"?: string;
  "env.pi_envs.plane_api_host"?: string;
  "env.pi_envs.follower_postgres_uri"?: string;
  "env.pi_envs.cors_allowed_origins"?: string;
  "env.pi_envs.internal_secret"?: string;
  "env.pi_envs.log_level"?: string;
  "env.pi_envs.celery.vector_sync_enabled"?: string;
  "env.pi_envs.celery.vector_sync_interval"?: string;
  "env.pi_envs.celery.workspace_plan_sync_enabled"?: string;
  "env.pi_envs.celery.workspace_plan_sync_interval"?: string;
  "env.pi_envs.celery.docs_sync_enabled"?: string;
  "env.pi_envs.celery.docs_sync_interval"?: string;
  extraEnv?: string;
};
