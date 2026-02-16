// Generated TypeScript types for minecraft Helm chart

export type MinecraftHelmValuesImage = {
  /**
   * @default "itzg/minecraft-server"
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
  /**
   * @default ""
   */
  pullSecret?: string;
};

export type MinecraftHelmValuesResources = {
  /**
   * @default {"memory":"512Mi","cpu":"500m"}
   */
  requests?: MinecraftHelmValuesResourcesRequests;
  /**
   * Kubernetes resource limits (memory, cpu, etc.)
   */
  limits?: MinecraftHelmValuesResourcesLimits;
};

export type MinecraftHelmValuesResourcesRequests = {
  /**
   * @default "512Mi"
   */
  memory?: string;
  /**
   * @default "500m"
   */
  cpu?: string;
};

export type MinecraftHelmValuesResourcesLimits = {
  /**
   * @default "512Mi"
   */
  memory?: string;
  /**
   * @default "500m"
   */
  cpu?: string;
};

export type MinecraftHelmValuesLifecycle = {
  postStart?: unknown[];
  preStop?: unknown[];
};

export type MinecraftHelmValuesNodeSelector = object;

export type MinecraftHelmValuesAffinity = object;

export type MinecraftHelmValuesPodSecurityContext = {
  /**
   * @default 1000
   */
  runAsUser?: number;
  /**
   * @default 3000
   */
  runAsGroup?: number;
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default 2000
   */
  fsGroup?: number;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: MinecraftHelmValuesPodSecurityContextSeccompProfile;
};

export type MinecraftHelmValuesPodSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type MinecraftHelmValuesSecurityContext = {
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: MinecraftHelmValuesSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type MinecraftHelmValuesSecurityContextCapabilities = {
  drop?: string[];
};

export type MinecraftHelmValuesLivenessProbe = {
  command?: string[];
  /**
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * @default 5
   */
  periodSeconds?: number;
  /**
   * @default 20
   */
  failureThreshold?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 1
   */
  timeoutSeconds?: number;
};

export type MinecraftHelmValuesReadinessProbe = {
  command?: string[];
  /**
   * @default 30
   */
  initialDelaySeconds?: number;
  /**
   * @default 5
   */
  periodSeconds?: number;
  /**
   * @default 20
   */
  failureThreshold?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 1
   */
  timeoutSeconds?: number;
};

export type MinecraftHelmValuesStartupProbe = {
  command?: string[];
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 30
   */
  failureThreshold?: number;
  /**
   * @default 10
   */
  periodSeconds?: number;
};

export type MinecraftHelmValuesExtraPodSpec = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MinecraftHelmValuesMinecraftServer = {
  /**
   * This must be overridden, since we can't accept this for the user.
   *
   * @default "FALSE"
   */
  eula?: "true" | "TRUE" | "false" | "FALSE" | boolean;
  /**
   * One of: LATEST, SNAPSHOT, or a specific version (ie: "1.7.9").
   *
   * Such as LATEST, SNAPSHOT, or a specific version. Refer to https://docker-minecraft-server.readthedocs.io/en/latest/versions/minecraft/
   *
   * @default "LATEST"
   */
  version?: string;
  /**
   * The type of Minecraft server to run, check for related settings below
   * Common types: "VANILLA", "FABRIC", "FORGE", "SPIGOT", "BUKKIT", "PAPER",
   * "FTBA", "SPONGEVANILLA", "AUTO_CURSEFORGE"
   * ref: https://docker-minecraft-server.readthedocs.io/en/latest/types-and-platforms
   *
   * Refer to https://docker-minecraft-server.readthedocs.io/en/latest/types-and-platforms/
   *
   * @default "VANILLA"
   */
  type?: string;
  forgeVersion?: unknown;
  forgeInstallerUrl?: unknown;
  spongeVersion?: unknown;
  bukkitDownloadUrl?: unknown;
  spigotDownloadUrl?: unknown;
  paperDownloadUrl?: unknown;
  ftbModpackId?: unknown;
  ftbModpackVersionId?: unknown;
  cfServerMod?: unknown;
  fabricLauncherVersion?: unknown;
  fabricLoaderVersion?: unknown;
  /**
   * @default "default"
   */
  ftbLegacyJavaFixer?: "default" | boolean;
  /**
   * One of: peaceful, easy, normal, and hard
   *
   * @default "easy"
   */
  difficulty?: string;
  whitelist?: unknown;
  ops?: unknown;
  icon?: unknown;
  /**
   * @default "default"
   */
  maxPlayers?: number | "default";
  /**
   * This sets the maximum possible size in blocks, expressed as a radius, that the world border can obtain.
   *
   * @default "default"
   */
  maxWorldSize?: number | "default";
  /**
   * Allows players to travel to the Nether.
   *
   * @default "default"
   */
  allowNether?: "default" | boolean;
  /**
   * Allows server to announce when a player gets an achievement.
   *
   * @default "default"
   */
  announcePlayerAchievements?: "default" | boolean;
  /**
   * Enables command blocks.
   *
   * @default "default"
   */
  enableCommandBlock?: "default" | boolean;
  /**
   * If true, players will always join in the default gameMode even if they were previously set to something else.
   *
   * @default "default"
   */
  forcegameMode?: "default" | boolean;
  /**
   * Defines whether structures (such as villages) will be generated.
   *
   * @default "default"
   */
  generateStructures?: "default" | boolean;
  /**
   * If set to true, players will be set to spectator mode if they die.
   *
   * @default "default"
   */
  hardcore?: "default" | boolean;
  /**
   * The maximum height in which building is allowed.
   *
   * @default "default"
   */
  maxBuildHeight?: number | "default";
  /**
   * The maximum number of milliseconds a single tick may take before the server watchdog stops the server with the message. -1 disables this entirely.
   *
   * @default "default"
   */
  maxTickTime?: number | "default";
  /**
   * Determines if animals will be able to spawn.
   *
   * @default "default"
   */
  spawnAnimals?: "default" | boolean;
  /**
   * Determines if monsters will be spawned.
   *
   * @default "default"
   */
  spawnMonsters?: "default" | boolean;
  /**
   * Determines if villagers will be spawned.
   *
   * @default "default"
   */
  spawnNPCs?: "default" | boolean;
  /**
   * Sets the area that non-ops can not edit (0 to disable)
   *
   * @default "default"
   */
  spawnProtection?: number | "default";
  /**
   * Max view distance (in chunks).
   *
   * @default "default"
   */
  viewDistance?: number | "default";
  levelSeed?: unknown;
  /**
   * @default "survival"
   */
  gameMode?: string;
  /**
   * Message of the Day
   *
   * @default "Welcome to Minecraft on Kubernetes!"
   */
  motd?: string;
  /**
   * If true, enable player-vs-player damage.
   *
   * @default "default"
   */
  pvp?: "default" | boolean;
  /**
   * One of: DEFAULT, FLAT, LARGEBIOMES, AMPLIFIED, CUSTOMIZED
   *
   * @default "DEFAULT"
   */
  levelType?: string;
  generatorSettings?: unknown;
  /**
   * @default "world"
   */
  worldSaveName?: string;
  downloadWorldUrl?: unknown;
  /**
   * @default false
   */
  forceReDownload?: boolean;
  downloadModpackUrl?: unknown;
  /**
   * @default false
   */
  removeOldMods?: boolean;
  vanillaTweaksShareCodes?: unknown[];
  resourcePackUrl?: unknown;
  resourcePackSha?: unknown;
  /**
   * @default false
   */
  resourcePackEnforce?: boolean;
  /**
   * Check accounts against Minecraft account service.
   *
   * @default "default"
   */
  onlineMode?: "default" | boolean;
  /**
   * Require public key to be signed by Mojang to join
   *
   * @default "default"
   */
  enforceSecureProfile?: "default" | boolean;
  /**
   * If you adjust this, you may need to adjust resources.requests above to match.
   *
   * @default "1024M"
   */
  memory?: string;
  /**
   * General JVM options to be passed to the Minecraft server invocation
   *
   * @default ""
   */
  jvmOpts?: string;
  /**
   * Options like -X that need to proceed general JVM options
   *
   * @default ""
   */
  jvmXXOpts?: string;
  /**
   * @default "default"
   */
  overrideServerProperties?: "default" | boolean;
  /**
   * @default {}
   */
  serviceAnnotations?: MinecraftHelmValuesMinecraftServerServiceAnnotations;
  /**
   * @default "ClusterIP"
   */
  serviceType?: string;
  nodePort?: unknown;
  /**
   * @default 25565
   */
  servicePort?: number;
  clusterIP?: unknown;
  loadBalancerClass?: unknown;
  loadBalancerIP?: unknown;
  externalIPs?: unknown;
  /**
   * List with URLs and paths to jar files, additionally may be a directory with jars
   * This works for both mods and plugins depending on server type
   *
   * @default []
   */
  modUrls?: string[];
  /**
   * @default []
   */
  pluginUrls?: string[];
  /**
   * A list of Spigot resources/plugins IDs to download.
   *
   * @default []
   */
  spigetResources?: number[];
  /**
   * Additional service specs to be defined
   *
   * @default {}
   */
  extraServiceSpec?: MinecraftHelmValuesMinecraftServerExtraServiceSpec;
  /**
   * A list of Modrinth project slugs with optional version after colon
   *
   * @default {"projects":[],"downloadDependencies":"none","allowedVersionType":"default"}
   */
  modrinth?: MinecraftHelmValuesMinecraftServerModrinth;
  /**
   * Config for AUTO_CURSEFORGE server type
   *
   * @default {...} (12 keys)
   */
  autoCurseForge?: MinecraftHelmValuesMinecraftServerAutoCurseForge;
  /**
   * Set the externalTrafficPolicy in the Service to either Cluster or Local
   * set this to false to not have colorized logs
   *
   * @default {...} (11 keys)
   */
  rcon?: MinecraftHelmValuesMinecraftServerRcon;
  /**
   * @default true
   */
  tty?: boolean;
  extraPorts?: unknown[];
  /**
   * @default {"enabled":false,"port":25565}
   */
  query?: MinecraftHelmValuesMinecraftServerQuery;
};

export type MinecraftHelmValuesMinecraftServerServiceAnnotations = object;

export type MinecraftHelmValuesMinecraftServerExtraServiceSpec = object;

export type MinecraftHelmValuesMinecraftServerModrinth = {
  /**
   * @default []
   */
  projects?: string[];
  /**
   * Specifies whether to download Modrinth dependencies. The allowed values are: none, required, optional
   *
   * @default "none"
   */
  downloadDependencies?: "none" | "required" | "optional";
  /**
   * The version type is used to determine the newest version to use from each project. The allowed values are: release, beta, alpha
   *
   * @default "default"
   */
  allowedVersionType?: "release" | "beta" | "alpha" | "default";
};

export type MinecraftHelmValuesMinecraftServerAutoCurseForge = {
  /**
   * CurseForge API key obtained from developer console
   *
   * @default {"key":"CHANGEME!","existingSecret":"","secretKey":"cf-api-key"}
   */
  apiKey?: MinecraftHelmValuesMinecraftServerAutoCurseForgeApiKey;
  /**
   * Link to modpack in general or a specific file
   * NOTE: In case of specific file - do not point at server file
   *
   * @default ""
   */
  pageUrl?: string;
  /**
   * Unique id of modpack, can be used instead of url
   *
   * @default ""
   */
  slug?: string;
  /**
   * Id used to specify which exact modpack file needs to be downloaded
   * NOTE: Do not use server file id
   *
   * @default ""
   */
  fileId?: string;
  /**
   * Less restrictive way of specifying modpack version, uses substring match
   *
   * @default ""
   */
  filenameMatcher?: string;
  /**
   * List of project slugs or IDs to be excluded from modpack, useful if mod is incorrectly marked as server side
   *
   * @default []
   */
  excludeMods?: number | string[];
  /**
   * List of project slugs or IDs to be included in modpack, useful if mod is incorrectly marked as client side only
   *
   * @default []
   */
  includeMods?: number | string[];
  /**
   * Path to file with rules for including and excluding mods. If null - use bundled file, if empty - disable it
   *
   * @default null
   */
  excludeIncludeFile?: string | null;
  /**
   * Reevaluate exclude and include rules
   *
   * @default false
   */
  forceSynchronize?: boolean;
  /**
   * Can be set to either WORLD_FILE or OVERRIDES to specify where to get LEVEL
   *
   * @default ""
   */
  setLevelFrom?: "" | "WORLD_FILE" | "OVERRIDES";
  /**
   * Sets limit to how many mods can be downloaded in parallel
   *
   * @default 4
   */
  parallelDownloads?: number;
  /**
   * Set to skip files in modpack "overrides" folder that would replace existing files
   * NOTE: World data is always skipped if present
   *
   * @default false
   */
  overridesSkipExisting?: boolean;
};

export type MinecraftHelmValuesMinecraftServerAutoCurseForgeApiKey = {
  /**
   * @default "CHANGEME!"
   */
  key?: string;
  /**
   * @default ""
   */
  existingSecret?: string;
  /**
   * @default "cf-api-key"
   */
  secretKey?: string;
};

export type MinecraftHelmValuesMinecraftServerRcon = {
  /**
   * If you enable this, make SURE to change your password below.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * By default, the container will generate a random password at startup
   * to ensure internal RCON tooling, including a backup container,
   * can be used, but the password is secure.
   *
   * @default false
   */
  withGeneratedPassword?: boolean;
  /**
   * @default 25575
   */
  port?: number;
  /**
   * @default "CHANGEME!"
   */
  password?: string;
  existingSecret?: unknown;
  /**
   * @default "rcon-password"
   */
  secretKey?: string;
  /**
   * @default "ClusterIP"
   */
  serviceType?: string;
  nodePort?: unknown;
  clusterIP?: unknown;
  loadBalancerClass?: unknown;
  loadBalancerIP?: unknown;
};

export type MinecraftHelmValuesMinecraftServerQuery = {
  /**
   * If you enable this, your server will be "published" to Gamespy
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default 25565
   */
  port?: number;
};

export type MinecraftHelmValuesExtraEnv = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MinecraftHelmValuesPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {}
   */
  labels?: MinecraftHelmValuesPersistenceLabels;
  /**
   * @default {}
   */
  annotations?: MinecraftHelmValuesPersistenceAnnotations;
  /**
   * specify an alternative volume to be mounted to /data instead of datadir.
   * If defined, storageClassName: <storageClass>
   * If set to "-", storageClassName: "", which disables dynamic provisioning
   * If undefined (the default) or set to null, no storageClassName spec is
   * set, choosing the default provisioner.  (gp2 on AWS, standard on
   * GKE, AWS & OpenStack)
   *
   * @default {"enabled":false,"Size":"1Gi","accessModes":["ReadWriteOnce"]}
   */
  dataDir?: MinecraftHelmValuesPersistenceDataDir;
};

export type MinecraftHelmValuesPersistenceLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MinecraftHelmValuesPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MinecraftHelmValuesPersistenceDataDir = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Set this to false if you don't care to persist state between restarts.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "1Gi"
   */
  Size?: string;
  accessModes?: string[];
};

export type MinecraftHelmValuesPodAnnotations = object;

export type MinecraftHelmValuesPodLabels = object;

export type MinecraftHelmValuesDeploymentAnnotations = object;

export type MinecraftHelmValuesDeploymentLabels = object;

export type MinecraftHelmValuesServiceAnnotations = object;

export type MinecraftHelmValuesServiceLabels = object;

export type MinecraftHelmValuesRconServiceAnnotations = object;

export type MinecraftHelmValuesRconServiceLabels = object;

export type MinecraftHelmValuesMcbackup = {
  /**
   * @default false
   */
  enabled?: boolean;
  /**
   * @default {"repository":"itzg/mc-backup","tag":"latest","pullPolicy":"IfNotPresent"}
   */
  image?: MinecraftHelmValuesMcbackupImage;
  /**
   * wait 2 minutes before starting
   *
   * @default "2m"
   */
  initialDelay?: string;
  backupName?: unknown;
  /**
   * ***set to 0 or smaller, script will run once and exit.  DO NOT SET TO 0 or smaller, this will cause K8s to kill your pod!***
   * backupInterval="1.5d" -> backup every one and a half days (36 hours)
   * backupInterval="2h 30m" -> backup every two and a half hours
   *
   * @default "24h"
   */
  backupInterval?: string;
  /**
   * option lets you pause backups if no players are online.
   *
   * @default "false"
   */
  pauseIfNoPlayers?: boolean;
  /**
   * is set to a positive number, it'll delete old .tgz backup files from DEST_DIR. By default deletes backups older than a week.
   *
   * @default 7
   */
  pruneBackupsDays?: number;
  /**
   * Set to a negative value to retry indefinitely
   *
   * @default 5
   */
  rconRetries?: number;
  /**
   * @default "10s"
   */
  rconRetryInterval?: string;
  /**
   * is a comma-separated list of glob(3) patterns to exclude from backups. By default excludes all jar files (plugins, server files),
   * logs folder and cache (used by i.e. PaperMC server).
   *
   * @default "*.jar,cache,logs"
   */
  excludes?: string;
  /**
   * backup methods, see https://github.com/itzg/docker-mc-backup e.g. tar, rclone, restic, rsync
   *
   * @default "tar"
   */
  backupMethod?: "tar" | "restic" | "rclone" | "rsync";
  /**
   * tar and rclone methods
   *
   * @default "/backups"
   */
  destDir?: string;
  /**
   * is a true/false flag that creates a symbolic link to the latest backup
   *
   * @default "false"
   */
  linkLatest?: boolean;
  /**
   * is the compression method used by tar. Valid value: gzip bzip2 zstd
   *
   * @default "gzip"
   */
  compressMethod?: string;
  /**
   * sets the parameters for zstd compression. The --long parameter affects RAM requirements for both compression and decompression
   * (the default of 25 means 2^25 bytes = 32 MB).
   *
   * @default "-3 --long=25 --single-thread"
   */
  zstdParameters?: string;
  rcloneRemote?: unknown;
  rcloneDestDir?: unknown;
  /**
   * @default "gzip"
   */
  rcloneCompressMethod?: string;
  rcloneConfig?: unknown;
  /**
   * type = google cloud storage
   * client_id =
   * client_secret =
   * token = {"AccessToken":"super","RefreshToken":"secret","Expiry":"date","Extra":null}
   * project_number = 12345678
   * object_acl = private
   * bucket_acl = private
   * if you prefer to create a secret from file (e.g. kubectl create secret generic my-rclone-config --from-file=~/.config/rclone/rclone.conf)
   *
   * @default ""
   */
  resticRepository?: string;
  /**
   * variable to define a space separated list of additional restic tags. see https://hub.docker.com/r/itzg/mc-backup
   *
   * @default "mc_backups"
   */
  resticAdditionalTags?: string;
  /**
   * see https://restic.readthedocs.io/en/latest/060_forget.html
   *
   * @default "--keep-daily 7 --keep-weekly 5 --keep-monthly 1..."
   */
  pruneResticRetention?: string;
  resticHostname?: unknown;
  /**
   * At least one of RESTIC_PASSWORD* env variables need to be defined, see https://restic.readthedocs.io/en/latest/030_preparing_a_new_repo.html
   *
   * @default {}
   */
  resticEnvs?: MinecraftHelmValuesMcbackupResticEnvs;
  /**
   * Additional minecraft container environment variables
   * Values can be either variable values or `valueFrom` yaml
   *
   * @default {}
   */
  extraEnv?: MinecraftHelmValuesMcbackupExtraEnv;
  envFrom?: unknown[];
  /**
   * @default {"requests":{"memory":"512Mi","cpu":"500m"}}
   */
  resources?: MinecraftHelmValuesMcbackupResources;
  /**
   * @default {"annotations":{},"backupDir":{"enabled":false,"Size":"1Gi","accessModes":["ReadWriteOnce"]}}
   */
  persistence?: MinecraftHelmValuesMcbackupPersistence;
};

