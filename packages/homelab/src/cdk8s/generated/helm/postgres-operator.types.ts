// Generated TypeScript types for postgres-operator Helm chart

export type PostgresoperatorHelmValuesImage = {
  /**
   * @default "ghcr.io"
   */
  registry?: string;
  /**
   * @default "zalando/postgres-operator"
   */
  repository?: string;
  /**
   * @default "v1.15.1"
   */
  tag?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type PostgresoperatorHelmValuesPodAnnotations = object;

export type PostgresoperatorHelmValuesPodLabels = object;

export type PostgresoperatorHelmValuesConfigGeneral = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * the deployment should create/update the CRDs
   *
   * @default true
   */
  enable_crd_registration?: boolean;
  crd_categories?: string[];
  /**
   * @default false
   */
  enable_lazy_spilo_upgrade?: boolean;
  /**
   * set the PGVERSION env var instead of providing the version via postgresql.bin_dir in SPILO_CONFIGURATION
   *
   * @default true
   */
  enable_pgversion_env_var?: boolean;
  /**
   * start any new database pod without limitations on shm memory
   *
   * @default true
   */
  enable_shm_volume?: boolean;
  /**
   * enables backwards compatible path between Spilo 12 and Spilo 13+ images
   *
   * @default false
   */
  enable_spilo_wal_path_compat?: boolean;
  /**
   * operator will sync only clusters where name starts with teamId prefix
   *
   * @default false
   */
  enable_team_id_clustername_prefix?: boolean;
  /**
   * etcd connection string for Patroni. Empty uses K8s-native DCS.
   *
   * @default ""
   */
  etcd_host?: string;
  /**
   * Spilo docker image
   *
   * @default "ghcr.io/zalando/spilo-17:4.0-p3"
   */
  docker_image?: string;
  /**
   * key name for annotation to ignore globally configured instance limits
   * min number of instances in Postgres cluster. -1 = no limit
   *
   * @default -1
   */
  min_instances?: number;
  /**
   * max number of instances in Postgres cluster. -1 = no limit
   *
   * @default -1
   */
  max_instances?: number;
  /**
   * period between consecutive repair requests
   *
   * @default "5m"
   */
  repair_period?: string;
  /**
   * period between consecutive sync requests
   *
   * @default "30m"
   */
  resync_period?: string;
  /**
   * can prevent certain cases of memory overcommitment
   * map of sidecar names to docker images
   * number of routines the operator spawns to process requests concurrently
   *
   * @default 8
   */
  workers?: number;
};

export type PostgresoperatorHelmValuesConfigUsers = {
  /**
   * enable password rotation for app users that are not database owners
   *
   * @default false
   */
  enable_password_rotation?: boolean;
  /**
   * rotation interval for updating credentials in K8s secrets of app users
   *
   * @default 90
   */
  password_rotation_interval?: number;
  /**
   * retention interval to keep rotation users
   *
   * @default 180
   */
  password_rotation_user_retention?: number;
  /**
   * postgres username used for replication between instances
   *
   * @default "standby"
   */
  replication_username?: string;
  /**
   * postgres superuser name to be created by initdb
   *
   * @default "postgres"
   */
  super_username?: string;
};

export type PostgresoperatorHelmValuesConfigMajorVersionUpgrade = {
  /**
   * "off": no upgrade, "manual": manifest triggers action, "full": minimal version violation triggers too
   *
   * @default "manual"
   */
  major_version_upgrade_mode?: string;
  /**
   * minimal Postgres major version that will not automatically be upgraded
   *
   * @default "13"
   */
  minimal_major_version?: number;
  /**
   * target Postgres major version when upgrading clusters automatically
   *
   * @default "17"
   */
  target_major_version?: number;
};

