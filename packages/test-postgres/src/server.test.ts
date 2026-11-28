import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertDisposableTestPgDataDir,
  hasStartupWalPanic,
  isDisposableTestPgDataDir,
  managedPostgresDataRoots,
  parsePostmasterPid,
  pgCtlOptionsForDurability,
  readPostmasterPid,
  sharedPostgresDataRoot,
} from "./index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const created = await mkdtemp(
    path.join(tmpdir(), "test-postgres-server-unit-"),
  );
  tempDirs.push(created);
  return created;
}

describe("managedPostgresDataRoots & sharedPostgresDataRoot isolation", () => {
  test("honors TEST_POSTGRES_DATA_ROOT ahead of XDG_CACHE_HOME, HOME, and root mode", () => {
    const explicit = "/tmp/custom-test-pg-root";
    expect(
      managedPostgresDataRoots(
        {
          TEST_POSTGRES_DATA_ROOT: explicit,
          XDG_CACHE_HOME: "/tmp/ignored-cache",
          HOME: "/Users/example",
        },
        { isRoot: false },
      ),
    ).toEqual([path.resolve(explicit)]);
    expect(
      managedPostgresDataRoots(
        { TEST_POSTGRES_DATA_ROOT: explicit },
        { isRoot: true },
      ),
    ).toEqual([path.resolve(explicit)]);
  });

  test("uses $TMPDIR/monorepo-test-pg/18 when running as root without Scout paths", () => {
    const roots = managedPostgresDataRoots(
      { HOME: "/root", XDG_CACHE_HOME: "/root/.cache" },
      { isRoot: true },
    );
    expect(roots).toEqual([path.join(tmpdir(), "monorepo-test-pg", "18")]);
  });

  test("returns ONLY XDG_CACHE_HOME/monorepo-test-pg/18 when XDG_CACHE_HOME is set without falling back to HOME/.cache", async () => {
    const fakeHome = await makeTempDir();
    const scratchCache = await makeTempDir();
    await Bun.write(
      path.join(
        fakeHome,
        ".cache",
        "monorepo-test-pg",
        "18",
        "pgdata",
        "PG_VERSION",
      ),
      "18\n",
      { createPath: true },
    );

    const env = {
      HOME: fakeHome,
      XDG_CACHE_HOME: scratchCache,
      XDG_DATA_HOME: path.join(fakeHome, ".local", "share"),
    };
    const roots = managedPostgresDataRoots(env, { isRoot: false });
    expect(roots).toEqual([path.join(scratchCache, "monorepo-test-pg", "18")]);
    expect(sharedPostgresDataRoot(env, { isRoot: false })).toBe(
      path.join(scratchCache, "monorepo-test-pg", "18"),
    );
  });

  test("uses HOME/.cache/monorepo-test-pg/18 by default and omits scout-for-lol/postgres and scout-dev-pg", () => {
    const roots = managedPostgresDataRoots(
      {
        HOME: "/Users/example",
        XDG_DATA_HOME: "/Users/example/.local/share",
      },
      { isRoot: false, platform: "darwin" },
    );
    expect(roots).toEqual(["/Users/example/.cache/monorepo-test-pg/18"]);
  });

  test("throws when neither TEST_POSTGRES_DATA_ROOT, XDG_CACHE_HOME, nor HOME is set", () => {
    expect(() =>
      managedPostgresDataRoots({}, { isRoot: false, platform: "darwin" }),
    ).toThrow("Neither TEST_POSTGRES_DATA_ROOT, XDG_CACHE_HOME, nor HOME");
  });
});

