import os from "node:os";
import { parseArgs } from "node:util";
import { z } from "zod";
import { acquireLease, listLeases } from "#lib/tend/leases.ts";
import { resolveTendPaths, type TendPaths } from "#lib/tend/paths.ts";
import { defaultCommandRunner } from "#lib/tend/process-probe.ts";
import {
  IMMUNE_TAILSCALE_PORT,
  parseTailscaleServeListeners,
} from "#lib/tend/tailscale-serve.ts";
import type { CommandRunner } from "#lib/tend/types.ts";

const DEFAULT_HIGH_PORT_MIN = 8400;
const DEFAULT_HIGH_PORT_MAX = 8999;

const EXPOSE_HELP = `toolkit expose <http|tcp> <localPort> [options]

Expose a local loopback port on your tailnet with an automatic Tailscale Serve
high-port listener and a tracked toolkit tend lease. Never modifies port 443.

Options:
  --port <port>     Explicit external Tailscale port (default: first free in 8400-8999; 443 forbidden)
  --ttl <duration>  Lease time-to-live (default: 4h)
  --json            Print structured JSON output
  --help, -h        Show this help
`;

const TailscaleSelfDnsSchema = z.looseObject({
  Self: z
    .looseObject({
      DNSName: z.string().optional(),
      HostName: z.string().optional(),
    })
    .optional(),
});

export type ExposeResult = {
  readonly protocol: "http" | "tcp";
  readonly localPort: number;
  readonly externalPort: number;
  readonly url: string;
  readonly leaseId: string;
  readonly expiresAt: string;
  readonly teardownCommand: string;
};

