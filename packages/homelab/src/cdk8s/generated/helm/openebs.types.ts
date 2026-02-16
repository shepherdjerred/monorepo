// Generated TypeScript types for openebs Helm chart

export type OpenebsHelmValuesOpenebscrds = {
  /**
   * @default {"volumeSnapshots":{"enabled":true,"keep":true}}
   */
  csi?: OpenebsHelmValuesOpenebscrdsCsi;
};

export type OpenebsHelmValuesOpenebscrdsCsi = {
  /**
   * @default {"enabled":true,"keep":true}
   */
  volumeSnapshots?: OpenebsHelmValuesOpenebscrdsCsiVolumeSnapshots;
};

export type OpenebsHelmValuesOpenebscrdsCsiVolumeSnapshots = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default true
   */
  keep?: boolean;
};

export type OpenebsHelmValuesLocalpvprovisioner = {
  /**
   * @default {"create":true}
   */
  rbac?: OpenebsHelmValuesLocalpvprovisionerRbac;
};

export type OpenebsHelmValuesLocalpvprovisionerRbac = {
  /**
   * @default true
   */
  create?: boolean;
};

export type OpenebsHelmValuesZfslocalpv = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"zfsLocalPv":{"enabled":true},"csi":{"volumeSnapshots":{"enabled":false}}}
   */
  crds?: OpenebsHelmValuesZfslocalpvCrds;
};

export type OpenebsHelmValuesZfslocalpvCrds = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"enabled":true}
   */
  zfsLocalPv?: OpenebsHelmValuesZfslocalpvCrdsZfsLocalPv;
  /**
   * @default {"volumeSnapshots":{"enabled":false}}
   */
  csi?: OpenebsHelmValuesZfslocalpvCrdsCsi;
};

export type OpenebsHelmValuesZfslocalpvCrdsZfsLocalPv = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default true
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesZfslocalpvCrdsCsi = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {"enabled":false}
   */
  volumeSnapshots?: OpenebsHelmValuesZfslocalpvCrdsCsiVolumeSnapshots;
};

export type OpenebsHelmValuesZfslocalpvCrdsCsiVolumeSnapshots = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesLvmlocalpv = {
  /**
   * @default {"lvmLocalPv":{"enabled":true},"csi":{"volumeSnapshots":{"enabled":false}}}
   */
  crds?: OpenebsHelmValuesLvmlocalpvCrds;
};

export type OpenebsHelmValuesLvmlocalpvCrds = {
  /**
   * @default {"enabled":true}
   */
  lvmLocalPv?: OpenebsHelmValuesLvmlocalpvCrdsLvmLocalPv;
  /**
   * @default {"volumeSnapshots":{"enabled":false}}
   */
  csi?: OpenebsHelmValuesLvmlocalpvCrdsCsi;
};

export type OpenebsHelmValuesLvmlocalpvCrdsLvmLocalPv = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesLvmlocalpvCrdsCsi = {
  /**
   * @default {"enabled":false}
   */
  volumeSnapshots?: OpenebsHelmValuesLvmlocalpvCrdsCsiVolumeSnapshots;
};

export type OpenebsHelmValuesLvmlocalpvCrdsCsiVolumeSnapshots = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesRawfilelocalpv = {
  /**
   * @default {"csi":{"volumeSnapshots":{"enabled":false}}}
   */
  crds?: OpenebsHelmValuesRawfilelocalpvCrds;
};

export type OpenebsHelmValuesRawfilelocalpvCrds = {
  /**
   * @default {"volumeSnapshots":{"enabled":false}}
   */
  csi?: OpenebsHelmValuesRawfilelocalpvCrdsCsi;
};

export type OpenebsHelmValuesRawfilelocalpvCrdsCsi = {
  /**
   * @default {"enabled":false}
   */
  volumeSnapshots?: OpenebsHelmValuesRawfilelocalpvCrdsCsiVolumeSnapshots;
};

export type OpenebsHelmValuesRawfilelocalpvCrdsCsiVolumeSnapshots = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesMayastor = {
  /**
   * @default {"node":{"initContainers":{"enabled":true}}}
   */
  csi?: OpenebsHelmValuesMayastorCsi;
  /**
   * @default {"clusterDomain":"cluster.local"}
   */
  etcd?: OpenebsHelmValuesMayastorEtcd;
  /**
   * @default {"enabled":false}
   */
  "localpv-provisioner"?: OpenebsHelmValuesMayastorLocalpvprovisioner;
  /**
   * @default {"enabled":false}
   */
  crds?: OpenebsHelmValuesMayastorCrds;
  /**
   * @default {"enabled":false}
   */
  loki?: OpenebsHelmValuesMayastorLoki;
  /**
   * @default {"enabled":false}
   */
  alloy?: OpenebsHelmValuesMayastorAlloy;
};

export type OpenebsHelmValuesMayastorCsi = {
  /**
   * @default {"initContainers":{"enabled":true}}
   */
  node?: OpenebsHelmValuesMayastorCsiNode;
};

export type OpenebsHelmValuesMayastorCsiNode = {
  /**
   * @default {"enabled":true}
   */
  initContainers?: OpenebsHelmValuesMayastorCsiNodeInitContainers;
};

