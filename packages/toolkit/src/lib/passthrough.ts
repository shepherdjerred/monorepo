import { protectArgoTokenDefault } from "./argocd-options.ts";

export const PASSTHROUGH_COMMANDS = [
  "gh",
  "woodpecker",
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
    // WOODPECKER_TOKEN stays operator-provided, but the server address is not
    // a secret and is the same every time. Defaulting it also disarms a real
    // trap: upstream uses WOODPECKER_SERVER for the AGENT's gRPC endpoint and
    // for the CLI's HTTP address, so an environment carrying the gRPC value
    // for the agent would silently point the CLI at the wrong port. This
    // repository keeps the HTTP origin under WOODPECKER_URL and hands the CLI
    // its own value here.
    [
      "woodpecker",
      {
        executable: "woodpecker-cli",
        defaultEnvironment: [
          {
            name: "WOODPECKER_SERVER",
            value: "https://woodpecker.sjer.red",
            overrideFlags: ["--server"],
          },
        ],
      },
    ],
    ["git-spice", { executable: "git-spice" }],
    [
      "linear",
      {
        executable: "linear",
        defaultArgs: [
          {
            args: ["--workspace", "sjerred"],
            overrideFlags: ["--workspace"],
            overrideEnvironment: ["LINEAR_API_KEY"],
          },
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

// ArgoCD root options without a required value. Other root options consume
// one value (or use --option=value); -H is its value-taking short option.
const ARGOCD_BOOLEAN_OPTIONS = new Set([
  "--core",
  "--grpc-web",
  "--insecure",
  "--plaintext",
  "--port-forward",
  "--prompts-enabled",
]);

function isArgoHelpFlag(argument: string | undefined): boolean {
  return (
    argument !== undefined &&
    /^(?:--help|-h)(?:=(?:[1tT]|true|TRUE|True))?$/u.test(argument)
  );
}

function isArgoHelpCommand(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) return false;
    // Once Cobra selects `help`, its operands and flags are local metadata.
    if (argument === "--") return args[index + 1] === "help";
    if (!argument.startsWith("-")) {
      const commandPath = args.slice(index);
      return (
        argument === "help" ||
        (isArgoHelpFlag(commandPath.at(-1)) &&
          commandPath
            .slice(0, -1)
            .every((part) => /^[a-z][a-z0-9-]*$/u.test(part)))
      );
    }
    if (isArgoHelpFlag(argument)) return true;
    if (argument.includes("=") || ARGOCD_BOOLEAN_OPTIONS.has(argument))
      continue;
    if (argument.startsWith("-H") && argument.length > 2) continue;
    // Do not mistake an option value such as --server help for a command.
    index += 1;
  }
  return false;
}

/** Exact native metadata invocations that never need brokered credentials. */
export function isCredentialFreePassthrough(
  command: string,
  args: readonly string[],
): boolean {
  if (!PASSTHROUGH_REGISTRY.has(command)) {
    return false;
  }
  // ArgoCD's help command is local regardless of its operands. Help flags on
  // bare command paths are also local; operational payloads retain credentials.
  if (command === "argocd" && isArgoHelpCommand(args)) return true;
  // Inspect the entire invocation: flags in a command payload or after `--`
  // must not turn an operational command into a credential-free dispatch.
  if (args.length === 1) {
    return args[0] === "--help" || args[0] === "-h" || args[0] === "--version";
  }
  // Plain `argocd version` contacts the server; only this client-only form
  // can bypass credential resolution.
  return (
    command === "argocd" &&
    args.length === 2 &&
    args[0] === "version" &&
    args[1] === "--client"
  );
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
  // ArgoCD prints this environment default in native help. Client-only
  // metadata must not inherit a token even when the caller already has one.
  if (command === "argocd" && isCredentialFreePassthrough(command, args)) {
    delete env["ARGOCD_AUTH_TOKEN"];
  }
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

function lookupExecutable(
  executable: string,
  pathValue: string | undefined,
): string | null {
  const options =
    pathValue === undefined
      ? { cwd: process.cwd() }
      : { cwd: process.cwd(), PATH: pathValue };
  return Bun.which(executable, options);
}

function resolveExecutable(invocation: PassthroughInvocation): string | null {
  return lookupExecutable(invocation.executable, invocation.env["PATH"]);
}

function nativeEnvironment(invocation: PassthroughInvocation) {
  const env = { ...invocation.env };
  if (invocation.executable !== "argocd") return env;
  const options = env["ARGOCD_OPTS"] ?? "";
  // ArgoCD's flag default and API client independently read the token. An
  // empty flag default prevents help/usage disclosure while the API client
  // still reads ARGOCD_AUTH_TOKEN; explicit CLI flags retain precedence.
  env["ARGOCD_OPTS"] = protectArgoTokenDefault(options);
  return env;
}

export function runPassthrough(
  invocation: PassthroughInvocation,
): Promise<number> {
  const executable = resolveExecutable(invocation);
  if (executable === null) {
    console.error(
      `toolkit: required executable not found: ${invocation.executable}`,
    );
    return Promise.resolve(127);
  }

  return process.execve === undefined
    ? Promise.reject(
        new Error(
          "toolkit: process replacement is unavailable on this platform",
        ),
      )
    : process.execve(
        executable,
        [invocation.executable, ...invocation.args],
        nativeEnvironment(invocation),
      );
}

/**
 * Run a passthrough child in place without replacing this process.
 *
 * Unlike {@link runPassthrough} (execve, for CLI dispatch), this awaits exit
 * so library callers can react to the code. Both paths keep ArgoCD's token
 * out of its help defaults while preserving native streams.
 */
export async function spawnPassthroughInvocation(
  invocation: PassthroughInvocation,
): Promise<number> {
  const executable = resolveExecutable(invocation);
  if (executable === null) {
    throw new Error(
      `toolkit: required executable not found: ${invocation.executable}`,
    );
  }
  const child = Bun.spawn([executable, ...invocation.args], {
    env: nativeEnvironment(invocation),
    stdio: ["inherit", "inherit", "inherit"],
  });
  return child.exited;
}