function parsePortNumber(raw: string, label: string): number {
  if (!/^\d+$/u.test(raw.trim())) {
    throw new Error(`Invalid ${label} "${raw}": expected an integer port`);
  }
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} ${String(port)} out of valid range 1-65535`);
  }
  return port;
}

export function selectAvailableExposePort(options: {
  readonly occupiedTailscalePorts: ReadonlySet<number>;
  readonly leasedPorts: ReadonlySet<number>;
  readonly requestedPort?: number | undefined;
}): number {
  if (options.requestedPort !== undefined) {
    if (options.requestedPort === IMMUNE_TAILSCALE_PORT) {
      throw new Error(
        "Refusing to expose on port 443: root `/` and 443 are reserved",
      );
    }
    if (
      options.occupiedTailscalePorts.has(options.requestedPort) ||
      options.leasedPorts.has(options.requestedPort)
    ) {
      throw new Error(
        `Tailscale port ${String(options.requestedPort)} is already in use`,
      );
    }
    return options.requestedPort;
  }

  for (
    let candidate = DEFAULT_HIGH_PORT_MIN;
    candidate <= DEFAULT_HIGH_PORT_MAX;
    candidate += 1
  ) {
    if (
      !options.occupiedTailscalePorts.has(candidate) &&
      !options.leasedPorts.has(candidate)
    ) {
      return candidate;
    }
  }
  throw new Error(
    `No free Tailscale high ports available in ${String(DEFAULT_HIGH_PORT_MIN)}-${String(DEFAULT_HIGH_PORT_MAX)}`,
  );
}

async function resolveTailnetDnsName(runner: CommandRunner): Promise<string> {
  const statusRes = await runner(["tailscale", "status", "--json"], {
    timeoutMs: 4000,
  });
  if (statusRes.exitCode === 0 && statusRes.stdout.trim().length > 0) {
    try {
      const parsed = TailscaleSelfDnsSchema.safeParse(
        JSON.parse(statusRes.stdout),
      );
      const rawDns = parsed.success
        ? parsed.data.Self?.DNSName?.replace(/\.$/u, "")
        : undefined;
      if (rawDns !== undefined && rawDns.length > 0) {
        return rawDns;
      }
    } catch {
      // Fall through to hostname fallback.
    }
  }
  return `${os
    .hostname()
    .replace(/\.local$/iu, "")
    .toLowerCase()}.tailnet-1a49.ts.net`;
}

export async function runExpose(options: {
  readonly mode: "http" | "tcp";
  readonly localPort: number;
  readonly requestedPort?: number | undefined;
  readonly ttl?: string | undefined;
  readonly ownerPid?: number | undefined;
  readonly cwd?: string | undefined;
  readonly paths?: TendPaths | undefined;
  readonly runner?: CommandRunner | undefined;
}): Promise<ExposeResult> {
  const runner = options.runner ?? defaultCommandRunner;
  const paths = options.paths ?? resolveTendPaths();

  const serveStatus = await runner(["tailscale", "serve", "status", "--json"], {
    timeoutMs: 5000,
  });
  if (serveStatus.exitCode !== 0) {
    throw new Error(
      `tailscale serve status failed: ${serveStatus.stderr.trim() || `exit ${String(serveStatus.exitCode)}`}`,
    );
  }

  const { occupiedPorts } = parseTailscaleServeListeners(serveStatus.stdout);
  const existingLeases = await listLeases({ paths });
  const leasedPorts = new Set<number>();
  for (const item of existingLeases) {
    if (item.status !== "active" || item.lease.kind !== "tailscale-serve") {
      continue;
    }
    const match = /(\d+)$/u.exec(item.lease.target);
    if (match?.[1] !== undefined) {
      leasedPorts.add(Number(match[1]));
    }
  }

  const externalPort = selectAvailableExposePort({
    occupiedTailscalePorts: occupiedPorts,
    leasedPorts,
    requestedPort: options.requestedPort,
  });

  const serveArgv =
    options.mode === "http"
      ? [
          "tailscale",
          "serve",
          "--bg",
          `--https=${String(externalPort)}`,
          `http://127.0.0.1:${String(options.localPort)}`,
        ]
      : [
          "tailscale",
          "serve",
          "--bg",
          `--tcp=${String(externalPort)}`,
          `tcp://127.0.0.1:${String(options.localPort)}`,
        ];

  const configureRes = await runner(serveArgv, { timeoutMs: 8000 });
  if (configureRes.exitCode !== 0) {
    throw new Error(
      `tailscale serve failed: ${configureRes.stderr.trim() || configureRes.stdout.trim() || `exit ${String(configureRes.exitCode)}`}`,
    );
  }

  const leaseProto = options.mode === "http" ? "https" : "tcp";
  const lease = await acquireLease({
    kind: "tailscale-serve",
    target: `${leaseProto}:${String(externalPort)}`,
    ttl: options.ttl ?? "4h",
    ownerPid: options.ownerPid ?? process.ppid,
    worktree: options.cwd ?? process.cwd(),
    paths,
    runner,
  });

  const dnsName = await resolveTailnetDnsName(runner);
  const url =
    options.mode === "http"
      ? `https://${dnsName}:${String(externalPort)}/`
      : `tcp://${dnsName}:${String(externalPort)}`;
  const teardownCommand = `toolkit tend lease release ${lease.id}`;

  return {
    protocol: options.mode,
    localPort: options.localPort,
    externalPort,
    url,
    leaseId: lease.id,
    expiresAt: lease.expiresAt,
    teardownCommand,
  };
}

export async function handleExposeCommand(
  subcommand: string | undefined,
  args: string[],
  injected: {
    readonly runner?: CommandRunner | undefined;
    readonly paths?: TendPaths | undefined;
  } = {},
): Promise<void> {
  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h" ||
    args.includes("--help") ||
    args.includes("-h")
  ) {
    console.log(EXPOSE_HELP);
    return;
  }

  if (subcommand !== "http" && subcommand !== "tcp") {
    throw new Error(
      `Unknown expose protocol "${subcommand}". Expected "http" or "tcp".`,
    );
  }

  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      ttl: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const localPortText = positionals[0];
  if (localPortText === undefined) {
    throw new Error(
      `Usage: toolkit expose ${subcommand} <localPort> [--port <port>] [--ttl 4h] [--json]`,
    );
  }
  const localPort = parsePortNumber(localPortText, "localPort");
  const requestedPort =
    values.port === undefined
      ? undefined
      : parsePortNumber(values.port, "--port");

  const result = await runExpose({
    mode: subcommand,
    localPort,
    requestedPort,
    ttl: values.ttl,
    paths: injected.paths,
    runner: injected.runner,
  });

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Exposed 127.0.0.1:${String(result.localPort)} -> ${result.url}`,
    );
    console.log(`Lease:    ${result.leaseId} (expires ${result.expiresAt})`);
    console.log(`Teardown: ${result.teardownCommand}`);
  }
}
