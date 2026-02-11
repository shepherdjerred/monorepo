// Generated TypeScript types for mc-router Helm chart

export type McrouterHelmValuesImage = {
  /**
   * @default "itzg/mc-router"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
};

export type McrouterHelmValuesServiceAccount = {
  /**
   * Specifies whether a service account should be created
   *
   * @default true
   */
  create?: boolean;
  /**
   * Automatically mount a ServiceAccount's API credentials?
   *
   * @default true
   */
  automount?: boolean;
  /**
   * Annotations to add to the service account
   *
   * @default {}
   */
  annotations?: McrouterHelmValuesServiceAccountAnnotations;
  /**
   * The name of the service account to use.
   * If not set and create is true, a name is generated using the fullname template
   *
   * @default ""
   */
  name?: string;
};

export type McrouterHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type McrouterHelmValuesDeploymentStrategy = {
  /**
   * @default "Recreate"
   */
  type?: string;
};

export type McrouterHelmValuesDeploymentAnnotations = object;

export type McrouterHelmValuesDeploymentLabels = object;

export type McrouterHelmValuesPodAnnotations = object;

export type McrouterHelmValuesPodLabels = object;

export type McrouterHelmValuesPodSecurityContext = object;

export type McrouterHelmValuesSecurityContext = object;

export type McrouterHelmValuesServices = {
  /**
   * Service for API requests
   *
   * @default {}
   */
  api?: McrouterHelmValuesServicesApi;
  /**
   * Service for Minecraft client connections
   * Service port exposed externally on each node
   * Additional service specs to be defined
   * Fields set here will be added to the end of the Service spec
   * Can include any fields from https://kubernetes.io/docs/reference/kubernetes-api/service-resources/service-v1/#ServiceSpec
   *
   * @default {"type":"NodePort","port":25565}
   */
  minecraft?: McrouterHelmValuesServicesMinecraft;
  /**
   * @default {}
   */
  extraServiceSpec?: McrouterHelmValuesServicesExtraServiceSpec;
};

export type McrouterHelmValuesServicesApi = object;

export type McrouterHelmValuesServicesMinecraft = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "NodePort"
   */
  type?: "ExternalName" | "ClusterIP" | "NodePort" | "LoadBalancer";
  /**
   * Service port exposed within the cluster
   *
   * @default 25565
   */
  port?: number;
};

export type McrouterHelmValuesServicesExtraServiceSpec = object;

export type McrouterHelmValuesResources = object;

export type McrouterHelmValuesAutoscaling = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 1
   */
  minReplicas?: number;
  /**
   * @default 100
   */
  maxReplicas?: number;
  /**
   * @default 80
   */
  targetCPUUtilizationPercentage?: number;
};

export type McrouterHelmValuesNodeSelector = object;

export type McrouterHelmValuesAffinity = object;

export type McrouterHelmValuesExtraEnv = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type McrouterHelmValuesExtraPodSpec = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type McrouterHelmValuesMinecraftRouter = {
  /**
   * @default {...} (4 keys)
   */
  autoScale?: McrouterHelmValuesMinecraftRouterAutoScale;
  /**
   * @default 1
   */
  connectionRateLimit?: number;
  /**
   * Write CPU profiling to given path
   *
   * @default ""
   */
  cpuProfilePath?: string;
  /**
   * Enable debug logs
   *
   * @default {"enabled":false}
   */
  debug?: McrouterHelmValuesMinecraftRouterDebug;
  /**
   * Default Minecraft server to use when mapping not found
   *
   * @default {}
   */
  defaultServer?: McrouterHelmValuesMinecraftRouterDefaultServer;
  /**
   * Minecraft server mappings
   *
   * @default []
   */
  mappings?: object[];
  /**
   * Extra tags to be included with all reported metrics
   * If set, an ngrok tunnel will be established.
   *
   * @default {"backend":"discard"}
   */
  metrics?: McrouterHelmValuesMinecraftRouterMetrics;
  /**
   * The name of an existing secret containing the token
   * The key in the existing secret containing the token
   *
   * @default {}
   */
  ngrokToken?: McrouterHelmValuesMinecraftRouterNgrokToken;
  /**
   * Simplify fully qualified SRV records for mapping
   *
   * @default false
   */
  simplifySrv?: "default" | boolean;
  /**
   * Send PROXY protocol to backend servers
   *
   * @default false
   */
  useProxyProtocol?: "default" | boolean;
  /**
   * Output version and exit
   *
   * @default false
   */
  showVersion?: "default" | boolean;
};

export type McrouterHelmValuesMinecraftRouterAutoScale = {
  /**
   * @default {"enabled":false}
   */
  up?: McrouterHelmValuesMinecraftRouterAutoScaleUp;
  /**
   * @default {"enabled":false,"after":""}
   */
  down?: McrouterHelmValuesMinecraftRouterAutoScaleDown;
  /**
   * Type of Kubernetes object to store autoscale allow/deny list config in.
   * Valid options: Secret,ConfigMap
   *
   * @default "Secret"
   */
  configObject?: "Secret" | "ConfigMap";
  /**
   * Specify a server allow/deny list to restrict which players may trigger the scalers.
   * For more info on the schema, check out the file in `mc-router`
   * https://github.com/itzg/mc-router/blob/1.29.0/docs/allow-deny-list.schema.json
   *
   * @default {}
   */
  allowDeny?: unknown;
};

