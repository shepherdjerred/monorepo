// Generated TypeScript types for intel-device-plugins-operator Helm chart

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

export type InteldevicepluginsoperatorHelmValues = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * @default {"image":{"hub":"intel","tag":"","pullPolicy":"IfNotPresent"},"devices":null}
   */
  manager?: InteldevicepluginsoperatorHelmValuesManager;
  /**
   * @default {"registryUrl":"","registryUser":"","registrySecret":""}
   */
  privateRegistry?: InteldevicepluginsoperatorHelmValuesPrivateRegistry;
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
};

export type InteldevicepluginsoperatorHelmParameters = {
  nodeSelector?: string;
  "manager.image.hub"?: string;
  "manager.image.tag"?: string;
  "manager.image.pullPolicy"?: string;
  "manager.devices"?: string;
  "privateRegistry.registryUrl"?: string;
  "privateRegistry.registryUser"?: string;
  "privateRegistry.registrySecret"?: string;
  resources?: string;
  tolerations?: string;
};