export type MinecraftHelmValuesMcbackupImage = {
  /**
   * @default "itzg/mc-backup"
   */
  repository?: string;
  /**
   * @default "latest"
   */
  tag?: string;
  /**
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type MinecraftHelmValuesMcbackupResticEnvs = object;

export type MinecraftHelmValuesMcbackupExtraEnv = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MinecraftHelmValuesMcbackupResources = {
  /**
   * @default {"memory":"512Mi","cpu":"500m"}
   */
  requests?: MinecraftHelmValuesMcbackupResourcesRequests;
  /**
   * Kubernetes resource limits (memory, cpu, etc.)
   */
  limits?: MinecraftHelmValuesMcbackupResourcesLimits;
};

export type MinecraftHelmValuesMcbackupResourcesRequests = {
  /**
   * @default "512Mi"
   */
  memory?: string;
  /**
   * @default "500m"
   */
  cpu?: string;
};

export type MinecraftHelmValuesMcbackupResourcesLimits = {
  /**
   * @default "512Mi"
   */
  memory?: string;
  /**
   * @default "500m"
   */
  cpu?: string;
};

export type MinecraftHelmValuesMcbackupPersistence = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default {}
   */
  annotations?: MinecraftHelmValuesMcbackupPersistenceAnnotations;
  /**
   * minecraft data Persistent Volume Storage Class
   * If defined, storageClassName: <storageClass>
   * If set to "-", storageClassName: "", which disables dynamic provisioning
   * If undefined (the default) or set to null, no storageClassName spec is
   * set, choosing the default provisioner.  (gp2 on AWS, standard on
   * GKE, AWS & OpenStack)
   *
   * @default {"enabled":false,"Size":"1Gi","accessModes":["ReadWriteOnce"]}
   */
  backupDir?: MinecraftHelmValuesMcbackupPersistenceBackupDir;
};

