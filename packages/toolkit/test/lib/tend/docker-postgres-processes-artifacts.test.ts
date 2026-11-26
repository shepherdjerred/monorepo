import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleTendCommand } from "#commands/tend/tend.ts";
import { formatTendReport } from "#commands/tend/tend-format.ts";
import { sweepArtifacts } from "#lib/tend/artifacts.ts";
import {
  DOCKER_BUILDER_PRUNE_ARGV,
  DOCKER_IMAGE_PRUNE_ARGV,
  DOCKER_VOLUME_PRUNE_ARGV,
  sweepDocker,
} from "#lib/tend/docker.ts";
import { resolveTendPaths } from "#lib/tend/paths.ts";
import { sweepPostgres } from "#lib/tend/postgres.ts";
import { sweepProcesses } from "#lib/tend/processes.ts";
import { acquireTendRunLock } from "#lib/tend/run-lock.ts";
import { readLastTendRunSummary, runTend } from "#lib/tend/runner.ts";
import type {
  CommandRunner,
  LivenessSnapshot,
  OsProcessEntry,
  TendSurface,
} from "#lib/tend/types.ts";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tend-surfaces-test-"));
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

function makeLiveness(options: {
  readonly processes?: ReadonlyMap<number, OsProcessEntry>;
  readonly liveTerminalPids?: Iterable<number>;
  readonly holdSurfaces?: ReadonlyMap<TendSurface, string>;
  readonly protectedPaths?: Iterable<string>;
}): LivenessSnapshot {
  return {
    capturedAt: "2026-11-15T20:00:00Z",
    platform: "darwin",
    localHost: "karpathy",
    localHostAliases: new Set(["karpathy"]),
    hcAvailable: true,
    hcTerminals: [],
    protectedPaths: new Set(options.protectedPaths),
    processCwds: new Set(),
    herdrActivePaths: new Set(),
    forumNoticePaths: new Set(),
    forumNotices: [],
    forumAvailable: true,
    holdSurfaces: new Map(options.holdSurfaces),
    warnings: [],
    processes: new Map(options.processes),
    liveTerminalRelatedPids: new Set(options.liveTerminalPids),
  };
}

describe("sweepDocker", () => {
  it("skips cleanly without starting Docker when daemon is stopped", async () => {
    const res = await sweepDocker({
      liveness: makeLiveness({}),
      leases: [],
      apply: true,
      runner: () =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "Cannot connect to the Docker daemon",
        }),
    });
    expect(res.skippedReason).toBe("docker daemon not running");
    expect(res.candidates).toEqual([]);
  });

  it("removes expired mc-harness containers and NEVER passes --all or -a to docker volume prune", async () => {
    expect(DOCKER_VOLUME_PRUNE_ARGV).not.toContain("--all");
    expect(DOCKER_VOLUME_PRUNE_ARGV).not.toContain("-a");

    const nowMs = 1_760_000_000_000;
    const calls: string[][] = [];
    const runner: CommandRunner = (argv) => {
      calls.push([...argv]);
      if (argv[0] === "docker" && argv[1] === "info") {
        return Promise.resolve({ exitCode: 0, stdout: "{}\n", stderr: "" });
      }
      if (
        argv[0] === "docker" &&
        argv[1] === "ps" &&
        argv.includes("label=mc-harness.managed=true")
      ) {
        const expiredRow = `abc123\tmc-expired\t2026-11-14 00:00:00 +0000 UTC\t${String(nowMs - 60_000)}\t9999\tfalse`;
        const keptRow = `def456\tmc-kept\t2026-11-14 00:00:00 +0000 UTC\t${String(nowMs - 60_000)}\t9999\ttrue`;
        return Promise.resolve({
          exitCode: 0,
          stdout: `${expiredRow}\n${keptRow}\n`,
          stderr: "",
        });
      }
      if (argv[0] === "docker" && argv[1] === "ps" && argv[2] === "-a") {
        return Promise.resolve({
          exitCode: 0,
          stdout: "dead1\t2026-11-14\n",
          stderr: "",
        });
      }
      return argv[0] === "docker" && argv[1] === "volume" && argv[2] === "ls"
        ? Promise.resolve({ exitCode: 0, stdout: "anonvol1\n", stderr: "" })
        : Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    };

    const res = await sweepDocker({
      liveness: makeLiveness({}),
      leases: [],
      runner,
      apply: true,
      nowMs,
    });

    expect(res.actions.filter((a) => a.status === "removed")).toHaveLength(3);
    expect(calls).toContainEqual(["docker", "rm", "-f", "-v", "abc123"]);
    expect(calls).toContainEqual([...DOCKER_IMAGE_PRUNE_ARGV]);
    expect(calls).toContainEqual([...DOCKER_BUILDER_PRUNE_ARGV]);
    const volumePruneCalls = calls.filter(
      (c) => c[0] === "docker" && c[1] === "volume" && c[2] === "prune",
    );
    expect(volumePruneCalls).toEqual([["docker", "volume", "prune", "-f"]]);
    for (const call of volumePruneCalls) {
      expect(call).not.toContain("--all");
      expect(call).not.toContain("-a");
    }
  });
});

