// Generated TypeScript types for mariadb Helm chart

export type MariadbHelmValuesGlobal = {
  /**
   * Global Docker Image registry
   *
   * Global Docker Image registry
   *
   * @default ""
   */
  imageRegistry?: string;
  /**
   * E.g.
   *
   * Global Docker registry secret names as an array
   *
   * @default []
   */
  imagePullSecrets?: unknown[];
  /**
   * Global default StorageClass for Persistent Volume(s)
   *
   * Global default StorageClass for Persistent Volume(s)
   *
   * @default ""
   */
  defaultStorageClass?: string;
  /**
   * Security parameters
   *
   * @default {"allowInsecureImages":false}
   */
  security?: MariadbHelmValuesGlobalSecurity;
  /**
   * Compatibility adaptations for Kubernetes platforms
   *
   * @default {"openshift":{"adaptSecurityContext":"auto"}}
   */
  compatibility?: MariadbHelmValuesGlobalCompatibility;
  /**
   * Configure FIPS mode: '', 'restricted', 'relaxed', 'off'
   *
   * @default "restricted"
   */
  defaultFips?: string;
};

export type MariadbHelmValuesGlobalSecurity = {
  /**
   * Allows skipping image verification
   *
   * Allows skipping image verification
   *
   * @default false
   */
  allowInsecureImages?: boolean;
};

export type MariadbHelmValuesGlobalCompatibility = {
  /**
   * Compatibility adaptations for Openshift
   *
   * @default {"adaptSecurityContext":"auto"}
   */
  openshift?: MariadbHelmValuesGlobalCompatibilityOpenshift;
};

export type MariadbHelmValuesGlobalCompatibilityOpenshift = {
  /**
   * Adapt the securityContext sections of the deployment to make them compatible with Openshift restricted-v2 SCC: remove runAsUser, runAsGroup and fsGroup and let the platform use their allowed default IDs. Possible values: auto (apply if the detected running cluster is Openshift), force (perform the adaptation always), disabled (do not perform adaptation)
   *
   * Adapt the securityContext sections of the deployment to make them compatible with Openshift restricted-v2 SCC: remove runAsUser, runAsGroup and fsGroup and let the platform use their allowed default IDs. Possible values: auto (apply if the detected running cluster is Openshift), force (perform the adaptation always), disabled (do not perform adaptation)
   *
   * @default "auto"
   */
  adaptSecurityContext?: string;
};

export type MariadbHelmValuesCommonAnnotations = object;

export type MariadbHelmValuesCommonLabels = object;

export type MariadbHelmValuesDiagnosticMode = {
  /**
   * Enable diagnostic mode (all probes will be disabled and the command will be overridden)
   *
   * Enable diagnostic mode (all probes will be disabled and the command will be overridden)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Command to override all containers in the deployment
   *
   * Command to override all containers in the deployment
   *
   * @default ["sleep"]
   */
  command?: string[];
  /**
   * Args to override all containers in the deployment
   *
   * Args to override all containers in the deployment
   *
   * @default ["infinity"]
   */
  args?: string[];
};

export type MariadbHelmValuesServiceBindings = {
  /**
   * Create secret for service binding (Experimental)
   *
   * Create secret for service binding (Experimental)
   *
   * @default false
   */
  enabled?: boolean;
};

export type MariadbHelmValuesImage = {
  /**
   * [default: REGISTRY_NAME] MariaDB image registry
   *
   * MariaDB image registry
   *
   * @default "REGISTRY_NAME"
   */
  registry?: string;
  /**
   * [default: REPOSITORY_NAME/mariadb] MariaDB image repository
   *
   * MariaDB image repository
   *
   * @default "REPOSITORY_NAME/mariadb"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * MariaDB image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * MariaDB image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * @default ""
   */
  digest?: string;
  /**
   * Specify a imagePullPolicy
   * ref: https://kubernetes.io/docs/concepts/containers/images/#pre-pulled-images
   *
   * MariaDB image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * Optionally specify an array of imagePullSecrets (secrets must be manually created in the namespace)
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/
   * Example:
   * pullSecrets:
   * - myRegistryKeySecretName
   *
   * Specify docker-registry secret names as an array
   *
   * @default []
   */
  pullSecrets?: unknown[];
  /**
   * Set to true if you would like to see extra information on logs
   * It turns BASH and/or NAMI debugging in the image
   *
   * Specify if debug logs should be enabled
   *
   * @default false
   */
  debug?: boolean;
};

export type MariadbHelmValuesAuth = {
  /**
   * ref: https://github.com/bitnami/containers/tree/main/bitnami/mariadb#setting-the-root-password-on-first-run
   *
   * Password for the `root` user. Ignored if existing secret is provided.
   *
   * @default ""
   */
  rootPassword?: string;
  /**
   * ref: https://github.com/bitnami/containers/blob/main/bitnami/mariadb/README.md#creating-a-database-on-first-run
   *
   * Name for a custom database to create
   *
   * @default "my_database"
   */
  database?: string;
  /**
   * ref: https://github.com/bitnami/containers/blob/main/bitnami/mariadb/README.md#creating-a-database-user-on-first-run
   *
   * Name for a custom user to create
   *
   * @default ""
   */
  username?: string;
  /**
   * Password for the new user. Ignored if existing secret is provided
   *
   * Password for the new user. Ignored if existing secret is provided
   *
   * @default ""
   */
  password?: string;
  /**
   * ref: https://github.com/bitnami/containers/tree/main/bitnami/mariadb#setting-up-a-replication-cluster
   *
   * MariaDB replication user
   *
   * @default "replicator"
   */
  replicationUser?: string;
  /**
   * ref: https://github.com/bitnami/containers/tree/main/bitnami/mariadb#setting-up-a-replication-cluster
   *
   * MariaDB replication user password. Ignored if existing secret is provided
   *
   * @default ""
   */
  replicationPassword?: string;
  /**
   * Use existing secret for password details (`auth.rootPassword`, `auth.password`, `auth.replicationPassword` will be ignored and picked up from this secret). The secret has to contain the keys `mariadb-root-password`, `mariadb-replication-password` and `mariadb-password`
   *
   * Use existing secret for password details (`auth.rootPassword`, `auth.password`, `auth.replicationPassword` will be ignored and picked up from this secret). The secret has to contain the keys `mariadb-root-password`, `mariadb-replication-password` and `mariadb-password`
   *
   * @default ""
   */
  existingSecret?: string;
  /**
   * Force users to specify required passwords
   *
   * Force users to specify required passwords
   *
   * @default false
   */
  forcePassword?: boolean;
  /**
   * Mount credentials as files instead of using environment variables
   *
   * Mount credentials as files instead of using environment variables
   *
   * @default false
   */
  usePasswordFiles?: boolean;
  /**
   * Example:
   * customPasswordFiles:
   * replicator: /vault/secrets/mariadb-replicator
   *
   * Use custom password files when `auth.usePasswordFiles` is set to `true`. Define path for keys `root` and `user`, also define `replicator` if `architecture` is set to `replication`
   *
   * @default {}
   */
  customPasswordFiles?: MariadbHelmValuesAuthCustomPasswordFiles;
};

export type MariadbHelmValuesAuthCustomPasswordFiles = object;

export type MariadbHelmValuesInitdbScripts = object;

export type MariadbHelmValuesTls = {
  /**
   * Enable TLS in MariaDB
   *
   * Enable TLS in MariaDB
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Existing secret that contains TLS certificates
   *
   * Existing secret that contains TLS certificates
   *
   * @default ""
   */
  existingSecret?: string;
  /**
   * The secret key from the existingSecret if 'cert' key different from the default (tls.crt)
   *
   * The secret key from the existingSecret if 'cert' key different from the default (tls.crt)
   *
   * @default "tls.crt"
   */
  certFilename?: string;
  /**
   * The secret key from the existingSecret if 'key' key different from the default (tls.key)
   *
   * The secret key from the existingSecret if 'key' key different from the default (tls.key)
   *
   * @default "tls.key"
   */
  certKeyFilename?: string;
  /**
   * The secret key from the existingSecret if 'ca' key different from the default (tls.crt)
   *
   * The secret key from the existingSecret if 'ca' key different from the default (tls.crt)
   *
   * @default ""
   */
  certCAFilename?: string;
  /**
   * CA certificate for TLS. Ignored if `tls.existingSecret` is set
   *
   * CA certificate for TLS. Ignored if `tls.existingSecret` is set
   *
   * @default ""
   */
  ca?: string;
  /**
   * TLS certificate for MariaDB. Ignored if `tls.existingSecret` is set
   *
   * TLS certificate. Ignored if `tls.master.existingSecret` is set
   *
   * @default ""
   */
  cert?: string;
  /**
   * TLS key for MariaDB. Ignored if `tls.existingSecret` is set
   *
   * TLS key. Ignored if `tls.master.existingSecret` is set
   *
   * @default ""
   */
  key?: string;
  /**
   * @default {...} (5 keys)
   */
  autoGenerated?: MariadbHelmValuesTlsAutoGenerated;
};

export type MariadbHelmValuesTlsAutoGenerated = {
  /**
   * Enable automatic generation of TLS certificates
   *
   * Enable automatic generation of certificates for TLS
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Mechanism to generate the certificates (allowed values: helm, cert-manager)
   *
   * Mechanism to generate the certificates (allowed values: helm, cert-manager)
   *
   * @default "helm"
   */
  engine?: string;
  extraSANs?: unknown[];
  /**
   * Add loopback SANs (localhost and 127.0.0.1) to generated certificates
   *
   * @default false
   */
  loopback?: boolean;
  /**
   * @default {...} (6 keys)
   */
  certManager?: MariadbHelmValuesTlsAutoGeneratedCertManager;
};

export type MariadbHelmValuesTlsAutoGeneratedCertManager = {
  /**
   * The name of an existing Issuer to use for generating the certificates (only for `cert-manager` engine)
   *
   * The name of an existing Issuer to use for generating the certificates (only for `cert-manager` engine)
   *
   * @default ""
   */
  existingIssuer?: string;
  /**
   * Existing Issuer kind, defaults to Issuer (only for `cert-manager` engine)
   *
   * Existing Issuer kind, defaults to Issuer (only for `cert-manager` engine)
   *
   * @default ""
   */
  existingIssuerKind?: string;
  /**
   * Key size for the certificates (only for `cert-manager` engine)
   *
   * Key size for the certificates (only for `cert-manager` engine)
   *
   * @default 2048
   */
  keySize?: number;
  /**
   * Key algorithm for the certificates (only for `cert-manager` engine)
   *
   * Key algorithm for the certificates (only for `cert-manager` engine)
   *
   * @default "RSA"
   */
  keyAlgorithm?: string;
  /**
   * Duration for the certificates (only for `cert-manager` engine)
   *
   * Duration for the certificates (only for `cert-manager` engine)
   *
   * @default "2160h"
   */
  duration?: string;
  /**
   * Renewal period for the certificates (only for `cert-manager` engine)
   *
   * Renewal period for the certificates (only for `cert-manager` engine)
   *
   * @default "360h"
   */
  renewBefore?: string;
};

export type MariadbHelmValuesTde = {
  /**
   * Enable Transparent Data Encryption using the File Key Management Encryption Plugin for MariaDB
   *
   * Enable Transparent Data Encryption using the File Key Management Encryption Plugin for MariaDB
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Existing secret that contains Transparent Data Encryption key files used when secretsStoreProvider is not enabled
   *
   * Existing secret that contains Transparent Data Encryption key files used when secretsStoreProvider is not enabled
   *
   * @default ""
   */
  existingSecret?: string;
  /**
   * File name of the 'random keyfile' when it is different from the default (keyfile.key), is also used for key name in the existingSecret
   *
   * File name of the 'random keyfile' when it is different from the default (keyfile.key), is also used for key name in the existingSecret
   *
   * @default "keyfile.key"
   */
  randomKeyFilename?: string;
  /**
   * File name of the 'encrypted keyfile' when it is different from the default (keyfile.enc), is also used for key name in the existingSecret
   *
   * File name of the 'encrypted keyfile' when it is different from the default (keyfile.enc), is also used for key name in the existingSecret
   *
   * @default "keyfile.enc"
   */
  encryptedKeyFilename?: string;
  /**
   * Encryption algorithm used for encrypting data (allowed values: AES_CTR, AES_CBC | default: AES_CTR)
   *
   * Encryption algorithm used for encrypting data (allowed values: AES_CTR, AES_CBC | default: AES_CTR)
   *
   * @default "AES_CTR"
   */
  fileKeyManagementEncryptionAlgorithm?: string;
  /**
   * Enables automatic encryption of all InnoDB tablespaces (allowed values: FORCE, ON, OFF | default: FORCE)
   *
   * Enables automatic encryption of all InnoDB tablespaces (allowed values: FORCE, ON, OFF | default: FORCE)
   *
   * @default "FORCE"
   */
  innodbEncryptTables?: string;
  /**
   * Enables encryption of the InnoDB redo log (allowed values: ON, OFF | default: ON)
   *
   * Enables encryption of the InnoDB redo log (allowed values: ON, OFF | default: ON)
   *
   * @default "ON"
   */
  innodbEncryptLog?: string;
  /**
   * Enables automatic encryption of the InnoDB temporary tablespace (allowed values: ON, OFF | default: ON)
   *
   * Enables automatic encryption of the InnoDB temporary tablespace (allowed values: ON, OFF | default: ON)
   *
   * @default "ON"
   */
  innodbEncryptTemporaryTables?: string;
  /**
   * Enables automatic encryption of all internal on-disk temporary tables that are created during query execution (allowed values: ON, OFF | default: ON)
   *
   * Enables automatic encryption of all internal on-disk temporary tables that are created during query execution (allowed values: ON, OFF | default: ON)
   *
   * @default "ON"
   */
  encryptTmpDiskTables?: string;
  /**
   * Enables automatic encryption of temporary files, such as those created for filesort operations, binary log file caches, etc. (allowed values: ON, OFF | default: ON)
   *
   * Enables automatic encryption of temporary files, such as those created for filesort operations, binary log file caches, etc. (allowed values: ON, OFF | default: ON)
   *
   * @default "ON"
   */
  encryptTmpTiles?: string;
  /**
   * Enables encrypting binary logs including relay logs (allowed values: ON, OFF | default: ON)
   *
   * Enables encrypting binary logs including relay logs (allowed values: ON, OFF | default: ON)
   *
   * @default "ON"
   */
  encryptBINLOG?: string;
  /**
   * Enables automatic encryption of all Aria tablespaces (allowed values: ON, OFF | default: ON)
   *
   * Enables automatic encryption of all Aria tablespaces (allowed values: ON, OFF | default: ON)
   *
   * @default "ON"
   */
  ariaEncryptTables?: string;
  /**
   * Number of threads to use for encryption (default: 4)
   *
   * Number of threads to use for encryption (default: 4)
   *
   * @default 4
   */
  innodbEncryptionThreads?: number;
  /**
   * @default {"enabled":false,"provider":"vault","vault":{"roleName":"","address":"","authMountPath":"","randomKeySecretPath":"","randomKeySecretKey":"","encryptedKeySecretPath":"","encryptedKeySecretKey":""}}
   */
  secretsStoreProvider?: MariadbHelmValuesTdeSecretsStoreProvider;
};

