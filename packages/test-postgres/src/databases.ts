import { currentDatabaseOwner, ownerCommentSql } from "./owner.ts";
import { databaseUrlFromAdmin } from "./server.ts";
import {
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

export function dropOwnedTestDatabaseSync(
  dbName: string,
  options?: { readonly adminUrl?: string | undefined },
): void {
  assertOwnedEphemeralDatabaseName(dbName);
  psqlMaintenance(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`, options);
}

export async function dropOwnedTestDatabase(
  dbName: string,
  options?: { readonly adminUrl?: string | undefined },
): Promise<void> {
  assertOwnedEphemeralDatabaseName(dbName);
  await psqlMaintenanceCommandsAsync(
    [`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`],
    options,
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
