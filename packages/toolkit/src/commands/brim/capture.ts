import { mkdir, chmod, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { allCaptureHosts, CAPTURE_CLIS } from "#lib/brim/capture/clis.ts";
import { captureCaStatus, ensureCaptureCa } from "#lib/brim/capture/ca.ts";
import {
  MITMPROXY_VERSION,
  mitmdumpArgv,
  proxyListening,
  writeAddon,
} from "#lib/brim/capture/engine.ts";
import { captureEnvironment, renderExports } from "#lib/brim/capture/env.ts";
import {
  defaultBrimCapturePaths,
  type BrimCapturePaths,
} from "#lib/brim/capture/paths.ts";
import {
  loadBrimCaptureSettings,
  type BrimCaptureSettings,
} from "#lib/brim/capture/settings.ts";
import {
  redactCaptures,
  type CaptureRedactReport,
} from "#lib/history/captures/redact.ts";
import { CaptureStore } from "#lib/history/captures/store.ts";
import { defaultHistoryRuntimePaths } from "#lib/history/paths.ts";
import {
  HOMEBREW_JOB_PATH,
  assertDarwin,
  installLaunchAgentJob,
  launchAgentJobStatus,
  selfArgv,
  uninstallLaunchAgentJob,
  type LaunchAgentSpec,
} from "#lib/launchd.ts";

export const CAPTURE_USAGE = `
brim capture — record the raw API requests coding-agent CLIs send

  brim capture install | uninstall    Manage the always-on proxy LaunchAgent
  brim capture status [--json]        Settings, proxy, CA, spool and store state
  brim capture env <cli>              Shell exports that route <cli> through the
                                      proxy (what the agent wrappers eval)
  brim capture redact [--dry-run] [--json]
                                      Overwrite credentials in the spool and in
                                      ~/.toolkit/history/captures.sqlite
  brim capture run                    Run the proxy in the foreground

The proxy is a pinned mitmproxy (mitmdump ${MITMPROXY_VERSION}) on 127.0.0.1 that intercepts
only the CLIs' inference hosts with a local, name-constrained CA, records only
their inference requests, and never changes a request. The history daemon
ingests the spool, keeps brim.capture.retention.days days (default 30), and
serves it at GET /v1/captures.

env prints nothing when brim.capture.enabled is false or the CLI is not in
brim.capture.clis. When capture is on but the proxy is down it exits 1, so a
wrapper refuses to start an agent that would silently go uncaptured.
`;

const LAUNCH_AGENT_LABEL = "com.jerred.brim-capture";

export function captureLaunchAgent(
  paths: BrimCapturePaths,
  invocationPrefix: readonly string[],
): LaunchAgentSpec {
  return {
    label: LAUNCH_AGENT_LABEL,
    plistPath: paths.launchAgent,
    programArguments: selfArgv([...invocationPrefix, "capture", "run"]),
    logsDir: paths.logsDir,
    keepAlive: true,
    // uvx (Homebrew) runs the pinned mitmdump; openssl and security are in
    // /usr/bin.
    environment: { PATH: HOMEBREW_JOB_PATH },
  };
}

export type CaptureCommandContext = {
  readonly paths: BrimCapturePaths;
  readonly capturesDb: string;
  readonly loadSettings: () => Promise<BrimCaptureSettings>;
  readonly proxyUp: (port: number) => Promise<boolean>;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
};

export function defaultCaptureContext(): CaptureCommandContext {
  return {
    paths: defaultBrimCapturePaths(),
    capturesDb: defaultHistoryRuntimePaths().capturesDb,
    loadSettings: () => loadBrimCaptureSettings(),
    proxyUp: (port) => proxyListening(port),
    stdout: (line) => {
      console.log(line);
    },
    stderr: (line) => {
      console.error(line);
    },
  };
}

/** `brim capture env <cli>`: exit 0 with exports or nothing, else 1. */
export async function captureEnvCommand(
  context: CaptureCommandContext,
  name: string,
): Promise<number> {
  const settings = await context.loadSettings();
  if (!settings.enabled) return 0;
  const cli = settings.clis.find((entry) => entry.name === name);
  if (cli === undefined) return 0;
  const trustFile =
    cli.trust === "ssl-cert-file" ? context.paths.bundle : context.paths.caCert;
  if (!(await Bun.file(trustFile).exists())) {
    context.stderr(
      `brim capture: capture is on for ${name}, but ${trustFile} is missing. Run \`brim capture install\`, or turn brim.capture.enabled off.`,
    );
    return 1;
  }
  if (!(await context.proxyUp(settings.port))) {
    context.stderr(
      `brim capture: capture is on for ${name}, but no proxy is listening on 127.0.0.1:${String(settings.port)}. Start it with \`brim capture install\` (or \`brim capture run\`), or turn brim.capture.enabled off.`,
    );
    return 1;
  }
  context.stdout(
    renderExports(captureEnvironment(cli, context.paths, settings.port)),
  );
  return 0;
}

async function spoolState(
  spoolDir: string,
): Promise<{ segments: number; bytes: number }> {
  let names: string[];
  try {
    names = await readdir(spoolDir);
  } catch {
    return { segments: 0, bytes: 0 };
  }
  let bytes = 0;
  let segments = 0;
  for (const name of names) {
    if (!name.includes(".jsonl")) continue;
    segments += 1;
    const info = await stat(path.join(spoolDir, name));
    bytes += info.size;
  }
  return { segments, bytes };
}

const CountRowSchema = z.object({
  captures: z.number(),
  blobs: z.number(),
  bytes: z.number().nullable(),
});

async function storeState(
  capturesDb: string,
): Promise<{ captures: number; blobs: number; storedBytes: number } | null> {
  if (!(await Bun.file(capturesDb).exists())) return null;
  const store = await CaptureStore.open(capturesDb);
  try {
    const row = CountRowSchema.parse(
      store.get(
        "SELECT (SELECT COUNT(*) FROM captures) AS captures, (SELECT COUNT(*) FROM blobs) AS blobs, (SELECT SUM(LENGTH(data)) FROM blobs) AS bytes",
      ),
    );
    return {
      captures: row.captures,
      blobs: row.blobs,
      storedBytes: row.bytes ?? 0,
    };
  } finally {
    store.close();
  }
}

async function gatherStatus(
  context: CaptureCommandContext,
  agent: LaunchAgentSpec,
) {
  const settings = await context.loadSettings();
  return {
    enabled: settings.enabled,
    port: settings.port,
    retentionDays: settings.retentionDays,
    mitmproxyVersion: MITMPROXY_VERSION,
    proxyListening: await context.proxyUp(settings.port),
    clis: CAPTURE_CLIS.map((cli) => ({
      name: cli.name,
      status: cli.status,
      wrapped: settings.clis.some((entry) => entry.name === cli.name),
      hosts: [...new Set(cli.routes.map((route) => route.host))],
    })),
    ca: await captureCaStatus(context.paths, allCaptureHosts()),
    spool: await spoolState(context.paths.spoolDir),
    store: await storeState(context.capturesDb),
    launchAgent:
      process.platform === "darwin" ? await launchAgentJobStatus(agent) : null,
  };
}

function statusLines(
  status: Awaited<ReturnType<typeof gatherStatus>>,
  caCert: string,
): string[] {
  const { ca, store, launchAgent } = status;
  const caLine = ca.present
    ? `CA: ${caCert} (valid to ${ca.notAfter ?? "?"}${ca.current ? "" : "; regenerated on next start"})`
    : "CA: not generated yet (brim capture install)";
  const storeLine =
    store === null
      ? "Store: no captures yet"
      : `Store: ${String(store.captures)} captures, ${String(store.blobs)} blobs, ${String(store.storedBytes)} bytes compressed`;
  return [
    `Capture: ${status.enabled ? "enabled" : "disabled"} (port ${String(status.port)}, keep ${String(status.retentionDays)} days, mitmproxy ${status.mitmproxyVersion})`,
    `Proxy: ${status.proxyListening ? "listening" : "not listening"}`,
    ...status.clis.map(
      (cli) =>
        `  ${cli.wrapped ? "*" : " "} ${cli.name.padEnd(13)} ${cli.status.padEnd(11)} ${cli.hosts.join(", ")}`,
    ),
    caLine,
    `Spool: ${String(status.spool.segments)} segments, ${String(status.spool.bytes)} bytes awaiting ingest`,
    storeLine,
    ...(launchAgent === null
      ? []
      : [
          `LaunchAgent: ${launchAgent.installed ? "installed" : "not installed"} (${launchAgent.loaded ? "loaded" : "not loaded"})`,
        ]),
  ];
}

async function captureStatus(
  context: CaptureCommandContext,
  agent: LaunchAgentSpec,
  json: boolean,
): Promise<number> {
  const status = await gatherStatus(context, agent);
  if (json) {
    context.stdout(JSON.stringify(status, null, 2));
    return 0;
  }
  for (const line of statusLines(status, context.paths.caCert)) {
    context.stdout(line);
  }
  return 0;
}

export function formatRedactReport(report: CaptureRedactReport): string {
  const total = Object.values(report.totals).reduce(
    (sum, count) => sum + count,
    0,
  );
  const kinds = Object.entries(report.totals)
    .map(([kind, count]) => `${kind} ${String(count)}`)
    .join(", ");
  return `capture redact: scanned ${String(report.spoolFiles)} spool segments and ${String(report.blobs)} stored blobs; ${report.dryRun ? "would redact" : "redacted"} ${String(total)} secrets in ${String(report.redactedSpoolFiles)} segments and ${String(report.redactedBlobs)} blobs${total === 0 ? "" : ` (${kinds})`}`;
}

/** Redacts the spool and the store; shared with `brim sync redact`. */
export async function runCaptureRedact(
  paths: BrimCapturePaths,
  capturesDb: string,
  dryRun: boolean,
): Promise<CaptureRedactReport> {
  const store = (await Bun.file(capturesDb).exists())
    ? await CaptureStore.open(capturesDb)
    : null;
  try {
    return await redactCaptures({ store, spoolDir: paths.spoolDir, dryRun });
  } finally {
    store?.close();
  }
}

async function runProxy(context: CaptureCommandContext): Promise<number> {
  const settings = await context.loadSettings();
  const { paths } = context;
  const generated = await ensureCaptureCa({ paths, hosts: allCaptureHosts() });
  if (generated) {
    context.stderr(
      "brim capture: generated a new capture CA; restart agents started before now.",
    );
  }
  await writeAddon(paths);
  for (const dir of [paths.spoolDir, paths.logsDir]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  }
  const child = Bun.spawn(
    mitmdumpArgv({ paths, port: settings.port, clis: settings.clis }),
    {
      stdio: ["ignore", "inherit", "inherit"],
      // Keep Python from writing a world-readable __pycache__ next to the addon.
      env: { ...Bun.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  const forward = (signal: NodeJS.Signals) => () => {
    child.kill(signal);
  };
  process.on("SIGTERM", forward("SIGTERM"));
  process.on("SIGINT", forward("SIGINT"));
  return child.exited;
}

export async function handleCaptureCommand(
  args: string[],
  invocationPrefix: readonly string[] = [],
  context: CaptureCommandContext = defaultCaptureContext(),
): Promise<number> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const [action, ...extra] = parsed.positionals;
  if (parsed.values.help) {
    context.stdout(CAPTURE_USAGE);
    return 0;
  }
  if (action === undefined) {
    context.stderr(CAPTURE_USAGE);
    return 2;
  }
  const agent = captureLaunchAgent(context.paths, invocationPrefix);
  if (action === "env") {
    const [name, ...rest] = extra;
    if (name === undefined || rest.length > 0) {
      context.stderr("brim capture: usage: brim capture env <cli>");
      return 2;
    }
    return captureEnvCommand(context, name);
  }
  if (extra.length > 0) {
    context.stderr(`brim capture: unexpected arguments: ${extra.join(" ")}`);
    return 2;
  }
  switch (action) {
    case "status":
      return captureStatus(context, agent, parsed.values.json);
    case "redact": {
      const report = await runCaptureRedact(
        context.paths,
        context.capturesDb,
        parsed.values["dry-run"],
      );
      context.stdout(
        parsed.values.json
          ? JSON.stringify(report, null, 2)
          : formatRedactReport(report),
      );
      return 0;
    }
    case "run":
      return runProxy(context);
    case "install": {
      assertDarwin("brim capture install");
      const settings = await context.loadSettings();
      if (!settings.enabled) {
        context.stderr(
          "brim capture: brim.capture.enabled is false; set it in ~/.toolkit/config.toml first.",
        );
        return 1;
      }
      await ensureCaptureCa({ paths: context.paths, hosts: allCaptureHosts() });
      await installLaunchAgentJob(agent);
      context.stdout(
        `Brim capture LaunchAgent installed: ${context.paths.launchAgent} (127.0.0.1:${String(settings.port)}, ${settings.clis.map((cli) => cli.name).join(", ")})`,
      );
      return 0;
    }
    case "uninstall":
      assertDarwin("brim capture uninstall");
      await uninstallLaunchAgentJob(agent);
      context.stdout(
        `Brim capture LaunchAgent removed: ${context.paths.launchAgent}`,
      );
      return 0;
    default:
      context.stderr(`brim capture: unknown action "${action}"`);
      context.stderr(CAPTURE_USAGE);
      return 2;
  }
}