export type MariadbHelmValuesTdeSecretsStoreProvider = {
  /**
   * Enable use of secrets store provider for Transparent Data Encryption key files
   *
   * Enable use of secrets store provider for Transparent Data Encryption key files
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Type of provider used in secrets store provider class (allowed values: vault)
   *
   * Type of provider used in secrets store provider class (allowed values: vault)
   *
   * @default "vault"
   */
  provider?: string;
  /**
   * @default {...} (7 keys)
   */
  vault?: MariadbHelmValuesTdeSecretsStoreProviderVault;
};

export type MariadbHelmValuesTdeSecretsStoreProviderVault = {
  /**
   * The name of the HashiCorp Vault role used for accessing the key files (only for `vault` provider)
   *
   * The name of the HashiCorp Vault role used for accessing the key files (only for `vault` provider)
   *
   * @default ""
   */
  roleName?: string;
  /**
   * The URL of the HashiCorp Vault server (only for `vault` provider)
   *
   * The URL of the HashiCorp Vault server (only for `vault` provider)
   *
   * @default ""
   */
  address?: string;
  /**
   * The HashiCorp Vault auth mount path (only for `vault` provider)
   *
   * The HashiCorp Vault auth mount path (only for `vault` provider)
   *
   * @default ""
   */
  authMountPath?: string;
  /**
   * The HashiCorp Vault secret path for the 'random keyfile' (only for `vault` provider)
   *
   * The HashiCorp Vault secret path for the 'random keyfile' (only for `vault` provider)
   *
   * @default ""
   */
  randomKeySecretPath?: string;
  /**
   * The HashiCorp Vault secret key for the 'random keyfile' (only for `vault` provider)
   *
   * The HashiCorp Vault secret key for the 'random keyfile' (only for `vault` provider)
   *
   * @default ""
   */
  randomKeySecretKey?: string;
  /**
   * The HashiCorp Vault secret path for the 'encrypted keyfile' (only for `vault` provider)
   *
   * The HashiCorp Vault secret path for the 'encrypted keyfile' (only for `vault` provider)
   *
   * @default ""
   */
  encryptedKeySecretPath?: string;
  /**
   * The HashiCorp Vault secret key for the 'encrypted keyfile' (only for `vault` provider)
   *
   * The HashiCorp Vault secret key for the 'encrypted keyfile' (only for `vault` provider)
   *
   * @default ""
   */
  encryptedKeySecretKey?: string;
};

export type MariadbHelmValuesPrimary = {
  /**
   * Name of the primary database (eg primary, master, leader, ...)
   *
   * Name of the primary database (eg primary, master, leader, ...)
   *
   * @default "primary"
   */
  name?: string;
  /**
   * Override default container command on MariaDB Primary container(s) (useful when using custom images)
   *
   * Override default container command on MariaDB Primary container(s) (useful when using custom images)
   *
   * @default []
   */
  command?: unknown[];
  /**
   * Override default container args on MariaDB Primary container(s) (useful when using custom images)
   *
   * Override default container args on MariaDB Primary container(s) (useful when using custom images)
   *
   * @default []
   */
  args?: unknown[];
  /**
   * for the MariaDB Primary container(s) to automate configuration before or after startup
   *
   * for the MariaDB Primary container(s) to automate configuration before or after startup
   *
   * @default {}
   */
  lifecycleHooks?: MariadbHelmValuesPrimaryLifecycleHooks;
  /**
   * Mount Service Account token in pod
   *
   * Mount Service Account token in pod
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  /**
   * https://kubernetes.io/docs/concepts/services-networking/add-entries-to-pod-etc-hosts-with-host-aliases/
   *
   * Add deployment host aliases
   *
   * @default []
   */
  hostAliases?: unknown[];
  /**
   * @default {"mysql":3306}
   */
  containerPorts?: MariadbHelmValuesPrimaryContainerPorts;
  /**
   * ref: https://mysql.com/kb/en/mysql/configuring-mysql-with-mycnf/#example-of-configuration-file
   *
   * MariaDB Primary configuration to be injected as ConfigMap
   *
   * @default """"
   */
  configuration?: string;
  /**
   * NOTE: When it's set the 'configuration' parameter is ignored
   *
   * Name of existing ConfigMap with MariaDB Primary configuration.
   *
   * @default ""
   */
  existingConfigmap?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#update-strategies
   *
   * @default {"type":"RollingUpdate"}
   */
  updateStrategy?: MariadbHelmValuesPrimaryUpdateStrategy;
  /**
   * https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#partitions
   *
   * Partition update strategy for Mariadb Primary statefulset
   *
   * @default ""
   */
  rollingUpdatePartition?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
   *
   * Additional pod annotations for MariaDB primary pods
   *
   * @default {}
   */
  podAnnotations?: MariadbHelmValuesPrimaryPodAnnotations;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * Extra labels for MariaDB primary pods
   *
   * @default {}
   */
  podLabels?: MariadbHelmValuesPrimaryPodLabels;
  /**
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity
   *
   * MariaDB primary pod affinity preset. Ignored if `primary.affinity` is set. Allowed values: `soft` or `hard`
   *
   * @default ""
   */
  podAffinityPreset?: string;
  /**
   * Ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity
   *
   * MariaDB primary pod anti-affinity preset. Ignored if `primary.affinity` is set. Allowed values: `soft` or `hard`
   *
   * @default "soft"
   */
  podAntiAffinityPreset?: string;
  /**
   * Mariadb Primary node affinity preset
   * Ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#node-affinity
   *
   * @default {"type":"","key":"","values":[]}
   */
  nodeAffinityPreset?: MariadbHelmValuesPrimaryNodeAffinityPreset;
  /**
   * Affinity for MariaDB primary pods assignment
   *
   * Affinity for MariaDB primary pods assignment
   *
   * @default {}
   */
  affinity?: MariadbHelmValuesPrimaryAffinity;
  /**
   * Ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
   *
   * Node labels for MariaDB primary pods assignment
   *
   * @default {}
   */
  nodeSelector?: MariadbHelmValuesPrimaryNodeSelector;
  /**
   * Ref: https://kubernetes.io/docs/concepts/configuration/taint-and-toleration/
   *
   * Tolerations for MariaDB primary pods assignment
   *
   * @default []
   */
  tolerations?: unknown[];
  /**
   * ref: https://kubernetes.io/docs/tasks/administer-cluster/configure-multiple-schedulers/
   *
   * Name of the k8s scheduler (other than default)
   *
   * @default ""
   */
  schedulerName?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/pods/pod/#termination-of-pods
   *
   * @default ""
   */
  terminationGracePeriodSeconds?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#pod-management-policies
   *
   * podManagementPolicy to manage scaling operation of MariaDB primary pods
   *
   * @default ""
   */
  podManagementPolicy?: string;
  /**
   * Topology Spread Constraints for MariaDB primary pods assignment
   *
   * Topology Spread Constraints for MariaDB primary pods assignment
   *
   * @default []
   */
  topologySpreadConstraints?: unknown[];
  /**
   * Ref: https://kubernetes.io/docs/concepts/configuration/pod-priority-preemption/
   *
   * Priority class for MariaDB primary pods assignment
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Ref: https://kubernetes.io/docs/concepts/containers/runtime-class/
   *
   * Runtime Class for MariaDB primary pods
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * MariaDB primary Pod security context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: MariadbHelmValuesPrimaryPodSecurityContext;
  /**
   * MariaDB primary container security context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container
   *
   * @default {...} (10 keys)
   */
  containerSecurityContext?: MariadbHelmValuesPrimaryContainerSecurityContext;
  /**
   * MariaDB primary container's resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   * We usually recommend not to specify default resources and to leave this as a conscious
   * choice for the user. This also increases chances charts run on environments with little
   * resources, such as Minikube. If you do want to specify resources, uncomment the following
   * lines, adjust them as necessary, and remove the curly braces after 'resources:'.
   * NOTE: The "nano" and "micro" presets allocate extremely low CPU/memory. These values may cause MariaDB to fail during startup (e.g., OOMKilled, readiness/liveness probe failures)
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * Set container resources according to one common preset (allowed values: none, nano, micro, small, medium, large, xlarge, 2xlarge). This is ignored if primary.resources is set (primary.resources is recommended for production).
   *
   * @default "micro"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * Set container requests and limits for different resources like CPU or memory (essential for production workloads)
   *
   * @default {}
   */
  resources?: MariadbHelmValuesPrimaryResources;
  /**
   * @default {"openssl":""}
   */
  fips?: MariadbHelmValuesPrimaryFips;
  /**
   * Configure extra options for MariaDB primary containers' liveness, readiness and startup probes
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/#configure-probes)
   *
   * @default {...} (6 keys)
   */
  startupProbe?: MariadbHelmValuesPrimaryStartupProbe;
  /**
   * Configure extra options for liveness probe
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/#configure-probes
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: MariadbHelmValuesPrimaryLivenessProbe;
  /**
   * @default {...} (6 keys)
   */
  readinessProbe?: MariadbHelmValuesPrimaryReadinessProbe;
  /**
   * Override default startup probe for MariaDB primary containers
   *
   * Override default startup probe for MariaDB primary containers
   *
   * @default {}
   */
  customStartupProbe?: MariadbHelmValuesPrimaryCustomStartupProbe;
  /**
   * Override default liveness probe for MariaDB primary containers
   *
   * Override default liveness probe for MariaDB primary containers
   *
   * @default {}
   */
  customLivenessProbe?: MariadbHelmValuesPrimaryCustomLivenessProbe;
  /**
   * Override default readiness probe for MariaDB primary containers
   *
   * Override default readiness probe for MariaDB primary containers
   *
   * @default {}
   */
  customReadinessProbe?: MariadbHelmValuesPrimaryCustomReadinessProbe;
  /**
   * `bitnami/mariadb` Docker image has built-in startup check mechanism,
   * which periodically checks if MariaDB service has started up and stops it
   * if all checks have failed after X tries. Use these to control these checks.
   * ref: https://github.com/bitnami/containers/tree/main/bitnami/mariadb/pull/240
   *
   * Override default builtin startup wait check options for MariaDB primary containers
   *
   * @default {}
   */
  startupWaitOptions?: MariadbHelmValuesPrimaryStartupWaitOptions;
  /**
   * Can be used to specify command line flags, for example:
   * E.g.
   *
   * MariaDB primary additional command line flags
   *
   * @default ""
   */
  extraFlags?: string;
  /**
   * E.g.
   *
   * Extra environment variables to be set on MariaDB primary containers
   *
   * @default []
   */
  extraEnvVars?: unknown[];
  /**
   * Name of existing ConfigMap containing extra env vars for MariaDB primary containers
   *
   * Name of existing ConfigMap containing extra env vars for MariaDB primary containers
   *
   * @default ""
   */
  extraEnvVarsCM?: string;
  /**
   * Name of existing Secret containing extra env vars for MariaDB primary containers
   *
   * Name of existing Secret containing extra env vars for MariaDB primary containers
   *
   * @default ""
   */
  extraEnvVarsSecret?: string;
  /**
   * Enable persistence using Persistent Volume Claims
   * ref: https://kubernetes.io/docs/concepts/storage/persistent-volumes/
   *
   * @default {...} (9 keys)
   */
  persistence?: MariadbHelmValuesPrimaryPersistence;
  /**
   * Optionally specify extra list of additional volumes to the MariaDB Primary pod(s)
   *
   * Optionally specify extra list of additional volumes to the MariaDB Primary pod(s)
   *
   * @default []
   */
  extraVolumes?: unknown[];
  /**
   * Optionally specify extra list of additional volumeMounts for the MariaDB Primary container(s)
   *
   * Optionally specify extra list of additional volumeMounts for the MariaDB Primary container(s)
   *
   * @default []
   */
  extraVolumeMounts?: unknown[];
  /**
   * Add additional init containers for the MariaDB Primary pod(s)
   *
   * Add additional init containers for the MariaDB Primary pod(s)
   *
   * @default []
   */
  initContainers?: unknown[];
  /**
   * Add additional sidecar containers for the MariaDB Primary pod(s)
   *
   * Add additional sidecar containers for the MariaDB Primary pod(s)
   *
   * @default []
   */
  sidecars?: unknown[];
  /**
   * MariaDB Primary Service parameters
   *
   * @default {...} (12 keys)
   */
  service?: MariadbHelmValuesPrimaryService;
  /**
   * ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {"create":true,"minAvailable":"","maxUnavailable":""}
   */
  pdb?: MariadbHelmValuesPrimaryPdb;
  /**
   * Maximum number of revisions that will be maintained in the StatefulSet
   *
   * Maximum number of revisions that will be maintained in the StatefulSet
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
};

export type MariadbHelmValuesPrimaryLifecycleHooks = object;

export type MariadbHelmValuesPrimaryContainerPorts = {
  /**
   * Container port for mysql
   *
   * Container port for mysql
   *
   * @default 3306
   */
  mysql?: number;
};

export type MariadbHelmValuesPrimaryUpdateStrategy = {
  /**
   * StrategyType
   * Can be set to RollingUpdate or OnDelete
   *
   * MariaDB primary statefulset strategy type
   *
   * @default "RollingUpdate"
   */
  type?: string;
};

export type MariadbHelmValuesPrimaryPodAnnotations = object;

export type MariadbHelmValuesPrimaryPodLabels = object;

