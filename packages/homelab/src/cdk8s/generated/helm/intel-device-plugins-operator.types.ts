// Generated TypeScript types for intel-device-plugins-operator Helm chart

export type InteldevicepluginsoperatorHelmValuesNodeSelector = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "amd64"
   */
  "kubernetes.io/arch"?: string;
};

export type InteldevicepluginsoperatorHelmValuesManager = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"hub":"intel","tag":"","pullPolicy":"IfNotPresent"}
   */
  image?: InteldevicepluginsoperatorHelmValuesManagerImage;
  devices?: unknown;
};

export type InteldevicepluginsoperatorHelmValuesManagerImage = {
  /**
   * @default "intel"
   */
  hub?: string;
  /**
   * @default ""
   */
  tag?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type InteldevicepluginsoperatorHelmValuesPrivateRegistry = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default ""
   */
  registryUrl?: string;
  /**
   * @default ""
   */
  registryUser?: string;
  /**
   * @default ""
   */
  registrySecret?: string;
};

export type InteldevicepluginsoperatorHelmValuesResources = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"cpu":"100m","memory":"120Mi"}
   */
  limits?: InteldevicepluginsoperatorHelmValuesResourcesLimits;
  /**
   * @default {"cpu":"100m","memory":"100Mi"}
   */
  requests?: InteldevicepluginsoperatorHelmValuesResourcesRequests;
};

export type InteldevicepluginsoperatorHelmValuesResourcesLimits = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "120Mi"
   */
  memory?: string;
};

export type InteldevicepluginsoperatorHelmValuesResourcesRequests = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "100Mi"
   */
  memory?: string;
};

export type InteldevicepluginsoperatorHelmValues = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"kubernetes.io/arch":"amd64"}
   */
  nodeSelector?: InteldevicepluginsoperatorHelmValuesNodeSelector;
  /**
   * @default {"image":{"hub":"intel","tag":"","pullPolicy":"IfNotPresent"},"devices":null}
   */
  manager?: InteldevicepluginsoperatorHelmValuesManager;
  /**
   * @default {"registryUrl":"","registryUser":"","registrySecret":""}
   */
  privateRegistry?: InteldevicepluginsoperatorHelmValuesPrivateRegistry;
  /**
   * @default {"limits":{"cpu":"100m","memory":"120Mi"},"requests":{"cpu":"100m","memory":"100Mi"}}
   */
  resources?: InteldevicepluginsoperatorHelmValuesResources;
  tolerations?: unknown[];
};

export type InteldevicepluginsoperatorHelmParameters = {
  "nodeSelector.kubernetes.io/arch"?: string;
  "manager.image.hub"?: string;
  "manager.image.tag"?: string;
  "manager.image.pullPolicy"?: string;
  "manager.devices"?: string;
  "privateRegistry.registryUrl"?: string;
  "privateRegistry.registryUser"?: string;
  "privateRegistry.registrySecret"?: string;
  "resources.limits.cpu"?: string;
  "resources.limits.memory"?: string;
  "resources.requests.cpu"?: string;
  "resources.requests.memory"?: string;
  tolerations?: string;
};
