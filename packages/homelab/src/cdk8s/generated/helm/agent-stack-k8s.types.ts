// Generated TypeScript types for agent-stack-k8s Helm chart

export type Agentstackk8sHelmValuesNodeSelector = object;

export type Agentstackk8sHelmValuesConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default 9216
   */
  "prometheus-port"?: number;
  /**
   * @default 900
   */
  "reservation-expiry-seconds"?: number;
  /**
   * @default true
   */
  "enable-completion-watcher"?: boolean;
  /**
   * @default "15m"
   */
  "pod-pending-timeout"?: string;
  /**
   * @default ""
   */
  image?: string;
};

export type Agentstackk8sHelmValuesResources = {
  /**
   * @default {}
   */
  requests?: Agentstackk8sHelmValuesResourcesRequests;
};

export type Agentstackk8sHelmValuesResourcesRequests = {
  /**
   * @default "100m"
   */
  cpu?: string | number;
  /**
   * @default "100Mi"
   */
  memory?: string | number;
};

export type Agentstackk8sHelmValuesLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type Agentstackk8sHelmValuesAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type Agentstackk8sHelmValuesSecretsMetadata = object;

export type Agentstackk8sHelmValuesServiceAccountMetadata = object;

export type Agentstackk8sHelmValuesMonitoring = {
  /**
   * @default false
   */
  deployGrafanaDashboard?: boolean;
  /**
   * @default {"deploy":false}
   */
  podMonitor?: Agentstackk8sHelmValuesMonitoringPodMonitor;
};

export type Agentstackk8sHelmValuesMonitoringPodMonitor = {
  /**
   * @default false
   */
  deploy?: boolean;
};

export type Agentstackk8sHelmValues = {
  /**
   * @default ""
   */
  agentToken?: string;
  /**
   * @default ""
   */
  agentStackSecret?: string;
  /**
   * @default {}
   */
  nodeSelector?: Agentstackk8sHelmValuesNodeSelector;
  /**
   * @default []
   */
  tolerations?: unknown[];
  /**
   * @default {}
   */
  config?: Agentstackk8sHelmValuesConfig;
  /**
   * @default {}
   */
  resources?: Agentstackk8sHelmValuesResources;
  /**
   * label app is reserved, user input label app is not allowed
   *
   * @default {}
   */
  labels?: Agentstackk8sHelmValuesLabels;
  /**
   * @default {}
   */
  annotations?: Agentstackk8sHelmValuesAnnotations;
  /**
   * secret name and namespace are reserved, user input secret name and namespace are not allowed
   *
   * @default {}
   */
  secretsMetadata?: Agentstackk8sHelmValuesSecretsMetadata;
  /**
   * serviceaccount name and namespace are reserved, user input serviceaccount name and namespace are not allowed
   *
   * @default {}
   */
  serviceAccountMetadata?: Agentstackk8sHelmValuesServiceAccountMetadata;
  /**
   * @default {"deployGrafanaDashboard":false,"podMonitor":{"deploy":false}}
   */
  monitoring?: Agentstackk8sHelmValuesMonitoring;
  /**
   * @default "ghcr.io/buildkite/agent-stack-k8s/controller:la..."
   */
  image?: string;
};

export type Agentstackk8sHelmParameters = {
  agentToken?: string;
  agentStackSecret?: string;
  tolerations?: string;
  "config.prometheus-port"?: string;
  "config.reservation-expiry-seconds"?: string;
  "config.enable-completion-watcher"?: string;
  "config.pod-pending-timeout"?: string;
  "config.image"?: string;
  "resources.requests.cpu"?: string;
  "resources.requests.memory"?: string;
  "monitoring.deployGrafanaDashboard"?: string;
  "monitoring.podMonitor.deploy"?: string;
  image?: string;
};