export type PostgresoperatorHelmValuesConfigKubernetes = {
  /**
   * default DNS domain of K8s cluster where operator is running
   *
   * @default "cluster.local"
   */
  cluster_domain?: string;
  /**
   * additional labels assigned to the cluster objects
   *
   * @default {"application":"spilo"}
   */
  cluster_labels?: PostgresoperatorHelmValuesConfigKubernetesClusterlabels;
  /**
   * label assigned to Kubernetes objects created by the operator
   *
   * @default "cluster-name"
   */
  cluster_name_label?: string;
  /**
   * key name for annotation that compares manifest value with current date
   * key name for annotation that compares manifest value with cluster name
   * list of annotations propagated from cluster manifest to statefulset and deployment
   * allow user secrets in other namespaces than the Postgres cluster
   *
   * @default false
   */
  enable_cross_namespace_secret?: boolean;
  /**
   * use finalizers to ensure all managed resources are deleted prior to the postgresql CR
   * this avoids stale resources in case the operator misses a delete event or is not running
   * during deletion
   *
   * @default false
   */
  enable_finalizers?: boolean;
  /**
   * enables initContainers to run actions before Spilo is started
   *
   * @default true
   */
  enable_init_containers?: boolean;
  /**
   * toggles if child resources should have an owner reference to the postgresql CR
   *
   * @default false
   */
  enable_owner_references?: boolean;
  /**
   * toggles if operator should delete PVCs on cluster deletion
   *
   * @default true
   */
  enable_persistent_volume_claim_deletion?: boolean;
  /**
   * toggles pod anti affinity on the Postgres pods
   *
   * @default false
   */
  enable_pod_antiaffinity?: boolean;
  /**
   * toggles PDB to set to MinAvailabe 0 or 1
   *
   * @default true
   */
  enable_pod_disruption_budget?: boolean;
  /**
   * toogles readiness probe for database pods
   *
   * @default false
   */
  enable_readiness_probe?: boolean;
  /**
   * toggles if operator should delete secrets on cluster deletion
   *
   * @default true
   */
  enable_secrets_deletion?: boolean;
  /**
   * enables sidecar containers to run alongside Spilo in the same pod
   *
   * @default true
   */
  enable_sidecars?: boolean;
  /**
   * namespaced name of the secret containing infrastructure roles names and passwords
   * list of annotation keys that can be inherited from the cluster manifest
   * list of label keys that can be inherited from the cluster manifest
   * timeout for successful migration of master pods from unschedulable node
   * set of labels that a running and active node should possess to be considered ready
   * defines how nodeAffinity from manifest should be merged with node_readiness_label
   * namespaced name of the secret containing the OAuth2 token to pass to the teams API
   * toggle if `spilo-role=master` selector should be added to the PDB (Pod Disruption Budget)
   *
   * @default true
   */
  pdb_master_label_selector?: boolean;
  /**
   * defines the template for PDB names
   *
   * @default "postgres-{cluster}-pdb"
   */
  pdb_name_format?: string;
  /**
   * specify the PVC retention policy when scaling down and/or deleting
   *
   * @default {"when_deleted":"retain","when_scaled":"retain"}
   */
  persistent_volume_claim_retention_policy?: PostgresoperatorHelmValuesConfigKubernetesPersistentvolumeclaimretentionpolicy;
  /**
   * switches pod anti affinity type to `preferredDuringSchedulingIgnoredDuringExecution`
   *
   * @default false
   */
  pod_antiaffinity_preferred_during_scheduling?: boolean;
  /**
   * override topology key for pod anti affinity
   *
   * @default "kubernetes.io/hostname"
   */
  pod_antiaffinity_topology_key?: string;
  /**
   * namespaced name of the ConfigMap with environment variables to populate on every pod
   * specify the pod management policy of stateful sets of Postgres clusters
   *
   * @default "ordered_ready"
   */
  pod_management_policy?: string;
  /**
   * label assigned to the Postgres pods (and services/endpoints)
   *
   * @default "spilo-role"
   */
  pod_role_label?: string;
  /**
   * service account definition as JSON/YAML string to be used by postgres cluster pods
   * role binding definition as JSON/YAML string to be used by pod service account
   * Postgres pods are terminated forcefully after this timeout
   *
   * @default "5m"
   */
  pod_terminate_grace_period?: string;
  /**
   * template for database user secrets generated by the operator,
   * here username contains the namespace in the format namespace.username
   * if the user is in different namespace than cluster and cross namespace secrets
   * are enabled via `enable_cross_namespace_secret` flag in the configuration.
   *
   * @default "{username}.{cluster}.credentials.{tprkind}.{tpr..."
   */
  secret_name_template?: string;
  /**
   * sharing unix socket of PostgreSQL (`pg_socket`) with the sidecars
   *
   * @default false
   */
  share_pgsocket_with_sidecars?: boolean;
  /**
   * group ID with write-access to volumes (required to run Spilo as non-root process)
   * whether the Spilo container should run in privileged mode
   *
   * @default false
   */
  spilo_privileged?: boolean;
  /**
   * whether the Spilo container should run with additional permissions other than parent.
   * required by cron which needs setuid
   *
   * @default true
   */
  spilo_allow_privilege_escalation?: boolean;
  /**
   * storage resize strategy, available options are: ebs, pvc, off or mixed
   *
   * @default "pvc"
   */
  storage_resize_mode?: string;
  /**
   * operator watches for postgres objects in the given namespace
   * listen to all namespaces
   *
   * @default "*"
   */
  watched_namespace?: string;
};

export type PostgresoperatorHelmValuesConfigKubernetesClusterlabels = {
  /**
   * @default "spilo"
   */
  application?: string;
};

