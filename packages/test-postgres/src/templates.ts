import path from "node:path";
import { postgresBinaryPath, sanitizedEnv } from "./binaries.ts";
import {
  currentDatabaseOwner,
  decideTemplateRebuild,
  hostProcessProbe,
  ownerCommentSql,
} from "./owner.ts";
import { readFileBytesSync } from "./read-sync.ts";
import {
  databaseUrlFromAdmin,
  ensureSharedPostgres,
  sharedDatabaseUrl,
} from "./server.ts";
import {
  type ListedDatabaseRow,
  listManagedDatabases,
  listManagedDatabasesAsync,
  LOCK_TIMEOUT_SQL,
  pruneStaleTemplateDatabases,
  psqlMaintenanceCommandsAsync,
  sweepStaleTestDatabasesOnce,
  type TestDatabasePrefix,
} from "./sweep.ts";

const TEMPLATE_ENGINE_VERSION = "monorepo-template-v1";
const ADVISORY_LOCK_NAMESPACE = "monorepo-test-postgres";
const ADVISORY_LOCK_TIMEOUT_MS = 180_000;

export function computeMigrationHash(options: {
  readonly migrationsDir: string;
  readonly globPattern?: string | undefined;
  readonly extraInputs?: readonly string[] | undefined;
}): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(TEMPLATE_ENGINE_VERSION);
  const glob = new Bun.Glob(options.globPattern ?? "*/migration.sql");
  const files = [
    ...glob.scanSync({ cwd: options.migrationsDir, onlyFiles: true }),
  ]
    .map((entry) => entry.replaceAll("\\", "/"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No migrations found under ${options.migrationsDir}`);
  }
  for (const relativeFile of files) {
    hasher.update(relativeFile);
    hasher.update(
      readFileBytesSync(path.join(options.migrationsDir, relativeFile)),
    );
  }
  if (options.extraInputs !== undefined) {
    for (const extra of options.extraInputs) {
      hasher.update(extra);
    }
  }
  return hasher.digest("hex");
}

export function formatTemplateDatabaseName(
  prefix: TestDatabasePrefix,
  hash: string,
  hashLength = 16,
): string {
  return `${prefix}_template_${hash.slice(0, hashLength)}`;
}

async function readLineUntilMarker(
  stream: ReadableStream<Uint8Array>,
  marker: string,
  timeoutMs: number,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => {
            resolve("timeout");
          }, remaining);
        }),
      ]).finally(() => {
        clearTimeout(timer);
      });
      if (chunk === "timeout") {
        throw new Error(
          `Timed out after ${String(timeoutMs)}ms waiting for PostgreSQL advisory lock`,
        );
      }
      if (chunk.done) {
        throw new Error(
          `psql session exited before acquiring advisory lock (output: ${buffered.trim()})`,
        );
      }
      buffered += decoder.decode(chunk.value, { stream: true });
      if (buffered.split(/\r?\n/u).includes(marker)) {
        return;
      }
    }
    throw new Error(
      `Timed out after ${String(timeoutMs)}ms waiting for PostgreSQL advisory lock`,
    );
  } finally {
    reader.releaseLock();
  }
}

export async function withPostgresAdvisoryLock<T>(
  lockKey: string,
  action: () => Promise<T>,
  options?: {
    readonly adminUrl?: string | undefined;
    readonly timeoutMs?: number;
  },
): Promise<T> {
  const allowAnyMajor = options?.adminUrl !== undefined;
  const psql = postgresBinaryPath("psql", { allowAnyMajor });
  const targetUrl = options?.adminUrl ?? ensureSharedPostgres().superUrl;
  const marker = "__TEST_PG_ADVISORY_LOCKED__";
  const escapedKey = lockKey.replaceAll("'", "''");
  const escapedNs = ADVISORY_LOCK_NAMESPACE.replaceAll("'", "''");

  const argv = [
    psql,
    "--no-psqlrc",
    "-q",
    "--dbname",
    targetUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
  ];
  const child = Bun.spawn(argv, {
    env: sanitizedEnv(),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderrPromise = new Response(child.stderr).text();

  try {
    await child.stdin.write(
      `SELECT pg_advisory_lock(hashtext('${escapedNs}'), hashtext('${escapedKey}'));\n` +
        `SELECT '${marker}';\n`,
    );
    await child.stdin.flush();
    await readLineUntilMarker(
      child.stdout,
      marker,
      options?.timeoutMs ?? ADVISORY_LOCK_TIMEOUT_MS,
    );
    return await action();
  } catch (error) {
    child.kill();
    const stderrText = await stderrPromise;
    const stderr = stderrText.trim();
    if (stderr !== "" && error instanceof Error) {
      throw new Error(`${error.message} (psql stderr: ${stderr})`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    try {
      await child.stdin.write("SELECT pg_advisory_unlock_all();\n\\q\n");
      await child.stdin.end();
    } catch {
      child.kill();
    }
    await child.exited;
  }
}

function isCompletedTemplateRow(
  row: ListedDatabaseRow | undefined,
  wantedHash: string,
): boolean {
  return (
    row !== undefined &&
    row.isTemplate &&
    row.record.kind === "owned" &&
    row.record.owner.templateHash === wantedHash
  );
}

export function isTemplateDatabaseReadySync(
  templateName: string,
  wantedHash: string,
  options?: { readonly adminUrl?: string | undefined },
): boolean {
  const escaped = templateName.replaceAll("'", "''");
  const row = listManagedDatabases(`d.datname = '${escaped}'`, options)[0];
  return isCompletedTemplateRow(row, wantedHash);
}

async function isTemplateDatabaseReadyAsync(
  templateName: string,
  wantedHash: string,
  options?: { readonly adminUrl?: string | undefined },
): Promise<boolean> {
  const escaped = templateName.replaceAll("'", "''");
  const rows = await listManagedDatabasesAsync(
    `d.datname = '${escaped}'`,
    options,
  );
  return isCompletedTemplateRow(rows[0], wantedHash);
}

export type EnsureTemplateOptions = {
  readonly prefix: TestDatabasePrefix;
  readonly user?: string;
  readonly adminUrl?: string | undefined;
  readonly hash?: string;
  readonly migrationsDir?: string;
  readonly globPattern?: string;
  readonly extraHashInputs?: readonly string[];
  readonly hashLength?: number;
  readonly populate: (
    templateUrl: string,
    templateName: string,
  ) => Promise<void>;
};

export function resolveMaintenanceAndUserUrl(options: {
  readonly user?: string;
  readonly adminUrl?: string | undefined;
}): { readonly maintenanceUrl: string; readonly clientAdminUrl: string } {
  if (options.adminUrl !== undefined) {
    return {
      maintenanceUrl: options.adminUrl,
      clientAdminUrl: options.adminUrl,
    };
  }
  const { port, superUrl } = ensureSharedPostgres();
  const user = options.user ?? "scout";
  return {
    maintenanceUrl: superUrl,
    clientAdminUrl: sharedDatabaseUrl("postgres", { user, port }),
  };
}

function resolveTemplateHash(options: {
  readonly hash?: string;
  readonly migrationsDir?: string;
  readonly globPattern?: string;
  readonly extraHashInputs?: readonly string[];
}): string {
  if (options.hash !== undefined) return options.hash;
  if (options.migrationsDir === undefined) {
    throw new Error(
      "Either hash or migrationsDir must be provided to ensureTemplateDatabase",
    );
  }
  return computeMigrationHash({
    migrationsDir: options.migrationsDir,
    globPattern: options.globPattern,
    extraInputs: options.extraHashInputs,
  });
}

async function buildTemplateUnderLock(input: {
  readonly templateName: string;
  readonly wantedHash: string;
  readonly maintenanceUrl: string;
  readonly templateUrl: string;
  readonly populate: (
    templateUrl: string,
    templateName: string,
  ) => Promise<void>;
}): Promise<void> {
  const { templateName, wantedHash, maintenanceUrl, templateUrl, populate } =
    input;
  const escaped = templateName.replaceAll("'", "''");
  const rows = await listManagedDatabasesAsync(`d.datname = '${escaped}'`, {
    adminUrl: maintenanceUrl,
  });
  const existing = rows[0];

  if (isCompletedTemplateRow(existing, wantedHash)) {
    return;
  }

  const decision = decideTemplateRebuild({
    exists: existing !== undefined,
    isTemplate: existing?.isTemplate,
    record: existing?.record ?? { kind: "none" },
    wantedHash,
    activeConnections: existing?.connections ?? 0,
    probe: hostProcessProbe,
  });
  if (decision.action === "refuse") {
    throw new Error(
      `Refusing to rebuild ${templateName}: ${decision.reason}. Drop it by hand only after confirming no run uses it.`,
    );
  }
  if (decision.action === "drop-partial") {
    const dropCommands =
      existing?.isTemplate === true
        ? [
            LOCK_TIMEOUT_SQL,
            `ALTER DATABASE "${templateName}" WITH IS_TEMPLATE FALSE ALLOW_CONNECTIONS TRUE`,
            `DROP DATABASE "${templateName}"`,
          ]
        : [LOCK_TIMEOUT_SQL, `DROP DATABASE "${templateName}"`];
    await psqlMaintenanceCommandsAsync(dropCommands, {
      adminUrl: maintenanceUrl,
    });
  }

  await psqlMaintenanceCommandsAsync(
    [
      `CREATE DATABASE "${templateName}"`,
      ownerCommentSql(templateName, currentDatabaseOwner()),
    ],
    { adminUrl: maintenanceUrl },
  );

  try {
    await populate(templateUrl, templateName);
  } catch (error) {
    try {
      await psqlMaintenanceCommandsAsync(
        [`DROP DATABASE IF EXISTS "${templateName}" WITH (FORCE)`],
        { adminUrl: maintenanceUrl },
      );
    } catch {
      // Leave partial DB with builder owner comment if cleanup also fails.
    }
    throw error;
  }

  const completedOwner = {
    ...currentDatabaseOwner(),
    templateHash: wantedHash,
  };
  await psqlMaintenanceCommandsAsync(
    [
      `ALTER DATABASE "${templateName}" WITH IS_TEMPLATE TRUE ALLOW_CONNECTIONS FALSE`,
      ownerCommentSql(templateName, completedOwner),
    ],
    { adminUrl: maintenanceUrl },
  );
}

export async function ensureTemplateDatabase(
  options: EnsureTemplateOptions,
): Promise<{
  readonly templateName: string;
  readonly templateHash: string;
  readonly adminUrl: string;
  readonly templateUrl: string;
}> {
  const { maintenanceUrl, clientAdminUrl } =
    resolveMaintenanceAndUserUrl(options);
  sweepStaleTestDatabasesOnce({ adminUrl: maintenanceUrl });

  const wantedHash = resolveTemplateHash(options);
  const templateName = formatTemplateDatabaseName(
    options.prefix,
    wantedHash,
    options.hashLength ?? 16,
  );
  const templateUrl = databaseUrlFromAdmin(clientAdminUrl, templateName);

  const ready = await isTemplateDatabaseReadyAsync(templateName, wantedHash, {
    adminUrl: maintenanceUrl,
  });
  if (!ready) {
    await withPostgresAdvisoryLock(
      templateName,
      async () => {
        await buildTemplateUnderLock({
          templateName,
          wantedHash,
          maintenanceUrl,
          templateUrl,
          populate: options.populate,
        });
        await pruneStaleTemplateDatabases({
          prefix: options.prefix,
          currentTemplateName: templateName,
          adminUrl: maintenanceUrl,
        });
      },
      { adminUrl: maintenanceUrl },
    );
  }

  return {
    templateName,
    templateHash: wantedHash,
    adminUrl: clientAdminUrl,
    templateUrl,
  };
}
