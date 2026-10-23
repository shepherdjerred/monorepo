// Generated TypeScript types for intel-device-plugins-gpu Helm chart

export type InteldevicepluginsgpuHelmValuesImage = {
  /**
   * @default "intel"
   */
  hub?: string;
  /**
   * @default ""
   */
  tag?: string;
};

export type InteldevicepluginsgpuHelmValuesInitImage = {
  /**
   * @default false
   */
  enable?: boolean;
  /**
   * @default "intel"
   */
  hub?: string;
  /**
   * @default ""
   */
  tag?: string;
};

export type InteldevicepluginsgpuHelmValues = {
  /**
   * @default "gpudeviceplugin-sample"
   */
  name?: string;
  /**
   * @default {"hub":"intel","tag":""}
   */
  image?: InteldevicepluginsgpuHelmValuesImage;
  /**
   * @default {"enable":false,"hub":"intel","tag":""}
   */
  initImage?: InteldevicepluginsgpuHelmValuesInitImage;
  /**
   * @default 1
   */
  sharedDevNum?: number;
  /**
   * @default 2
   */
  logLevel?: number;
  /**
   * @default true
   */
  enableMonitoring?: boolean;
  /**
   * @default "none"
   */
  allocationPolicy?: string;
  /**
   * @default ""
   */
  allowIDs?: string;
  /**
   * @default ""
   */
  denyIDs?: string;
  /**
   * @default "single"
   */
  bypathMode?: string;
  /**
   * @default "single"
   */
  monitoringMode?: string;
  /**
   * Kubernetes nodeSelector (arbitrary label key/value pairs)
   */
  nodeSelector?: Record<string, string>;
  /**
   * Kubernetes tolerations (standard Toleration objects)
   */
  tolerations?: unknown[];
  /**
   * @default true
   */
  nodeFeatureRule?: boolean;
};

export type InteldevicepluginsgpuHelmParameters = {
  name?: string;
  "image.hub"?: string;
  "image.tag"?: string;
  "initImage.enable"?: string;
  "initImage.hub"?: string;
  "initImage.tag"?: string;
  sharedDevNum?: string;
  logLevel?: string;
  enableMonitoring?: string;
  allocationPolicy?: string;
  allowIDs?: string;
  denyIDs?: string;
  bypathMode?: string;
  monitoringMode?: string;
  nodeSelector?: string;
  tolerations?: string;
  nodeFeatureRule?: string;
};