describe("postmaster.pid parsing", () => {
  test("parses PID (line 1) and port (line 4) from Unix and CRLF postmaster.pid files", async () => {
    const unixSample = [
      "43084",
      "/Users/example/.cache/monorepo-test-pg/18/pgdata",
      "1763990000",
      "5483",
      "/tmp",
      "127.0.0.1",
      "  5483001    65536",
      "ready   ",
    ].join("\n");
    expect(parsePostmasterPid(unixSample)).toEqual({ pid: 43_084, port: 5483 });

    const crlfSample = unixSample.replaceAll("\n", "\r\n");
    expect(parsePostmasterPid(crlfSample)).toEqual({ pid: 43_084, port: 5483 });

    const dir = await makeTempDir();
    await Bun.write(path.join(dir, "postmaster.pid"), `${unixSample}\n`);
    expect(readPostmasterPid(dir)).toEqual({ pid: 43_084, port: 5483 });
  });

  test("returns undefined for missing, truncated, or invalid postmaster.pid content", async () => {
    const dir = await makeTempDir();
    expect(readPostmasterPid(dir)).toBeUndefined();
    expect(parsePostmasterPid("")).toBeUndefined();
    expect(parsePostmasterPid("43084\n/pgdata\n123")).toBeUndefined();
    expect(parsePostmasterPid("0\n/pgdata\n123\n5471")).toBeUndefined();
    expect(parsePostmasterPid("43084\n/pgdata\n123\n70000")).toBeUndefined();
    expect(parsePostmasterPid("abc\n/pgdata\n123\n5471")).toBeUndefined();
  });
});

describe("disposable data directory guard & WAL panic detection", () => {
  test("accepts only canonical monorepo-test-pg/<major>/pgdata directories", () => {
    const valid = "/tmp/isolated/monorepo-test-pg/18/pgdata";
    expect(
      isDisposableTestPgDataDir(valid, {
        resolveCanonical: (target) => target,
      }),
    ).toBe(true);
    expect(() =>
      assertDisposableTestPgDataDir(valid, {
        resolveCanonical: (target) => target,
      }),
    ).not.toThrow();

    const unsafePaths = [
      "",
      "/",
      "/Users/example/.local/share/scout-for-lol/postgres/18/pgdata",
      "/Users/example/.cache/monorepo-dev-pg/18/pgdata",
      "/Users/example/.cache/monorepo-test-pg/17/pgdata",
      "/Users/example/.cache/monorepo-test-pg/18",
    ];
    for (const candidate of unsafePaths) {
      expect(
        isDisposableTestPgDataDir(candidate, {
          resolveCanonical: (target) => target,
        }),
      ).toBe(false);
      expect(() =>
        assertDisposableTestPgDataDir(candidate, {
          resolveCanonical: (target) => target,
        }),
      ).toThrow("Refusing to wipe non-disposable");
    }

    // Rejects symlink redirecting monorepo-test-pg/18/pgdata to durable Scout data
    expect(
      isDisposableTestPgDataDir(valid, {
        resolveCanonical: () =>
          "/Users/example/.local/share/scout-for-lol/postgres/18/pgdata",
      }),
    ).toBe(false);
  });

  test("detects PostgreSQL startup and WAL checkpoint panics without matching routine errors", () => {
    expect(
      hasStartupWalPanic(
        "2026-11-21 03:34:12.001 UTC [41012] PANIC:  could not locate a valid checkpoint record",
      ),
    ).toBe(true);
    expect(
      hasStartupWalPanic("LOG: invalid checkpoint record at 0/1500028"),
    ).toBe(true);
    expect(
      hasStartupWalPanic("PANIC: unexpected pageaddr 0/0 in WAL segment"),
    ).toBe(true);
    expect(
      hasStartupWalPanic('FATAL:  lock file "postmaster.pid" already exists'),
    ).toBe(false);
    expect(hasStartupWalPanic("database system is ready to accept")).toBe(
      false,
    );
  });

  test("configures fsync, full_page_writes, and UTC timezone according to cluster durability", () => {
    const disposable = pgCtlOptionsForDurability(55_606, "disposable");
    expect(disposable).toContain("fsync=off");
    expect(disposable).toContain("full_page_writes=off");
    expect(disposable).toContain("-c timezone=UTC");

    const durable = pgCtlOptionsForDurability(5471, "durable");
    expect(durable).toContain("fsync=on");
    expect(durable).toContain("full_page_writes=on");
    expect(durable).toContain("synchronous_commit=on");
    expect(durable).toContain("-c timezone=UTC");
  });
});
