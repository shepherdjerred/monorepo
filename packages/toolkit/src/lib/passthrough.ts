export const PASSTHROUGH_COMMANDS = [
  "gh",
  "bk",
  "git-spice",
  "linear",
  "posthog",
  "grafana",
  "prom",
  "loki",
  "tempo",
  "temporal",
  "argocd",
  "cf",
  "tailscale",
] as const;

type DefaultArgument = {
  readonly args: readonly string[];
  readonly overrideFlags: readonly string[];
  readonly overrideEnvironment?: readonly string[] | undefined;
  readonly skipWhenFirstArgumentIs?: readonly string[] | undefined;
};

type DefaultEnvironment = {
  readonly name: string;
  readonly value: string;
  readonly overrideFlags?: readonly string[] | undefined;
};

export type PassthroughSpec = {
  readonly executable: string;
  readonly prefixArgs?: readonly string[] | undefined;
  readonly defaultArgs?: readonly DefaultArgument[] | undefined;
  readonly defaultEnvironment?: readonly DefaultEnvironment[] | undefined;
};

export type PassthroughInvocation = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: Record<string, string | undefined>;
};

const HOMELAB_GCX_DEFAULT: DefaultArgument = {
  args: ["--context", "homelab"],
  overrideFlags: ["--context"],
};

export const PASSTHROUGH_REGISTRY: ReadonlyMap<string, PassthroughSpec> =
  new Map([
    [
      "gh",
      {
        executable: "gh",
        defaultEnvironment: [
          {
            name: "GH_REPO",
            value: "shepherdjerred/monorepo",
            overrideFlags: ["--repo", "-R"],
          },
        ],
      },
    ],
    [
      "bk",
      {
        executable: "bk",
        defaultEnvironment: [
          { name: "BUILDKITE_ORGANIZATION_SLUG", value: "sjerred" },
        ],
      },
    ],
    ["git-spice", { executable: "git-spice" }],
    [
      "linear",
      {
        executable: "linear",
        defaultArgs: [
          { args: ["--workspace", "sjerred"], overrideFlags: ["--workspace"] },
        ],
      },
    ],
    [
      "posthog",
      {
        executable: "posthog-cli",
        defaultEnvironment: [
          { name: "POSTHOG_CLI_PROJECT_ID", value: "549883" },
        ],
      },
    ],
    ["grafana", { executable: "gcx", defaultArgs: [HOMELAB_GCX_DEFAULT] }],
    [
      "prom",
      {
        executable: "gcx",
        prefixArgs: ["metrics"],
        defaultArgs: [HOMELAB_GCX_DEFAULT],
      },
    ],
    [
      "loki",
      {
        executable: "gcx",
        prefixArgs: ["logs"],
        defaultArgs: [HOMELAB_GCX_DEFAULT],
      },
    ],
    [
      "tempo",
      {
        executable: "gcx",
        prefixArgs: ["traces"],
        defaultArgs: [HOMELAB_GCX_DEFAULT],
      },
    ],
    [
      "temporal",
      {
        executable: "temporal",
        defaultArgs: [
          {
            args: ["--profile", "homelab"],
            overrideFlags: ["--profile"],
            overrideEnvironment: ["TEMPORAL_ADDRESS"],
            skipWhenFirstArgumentIs: ["--help", "-h", "--version", "-v"],
          },
        ],
      },
    ],
    [
      "argocd",
      {
        executable: "argocd",
        defaultArgs: [{ args: ["--grpc-web"], overrideFlags: ["--grpc-web"] }],
        defaultEnvironment: [
          {
            name: "ARGOCD_SERVER",
            value: "argocd.tailnet-1a49.ts.net",
            overrideFlags: ["--server"],
          },
        ],
      },
    ],
    ["cf", { executable: "cf" }],
    ["tailscale", { executable: "tailscale" }],
  ]);

function argsBeforeBoundary(args: readonly string[]): readonly string[] {
  const boundary = args.indexOf("--");
  return boundary === -1 ? args : args.slice(0, boundary);
}

function hasFlag(args: readonly string[], flags: readonly string[]): boolean {
  const candidates = argsBeforeBoundary(args);
  return flags.some((flag) =>
    candidates.some(
      (arg) =>
        arg === flag ||
        arg.startsWith(`${flag}=`) ||
        (flag.startsWith("-") &&
          !flag.startsWith("--") &&
          flag.length === 2 &&
          arg.startsWith(flag) &&
          arg.length > flag.length),
    ),
  );
}

function hasEnvironmentValue(
  env: Record<string, string | undefined>,
  name: string,
): boolean {
  const value = env[name];
  return value !== undefined && value.length > 0;
}

export function buildPassthroughInvocation(
  command: string,
  args: readonly string[],
  environment: Record<string, string | undefined>,
): PassthroughInvocation | null {
  const spec = PASSTHROUGH_REGISTRY.get(command);
  if (spec === undefined) {
    return null;
  }

  const defaultArgs = (spec.defaultArgs ?? []).flatMap((entry) => {
    const overriddenByEnvironment = (entry.overrideEnvironment ?? []).some(
      (name) => hasEnvironmentValue(environment, name),
    );
    const skippedForRootFlag =
      args[0] !== undefined &&
      (entry.skipWhenFirstArgumentIs ?? []).includes(args[0]);
    return overriddenByEnvironment ||
      skippedForRootFlag ||
      hasFlag(args, entry.overrideFlags)
      ? []
      : entry.args;
  });
  const env = { ...environment };
  for (const entry of spec.defaultEnvironment ?? []) {
    const overriddenByFlag =
      entry.overrideFlags !== undefined && hasFlag(args, entry.overrideFlags);
    if (!overriddenByFlag && !hasEnvironmentValue(env, entry.name)) {
      env[entry.name] = entry.value;
    }
  }

  return {
    executable: spec.executable,
    args: [...defaultArgs, ...(spec.prefixArgs ?? []), ...args],
    env,
  };
}

function isMissingExecutableError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("Executable not found")
  );
}

export async function runPassthrough(
  invocation: PassthroughInvocation,
): Promise<number> {
  try {
    const child = Bun.spawn([invocation.executable, ...invocation.args], {
      cwd: process.cwd(),
      env: invocation.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const forwardedSignals = ["SIGHUP", "SIGINT", "SIGTERM"] as const;
    let receivedSignal: NodeJS.Signals | null = null;
    const handlers = new Map<NodeJS.Signals, () => void>();
    for (const signal of forwardedSignals) {
      const handler = (): void => {
        receivedSignal = signal;
        child.kill(signal);
      };
      handlers.set(signal, handler);
      process.once(signal, handler);
    }

    let exitCode: number;
    try {
      exitCode = await child.exited;
    } finally {
      for (const [signal, handler] of handlers) {
        process.off(signal, handler);
      }
    }
    const terminationSignal = child.signalCode ?? receivedSignal;
    if (terminationSignal !== null) {
      process.kill(process.pid, terminationSignal);
    }
    return exitCode;
  } catch (error) {
    if (isMissingExecutableError(error)) {
      console.error(
        `toolkit: required executable not found: ${invocation.executable}`,
      );
      return 127;
    }
    throw error;
  }
}