export type OpenebsHelmValuesMayastorCsiNodeInitContainers = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesMayastorEtcd = {
  /**
   * Kubernetes Cluster Domain
   *
   * @default "cluster.local"
   */
  clusterDomain?: string;
};

export type OpenebsHelmValuesMayastorLocalpvprovisioner = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesMayastorCrds = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesMayastorLoki = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesMayastorAlloy = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesPreUpgradeHook = {
  /**
   * Enable/Disable openebs pre-upgrade hook
   *
   * @default true
   */
  enabled?: boolean;
  tolerations?: unknown[];
  imagePullSecrets?: unknown[];
  /**
   * Labels to be added to the pod hook job
   *
   * @default {"openebs.io/logging":"true"}
   */
  podLabels?: OpenebsHelmValuesPreUpgradeHookPodLabels;
  /**
   * This helps in debugging by leaving the Job/Pod instances lying around
   *
   * @default {"helm.sh/hook-delete-policy":"hook-succeeded,before-hook-creation"}
   */
  annotations?: OpenebsHelmValuesPreUpgradeHookAnnotations;
  /**
   * @default {...} (4 keys)
   */
  image?: OpenebsHelmValuesPreUpgradeHookImage;
};

export type OpenebsHelmValuesPreUpgradeHookPodLabels = {
  /**
   * @default "true"
   */
  "openebs.io/logging"?: boolean;
};

export type OpenebsHelmValuesPreUpgradeHookAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "hook-succeeded,before-hook-creation"
   */
  "helm.sh/hook-delete-policy"?: string;
};

export type OpenebsHelmValuesPreUpgradeHookImage = {
  /**
   * The container image registry URL for the hook job
   *
   * @default "docker.io"
   */
  registry?: string;
  /**
   * The container repository for the hook job
   *
   * @default "openebs/kubectl"
   */
  repo?: string;
  /**
   * The container image tag for the hook job
   *
   * @default "1.25.15"
   */
  tag?: string;
  /**
   * The imagePullPolicy for the container
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type OpenebsHelmValuesEngines = {
  /**
   * @default {"lvm":{"enabled":true},"zfs":{"enabled":true},"rawfile":{"enabled":false}}
   */
  local?: OpenebsHelmValuesEnginesLocal;
  /**
   * @default {"mayastor":{"enabled":true}}
   */
  replicated?: OpenebsHelmValuesEnginesReplicated;
};

export type OpenebsHelmValuesEnginesLocal = {
  /**
   * @default {"enabled":true}
   */
  lvm?: OpenebsHelmValuesEnginesLocalLvm;
  /**
   * @default {"enabled":true}
   */
  zfs?: OpenebsHelmValuesEnginesLocalZfs;
  /**
   * @default {"enabled":false}
   */
  rawfile?: OpenebsHelmValuesEnginesLocalRawfile;
};

export type OpenebsHelmValuesEnginesLocalLvm = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesEnginesLocalZfs = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesEnginesLocalRawfile = {
  /**
   * Disabled by default since rawfile is not marked as stable yet.
   *
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesEnginesReplicated = {
  /**
   * @default {"enabled":true}
   */
  mayastor?: OpenebsHelmValuesEnginesReplicatedMayastor;
};

export type OpenebsHelmValuesEnginesReplicatedMayastor = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesLoki = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * Configuration for loki's localpv hostpath storage class.
   *
   * @default {"enabled":true,"loki":{"name":"openebs-loki-localpv","basePath":"/var/local/{{ .Release.Name }}/localpv-hostpath/loki","reclaimPolicy":"Delete","volumeBindingMode":"WaitForFirstConsumer"},"minio":{"name":"openebs-minio-localpv","basePath":"/var/local/{{ .Release.Name }}/localpv-hostpath/minio","reclaimPolicy":"Delete","volumeBindingMode":"WaitForFirstConsumer"}}
   */
  localpvScConfig?: OpenebsHelmValuesLokiLocalpvScConfig;
  /**
   * @default {...} (8 keys)
   */
  loki?: OpenebsHelmValuesLokiLoki;
  /**
   * @default {"replicas":3,"drivesPerNode":1,"persistence":{"enabled":true,"storageClass":"openebs-loki-localpv","accessModes":["ReadWriteOnce"],"size":"2Gi"}}
   */
  singleBinary?: OpenebsHelmValuesLokiSingleBinary;
  /**
   * @default {...} (5 keys)
   */
  minio?: OpenebsHelmValuesLokiMinio;
  /**
   * @default "SingleBinary"
   */
  deploymentMode?: string;
  /**
   * @default {"enabled":false}
   */
  lokiCanary?: OpenebsHelmValuesLokiLokiCanary;
  /**
   * @default {"enabled":false}
   */
  chunksCache?: OpenebsHelmValuesLokiChunksCache;
  /**
   * @default {"enabled":false}
   */
  test?: OpenebsHelmValuesLokiTest;
  /**
   * @default {"enabled":false}
   */
  gateway?: OpenebsHelmValuesLokiGateway;
  /**
   * @default {"enabled":false}
   */
  resultsCache?: OpenebsHelmValuesLokiResultsCache;
  /**
   * @default {"replicas":0}
   */
  backend?: OpenebsHelmValuesLokiBackend;
  /**
   * @default {"replicas":0}
   */
  read?: OpenebsHelmValuesLokiRead;
  /**
   * @default {"replicas":0}
   */
  write?: OpenebsHelmValuesLokiWrite;
  /**
   * @default {"replicas":0}
   */
  ingester?: OpenebsHelmValuesLokiIngester;
  /**
   * @default {"replicas":0}
   */
  querier?: OpenebsHelmValuesLokiQuerier;
  /**
   * @default {"replicas":0}
   */
  queryFrontend?: OpenebsHelmValuesLokiQueryFrontend;
  /**
   * @default {"replicas":0}
   */
  queryScheduler?: OpenebsHelmValuesLokiQueryScheduler;
  /**
   * @default {"replicas":0}
   */
  distributor?: OpenebsHelmValuesLokiDistributor;
  /**
   * @default {"replicas":0}
   */
  compactor?: OpenebsHelmValuesLokiCompactor;
  /**
   * @default {"replicas":0}
   */
  indexGateway?: OpenebsHelmValuesLokiIndexGateway;
  /**
   * @default {"replicas":0}
   */
  bloomCompactor?: OpenebsHelmValuesLokiBloomCompactor;
  /**
   * @default {"replicas":0}
   */
  bloomGateway?: OpenebsHelmValuesLokiBloomGateway;
  /**
   * @default {"image":{"repository":"docker.io/kiwigrid/k8s-sidecar"}}
   */
  sidecar?: OpenebsHelmValuesLokiSidecar;
};