describe("sweepPostgres", () => {
  it("honors Forum holdSurfaces, stops dead-owner temp clusters with pg_ctl before rm, and drops only dead local-owner + >7d template DBs", async () => {
    const held = await sweepPostgres({
      liveness: makeLiveness({
        holdSurfaces: new Map([
          ["postgres", "held by active host Forum notice"],
        ]),
      }),
      apply: true,
    });
    expect(held.heldReason).toContain("Forum notice");

    const root = await makeTempDir();
    const deadCluster = path.join(root, "delivery-pg-dead");
    await mkdir(deadCluster, { recursive: true });
    await Bun.write(
      path.join(deadCluster, "owner.pid"),
      JSON.stringify({ pid: 4444, processStart: "Mon Nov 15 08:00:00 2026" }),
    );
    await Bun.write(path.join(deadCluster, "postmaster.pid"), "5555\n");

    const nowMs = 1_760_000_000_000;
    // PID 4444 reused with DIFFERENT processStart; PID 5555 postmaster still running!
    const processes = new Map<number, OsProcessEntry>([
      [
        4444,
        {
          pid: 4444,
          ppid: 1,
          processStart: "Mon Nov 15 11:00:00 2026",
          elapsedSeconds: 100,
          command: "other",
          args: "other",
        },
      ],
      [
        5555,
        {
          pid: 5555,
          ppid: 1,
          processStart: "Mon Nov 15 08:00:01 2026",
          elapsedSeconds: 7200,
          command: "/Users/jerred/.l",
          args: `postgres -D ${deadCluster}`,
          cwd: deadCluster,
        },
      ],
      [
        5556,
        {
          pid: 5556,
          ppid: 5555,
          processStart: "Mon Nov 15 08:00:01 2026",
          elapsedSeconds: 7200,
          command: "postgres: checkp",
          args: "postgres: checkpointer",
          cwd: deadCluster,
        },
      ],
    ]);

    const pgCtlCalls: string[][] = [];
    const killedSignals: [number, NodeJS.Signals][] = [];
    const droppedDbs: string[] = [];

    const res = await sweepPostgres({
      liveness: makeLiveness({ processes }),
      tempDirs: [root],
      apply: true,
      nowMs,
      killProcess: (pid, signal) => {
        killedSignals.push([pid, signal]);
      },
      runner: (argv) => {
        if (argv[0] === "pg_ctl") {
          pgCtlCalls.push([...argv]);
        }
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
      sharedAdapter: {
        listDatabases: () =>
          Promise.resolve([
            {
              name: "scout_test_dead_local",
              comment: `scout-test-owner/v1 ${JSON.stringify({
                host: "karpathy",
                pid: 9999,
                processStart: "Mon Nov 15 07:00:00 2026",
                createdAt: nowMs - 600_000,
              })}`,
              connections: 0,
            },
            {
              name: "scout_test_foreign_host",
              comment: `scout-test-owner/v1 ${JSON.stringify({
                host: "macbook",
                pid: 9999,
                processStart: "Mon Nov 15 07:00:00 2026",
                createdAt: nowMs - 600_000,
              })}`,
              connections: 0,
            },
            {
              name: "delivery_test_active_conn",
              comment: `monorepo-test-owner/v1 ${JSON.stringify({
                host: "karpathy",
                pid: 9999,
                processStart: "Mon Nov 15 07:00:00 2026",
                createdAt: nowMs - 600_000,
              })}`,
              connections: 1,
            },
            {
              name: "scout_template_old",
              comment: null,
              connections: 0,
              pgVersionMtimeMs: nowMs - 9 * 86_400_000,
            },
          ]),
        dropDatabase: (dbName) => {
          droppedDbs.push(dbName);
          return Promise.resolve();
        },
      },
    });

    expect(pgCtlCalls).toEqual([
      ["pg_ctl", "-D", deadCluster, "-m", "immediate", "-w", "stop"],
    ]);
    expect(killedSignals).toEqual([[5555, "SIGTERM"]]);
    expect(await Bun.file(path.join(deadCluster, "owner.pid")).exists()).toBe(
      false,
    );
    expect(droppedDbs).toEqual(["scout_test_dead_local", "scout_template_old"]);
    expect(res.actions.filter((a) => a.status === "removed")).toHaveLength(3);
  });
});

describe("sweepProcesses", () => {
  it("reaps orphaned PPID=1 processes >15m while skipping hc terminal descendants and refusing mismatched processStart", async () => {
    const processes = new Map<number, OsProcessEntry>([
      [
        2001,
        {
          pid: 2001,
          ppid: 1,
          processStart: "Mon Nov 15 08:00:00 2026",
          elapsedSeconds: 1800,
          command: "temporal-test-server",
          args: "temporal-test-server --port 7233",
        },
      ],
      [
        2002,
        {
          pid: 2002,
          ppid: 1,
          processStart: "Mon Nov 15 08:00:00 2026",
          elapsedSeconds: 1800,
          command: "cloudflared",
          args: "cloudflared tunnel --url http://127.0.0.1:4321",
        },
      ],
      [
        2003,
        {
          pid: 2003,
          ppid: 1,
          processStart: "Mon Nov 15 08:00:00 2026",
          elapsedSeconds: 1800,
          command: "bun",
          args: "bun scripts/media-system/workflow-worker.ts",
        },
      ],
      [
        2004,
        {
          pid: 2004,
          ppid: 1,
          processStart: "Mon Nov 15 08:00:00 2026",
          elapsedSeconds: 1800,
          command: "temporal-test-server",
          args: "temporal-test-server --port 7234",
        },
      ],
    ]);

    const signaled: string[] = [];
    const aliveSet = new Set([2001, 2002, 2003, 2004]);

    const res = await sweepProcesses({
      // 2004 is a live hc terminal descendant -> skipped!
      liveness: makeLiveness({ processes, liveTerminalPids: [2004] }),
      apply: true,
      probePort: () => Promise.resolve(false),
      signaler: {
        kill: (pid, signal) => {
          signaled.push(`${String(pid)}:${signal}`);
          aliveSet.delete(pid);
        },
        isAlive: (pid) => aliveSet.has(pid),
        readStart: (pid) =>
          Promise.resolve(
            // Simulate PID 2003 reused right before signaling -> must refuse!
            pid === 2003
              ? "Mon Nov 15 11:59:59 2026"
              : "Mon Nov 15 08:00:00 2026",
          ),
        sleep: () => Promise.resolve(),
      },
    });

    expect(signaled).toEqual(["2001:SIGTERM", "2002:SIGTERM"]);
    const statusById = new Map(
      res.actions.map((a) => [a.candidate.id, a.status]),
    );
    expect(statusById.get("proc:2001")).toBe("removed");
    expect(statusById.get("proc:2002")).toBe("removed");
    expect(statusById.get("proc:2003")).toBe("failed");
    expect(statusById.has("proc:2004")).toBe(false);
  });
});

describe("sweepArtifacts, run.lock, and runTend dry-run default", () => {
  it("keeps newest brim-install <24h, deletes Shutdown Facet E2E simulator >2h, breaks stale lock, and defaults CLI run to dry-run", async () => {
    const homeDir = await makeTempDir();
    const toolkitRoot = path.join(homeDir, ".toolkit");
    await mkdir(toolkitRoot, { recursive: true });

    const nowMs = 1_760_000_000_000;
    const newestBrim = path.join(toolkitRoot, "brim-install-new");
    const olderBrim = path.join(toolkitRoot, "brim-install-old");
    await Bun.write(newestBrim, "bin1");
    await Bun.write(olderBrim, "bin2");
    const twoHoursAgo = new Date(nowMs - 2 * 3_600_000);
    const threeHoursAgo = new Date(nowMs - 3 * 3_600_000);
    await utimes(newestBrim, twoHoursAgo, twoHoursAgo);
    await utimes(olderBrim, threeHoursAgo, threeHoursAgo);

    const simDeletes: string[] = [];
    const artifactsRes = await sweepArtifacts({
      liveness: makeLiveness({}),
      homeDir,
      tempDirs: [],
      apply: true,
      nowMs,
      runner: (argv) => {
        if (argv[0] === "xcrun" && argv[2] === "list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: JSON.stringify({
              devices: {
                "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
                  {
                    udid: "SIM-SHUTDOWN-OLD",
                    name: "Facet E2E Worker 1",
                    state: "Shutdown",
                    lastBootedAt: new Date(nowMs - 4 * 3_600_000).toISOString(),
                  },
                  {
                    udid: "SIM-BOOTED",
                    name: "Facet E2E Worker 2",
                    state: "Booted",
                    lastBootedAt: new Date(nowMs - 4 * 3_600_000).toISOString(),
                  },
                ],
              },
            }),
            stderr: "",
          });
        }
        if (argv[0] === "xcrun" && argv[2] === "delete") {
          simDeletes.push(argv[3] ?? "");
        }
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
    });

    expect(await Bun.file(newestBrim).exists()).toBe(true);
    expect(await Bun.file(olderBrim).exists()).toBe(false);
    expect(simDeletes).toEqual(["SIM-SHUTDOWN-OLD"]);
    expect(
      artifactsRes.actions.filter((a) => a.status === "removed"),
    ).toHaveLength(2);

    // Verify stale lock breaking & concurrent lock rejection
    const paths = resolveTendPaths({ homeDir });
    await mkdir(paths.rootDir, { recursive: true });
    await Bun.write(
      paths.lockFile,
      JSON.stringify({
        pid: 88_888,
        processStart: "Mon Nov 15 01:00:00 2026",
        acquiredAt: "2026-11-15T01:00:00Z",
      }),
    );

    const release = await acquireTendRunLock({
      paths,
      ownerPid: 1111,
      processStart: "Mon Nov 15 10:00:00 2026",
      isPidAlive: (pid) => pid === 1111,
      readPidStart: () => Promise.resolve("Mon Nov 15 10:00:00 2026"),
    });
    await expect(
      acquireTendRunLock({
        paths,
        ownerPid: 2222,
        processStart: "Mon Nov 15 10:01:00 2026",
        isPidAlive: () => true,
        readPidStart: () => Promise.resolve("Mon Nov 15 10:00:00 2026"),
      }),
    ).rejects.toThrow("Another toolkit tend --apply run is active");
    await release();

    // Verify runTend appends events.jsonl and CLI `run` without --apply stays dry-run
    const report = await runTend({
      mode: "run",
      apply: false,
      surfaces: ["leases"],
      paths,
      livenessOverride: makeLiveness({}),
      nowMs,
    });
    expect(report.mode).toBe("dry-run");
    const lastSummary = await readLastTendRunSummary(paths);
    expect(lastSummary?.apply).toBe(false);

    await handleTendCommand(
      "run",
      ["--only", "leases", "--offline", "--summary"],
      {
        paths,
        runner: () =>
          Promise.resolve({ exitCode: 127, stdout: "", stderr: "" }),
      },
    );
    const afterCliSummary = await readLastTendRunSummary(paths);
    expect(afterCliSummary?.apply).toBe(false);
  });
});

