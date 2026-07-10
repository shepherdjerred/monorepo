// Generated TypeScript types for dagger-helm Helm chart

export type DaggerhelmHelmValuesEngine = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Configuration using json should be the default choice, and will take
   * precedence over toml if both are provided, however you can use toml for
   * any settings that are not supported in the json format.
   * https://github.com/moby/buildkit/blob/5997099827e676c4b6ce5774c98ade2483e0afe7/cmd/buildkitd/config/config.go
   *
   * @default {}
   */
  annotations?: DaggerhelmHelmValuesEngineAnnotations;
  /**
   * @default {}
   */
  labels?: DaggerhelmHelmValuesEngineLabels;
  /**
   * `DaemonSet` guarantees a single Engine per K8s node (default behaviour)
   * Set to `StatefulSet` for running multiple Engines per K8s node
   *
   * @default "DaemonSet"
   */
  kind?: string;
  /**
   * StatefulSet specific configuration
   *
   * @default {"persistentVolumeClaimRetentionPolicy":{"whenDeleted":"Retain","whenScaled":"Retain"},"persistentVolumeClaim":{"enabled":false,"storageClassName":"","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"10Gi"}}},"podManagementPolicy":"OrderedReady"}
   */
  statefulSet?: DaggerhelmHelmValuesEngineStatefulSet;
  args?: unknown[];
  env?: unknown[];
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
  /**
   * @default {"pullPolicy":"IfNotPresent"}
   */
  image?: DaggerhelmHelmValuesEngineImage;
  imagePullSecrets?: unknown[];
  /**
   * Set priorityClassName to avoid eviction
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Set runtimeClassName to use a custom runtimeClass
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * Share process namespace with sidecars for monitoring and observability
   * Enables sidecar containers to see processes in the main engine container
   * Useful for monitoring tools like Datadog, security scanners, and log collectors
   *
   * @default false
   */
  shareProcessNamespace?: boolean;
  /**
   * @default {...} (6 keys)
   */
  readinessProbeSettings?: DaggerhelmHelmValuesEngineReadinessProbeSettings;
  /**
   * @default {...} (7 keys)
   */
  livenessProbeSettings?: DaggerhelmHelmValuesEngineLivenessProbeSettings;
  /**
   * The Engine may need to finish operations in flight, or sync its state to a remote destination.
   * We give it ample time by setting this value to 5 mins by default.
   * You may want to adjust this to fit your workloads so that the Engine stops quicker.
   *
   * @default 300
   */
  terminationGracePeriodSeconds?: number;
  /**
   * @default {"create":false,"annotations":[]}
   */
  newServiceAccount?: DaggerhelmHelmValuesEngineNewServiceAccount;
  /**
   * @default {}
   */
  existingServiceAccount?: DaggerhelmHelmValuesEngineExistingServiceAccount;
  /**
   * Configure lifecycle hooks for the Dagger Engine
   *
   * @default {"preStop":null}
   */
  lifecycle?: DaggerhelmHelmValuesEngineLifecycle;
  /**
   * @default {"dataVolume":{"enabled":true},"runVolume":{"enabled":true}}
   */
  hostPath?: DaggerhelmHelmValuesEngineHostPath;
  volumeMounts?: unknown[];
  volumes?: unknown[];
};

export type DaggerhelmHelmValuesEngineAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type DaggerhelmHelmValuesEngineLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type DaggerhelmHelmValuesEngineStatefulSet = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * PVC retention policy (applies to all PVCs)
   * Only available in Kubernetes 1.23+
   *
   * @default {"whenDeleted":"Retain","whenScaled":"Retain"}
   */
  persistentVolumeClaimRetentionPolicy?: DaggerhelmHelmValuesEngineStatefulSetPersistentVolumeClaimRetentionPolicy;
  /**
   * Use PersistentVolumeClaim for data volume
   *
   * @default {...} (4 keys)
   */
  persistentVolumeClaim?: DaggerhelmHelmValuesEngineStatefulSetPersistentVolumeClaim;
  /**
   * Controls how pods are created during initial scale up,
   * when replacing pods, and when scaling down.
   * Options: OrderedReady, Parallel (default: OrderedReady)
   *
   * @default "OrderedReady"
   */
  podManagementPolicy?: string;
};

export type DaggerhelmHelmValuesEngineStatefulSetPersistentVolumeClaimRetentionPolicy =
  {
    /**
     * This type allows arbitrary additional properties beyond those defined below.
     * This is common for config maps, custom settings, and extensible configurations.
     */
    [key: string]: unknown;
    /**
     * @default "Retain"
     */
    whenDeleted?: string;
    /**
     * @default "Retain"
     */
    whenScaled?: string;
  };

export type DaggerhelmHelmValuesEngineStatefulSetPersistentVolumeClaim = {
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
   * PVC specifications
   *
   * @default ""
   */
  storageClassName?: string;
  accessModes?: string[];
  /**
   * Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)
   */
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

export type DaggerhelmHelmValuesEngineImage = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Set a ref if you want to use a custom Dagger image
   * NOTE: you will need to ensure that a compatible dagger CLI is embedded in the image, otherwise readiness and liveness probes will fail
   * In the example below, we are configuring the latest, unreleased bleeding edge version
   * ref: registry.dagger.io/engine:main
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type DaggerhelmHelmValuesEngineReadinessProbeSettings = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"command":["sh","-exc","dagger core version"]}
   */
  exec?: DaggerhelmHelmValuesEngineReadinessProbeSettingsExec;
  /**
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * @default 14
   */
  timeoutSeconds?: number;
  /**
   * @default 15
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 10
   */
  failureThreshold?: number;
};