export type OpenebsHelmValuesLokiLocalpvScConfig = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {...} (4 keys)
   */
  loki?: OpenebsHelmValuesLokiLocalpvScConfigLoki;
  /**
   * @default {...} (4 keys)
   */
  minio?: OpenebsHelmValuesLokiLocalpvScConfigMinio;
};

export type OpenebsHelmValuesLokiLocalpvScConfigLoki = {
  /**
   * Name of loki's localpv hostpath storage class.
   *
   * @default "openebs-loki-localpv"
   */
  name?: string;
  /**
   * Host path where local loki data is stored in.
   *
   * @default "/var/local/{{ .Release.Name }}/localpv-hostpath..."
   */
  basePath?: string;
  /**
   * ReclaimPolicy of loki's localpv hostpath storage class.
   *
   * @default "Delete"
   */
  reclaimPolicy?: string;
  /**
   * VolumeBindingMode of loki's localpv hostpath storage class.
   *
   * @default "WaitForFirstConsumer"
   */
  volumeBindingMode?: string;
};

export type OpenebsHelmValuesLokiLocalpvScConfigMinio = {
  /**
   * Name of minio's localpv hostpath storage class.
   *
   * @default "openebs-minio-localpv"
   */
  name?: string;
  /**
   * Host path where local minio data is stored in.
   *
   * @default "/var/local/{{ .Release.Name }}/localpv-hostpath..."
   */
  basePath?: string;
  /**
   * ReclaimPolicy of minio's localpv hostpath storage class.
   *
   * @default "Delete"
   */
  reclaimPolicy?: string;
  /**
   * VolumeBindingMode of minio's localpv hostpath storage class.
   *
   * @default "WaitForFirstConsumer"
   */
  volumeBindingMode?: string;
};

export type OpenebsHelmValuesLokiLoki = {
  /**
   * @default {"app":"loki"}
   */
  serviceLabels?: OpenebsHelmValuesLokiLokiServiceLabels;
  /**
   * @default {"app":"loki"}
   */
  podLabels?: OpenebsHelmValuesLokiLokiPodLabels;
  /**
   * @default {"configs":[{"from":"2024-04-01","store":"tsdb","object_store":"s3","schema":"v13","index":{"prefix":"loki_index_","period":"24h"}}]}
   */
  schemaConfig?: OpenebsHelmValuesLokiLokiSchemaConfig;
  /**
   * @default {"replication_factor":3}
   */
  commonConfig?: OpenebsHelmValuesLokiLokiCommonConfig;
  /**
   * @default {"chunk_encoding":"snappy"}
   */
  ingester?: OpenebsHelmValuesLokiLokiIngester;
  /**
   * @default {"enabled":true}
   */
  tracing?: OpenebsHelmValuesLokiLokiTracing;
  /**
   * @default {"max_concurrent":1}
   */
  querier?: OpenebsHelmValuesLokiLokiQuerier;
  /**
   * @default {"ingestion_burst_size_mb":1000,"ingestion_rate_mb":10000,"max_label_names_per_series":20}
   */
  limits_config?: OpenebsHelmValuesLokiLokiLimitsconfig;
};

export type OpenebsHelmValuesLokiLokiServiceLabels = {
  /**
   * @default "loki"
   */
  app?: string;
};

export type OpenebsHelmValuesLokiLokiPodLabels = {
  /**
   * @default "loki"
   */
  app?: string;
};

export type OpenebsHelmValuesLokiLokiSchemaConfig = {
  configs?: OpenebsHelmValuesLokiLokiSchemaConfigConfigsElement[];
};