export type MariadbHelmValuesPrimaryNodeAffinityPreset = {
  /**
   * MariaDB primary node affinity preset type. Ignored if `primary.affinity` is set. Allowed values: `soft` or `hard`
   *
   * MariaDB primary node affinity preset type. Ignored if `primary.affinity` is set. Allowed values: `soft` or `hard`
   *
   * @default ""
   */
  type?: string;
  /**
   * E.g.
   *
   * MariaDB primary node label key to match Ignored if `primary.affinity` is set.
   *
   * @default ""
   */
  key?: string;
  /**
   * E.g.
   *
   * MariaDB primary node label values to match. Ignored if `primary.affinity` is set.
   *
   * @default []
   */
  values?: unknown[];
};

export type MariadbHelmValuesPrimaryAffinity = object;

export type MariadbHelmValuesPrimaryNodeSelector = object;

export type MariadbHelmValuesPrimaryPodSecurityContext = {
  /**
   * Enable security context for MariaDB primary pods
   *
   * Enable security context for MariaDB primary pods
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Set filesystem group change policy
   *
   * Set filesystem group change policy
   *
   * @default "Always"
   */
  fsGroupChangePolicy?: string;
  /**
   * Set kernel settings using the sysctl interface
   *
   * Set kernel settings using the sysctl interface
   *
   * @default []
   */
  sysctls?: unknown[];
  /**
   * Set filesystem extra groups
   *
   * Set filesystem extra groups
   *
   * @default []
   */
  supplementalGroups?: unknown[];
  /**
   * Group ID for the mounted volumes' filesystem
   *
   * Group ID for the mounted volumes' filesystem
   *
   * @default 1001
   */
  fsGroup?: number;
};

export type MariadbHelmValuesPrimaryContainerSecurityContext = {
  /**
   * MariaDB primary container securityContext
   *
   * MariaDB primary container securityContext
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * [object,nullable] Set SELinux options in container
   *
   * @default {}
   */
  seLinuxOptions?: MariadbHelmValuesPrimaryContainerSecurityContextSeLinuxOptions;
  /**
   * User ID for the MariaDB primary container
   *
   * User ID for the MariaDB primary container
   *
   * @default 1001
   */
  runAsUser?: number;
  /**
   * Group ID for the MariaDB primary container
   *
   * Group ID for the MariaDB primary container
   *
   * @default 1001
   */
  runAsGroup?: number;
  /**
   * Set primary container's Security Context runAsNonRoot
   *
   * Set primary container's Security Context runAsNonRoot
   *
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * Set primary container's Security Context privileged
   *
   * Set primary container's Security Context privileged
   *
   * @default false
   */
  privileged?: boolean;
  /**
   * Set primary container's Security Context allowPrivilegeEscalation
   *
   * Set primary container's Security Context allowPrivilegeEscalation
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * Set container's Security Context readOnlyRootFilesystem
   *
   * Set container's Security Context readOnlyRootFilesystem
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: MariadbHelmValuesPrimaryContainerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: MariadbHelmValuesPrimaryContainerSecurityContextSeccompProfile;
};

export type MariadbHelmValuesPrimaryContainerSecurityContextSeLinuxOptions = object;

export type MariadbHelmValuesPrimaryContainerSecurityContextCapabilities = {
  /**
   * List of capabilities to be dropped
   *
   * List of capabilities to be dropped
   *
   * @default ["ALL"]
   */
  drop?: string[];
};

export type MariadbHelmValuesPrimaryContainerSecurityContextSeccompProfile = {
  /**
   * Set container's Security Context seccomp profile
   *
   * Set container's Security Context seccomp profile
   *
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type MariadbHelmValuesPrimaryResources = object;

export type MariadbHelmValuesPrimaryFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
};

export type MariadbHelmValuesPrimaryStartupProbe = {
  /**
   * Enable startupProbe
   *
   * Enable startupProbe
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for startupProbe
   *
   * Initial delay seconds for startupProbe
   *
   * @default 120
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for startupProbe
   *
   * Period seconds for startupProbe
   *
   * @default 15
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for startupProbe
   *
   * Timeout seconds for startupProbe
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Failure threshold for startupProbe
   *
   * Failure threshold for startupProbe
   *
   * @default 10
   */
  failureThreshold?: number;
  /**
   * Success threshold for startupProbe
   *
   * Success threshold for startupProbe
   *
   * @default 1
   */
  successThreshold?: number;
};

export type MariadbHelmValuesPrimaryLivenessProbe = {
  /**
   * Enable livenessProbe
   *
   * Enable livenessProbe
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for livenessProbe
   *
   * Initial delay seconds for livenessProbe
   *
   * @default 120
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for livenessProbe
   *
   * Period seconds for livenessProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for livenessProbe
   *
   * Timeout seconds for livenessProbe
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Failure threshold for livenessProbe
   *
   * Failure threshold for livenessProbe
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Success threshold for livenessProbe
   *
   * Success threshold for livenessProbe
   *
   * @default 1
   */
  successThreshold?: number;
};

export type MariadbHelmValuesPrimaryReadinessProbe = {
  /**
   * Enable readinessProbe
   *
   * Enable readinessProbe
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for readinessProbe
   *
   * Initial delay seconds for readinessProbe
   *
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for readinessProbe
   *
   * Period seconds for readinessProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for readinessProbe
   *
   * Timeout seconds for readinessProbe
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Failure threshold for readinessProbe
   *
   * Failure threshold for readinessProbe
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Success threshold for readinessProbe
   *
   * Success threshold for readinessProbe
   *
   * @default 1
   */
  successThreshold?: number;
};

export type MariadbHelmValuesPrimaryCustomStartupProbe = object;

export type MariadbHelmValuesPrimaryCustomLivenessProbe = object;

export type MariadbHelmValuesPrimaryCustomReadinessProbe = object;

export type MariadbHelmValuesPrimaryStartupWaitOptions = object;

export type MariadbHelmValuesPrimaryPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable persistence on MariaDB primary replicas using a `PersistentVolumeClaim`. If false, use emptyDir
   *
   * Enable persistence on MariaDB primary replicas using a `PersistentVolumeClaim`. If false, use emptyDir
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * NOTE: When it's set the rest of persistence parameters are ignored
   *
   * Name of an existing `PersistentVolumeClaim` for MariaDB primary replicas
   *
   * @default ""
   */
  existingClaim?: string;
  /**
   * Subdirectory of the volume to mount at
   *
   * Subdirectory of the volume to mount at
   *
   * @default ""
   */
  subPath?: string;
  /**
   * If defined, storageClassName: <storageClass>
   * If set to "-", storageClassName: "", which disables dynamic provisioning
   * If undefined (the default) or set to null, no storageClassName spec is
   * set, choosing the default provisioner.  (gp2 on AWS, standard on
   * GKE, AWS & OpenStack)
   *
   * MariaDB primary persistent volume storage Class
   *
   * @default ""
   */
  storageClass?: string;
  /**
   * Labels for the PVC
   *
   * Labels for the PVC
   *
   * @default {}
   */
  labels?: MariadbHelmValuesPrimaryPersistenceLabels;
  /**
   * MariaDB primary persistent volume claim annotations
   *
   * MariaDB primary persistent volume claim annotations
   *
   * @default {}
   */
  annotations?: MariadbHelmValuesPrimaryPersistenceAnnotations;
  /**
   * MariaDB primary persistent volume access Modes
   *
   * MariaDB primary persistent volume access Modes
   *
   * @default ["ReadWriteOnce"]
   */
  accessModes?: string[];
  /**
   * MariaDB primary persistent volume size
   *
   * MariaDB primary persistent volume size
   *
   * @default "8Gi"
   */
  size?: string;
  /**
   * Selector to match an existing Persistent Volume
   *
   * Selector to match an existing Persistent Volume
   *
   * @default {}
   */
  selector?: MariadbHelmValuesPrimaryPersistenceSelector;
};

export type MariadbHelmValuesPrimaryPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesPrimaryPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesPrimaryPersistenceSelector = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesPrimaryService = {
  /**
   * MariaDB Primary Kubernetes service type
   *
   * MariaDB Primary Kubernetes service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {"mysql":3306,"metrics":9104}
   */
  ports?: MariadbHelmValuesPrimaryServicePorts;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport
   *
   * @default {"mysql":""}
   */
  nodePorts?: MariadbHelmValuesPrimaryServiceNodePorts;
  /**
   * MariaDB Primary Kubernetes service clusterIP IP
   *
   * MariaDB Primary Kubernetes service clusterIP IP
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#internal-load-balancer
   *
   * MariaDB Primary loadBalancerIP if service type is `LoadBalancer`
   *
   * @default ""
   */
  loadBalancerIP?: string;
  /**
   * ref https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/#preserving-the-client-source-ip
   *
   * Enable client source IP preservation
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * https://kubernetes.io/docs/tasks/access-application-cluster/configure-cloud-provider-firewall/#restrict-access-for-loadbalancer-service
   * E.g.
   *
   * Address that are allowed when MariaDB Primary service is LoadBalancer
   *
   * @default []
   */
  loadBalancerSourceRanges?: unknown[];
  /**
   * Extra ports to expose (normally used with the `sidecar` value)
   *
   * Extra ports to expose (normally used with the `sidecar` value)
   *
   * @default []
   */
  extraPorts?: unknown[];
  /**
   * Provide any additional annotations which may be required
   *
   * Provide any additional annotations which may be required
   *
   * @default {}
   */
  annotations?: MariadbHelmValuesPrimaryServiceAnnotations;
  /**
   * If "ClientIP", consecutive client requests will be directed to the same Pod
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#virtual-ips-and-service-proxies
   *
   * Session Affinity for Kubernetes service, can be "None" or "ClientIP"
   *
   * @default "None"
   */
  sessionAffinity?: string;
  /**
   * Additional settings for the sessionAffinity. Ignored if `primary.service.sessionAffinity` is `None`
   *
   * Additional settings for the sessionAffinity
   *
   * @default {}
   */
  sessionAffinityConfig?: MariadbHelmValuesPrimaryServiceSessionAffinityConfig;
  /**
   * @default {"annotations":{}}
   */
  headless?: MariadbHelmValuesPrimaryServiceHeadless;
};

export type MariadbHelmValuesPrimaryServicePorts = {
  /**
   * MariaDB Primary Kubernetes service port for MariaDB
   *
   * MariaDB Primary Kubernetes service port for MariaDB
   *
   * @default 3306
   */
  mysql?: number;
  /**
   * MariaDB Primary Kubernetes service port for metrics
   *
   * MariaDB Primary Kubernetes service port for metrics
   *
   * @default 9104
   */
  metrics?: number;
};

export type MariadbHelmValuesPrimaryServiceNodePorts = {
  /**
   * MariaDB Primary Kubernetes service node port
   *
   * MariaDB Primary Kubernetes service node port
   *
   * @default ""
   */
  mysql?: string;
};

export type MariadbHelmValuesPrimaryServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesPrimaryServiceSessionAffinityConfig = object;

export type MariadbHelmValuesPrimaryServiceHeadless = {
  /**
   * Annotations of the headless service
   *
   * Annotations of the headless service
   *
   * @default {}
   */
  annotations?: MariadbHelmValuesPrimaryServiceHeadlessAnnotations;
};

