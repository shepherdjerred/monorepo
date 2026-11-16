import { describe, expect, test } from "vitest";
import {
  assertDevPostgresIdentity,
  candidatePostgresBinDirs,
  discoverPostgresBinDir,
  parsePostgresMajor,
  processStartForPid,
  sharedPostgresPort,
} from "./index.ts";

describe("binary discovery", () => {
  test("parses major version from postgres and psql --version output", () => {
    expect(parsePostgresMajor("postgres (PostgreSQL) 18.6")).toBe(18);
    expect(
      parsePostgresMajor("psql (PostgreSQL) 17.2 (Ubuntu 17.2-1.pgdg24.04+1)"),
    ).toBe(17);
    expect(parsePostgresMajor("unknown output")).toBeUndefined();
  });

  test("honors explicit POSTGRES_BIN_DIR when major matches", () => {
    const found = discoverPostgresBinDir({
      env: { POSTGRES_BIN_DIR: "/custom/pg18/bin" },
      platform: "darwin",
      isRoot: false,
      fileExists: (filePath) => filePath === "/custom/pg18/bin/postgres",
      run: () => ({
        exitCode: 0,
        stdout: "postgres (PostgreSQL) 18.6\n",
        stderr: "",
      }),
    });
    expect(found.binDir).toBe("/custom/pg18/bin");
    expect(found.major).toBe(18);
  });

  test("falls back past older PATH binaries to Homebrew or /usr/lib/postgresql/18/bin", () => {
    const candidates = candidatePostgresBinDirs({
      env: {},
      platform: "linux",
      isRoot: false,
      which: () => "/usr/bin/postgres",
      readSubdirs: (dir) =>
        dir === "/usr/lib/postgresql" ? ["16", "18", "17"] : [],
    });
    expect(candidates).toContain("/usr/bin");
    expect(candidates.indexOf("/usr/lib/postgresql/18/bin")).toBeLessThan(
      candidates.indexOf("/usr/lib/postgresql/17/bin"),
    );

    const found = discoverPostgresBinDir({
      env: {},
      platform: "linux",
      isRoot: false,
      which: () => "/usr/bin/postgres",
      readSubdirs: (dir) => (dir === "/usr/lib/postgresql" ? ["16", "18"] : []),
      fileExists: (filePath) =>
        filePath === "/usr/bin/postgres" ||
        filePath === "/usr/lib/postgresql/18/bin/postgres",
      run: (argv) => ({
        exitCode: 0,
        stdout:
          argv[0] === "/usr/bin/postgres"
            ? "postgres (PostgreSQL) 16.4\n"
            : "postgres (PostgreSQL) 18.6\n",
        stderr: "",
      }),
    });
    expect(found.binDir).toBe("/usr/lib/postgresql/18/bin");
    expect(found.major).toBe(18);
  });

  test("discovers Windows Program Files PostgreSQL binaries sorted newest first", () => {
    const winRoot = String.raw`C:\Program Files\PostgreSQL`;
    const candidates = candidatePostgresBinDirs({
      env: { ProgramFiles: String.raw`C:\Program Files` },
      platform: "win32",
      isRoot: false,
      which: () => null,
      readSubdirs: (dir) => (dir === winRoot ? ["17", "18"] : []),
    });
    expect(candidates[0]).toBe(String.raw`C:\Program Files\PostgreSQL\18\bin`);
    expect(candidates[1]).toBe(String.raw`C:\Program Files\PostgreSQL\17\bin`);

    const found = discoverPostgresBinDir({
      env: { ProgramFiles: String.raw`C:\Program Files` },
      platform: "win32",
      isRoot: false,
      which: () => null,
      readSubdirs: (dir) => (dir === winRoot ? ["17", "18"] : []),
      fileExists: (filePath) =>
        filePath ===
        String.raw`C:\Program Files\PostgreSQL\18\bin\postgres.exe`,
      run: () => ({
        exitCode: 0,
        stdout: "postgres (PostgreSQL) 18.6\r\n",
        stderr: "",
      }),
    });
    expect(found.binDir).toBe(String.raw`C:\Program Files\PostgreSQL\18\bin`);
  });
});

describe("cross-platform process start detection", () => {
  test("reads current Unix process start timestamp", () => {
    const real = processStartForPid(process.pid);
    expect(real).toBeDefined();
    expect(real?.length).toBeGreaterThan(0);
  });

  test("uses PowerShell CIM CreationDate on win32 with Get-Process fallback", () => {
    const fromCim = processStartForPid(4242, {
      platform: "win32",
      run: (argv) => ({
        exitCode: argv[0] === "powershell.exe" ? 0 : 1,
        stdout: "2026-11-15T22:18:08.0000000Z\r\n",
        stderr: "",
      }),
    });
    expect(fromCim).toBe("2026-11-15T22:18:08.0000000Z");

    const fromFallback = processStartForPid(4242, {
      platform: "win32",
      run: (argv) => {
        const script = argv[4] ?? "";
        if (script.includes("Get-CimInstance")) {
          return { exitCode: 1, stdout: "", stderr: "WMI unavailable" };
        }
        return {
          exitCode: 0,
          stdout: "2026-11-15T22:19:00.0000000Z\r\n",
          stderr: "",
        };
      },
    });
    expect(fromFallback).toBe("2026-11-15T22:19:00.0000000Z");
  });
});

describe("port and server identity", () => {
  test("prefers LOCAL_TEST_PG_PORT over SCOUT_PG_PORT and defaults to 5471", () => {
    expect(sharedPostgresPort({})).toBe(5471);
    expect(sharedPostgresPort({ SCOUT_PG_PORT: "5480" })).toBe(5480);
    expect(
      sharedPostgresPort({
        LOCAL_TEST_PG_PORT: "5490",
        SCOUT_PG_PORT: "5480",
      }),
    ).toBe(5490);
    expect(() =>
      sharedPostgresPort({ LOCAL_TEST_PG_PORT: "not-a-port" }),
    ).toThrow("LOCAL_TEST_PG_PORT must be a port number");
  });

  test("validates PostgreSQL 18 server identity and allowed directories", () => {
    const primary = "/cache/monorepo-dev-pg/18/pgdata";
    const legacy = "/local/scout-for-lol/postgres/18/pgdata";
    expect(() =>
      assertDevPostgresIdentity(180_006, legacy, primary, [legacy]),
    ).not.toThrow();
    expect(() => assertDevPostgresIdentity(170_002, primary, primary)).toThrow(
      "requires major 18",
    );
    expect(() =>
      assertDevPostgresIdentity(180_006, "/other/pgdata", primary, [legacy]),
    ).toThrow("port belongs to");
  });
});
