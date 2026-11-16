import { randomUUID } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import { z } from "zod";
import { releaseLease } from "./leases.ts";
import { resolveTendPaths, type TendPaths } from "./paths.ts";
import { defaultCommandRunner, defaultTcpPortProbe } from "./process-probe.ts";
import {
  type ClassifiedLease,
  type CommandRunner,
  type SurfaceSweepResult,
  type TcpPortProbe,
  type TendActionOutcome,
  type TendCandidate,
  type TendState,
  TendStateSchema,
} from "./types.ts";

export const IMMUNE_TAILSCALE_PORT = 443;

const ServeWebHandlerSchema = z.looseObject({
  Proxy: z.string().optional(),
  Path: z.string().optional(),
  Text: z.string().optional(),
});

const ServeWebHostConfigSchema = z.looseObject({
  Handlers: z.record(z.string(), ServeWebHandlerSchema).optional(),
});

const ServeTcpPortConfigSchema = z.looseObject({
  HTTPS: z.boolean().optional(),
  HTTP: z.boolean().optional(),
  TCPForward: z.string().optional(),
  TerminateTLS: z.string().optional(),
});

const TailscaleServeStatusSchema = z.looseObject({
  TCP: z.record(z.string(), ServeTcpPortConfigSchema).optional(),
  Web: z.record(z.string(), ServeWebHostConfigSchema).optional(),
});

export type TailscaleListener = {
  readonly protocol: "https" | "http" | "tcp";
  readonly externalPort: number;
  readonly targetHost: string;
  readonly targetPort: number;
  readonly rawTarget: string;
};

function parseLocalTargetPort(
  rawProxy: string,
): { readonly host: string; readonly port: number } | null {
  const trimmed = rawProxy.trim();
  const urlMatch =
    /^(?:https?|tcp):\/\/(127\.0\.0\.1|localhost):(\d+)(?:\/.*)?$/iu.exec(
      trimmed,
    );
  if (urlMatch?.[1] !== undefined && urlMatch[2] !== undefined) {
    const port = Number(urlMatch[2]);
    if (Number.isInteger(port) && port > 0 && port <= 65_535) {
      return { host: "127.0.0.1", port };
    }
  }
  const hostPortMatch = /^(127\.0\.0\.1|localhost):(\d+)$/iu.exec(trimmed);
  if (hostPortMatch?.[1] !== undefined && hostPortMatch[2] !== undefined) {
    const port = Number(hostPortMatch[2]);
    if (Number.isInteger(port) && port > 0 && port <= 65_535) {
      return { host: "127.0.0.1", port };
    }
  }
  return null;
}

function parseWebHostPort(hostPortKey: string): number | null {
  const colonIdx = hostPortKey.lastIndexOf(":");
  if (colonIdx === -1) {
    // Bare hostname with no `:port` in Tailscale Serve is port 443.
    return IMMUNE_TAILSCALE_PORT;
  }
  const portText = hostPortKey.slice(colonIdx + 1);
  if (!/^\d+$/u.test(portText)) {
    return null;
  }
  const port = Number(portText);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

function collectTcpForwardListeners(
  tcpMap: Readonly<Record<string, { TCPForward?: string | undefined }>>,
  occupiedPorts: Set<number>,
  listenersByPort: Map<number, TailscaleListener>,
): void {
  for (const [portKey, tcpCfg] of Object.entries(tcpMap)) {
    const port = Number(portKey);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      continue;
    }
    occupiedPorts.add(port);
    if (port === IMMUNE_TAILSCALE_PORT || tcpCfg.TCPForward === undefined) {
      continue;
    }
    const target = parseLocalTargetPort(tcpCfg.TCPForward);
    if (target !== null) {
      listenersByPort.set(port, {
        protocol: "tcp",
        externalPort: port,
        targetHost: target.host,
        targetPort: target.port,
        rawTarget: tcpCfg.TCPForward,
      });
    }
  }
}

function collectWebProxyListeners(
  webMap: Readonly<
    Record<
      string,
      { Handlers?: Record<string, { Proxy?: string | undefined }> | undefined }
    >
  >,
  tcpMap: Readonly<Record<string, { HTTP?: boolean | undefined }>>,
  occupiedPorts: Set<number>,
  listenersByPort: Map<number, TailscaleListener>,
): void {
  for (const [hostPortKey, webCfg] of Object.entries(webMap)) {
    const port = parseWebHostPort(hostPortKey);
    if (port === null) {
      continue;
    }
    occupiedPorts.add(port);
    if (port === IMMUNE_TAILSCALE_PORT) {
      continue;
    }
    const handlers = webCfg.Handlers ?? {};
    const handlerKeys = Object.keys(handlers);
    // Only manage simple root loopback proxy listeners on high ports.
    if (handlerKeys.length !== 1 || handlerKeys[0] !== "/") {
      continue;
    }
    const rootProxy = handlers["/"]?.Proxy;
    if (rootProxy === undefined) {
      continue;
    }
    const target = parseLocalTargetPort(rootProxy);
    if (target === null) {
      continue;
    }
    const protocol = tcpMap[String(port)]?.HTTP === true ? "http" : "https";
    listenersByPort.set(port, {
      protocol,
      externalPort: port,
      targetHost: target.host,
      targetPort: target.port,
      rawTarget: rootProxy,
    });
  }
}

