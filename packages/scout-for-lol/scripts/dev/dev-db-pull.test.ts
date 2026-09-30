import { describe, expect, test } from "vitest";

import {
  assertRedacted,
  assertRestorableVersions,
  assertRestoredTables,
  copyInStatement,
  EXCLUDED_TABLE_DATA,
  redactedCopyOutStatement,
  redactionCheckStatement,
  REDACTED_COLUMNS,
  tablesWithoutDumpedData,
  defaultDumpPath,
  dumpArgv,
  handoffMessage,
  localDatabaseUrl,
  parseClientMajorVersion,
  parseDevDbPullArgs,
  parseRowList,
  restoreArgv,
  RESTORE_SECTIONS,
  selectDumpableExtensions,
  STAGES,
} from "./dev-db-pull-plan.ts";

const environment = { HOME: "/home/dev" } as const;

function options(args: readonly string[] = []) {
  const parsed = parseDevDbPullArgs(args, environment);
  if (parsed.kind !== "options") {
    throw new Error("expected options");
  }
  return parsed.options;
}

describe("parseDevDbPullArgs", () => {
  test("defaults to beta with a stage-named local database", () => {
    expect(options()).toEqual({
      stage: "beta",
      target: STAGES.beta,
      localDatabase: "scout_beta_snapshot",
      databaseUrl: "postgres://scout@127.0.0.1:5471/scout_beta_snapshot",
      dumpPath: "/home/dev/.local/share/scout-for-lol/db-pull/beta.dump",
    });
  });

  test("switches every derived value when the stage changes", () => {
    const parsed = options(["--stage", "prod"]);
    expect(parsed.target).toEqual(STAGES.prod);
    expect(parsed.target.namespace).toBe("scout-prod");
    expect(parsed.localDatabase).toBe("scout_prod_snapshot");
    expect(parsed.dumpPath).toBe(
      "/home/dev/.local/share/scout-for-lol/db-pull/prod.dump",
    );
  });

  test("honours explicit overrides", () => {
    const parsed = options([
      "--database",
      "scout_scratch",
      "--dump-path",
      "/tmp/one.dump",
    ]);
    expect(parsed.localDatabase).toBe("scout_scratch");
    expect(parsed.databaseUrl).toBe(
      "postgres://scout@127.0.0.1:5471/scout_scratch",
    );
    expect(parsed.dumpPath).toBe("/tmp/one.dump");
  });

  test("reports help rather than acting", () => {
    expect(parseDevDbPullArgs(["--help"], environment)).toEqual({
      kind: "help",
    });
    expect(parseDevDbPullArgs(["-h"], environment)).toEqual({ kind: "help" });
  });

  test("rejects an unknown stage", () => {
    expect(() =>
      parseDevDbPullArgs(["--stage", "staging"], environment),
    ).toThrow("--stage must be beta or prod");
  });

  test("rejects a database name dev:web would treat as external", () => {
    // dev:web only ensures and migrates a loopback URL whose database name
    // matches its own pattern; a rejected name here would silently skip that.
    expect(() =>
      parseDevDbPullArgs(["--database", "Scout-Snapshot"], environment),
    ).toThrow("--database must match");
  });

  test("rejects a flag with no value", () => {
    expect(() => parseDevDbPullArgs(["--stage"], environment)).toThrow(
      "--stage requires a value",
    );
  });

  test("rejects an unknown argument", () => {
    expect(() => parseDevDbPullArgs(["--wat"], environment)).toThrow(
      "Unknown argument: --wat",
    );
  });

  test("honours SCOUT_PG_PORT", () => {
    const parsed = parseDevDbPullArgs([], {
      ...environment,
      SCOUT_PG_PORT: "5999",
    });
    if (parsed.kind !== "options") {
      throw new Error("expected options");
    }
    expect(parsed.options.databaseUrl).toBe(
      "postgres://scout@127.0.0.1:5999/scout_beta_snapshot",
    );
  });
});

describe("localDatabaseUrl and defaultDumpPath", () => {
  test("prefer XDG_DATA_HOME when set", () => {
    expect(defaultDumpPath("beta", { XDG_DATA_HOME: "/xdg" })).toBe(
      "/xdg/scout-for-lol/db-pull/beta.dump",
    );
  });

  test("build a loopback URL for the shared dev server", () => {
    expect(localDatabaseUrl("scout_dev_3000", {})).toBe(
      "postgres://scout@127.0.0.1:5471/scout_dev_3000",
    );
  });
});

describe("assertRestorableVersions", () => {
  test("accepts a client at or ahead of the server", () => {
    expect(() => assertRestorableVersions(16, 16)).not.toThrow();
    expect(() => assertRestorableVersions(16, 18)).not.toThrow();
  });

  test("refuses a client behind the server", () => {
    expect(() => assertRestorableVersions(18, 16)).toThrow(
      "Local pg_restore is PostgreSQL 16 but the source server is 18",
    );
  });
});

