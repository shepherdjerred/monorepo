import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLease,
  listLeases,
  releaseLease,
  sweepLeases,
  wrapWithLease,
} from "#lib/tend/leases.ts";
import {
  DEFAULT_WORKTREE_MIN_AGE_MS,
  extractAbsolutePathsFromText,
  formatDurationCompact,
  isPathInside,
  isPathProtected,
  normalizeHostPath,
  parseDurationMs,
  resolveTendPaths,
} from "#lib/tend/paths.ts";
import {
  collectDescendantPids,
  parseEtimeSeconds,
  parseLsofCwdOutput,
  parsePosixPsOutput,
  parseWindowsCimOutput,
} from "#lib/tend/process-probe.ts";
import type { OsProcessEntry } from "#lib/tend/types.ts";

const tempDirs: string[] = [];

async function makeTempTendDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tend-leases-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("paths and duration utilities", () => {
  it("parses compact durations and enforces the 7-day default floor", () => {
    expect(DEFAULT_WORKTREE_MIN_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDurationMs("7d")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDurationMs("168h")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDurationMs("30m")).toBe(30 * 60 * 1000);
    expect(parseDurationMs("900s")).toBe(900_000);
    expect(parseDurationMs("250ms")).toBe(250);
    expect(parseDurationMs("0s")).toBe(0);
    expect(() => parseDurationMs("abc")).toThrow("Invalid duration");
    expect(formatDurationCompact(7 * 86_400_000)).toBe("7d");
    expect(formatDurationCompact(3_900_000)).toBe("1h5m");
  });

  it("resolves TOOLKIT_TEND_DIR override before ~/.toolkit/tend", () => {
    const overridden = resolveTendPaths({
      env: { TOOLKIT_TEND_DIR: "/custom/tend-state", HOME: "/Users/alice" },
    });
    expect(overridden.rootDir).toBe("/custom/tend-state");
    expect(overridden.leasesDir).toBe("/custom/tend-state/leases");

    const fallback = resolveTendPaths({
      env: { HOME: "/Users/alice" },
    });
    expect(fallback.rootDir).toBe("/Users/alice/.toolkit/tend");
  });

  it("normalizes macOS /tmp symlinks and Windows drive paths", () => {
    expect(normalizeHostPath("/tmp/foo/bar/", "darwin")).toBe(
      "/private/tmp/foo/bar",
    );
    expect(normalizeHostPath("/var/folders/x/", "darwin")).toBe(
      "/private/var/folders/x",
    );
    expect(
      normalizeHostPath(String.raw`C:\Users\Jerred\Git\repo\\`, "win32"),
    ).toBe("c:/Users/Jerred/Git/repo");
  });

  it("evaluates path containment and bidirectional protection", () => {
    expect(
      isPathInside(
        "/Users/jerred/.herdr/worktrees/monorepo/wt-1/packages/toolkit",
        "/Users/jerred/.herdr/worktrees/monorepo/wt-1",
        "darwin",
      ),
    ).toBe(true);
    expect(
      isPathInside(
        "/Users/jerred/.herdr/worktrees/monorepo/wt-10",
        "/Users/jerred/.herdr/worktrees/monorepo/wt-1",
        "darwin",
      ),
    ).toBe(false);

    const protectedSet = new Set(["/private/tmp/media-pg-live"]);
    expect(isPathProtected("/tmp/media-pg-live", protectedSet, "darwin")).toBe(
      true,
    );
    expect(isPathProtected("/tmp/media-pg-other", protectedSet, "darwin")).toBe(
      false,
    );
  });

  it("extracts POSIX and Windows paths from Forum notice prose", () => {
    const body =
      "Running Media qualification in `/Users/jerred/git/monorepo/.worktrees/media-qual` and `/tmp/media-pg-123`. Windows peer at C:\\Users\\jerred\\Git\\monorepo.";
    const darwinPaths = extractAbsolutePathsFromText(body, "darwin");
    expect(darwinPaths).toContain(
      "/Users/jerred/git/monorepo/.worktrees/media-qual",
    );
    expect(darwinPaths).toContain("/private/tmp/media-pg-123");

    const winPaths = extractAbsolutePathsFromText(body, "win32");
    expect(winPaths).toContain("c:/Users/jerred/Git/monorepo");
  });
});