export type MariadbHelmValuesPrimaryServiceHeadlessAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesPrimaryPdb = {
  /**
   * Enable/disable a Pod Disruption Budget creation for MariaDB primary pods
   *
   * Enable/disable a Pod Disruption Budget creation for MariaDB primary pods
   *
   * @default true
   */
  create?: boolean;
  /**
   * Minimum number/percentage of MariaDB primary pods that must still be available after the eviction
   *
   * Minimum number/percentage of MariaDB primary pods that must still be available after the eviction
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * Maximum number/percentage of MariaDB primary pods that can be unavailable after the eviction. Defaults to `1` if both `primary.pdb.minAvailable` and `primary.pdb.maxUnavailable` are empty.
   *
   * Maximum number/percentage of MariaDB primary pods that can be unavailable after the eviction. Defaults to `1` if both `primary.pdb.minAvailable` and `primary.pdb.maxUnavailable` are empty.
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type MariadbHelmValuesSecondary = {
  /**
   * Name of the secondary database (eg secondary, slave, ...)
   *
   * Name of the secondary database (eg secondary, slave, ...)
   *
   * @default "secondary"
   */
  name?: string;
  /**
   * Number of MariaDB secondary replicas
   *
   * Number of MariaDB secondary replicas
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * Override default container command on MariaDB Secondary container(s) (useful when using custom images)
   *
   * Override default container command on MariaDB Secondary container(s) (useful when using custom images)
   *
   * @default []
   */
  command?: unknown[];
  /**
   * Override default container args on MariaDB Secondary container(s) (useful when using custom images)
   *
   * Override default container args on MariaDB Secondary container(s) (useful when using custom images)
   *
   * @default []
   */
  args?: unknown[];
  /**
   * for the MariaDB Secondary container(s) to automate configuration before or after startup
   *
   * for the MariaDB Secondary container(s) to automate configuration before or after startup
   *
   * @default {}
   */
  lifecycleHooks?: MariadbHelmValuesSecondaryLifecycleHooks;
  /**
   * Mount Service Account token in pod
   *
   * Mount Service Account token in pod
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  /**
   * https://kubernetes.io/docs/concepts/services-networking/add-entries-to-pod-etc-hosts-with-host-aliases/
   *
   * Add deployment host aliases
   *
   * @default []
   */
  hostAliases?: unknown[];
  /**
   * @default {"mysql":3306}
   */
  containerPorts?: MariadbHelmValuesSecondaryContainerPorts;
  /**
   * ref: https://mysql.com/kb/en/mysql/configuring-mysql-with-mycnf/#example-of-configuration-file
   *
   * MariaDB Secondary configuration to be injected as ConfigMap
   *
   * @default """"
   */
  configuration?: string;
  /**
   * NOTE: When it's set the 'configuration' parameter is ignored
   *
   * Name of existing ConfigMap with MariaDB Secondary configuration.
   *
   * @default ""
   */
  existingConfigmap?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#update-strategies
   *
   * @default {"type":"RollingUpdate"}
   */
  updateStrategy?: MariadbHelmValuesSecondaryUpdateStrategy;
  /**
   * https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#partitions
   *
   * Partition update strategy for Mariadb Secondary statefulset
   *
   * @default ""
   */
  rollingUpdatePartition?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
   *
   * Additional pod annotations for MariaDB secondary pods
   *
   * @default {}
   */
  podAnnotations?: MariadbHelmValuesSecondaryPodAnnotations;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * Extra labels for MariaDB secondary pods
   *
   * @default {}
   */
  podLabels?: MariadbHelmValuesSecondaryPodLabels;
  /**
   * ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity
   *
   * MariaDB secondary pod affinity preset. Ignored if `secondary.affinity` is set. Allowed values: `soft` or `hard`
   *
   * @default ""
   */
  podAffinityPreset?: string;
  /**
   * Ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity
   *
   * MariaDB secondary pod anti-affinity preset. Ignored if `secondary.affinity` is set. Allowed values: `soft` or `hard`
   *
   * @default "soft"
   */
  podAntiAffinityPreset?: string;
  /**
   * Mariadb Secondary node affinity preset
   * Ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#node-affinity
   *
   * @default {"type":"","key":"","values":[]}
   */
  nodeAffinityPreset?: MariadbHelmValuesSecondaryNodeAffinityPreset;
  /**
   * Affinity for MariaDB secondary pods assignment
   *
   * Affinity for MariaDB secondary pods assignment
   *
   * @default {}
   */
  affinity?: MariadbHelmValuesSecondaryAffinity;
  /**
   * Ref: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
   *
   * Node labels for MariaDB secondary pods assignment
   *
   * @default {}
   */
  nodeSelector?: MariadbHelmValuesSecondaryNodeSelector;
  /**
   * Ref: https://kubernetes.io/docs/concepts/configuration/taint-and-toleration/
   *
   * Tolerations for MariaDB secondary pods assignment
   *
   * @default []
   */
  tolerations?: unknown[];
  /**
   * Topology Spread Constraints for MariaDB secondary pods assignment
   *
   * Topology Spread Constraints for MariaDB secondary pods assignment
   *
   * @default []
   */
  topologySpreadConstraints?: unknown[];
  /**
   * Ref: https://kubernetes.io/docs/concepts/configuration/pod-priority-preemption/
   *
   * Priority class for MariaDB secondary pods assignment
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Ref: https://kubernetes.io/docs/concepts/containers/runtime-class/
   *
   * Runtime Class for MariaDB secondary pods
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * ref: https://kubernetes.io/docs/tasks/administer-cluster/configure-multiple-schedulers/
   *
   * Name of the k8s scheduler (other than default)
   *
   * @default ""
   */
  schedulerName?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/pods/pod/#termination-of-pods
   *
   * @default ""
   */
  terminationGracePeriodSeconds?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#pod-management-policies
   *
   * podManagementPolicy to manage scaling operation of MariaDB secondary pods
   *
   * @default ""
   */
  podManagementPolicy?: string;
  /**
   * MariaDB secondary Pod security context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: MariadbHelmValuesSecondaryPodSecurityContext;
  /**
   * MariaDB secondary container security context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container
   *
   * @default {...} (10 keys)
   */
  containerSecurityContext?: MariadbHelmValuesSecondaryContainerSecurityContext;
  /**
   * MariaDB secondary container's resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   * We usually recommend not to specify default resources and to leave this as a conscious
   * choice for the user. This also increases chances charts run on environments with little
   * resources, such as Minikube. If you do want to specify resources, uncomment the following
   * lines, adjust them as necessary, and remove the curly braces after 'resources:'.
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * Set container resources according to one common preset (allowed values: none, nano, micro, small, medium, large, xlarge, 2xlarge). This is ignored if secondary.resources is set (secondary.resources is recommended for production).
   *
   * @default "micro"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * Set container requests and limits for different resources like CPU or memory (essential for production workloads)
   *
   * @default {}
   */
  resources?: MariadbHelmValuesSecondaryResources;
  /**
   * Configure extra options for MariaDB Secondary containers' liveness, readiness and startup probes
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/#configure-probes)
   *
   * @default {...} (6 keys)
   */
  startupProbe?: MariadbHelmValuesSecondaryStartupProbe;
  /**
   * Configure extra options for liveness probe
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/#configure-probes
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: MariadbHelmValuesSecondaryLivenessProbe;
  /**
   * @default {...} (6 keys)
   */
  readinessProbe?: MariadbHelmValuesSecondaryReadinessProbe;
  /**
   * Override default startup probe for MariaDB secondary containers
   *
   * Override default startup probe for MariaDB secondary containers
   *
   * @default {}
   */
  customStartupProbe?: MariadbHelmValuesSecondaryCustomStartupProbe;
  /**
   * Override default liveness probe for MariaDB secondary containers
   *
   * Override default liveness probe for MariaDB secondary containers
   *
   * @default {}
   */
  customLivenessProbe?: MariadbHelmValuesSecondaryCustomLivenessProbe;
  /**
   * Override default readiness probe for MariaDB secondary containers
   *
   * Override default readiness probe for MariaDB secondary containers
   *
   * @default {}
   */
  customReadinessProbe?: MariadbHelmValuesSecondaryCustomReadinessProbe;
  /**
   * `bitnami/mariadb` Docker image has built-in startup check mechanism,
   * which periodically checks if MariaDB service has started up and stops it
   * if all checks have failed after X tries. Use these to control these checks.
   * ref: https://github.com/bitnami/containers/tree/main/bitnami/mariadb/pull/240
   *
   * Override default builtin startup wait check options for MariaDB secondary containers
   *
   * @default {}
   */
  startupWaitOptions?: MariadbHelmValuesSecondaryStartupWaitOptions;
  /**
   * Can be used to specify command line flags, for example:
   * E.g.
   *
   * MariaDB secondary additional command line flags
   *
   * @default ""
   */
  extraFlags?: string;
  /**
   * E.g.
   *
   * Extra environment variables to be set on MariaDB secondary containers
   *
   * @default []
   */
  extraEnvVars?: unknown[];
  /**
   * Name of existing ConfigMap containing extra env vars for MariaDB secondary containers
   *
   * Name of existing ConfigMap containing extra env vars for MariaDB secondary containers
   *
   * @default ""
   */
  extraEnvVarsCM?: string;
  /**
   * Name of existing Secret containing extra env vars for MariaDB secondary containers
   *
   * Name of existing Secret containing extra env vars for MariaDB secondary containers
   *
   * @default ""
   */
  extraEnvVarsSecret?: string;
  /**
   * Enable persistence using Persistent Volume Claims
   * ref: https://kubernetes.io/docs/concepts/storage/persistent-volumes/
   *
   * @default {...} (8 keys)
   */
  persistence?: MariadbHelmValuesSecondaryPersistence;
  /**
   * Optionally specify extra list of additional volumes to the MariaDB secondary pod(s)
   *
   * Optionally specify extra list of additional volumes to the MariaDB secondary pod(s)
   *
   * @default []
   */
  extraVolumes?: unknown[];
  /**
   * Optionally specify extra list of additional volumeMounts for the MariaDB secondary container(s)
   *
   * Optionally specify extra list of additional volumeMounts for the MariaDB secondary container(s)
   *
   * @default []
   */
  extraVolumeMounts?: unknown[];
  /**
   * Add additional init containers for the MariaDB secondary pod(s)
   *
   * Add additional init containers for the MariaDB secondary pod(s)
   *
   * @default []
   */
  initContainers?: unknown[];
  /**
   * Add additional sidecar containers for the MariaDB secondary pod(s)
   *
   * Add additional sidecar containers for the MariaDB secondary pod(s)
   *
   * @default []
   */
  sidecars?: unknown[];
  /**
   * MariaDB Secondary Service parameters
   *
   * @default {...} (11 keys)
   */
  service?: MariadbHelmValuesSecondaryService;
  /**
   * ref: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
   *
   * @default {"create":true,"minAvailable":"","maxUnavailable":""}
   */
  pdb?: MariadbHelmValuesSecondaryPdb;
  /**
   * Maximum number of revisions that will be maintained in the StatefulSet
   *
   * Maximum number of revisions that will be maintained in the StatefulSet
   *
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * @default {"openssl":""}
   */
  fips?: MariadbHelmValuesSecondaryFips;
};

export type MariadbHelmValuesSecondaryLifecycleHooks = object;

export type MariadbHelmValuesSecondaryContainerPorts = {
  /**
   * Container port for mysql
   *
   * Container port for mysql
   *
   * @default 3306
   */
  mysql?: number;
};

export type MariadbHelmValuesSecondaryUpdateStrategy = {
  /**
   * StrategyType
   * Can be set to RollingUpdate or OnDelete
   *
   * MariaDB secondary statefulset strategy type
   *
   * @default "RollingUpdate"
   */
  type?: string;
};

export type MariadbHelmValuesSecondaryPodAnnotations = object;

export type MariadbHelmValuesSecondaryPodLabels = object;

export type MariadbHelmValuesSecondaryNodeAffinityPreset = {
  /**
   * MariaDB secondary node affinity preset type. Ignored if `secondary.affinity` is set. Allowed values: `soft` or `hard`
   *
   * MariaDB secondary node affinity preset type. Ignored if `secondary.affinity` is set. Allowed values: `soft` or `hard`
   *
   * @default ""
   */
  type?: string;
  /**
   * E.g.
   *
   * MariaDB secondary node label key to match Ignored if `secondary.affinity` is set.
   *
   * @default ""
   */
  key?: string;
  /**
   * E.g.
   *
   * MariaDB secondary node label values to match. Ignored if `secondary.affinity` is set.
   *
   * @default []
   */
  values?: unknown[];
};

export type MariadbHelmValuesSecondaryAffinity = object;

export type MariadbHelmValuesSecondaryNodeSelector = object;

export type MariadbHelmValuesSecondaryPodSecurityContext = {
  /**
   * Enable security context for MariaDB secondary pods
   *
   * Enable security context for MariaDB secondary pods
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Set filesystem group change policy
   *
   * Set filesystem group change policy
   *
   * @default "Always"
   */
  fsGroupChangePolicy?: string;
  /**
   * Set kernel settings using the sysctl interface
   *
   * Set kernel settings using the sysctl interface
   *
   * @default []
   */
  sysctls?: unknown[];
  /**
   * Set filesystem extra groups
   *
   * Set filesystem extra groups
   *
   * @default []
   */
  supplementalGroups?: unknown[];
  /**
   * Group ID for the mounted volumes' filesystem
   *
   * Group ID for the mounted volumes' filesystem
   *
   * @default 1001
   */
  fsGroup?: number;
};

export type MariadbHelmValuesSecondaryContainerSecurityContext = {
  /**
   * MariaDB secondary container securityContext
   *
   * MariaDB secondary container securityContext
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * [object,nullable] Set SELinux options in container
   *
   * @default {}
   */
  seLinuxOptions?: MariadbHelmValuesSecondaryContainerSecurityContextSeLinuxOptions;
  /**
   * User ID for the MariaDB secondary container
   *
   * User ID for the MariaDB secondary container
   *
   * @default 1001
   */
  runAsUser?: number;
  /**
   * Group ID for the MariaDB secondary container
   *
   * Group ID for the MariaDB secondary container
   *
   * @default 1001
   */
  runAsGroup?: number;
  /**
   * Set secondary container's Security Context runAsNonRoot
   *
   * Set secondary container's Security Context runAsNonRoot
   *
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * Set secondary container's Security Context privileged
   *
   * Set secondary container's Security Context privileged
   *
   * @default false
   */
  privileged?: boolean;
  /**
   * Set secondary container's Security Context allowPrivilegeEscalation
   *
   * Set secondary container's Security Context allowPrivilegeEscalation
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * Set container's Security Context readOnlyRootFilesystem
   *
   * Set container's Security Context readOnlyRootFilesystem
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: MariadbHelmValuesSecondaryContainerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: MariadbHelmValuesSecondaryContainerSecurityContextSeccompProfile;
};

export type MariadbHelmValuesSecondaryContainerSecurityContextSeLinuxOptions = object;

export type MariadbHelmValuesSecondaryContainerSecurityContextCapabilities = {
  /**
   * List of capabilities to be dropped
   *
   * List of capabilities to be dropped
   *
   * @default ["ALL"]
   */
  drop?: string[];
};

export type MariadbHelmValuesSecondaryContainerSecurityContextSeccompProfile = {
  /**
   * Set container's Security Context seccomp profile
   *
   * Set container's Security Context seccomp profile
   *
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type MariadbHelmValuesSecondaryResources = object;

export type MariadbHelmValuesSecondaryStartupProbe = {
  /**
   * Enable startupProbe
   *
   * Enable startupProbe
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for startupProbe
   *
   * Initial delay seconds for startupProbe
   *
   * @default 120
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for startupProbe
   *
   * Period seconds for startupProbe
   *
   * @default 15
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for startupProbe
   *
   * Timeout seconds for startupProbe
   *
   * @default 5
   */
  timeoutSeconds?: number;
  /**
   * Failure threshold for startupProbe
   *
   * Failure threshold for startupProbe
   *
   * @default 10
   */
  failureThreshold?: number;
  /**
   * Success threshold for startupProbe
   *
   * Success threshold for startupProbe
   *
   * @default 1
   */
  successThreshold?: number;
};

export type MariadbHelmValuesSecondaryLivenessProbe = {
  /**
   * Enable livenessProbe
   *
   * Enable livenessProbe
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for livenessProbe
   *
   * Initial delay seconds for livenessProbe
   *
   * @default 120
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for livenessProbe
   *
   * Period seconds for livenessProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for livenessProbe
   *
   * Timeout seconds for livenessProbe
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Failure threshold for livenessProbe
   *
   * Failure threshold for livenessProbe
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Success threshold for livenessProbe
   *
   * Success threshold for livenessProbe
   *
   * @default 1
   */
  successThreshold?: number;
};

export type MariadbHelmValuesSecondaryReadinessProbe = {
  /**
   * Enable readinessProbe
   *
   * Enable readinessProbe
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for readinessProbe
   *
   * Initial delay seconds for readinessProbe
   *
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for readinessProbe
   *
   * Period seconds for readinessProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for readinessProbe
   *
   * Timeout seconds for readinessProbe
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Failure threshold for readinessProbe
   *
   * Failure threshold for readinessProbe
   *
   * @default 3
   */
  failureThreshold?: number;
  /**
   * Success threshold for readinessProbe
   *
   * Success threshold for readinessProbe
   *
   * @default 1
   */
  successThreshold?: number;
};