describe("parseClientMajorVersion", () => {
  test("reads the major from a client banner", () => {
    expect(parseClientMajorVersion("pg_restore (PostgreSQL) 16.15")).toBe(16);
    expect(parseClientMajorVersion("pg_dump (PostgreSQL) 18.3\n")).toBe(18);
  });

  test("throws when there is no version to read", () => {
    expect(() => parseClientMajorVersion("pg_restore")).toThrow(
      "Could not read a PostgreSQL client version",
    );
  });
});

describe("selectDumpableExtensions", () => {
  test("keeps locally available extensions and skips the rest", () => {
    const selection = selectDumpableExtensions(
      [
        "plpgsql",
        "pg_stat_statements",
        "pg_stat_kcache",
        "set_user",
        "pg_trgm",
      ],
      ["plpgsql", "pg_stat_statements", "pg_trgm"],
    );
    expect(selection.include).toEqual([
      "pg_stat_statements",
      "pg_trgm",
      "plpgsql",
    ]);
    expect(selection.skipped).toEqual(["pg_stat_kcache", "set_user"]);
  });

  test("always anchors on plpgsql so the pattern list is never empty", () => {
    // pg_dump treats an --extension pattern matching nothing as a fatal error.
    const selection = selectDumpableExtensions(["set_user"], []);
    expect(selection.include).toEqual(["plpgsql"]);
    expect(selection.skipped).toEqual(["set_user"]);
  });

  test("does not duplicate the anchor when the source lists it", () => {
    expect(selectDumpableExtensions(["plpgsql"], ["plpgsql"]).include).toEqual([
      "plpgsql",
    ]);
  });
});

describe("argv builders", () => {
  test("dump restricts to the public schema and the chosen extensions", () => {
    expect(
      dumpArgv({
        binaryPath: "/usr/lib/postgresql/16/bin/pg_dump",
        database: "scout",
        extensions: ["plpgsql", "pg_trgm"],
      }),
    ).toEqual([
      "/usr/lib/postgresql/16/bin/pg_dump",
      "--username",
      "postgres",
      "--dbname",
      "scout",
      "--format",
      "custom",
      "--no-owner",
      "--no-privileges",
      "--schema",
      "public",
      "--extension=plpgsql",
      "--extension=pg_trgm",
      '--exclude-table-data=public."ApiToken"',
      '--exclude-table-data=public."ExploreConversation"',
      '--exclude-table-data=public."InstallAttributionToken"',
      '--exclude-table-data=public."TournamentLobby"',
      '--exclude-table-data=public."User"',
    ]);
  });

  test("restore runs in a single transaction", () => {
    expect(
      restoreArgv({
        databaseUrl: "postgres://scout@127.0.0.1:5471/scout_beta_snapshot",
        dumpPath: "/tmp/beta.dump",
        section: "post-data",
      }),
    ).toEqual([
      "pg_restore",
      "--dbname",
      "postgres://scout@127.0.0.1:5471/scout_beta_snapshot",
      "--no-owner",
      "--no-privileges",
      "--single-transaction",
      "--section",
      "post-data",
      "/tmp/beta.dump",
    ]);
  });
});

describe("parseRowList", () => {
  test("drops blank lines and trims", () => {
    expect(parseRowList("Player\n Account \n\n")).toEqual([
      "Player",
      "Account",
    ]);
    expect(parseRowList("\n")).toEqual([]);
  });
});

describe("assertRestoredTables", () => {
  test("passes when every source table arrived", () => {
    expect(() =>
      assertRestoredTables(["Account", "Player"], ["Player", "Account"]),
    ).not.toThrow();
  });

  test("ignores extra local tables", () => {
    expect(() =>
      assertRestoredTables(["Player"], ["Player", "_prisma_migrations"]),
    ).not.toThrow();
  });

  test("names what went missing", () => {
    expect(() =>
      assertRestoredTables(["Account", "Player", "Report"], ["Player"]),
    ).toThrow("missing 2 table(s) present in the source: Account, Report");
  });
});

describe("handoffMessage", () => {
  test("prints the dev:web command for the restored database", () => {
    expect(handoffMessage(options())).toContain(
      "bun run dev:web -- --database-url postgres://scout@127.0.0.1:5471/scout_beta_snapshot",
    );
  });
});