describe("process snapshot parsers", () => {
  it("parses POSIX ps + lsof output and Windows CIM JSON", () => {
    expect(parseEtimeSeconds("02-03:04:05")).toBe(
      2 * 86_400 + 3 * 3600 + 4 * 60 + 5,
    );
    const lsofOut = "p4200\nn/tmp/wt-alpha\n";
    const cwds = parseLsofCwdOutput(lsofOut, "darwin");
    expect(cwds.get(4200)).toBe("/private/tmp/wt-alpha");

    const psOut =
      "  4200     1 Mon Nov 15 10:00:00 2026    01:15:00 temporal-test-server temporal-test-server --port 7233\n" +
      "  4201  4200 Mon Nov 15 10:01:00 2026       10:00 node worker.js\n";
    const procs = parsePosixPsOutput(psOut, cwds);
    expect(procs.get(4200)?.cwd).toBe("/private/tmp/wt-alpha");
    expect(procs.get(4200)?.elapsedSeconds).toBe(4500);
    expect(collectDescendantPids([4200], procs)).toEqual(new Set([4200, 4201]));

    const winProcs = parseWindowsCimOutput(
      JSON.stringify([
        {
          ProcessId: 900,
          ParentProcessId: 4,
          CreationDate: "/Date(1700000000000)/",
          Name: "bun.exe",
          CommandLine: "bun.exe run dev",
        },
      ]),
      1_700_000_600_000,
    );
    expect(winProcs.get(900)?.elapsedSeconds).toBe(600);
  });
});

describe("lease lifecycle and classification", () => {
  it("acquires, classifies active vs expired vs dead-owner (including PID reuse), and sweeps", async () => {
    const rootDir = await makeTempTendDir();
    const paths = resolveTendPaths({ tendDir: rootDir });
    const nowMs = 1_760_000_000_000;

    const activeLease = await acquireLease({
      id: "active-1",
      kind: "tailscale-serve",
      target: "https:8443",
      ownerPid: 1001,
      processStart: "Mon Nov 15 10:00:00 2026",
      ttl: "2h",
      nowMs,
      paths,
    });
    await acquireLease({
      id: "expired-1",
      kind: "dir",
      target: "/tmp/scratch-a",
      ownerPid: 1001,
      processStart: "Mon Nov 15 10:00:00 2026",
      ttl: "10m",
      nowMs: nowMs - 20 * 60 * 1000,
      paths,
    });
    await acquireLease({
      id: "reused-pid-1",
      kind: "process",
      target: "2002",
      ownerPid: 2002,
      processStart: "Mon Nov 15 08:00:00 2026",
      ttl: "4h",
      nowMs,
      paths,
    });
    await acquireLease({
      id: "missing-pid-1",
      kind: "temporal",
      target: "3003",
      ownerPid: 3003,
      processStart: "Mon Nov 15 09:00:00 2026",
      ttl: "4h",
      nowMs,
      paths,
    });

    const processes = new Map<number, OsProcessEntry>([
      [
        1001,
        {
          pid: 1001,
          ppid: 1,
          processStart: "Mon Nov 15 10:00:00 2026",
          elapsedSeconds: 300,
          command: "zsh",
          args: "zsh",
        },
      ],
      [
        2002,
        {
          pid: 2002,
          ppid: 1,
          processStart: "Mon Nov 15 11:30:00 2026",
          elapsedSeconds: 60,
          command: "node",
          args: "node other.js",
        },
      ],
    ]);

    const listed = await listLeases({ paths, nowMs, processes });
    const byId = new Map(listed.map((item) => [item.lease.id, item.status]));
    expect(byId.get(activeLease.id)).toBe("active");
    expect(byId.get("expired-1")).toBe("expired");
    expect(byId.get("reused-pid-1")).toBe("dead-owner");
    expect(byId.get("missing-pid-1")).toBe("dead-owner");

    const drySweep = await sweepLeases({
      paths,
      nowMs,
      processes,
      apply: false,
    });
    expect(drySweep.sweep.candidates).toHaveLength(3);
    expect(await listLeases({ paths, nowMs, processes })).toHaveLength(4);

    const appliedSweep = await sweepLeases({
      paths,
      nowMs,
      processes,
      apply: true,
    });
    expect(
      appliedSweep.sweep.actions.filter((a) => a.status === "removed"),
    ).toHaveLength(3);
    const remaining = await listLeases({ paths, nowMs, processes });
    expect(remaining.map((r) => r.lease.id)).toEqual(["active-1"]);

    expect(await releaseLease("active-1", { paths })).toBe(true);
    expect(await listLeases({ paths, nowMs, processes })).toEqual([]);
  });

  it("wrapWithLease holds a lease while command runs and releases it on exit", async () => {
    const rootDir = await makeTempTendDir();
    const paths = resolveTendPaths({ tendDir: rootDir });
    let observedDuringRun = 0;

    const exitCode = await wrapWithLease({
      kind: "temporal",
      target: "ephemeral-worker",
      command: ["echo", "ok"],
      paths,
      runner: async () => {
        const active = await listLeases({ paths });
        observedDuringRun = active.length;
        return { exitCode: 0, stdout: "ok\n", stderr: "" };
      },
    });

    expect(exitCode).toBe(0);
    expect(observedDuringRun).toBe(1);
    expect(await listLeases({ paths })).toHaveLength(0);
  });
});
