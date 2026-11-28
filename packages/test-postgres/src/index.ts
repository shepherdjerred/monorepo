import * as binaries from "./binaries.ts";
import * as databases from "./databases.ts";
import * as owner from "./owner.ts";
import * as postmaster from "./postmaster.ts";
import * as server from "./server.ts";
import * as sweep from "./sweep.ts";
import * as templates from "./templates.ts";

export type CommandRunner = binaries.CommandRunner;
export type DiscoveredPostgresBinaries = binaries.DiscoveredPostgresBinaries;
export type RunResult = binaries.RunResult;

export type DatabaseOwner = owner.DatabaseOwner;
export type OwnerProcessState = owner.OwnerProcessState;
export type OwnerRecord = owner.OwnerRecord;
export type ProcessProbe = owner.ProcessProbe;
export type StaleTemplateDecision = owner.StaleTemplateDecision;
export type SweepDecision = owner.SweepDecision;
export type TemplateRebuildDecision = owner.TemplateRebuildDecision;

export type PostmasterPidInfo = postmaster.PostmasterPidInfo;
export type PostgresClusterDurability = postmaster.PostgresClusterDurability;
export type EnsurePostgresClusterOptions = server.EnsurePostgresClusterOptions;

export type ListedDatabaseRow = sweep.ListedDatabaseRow;
export type SweepOptions = sweep.SweepOptions;
export type SweepSummary = sweep.SweepSummary;
export type TestDatabasePrefix = sweep.TestDatabasePrefix;

export type EnsureTemplateOptions = templates.EnsureTemplateOptions;
export type DropOwnedDatabaseOptions = databases.DropOwnedDatabaseOptions;
export type ExplicitDropDecision = databases.ExplicitDropDecision;
export type OwnedTestDatabaseHandle = databases.OwnedTestDatabaseHandle;

export const POSTGRES_MAJOR = binaries.POSTGRES_MAJOR;
export const binariesHint = binaries.binariesHint;
export const candidatePostgresBinDirs = binaries.candidatePostgresBinDirs;
export const discoverPostgresBinDir = binaries.discoverPostgresBinDir;
export const envWithPostgresBin = binaries.envWithPostgresBin;
export const executableFileName = binaries.executableFileName;
export const joinForPlatform = binaries.joinForPlatform;
export const parsePostgresMajor = binaries.parsePostgresMajor;
export const postgresBinaryPath = binaries.postgresBinaryPath;
export const runCommandAsync = binaries.runCommandAsync;
export const runCommandSync = binaries.runCommandSync;
export const sanitizedEnv = binaries.sanitizedEnv;

export const OWNER_MARKER = owner.OWNER_MARKER;
export const LEGACY_SCOUT_OWNER_MARKER = owner.LEGACY_SCOUT_OWNER_MARKER;
export const SWEEP_GRACE_MS = owner.SWEEP_GRACE_MS;
export const STALE_TEMPLATE_MAX_AGE_MS = owner.STALE_TEMPLATE_MAX_AGE_MS;
export const currentDatabaseOwner = owner.currentDatabaseOwner;
export const currentProcessStart = owner.currentProcessStart;
export const decideStaleTemplatePrune = owner.decideStaleTemplatePrune;
export const decideSweep = owner.decideSweep;
export const decideTemplateRebuild = owner.decideTemplateRebuild;
export const formatOwnerComment = owner.formatOwnerComment;
export const hostProcessProbe = owner.hostProcessProbe;
export const ownerCommentSql = owner.ownerCommentSql;
export const ownerProcessState = owner.ownerProcessState;
export const parseOwnerComment = owner.parseOwnerComment;
export const processIsAlive = owner.processIsAlive;
export const processStartForPid = owner.processStartForPid;
export const sqlLiteral = owner.sqlLiteral;

export const DISPOSABLE_TEST_PG_DIR_NAME =
  postmaster.DISPOSABLE_TEST_PG_DIR_NAME;
export const assertDisposableTestPgDataDir =
  postmaster.assertDisposableTestPgDataDir;
export const hasStartupWalPanic = postmaster.hasStartupWalPanic;
export const isDisposableTestPgDataDir = postmaster.isDisposableTestPgDataDir;
export const parsePostmasterPid = postmaster.parsePostmasterPid;
export const pgCtlOptionsForDurability = postmaster.pgCtlOptionsForDurability;
export const readPostmasterPid = postmaster.readPostmasterPid;

export const DEFAULT_SHARED_PG_PORT = server.DEFAULT_SHARED_PG_PORT;
export const SHARED_PG_ROLES = server.SHARED_PG_ROLES;
export const assertDevPostgresIdentity = server.assertDevPostgresIdentity;
export const databaseUrlFromAdmin = server.databaseUrlFromAdmin;
export const ensurePostgresCluster = server.ensurePostgresCluster;
export const ensureSharedPostgres = server.ensureSharedPostgres;
export const explicitPostgresPort = server.explicitPostgresPort;
export const managedPostgresDataRoots = server.managedPostgresDataRoots;
export const parsePortEnv = server.parsePortEnv;
export const sharedDatabaseUrl = server.sharedDatabaseUrl;
export const sharedPostgresDataRoot = server.sharedPostgresDataRoot;
export const sharedPostgresPort = server.sharedPostgresPort;

export const TEST_DATABASE_PREFIXES = sweep.TEST_DATABASE_PREFIXES;
export const ensureDatabase = sweep.ensureDatabase;
export const listManagedDatabases = sweep.listManagedDatabases;
export const pruneStaleTemplateDatabases = sweep.pruneStaleTemplateDatabases;
export const psqlMaintenance = sweep.psqlMaintenance;
export const psqlMaintenanceCommands = sweep.psqlMaintenanceCommands;
export const psqlMaintenanceCommandsAsync = sweep.psqlMaintenanceCommandsAsync;
export const sweepStaleTestDatabases = sweep.sweepStaleTestDatabases;
export const sweepStaleTestDatabasesOnce = sweep.sweepStaleTestDatabasesOnce;

export const computeMigrationHash = templates.computeMigrationHash;
export const ensureTemplateDatabase = templates.ensureTemplateDatabase;
export const formatTemplateDatabaseName = templates.formatTemplateDatabaseName;
export const isTemplateDatabaseReadySync =
  templates.isTemplateDatabaseReadySync;
export const withPostgresAdvisoryLock = templates.withPostgresAdvisoryLock;

export const assertOwnedEphemeralDatabaseName =
  databases.assertOwnedEphemeralDatabaseName;
export const cloneTemplateDatabaseSync = databases.cloneTemplateDatabaseSync;
export const createEmptyTestDatabase = databases.createEmptyTestDatabase;
export const createTemplateTestDatabase = databases.createTemplateTestDatabase;
export const decideExplicitDrop = databases.decideExplicitDrop;
export const dropOwnedTestDatabase = databases.dropOwnedTestDatabase;
export const dropOwnedTestDatabaseSync = databases.dropOwnedTestDatabaseSync;