/**
 * Extract high-port local-loopback Tailscale Serve listeners, strictly
 * excluding port 443 and root `/` on 443 under all circumstances.
 */
export function parseTailscaleServeListeners(stdout: string): {
  readonly listeners: TailscaleListener[];
  readonly occupiedPorts: Set<number>;
} {
  const occupiedPorts = new Set<number>([IMMUNE_TAILSCALE_PORT]);
  const listenersByPort = new Map<number, TailscaleListener>();
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { listeners: [], occupiedPorts };
  }
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(trimmed);
  } catch {
    return { listeners: [], occupiedPorts };
  }
  const parsed = TailscaleServeStatusSchema.safeParse(rawJson);
  if (!parsed.success) {
    return { listeners: [], occupiedPorts };
  }

  const tcpMap = parsed.data.TCP ?? {};
  const webMap = parsed.data.Web ?? {};
  collectTcpForwardListeners(tcpMap, occupiedPorts, listenersByPort);
  collectWebProxyListeners(webMap, tcpMap, occupiedPorts, listenersByPort);

  const listeners = [...listenersByPort.values()].sort(
    (a, b) => a.externalPort - b.externalPort,
  );
  return { listeners, occupiedPorts };
}

export function buildTailscaleServeOffArgv(
  listener: Pick<TailscaleListener, "protocol" | "externalPort">,
): string[] {
  if (listener.externalPort === IMMUNE_TAILSCALE_PORT) {
    throw new Error("Refusing to disable immune Tailscale Serve port 443");
  }
  const flag =
    listener.protocol === "tcp"
      ? `--tcp=${String(listener.externalPort)}`
      : listener.protocol === "http"
        ? `--http=${String(listener.externalPort)}`
        : `--https=${String(listener.externalPort)}`;
  return ["tailscale", "serve", flag, "off"];
}

async function loadTendState(paths: TendPaths): Promise<TendState> {
  const file = Bun.file(paths.stateFile);
  if (!(await file.exists())) {
    return { version: 1, tailscaleStrikes: {} };
  }
  try {
    const parsed = TendStateSchema.safeParse(JSON.parse(await file.text()));
    return parsed.success ? parsed.data : { version: 1, tailscaleStrikes: {} };
  } catch {
    return { version: 1, tailscaleStrikes: {} };
  }
}

async function saveTendState(
  paths: TendPaths,
  state: TendState,
): Promise<void> {
  await mkdir(paths.rootDir, { recursive: true, mode: 0o700 });
  const tempPath = `${paths.stateFile}.${randomUUID()}.tmp`;
  await Bun.write(tempPath, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tempPath, paths.stateFile);
}

function matchingTailscaleLeases(
  listener: TailscaleListener,
  leases: readonly ClassifiedLease[],
): {
  readonly active: ClassifiedLease | undefined;
  readonly stale: ClassifiedLease[];
} {
  const portStr = String(listener.externalPort);
  const matching = leases.filter((item) => {
    if (item.lease.kind !== "tailscale-serve") {
      return false;
    }
    const target = item.lease.target.trim().toLowerCase();
    return (
      target === portStr ||
      target === `${listener.protocol}:${portStr}` ||
      target === `https:${portStr}` ||
      target === `http:${portStr}` ||
      target === `tcp:${portStr}`
    );
  });
  return {
    active: matching.find((item) => item.status === "active"),
    stale: matching.filter((item) => item.status !== "active"),
  };
}