export type MinecraftHelmValuesMcbackupPersistenceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type MinecraftHelmValuesMcbackupPersistenceBackupDir = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * Set this to false if you don't care to persist state between restarts.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * @default "1Gi"
   */
  Size?: string;
  accessModes?: string[];
};

export type MinecraftHelmValues = {
  /**
   * ref: https://hub.docker.com/r/itzg/minecraft-server/
   *
   * @default {...} (4 keys)
   */
  image?: MinecraftHelmValuesImage;
  /**
   * WARNING ###
   * Minecraft is not horizontally scalable, adjusting this will most likely break your setup.
   * WARNING ###
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * @default ""
   */
  nameOverride?: string;
  /**
   * @default ""
   */
  fullnameOverride?: string;
  /**
   * Configure resource requests and limits
   * ref: http://kubernetes.io/docs/user-guide/compute-resources/
   *
   * @default {"requests":{"memory":"512Mi","cpu":"500m"}}
   */
  resources?: MinecraftHelmValuesResources;
  /**
   * @default {"postStart":[],"preStop":[]}
   */
  lifecycle?: MinecraftHelmValuesLifecycle;
  /**
   * If true the workload is defined as a StatefulSet instead of a Deployment.
   * Make sure to also update the strategyType!
   * All configuration options for the Deployment (e.g. annotations) are used for the StatefulSet.
   * Regarding persistence: When an existing PVC is provided it will be shared between all Pods.
   * Otherwise the PVC configuration is used as a template to create PVCs for each replica.
   *
   * @default false
   */
  workloadAsStatefulSet?: boolean;
  /**
   * upgrade strategy type, depending on workload type:
   *
   * @default "Recreate"
   */
  strategyType?: string;
  /**
   * @default {}
   */
  nodeSelector?: MinecraftHelmValuesNodeSelector;
  tolerations?: unknown[];
  /**
   * @default {}
   */
  affinity?: MinecraftHelmValuesAffinity;
  /**
   * @default 10
   */
  revisionHistoryLimit?: number;
  /**
   * @default {...} (5 keys)
   */
  podSecurityContext?: MinecraftHelmValuesPodSecurityContext;
  /**
   * @default {"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true,"allowPrivilegeEscalation":false}
   */
  securityContext?: MinecraftHelmValuesSecurityContext;
  /**
   * Most of these map to environment variables. See Minecraft for details:
   * https://hub.docker.com/r/itzg/minecraft-server/
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: MinecraftHelmValuesLivenessProbe;
  /**
   * @default {...} (6 keys)
   */
  readinessProbe?: MinecraftHelmValuesReadinessProbe;
  /**
   * @default {...} (4 keys)
   */
  startupProbe?: MinecraftHelmValuesStartupProbe;
  /**
   * Array of initContainers to add to include in deployment (supports templating)
   *
   * @default []
   */
  initContainers?: object | string[];
  /**
   * Array of additional sidecards to include in the deployment (supports templating)
   *
   * @default []
   */
  sidecarContainers?: object | string[];
  extraVolumes?: unknown[];
  /**
   * Array of extra objects to deploy with the release
   *
   * @default []
   */
  extraDeploy?: object | string[];
  /**
   * Extra fields to set on the pod
   * Fields set here will be added to the end of the Pod spec
   * Can include any fields from https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-v1/#PodSpec
   * that are not already set by the chart.
   * The value of the field will be interpretted as a template.
   *
   * @default {}
   */
  extraPodSpec?: MinecraftHelmValuesExtraPodSpec;
  /**
   * @default {...} (73 keys)
   */
  minecraftServer?: MinecraftHelmValuesMinecraftServer;
  /**
   * Additional minecraft container environment variables
   * Values can be either variable values or `valueFrom` yaml
   *
   * @default {}
   */
  extraEnv?: MinecraftHelmValuesExtraEnv;
  envFrom?: unknown[];
  /**
   * @default {"labels":{},"annotations":{},"dataDir":{"enabled":false,"Size":"1Gi","accessModes":["ReadWriteOnce"]}}
   */
  persistence?: MinecraftHelmValuesPersistence;
  /**
   * @default {}
   */
  podAnnotations?: MinecraftHelmValuesPodAnnotations;
  /**
   * @default {}
   */
  podLabels?: MinecraftHelmValuesPodLabels;
  /**
   * @default {}
   */
  deploymentAnnotations?: MinecraftHelmValuesDeploymentAnnotations;
  /**
   * @default {}
   */
  deploymentLabels?: MinecraftHelmValuesDeploymentLabels;
  /**
   * @default {}
   */
  serviceAnnotations?: MinecraftHelmValuesServiceAnnotations;
  /**
   * @default {}
   */
  serviceLabels?: MinecraftHelmValuesServiceLabels;
  /**
   * @default {}
   */
  rconServiceAnnotations?: MinecraftHelmValuesRconServiceAnnotations;
  /**
   * @default {}
   */
  rconServiceLabels?: MinecraftHelmValuesRconServiceLabels;
  /**
   * PLEASE NOTE! rcon must be enabled above!  It does NOT require a nodePort or loadBalancerIP
   *
   * @default {...} (28 keys)
   */
  mcbackup?: MinecraftHelmValuesMcbackup;
};

