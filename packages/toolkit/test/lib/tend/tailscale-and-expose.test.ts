import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runExpose, selectAvailableExposePort } from "#commands/tend/expose.ts";
import { handleTendCommand } from "#commands/tend/tend.ts";
import { acquireLease, listLeases } from "#lib/tend/leases.ts";
import { resolveTendPaths } from "#lib/tend/paths.ts";
import {
  buildTailscaleServeOffArgv,
  parseTailscaleServeListeners,
  sweepTailscaleServe,
} from "#lib/tend/tailscale-serve.ts";
import type { CommandRunner, OsProcessEntry } from "#lib/tend/types.ts";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tend-tailscale-test-"));
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

const SAMPLE_SERVE_STATUS = JSON.stringify({
  TCP: {
    "443": { HTTPS: true },
    "8443": { HTTPS: true },
    "8500": { TCPForward: "127.0.0.1:5432" },
  },
  Web: {
    "karpathy.tailnet-1a49.ts.net:443": {
      Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } },
    },
    "karpathy.tailnet-1a49.ts.net:8443": {
      Handlers: { "/": { Proxy: "http://127.0.0.1:4173" } },
    },
  },
});

describe("Tailscale Serve immunity and 2-strike hysteresis", () => {
  it("never parses port 443 as a removable candidate and throws if asked to build off argv for 443", () => {
    const { listeners, occupiedPorts } =
      parseTailscaleServeListeners(SAMPLE_SERVE_STATUS);
    expect(occupiedPorts.has(443)).toBe(true);
    expect(occupiedPorts.has(8443)).toBe(true);
    expect(occupiedPorts.has(8500)).toBe(true);
    expect(listeners.map((l) => l.externalPort)).toEqual([8443, 8500]);
    expect(() =>
      buildTailscaleServeOffArgv({ protocol: "https", externalPort: 443 }),
    ).toThrow("443");
  });

  it("requires 2 consecutive unreachable sweeps before disabling unleased ports and resets strikes when reachable", async () => {
    const rootDir = await makeTempDir();
    const paths = resolveTendPaths({ tendDir: rootDir });
    const executedOff: string[][] = [];

    const runner: CommandRunner = (argv) => {
      if (argv[0] === "tailscale" && argv[2] === "status") {
        return Promise.resolve({
          exitCode: 0,
          stdout: SAMPLE_SERVE_STATUS,
          stderr: "",
        });
      }
      if (argv[0] === "tailscale" && argv[1] === "serve" && argv[3] === "off") {
        executedOff.push([...argv]);
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    };

    // Sweep 1: both local ports unreachable -> strike 1 recorded, 0 candidates!
    const sweep1 = await sweepTailscaleServe({
      leases: [],
      runner,
      probePort: () => Promise.resolve(false),
      paths,
      apply: true,
    });
    expect(sweep1.candidates).toHaveLength(0);
    expect(executedOff).toHaveLength(0);

    // Sweep 2: 4173 (8443) becomes reachable, 5432 (8500) fails 2nd consecutive time -> only 8500 disabled!
    const sweep2 = await sweepTailscaleServe({
      leases: [],
      runner,
      probePort: (_host, port) => Promise.resolve(port === 4173),
      paths,
      apply: true,
    });
    expect(sweep2.candidates.map((c) => c.id)).toEqual([
      "tailscale-serve:tcp:8500",
    ]);
    expect(executedOff).toEqual([["tailscale", "serve", "--tcp=8500", "off"]]);

    // Sweep 3: 4173 (8443) fails again -> since strike reset on sweep 2, this is strike 1 again -> 0 candidates!
    const sweep3 = await sweepTailscaleServe({
      leases: [],
      runner,
      probePort: () => Promise.resolve(false),
      paths,
      apply: false,
    });
    expect(sweep3.candidates).toHaveLength(0);
  });

  it("protects listeners with an active lease and immediately disables listeners with an expired lease", async () => {
    const rootDir = await makeTempDir();
    const paths = resolveTendPaths({ tendDir: rootDir });
    const nowMs = 1_760_000_000_000;

    await acquireLease({
      id: "ts-active-8443",
      kind: "tailscale-serve",
      target: "https:8443",
      ownerPid: 500,
      processStart: "Mon Nov 15 10:00:00 2026",
      ttl: "2h",
      nowMs,
      paths,
    });
    await acquireLease({
      id: "ts-expired-8500",
      kind: "tailscale-serve",
      target: "tcp:8500",
      ownerPid: 500,
      processStart: "Mon Nov 15 10:00:00 2026",
      ttl: "5m",
      nowMs: nowMs - 600_000,
      paths,
    });

    const processes = new Map<number, OsProcessEntry>([
      [
        500,
        {
          pid: 500,
          ppid: 1,
          processStart: "Mon Nov 15 10:00:00 2026",
          elapsedSeconds: 900,
          command: "zsh",
          args: "zsh",
        },
      ],
    ]);
    const leases = await listLeases({ paths, nowMs, processes });
    const executedOff: string[][] = [];

    const res = await sweepTailscaleServe({
      leases,
      paths,
      apply: true,
      probePort: () => Promise.resolve(false),
      runner: (argv) => {
        if (argv[0] === "tailscale" && argv[2] === "status") {
          return Promise.resolve({
            exitCode: 0,
            stdout: SAMPLE_SERVE_STATUS,
            stderr: "",
          });
        }
        if (argv[3] === "off") {
          executedOff.push([...argv]);
        }
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
    });

    expect(res.candidates.map((c) => c.id)).toEqual([
      "tailscale-serve:tcp:8500",
    ]);
    expect(executedOff).toEqual([["tailscale", "serve", "--tcp=8500", "off"]]);
    const afterLeases = await listLeases({ paths, nowMs, processes });
    expect(afterLeases.map((l) => l.lease.id)).toEqual(["ts-active-8443"]);
  });
});

describe("toolkit expose and tend lease release", () => {
  it("forbids port 443, selects first free port in 8400-8999, configures tailscale serve, and tears down on lease release", async () => {
    expect(() =>
      selectAvailableExposePort({
        occupiedTailscalePorts: new Set([443]),
        leasedPorts: new Set(),
        requestedPort: 443,
      }),
    ).toThrow("443");

    expect(
      selectAvailableExposePort({
        occupiedTailscalePorts: new Set([443, 8400]),
        leasedPorts: new Set([8401]),
      }),
    ).toBe(8402);

    const rootDir = await makeTempDir();
    const paths = resolveTendPaths({ tendDir: rootDir });
    const calls: string[][] = [];

    const runner: CommandRunner = (argv) => {
      calls.push([...argv]);
      if (
        argv[0] === "tailscale" &&
        argv[1] === "serve" &&
        argv[2] === "status"
      ) {
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({
            TCP: { "443": { HTTPS: true }, "8400": { HTTPS: true } },
            Web: {},
          }),
          stderr: "",
        });
      }
      if (argv[0] === "tailscale" && argv[1] === "status") {
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({
            Self: { DNSName: "karpathy.tailnet-1a49.ts.net." },
          }),
          stderr: "",
        });
      }
      if (argv[0] === "ps") {
        return Promise.resolve({
          exitCode: 0,
          stdout: "Mon Nov 15 10:00:00 2026\n",
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    };

    const exposed = await runExpose({
      mode: "http",
      localPort: 5173,
      ttl: "2h",
      ownerPid: 1234,
      cwd: "/Users/jerred/git/monorepo",
      paths,
      runner,
    });

    expect(exposed.externalPort).toBe(8401);
    expect(exposed.url).toBe("https://karpathy.tailnet-1a49.ts.net:8401/");
    expect(calls).toContainEqual([
      "tailscale",
      "serve",
      "--bg",
      "--https=8401",
      "http://127.0.0.1:5173",
    ]);

    await handleTendCommand("lease", ["release", exposed.leaseId], {
      paths,
      runner,
    });

    expect(calls).toContainEqual(["tailscale", "serve", "--https=8401", "off"]);
    expect(await listLeases({ paths })).toHaveLength(0);
  });
});