export type MariadbHelmValuesSecondaryCustomStartupProbe = object;

export type MariadbHelmValuesSecondaryCustomLivenessProbe = object;

export type MariadbHelmValuesSecondaryCustomReadinessProbe = object;

export type MariadbHelmValuesSecondaryStartupWaitOptions = object;

export type MariadbHelmValuesSecondaryPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Enable persistence on MariaDB secondary replicas using a `PersistentVolumeClaim`
   *
   * Enable persistence on MariaDB secondary replicas using a `PersistentVolumeClaim`
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Subdirectory of the volume to mount at
   *
   * Subdirectory of the volume to mount at
   *
   * @default ""
   */
  subPath?: string;
  /**
   * If defined, storageClassName: <storageClass>
   * If set to "-", storageClassName: "", which disables dynamic provisioning
   * If undefined (the default) or set to null, no storageClassName spec is
   * set, choosing the default provisioner.  (gp2 on AWS, standard on
   * GKE, AWS & OpenStack)
   *
   * MariaDB secondary persistent volume storage Class
   *
   * @default ""
   */
  storageClass?: string;
  /**
   * Labels for the PVC
   *
   * Labels for the PVC
   *
   * @default {}
   */
  labels?: MariadbHelmValuesSecondaryPersistenceLabels;
  /**
   * MariaDB secondary persistent volume claim annotations
   *
   * MariaDB secondary persistent volume claim annotations
   *
   * @default {}
   */
  annotations?: MariadbHelmValuesSecondaryPersistenceAnnotations;
  /**
   * MariaDB secondary persistent volume access Modes
   *
   * MariaDB secondary persistent volume access Modes
   *
   * @default ["ReadWriteOnce"]
   */
  accessModes?: string[];
  /**
   * MariaDB secondary persistent volume size
   *
   * MariaDB secondary persistent volume size
   *
   * @default "8Gi"
   */
  size?: string;
  /**
   * Selector to match an existing Persistent Volume
   *
   * Selector to match an existing Persistent Volume
   *
   * @default {}
   */
  selector?: MariadbHelmValuesSecondaryPersistenceSelector;
};

export type MariadbHelmValuesSecondaryPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesSecondaryPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesSecondaryPersistenceSelector = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesSecondaryService = {
  /**
   * MariaDB secondary Kubernetes service type
   *
   * MariaDB secondary Kubernetes service type
   *
   * @default "ClusterIP"
   */
  type?: string;
  /**
   * @default {"mysql":3306,"metrics":9104}
   */
  ports?: MariadbHelmValuesSecondaryServicePorts;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport
   *
   * @default {"mysql":""}
   */
  nodePorts?: MariadbHelmValuesSecondaryServiceNodePorts;
  /**
   * MariaDB secondary Kubernetes service clusterIP IP
   *
   * MariaDB secondary Kubernetes service clusterIP IP
   *
   * @default ""
   */
  clusterIP?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#internal-load-balancer
   *
   * MariaDB secondary loadBalancerIP if service type is `LoadBalancer`
   *
   * @default ""
   */
  loadBalancerIP?: string;
  /**
   * ref https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/#preserving-the-client-source-ip
   *
   * Enable client source IP preservation
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * https://kubernetes.io/docs/tasks/access-application-cluster/configure-cloud-provider-firewall/#restrict-access-for-loadbalancer-service
   * E.g.
   *
   * Address that are allowed when MariaDB secondary service is LoadBalancer
   *
   * @default []
   */
  loadBalancerSourceRanges?: unknown[];
  /**
   * Extra ports to expose (normally used with the `sidecar` value)
   *
   * Extra ports to expose (normally used with the `sidecar` value)
   *
   * @default []
   */
  extraPorts?: unknown[];
  /**
   * Provide any additional annotations which may be required
   *
   * Provide any additional annotations which may be required
   *
   * @default {}
   */
  annotations?: MariadbHelmValuesSecondaryServiceAnnotations;
  /**
   * If "ClientIP", consecutive client requests will be directed to the same Pod
   * ref: https://kubernetes.io/docs/concepts/services-networking/service/#virtual-ips-and-service-proxies
   *
   * Session Affinity for Kubernetes service, can be "None" or "ClientIP"
   *
   * @default "None"
   */
  sessionAffinity?: string;
  /**
   * Additional settings for the sessionAffinity. Ignored if `secondary.service.sessionAffinity` is `None`
   *
   * Additional settings for the sessionAffinity
   *
   * @default {}
   */
  sessionAffinityConfig?: MariadbHelmValuesSecondaryServiceSessionAffinityConfig;
};

export type MariadbHelmValuesSecondaryServicePorts = {
  /**
   * MariaDB secondary Kubernetes service port for MariaDB
   *
   * MariaDB secondary Kubernetes service port for MariaDB
   *
   * @default 3306
   */
  mysql?: number;
  /**
   * MariaDB secondary Kubernetes service port for metrics
   *
   * MariaDB secondary Kubernetes service port for metrics
   *
   * @default 9104
   */
  metrics?: number;
};

export type MariadbHelmValuesSecondaryServiceNodePorts = {
  /**
   * MariaDB secondary Kubernetes service node port
   *
   * MariaDB secondary Kubernetes service node port
   *
   * @default ""
   */
  mysql?: string;
};

export type MariadbHelmValuesSecondaryServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesSecondaryServiceSessionAffinityConfig = object;

export type MariadbHelmValuesSecondaryPdb = {
  /**
   * Enable/disable a Pod Disruption Budget creation for MariaDB secondary pods
   *
   * Enable/disable a Pod Disruption Budget creation for MariaDB secondary pods
   *
   * @default true
   */
  create?: boolean;
  /**
   * Minimum number/percentage of MariaDB secondary pods that should remain scheduled
   *
   * Minimum number/percentage of MariaDB secondary pods that should remain scheduled
   *
   * @default ""
   */
  minAvailable?: string;
  /**
   * Maximum number/percentage of MariaDB secondary pods that may be made unavailable. Defaults to `1` if both `secondary.pdb.minAvailable` and `secondary.pdb.maxUnavailable` are empty.
   *
   * Maximum number/percentage of MariaDB secondary pods that may be made unavailable. Defaults to `1` if both `secondary.pdb.minAvailable` and `secondary.pdb.maxUnavailable` are empty.
   *
   * @default ""
   */
  maxUnavailable?: string;
};

export type MariadbHelmValuesSecondaryFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
};

export type MariadbHelmValuesServiceAccount = {
  /**
   * Enable the creation of a ServiceAccount for MariaDB pods
   *
   * Enable the creation of a ServiceAccount for MariaDB pods
   *
   * @default true
   */
  create?: boolean;
  /**
   * If not set and create is true, a name is generated using the mariadb.fullname template
   *
   * Name of the created ServiceAccount
   *
   * @default ""
   */
  name?: string;
  /**
   * Annotations for MariaDB Service Account
   *
   * Annotations for MariaDB Service Account
   *
   * @default {}
   */
  annotations?: MariadbHelmValuesServiceAccountAnnotations;
  /**
   * Automount service account token for the server service account
   *
   * Automount service account token for the server service account
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
};

export type MariadbHelmValuesServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesRbac = {
  /**
   * Whether to create and use RBAC resources or not
   *
   * Whether to create and use RBAC resources or not
   *
   * @default false
   */
  create?: boolean;
};

export type MariadbHelmValuesPasswordUpdateJob = {
  /**
   * Enable password update job
   *
   * Enable password update job
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * set backoff limit of the job
   *
   * set backoff limit of the job
   *
   * @default 10
   */
  backoffLimit?: number;
  /**
   * Override default container command on MariaDB Primary container(s) (useful when using custom images)
   *
   * Override default container command on MariaDB Primary container(s) (useful when using custom images)
   *
   * @default []
   */
  command?: unknown[];
  /**
   * Override default container args on MariaDB Primary container(s) (useful when using custom images)
   *
   * Override default container args on MariaDB Primary container(s) (useful when using custom images)
   *
   * @default []
   */
  args?: unknown[];
  /**
   * Extra commands to pass to the generation job
   *
   * Extra commands to pass to the generation job
   *
   * @default ""
   */
  extraCommands?: string;
  /**
   * @default {...} (4 keys)
   */
  previousPasswords?: MariadbHelmValuesPasswordUpdateJobPreviousPasswords;
  /**
   * Configure Container Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container
   *
   * @default {...} (10 keys)
   */
  containerSecurityContext?: MariadbHelmValuesPasswordUpdateJobContainerSecurityContext;
  /**
   * Configure Pods Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod
   *
   * @default {...} (5 keys)
   */
  podSecurityContext?: MariadbHelmValuesPasswordUpdateJobPodSecurityContext;
  /**
   * For example:
   *
   * Array containing extra env vars to configure the credential init job
   *
   * @default []
   */
  extraEnvVars?: unknown[];
  /**
   * ConfigMap containing extra env vars to configure the credential init job
   *
   * ConfigMap containing extra env vars to configure the credential init job
   *
   * @default ""
   */
  extraEnvVarsCM?: string;
  /**
   * Secret containing extra env vars to configure the credential init job (in case of sensitive data)
   *
   * Secret containing extra env vars to configure the credential init job (in case of sensitive data)
   *
   * @default ""
   */
  extraEnvVarsSecret?: string;
  /**
   * Optionally specify extra list of additional volumes for the credential init job
   *
   * Optionally specify extra list of additional volumes for the credential init job
   *
   * @default []
   */
  extraVolumes?: unknown[];
  /**
   * Array of extra volume mounts to be added to the jwt Container (evaluated as template). Normally used with `extraVolumes`.
   *
   * Array of extra volume mounts to be added to the jwt Container (evaluated as template). Normally used with `extraVolumes`.
   *
   * @default []
   */
  extraVolumeMounts?: unknown[];
  /**
   * Add additional init containers for the MariaDB Primary pod(s)
   *
   * Add additional init containers for the MariaDB Primary pod(s)
   *
   * @default []
   */
  initContainers?: unknown[];
  /**
   * Container resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * Set container resources according to one common preset (allowed values: none, nano, micro, small, medium, large, xlarge, 2xlarge). This is ignored if passwordUpdateJob.resources is set (passwordUpdateJob.resources is recommended for production).
   *
   * @default "micro"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * Set container requests and limits for different resources like CPU or memory (essential for production workloads)
   *
   * @default {}
   */
  resources?: MariadbHelmValuesPasswordUpdateJobResources;
  /**
   * Custom livenessProbe that overrides the default one
   *
   * Custom livenessProbe that overrides the default one
   *
   * @default {}
   */
  customLivenessProbe?: MariadbHelmValuesPasswordUpdateJobCustomLivenessProbe;
  /**
   * Custom readinessProbe that overrides the default one
   *
   * Custom readinessProbe that overrides the default one
   *
   * @default {}
   */
  customReadinessProbe?: MariadbHelmValuesPasswordUpdateJobCustomReadinessProbe;
  /**
   * Custom startupProbe that overrides the default one
   *
   * Custom startupProbe that overrides the default one
   *
   * @default {}
   */
  customStartupProbe?: MariadbHelmValuesPasswordUpdateJobCustomStartupProbe;
  /**
   * Mount Service Account token in pod
   *
   * Mount Service Account token in pod
   *
   * @default false
   */
  automountServiceAccountToken?: boolean;
  /**
   * https://kubernetes.io/docs/concepts/services-networking/add-entries-to-pod-etc-hosts-with-host-aliases/
   *
   * Add deployment host aliases
   *
   * @default []
   */
  hostAliases?: unknown[];
  /**
   * [object] Add annotations to the job
   *
   * @default {}
   */
  annotations?: MariadbHelmValuesPasswordUpdateJobAnnotations;
  /**
   * Ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * Additional pod labels
   *
   * @default {}
   */
  podLabels?: MariadbHelmValuesPasswordUpdateJobPodLabels;
  /**
   * ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
   *
   * Additional pod annotations
   *
   * @default {}
   */
  podAnnotations?: MariadbHelmValuesPasswordUpdateJobPodAnnotations;
  /**
   * @default {"openssl":""}
   */
  fips?: MariadbHelmValuesPasswordUpdateJobFips;
};

export type MariadbHelmValuesPasswordUpdateJobPreviousPasswords = {
  /**
   * Previous root password (set if the password secret was already changed)
   *
   * Previous root password (set if the password secret was already changed)
   *
   * @default ""
   */
  rootPassword?: string;
  /**
   * Previous password (set if the password secret was already changed)
   *
   * Previous password (set if the password secret was already changed)
   *
   * @default ""
   */
  password?: string;
  /**
   * Previous replication password (set if the password secret was already changed)
   *
   * Previous replication password (set if the password secret was already changed)
   *
   * @default ""
   */
  replicationPassword?: string;
  /**
   * Name of a secret containing the previous passwords (set if the password secret was already changed)
   *
   * Name of a secret containing the previous passwords (set if the password secret was already changed)
   *
   * @default ""
   */
  existingSecret?: string;
};

export type MariadbHelmValuesPasswordUpdateJobContainerSecurityContext = {
  /**
   * Enabled containers' Security Context
   *
   * Enabled containers' Security Context
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * [object,nullable] Set SELinux options in container
   *
   * @default {}
   */
  seLinuxOptions?: MariadbHelmValuesPasswordUpdateJobContainerSecurityContextSeLinuxOptions;
  /**
   * Set containers' Security Context runAsUser
   *
   * Set containers' Security Context runAsUser
   *
   * @default 1001
   */
  runAsUser?: number;
  /**
   * Set containers' Security Context runAsGroup
   *
   * Set containers' Security Context runAsGroup
   *
   * @default 1001
   */
  runAsGroup?: number;
  /**
   * Set container's Security Context runAsNonRoot
   *
   * Set container's Security Context runAsNonRoot
   *
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * Set container's Security Context privileged
   *
   * Set container's Security Context privileged
   *
   * @default false
   */
  privileged?: boolean;
  /**
   * Set container's Security Context readOnlyRootFilesystem
   *
   * Set container's Security Context readOnlyRootFilesystem
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * Set container's Security Context allowPrivilegeEscalation
   *
   * Set container's Security Context allowPrivilegeEscalation
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: MariadbHelmValuesPasswordUpdateJobContainerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: MariadbHelmValuesPasswordUpdateJobContainerSecurityContextSeccompProfile;
};

export type MariadbHelmValuesPasswordUpdateJobContainerSecurityContextSeLinuxOptions = object;

export type MariadbHelmValuesPasswordUpdateJobContainerSecurityContextCapabilities = {
  /**
   * List of capabilities to be dropped
   *
   * List of capabilities to be dropped
   *
   * @default ["ALL"]
   */
  drop?: string[];
};