async function evaluateListenerDisableReason(options: {
  readonly listener: TailscaleListener;
  readonly strikeKey: string;
  readonly matched: {
    readonly active: ClassifiedLease | undefined;
    readonly stale: readonly ClassifiedLease[];
  };
  readonly priorStrikes: Readonly<Record<string, number>>;
  readonly nextStrikes: Map<string, number>;
  readonly probePort: TcpPortProbe;
  readonly immediateProxies: boolean;
}): Promise<string | null> {
  if (options.matched.active !== undefined) {
    return null;
  }
  const firstStale = options.matched.stale[0];
  if (firstStale !== undefined) {
    return `lease ${firstStale.lease.id} ${firstStale.status} (${firstStale.reason})`;
  }
  const reachable = await options.probePort(
    options.listener.targetHost,
    options.listener.targetPort,
  );
  if (reachable) {
    return null;
  }
  const strikes = (options.priorStrikes[options.strikeKey] ?? 0) + 1;
  options.nextStrikes.set(options.strikeKey, strikes);
  if (options.immediateProxies) {
    return `target ${options.listener.targetHost}:${String(options.listener.targetPort)} unreachable (--immediate-proxies)`;
  }
  return strikes >= 2
    ? `target ${options.listener.targetHost}:${String(options.listener.targetPort)} unreachable for ${String(strikes)} consecutive sweeps`
    : null;
}

async function disableTailscaleListener(options: {
  readonly listener: TailscaleListener;
  readonly candidate: TendCandidate;
  readonly strikeKey: string;
  readonly staleLeases: readonly ClassifiedLease[];
  readonly nextStrikes: Map<string, number>;
  readonly paths: TendPaths;
  readonly runner: CommandRunner;
}): Promise<TendActionOutcome> {
  const offArgv = buildTailscaleServeOffArgv(options.listener);
  const offRes = await options.runner(offArgv, { timeoutMs: 5000 });
  if (offRes.exitCode === 0) {
    options.nextStrikes.delete(options.strikeKey);
    for (const stale of options.staleLeases) {
      await releaseLease(stale.lease.id, { paths: options.paths });
    }
    return { candidate: options.candidate, status: "removed" };
  }
  return {
    candidate: options.candidate,
    status: "failed",
    detail:
      offRes.stderr.trim() ||
      `tailscale serve off exited ${String(offRes.exitCode)}`,
  };
}

export type SweepTailscaleServeOptions = {
  readonly leases: readonly ClassifiedLease[];
  readonly runner?: CommandRunner | undefined;
  readonly probePort?: TcpPortProbe | undefined;
  readonly paths?: TendPaths | undefined;
  readonly apply: boolean;
  readonly persistState?: boolean | undefined;
  readonly immediateProxies?: boolean | undefined;
};

export async function sweepTailscaleServe(
  options: SweepTailscaleServeOptions,
): Promise<SurfaceSweepResult> {
  const runner = options.runner ?? defaultCommandRunner;
  const probePort = options.probePort ?? defaultTcpPortProbe;
  const paths = options.paths ?? resolveTendPaths();
  const persistState = options.persistState ?? true;

  const statusRes = await runner(["tailscale", "serve", "status", "--json"], {
    timeoutMs: 4000,
  });
  if (statusRes.exitCode !== 0) {
    return {
      surface: "tailscale-serve",
      skippedReason: "tailscale unavailable or stopped",
      inspectedCount: 0,
      candidates: [],
      actions: [],
      warnings: [],
    };
  }

  const { listeners } = parseTailscaleServeListeners(statusRes.stdout);
  const state = await loadTendState(paths);
  const nextStrikes = new Map<string, number>();
  const candidates: TendCandidate[] = [];
  const actions: TendActionOutcome[] = [];

  for (const listener of listeners) {
    if (listener.externalPort === IMMUNE_TAILSCALE_PORT) {
      continue;
    }
    const strikeKey = `${listener.protocol}:${String(listener.externalPort)}`;
    const matched = matchingTailscaleLeases(listener, options.leases);
    const reason = await evaluateListenerDisableReason({
      listener,
      strikeKey,
      matched,
      priorStrikes: state.tailscaleStrikes,
      nextStrikes,
      probePort,
      immediateProxies: options.immediateProxies === true,
    });
    if (reason === null) {
      continue;
    }

    const candidate: TendCandidate = {
      id: `tailscale-serve:${strikeKey}`,
      surface: "tailscale-serve",
      kind: `tailscale-${listener.protocol}`,
      target: `${listener.protocol}:${String(listener.externalPort)} -> ${listener.rawTarget}`,
      reason,
      metadata: {
        port: listener.externalPort,
        targetPort: listener.targetPort,
        protocol: listener.protocol,
      },
    };
    candidates.push(candidate);

    if (!options.apply) {
      actions.push({ candidate, status: "planned" });
      continue;
    }

    actions.push(
      await disableTailscaleListener({
        listener,
        candidate,
        strikeKey,
        staleLeases: matched.stale,
        nextStrikes,
        paths,
        runner,
      }),
    );
  }

  if (persistState) {
    await saveTendState(paths, {
      version: 1,
      tailscaleStrikes: Object.fromEntries(nextStrikes),
    });
  }

  return {
    surface: "tailscale-serve",
    inspectedCount: listeners.length,
    candidates,
    actions,
    warnings: [],
  };
}