export type OpenebsHelmValuesLokiLokiSchemaConfigConfigsElement = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "2024-04-01"
   */
  from?: string;
  /**
   * @default "tsdb"
   */
  store?: string;
  /**
   * @default "s3"
   */
  object_store?: string;
  /**
   * @default "v13"
   */
  schema?: string;
  /**
   * @default {"prefix":"loki_index_","period":"24h"}
   */
  index?: OpenebsHelmValuesLokiLokiSchemaConfigConfigsIndex;
};

export type OpenebsHelmValuesLokiLokiSchemaConfigConfigsIndex = {
  /**
   * @default "loki_index_"
   */
  prefix?: string;
  /**
   * @default "24h"
   */
  period?: string;
};

export type OpenebsHelmValuesLokiLokiCommonConfig = {
  /**
   * @default 3
   */
  replication_factor?: number;
};

export type OpenebsHelmValuesLokiLokiIngester = {
  /**
   * @default "snappy"
   */
  chunk_encoding?: string;
};

export type OpenebsHelmValuesLokiLokiTracing = {
  /**
   * @default true
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesLokiLokiQuerier = {
  /**
   * @default 1
   */
  max_concurrent?: number;
};

export type OpenebsHelmValuesLokiLokiLimitsconfig = {
  /**
   * @default 1000
   */
  ingestion_burst_size_mb?: number;
  /**
   * @default 10000
   */
  ingestion_rate_mb?: number;
  /**
   * @default 20
   */
  max_label_names_per_series?: number;
};

export type OpenebsHelmValuesLokiSingleBinary = {
  /**
   * @default 3
   */
  replicas?: number;
  /**
   * @default 1
   */
  drivesPerNode?: number;
  /**
   * @default {...} (4 keys)
   */
  persistence?: OpenebsHelmValuesLokiSingleBinaryPersistence;
};

export type OpenebsHelmValuesLokiSingleBinaryPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enabled persistence for loki
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Storage class for loki storage
   *
   * @default "openebs-loki-localpv"
   */
  storageClass?: string;
  accessModes?: string[];
  /**
   * Size of loki local storage volume
   *
   * @default "2Gi"
   */
  size?: string;
};

export type OpenebsHelmValuesLokiMinio = {
  /**
   * @default 3
   */
  replicas?: number;
  /**
   * @default 1
   */
  drivesPerNode?: number;
  /**
   * @default "distributed"
   */
  mode?: string;
  /**
   * Disable this if you want to enabled external s3 bucket, and uncomment the storage section above.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"enabled":true,"storageClass":"openebs-minio-localpv","size":"2Gi"}
   */
  persistence?: OpenebsHelmValuesLokiMinioPersistence;
};

export type OpenebsHelmValuesLokiMinioPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enabled persistence for minio
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Storage class for minio storage
   *
   * @default "openebs-minio-localpv"
   */
  storageClass?: string;
  /**
   * Size of minio local storage volume
   *
   * @default "2Gi"
   */
  size?: string;
};

export type OpenebsHelmValuesLokiLokiCanary = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesLokiChunksCache = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesLokiTest = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesLokiGateway = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesLokiResultsCache = {
  /**
   * @default false
   */
  enabled?: boolean;
};

export type OpenebsHelmValuesLokiBackend = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiRead = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiWrite = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiIngester = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiQuerier = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiQueryFrontend = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiQueryScheduler = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiDistributor = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiCompactor = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiIndexGateway = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiBloomCompactor = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiBloomGateway = {
  /**
   * @default 0
   */
  replicas?: number;
};

export type OpenebsHelmValuesLokiSidecar = {
  /**
   * @default {"repository":"docker.io/kiwigrid/k8s-sidecar"}
   */
  image?: OpenebsHelmValuesLokiSidecarImage;
};

export type OpenebsHelmValuesLokiSidecarImage = {
  /**
   * @default "docker.io/kiwigrid/k8s-sidecar"
   */
  repository?: string;
};