export type MariadbHelmValuesPasswordUpdateJobContainerSecurityContextSeccompProfile = {
  /**
   * Set container's Security Context seccomp profile
   *
   * Set container's Security Context seccomp profile
   *
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type MariadbHelmValuesPasswordUpdateJobPodSecurityContext = {
  /**
   * Enabled credential init job pods' Security Context
   *
   * Enabled credential init job pods' Security Context
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Set filesystem group change policy
   *
   * Set filesystem group change policy
   *
   * @default "Always"
   */
  fsGroupChangePolicy?: string;
  /**
   * Set kernel settings using the sysctl interface
   *
   * Set kernel settings using the sysctl interface
   *
   * @default []
   */
  sysctls?: unknown[];
  /**
   * Set filesystem extra groups
   *
   * Set filesystem extra groups
   *
   * @default []
   */
  supplementalGroups?: unknown[];
  /**
   * Set credential init job pod's Security Context fsGroup
   *
   * Set credential init job pod's Security Context fsGroup
   *
   * @default 1001
   */
  fsGroup?: number;
};

export type MariadbHelmValuesPasswordUpdateJobResources = object;

export type MariadbHelmValuesPasswordUpdateJobCustomLivenessProbe = object;

export type MariadbHelmValuesPasswordUpdateJobCustomReadinessProbe = object;

export type MariadbHelmValuesPasswordUpdateJobCustomStartupProbe = object;

export type MariadbHelmValuesPasswordUpdateJobAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesPasswordUpdateJobPodLabels = object;

export type MariadbHelmValuesPasswordUpdateJobPodAnnotations = object;

export type MariadbHelmValuesPasswordUpdateJobFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
};

export type MariadbHelmValuesVolumePermissions = {
  /**
   * Enable init container that changes the owner and group of the persistent volume(s) mountpoint to `runAsUser:fsGroup`
   *
   * Enable init container that changes the owner and group of the persistent volume(s) mountpoint to `runAsUser:fsGroup`
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @skip volumePermissions.image.tag Init container volume-permissions image tag (immutable tags are recommended)
   *
   * @default {...} (6 keys)
   */
  image?: MariadbHelmValuesVolumePermissionsImage;
  /**
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * Set container resources according to one common preset (allowed values: none, nano, micro, small, medium, large, xlarge, 2xlarge). This is ignored if volumePermissions.resources is set (volumePermissions.resources is recommended for production).
   *
   * @default "nano"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * Set container requests and limits for different resources like CPU or memory (essential for production workloads)
   *
   * @default {}
   */
  resources?: MariadbHelmValuesVolumePermissionsResources;
  /**
   * @default {"openssl":""}
   */
  fips?: MariadbHelmValuesVolumePermissionsFips;
};

export type MariadbHelmValuesVolumePermissionsImage = {
  /**
   * [default: REGISTRY_NAME] Init container volume-permissions image registry
   *
   * Init container volume-permissions image registry
   *
   * @default "REGISTRY_NAME"
   */
  registry?: string;
  /**
   * [default: REPOSITORY_NAME/os-shell] Init container volume-permissions image repository
   *
   * Init container volume-permissions image repository
   *
   * @default "REPOSITORY_NAME/os-shell"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * Init container volume-permissions image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * Init container volume-permissions image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * @default ""
   */
  digest?: string;
  /**
   * Init container volume-permissions image pull policy
   *
   * Init container volume-permissions image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * Optionally specify an array of imagePullSecrets (secrets must be manually created in the namespace)
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/
   * Example:
   * pullSecrets:
   * - myRegistryKeySecretName
   *
   * Specify docker-registry secret names as an array
   *
   * @default []
   */
  pullSecrets?: unknown[];
};

export type MariadbHelmValuesVolumePermissionsResources = object;

export type MariadbHelmValuesVolumePermissionsFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
};

export type MariadbHelmValuesMetrics = {
  /**
   * Start a side-car prometheus exporter
   *
   * Start a side-car prometheus exporter
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @skip metrics.image.tag Exporter image tag (immutable tags are recommended)
   *
   * @default {...} (6 keys)
   */
  image?: MariadbHelmValuesMetricsImage;
  /**
   * [object] Annotations for the Exporter pod
   *
   * @default {"prometheus.io/scrape":"true","prometheus.io/port":"9104"}
   */
  annotations?: MariadbHelmValuesMetricsAnnotations;
  /**
   * ref: https://github.com/prometheus/mysqld_exporter/
   * E.g.
   * - --collect.auto_increment.columns
   * - --collect.binlog_size
   * - --collect.engine_innodb_status
   * - --collect.engine_tokudb_status
   * - --collect.global_status
   * - --collect.global_variables
   * - --collect.info_schema.clientstats
   * - --collect.info_schema.innodb_metrics
   * - --collect.info_schema.innodb_tablespaces
   * - --collect.info_schema.innodb_cmp
   * - --collect.info_schema.innodb_cmpmem
   * - --collect.info_schema.processlist
   * - --collect.info_schema.processlist.min_time
   * - --collect.info_schema.query_response_time
   * - --collect.info_schema.tables
   * - --collect.info_schema.tables.databases
   * - --collect.info_schema.tablestats
   * - --collect.info_schema.userstats
   * - --collect.perf_schema.eventsstatements
   * - --collect.perf_schema.eventsstatements.digest_text_limit
   * - --collect.perf_schema.eventsstatements.limit
   * - --collect.perf_schema.eventsstatements.timelimit
   * - --collect.perf_schema.eventswaits
   * - --collect.perf_schema.file_events
   * - --collect.perf_schema.file_instances
   * - --collect.perf_schema.indexiowaits
   * - --collect.perf_schema.tableiowaits
   * - --collect.perf_schema.tablelocks
   * - --collect.perf_schema.replication_group_member_stats
   * - --collect.slave_status
   * - --collect.slave_hosts
   * - --collect.heartbeat
   * - --collect.heartbeat.database
   * - --collect.heartbeat.table
   *
   * @default {"primary":[],"secondary":[]}
   */
  extraArgs?: MariadbHelmValuesMetricsExtraArgs;
  /**
   * [object] Optionally specify extra list of additional volumeMounts for the MariaDB metrics container(s)
   *
   * @default {"primary":[],"secondary":[]}
   */
  extraVolumeMounts?: MariadbHelmValuesMetricsExtraVolumeMounts;
  /**
   * @default {"http":9104}
   */
  containerPorts?: MariadbHelmValuesMetricsContainerPorts;
  /**
   * MariaDB metrics container Security Context
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-container
   * Example:
   * containerSecurityContext:
   * capabilities:
   * readOnlyRootFilesystem: true
   *
   * @default {...} (10 keys)
   */
  containerSecurityContext?: MariadbHelmValuesMetricsContainerSecurityContext;
  /**
   * Mysqld Prometheus exporter resource requests and limits
   * ref: https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/
   * We usually recommend not to specify default resources and to leave this as a conscious
   * choice for the user. This also increases chances charts run on environments with little
   * resources, such as Minikube. If you do want to specify resources, uncomment the following
   * lines, adjust them as necessary, and remove the curly braces after 'resources:'.
   * More information: https://github.com/bitnami/charts/blob/main/bitnami/common/templates/_resources.tpl#L15
   *
   * Set container resources according to one common preset (allowed values: none, nano, micro, small, medium, large, xlarge, 2xlarge). This is ignored if metrics.resources is set (metrics.resources is recommended for production).
   *
   * @default "nano"
   */
  resourcesPreset?: string;
  /**
   * Example:
   * resources:
   * requests:
   * limits:
   * memory: 1024Mi
   *
   * Set container requests and limits for different resources like CPU or memory (essential for production workloads)
   *
   * @default {}
   */
  resources?: MariadbHelmValuesMetricsResources;
  /**
   * @default {"openssl":"","golang":"relaxed"}
   */
  fips?: MariadbHelmValuesMetricsFips;
  /**
   * Configure extra options for liveness probe
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/#configure-probes
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: MariadbHelmValuesMetricsLivenessProbe;
  /**
   * Configure extra options for readiness probe
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/#configure-probes
   *
   * @default {...} (6 keys)
   */
  readinessProbe?: MariadbHelmValuesMetricsReadinessProbe;
  /**
   * Prometheus Service Monitor
   * ref: https://github.com/coreos/prometheus-operator
   *
   * @default {...} (10 keys)
   */
  serviceMonitor?: MariadbHelmValuesMetricsServiceMonitor;
  /**
   * Prometheus Operator PrometheusRule configuration
   *
   * @default {...} (4 keys)
   */
  prometheusRule?: MariadbHelmValuesMetricsPrometheusRule;
};

export type MariadbHelmValuesMetricsImage = {
  /**
   * [default: REGISTRY_NAME] Exporter image registry
   *
   * Exporter image registry
   *
   * @default "REGISTRY_NAME"
   */
  registry?: string;
  /**
   * [default: REPOSITORY_NAME/mysqld-exporter] Exporter image repository
   *
   * Exporter image repository
   *
   * @default "REPOSITORY_NAME/mysqld-exporter"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * Exporter image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * Exporter image digest in the way sha256:aa.... Please note this parameter, if set, will override the tag
   *
   * @default ""
   */
  digest?: string;
  /**
   * Exporter image pull policy
   *
   * Exporter image pull policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  /**
   * Optionally specify an array of imagePullSecrets (secrets must be manually created in the namespace)
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/
   * Example:
   * pullSecrets:
   * - myRegistryKeySecretName
   *
   * Specify docker-registry secret names as an array
   *
   * @default []
   */
  pullSecrets?: unknown[];
};

export type MariadbHelmValuesMetricsAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "true"
   */
  "prometheus.io/scrape"?: boolean;
  /**
   * @default "9104"
   */
  "prometheus.io/port"?: number;
};

export type MariadbHelmValuesMetricsExtraArgs = {
  primary?: unknown[];
  secondary?: unknown[];
};

export type MariadbHelmValuesMetricsExtraVolumeMounts = {
  primary?: unknown[];
  secondary?: unknown[];
};

export type MariadbHelmValuesMetricsContainerPorts = {
  /**
   * Container port for http
   *
   * Container port for http
   *
   * @default 9104
   */
  http?: number;
};

export type MariadbHelmValuesMetricsContainerSecurityContext = {
  /**
   * Enable security context for MariaDB metrics container
   *
   * Enable security context for MariaDB metrics container
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Set metrics container's Security Context privileged
   *
   * Set metrics container's Security Context privileged
   *
   * @default false
   */
  privileged?: boolean;
  /**
   * Set metrics container's Security Context runAsNonRoot
   *
   * Set metrics container's Security Context runAsNonRoot
   *
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * [object,nullable] Set SELinux options in container
   *
   * @default {}
   */
  seLinuxOptions?: MariadbHelmValuesMetricsContainerSecurityContextSeLinuxOptions;
  /**
   * User ID for the MariaDB metrics container
   *
   * User ID for the MariaDB metrics container
   *
   * @default 1001
   */
  runAsUser?: number;
  /**
   * Group ID for the MariaDB metrics container
   *
   * Group ID for the MariaDB metrics container
   *
   * @default 1001
   */
  runAsGroup?: number;
  /**
   * Set container's Security Context readOnlyRootFilesystem
   *
   * Set container's Security Context readOnlyRootFilesystem
   *
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * Set metrics container's Security Context allowPrivilegeEscalation
   *
   * Set metrics container's Security Context allowPrivilegeEscalation
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: MariadbHelmValuesMetricsContainerSecurityContextCapabilities;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: MariadbHelmValuesMetricsContainerSecurityContextSeccompProfile;
};

export type MariadbHelmValuesMetricsContainerSecurityContextSeLinuxOptions = object;

export type MariadbHelmValuesMetricsContainerSecurityContextCapabilities = {
  /**
   * List of capabilities to be dropped
   *
   * List of capabilities to be dropped
   *
   * @default ["ALL"]
   */
  drop?: string[];
};

export type MariadbHelmValuesMetricsContainerSecurityContextSeccompProfile = {
  /**
   * Set container's Security Context seccomp profile
   *
   * Set container's Security Context seccomp profile
   *
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type MariadbHelmValuesMetricsResources = object;

export type MariadbHelmValuesMetricsFips = {
  /**
   * Configure OpenSSL FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default ""
   */
  openssl?: string;
  /**
   * Configure Golang FIPS mode: '', 'restricted', 'relaxed', 'off'. If empty (""), 'global.defaultFips' would be used
   *
   * @default "relaxed"
   */
  golang?: string;
};

export type MariadbHelmValuesMetricsLivenessProbe = {
  /**
   * Enable livenessProbe
   *
   * Enable livenessProbe
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for livenessProbe
   *
   * Initial delay seconds for livenessProbe
   *
   * @default 120
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for livenessProbe
   *
   * Period seconds for livenessProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for livenessProbe
   *
   * Timeout seconds for livenessProbe
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for livenessProbe
   *
   * Success threshold for livenessProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for livenessProbe
   *
   * Failure threshold for livenessProbe
   *
   * @default 3
   */
  failureThreshold?: number;
};

export type MariadbHelmValuesMetricsReadinessProbe = {
  /**
   * Enable readinessProbe
   *
   * Enable readinessProbe
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Initial delay seconds for readinessProbe
   *
   * Initial delay seconds for readinessProbe
   *
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * Period seconds for readinessProbe
   *
   * Period seconds for readinessProbe
   *
   * @default 10
   */
  periodSeconds?: number;
  /**
   * Timeout seconds for readinessProbe
   *
   * Timeout seconds for readinessProbe
   *
   * @default 1
   */
  timeoutSeconds?: number;
  /**
   * Success threshold for readinessProbe
   *
   * Success threshold for readinessProbe
   *
   * @default 1
   */
  successThreshold?: number;
  /**
   * Failure threshold for readinessProbe
   *
   * Failure threshold for readinessProbe
   *
   * @default 3
   */
  failureThreshold?: number;
};