describe("credential handling", () => {
  test("leaves no data for the credential-only tables", () => {
    expect(EXCLUDED_TABLE_DATA).toEqual([
      "ApiToken",
      "InstallAttributionToken",
    ]);
  });

  test("redacts the live OAuth tokens and the share/lobby credentials", () => {
    expect(
      Object.fromEntries(
        Object.entries(REDACTED_COLUMNS).map(([table, redactions]) => [
          table,
          redactions.map((redaction) => redaction.column),
        ]),
      ),
    ).toEqual({
      ExploreConversation: ["shareToken"],
      TournamentLobby: ["code", "password"],
      User: ["discordAccessToken", "discordRefreshToken", "tokenExpiresAt"],
    });
  });

  test("blanks nullable credentials but keeps the unique join code non-null", () => {
    // TournamentLobby.code is `String @unique`, so NULL would break the
    // NOT NULL and uniqueness guarantees the restore has to satisfy.
    const lobby = REDACTED_COLUMNS["TournamentLobby"] ?? [];
    const code = lobby.find((redaction) => redaction.column === "code");
    expect(code?.replacement).toBe(`'redacted-' || "id"`);
    expect(code?.verify).toBe(`"code" LIKE 'redacted-%'`);
    const password = lobby.find((redaction) => redaction.column === "password");
    expect(password?.replacement).toBe("NULL");
  });

  test("the dump carries no data for any of those tables", () => {
    const argv = dumpArgv({
      binaryPath: "/usr/lib/postgresql/16/bin/pg_dump",
      database: "scout",
      extensions: ["plpgsql"],
    });
    for (const table of tablesWithoutDumpedData()) {
      expect(argv).toContain(`--exclude-table-data=public."${table}"`);
    }
    // The tokens must never be written locally, so this list and the dump
    // must not drift apart.
    expect(tablesWithoutDumpedData()).toEqual([
      "ApiToken",
      "ExploreConversation",
      "InstallAttributionToken",
      "TournamentLobby",
      "User",
    ]);
  });

  test("blanks exactly the credential columns in the source projection", () => {
    expect(
      redactedCopyOutStatement(
        "User",
        ["id", "discordId", "discordAccessToken", "tokenExpiresAt"],
        [
          { column: "discordAccessToken", replacement: "NULL", verify: "" },
          { column: "tokenExpiresAt", replacement: "NULL", verify: "" },
        ],
      ),
    ).toBe(
      'COPY (SELECT "id", "discordId", NULL AS "discordAccessToken", NULL AS "tokenExpiresAt" FROM "User") TO STDOUT',
    );
  });

  test("loads every column back in ordinal order", () => {
    expect(copyInStatement("User", ["id", "discordId"])).toBe(
      'COPY "User" ("id", "discordId") FROM STDIN',
    );
  });

  test("refuses an identifier it did not expect", () => {
    expect(() => redactedCopyOutStatement('User" --', ["id"], [])).toThrow(
      "Refusing to interpolate unexpected identifier",
    );
    expect(() => copyInStatement("User", ["id; DROP TABLE"])).toThrow(
      "Refusing to interpolate unexpected identifier",
    );
  });

  test("throws when a table has no known columns", () => {
    expect(() => redactedCopyOutStatement("User", [], [])).toThrow(
      "No columns known for User",
    );
    expect(() => copyInStatement("User", [])).toThrow("No columns known");
  });

  test("counts rows that failed each column's own redaction predicate", () => {
    expect(
      redactionCheckStatement("TournamentLobby", [
        {
          column: "code",
          replacement: `'redacted-' || "id"`,
          verify: `"code" LIKE 'redacted-%'`,
        },
      ]),
    ).toBe(
      'SELECT count(*) FILTER (WHERE NOT coalesce("code" LIKE \'redacted-%\', false)) AS "code" FROM "TournamentLobby"',
    );
  });

  test("substitutes the per-row stand-in for a non-nullable credential", () => {
    expect(
      redactedCopyOutStatement(
        "TournamentLobby",
        ["id", "code"],
        [
          {
            column: "code",
            replacement: `'redacted-' || "id"`,
            verify: `"code" LIKE 'redacted-%'`,
          },
        ],
      ),
    ).toBe(
      'COPY (SELECT "id", \'redacted-\' || "id" AS "code" FROM "TournamentLobby") TO STDOUT',
    );
  });

  test("assertRedacted passes only when every column is empty", () => {
    expect(() =>
      assertRedacted("User", { discordAccessToken: 0, tokenExpiresAt: 0 }),
    ).not.toThrow();
  });

  test("assertRedacted names the columns that still hold values", () => {
    expect(() =>
      assertRedacted("User", { discordAccessToken: 3, tokenExpiresAt: 0 }),
    ).toThrow(
      "User still holds unredacted values in discordAccessToken (3 rows)",
    );
  });
});

describe("RESTORE_SECTIONS", () => {
  test("loads data before the constraints that reference it", () => {
    expect(RESTORE_SECTIONS).toEqual(["pre-data", "data", "post-data"]);
  });
});