describe("worktree turbo cache sweep and status disk telemetry", () => {
  it("sweeps stale .turbo/cache (>48h) in inactive worktrees while preserving active/recent ones, and reports disk + docker df in status", async () => {
    const homeDir = await makeTempDir();
    const paths = resolveTendPaths({ homeDir });
    const nowMs = 1_760_000_000_000;
    const sixtyHoursAgo = new Date(nowMs - 60 * 3_600_000);
    const twelveHoursAgo = new Date(nowMs - 12 * 3_600_000);

    const staleCache = path.join(
      homeDir,
      ".herdr",
      "worktrees",
      "monorepo",
      "wt-stale",
      ".turbo",
      "cache",
    );
    const protectedWt = path.join(
      homeDir,
      ".herdr",
      "worktrees",
      "monorepo",
      "wt-active",
    );
    const protectedCache = path.join(protectedWt, ".turbo", "cache");
    const recentCache = path.join(
      homeDir,
      ".herdr",
      "worktrees",
      "monorepo",
      "wt-recent",
      ".turbo",
      "cache",
    );

    await mkdir(staleCache, { recursive: true });
    await mkdir(protectedCache, { recursive: true });
    await mkdir(recentCache, { recursive: true });

    const staleEntry = path.join(staleCache, "a.tar.zst");
    const protectedEntry = path.join(protectedCache, "b.tar.zst");
    const recentEntry = path.join(recentCache, "c.tar.zst");
    await Bun.write(staleEntry, "old");
    await Bun.write(protectedEntry, "live");
    await Bun.write(recentEntry, "fresh");

    await utimes(staleEntry, sixtyHoursAgo, sixtyHoursAgo);
    await utimes(staleCache, sixtyHoursAgo, sixtyHoursAgo);
    await utimes(protectedEntry, sixtyHoursAgo, sixtyHoursAgo);
    await utimes(protectedCache, sixtyHoursAgo, sixtyHoursAgo);
    await utimes(recentEntry, twelveHoursAgo, twelveHoursAgo);
    await utimes(recentCache, twelveHoursAgo, twelveHoursAgo);

    const sweepRes = await sweepArtifacts({
      liveness: makeLiveness({
        protectedPaths: [path.join(protectedWt, "packages", "toolkit")],
      }),
      homeDir,
      tempDirs: [],
      apply: true,
      nowMs,
      runner: () => Promise.resolve({ exitCode: 1, stdout: "", stderr: "" }),
    });

    expect(
      sweepRes.candidates
        .filter((c) => c.kind === "turbo-cache")
        .map((c) => c.target),
    ).toEqual([staleCache]);
    expect(await Bun.file(staleEntry).exists()).toBe(false);
    expect(await Bun.file(protectedEntry).exists()).toBe(true);
    expect(await Bun.file(recentEntry).exists()).toBe(true);

    const gib = 1024 ** 3;
    const statusWarn = await runTend({
      mode: "status",
      surfaces: ["docker"],
      paths,
      homeDir,
      livenessOverride: makeLiveness({}),
      statDisk: () =>
        Promise.resolve({ availableBytes: 12 * gib, totalBytes: 500 * gib }),
      runner: (argv) => {
        if (argv[0] === "docker" && argv[1] === "system" && argv[2] === "df") {
          return Promise.resolve({
            exitCode: 0,
            stdout:
              '{"Type":"Images","TotalCount":"10","Active":"2","Size":"24.5GB","Reclaimable":"18.0GB (73%)"}\n' +
              '{"Type":"Build Cache","TotalCount":"50","Active":"0","Size":"11.2GB","Reclaimable":"11.2GB"}\n',
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      },
      nowMs,
    });
    expect(statusWarn.disk?.level).toBe("warning");
    expect(statusWarn.dockerDisk?.available).toBe(true);
    expect(statusWarn.dockerDisk?.rows).toHaveLength(2);
    const formatted = formatTendReport(statusWarn);
    expect(formatted).toContain("12.0 GiB free / 500.0 GiB total (WARNING)");
    expect(formatted).toContain("Images=24.5GB (reclaimable 18.0GB (73%))");

    const statusCrit = await runTend({
      mode: "status",
      surfaces: ["leases"],
      paths,
      homeDir,
      livenessOverride: makeLiveness({}),
      statDisk: () =>
        Promise.resolve({ availableBytes: 3 * gib, totalBytes: 500 * gib }),
      nowMs,
    });
    expect(statusCrit.disk?.level).toBe("critical");
    expect(
      statusCrit.liveness.warnings.some((w) => w.includes("CRITICAL")),
    ).toBe(true);
  });
});