export type MinecraftHelmParameters = {
  "image.repository"?: string;
  "image.tag"?: string;
  "image.pullPolicy"?: string;
  "image.pullSecret"?: string;
  replicaCount?: string;
  nameOverride?: string;
  fullnameOverride?: string;
  "resources.requests.memory"?: string;
  "resources.requests.cpu"?: string;
  "resources.limits.memory"?: string;
  "resources.limits.cpu"?: string;
  "lifecycle.postStart"?: string;
  "lifecycle.preStop"?: string;
  workloadAsStatefulSet?: string;
  strategyType?: string;
  tolerations?: string;
  revisionHistoryLimit?: string;
  "podSecurityContext.runAsUser"?: string;
  "podSecurityContext.runAsGroup"?: string;
  "podSecurityContext.runAsNonRoot"?: string;
  "podSecurityContext.fsGroup"?: string;
  "podSecurityContext.seccompProfile.type"?: string;
  "securityContext.capabilities.drop"?: string;
  "securityContext.readOnlyRootFilesystem"?: string;
  "securityContext.allowPrivilegeEscalation"?: string;
  "livenessProbe.command"?: string;
  "livenessProbe.initialDelaySeconds"?: string;
  "livenessProbe.periodSeconds"?: string;
  "livenessProbe.failureThreshold"?: string;
  "livenessProbe.successThreshold"?: string;
  "livenessProbe.timeoutSeconds"?: string;
  "readinessProbe.command"?: string;
  "readinessProbe.initialDelaySeconds"?: string;
  "readinessProbe.periodSeconds"?: string;
  "readinessProbe.failureThreshold"?: string;
  "readinessProbe.successThreshold"?: string;
  "readinessProbe.timeoutSeconds"?: string;
  "startupProbe.command"?: string;
  "startupProbe.enabled"?: string;
  "startupProbe.failureThreshold"?: string;
  "startupProbe.periodSeconds"?: string;
  initContainers?: string;
  sidecarContainers?: string;
  extraVolumes?: string;
  extraDeploy?: string;
  "minecraftServer.eula"?: string;
  "minecraftServer.version"?: string;
  "minecraftServer.type"?: string;
  "minecraftServer.forgeVersion"?: string;
  "minecraftServer.forgeInstallerUrl"?: string;
  "minecraftServer.spongeVersion"?: string;
  "minecraftServer.bukkitDownloadUrl"?: string;
  "minecraftServer.spigotDownloadUrl"?: string;
  "minecraftServer.paperDownloadUrl"?: string;
  "minecraftServer.ftbModpackId"?: string;
  "minecraftServer.ftbModpackVersionId"?: string;
  "minecraftServer.cfServerMod"?: string;
  "minecraftServer.fabricLauncherVersion"?: string;
  "minecraftServer.fabricLoaderVersion"?: string;
  "minecraftServer.ftbLegacyJavaFixer"?: string;
  "minecraftServer.difficulty"?: string;
  "minecraftServer.whitelist"?: string;
  "minecraftServer.ops"?: string;
  "minecraftServer.icon"?: string;
  "minecraftServer.maxPlayers"?: string;
  "minecraftServer.maxWorldSize"?: string;
  "minecraftServer.allowNether"?: string;
  "minecraftServer.announcePlayerAchievements"?: string;
  "minecraftServer.enableCommandBlock"?: string;
  "minecraftServer.forcegameMode"?: string;
  "minecraftServer.generateStructures"?: string;
  "minecraftServer.hardcore"?: string;
  "minecraftServer.maxBuildHeight"?: string;
  "minecraftServer.maxTickTime"?: string;
  "minecraftServer.spawnAnimals"?: string;
  "minecraftServer.spawnMonsters"?: string;
  "minecraftServer.spawnNPCs"?: string;
  "minecraftServer.spawnProtection"?: string;
  "minecraftServer.viewDistance"?: string;
  "minecraftServer.levelSeed"?: string;
  "minecraftServer.gameMode"?: string;
  "minecraftServer.motd"?: string;
  "minecraftServer.pvp"?: string;
  "minecraftServer.levelType"?: string;
  "minecraftServer.generatorSettings"?: string;
  "minecraftServer.worldSaveName"?: string;
  "minecraftServer.downloadWorldUrl"?: string;
  "minecraftServer.forceReDownload"?: string;
  "minecraftServer.downloadModpackUrl"?: string;
  "minecraftServer.removeOldMods"?: string;
  "minecraftServer.vanillaTweaksShareCodes"?: string;
  "minecraftServer.resourcePackUrl"?: string;
  "minecraftServer.resourcePackSha"?: string;
  "minecraftServer.resourcePackEnforce"?: string;
  "minecraftServer.onlineMode"?: string;
  "minecraftServer.enforceSecureProfile"?: string;
  "minecraftServer.memory"?: string;
  "minecraftServer.jvmOpts"?: string;
  "minecraftServer.jvmXXOpts"?: string;
  "minecraftServer.overrideServerProperties"?: string;
  "minecraftServer.serviceType"?: string;
  "minecraftServer.nodePort"?: string;
  "minecraftServer.servicePort"?: string;
  "minecraftServer.clusterIP"?: string;
  "minecraftServer.loadBalancerClass"?: string;
  "minecraftServer.loadBalancerIP"?: string;
  "minecraftServer.externalIPs"?: string;
  "minecraftServer.modUrls"?: string;
  "minecraftServer.pluginUrls"?: string;
  "minecraftServer.spigetResources"?: string;
  "minecraftServer.modrinth.projects"?: string;
  "minecraftServer.modrinth.downloadDependencies"?: string;
  "minecraftServer.modrinth.allowedVersionType"?: string;
  "minecraftServer.autoCurseForge.apiKey.key"?: string;
  "minecraftServer.autoCurseForge.apiKey.existingSecret"?: string;
  "minecraftServer.autoCurseForge.apiKey.secretKey"?: string;
  "minecraftServer.autoCurseForge.pageUrl"?: string;
  "minecraftServer.autoCurseForge.slug"?: string;
  "minecraftServer.autoCurseForge.fileId"?: string;
  "minecraftServer.autoCurseForge.filenameMatcher"?: string;
  "minecraftServer.autoCurseForge.excludeMods"?: string;
  "minecraftServer.autoCurseForge.includeMods"?: string;
  "minecraftServer.autoCurseForge.excludeIncludeFile"?: string;
  "minecraftServer.autoCurseForge.forceSynchronize"?: string;
  "minecraftServer.autoCurseForge.setLevelFrom"?: string;
  "minecraftServer.autoCurseForge.parallelDownloads"?: string;
  "minecraftServer.autoCurseForge.overridesSkipExisting"?: string;
  "minecraftServer.rcon.enabled"?: string;
  "minecraftServer.rcon.withGeneratedPassword"?: string;
  "minecraftServer.rcon.port"?: string;
  "minecraftServer.rcon.password"?: string;
  "minecraftServer.rcon.existingSecret"?: string;
  "minecraftServer.rcon.secretKey"?: string;
  "minecraftServer.rcon.serviceType"?: string;
  "minecraftServer.rcon.nodePort"?: string;
  "minecraftServer.rcon.clusterIP"?: string;
  "minecraftServer.rcon.loadBalancerClass"?: string;
  "minecraftServer.rcon.loadBalancerIP"?: string;
  "minecraftServer.tty"?: string;
  "minecraftServer.extraPorts"?: string;
  "minecraftServer.query.enabled"?: string;
  "minecraftServer.query.port"?: string;
  envFrom?: string;
  "persistence.dataDir.enabled"?: string;
  "persistence.dataDir.Size"?: string;
  "persistence.dataDir.accessModes"?: string;
  "mcbackup.enabled"?: string;
  "mcbackup.image.repository"?: string;
  "mcbackup.image.tag"?: string;
  "mcbackup.image.pullPolicy"?: string;
  "mcbackup.initialDelay"?: string;
  "mcbackup.backupName"?: string;
  "mcbackup.backupInterval"?: string;
  "mcbackup.pauseIfNoPlayers"?: string;
  "mcbackup.pruneBackupsDays"?: string;
  "mcbackup.rconRetries"?: string;
  "mcbackup.rconRetryInterval"?: string;
  "mcbackup.excludes"?: string;
  "mcbackup.backupMethod"?: string;
  "mcbackup.destDir"?: string;
  "mcbackup.linkLatest"?: string;
  "mcbackup.compressMethod"?: string;
  "mcbackup.zstdParameters"?: string;
  "mcbackup.rcloneRemote"?: string;
  "mcbackup.rcloneDestDir"?: string;
  "mcbackup.rcloneCompressMethod"?: string;
  "mcbackup.rcloneConfig"?: string;
  "mcbackup.resticRepository"?: string;
  "mcbackup.resticAdditionalTags"?: string;
  "mcbackup.pruneResticRetention"?: string;
  "mcbackup.resticHostname"?: string;
  "mcbackup.envFrom"?: string;
  "mcbackup.resources.requests.memory"?: string;
  "mcbackup.resources.requests.cpu"?: string;
  "mcbackup.resources.limits.memory"?: string;
  "mcbackup.resources.limits.cpu"?: string;
  "mcbackup.persistence.backupDir.enabled"?: string;
  "mcbackup.persistence.backupDir.Size"?: string;
  "mcbackup.persistence.backupDir.accessModes"?: string;
};