export type PostgresoperatorHelmValuesConfigKubernetesPersistentvolumeclaimretentionpolicy = {
  /**
   * @default "retain"
   */
  when_deleted?: string;
  /**
   * @default "retain"
   */
  when_scaled?: string;
};

export type PostgresoperatorHelmValuesConfigPostgresPodResources = {
  /**
   * CPU limits for the postgres containers
   *
   * @default "1"
   */
  default_cpu_limit?: number;
  /**
   * CPU request value for the postgres containers
   *
   * @default "100m"
   */
  default_cpu_request?: string;
  /**
   * memory limits for the postgres containers
   *
   * @default "500Mi"
   */
  default_memory_limit?: string;
  /**
   * memory request value for the postgres containers
   *
   * @default "100Mi"
   */
  default_memory_request?: string;
  /**
   * optional upper boundary for CPU request
   * optional upper boundary for memory request
   * hard CPU minimum required to properly run a Postgres cluster
   *
   * @default "250m"
   */
  min_cpu_limit?: string;
  /**
   * hard memory minimum required to properly run a Postgres cluster
   *
   * @default "250Mi"
   */
  min_memory_limit?: string;
};

export type PostgresoperatorHelmValuesConfigTimeouts = {
  /**
   * interval between consecutive attempts of operator calling the Patroni API
   *
   * @default "1s"
   */
  patroni_api_check_interval?: string;
  /**
   * timeout when waiting for successful response from Patroni API
   *
   * @default "5s"
   */
  patroni_api_check_timeout?: string;
  /**
   * timeout when waiting for the Postgres pods to be deleted
   *
   * @default "10m"
   */
  pod_deletion_wait_timeout?: string;
  /**
   * timeout when waiting for pod role and cluster labels
   *
   * @default "10m"
   */
  pod_label_wait_timeout?: string;
  /**
   * interval between consecutive attempts waiting for postgresql CRD to be created
   *
   * @default "3s"
   */
  ready_wait_interval?: string;
  /**
   * timeout for the complete postgres CRD creation
   *
   * @default "30s"
   */
  ready_wait_timeout?: string;
  /**
   * interval to wait between consecutive attempts to check for some K8s resources
   *
   * @default "3s"
   */
  resource_check_interval?: string;
  /**
   * timeout when waiting for the presence of a certain K8s resource (e.g. Sts, PDB)
   *
   * @default "10m"
   */
  resource_check_timeout?: string;
};

export type PostgresoperatorHelmValuesConfigLoadBalancer = {
  /**
   * DNS zone for cluster DNS name when load balancer is configured for cluster
   *
   * @default "db.example.com"
   */
  db_hosted_zone?: string;
  /**
   * toggles service type load balancer pointing to the master pod of the cluster
   *
   * @default false
   */
  enable_master_load_balancer?: boolean;
  /**
   * toggles service type load balancer pointing to the master pooler pod of the cluster
   *
   * @default false
   */
  enable_master_pooler_load_balancer?: boolean;
  /**
   * toggles service type load balancer pointing to the replica pod of the cluster
   *
   * @default false
   */
  enable_replica_load_balancer?: boolean;
  /**
   * toggles service type load balancer pointing to the replica pooler pod of the cluster
   *
   * @default false
   */
  enable_replica_pooler_load_balancer?: boolean;
  /**
   * define external traffic policy for the load balancer
   *
   * @default "Cluster"
   */
  external_traffic_policy?: string;
  /**
   * defines the DNS name string template for the master load balancer cluster
   *
   * @default "{cluster}.{namespace}.{hostedzone}"
   */
  master_dns_name_format?: string;
  /**
   * deprecated DNS template for master load balancer using team name
   *
   * @default "{cluster}.{team}.{hostedzone}"
   */
  master_legacy_dns_name_format?: string;
  /**
   * defines the DNS name string template for the replica load balancer cluster
   *
   * @default "{cluster}-repl.{namespace}.{hostedzone}"
   */
  replica_dns_name_format?: string;
  /**
   * deprecated DNS template for replica load balancer using team name
   *
   * @default "{cluster}-repl.{team}.{hostedzone}"
   */
  replica_legacy_dns_name_format?: string;
};

export type PostgresoperatorHelmValuesConfigDebug = {
  /**
   * toggles verbose debug logs from the operator
   *
   * @default true
   */
  debug_logging?: boolean;
  /**
   * toggles operator functionality that require access to the postgres database
   *
   * @default true
   */
  enable_database_access?: boolean;
};

export type PostgresoperatorHelmValuesConfigLoggingRestApi = {
  /**
   * REST API listener listens to this port
   *
   * @default 8080
   */
  api_port?: number;
  /**
   * number of entries in the cluster history ring buffer
   *
   * @default 1000
   */
  cluster_history_entries?: number;
  /**
   * number of lines in the ring buffer used to store cluster logs
   *
   * @default 100
   */
  ring_log_lines?: number;
};