export type DaggerhelmHelmValuesEngineReadinessProbeSettingsExec = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  command?: string[];
};

export type DaggerhelmHelmValuesEngineLivenessProbeSettings = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"command":["sh","-exc","dagger core version"]}
   */
  exec?: DaggerhelmHelmValuesEngineLivenessProbeSettingsExec;
  /**
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * @default 29
   */
  timeoutSeconds?: number;
  /**
   * @default 30
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
   * @default 30
   */
  terminationGracePeriodSeconds?: number;
};

export type DaggerhelmHelmValuesEngineLivenessProbeSettingsExec = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  command?: string[];
};

export type DaggerhelmHelmValuesEngineNewServiceAccount = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default false
   */
  create?: boolean;
  annotations?: unknown[];
};

export type DaggerhelmHelmValuesEngineExistingServiceAccount = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type DaggerhelmHelmValuesEngineLifecycle = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  preStop?: unknown;
};

export type DaggerhelmHelmValuesEngineHostPath = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Use hostPath for data volume
   *
   * @default {"enabled":true}
   */
  dataVolume?: DaggerhelmHelmValuesEngineHostPathDataVolume;
  /**
   * Use hostPath for run volume
   *
   * @default {"enabled":true}
   */
  runVolume?: DaggerhelmHelmValuesEngineHostPathRunVolume;
};

export type DaggerhelmHelmValuesEngineHostPathDataVolume = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * When disabled, PVC will be used if configured above
   *
   * @default true
   */
  enabled?: boolean;
};

export type DaggerhelmHelmValuesEngineHostPathRunVolume = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * When disabled, no run volume will be mounted
   *
   * @default true
   */
  enabled?: boolean;
};

export type DaggerhelmHelmValuesMagicache = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "https://api.dagger.cloud/magicache"
   */
  url?: string;
};

export type DaggerhelmHelmValuesService = {
  /**
   * Kubernetes Service is created automatically when engine.port is defined
   * Service type (ClusterIP, NodePort, LoadBalancer)
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * Additional service annotations
   *
   * @default {}
   */
  annotations?: DaggerhelmHelmValuesServiceAnnotations;
  /**
   * Additional service labels
   *
   * @default {}
   */
  labels?: DaggerhelmHelmValuesServiceLabels;
};

export type DaggerhelmHelmValuesServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type DaggerhelmHelmValuesServiceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type DaggerhelmHelmValues = {
  /**
   * @default ""
   */
  nameOverride?: string;
  /**
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * @default {...} (21 keys)
   */
  engine?: DaggerhelmHelmValuesEngine;
  /**
   * Create your token via https://docs.dagger.io/manuals/user/cloud-get-started/#step-2-connect-to-dagger-cloud
   * If secretName is set, a new secret will NOT be created
   *
   * @default {"enabled":false,"url":"https://api.dagger.cloud/magicache"}
   */
  magicache?: DaggerhelmHelmValuesMagicache;
  /**
   * @default {"type":"ClusterIP","annotations":{},"labels":{}}
   */
  service?: DaggerhelmHelmValuesService;
};

export type DaggerhelmHelmParameters = {
  nameOverride?: string;
  fullnameOverride?: string;
  "engine.kind"?: string;
  "engine.statefulSet.persistentVolumeClaimRetentionPolicy.whenDeleted"?: string;
  "engine.statefulSet.persistentVolumeClaimRetentionPolicy.whenScaled"?: string;
  "engine.statefulSet.persistentVolumeClaim.enabled"?: string;
  "engine.statefulSet.persistentVolumeClaim.storageClassName"?: string;
  "engine.statefulSet.persistentVolumeClaim.accessModes"?: string;
  "engine.statefulSet.persistentVolumeClaim.resources"?: string;
  "engine.statefulSet.podManagementPolicy"?: string;
  "engine.args"?: string;
  "engine.env"?: string;
  "engine.resources"?: string;
  "engine.image.pullPolicy"?: string;
  "engine.imagePullSecrets"?: string;
  "engine.priorityClassName"?: string;
  "engine.runtimeClassName"?: string;
  "engine.shareProcessNamespace"?: string;
  "engine.readinessProbeSettings.exec.command"?: string;
  "engine.readinessProbeSettings.initialDelaySeconds"?: string;
  "engine.readinessProbeSettings.timeoutSeconds"?: string;
  "engine.readinessProbeSettings.periodSeconds"?: string;
  "engine.readinessProbeSettings.successThreshold"?: string;
  "engine.readinessProbeSettings.failureThreshold"?: string;
  "engine.livenessProbeSettings.exec.command"?: string;
  "engine.livenessProbeSettings.initialDelaySeconds"?: string;
  "engine.livenessProbeSettings.timeoutSeconds"?: string;
  "engine.livenessProbeSettings.periodSeconds"?: string;
  "engine.livenessProbeSettings.successThreshold"?: string;
  "engine.livenessProbeSettings.failureThreshold"?: string;
  "engine.livenessProbeSettings.terminationGracePeriodSeconds"?: string;
  "engine.terminationGracePeriodSeconds"?: string;
  "engine.newServiceAccount.create"?: string;
  "engine.newServiceAccount.annotations"?: string;
  "engine.lifecycle.preStop"?: string;
  "engine.hostPath.dataVolume.enabled"?: string;
  "engine.hostPath.runVolume.enabled"?: string;
  "engine.volumeMounts"?: string;
  "engine.volumes"?: string;
  "magicache.enabled"?: string;
  "magicache.url"?: string;
  "service.type"?: string;
};