export type OpenebsHelmValuesAlloy = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {"debugging":false,"labels":{"openebs.io/logging":true},"tenant_id":"openebs"}
   */
  logging_config?: OpenebsHelmValuesAlloyLoggingconfig;
  /**
   * @default {"mounts":{"varlog":true},"configMap":{"create":true,"content":"{{- $releaseName := .Release.Name | replace \"-\" \"_\" -}}\n\nlivedebugging {\n  enabled = {{ .Values.logging_config.debugging }}\n}\n\ndiscovery.kubernetes \"{{ $releaseName }}_pods_name\" {\n  role = \"pod\"\n}\n\ndiscovery.relabel \"{{ $releaseName }}_pods_name\" {\n  targets = discovery.kubernetes.{{ $releaseName }}_pods_name.targets\n\n  {{- $labels := .Values.logging_config.labels }}\n  {{- if $labels }}\n  {{- $keys := (keys $labels | sortAlpha) }}\n\n  rule {\n    source_labels = [\n      {{- range $key := $keys }}\n      \"__meta_kubernetes_pod_label_{{ $key | replace \".\" \"_\" | replace \"/\" \"_\" }}\",\n      {{- end }}\n    ]\n    separator     = \";\"\n    regex         = \"^{{ include \"regex_or\" (dict \"labels\" $labels \"keys\" $keys) }}$\"\n    action        = \"keep\"\n  }\n\n  {{- end }}\n\n  rule {\n    regex  = \"__meta_kubernetes_pod_label_(.+)\"\n    action = \"labelmap\"\n  }\n\n  rule {\n    regex  = \"__meta_kubernetes_pod_label_(.+)\"\n    action = \"labelmap\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_namespace\"]\n    separator     = \"/\"\n    target_label  = \"job\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_name\"]\n    target_label  = \"pod\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_container_name\"]\n    target_label  = \"container\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_node_name\"]\n    target_label  = \"hostname\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_uid\", \"__meta_kubernetes_pod_container_name\"]\n    separator     = \"/\"\n    target_label  = \"__path__\"\n    replacement   = \"/var/log/pods/*$1/*.log\"\n  }\n}\n\nlocal.file_match \"{{ $releaseName }}_pod_files\" {\n  path_targets = discovery.relabel.{{ $releaseName }}_pods_name.output\n}\n\nloki.source.file \"{{ $releaseName }}_pod_logs\" {\n  targets    = local.file_match.{{ $releaseName }}_pod_files.targets\n  forward_to = [loki.process.{{ $releaseName }}_process_logs.receiver]\n}\n\nloki.process \"{{ $releaseName }}_process_logs\" {\n  forward_to = [loki.write.default.receiver]\n\n  stage.docker { }\n\n  stage.replace {\n    expression = \"(\\\\n)\"\n    replace = \"\"\n  }\n\n  stage.multiline {\n    firstline = \"^  \\\\x1b\\\\[2m(\\\\d{4})-(\\\\d{2})-(\\\\d{2})T(\\\\d{2}):(\\\\d{2}):(\\\\d{2}).(\\\\d{6})Z\"\n  }\n\n  stage.multiline {\n    firstline = \"^  (\\\\d{4})-(\\\\d{2})-(\\\\d{2})T(\\\\d{2}):(\\\\d{2}):(\\\\d{2}).(\\\\d{6})Z\"\n  }\n}\n\nloki.write \"default\" {\n    endpoint {\n    url       = \"http://{{ .Release.Name }}-loki:3100/loki/api/v1/push\"\n    tenant_id = \"{{ .Values.logging_config.tenant_id }}\"\n  }\n  external_labels = {}\n}\n\n{{- define \"regex_or\" -}}\n{{- $labels := .labels -}}\n{{- $keys := .keys -}}\n{{- $numKeys := len $keys -}}\n{{- $regexParts := list -}}\n{{- range $i, $key := $keys -}}\n{{- $part := list -}}\n{{- range $j := until $numKeys -}}\n{{- if eq $j $i -}}\n{{- $part = append $part (get $labels $key) -}}\n{{- else -}}\n{{- $part = append $part \".*\" -}}\n{{- end -}}\n{{- end -}}\n{{- $regexParts = append $regexParts (join \";\" $part) -}}\n{{- end -}}\n{{- join \"|\" $regexParts -}}\n{{- end -}}\n"}}
   */
  alloy?: OpenebsHelmValuesAlloyAlloy;
};

export type OpenebsHelmValuesAlloyLoggingconfig = {
  /**
   * Enable debugging on alloy components.
   *
   * @default false
   */
  debugging?: boolean;
  /**
   * Labels to enable scraping on, at-least one of these labels should be present.
   *
   * @default {"openebs.io/logging":true}
   */
  labels?: OpenebsHelmValuesAlloyLoggingconfigLabels;
  /**
   * X-Scope-OrgID to pe populated which pushing logs. Make sure the caller also uses the same.
   *
   * @default "openebs"
   */
  tenant_id?: string;
};

export type OpenebsHelmValuesAlloyLoggingconfigLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default true
   */
  "openebs.io/logging"?: boolean;
};