export type MariadbHelmValuesMetricsServiceMonitor = {
  /**
   * Create ServiceMonitor Resource for scraping metrics using PrometheusOperator
   *
   * Create ServiceMonitor Resource for scraping metrics using PrometheusOperator
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Namespace which Prometheus is running in
   *
   * Namespace which Prometheus is running in
   *
   * @default ""
   */
  namespace?: string;
  /**
   * The name of the label on the target service to use as the job name in prometheus.
   *
   * The name of the label on the target service to use as the job name in prometheus.
   *
   * @default ""
   */
  jobLabel?: string;
  /**
   * Interval at which metrics should be scraped
   *
   * Interval at which metrics should be scraped
   *
   * @default "30s"
   */
  interval?: string;
  /**
   * Specify the timeout after which the scrape is ended
   *
   * Specify the timeout after which the scrape is ended
   *
   * @default ""
   */
  scrapeTimeout?: string;
  /**
   * ref: https://github.com/coreos/prometheus-operator/blob/master/Documentation/api.md#relabelconfig
   *
   * RelabelConfigs to apply to samples before scraping
   *
   * @default []
   */
  relabelings?: unknown[];
  /**
   * ref: https://github.com/coreos/prometheus-operator/blob/master/Documentation/api.md#relabelconfig
   *
   * MetricRelabelConfigs to apply to samples before ingestion
   *
   * @default []
   */
  metricRelabelings?: unknown[];
  /**
   * honorLabels chooses the metric's labels on collisions with target labels
   *
   * honorLabels chooses the metric's labels on collisions with target labels
   *
   * @default false
   */
  honorLabels?: boolean;
  /**
   * ref: https://github.com/bitnami/charts/tree/main/bitnami/prometheus-operator#prometheus-configuration
   *
   * ServiceMonitor selector labels
   *
   * @default {}
   */
  selector?: MariadbHelmValuesMetricsServiceMonitorSelector;
  /**
   * Extra labels for the ServiceMonitor
   *
   * Extra labels for the ServiceMonitor
   *
   * @default {}
   */
  labels?: MariadbHelmValuesMetricsServiceMonitorLabels;
};

export type MariadbHelmValuesMetricsServiceMonitorSelector = object;

export type MariadbHelmValuesMetricsServiceMonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MariadbHelmValuesMetricsPrometheusRule = {
  /**
   * if `true`, creates a Prometheus Operator PrometheusRule (also requires `metrics.enabled` to be `true` and `metrics.prometheusRule.rules`)
   *
   * if `true`, creates a Prometheus Operator PrometheusRule (also requires `metrics.enabled` to be `true` and `metrics.prometheusRule.rules`)
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Namespace for the PrometheusRule Resource (defaults to the Release Namespace)
   *
   * Namespace for the PrometheusRule Resource (defaults to the Release Namespace)
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Additional labels that can be used so PrometheusRule will be discovered by Prometheus
   *
   * Additional labels that can be used so PrometheusRule will be discovered by Prometheus
   *
   * @default {}
   */
  additionalLabels?: MariadbHelmValuesMetricsPrometheusRuleAdditionalLabels;
  /**
   * Prometheus Rule definitions
   *
   * Prometheus Rule definitions
   *
   * @default []
   */
  rules?: unknown[];
};

export type MariadbHelmValuesMetricsPrometheusRuleAdditionalLabels = object;

export type MariadbHelmValuesNetworkPolicy = {
  /**
   * Enable creation of NetworkPolicy resources
   *
   * Enable creation of NetworkPolicy resources
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * When set to false, only pods with the correct client label will have network access to the ports MariaDB is
   * listening on. When true, MariaDB will accept connections from any source (with the correct destination port).
   *
   * The Policy model to apply
   *
   * @default true
   */
  allowExternal?: boolean;
  /**
   * Allow the pod to access any range of port and all destinations.
   *
   * Allow the pod to access any range of port and all destinations.
   *
   * @default true
   */
  allowExternalEgress?: boolean;
  /**
   * [array] Add extra ingress rules to the NetworkPolicy
   *
   * Add extra ingress rules to the NetworkPolicy
   *
   * @default "[]"
   */
  extraIngress?: string[];
  /**
   * [array] Add extra ingress rules to the NetworkPolicy
   *
   * Add extra ingress rules to the NetworkPolicy
   *
   * @default "[]"
   */
  extraEgress?: string[];
  /**
   * [object] Labels to match to allow traffic from other namespaces
   *
   * @default {}
   */
  ingressNSMatchLabels?: MariadbHelmValuesNetworkPolicyIngressNSMatchLabels;
  /**
   * [object] Pod labels to match to allow traffic from other namespaces
   *
   * @default {}
   */
  ingressNSPodMatchLabels?: MariadbHelmValuesNetworkPolicyIngressNSPodMatchLabels;
};

export type MariadbHelmValuesNetworkPolicyIngressNSMatchLabels = object;

export type MariadbHelmValuesNetworkPolicyIngressNSPodMatchLabels = object;

export type MariadbHelmValues = {
  /**
   * Copyright Broadcom, Inc. All Rights Reserved.
   * Global Docker image parameters
   * Please, note that this will override the image parameters, including dependencies, configured to use the global value
   * Current available global Docker image parameters: imageRegistry, imagePullSecrets and storageClass
   *
   * @default {...} (6 keys)
   */
  global?: MariadbHelmValuesGlobal;
  /**
   * Common parameters
   *
   * Force target Kubernetes version (using Helm capabilities if not set)
   *
   * @default ""
   */
  kubeVersion?: string;
  /**
   * String to partially override mariadb.fullname
   *
   * String to partially override mariadb.fullname
   *
   * @default ""
   */
  nameOverride?: string;
  /**
   * String to fully override mariadb.fullname
   *
   * String to fully override mariadb.fullname
   *
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * Default Kubernetes cluster domain
   *
   * Default Kubernetes cluster domain
   *
   * @default "cluster.local"
   */
  clusterDomain?: string;
  /**
   * Common annotations to add to all MariaDB resources (sub-charts are not considered)
   *
   * Common annotations to add to all MariaDB resources (sub-charts are not considered)
   *
   * @default {}
   */
  commonAnnotations?: MariadbHelmValuesCommonAnnotations;
  /**
   * Common labels to add to all MariaDB resources (sub-charts are not considered)
   *
   * Common labels to add to all MariaDB resources (sub-charts are not considered)
   *
   * @default {}
   */
  commonLabels?: MariadbHelmValuesCommonLabels;
  /**
   * ref: https://kubernetes.io/docs/tasks/administer-cluster/configure-multiple-schedulers/
   *
   * Name of the scheduler (other than default) to dispatch pods
   *
   * @default ""
   */
  schedulerName?: string;
  /**
   * ref: https://kubernetes.io/docs/concepts/containers/runtime-class/
   *
   * Name of the Runtime Class for all MariaDB pods
   *
   * @default ""
   */
  runtimeClassName?: string;
  /**
   * Array of extra objects to deploy with the release (evaluated as a template)
   *
   * Array of extra objects to deploy with the release (evaluated as a template)
   *
   * @default []
   */
  extraDeploy?: unknown[];
  /**
   * Enable diagnostic mode in the deployment
   *
   * @default {"enabled":false,"command":["sleep"],"args":["infinity"]}
   */
  diagnosticMode?: MariadbHelmValuesDiagnosticMode;
  /**
   * Ref: https://servicebinding.io/service-provider/
   *
   * @default {"enabled":false}
   */
  serviceBindings?: MariadbHelmValuesServiceBindings;
  /**
   * MariaDB common parameters
   * Bitnami MariaDB image
   * ref: https://hub.docker.com/r/bitnami/mariadb/tags/
   * @skip image.tag MariaDB image tag (immutable tags are recommended)
   *
   * @default {...} (7 keys)
   */
  image?: MariadbHelmValuesImage;
  /**
   * MariaDB architecture (`standalone` or `replication`)
   *
   * MariaDB architecture (`standalone` or `replication`)
   *
   * @default "standalone"
   */
  architecture?: string;
  /**
   * MariaDB Authentication parameters
   *
   * @default {...} (10 keys)
   */
  auth?: MariadbHelmValuesAuth;
  /**
   * Specify dictionary of scripts to be run at first boot
   * Example:
   * initdbScripts:
   * my_init_script.sh: |
   * !/bin/bash
   * echo "Do something."
   *
   * Dictionary of initdb scripts
   *
   * @default {}
   */
  initdbScripts?: MariadbHelmValuesInitdbScripts;
  /**
   * ConfigMap with the initdb scripts (Note: Overrides `initdbScripts`)
   *
   * ConfigMap with the initdb scripts (Note: Overrides `initdbScripts`)
   *
   * @default ""
   */
  initdbScriptsConfigMap?: string;
  /**
   * TLS/SSL parameters
   *
   * @default {...} (9 keys)
   */
  tls?: MariadbHelmValuesTls;
  /**
   * Transparent Data Encryption parameters
   * ref: https://mariadb.com/kb/en/file-key-management-encryption-plugin/
   *
   * @default {...} (14 keys)
   */
  tde?: MariadbHelmValuesTde;
  /**
   * MariaDB Primary parameters
   * Mariadb Primary parameters
   *
   * @default {...} (49 keys)
   */
  primary?: MariadbHelmValuesPrimary;
  /**
   * MariaDB Secondary parameters
   * Mariadb Secondary parameters
   *
   * @default {...} (50 keys)
   */
  secondary?: MariadbHelmValuesSecondary;
  /**
   * RBAC parameters
   * MariaDB pods ServiceAccount
   * ref: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
   *
   * @default {...} (4 keys)
   */
  serviceAccount?: MariadbHelmValuesServiceAccount;
  /**
   * Role Based Access
   * ref: https://kubernetes.io/docs/admin/authorization/rbac/
   *
   * @default {"create":false}
   */
  rbac?: MariadbHelmValuesRbac;
  /**
   * Password update job
   *
   * @default {...} (25 keys)
   */
  passwordUpdateJob?: MariadbHelmValuesPasswordUpdateJob;
  /**
   * Volume Permissions parameters
   * Init containers parameters:
   * volumePermissions: Change the owner and group of the persistent volume mountpoint to runAsUser:fsGroup values from the securityContext section.
   *
   * @default {...} (5 keys)
   */
  volumePermissions?: MariadbHelmValuesVolumePermissions;
  /**
   * Metrics parameters
   * Mysqld Prometheus exporter parameters
   *
   * @default {...} (14 keys)
   */
  metrics?: MariadbHelmValuesMetrics;
  /**
   * ref: https://kubernetes.io/docs/concepts/services-networking/network-policies/
   *
   * @default {...} (7 keys)
   */
  networkPolicy?: MariadbHelmValuesNetworkPolicy;
};