export type PostgresoperatorHelmValuesConfigAwsOrGcp = {
  /**
   * Additional Secret (aws or gcp credentials) to mount in the pod
   * Path to mount the above Secret in the filesystem of the container(s)
   * AWS region used to store EBS volumes
   *
   * @default "eu-central-1"
   */
  aws_region?: string;
  /**
   * enable automatic migration on AWS from gp2 to gp3 volumes
   *
   * @default false
   */
  enable_ebs_gp3_migration?: boolean;
};

export type PostgresoperatorHelmValuesConfigLogicalBackup = {
  /**
   * image for pods of the logical backup job (example runs pg_dumpall)
   *
   * @default "ghcr.io/zalando/postgres-operator/logical-backu..."
   */
  logical_backup_docker_image?: string;
  /**
   * path of google cloud service account json file
   * prefix for the backup job name
   *
   * @default "logical-backup-"
   */
  logical_backup_job_prefix?: string;
  /**
   * storage provider - either "s3", "gcs" or "az"
   *
   * @default "s3"
   */
  logical_backup_provider?: string;
  /**
   * S3 Access Key ID
   *
   * @default ""
   */
  logical_backup_s3_access_key_id?: string;
  /**
   * S3 bucket to store backup results
   *
   * @default "my-bucket-url"
   */
  logical_backup_s3_bucket?: string;
  /**
   * S3 bucket prefix to use
   *
   * @default "spilo"
   */
  logical_backup_s3_bucket_prefix?: string;
  /**
   * S3 region of bucket
   *
   * @default ""
   */
  logical_backup_s3_region?: string;
  /**
   * S3 endpoint url when not using AWS
   *
   * @default ""
   */
  logical_backup_s3_endpoint?: string;
  /**
   * S3 Secret Access Key
   *
   * @default ""
   */
  logical_backup_s3_secret_access_key?: string;
  /**
   * S3 server side encryption
   *
   * @default "AES256"
   */
  logical_backup_s3_sse?: string;
  /**
   * S3 retention time for stored backups for example "2 week" or "7 days"
   *
   * @default ""
   */
  logical_backup_s3_retention_time?: string;
  /**
   * backup schedule in the cron format
   *
   * @default "30 00 * * *"
   */
  logical_backup_schedule?: string;
  /**
   * secret to be used as reference for env variables in cronjob
   *
   * @default ""
   */
  logical_backup_cronjob_environment_secret?: string;
};

export type PostgresoperatorHelmValuesConfigTeamsApi = {
  /**
   * team_admin_role will have the rights to grant roles coming from PG manifests
   *
   * @default true
   */
  enable_admin_role_for_users?: boolean;
  /**
   * operator watches for PostgresTeam CRs to assign additional teams and members to clusters
   *
   * @default false
   */
  enable_postgres_team_crd?: boolean;
  /**
   * toogle to create additional superuser teams from PostgresTeam CRs
   *
   * @default false
   */
  enable_postgres_team_crd_superusers?: boolean;
  /**
   * toggle to automatically rename roles of former team members and deny LOGIN
   *
   * @default false
   */
  enable_team_member_deprecation?: boolean;
  /**
   * toggle to grant superuser to team members created from the Teams API
   *
   * @default false
   */
  enable_team_superuser?: boolean;
  /**
   * toggles usage of the Teams API by the operator
   *
   * @default false
   */
  enable_teams_api?: boolean;
  /**
   * should contain a URL to use for authentication (username and token)
   * pam_configuration: https://info.example.com/oauth2/tokeninfo?access_token= uid realm=/employees
   * operator will add all team member roles to this group and add a pg_hba line
   *
   * @default "zalandos"
   */
  pam_role_name?: string;
  postgres_superuser_teams?: string[];
  protected_role_names?: string[];
  /**
   * Suffix to add if members are removed from TeamsAPI or PostgresTeam CRD
   *
   * @default "_deleted"
   */
  role_deletion_suffix?: string;
  /**
   * role name to grant to team members created from the Teams API
   *
   * @default "admin"
   */
  team_admin_role?: string;
  /**
   * postgres config parameters to apply to each team member role
   *
   * @default {"log_statement":"all"}
   */
  team_api_role_configuration?: PostgresoperatorHelmValuesConfigTeamsApiTeamapiroleconfiguration;
};

export type PostgresoperatorHelmValuesConfigTeamsApiTeamapiroleconfiguration = {
  /**
   * @default "all"
   */
  log_statement?: string;
};