export type OpenebsHelmValuesAlloyAlloy = {
  /**
   * @default {"varlog":true}
   */
  mounts?: OpenebsHelmValuesAlloyAlloyMounts;
  /**
   * @default {"create":true,"content":"{{- $releaseName := .Release.Name | replace \"-\" \"_\" -}}\n\nlivedebugging {\n  enabled = {{ .Values.logging_config.debugging }}\n}\n\ndiscovery.kubernetes \"{{ $releaseName }}_pods_name\" {\n  role = \"pod\"\n}\n\ndiscovery.relabel \"{{ $releaseName }}_pods_name\" {\n  targets = discovery.kubernetes.{{ $releaseName }}_pods_name.targets\n\n  {{- $labels := .Values.logging_config.labels }}\n  {{- if $labels }}\n  {{- $keys := (keys $labels | sortAlpha) }}\n\n  rule {\n    source_labels = [\n      {{- range $key := $keys }}\n      \"__meta_kubernetes_pod_label_{{ $key | replace \".\" \"_\" | replace \"/\" \"_\" }}\",\n      {{- end }}\n    ]\n    separator     = \";\"\n    regex         = \"^{{ include \"regex_or\" (dict \"labels\" $labels \"keys\" $keys) }}$\"\n    action        = \"keep\"\n  }\n\n  {{- end }}\n\n  rule {\n    regex  = \"__meta_kubernetes_pod_label_(.+)\"\n    action = \"labelmap\"\n  }\n\n  rule {\n    regex  = \"__meta_kubernetes_pod_label_(.+)\"\n    action = \"labelmap\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_namespace\"]\n    separator     = \"/\"\n    target_label  = \"job\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_name\"]\n    target_label  = \"pod\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_container_name\"]\n    target_label  = \"container\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_node_name\"]\n    target_label  = \"hostname\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_uid\", \"__meta_kubernetes_pod_container_name\"]\n    separator     = \"/\"\n    target_label  = \"__path__\"\n    replacement   = \"/var/log/pods/*$1/*.log\"\n  }\n}\n\nlocal.file_match \"{{ $releaseName }}_pod_files\" {\n  path_targets = discovery.relabel.{{ $releaseName }}_pods_name.output\n}\n\nloki.source.file \"{{ $releaseName }}_pod_logs\" {\n  targets    = local.file_match.{{ $releaseName }}_pod_files.targets\n  forward_to = [loki.process.{{ $releaseName }}_process_logs.receiver]\n}\n\nloki.process \"{{ $releaseName }}_process_logs\" {\n  forward_to = [loki.write.default.receiver]\n\n  stage.docker { }\n\n  stage.replace {\n    expression = \"(\\\\n)\"\n    replace = \"\"\n  }\n\n  stage.multiline {\n    firstline = \"^  \\\\x1b\\\\[2m(\\\\d{4})-(\\\\d{2})-(\\\\d{2})T(\\\\d{2}):(\\\\d{2}):(\\\\d{2}).(\\\\d{6})Z\"\n  }\n\n  stage.multiline {\n    firstline = \"^  (\\\\d{4})-(\\\\d{2})-(\\\\d{2})T(\\\\d{2}):(\\\\d{2}):(\\\\d{2}).(\\\\d{6})Z\"\n  }\n}\n\nloki.write \"default\" {\n    endpoint {\n    url       = \"http://{{ .Release.Name }}-loki:3100/loki/api/v1/push\"\n    tenant_id = \"{{ .Values.logging_config.tenant_id }}\"\n  }\n  external_labels = {}\n}\n\n{{- define \"regex_or\" -}}\n{{- $labels := .labels -}}\n{{- $keys := .keys -}}\n{{- $numKeys := len $keys -}}\n{{- $regexParts := list -}}\n{{- range $i, $key := $keys -}}\n{{- $part := list -}}\n{{- range $j := until $numKeys -}}\n{{- if eq $j $i -}}\n{{- $part = append $part (get $labels $key) -}}\n{{- else -}}\n{{- $part = append $part \".*\" -}}\n{{- end -}}\n{{- end -}}\n{{- $regexParts = append $regexParts (join \";\" $part) -}}\n{{- end -}}\n{{- join \"|\" $regexParts -}}\n{{- end -}}\n"}
   */
  configMap?: OpenebsHelmValuesAlloyAlloyConfigMap;
};

export type OpenebsHelmValuesAlloyAlloyMounts = {
  /**
   * @default true
   */
  varlog?: boolean;
};

export type OpenebsHelmValuesAlloyAlloyConfigMap = {
  /**
   * @default true
   */
  create?: boolean;
  /**
   * @default "{{- $releaseName := .Release.Name | replace "-"..."
   */
  content?: string;
};