export type MariadbHelmParameters = {
  "global.imageRegistry"?: string;
  "global.imagePullSecrets"?: string;
  "global.defaultStorageClass"?: string;
  "global.security.allowInsecureImages"?: string;
  "global.compatibility.openshift.adaptSecurityContext"?: string;
  "global.defaultFips"?: string;
  kubeVersion?: string;
  nameOverride?: string;
  fullnameOverride?: string;
  clusterDomain?: string;
  schedulerName?: string;
  runtimeClassName?: string;
  extraDeploy?: string;
  "diagnosticMode.enabled"?: string;
  "diagnosticMode.command"?: string;
  "diagnosticMode.args"?: string;
  "serviceBindings.enabled"?: string;
  "image.registry"?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "image.digest"?: string;
  "image.pullPolicy"?: string;
  "image.pullSecrets"?: string;
  "image.debug"?: string;
  architecture?: string;
  "auth.rootPassword"?: string;
  "auth.database"?: string;
  "auth.username"?: string;
  "auth.password"?: string;
  "auth.replicationUser"?: string;
  "auth.replicationPassword"?: string;
  "auth.existingSecret"?: string;
  "auth.forcePassword"?: string;
  "auth.usePasswordFiles"?: string;
  initdbScriptsConfigMap?: string;
  "tls.enabled"?: string;
  "tls.existingSecret"?: string;
  "tls.certFilename"?: string;
  "tls.certKeyFilename"?: string;
  "tls.certCAFilename"?: string;
  "tls.ca"?: string;
  "tls.cert"?: string;
  "tls.key"?: string;
  "tls.autoGenerated.enabled"?: string;
  "tls.autoGenerated.engine"?: string;
  "tls.autoGenerated.extraSANs"?: string;
  "tls.autoGenerated.loopback"?: string;
  "tls.autoGenerated.certManager.existingIssuer"?: string;
  "tls.autoGenerated.certManager.existingIssuerKind"?: string;
  "tls.autoGenerated.certManager.keySize"?: string;
  "tls.autoGenerated.certManager.keyAlgorithm"?: string;
  "tls.autoGenerated.certManager.duration"?: string;
  "tls.autoGenerated.certManager.renewBefore"?: string;
  "tde.enabled"?: string;
  "tde.existingSecret"?: string;
  "tde.randomKeyFilename"?: string;
  "tde.encryptedKeyFilename"?: string;
  "tde.fileKeyManagementEncryptionAlgorithm"?: string;
  "tde.innodbEncryptTables"?: string;
  "tde.innodbEncryptLog"?: string;
  "tde.innodbEncryptTemporaryTables"?: string;
  "tde.encryptTmpDiskTables"?: string;
  "tde.encryptTmpTiles"?: string;
  "tde.encryptBINLOG"?: string;
  "tde.ariaEncryptTables"?: string;
  "tde.innodbEncryptionThreads"?: string;
  "tde.secretsStoreProvider.enabled"?: string;
  "tde.secretsStoreProvider.provider"?: string;
  "tde.secretsStoreProvider.vault.roleName"?: string;
  "tde.secretsStoreProvider.vault.address"?: string;
  "tde.secretsStoreProvider.vault.authMountPath"?: string;
  "tde.secretsStoreProvider.vault.randomKeySecretPath"?: string;
  "tde.secretsStoreProvider.vault.randomKeySecretKey"?: string;
  "tde.secretsStoreProvider.vault.encryptedKeySecretPath"?: string;
  "tde.secretsStoreProvider.vault.encryptedKeySecretKey"?: string;
  "primary.name"?: string;
  "primary.command"?: string;
  "primary.args"?: string;
  "primary.automountServiceAccountToken"?: string;
  "primary.hostAliases"?: string;
  "primary.containerPorts.mysql"?: string;
  "primary.configuration"?: string;
  "primary.existingConfigmap"?: string;
  "primary.updateStrategy.type"?: string;
  "primary.rollingUpdatePartition"?: string;
  "primary.podAffinityPreset"?: string;
  "primary.podAntiAffinityPreset"?: string;
  "primary.nodeAffinityPreset.type"?: string;
  "primary.nodeAffinityPreset.key"?: string;
  "primary.nodeAffinityPreset.values"?: string;
  "primary.tolerations"?: string;
  "primary.schedulerName"?: string;
  "primary.terminationGracePeriodSeconds"?: string;
  "primary.podManagementPolicy"?: string;
  "primary.topologySpreadConstraints"?: string;
  "primary.priorityClassName"?: string;
  "primary.runtimeClassName"?: string;
  "primary.podSecurityContext.enabled"?: string;
  "primary.podSecurityContext.fsGroupChangePolicy"?: string;
  "primary.podSecurityContext.sysctls"?: string;
  "primary.podSecurityContext.supplementalGroups"?: string;
  "primary.podSecurityContext.fsGroup"?: string;
  "primary.containerSecurityContext.enabled"?: string;
  "primary.containerSecurityContext.runAsUser"?: string;
  "primary.containerSecurityContext.runAsGroup"?: string;
  "primary.containerSecurityContext.runAsNonRoot"?: string;
  "primary.containerSecurityContext.privileged"?: string;
  "primary.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "primary.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "primary.containerSecurityContext.capabilities.drop"?: string;
  "primary.containerSecurityContext.seccompProfile.type"?: string;
  "primary.resourcesPreset"?: string;
  "primary.fips.openssl"?: string;
  "primary.startupProbe.enabled"?: string;
  "primary.startupProbe.initialDelaySeconds"?: string;
  "primary.startupProbe.periodSeconds"?: string;
  "primary.startupProbe.timeoutSeconds"?: string;
  "primary.startupProbe.failureThreshold"?: string;
  "primary.startupProbe.successThreshold"?: string;
  "primary.livenessProbe.enabled"?: string;
  "primary.livenessProbe.initialDelaySeconds"?: string;
  "primary.livenessProbe.periodSeconds"?: string;
  "primary.livenessProbe.timeoutSeconds"?: string;
  "primary.livenessProbe.failureThreshold"?: string;
  "primary.livenessProbe.successThreshold"?: string;
  "primary.readinessProbe.enabled"?: string;
  "primary.readinessProbe.initialDelaySeconds"?: string;
  "primary.readinessProbe.periodSeconds"?: string;
  "primary.readinessProbe.timeoutSeconds"?: string;
  "primary.readinessProbe.failureThreshold"?: string;
  "primary.readinessProbe.successThreshold"?: string;
  "primary.extraFlags"?: string;
  "primary.extraEnvVars"?: string;
  "primary.extraEnvVarsCM"?: string;
  "primary.extraEnvVarsSecret"?: string;
  "primary.persistence.enabled"?: string;
  "primary.persistence.existingClaim"?: string;
  "primary.persistence.subPath"?: string;
  "primary.persistence.storageClass"?: string;
  "primary.persistence.accessModes"?: string;
  "primary.persistence.size"?: string;
  "primary.extraVolumes"?: string;
  "primary.extraVolumeMounts"?: string;
  "primary.initContainers"?: string;
  "primary.sidecars"?: string;
  "primary.service.type"?: string;
  "primary.service.ports.mysql"?: string;
  "primary.service.ports.metrics"?: string;
  "primary.service.nodePorts.mysql"?: string;
  "primary.service.clusterIP"?: string;
  "primary.service.loadBalancerIP"?: string;
  "primary.service.externalTrafficPolicy"?: string;
  "primary.service.loadBalancerSourceRanges"?: string;
  "primary.service.extraPorts"?: string;
  "primary.service.sessionAffinity"?: string;
  "primary.pdb.create"?: string;
  "primary.pdb.minAvailable"?: string;
  "primary.pdb.maxUnavailable"?: string;
  "primary.revisionHistoryLimit"?: string;
  "secondary.name"?: string;
  "secondary.replicaCount"?: string;
  "secondary.command"?: string;
  "secondary.args"?: string;
  "secondary.automountServiceAccountToken"?: string;
  "secondary.hostAliases"?: string;
  "secondary.containerPorts.mysql"?: string;
  "secondary.configuration"?: string;
  "secondary.existingConfigmap"?: string;
  "secondary.updateStrategy.type"?: string;
  "secondary.rollingUpdatePartition"?: string;
  "secondary.podAffinityPreset"?: string;
  "secondary.podAntiAffinityPreset"?: string;
  "secondary.nodeAffinityPreset.type"?: string;
  "secondary.nodeAffinityPreset.key"?: string;
  "secondary.nodeAffinityPreset.values"?: string;
  "secondary.tolerations"?: string;
  "secondary.topologySpreadConstraints"?: string;
  "secondary.priorityClassName"?: string;
  "secondary.runtimeClassName"?: string;
  "secondary.schedulerName"?: string;
  "secondary.terminationGracePeriodSeconds"?: string;
  "secondary.podManagementPolicy"?: string;
  "secondary.podSecurityContext.enabled"?: string;
  "secondary.podSecurityContext.fsGroupChangePolicy"?: string;
  "secondary.podSecurityContext.sysctls"?: string;
  "secondary.podSecurityContext.supplementalGroups"?: string;
  "secondary.podSecurityContext.fsGroup"?: string;
  "secondary.containerSecurityContext.enabled"?: string;
  "secondary.containerSecurityContext.runAsUser"?: string;
  "secondary.containerSecurityContext.runAsGroup"?: string;
  "secondary.containerSecurityContext.runAsNonRoot"?: string;
  "secondary.containerSecurityContext.privileged"?: string;
  "secondary.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "secondary.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "secondary.containerSecurityContext.capabilities.drop"?: string;
  "secondary.containerSecurityContext.seccompProfile.type"?: string;
  "secondary.resourcesPreset"?: string;
  "secondary.startupProbe.enabled"?: string;
  "secondary.startupProbe.initialDelaySeconds"?: string;
  "secondary.startupProbe.periodSeconds"?: string;
  "secondary.startupProbe.timeoutSeconds"?: string;
  "secondary.startupProbe.failureThreshold"?: string;
  "secondary.startupProbe.successThreshold"?: string;
  "secondary.livenessProbe.enabled"?: string;
  "secondary.livenessProbe.initialDelaySeconds"?: string;
  "secondary.livenessProbe.periodSeconds"?: string;
  "secondary.livenessProbe.timeoutSeconds"?: string;
  "secondary.livenessProbe.failureThreshold"?: string;
  "secondary.livenessProbe.successThreshold"?: string;
  "secondary.readinessProbe.enabled"?: string;
  "secondary.readinessProbe.initialDelaySeconds"?: string;
  "secondary.readinessProbe.periodSeconds"?: string;
  "secondary.readinessProbe.timeoutSeconds"?: string;
  "secondary.readinessProbe.failureThreshold"?: string;
  "secondary.readinessProbe.successThreshold"?: string;
  "secondary.extraFlags"?: string;
  "secondary.extraEnvVars"?: string;
  "secondary.extraEnvVarsCM"?: string;
  "secondary.extraEnvVarsSecret"?: string;
  "secondary.persistence.enabled"?: string;
  "secondary.persistence.subPath"?: string;
  "secondary.persistence.storageClass"?: string;
  "secondary.persistence.accessModes"?: string;
  "secondary.persistence.size"?: string;
  "secondary.extraVolumes"?: string;
  "secondary.extraVolumeMounts"?: string;
  "secondary.initContainers"?: string;
  "secondary.sidecars"?: string;
  "secondary.service.type"?: string;
  "secondary.service.ports.mysql"?: string;
  "secondary.service.ports.metrics"?: string;
  "secondary.service.nodePorts.mysql"?: string;
  "secondary.service.clusterIP"?: string;
  "secondary.service.loadBalancerIP"?: string;
  "secondary.service.externalTrafficPolicy"?: string;
  "secondary.service.loadBalancerSourceRanges"?: string;
  "secondary.service.extraPorts"?: string;
  "secondary.service.sessionAffinity"?: string;
  "secondary.pdb.create"?: string;
  "secondary.pdb.minAvailable"?: string;
  "secondary.pdb.maxUnavailable"?: string;
  "secondary.revisionHistoryLimit"?: string;
  "secondary.fips.openssl"?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "serviceAccount.automountServiceAccountToken"?: string;
  "rbac.create"?: string;
  "passwordUpdateJob.enabled"?: string;
  "passwordUpdateJob.backoffLimit"?: string;
  "passwordUpdateJob.command"?: string;
  "passwordUpdateJob.args"?: string;
  "passwordUpdateJob.extraCommands"?: string;
  "passwordUpdateJob.previousPasswords.rootPassword"?: string;
  "passwordUpdateJob.previousPasswords.password"?: string;
  "passwordUpdateJob.previousPasswords.replicationPassword"?: string;
  "passwordUpdateJob.previousPasswords.existingSecret"?: string;
  "passwordUpdateJob.containerSecurityContext.enabled"?: string;
  "passwordUpdateJob.containerSecurityContext.runAsUser"?: string;
  "passwordUpdateJob.containerSecurityContext.runAsGroup"?: string;
  "passwordUpdateJob.containerSecurityContext.runAsNonRoot"?: string;
  "passwordUpdateJob.containerSecurityContext.privileged"?: string;
  "passwordUpdateJob.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "passwordUpdateJob.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "passwordUpdateJob.containerSecurityContext.capabilities.drop"?: string;
  "passwordUpdateJob.containerSecurityContext.seccompProfile.type"?: string;
  "passwordUpdateJob.podSecurityContext.enabled"?: string;
  "passwordUpdateJob.podSecurityContext.fsGroupChangePolicy"?: string;
  "passwordUpdateJob.podSecurityContext.sysctls"?: string;
  "passwordUpdateJob.podSecurityContext.supplementalGroups"?: string;
  "passwordUpdateJob.podSecurityContext.fsGroup"?: string;
  "passwordUpdateJob.extraEnvVars"?: string;
  "passwordUpdateJob.extraEnvVarsCM"?: string;
  "passwordUpdateJob.extraEnvVarsSecret"?: string;
  "passwordUpdateJob.extraVolumes"?: string;
  "passwordUpdateJob.extraVolumeMounts"?: string;
  "passwordUpdateJob.initContainers"?: string;
  "passwordUpdateJob.resourcesPreset"?: string;
  "passwordUpdateJob.automountServiceAccountToken"?: string;
  "passwordUpdateJob.hostAliases"?: string;
  "passwordUpdateJob.fips.openssl"?: string;
  "volumePermissions.enabled"?: string;
  "volumePermissions.image.registry"?: string;
  "volumePermissions.image.repository"?: string;
  "volumePermissions.image.tag"?: string;
  "volumePermissions.image.digest"?: string;
  "volumePermissions.image.pullPolicy"?: string;
  "volumePermissions.image.pullSecrets"?: string;
  "volumePermissions.resourcesPreset"?: string;
  "volumePermissions.fips.openssl"?: string;
  "metrics.enabled"?: string;
  "metrics.image.registry"?: string;
  "metrics.image.repository"?: string;
  "metrics.image.tag"?: string;
  "metrics.image.digest"?: string;
  "metrics.image.pullPolicy"?: string;
  "metrics.image.pullSecrets"?: string;
  "metrics.annotations.prometheus.io/scrape"?: string;
  "metrics.annotations.prometheus.io/port"?: string;
  "metrics.extraArgs.primary"?: string;
  "metrics.extraArgs.secondary"?: string;
  "metrics.extraVolumeMounts.primary"?: string;
  "metrics.extraVolumeMounts.secondary"?: string;
  "metrics.containerPorts.http"?: string;
  "metrics.containerSecurityContext.enabled"?: string;
  "metrics.containerSecurityContext.privileged"?: string;
  "metrics.containerSecurityContext.runAsNonRoot"?: string;
  "metrics.containerSecurityContext.runAsUser"?: string;
  "metrics.containerSecurityContext.runAsGroup"?: string;
  "metrics.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "metrics.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "metrics.containerSecurityContext.capabilities.drop"?: string;
  "metrics.containerSecurityContext.seccompProfile.type"?: string;
  "metrics.resourcesPreset"?: string;
  "metrics.fips.openssl"?: string;
  "metrics.fips.golang"?: string;
  "metrics.livenessProbe.enabled"?: string;
  "metrics.livenessProbe.initialDelaySeconds"?: string;
  "metrics.livenessProbe.periodSeconds"?: string;
  "metrics.livenessProbe.timeoutSeconds"?: string;
  "metrics.livenessProbe.successThreshold"?: string;
  "metrics.livenessProbe.failureThreshold"?: string;
  "metrics.readinessProbe.enabled"?: string;
  "metrics.readinessProbe.initialDelaySeconds"?: string;
  "metrics.readinessProbe.periodSeconds"?: string;
  "metrics.readinessProbe.timeoutSeconds"?: string;
  "metrics.readinessProbe.successThreshold"?: string;
  "metrics.readinessProbe.failureThreshold"?: string;
  "metrics.serviceMonitor.enabled"?: string;
  "metrics.serviceMonitor.namespace"?: string;
  "metrics.serviceMonitor.jobLabel"?: string;
  "metrics.serviceMonitor.interval"?: string;
  "metrics.serviceMonitor.scrapeTimeout"?: string;
  "metrics.serviceMonitor.relabelings"?: string;
  "metrics.serviceMonitor.metricRelabelings"?: string;
  "metrics.serviceMonitor.honorLabels"?: string;
  "metrics.prometheusRule.enabled"?: string;
  "metrics.prometheusRule.namespace"?: string;
  "metrics.prometheusRule.rules"?: string;
  "networkPolicy.enabled"?: string;
  "networkPolicy.allowExternal"?: string;
  "networkPolicy.allowExternalEgress"?: string;
  "networkPolicy.extraIngress"?: string;
  "networkPolicy.extraEgress"?: string;
};