export type PostgresoperatorHelmValuesConfigConnectionPooler = {
  /**
   * db schema to install lookup function into
   *
   * @default "pooler"
   */
  connection_pooler_schema?: string;
  /**
   * db user for pooler to use
   *
   * @default "pooler"
   */
  connection_pooler_user?: string;
  /**
   * docker image
   *
   * @default "registry.opensource.zalan.do/acid/pgbouncer:mas..."
   */
  connection_pooler_image?: string;
  /**
   * max db connections the pooler should hold
   *
   * @default 60
   */
  connection_pooler_max_db_connections?: number;
  /**
   * default pooling mode
   *
   * @default "transaction"
   */
  connection_pooler_mode?: string;
  /**
   * number of pooler instances
   *
   * @default 2
   */
  connection_pooler_number_of_instances?: number;
  /**
   * default resources
   *
   * @default "500m"
   */
  connection_pooler_default_cpu_request?: string;
  /**
   * @default "100Mi"
   */
  connection_pooler_default_memory_request?: string;
  /**
   * @default "1"
   */
  connection_pooler_default_cpu_limit?: number;
  /**
   * @default "100Mi"
   */
  connection_pooler_default_memory_limit?: string;
};

export type PostgresoperatorHelmValuesConfigPatroni = {
  /**
   * enable Patroni DCS failsafe_mode feature
   *
   * @default false
   */
  enable_patroni_failsafe_mode?: boolean;
};

export type PostgresoperatorHelmValuesRbac = {
  /**
   * Specifies whether RBAC resources should be created
   *
   * @default true
   */
  create?: boolean;
  /**
   * Specifies whether ClusterRoles that are aggregated into the K8s default roles should be created. (https://kubernetes.io/docs/reference/access-authn-authz/rbac/#default-roles-and-role-bindings)
   *
   * @default false
   */
  createAggregateClusterRoles?: boolean;
};

export type PostgresoperatorHelmValuesServiceAccount = {
  /**
   * Specifies whether a ServiceAccount should be created
   *
   * @default true
   */
  create?: boolean;
  name?: unknown;
};

export type PostgresoperatorHelmValuesPodServiceAccount = {
  /**
   * The name of the ServiceAccount to be used by postgres cluster pods
   * If not set a name is generated using the fullname template and "-pod" suffix
   *
   * @default "postgres-pod"
   */
  name?: string;
};

export type PostgresoperatorHelmValuesPodPriorityClassName = {
  /**
   * If create is false with no name set, no podPriorityClassName is specified.
   * Hence, the pod priorityClass is the one with globalDefault set.
   * If there is no PriorityClass with globalDefault set, the priority of Pods with no priorityClassName is zero.
   *
   * @default true
   */
  create?: boolean;
  /**
   * If not set a name is generated using the fullname template and "-pod" suffix
   *
   * @default ""
   */
  name?: string;
  /**
   * @default 1000000
   */
  priority?: number;
};

export type PostgresoperatorHelmValuesResources = {
  /**
   * @default {"cpu":"500m","memory":"500Mi"}
   */
  limits?: PostgresoperatorHelmValuesResourcesLimits;
  /**
   * @default {"cpu":"100m","memory":"250Mi"}
   */
  requests?: PostgresoperatorHelmValuesResourcesRequests;
};

export type PostgresoperatorHelmValuesResourcesLimits = {
  /**
   * @default "500m"
   */
  cpu?: string;
  /**
   * @default "500Mi"
   */
  memory?: string;
};

export type PostgresoperatorHelmValuesResourcesRequests = {
  /**
   * @default "100m"
   */
  cpu?: string;
  /**
   * @default "250Mi"
   */
  memory?: string;
};