export type OpenebsHelmValues = {
  /**
   * @default {"csi":{"volumeSnapshots":{"enabled":true,"keep":true}}}
   */
  "openebs-crds"?: OpenebsHelmValuesOpenebscrds;
  /**
   * Refer to https://github.com/openebs/dynamic-localpv-provisioner/blob/v4.2.0/deploy/helm/charts/values.yaml for complete set of values.
   *
   * @default {"rbac":{"create":true}}
   */
  "localpv-provisioner"?: OpenebsHelmValuesLocalpvprovisioner;
  /**
   * Refer to https://github.com/openebs/zfs-localpv/blob/v2.7.1/deploy/helm/charts/values.yaml for complete set of values.
   *
   * @default {"crds":{"zfsLocalPv":{"enabled":true},"csi":{"volumeSnapshots":{"enabled":false}}}}
   */
  "zfs-localpv"?: OpenebsHelmValuesZfslocalpv;
  /**
   * Refer to https://github.com/openebs/lvm-localpv/blob/lvm-localpv-1.6.2/deploy/helm/charts/values.yaml for complete set of values.
   *
   * @default {"crds":{"lvmLocalPv":{"enabled":true},"csi":{"volumeSnapshots":{"enabled":false}}}}
   */
  "lvm-localpv"?: OpenebsHelmValuesLvmlocalpv;
  /**
   * Refer to https://github.com/openebs/rawfile-localpv/blob/v0.11.0/deploy/helm/rawfile-localpv/values.yaml for complete set of values.
   *
   * @default {"crds":{"csi":{"volumeSnapshots":{"enabled":false}}}}
   */
  "rawfile-localpv"?: OpenebsHelmValuesRawfilelocalpv;
  /**
   * Refer to https://github.com/openebs/mayastor-extensions/blob/v2.8.0/chart/values.yaml for complete set of values.
   *
   * @default {...} (6 keys)
   */
  mayastor?: OpenebsHelmValuesMayastor;
  /**
   * This runs only for upgrades from openebs v3 to v4. Uses the localpv-provisioner deployment to decide if it's v3 or v4.
   *
   * @default {...} (6 keys)
   */
  preUpgradeHook?: OpenebsHelmValuesPreUpgradeHook;
  /**
   * @default {"local":{"lvm":{"enabled":true},"zfs":{"enabled":true},"rawfile":{"enabled":false}},"replicated":{"mayastor":{"enabled":true}}}
   */
  engines?: OpenebsHelmValuesEngines;
  /**
   * @default {...} (24 keys)
   */
  loki?: OpenebsHelmValuesLoki;
  /**
   * @default {"enabled":true,"logging_config":{"debugging":false,"labels":{"openebs.io/logging":true},"tenant_id":"openebs"},"alloy":{"mounts":{"varlog":true},"configMap":{"create":true,"content":"{{- $releaseName := .Release.Name | replace \"-\" \"_\" -}}\n\nlivedebugging {\n  enabled = {{ .Values.logging_config.debugging }}\n}\n\ndiscovery.kubernetes \"{{ $releaseName }}_pods_name\" {\n  role = \"pod\"\n}\n\ndiscovery.relabel \"{{ $releaseName }}_pods_name\" {\n  targets = discovery.kubernetes.{{ $releaseName }}_pods_name.targets\n\n  {{- $labels := .Values.logging_config.labels }}\n  {{- if $labels }}\n  {{- $keys := (keys $labels | sortAlpha) }}\n\n  rule {\n    source_labels = [\n      {{- range $key := $keys }}\n      \"__meta_kubernetes_pod_label_{{ $key | replace \".\" \"_\" | replace \"/\" \"_\" }}\",\n      {{- end }}\n    ]\n    separator     = \";\"\n    regex         = \"^{{ include \"regex_or\" (dict \"labels\" $labels \"keys\" $keys) }}$\"\n    action        = \"keep\"\n  }\n\n  {{- end }}\n\n  rule {\n    regex  = \"__meta_kubernetes_pod_label_(.+)\"\n    action = \"labelmap\"\n  }\n\n  rule {\n    regex  = \"__meta_kubernetes_pod_label_(.+)\"\n    action = \"labelmap\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_namespace\"]\n    separator     = \"/\"\n    target_label  = \"job\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_name\"]\n    target_label  = \"pod\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_container_name\"]\n    target_label  = \"container\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_node_name\"]\n    target_label  = \"hostname\"\n  }\n\n  rule {\n    source_labels = [\"__meta_kubernetes_pod_uid\", \"__meta_kubernetes_pod_container_name\"]\n    separator     = \"/\"\n    target_label  = \"__path__\"\n    replacement   = \"/var/log/pods/*$1/*.log\"\n  }\n}\n\nlocal.file_match \"{{ $releaseName }}_pod_files\" {\n  path_targets = discovery.relabel.{{ $releaseName }}_pods_name.output\n}\n\nloki.source.file \"{{ $releaseName }}_pod_logs\" {\n  targets    = local.file_match.{{ $releaseName }}_pod_files.targets\n  forward_to = [loki.process.{{ $releaseName }}_process_logs.receiver]\n}\n\nloki.process \"{{ $releaseName }}_process_logs\" {\n  forward_to = [loki.write.default.receiver]\n\n  stage.docker { }\n\n  stage.replace {\n    expression = \"(\\\\n)\"\n    replace = \"\"\n  }\n\n  stage.multiline {\n    firstline = \"^  \\\\x1b\\\\[2m(\\\\d{4})-(\\\\d{2})-(\\\\d{2})T(\\\\d{2}):(\\\\d{2}):(\\\\d{2}).(\\\\d{6})Z\"\n  }\n\n  stage.multiline {\n    firstline = \"^  (\\\\d{4})-(\\\\d{2})-(\\\\d{2})T(\\\\d{2}):(\\\\d{2}):(\\\\d{2}).(\\\\d{6})Z\"\n  }\n}\n\nloki.write \"default\" {\n    endpoint {\n    url       = \"http://{{ .Release.Name }}-loki:3100/loki/api/v1/push\"\n    tenant_id = \"{{ .Values.logging_config.tenant_id }}\"\n  }\n  external_labels = {}\n}\n\n{{- define \"regex_or\" -}}\n{{- $labels := .labels -}}\n{{- $keys := .keys -}}\n{{- $numKeys := len $keys -}}\n{{- $regexParts := list -}}\n{{- range $i, $key := $keys -}}\n{{- $part := list -}}\n{{- range $j := until $numKeys -}}\n{{- if eq $j $i -}}\n{{- $part = append $part (get $labels $key) -}}\n{{- else -}}\n{{- $part = append $part \".*\" -}}\n{{- end -}}\n{{- end -}}\n{{- $regexParts = append $regexParts (join \";\" $part) -}}\n{{- end -}}\n{{- join \"|\" $regexParts -}}\n{{- end -}}\n"}}}
   */
  alloy?: OpenebsHelmValuesAlloy;
};