export type McrouterHelmValuesMinecraftRouterAutoScaleUp = {
  /**
   * "Wake up" any stopped Minecraft servers.
   * This requires Minecraft servers to be kind: StatefulSet
   *
   * This requires Minecraft servers to be kind: StatefulSet
   *
   * @default false
   */
  enabled?: "default" | boolean;
};

export type McrouterHelmValuesMinecraftRouterAutoScaleDown = {
  /**
   * Shut down any running Minecraft servers after there are no more connections.
   * This requires Minecraft servers to be kind: StatefulSet
   *
   * This requires Minecraft servers to be kind: StatefulSet
   *
   * @default false
   */
  enabled?: "default" | boolean;
  /**
   * Shut down waiting period after there are no more connections.
   * It is recommended that this value is high enough so momentary disconnections do not result in a server shutdown
   *
   * It is recommended that this value is high enough so momentary disconnections do not result in a server shutdown
   *
   * @default ""
   */
  after?: string;
};

export type McrouterHelmValuesMinecraftRouterDebug = {
  /**
   * @default false
   */
  enabled?: "default" | boolean;
};

export type McrouterHelmValuesMinecraftRouterDefaultServer = object;

export type McrouterHelmValuesMinecraftRouterMetrics = {
  /**
   * Backend to use for metrics exposure/publishing: discard,expvar,influxdb,prometheus
   *
   * @default "discard"
   */
  backend?: "discard" | "expvar" | "influxdb" | "prometheus";
};

export type McrouterHelmValuesMinecraftRouterNgrokToken = object;

export type McrouterHelmValues = {
  /**
   * Default values for mc-router.
   * This is a YAML-formatted file.
   * Declare variables to be passed into your templates.
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * @default {"repository":"itzg/mc-router","tag":"latest","pullPolicy":"Always"}
   */
  image?: McrouterHelmValuesImage;
  imagePullSecrets?: unknown[];
  /**
   * @default ""
   */
  nameOverride?: string;
  /**
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * @default {...} (4 keys)
   */
  serviceAccount?: McrouterHelmValuesServiceAccount;
  /**
   * @default {"type":"Recreate"}
   */
  deploymentStrategy?: McrouterHelmValuesDeploymentStrategy;
  /**
   * @default {}
   */
  deploymentAnnotations?: McrouterHelmValuesDeploymentAnnotations;
  /**
   * @default {}
   */
  deploymentLabels?: McrouterHelmValuesDeploymentLabels;
  /**
   * @default {}
   */
  podAnnotations?: McrouterHelmValuesPodAnnotations;
  /**
   * @default {}
   */
  podLabels?: McrouterHelmValuesPodLabels;
  /**
   * @default {}
   */
  podSecurityContext?: McrouterHelmValuesPodSecurityContext;
  /**
   * @default {}
   */
  securityContext?: McrouterHelmValuesSecurityContext;
  /**
   * @default {"api":{},"minecraft":{"type":"NodePort","port":25565},"extraServiceSpec":{}}
   */
  services?: McrouterHelmValuesServices;
  /**
   * @default {}
   */
  resources?: McrouterHelmValuesResources;
  /**
   * @default {...} (4 keys)
   */
  autoscaling?: McrouterHelmValuesAutoscaling;
  /**
   * @default {}
   */
  nodeSelector?: McrouterHelmValuesNodeSelector;
  tolerations?: unknown[];
  /**
   * @default {}
   */
  affinity?: McrouterHelmValuesAffinity;
  extraVolumes?: unknown[];
  /**
   * - port=2049
   * - hard
   * - vers=4
   * Additional mc-router container environment variables
   * Values can be either variable values or `valueFrom` yaml
   *
   * @default {}
   */
  extraEnv?: McrouterHelmValuesExtraEnv;
  /**
   * Extra fields to set on the pod
   * Fields set here will be added to the end of the Pod spec
   * Can include any fields from https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-v1/#PodSpec
   * that are not already set by the chart.
   * The value of the field will be interpretted as a template.
   *
   * @default {}
   */
  extraPodSpec?: McrouterHelmValuesExtraPodSpec;
  extraDeploy?: unknown[];
  /**
   * @default {...} (11 keys)
   */
  minecraftRouter?: McrouterHelmValuesMinecraftRouter;
};

export type McrouterHelmParameters = {
  replicaCount?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "image.pullPolicy"?: string;
  imagePullSecrets?: string;
  nameOverride?: string;
  fullnameOverride?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.automount"?: string;
  "serviceAccount.name"?: string;
  "deploymentStrategy.type"?: string;
  "services.minecraft.type"?: string;
  "services.minecraft.port"?: string;
  "autoscaling.enabled"?: string;
  "autoscaling.minReplicas"?: string;
  "autoscaling.maxReplicas"?: string;
  "autoscaling.targetCPUUtilizationPercentage"?: string;
  tolerations?: string;
  extraVolumes?: string;
  extraDeploy?: string;
  "minecraftRouter.autoScale.up.enabled"?: string;
  "minecraftRouter.autoScale.down.enabled"?: string;
  "minecraftRouter.autoScale.down.after"?: string;
  "minecraftRouter.autoScale.configObject"?: string;
  "minecraftRouter.autoScale.allowDeny"?: string;
  "minecraftRouter.connectionRateLimit"?: string;
  "minecraftRouter.cpuProfilePath"?: string;
  "minecraftRouter.debug.enabled"?: string;
  "minecraftRouter.mappings"?: string;
  "minecraftRouter.metrics.backend"?: string;
  "minecraftRouter.simplifySrv"?: string;
  "minecraftRouter.useProxyProtocol"?: string;
  "minecraftRouter.showVersion"?: string;
};