export type PostgresoperatorHelmValuesSecurityContext = {
  /**
   * @default 1000
   */
  runAsUser?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type PostgresoperatorHelmValuesReadinessProbe = {
  /**
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * @default 10
   */
  periodSeconds?: number;
};

export type PostgresoperatorHelmValuesAffinity = object;

export type PostgresoperatorHelmValuesNodeSelector = object;

export type PostgresoperatorHelmValuesControllerID = {
  /**
   * Specifies whether a controller ID should be defined for the operator
   * Note, all postgres manifest must then contain the following annotation to be found by this operator
   * "acid.zalan.do/controller": <controller-ID-of-the-operator>
   *
   * @default false
   */
  create?: boolean;
  name?: unknown;
};

export type PostgresoperatorHelmValues = {
  /**
   * @default {...} (4 keys)
   */
  image?: PostgresoperatorHelmValuesImage;
  /**
   * Optionally specify an array of imagePullSecrets.
   * Secrets must be manually created in the namespace.
   * ref: https://kubernetes.io/docs/concepts/containers/images/#specifying-imagepullsecrets-on-a-pod
   *
   * @default {}
   */
  podAnnotations?: PostgresoperatorHelmValuesPodAnnotations;
  /**
   * @default {}
   */
  podLabels?: PostgresoperatorHelmValuesPodLabels;
  /**
   * @default "OperatorConfigurationCRD"
   */
  configTarget?: string;
  /**
   * JSON logging format
   *
   * @default false
   */
  enableJsonLogging?: boolean;
  /**
   * general configuration parameters
   *
   * @default {...} (14 keys)
   */
  configGeneral?: PostgresoperatorHelmValuesConfigGeneral;
  /**
   * parameters describing Postgres users
   *
   * @default {...} (5 keys)
   */
  configUsers?: PostgresoperatorHelmValuesConfigUsers;
  /**
   * @default {"major_version_upgrade_mode":"manual","minimal_major_version":"13","target_major_version":"17"}
   */
  configMajorVersionUpgrade?: PostgresoperatorHelmValuesConfigMajorVersionUpgrade;
  /**
   * @default {...} (27 keys)
   */
  configKubernetes?: PostgresoperatorHelmValuesConfigKubernetes;
  /**
   * configure resource requests for the Postgres pods
   *
   * @default {...} (6 keys)
   */
  configPostgresPodResources?: PostgresoperatorHelmValuesConfigPostgresPodResources;
  /**
   * timeouts related to some operator actions
   *
   * @default {...} (8 keys)
   */
  configTimeouts?: PostgresoperatorHelmValuesConfigTimeouts;
  /**
   * configure behavior of load balancers
   *
   * @default {...} (10 keys)
   */
  configLoadBalancer?: PostgresoperatorHelmValuesConfigLoadBalancer;
  /**
   * options to aid debugging of the operator itself
   *
   * @default {"debug_logging":true,"enable_database_access":true}
   */
  configDebug?: PostgresoperatorHelmValuesConfigDebug;
  /**
   * parameters affecting logging and REST API listener
   *
   * @default {"api_port":8080,"cluster_history_entries":1000,"ring_log_lines":100}
   */
  configLoggingRestApi?: PostgresoperatorHelmValuesConfigLoggingRestApi;
  /**
   * configure interaction with non-Kubernetes objects from AWS or GCP
   * defines maximum volume size in GB until which auto migration happens
   * GCP credentials that will be used by the operator / pods
   * AWS IAM role to supply in the iam.amazonaws.com/role annotation of Postgres pods
   * S3 bucket to use for shipping postgres daily logs
   * S3 bucket to use for shipping WAL segments with WAL-E
   * GCS bucket to use for shipping WAL segments with WAL-E
   * Azure Storage Account to use for shipping WAL segments with WAL-G
   * configure K8s cron job managed by the operator
   *
   * @default {"aws_region":"eu-central-1","enable_ebs_gp3_migration":false}
   */
  configAwsOrGcp?: PostgresoperatorHelmValuesConfigAwsOrGcp;
  /**
   * @default {...} (13 keys)
   */
  configLogicalBackup?: PostgresoperatorHelmValuesConfigLogicalBackup;
  /**
   * automate creation of human users with teams API service
   * URL of the Teams API service
   * teams_api_url: http://fake-teams-api.default.svc.cluster.local
   * configure connection pooler deployment created by the operator
   *
   * @default {...} (12 keys)
   */
  configTeamsApi?: PostgresoperatorHelmValuesConfigTeamsApi;
  /**
   * @default {...} (10 keys)
   */
  configConnectionPooler?: PostgresoperatorHelmValuesConfigConnectionPooler;
  /**
   * @default {"enable_patroni_failsafe_mode":false}
   */
  configPatroni?: PostgresoperatorHelmValuesConfigPatroni;
  /**
   * Zalando's internal CDC stream feature
   *
   * @default false
   */
  enableStreams?: boolean;
  /**
   * @default {"create":true,"createAggregateClusterRoles":false}
   */
  rbac?: PostgresoperatorHelmValuesRbac;
  /**
   * @default {"create":true,"name":null}
   */
  serviceAccount?: PostgresoperatorHelmValuesServiceAccount;
  /**
   * @default {"name":"postgres-pod"}
   */
  podServiceAccount?: PostgresoperatorHelmValuesPodServiceAccount;
  /**
   * priority class for operator pod
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * priority class for database pods
   *
   * @default {"create":true,"name":"","priority":1000000}
   */
  podPriorityClassName?: PostgresoperatorHelmValuesPodPriorityClassName;
  /**
   * @default {"limits":{"cpu":"500m","memory":"500Mi"},"requests":{"cpu":"100m","memory":"250Mi"}}
   */
  resources?: PostgresoperatorHelmValuesResources;
  /**
   * @default {...} (4 keys)
   */
  securityContext?: PostgresoperatorHelmValuesSecurityContext;
  /**
   * Allow to setup operator Deployment readiness probe
   *
   * @default {"initialDelaySeconds":5,"periodSeconds":10}
   */
  readinessProbe?: PostgresoperatorHelmValuesReadinessProbe;
  extraEnvs?: unknown[];
  /**
   * Affinity for pod assignment
   * Ref: https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#affinity-and-anti-affinity
   *
   * @default {}
   */
  affinity?: PostgresoperatorHelmValuesAffinity;
  /**
   * Node labels for pod assignment
   * Ref: https://kubernetes.io/docs/user-guide/node-selection/
   *
   * @default {}
   */
  nodeSelector?: PostgresoperatorHelmValuesNodeSelector;
  tolerations?: unknown[];
  /**
   * @default {"create":false,"name":null}
   */
  controllerID?: PostgresoperatorHelmValuesControllerID;
};

export type PostgresoperatorHelmParameters = {
  "image.registry"?: string;
  "image.repository"?: string;
  "image.tag"?: string;
  "image.pullPolicy"?: string;
  configTarget?: string;
  enableJsonLogging?: string;
  "configGeneral.enable_crd_registration"?: string;
  "configGeneral.crd_categories"?: string;
  "configGeneral.enable_lazy_spilo_upgrade"?: string;
  "configGeneral.enable_pgversion_env_var"?: string;
  "configGeneral.enable_shm_volume"?: string;
  "configGeneral.enable_spilo_wal_path_compat"?: string;
  "configGeneral.enable_team_id_clustername_prefix"?: string;
  "configGeneral.etcd_host"?: string;
  "configGeneral.docker_image"?: string;
  "configGeneral.min_instances"?: string;
  "configGeneral.max_instances"?: string;
  "configGeneral.repair_period"?: string;
  "configGeneral.resync_period"?: string;
  "configGeneral.workers"?: string;
  "configUsers.enable_password_rotation"?: string;
  "configUsers.password_rotation_interval"?: string;
  "configUsers.password_rotation_user_retention"?: string;
  "configUsers.replication_username"?: string;
  "configUsers.super_username"?: string;
  "configMajorVersionUpgrade.major_version_upgrade_mode"?: string;
  "configMajorVersionUpgrade.minimal_major_version"?: string;
  "configMajorVersionUpgrade.target_major_version"?: string;
  "configKubernetes.cluster_domain"?: string;
  "configKubernetes.cluster_labels.application"?: string;
  "configKubernetes.cluster_name_label"?: string;
  "configKubernetes.enable_cross_namespace_secret"?: string;
  "configKubernetes.enable_finalizers"?: string;
  "configKubernetes.enable_init_containers"?: string;
  "configKubernetes.enable_owner_references"?: string;
  "configKubernetes.enable_persistent_volume_claim_deletion"?: string;
  "configKubernetes.enable_pod_antiaffinity"?: string;
  "configKubernetes.enable_pod_disruption_budget"?: string;
  "configKubernetes.enable_readiness_probe"?: string;
  "configKubernetes.enable_secrets_deletion"?: string;
  "configKubernetes.enable_sidecars"?: string;
  "configKubernetes.pdb_master_label_selector"?: string;
  "configKubernetes.pdb_name_format"?: string;
  "configKubernetes.persistent_volume_claim_retention_policy.when_deleted"?: string;
  "configKubernetes.persistent_volume_claim_retention_policy.when_scaled"?: string;
  "configKubernetes.pod_antiaffinity_preferred_during_scheduling"?: string;
  "configKubernetes.pod_antiaffinity_topology_key"?: string;
  "configKubernetes.pod_management_policy"?: string;
  "configKubernetes.pod_role_label"?: string;
  "configKubernetes.pod_terminate_grace_period"?: string;
  "configKubernetes.secret_name_template"?: string;
  "configKubernetes.share_pgsocket_with_sidecars"?: string;
  "configKubernetes.spilo_privileged"?: string;
  "configKubernetes.spilo_allow_privilege_escalation"?: string;
  "configKubernetes.storage_resize_mode"?: string;
  "configKubernetes.watched_namespace"?: string;
  "configPostgresPodResources.default_cpu_limit"?: string;
  "configPostgresPodResources.default_cpu_request"?: string;
  "configPostgresPodResources.default_memory_limit"?: string;
  "configPostgresPodResources.default_memory_request"?: string;
  "configPostgresPodResources.min_cpu_limit"?: string;
  "configPostgresPodResources.min_memory_limit"?: string;
  "configTimeouts.patroni_api_check_interval"?: string;
  "configTimeouts.patroni_api_check_timeout"?: string;
  "configTimeouts.pod_deletion_wait_timeout"?: string;
  "configTimeouts.pod_label_wait_timeout"?: string;
  "configTimeouts.ready_wait_interval"?: string;
  "configTimeouts.ready_wait_timeout"?: string;
  "configTimeouts.resource_check_interval"?: string;
  "configTimeouts.resource_check_timeout"?: string;
  "configLoadBalancer.db_hosted_zone"?: string;
  "configLoadBalancer.enable_master_load_balancer"?: string;
  "configLoadBalancer.enable_master_pooler_load_balancer"?: string;
  "configLoadBalancer.enable_replica_load_balancer"?: string;
  "configLoadBalancer.enable_replica_pooler_load_balancer"?: string;
  "configLoadBalancer.external_traffic_policy"?: string;
  "configLoadBalancer.master_dns_name_format"?: string;
  "configLoadBalancer.master_legacy_dns_name_format"?: string;
  "configLoadBalancer.replica_dns_name_format"?: string;
  "configLoadBalancer.replica_legacy_dns_name_format"?: string;
  "configDebug.debug_logging"?: string;
  "configDebug.enable_database_access"?: string;
  "configLoggingRestApi.api_port"?: string;
  "configLoggingRestApi.cluster_history_entries"?: string;
  "configLoggingRestApi.ring_log_lines"?: string;
  "configAwsOrGcp.aws_region"?: string;
  "configAwsOrGcp.enable_ebs_gp3_migration"?: string;
  "configLogicalBackup.logical_backup_docker_image"?: string;
  "configLogicalBackup.logical_backup_job_prefix"?: string;
  "configLogicalBackup.logical_backup_provider"?: string;
  "configLogicalBackup.logical_backup_s3_access_key_id"?: string;
  "configLogicalBackup.logical_backup_s3_bucket"?: string;
  "configLogicalBackup.logical_backup_s3_bucket_prefix"?: string;
  "configLogicalBackup.logical_backup_s3_region"?: string;
  "configLogicalBackup.logical_backup_s3_endpoint"?: string;
  "configLogicalBackup.logical_backup_s3_secret_access_key"?: string;
  "configLogicalBackup.logical_backup_s3_sse"?: string;
  "configLogicalBackup.logical_backup_s3_retention_time"?: string;
  "configLogicalBackup.logical_backup_schedule"?: string;
  "configLogicalBackup.logical_backup_cronjob_environment_secret"?: string;
  "configTeamsApi.enable_admin_role_for_users"?: string;
  "configTeamsApi.enable_postgres_team_crd"?: string;
  "configTeamsApi.enable_postgres_team_crd_superusers"?: string;
  "configTeamsApi.enable_team_member_deprecation"?: string;
  "configTeamsApi.enable_team_superuser"?: string;
  "configTeamsApi.enable_teams_api"?: string;
  "configTeamsApi.pam_role_name"?: string;
  "configTeamsApi.postgres_superuser_teams"?: string;
  "configTeamsApi.protected_role_names"?: string;
  "configTeamsApi.role_deletion_suffix"?: string;
  "configTeamsApi.team_admin_role"?: string;
  "configTeamsApi.team_api_role_configuration.log_statement"?: string;
  "configConnectionPooler.connection_pooler_schema"?: string;
  "configConnectionPooler.connection_pooler_user"?: string;
  "configConnectionPooler.connection_pooler_image"?: string;
  "configConnectionPooler.connection_pooler_max_db_connections"?: string;
  "configConnectionPooler.connection_pooler_mode"?: string;
  "configConnectionPooler.connection_pooler_number_of_instances"?: string;
  "configConnectionPooler.connection_pooler_default_cpu_request"?: string;
  "configConnectionPooler.connection_pooler_default_memory_request"?: string;
  "configConnectionPooler.connection_pooler_default_cpu_limit"?: string;
  "configConnectionPooler.connection_pooler_default_memory_limit"?: string;
  "configPatroni.enable_patroni_failsafe_mode"?: string;
  enableStreams?: string;
  "rbac.create"?: string;
  "rbac.createAggregateClusterRoles"?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.name"?: string;
  "podServiceAccount.name"?: string;
  priorityClassName?: string;
  "podPriorityClassName.create"?: string;
  "podPriorityClassName.name"?: string;
  "podPriorityClassName.priority"?: string;
  "resources.limits.cpu"?: string;
  "resources.limits.memory"?: string;
  "resources.requests.cpu"?: string;
  "resources.requests.memory"?: string;
  "securityContext.runAsUser"?: string;
  "securityContext.runAsNonRoot"?: string;
  "securityContext.readOnlyRootFilesystem"?: string;
  "securityContext.allowPrivilegeEscalation"?: string;
  "readinessProbe.initialDelaySeconds"?: string;
  "readinessProbe.periodSeconds"?: string;
  extraEnvs?: string;
  tolerations?: string;
  "controllerID.create"?: string;
  "controllerID.name"?: string;
};
