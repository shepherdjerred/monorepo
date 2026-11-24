import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { parseArgs } from "node:util";
import { z } from "zod";

export const DOCKER_PREFLIGHT_TIMEOUT_MS = 5000;
export const DEFAULT_OFFLINE_TIMEOUT_MS = 120_000;
export const DEFAULT_LIVE_TIMEOUT_MS = 300_000;

const DOCKER_SOCKET_REMEDIATION =
  "Verify that Docker / OrbStack is running and its socket (for example ~/.orbstack/run/docker.sock) responds to `docker info`.";

function resolveCommandExecutable(
  command: readonly string[],
  env: Record<string, string | undefined>,
): string[] {
  const [first = "docker", ...rest] = command;
  const resolved = Bun.which(first, { PATH: env["PATH"] ?? "" }) ?? first;
  return [resolved, ...rest];
}

async function terminateSubprocess(
  subprocess: ReturnType<typeof Bun.spawn>,
): Promise<void> {
  try {
    subprocess.kill("SIGTERM");
  } catch {
    return;
  }
  const exitedOnTerm = await Promise.race([
    subprocess.exited.then(() => true),
    Bun.sleep(250).then(() => false),
  ]);
  if (exitedOnTerm) {
    return;
  }
  try {
    subprocess.kill("SIGKILL");
  } catch {
    return;
  }
  await Promise.race([subprocess.exited, Bun.sleep(500)]);
}

export async function preflightDockerDaemon(options?: {
  command?: readonly string[];
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}): Promise<string> {
  const env = options?.env ?? Bun.env;
  const command = resolveCommandExecutable(
    options?.command ?? ["docker", "info", "--format", "{{.ServerVersion}}"],
    env,
  );
  const timeoutMs = options?.timeoutMs ?? DOCKER_PREFLIGHT_TIMEOUT_MS;
  const subprocess = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]).then(([stdout, stderr, exitCode]) => ({
      kind: "exited" as const,
      stdout,
      stderr,
      exitCode,
    })),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        resolve({ kind: "timeout" });
      }, timeoutMs);
      timer.unref();
    }),
  ]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }

  if (outcome.kind === "timeout") {
    await Promise.allSettled([
      subprocess.stdout.cancel(),
      subprocess.stderr.cancel(),
      terminateSubprocess(subprocess),
    ]);
    throw new Error(
      `Docker preflight timed out after ${String(timeoutMs)}ms (\`docker info --format '{{.ServerVersion}}'\`). ${DOCKER_SOCKET_REMEDIATION}`,
    );
  }

  if (outcome.exitCode !== 0 || outcome.stdout.trim().length === 0) {
    const detail = outcome.stderr.trim() || "empty ServerVersion output";
    throw new Error(
      `Docker preflight failed (exit ${String(outcome.exitCode)}): ${detail}. ${DOCKER_SOCKET_REMEDIATION}`,
    );
  }

  return outcome.stdout.trim();
}

export async function runBoundedDockerCommand(options: {
  command: readonly string[];
  env: Record<string, string | undefined>;
  timeoutMs: number;
  stdio?: "inherit" | "pipe";
}): Promise<number> {
  const stdio = options.stdio ?? "inherit";
  const command = resolveCommandExecutable(options.command, options.env);
  const subprocess = Bun.spawn(command, {
    stdin: "ignore",
    stdout: stdio,
    stderr: stdio,
    env: options.env,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    subprocess.exited.then((exitCode) => ({
      kind: "exited" as const,
      exitCode,
    })),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        resolve({ kind: "timeout" });
      }, options.timeoutMs);
      timer.unref();
    }),
  ]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }

  if (outcome.kind === "timeout") {
    await terminateSubprocess(subprocess);
    throw new Error(
      `Bazarr provider container timed out after ${String(options.timeoutMs)}ms (override with --timeout-ms). ${DOCKER_SOCKET_REMEDIATION}`,
    );
  }

  return outcome.exitCode;
}

export type ParsedBazarrInvocation = {
  live: boolean;
  timeoutMs: number;
  liveArguments: string[];
  liveEnvironment: Record<string, string>;
};

const LiveFlagsSchema = z.object({
  "browser-url": z.url(),
  "browser-config": z.string().min(1),
  release: z.string().min(1),
  series: z.string().min(1),
  season: z.coerce.number().int().min(0),
  episode: z.coerce.number().int().min(1),
  runs: z.coerce.number().int().min(2).max(5),
});

async function resolvePinchTabToken(
  browserConfigPath: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  const fromEnv = env["PINCHTAB_TOKEN"];
  if (fromEnv !== undefined) {
    if (fromEnv.length === 0) {
      throw new Error("PinchTab bootstrap token is empty");
    }
    return fromEnv;
  }
  let configData: unknown;
  try {
    configData = await Bun.file(browserConfigPath).json();
  } catch {
    throw new Error("PinchTab bootstrap config could not be read");
  }
  const config = z
    .object({ server: z.object({ token: z.string().min(1) }) })
    .safeParse(configData);
  if (!config.success) {
    throw new Error("PinchTab bootstrap config is invalid");
  }
  return config.data.server.token;
}

