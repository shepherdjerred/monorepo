import {
  currentDatabaseOwner,
  currentProcessStart,
  hostProcessProbe,
  ownerCommentSql,
  ownerProcessState,
  sqlLiteral,
  type OwnerRecord,
  type ProcessProbe,
} from "./owner.ts";
import { databaseUrlFromAdmin } from "./server.ts";
import {
  listManagedDatabases,
  listManagedDatabasesAsync,
  psqlMaintenance,
  psqlMaintenanceCommands,
  psqlMaintenanceCommandsAsync,
  sweepStaleTestDatabasesOnce,
  templateCloneSharedLockSql,
  templateCloneSharedUnlockSql,
  type TestDatabasePrefix,
} from "./sweep.ts";
import {
  type EnsureTemplateOptions,
  ensureTemplateDatabase,
  resolveMaintenanceAndUserUrl,
} from "./templates.ts";

const OWNED_EPHEMERAL_DB_PATTERN =
  /^(?:scout|delivery|media|tracker)_(?:test|mig)_[a-z0-9_]+$/u;

function randomDatabaseSuffix(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function assertOwnedEphemeralDatabaseName(dbName: string): void {
  if (!OWNED_EPHEMERAL_DB_PATTERN.test(dbName)) {
    throw new Error(`Refusing to drop non-test database ${dbName}`);
  }
}

export type ExplicitDropDecision =
  | { readonly action: "noop" }
  | { readonly action: "drop" }
  | {
      readonly action: "refuse";
      readonly reason:
        | "unowned"
        | "malformed-owner"
        | "foreign-host"
        | "owner-alive"
        | "owner-start-unknown";
      readonly message: string;
    };

export function decideExplicitDrop(input: {
  readonly dbName: string;
  readonly row: { readonly record: OwnerRecord } | undefined;
  readonly callerPid: number;
  readonly callerProcessStart: string;
  readonly probe: ProcessProbe;
}): ExplicitDropDecision {
  const { dbName, row, callerPid, callerProcessStart, probe } = input;
  if (row === undefined) {
    return { action: "noop" };
  }
  if (row.record.kind === "none") {
    return {
      action: "refuse",
      reason: "unowned",
      message: `Refusing to drop test database ${dbName}: database has no monorepo-test-owner record`,
    };
  }
  if (row.record.kind === "malformed") {
    return {
      action: "refuse",
      reason: "malformed-owner",
      message: `Refusing to drop test database ${dbName}: malformed owner comment (${row.record.comment})`,
    };
  }
  const { owner } = row.record;
  if (
    owner.host === probe.host &&
    owner.pid === callerPid &&
    owner.processStart === callerProcessStart
  ) {
    return { action: "drop" };
  }
  switch (ownerProcessState(owner, probe)) {
    case "gone":
      return { action: "drop" };
    case "foreign-host":
      return {
        action: "refuse",
        reason: "foreign-host",
        message: `Refusing to drop test database ${dbName}: owned by foreign host ${owner.host} (current host: ${probe.host})`,
      };
    case "alive":
      return {
        action: "refuse",
        reason: "owner-alive",
        message: `Refusing to drop test database ${dbName}: owned by another live process (pid ${owner.pid.toString()} started ${owner.processStart} on ${owner.host})`,
      };
    case "start-unknown":
      return {
        action: "refuse",
        reason: "owner-start-unknown",
        message: `Refusing to drop test database ${dbName}: cannot verify start time of live owner pid ${owner.pid.toString()} on ${owner.host}`,
      };
  }
}

export type DropOwnedDatabaseOptions = {
  readonly adminUrl?: string | undefined;
  readonly probe?: ProcessProbe | undefined;
};

export function dropOwnedTestDatabaseSync(
  dbName: string,
  options?: DropOwnedDatabaseOptions,
): void {
  assertOwnedEphemeralDatabaseName(dbName);
  const row = listManagedDatabases(`d.datname = ${sqlLiteral(dbName)}`, {
    adminUrl: options?.adminUrl,
  })[0];
  const decision = decideExplicitDrop({
    dbName,
    row,
    callerPid: process.pid,
    callerProcessStart: currentProcessStart(),
    probe: options?.probe ?? hostProcessProbe,
  });
  if (decision.action === "noop") {
    return;
  }
  if (decision.action === "refuse") {
    throw new Error(decision.message);
  }
  psqlMaintenance(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`, {
    adminUrl: options?.adminUrl,
  });
}

export async function dropOwnedTestDatabase(
  dbName: string,
  options?: DropOwnedDatabaseOptions,
): Promise<void> {
  assertOwnedEphemeralDatabaseName(dbName);
  const rows = await listManagedDatabasesAsync(
    `d.datname = ${sqlLiteral(dbName)}`,
    { adminUrl: options?.adminUrl },
  );
  const decision = decideExplicitDrop({
    dbName,
    row: rows[0],
    callerPid: process.pid,
    callerProcessStart: currentProcessStart(),
    probe: options?.probe ?? hostProcessProbe,
  });
  if (decision.action === "noop") {
    return;
  }
  if (decision.action === "refuse") {
    throw new Error(decision.message);
  }
  await psqlMaintenanceCommandsAsync(
    [`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`],
    { adminUrl: options?.adminUrl },
  );
}

export type OwnedTestDatabaseHandle = {
  readonly dbName: string;
  readonly url: string;
  readonly adminUrl: string;
  readonly drop: () => Promise<void>;
  readonly dropSync: () => void;
};

function buildOwnedHandle(
  dbName: string,
  maintenanceUrl: string,
  clientAdminUrl: string,
): OwnedTestDatabaseHandle {
  return {
    dbName,
    url: databaseUrlFromAdmin(clientAdminUrl, dbName),
    adminUrl: clientAdminUrl,
    drop: () => dropOwnedTestDatabase(dbName, { adminUrl: maintenanceUrl }),
    dropSync: () => {
      dropOwnedTestDatabaseSync(dbName, { adminUrl: maintenanceUrl });
    },
  };
}

function isMissingTemplateCloneError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /template database .* does not exist/iu.test(message) ||
    /database "[^"]*_template_[^"]*" does not exist/iu.test(message)
  );
}

export function cloneTemplateDatabaseSync(options: {
  readonly prefix: TestDatabasePrefix;
  readonly templateName: string;
  readonly dbName?: string;
  readonly user?: string;
  readonly adminUrl?: string | undefined;
}): OwnedTestDatabaseHandle {
  const { maintenanceUrl, clientAdminUrl } =
    resolveMaintenanceAndUserUrl(options);
  sweepStaleTestDatabasesOnce({ adminUrl: maintenanceUrl });

  const dbName =
    options.dbName ?? `${options.prefix}_test_${randomDatabaseSuffix()}`;
  assertOwnedEphemeralDatabaseName(dbName);

  psqlMaintenanceCommands(
    [
      templateCloneSharedLockSql(options.templateName),
      `CREATE DATABASE "${dbName}" TEMPLATE "${options.templateName}"`,
      ownerCommentSql(dbName, currentDatabaseOwner()),
      templateCloneSharedUnlockSql(options.templateName),
    ],
    { adminUrl: maintenanceUrl },
  );
  return buildOwnedHandle(dbName, maintenanceUrl, clientAdminUrl);
}

export async function createTemplateTestDatabase(
  options: EnsureTemplateOptions & { readonly dbName?: string },
): Promise<OwnedTestDatabaseHandle & { readonly templateName: string }> {
  const { maintenanceUrl, clientAdminUrl } =
    resolveMaintenanceAndUserUrl(options);
  const dbName =
    options.dbName ?? `${options.prefix}_test_${randomDatabaseSuffix()}`;
  assertOwnedEphemeralDatabaseName(dbName);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ensured = await ensureTemplateDatabase(options);
    try {
      await psqlMaintenanceCommandsAsync(
        [
          templateCloneSharedLockSql(ensured.templateName),
          `CREATE DATABASE "${dbName}" TEMPLATE "${ensured.templateName}"`,
          ownerCommentSql(dbName, currentDatabaseOwner()),
          templateCloneSharedUnlockSql(ensured.templateName),
        ],
        { adminUrl: maintenanceUrl },
      );
      return {
        ...buildOwnedHandle(dbName, maintenanceUrl, clientAdminUrl),
        templateName: ensured.templateName,
      };
    } catch (error) {
      if (attempt === 0 && isMissingTemplateCloneError(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Failed to clone template database for ${dbName}`);
}

export async function createEmptyTestDatabase(options: {
  readonly prefix: TestDatabasePrefix;
  readonly user?: string;
  readonly adminUrl?: string | undefined;
  readonly kind?: "mig" | "test";
  readonly dbName?: string;
}): Promise<OwnedTestDatabaseHandle> {
  const { maintenanceUrl, clientAdminUrl } =
    resolveMaintenanceAndUserUrl(options);
  sweepStaleTestDatabasesOnce({ adminUrl: maintenanceUrl });

  const kind = options.kind ?? "mig";
  const dbName =
    options.dbName ?? `${options.prefix}_${kind}_${randomDatabaseSuffix()}`;
  assertOwnedEphemeralDatabaseName(dbName);

  await psqlMaintenanceCommandsAsync(
    [
      `CREATE DATABASE "${dbName}"`,
      ownerCommentSql(dbName, currentDatabaseOwner()),
    ],
    { adminUrl: maintenanceUrl },
  );
  return buildOwnedHandle(dbName, maintenanceUrl, clientAdminUrl);
}