export type OpenebsHelmParameters = {
  "openebs-crds.csi.volumeSnapshots.enabled"?: string;
  "openebs-crds.csi.volumeSnapshots.keep"?: string;
  "localpv-provisioner.rbac.create"?: string;
  "zfs-localpv.crds.zfsLocalPv.enabled"?: string;
  "zfs-localpv.crds.csi.volumeSnapshots.enabled"?: string;
  "lvm-localpv.crds.lvmLocalPv.enabled"?: string;
  "lvm-localpv.crds.csi.volumeSnapshots.enabled"?: string;
  "rawfile-localpv.crds.csi.volumeSnapshots.enabled"?: string;
  "mayastor.csi.node.initContainers.enabled"?: string;
  "mayastor.etcd.clusterDomain"?: string;
  "mayastor.localpv-provisioner.enabled"?: string;
  "mayastor.crds.enabled"?: string;
  "mayastor.loki.enabled"?: string;
  "mayastor.alloy.enabled"?: string;
  "preUpgradeHook.enabled"?: string;
  "preUpgradeHook.tolerations"?: string;
  "preUpgradeHook.imagePullSecrets"?: string;
  "preUpgradeHook.podLabels.openebs.io/logging"?: string;
  "preUpgradeHook.annotations.helm.sh/hook-delete-policy"?: string;
  "preUpgradeHook.image.registry"?: string;
  "preUpgradeHook.image.repo"?: string;
  "preUpgradeHook.image.tag"?: string;
  "preUpgradeHook.image.pullPolicy"?: string;
  "engines.local.lvm.enabled"?: string;
  "engines.local.zfs.enabled"?: string;
  "engines.local.rawfile.enabled"?: string;
  "engines.replicated.mayastor.enabled"?: string;
  "loki.enabled"?: string;
  "loki.localpvScConfig.enabled"?: string;
  "loki.localpvScConfig.loki.name"?: string;
  "loki.localpvScConfig.loki.basePath"?: string;
  "loki.localpvScConfig.loki.reclaimPolicy"?: string;
  "loki.localpvScConfig.loki.volumeBindingMode"?: string;
  "loki.localpvScConfig.minio.name"?: string;
  "loki.localpvScConfig.minio.basePath"?: string;
  "loki.localpvScConfig.minio.reclaimPolicy"?: string;
  "loki.localpvScConfig.minio.volumeBindingMode"?: string;
  "loki.loki.serviceLabels.app"?: string;
  "loki.loki.podLabels.app"?: string;
  "loki.loki.schemaConfig.configs.from"?: string;
  "loki.loki.schemaConfig.configs.store"?: string;
  "loki.loki.schemaConfig.configs.object_store"?: string;
  "loki.loki.schemaConfig.configs.schema"?: string;
  "loki.loki.schemaConfig.configs.index.prefix"?: string;
  "loki.loki.schemaConfig.configs.index.period"?: string;
  "loki.loki.commonConfig.replication_factor"?: string;
  "loki.loki.ingester.chunk_encoding"?: string;
  "loki.loki.tracing.enabled"?: string;
  "loki.loki.querier.max_concurrent"?: string;
  "loki.loki.limits_config.ingestion_burst_size_mb"?: string;
  "loki.loki.limits_config.ingestion_rate_mb"?: string;
  "loki.loki.limits_config.max_label_names_per_series"?: string;
  "loki.singleBinary.replicas"?: string;
  "loki.singleBinary.drivesPerNode"?: string;
  "loki.singleBinary.persistence.enabled"?: string;
  "loki.singleBinary.persistence.storageClass"?: string;
  "loki.singleBinary.persistence.accessModes"?: string;
  "loki.singleBinary.persistence.size"?: string;
  "loki.minio.replicas"?: string;
  "loki.minio.drivesPerNode"?: string;
  "loki.minio.mode"?: string;
  "loki.minio.enabled"?: string;
  "loki.minio.persistence.enabled"?: string;
  "loki.minio.persistence.storageClass"?: string;
  "loki.minio.persistence.size"?: string;
  "loki.deploymentMode"?: string;
  "loki.lokiCanary.enabled"?: string;
  "loki.chunksCache.enabled"?: string;
  "loki.test.enabled"?: string;
  "loki.gateway.enabled"?: string;
  "loki.resultsCache.enabled"?: string;
  "loki.backend.replicas"?: string;
  "loki.read.replicas"?: string;
  "loki.write.replicas"?: string;
  "loki.ingester.replicas"?: string;
  "loki.querier.replicas"?: string;
  "loki.queryFrontend.replicas"?: string;
  "loki.queryScheduler.replicas"?: string;
  "loki.distributor.replicas"?: string;
  "loki.compactor.replicas"?: string;
  "loki.indexGateway.replicas"?: string;
  "loki.bloomCompactor.replicas"?: string;
  "loki.bloomGateway.replicas"?: string;
  "loki.sidecar.image.repository"?: string;
  "alloy.enabled"?: string;
  "alloy.logging_config.debugging"?: string;
  "alloy.logging_config.labels.openebs.io/logging"?: string;
  "alloy.logging_config.tenant_id"?: string;
  "alloy.alloy.mounts.varlog"?: string;
  "alloy.alloy.configMap.create"?: string;
  "alloy.alloy.configMap.content"?: string;
};