async function buildLiveInvocation(
  values: Record<string, unknown>,
  restartBrowser: boolean,
  env: Record<string, string | undefined>,
): Promise<{
  liveArguments: string[];
  liveEnvironment: Record<string, string>;
}> {
  const input = LiveFlagsSchema.parse(values);
  const browserToken = await resolvePinchTabToken(input["browser-config"], env);
  const liveEnvironment: Record<string, string> = {
    SUBHD_PINCHTAB_TOKEN: browserToken,
    SUBHD_PINCHTAB_URL: input["browser-url"],
    SUBHD_PINCHTAB_PROFILE: "subtitle-provider-smoke",
  };
  const liveArguments: string[] = restartBrowser ? ["--restart-browser"] : [];
  for (const name of [
    "release",
    "series",
    "season",
    "episode",
    "runs",
  ] as const) {
    liveArguments.push(`--${name}`, String(input[name]));
  }
  return { liveArguments, liveEnvironment };
}

export async function parseBazarrProviderArgs(
  rawArgs: readonly string[],
  env: Record<string, string | undefined> = Bun.env,
): Promise<ParsedBazarrInvocation> {
  const { values, positionals } = parseArgs({
    args: [...rawArgs],
    allowPositionals: true,
    options: {
      live: { type: "boolean", default: false },
      "timeout-ms": { type: "string" },
      "browser-url": { type: "string" },
      "browser-config": { type: "string" },
      release: { type: "string" },
      series: { type: "string" },
      season: { type: "string" },
      episode: { type: "string" },
      runs: { type: "string", default: "2" },
      "restart-browser": { type: "boolean", default: false },
    },
  });
  if (positionals.length > 0) {
    throw new Error("Unexpected positional arguments");
  }

  const defaultTimeout = values.live
    ? DEFAULT_LIVE_TIMEOUT_MS
    : DEFAULT_OFFLINE_TIMEOUT_MS;
  const timeoutMs =
    values["timeout-ms"] === undefined
      ? defaultTimeout
      : z.coerce.number().int().positive().parse(values["timeout-ms"]);

  if (!values.live) {
    return {
      live: false,
      timeoutMs,
      liveArguments: [],
      liveEnvironment: {},
    };
  }

  const { liveArguments, liveEnvironment } = await buildLiveInvocation(
    values,
    values["restart-browser"],
    env,
  );
  return {
    live: true,
    timeoutMs,
    liveArguments,
    liveEnvironment,
  };
}

export async function runBazarrProviders(
  rawArgs: readonly string[],
  options?: {
    env?: Record<string, string | undefined>;
    preflightTimeoutMs?: number;
    stdio?: "inherit" | "pipe";
  },
): Promise<number> {
  const env = options?.env ?? Bun.env;
  const parsed = await parseBazarrProviderArgs(rawArgs, env);
  await preflightDockerDaemon({
    env,
    ...(options?.preflightTimeoutMs === undefined
      ? {}
      : { timeoutMs: options.preflightTimeoutMs }),
  });

  const directory = new URL("../config/bazarr/", import.meta.url).pathname;
  const providerDirectory =
    "/app/bazarr/bin/custom_libs/subliminal_patch/providers";

  return runBoundedDockerCommand({
    command: [
      "docker",
      "run",
      "--rm",
      ...(parsed.live
        ? [
            "-e",
            "SUBHD_PINCHTAB_TOKEN",
            "-e",
            "SUBHD_PINCHTAB_URL",
            "-e",
            "SUBHD_PINCHTAB_PROFILE",
          ]
        : ["--network", "none"]),
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--entrypoint",
      "python3",
      "-e",
      "PYTHONDONTWRITEBYTECODE=1",
      "-e",
      "PYTHONPATH=/app/bazarr/bin/custom_libs:/app/bazarr/bin/libs:/app/bazarr/bin",
      "-v",
      `${directory}:/fixtures:ro`,
      "-v",
      `${directory}subhd.py:${providerDirectory}/subhd.py:ro`,
      "-v",
      `${directory}zimuku.py:${providerDirectory}/zimuku.py:ro`,
      "-v",
      `${directory}chinese_script.py:${providerDirectory}/chinese_script.py:ro`,
      "-v",
      `${directory}assrt.py:${providerDirectory}/assrt.py:ro`,
      `ghcr.io/linuxserver/bazarr:${versions["linuxserver/bazarr"]}`,
      parsed.live ? "/fixtures/smoke.py" : "/fixtures/test_subhd.py",
      ...parsed.liveArguments,
    ],
    env: { ...env, ...parsed.liveEnvironment },
    timeoutMs: parsed.timeoutMs,
    ...(options?.stdio === undefined ? {} : { stdio: options.stdio }),
  });
}

if (import.meta.main) {
  process.exit(await runBazarrProviders(Bun.argv.slice(2)));
}
