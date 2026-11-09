import { mkdtemp } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { protectArgoTokenDefault } from "./argocd-options.ts";
import { isArgoHelpCommand } from "./argocd-metadata.ts";

export const PASSTHROUGH_COMMANDS = [
  "gh",
  "woodpecker",
  "git-spice",
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

/** Expose a brokered credential to the vendor CLI under its own spelling. */
type CredentialEnvironment = {
  /** The variable the vendor binary reads. */
  readonly name: string;
  /** The registered credential that supplies it. */
  readonly from: string;
};

export type PassthroughSpec = {
  readonly executable: string;
  readonly prefixArgs?: readonly string[] | undefined;
  readonly defaultArgs?: readonly DefaultArgument[] | undefined;
  readonly defaultEnvironment?: readonly DefaultEnvironment[] | undefined;
  readonly credentialEnvironment?: readonly CredentialEnvironment[] | undefined;
};

export type PassthroughInvocation = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: Record<string, string | undefined>;
};

/**
 * gcx reads its server and token from these runtime overrides, so no context
 * or token is ever written to its config file or Keychain entry. An explicit
 * `--context` or ambient value still wins.
 */
const HOMELAB_GCX_ENVIRONMENT: readonly DefaultEnvironment[] = [
  {
    name: "GRAFANA_SERVER",
    value: "https://grafana.tailnet-1a49.ts.net",
    overrideFlags: ["--context"],
  },
  { name: "GRAFANA_ORG_ID", value: "1", overrideFlags: ["--context"] },
];

const HOMELAB_GCX_CREDENTIALS: readonly CredentialEnvironment[] = [
  { name: "GRAFANA_TOKEN", from: "GRAFANA_API_KEY" },
];

function gcxSpec(prefixArgs?: readonly string[]): PassthroughSpec {
  return {
    executable: "gcx",
    prefixArgs,
    defaultEnvironment: HOMELAB_GCX_ENVIRONMENT,
    credentialEnvironment: HOMELAB_GCX_CREDENTIALS,
  };
}

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
      "posthog",
      {
        executable: "posthog-cli",
        defaultEnvironment: [
          { name: "POSTHOG_CLI_PROJECT_ID", value: "549883" },
        ],
      },
    ],
    ["grafana", gcxSpec()],
    ["prom", gcxSpec(["metrics"])],
    ["loki", gcxSpec(["logs"])],
    ["tempo", gcxSpec(["traces"])],
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

/**
 * Help renders every token it was given, including a token passed as a flag
 * or read back from the config file that flag selected. Drop both before the
 * payload boundary. Tokens after `--` are positional and are left untouched.
 */
function withoutHelpCredentials(args: readonly string[]): string[] {
  const boundary = args.indexOf("--");
  const head = boundary === -1 ? args : args.slice(0, boundary);
  const tail = boundary === -1 ? [] : args.slice(boundary);
  const kept: string[] = [];
  for (let index = 0; index < head.length; index += 1) {
    const argument = head[index];
    if (argument === undefined) continue;
    if (argument === "--auth-token" || argument === "--config") {
      index += 1;
      continue;
    }
    if (
      argument.startsWith("--auth-token=") ||
      argument.startsWith("--config=")
    ) {
      continue;
    }
    kept.push(argument);
  }
  return [...kept, ...tail];
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

  const help = command === "argocd" && isArgoHelpCommand(args);
  const forwardedArgs = help ? withoutHelpCredentials(args) : args;
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
  // The 1Password service-account token unlocks every brokered credential;
  // no vendor CLI needs it, so no passthrough child inherits it.
  delete env["OP_SERVICE_ACCOUNT_TOKEN"];
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
  for (const entry of spec.credentialEnvironment ?? []) {
    const value = env[entry.from];
    if (value !== undefined && !hasEnvironmentValue(env, entry.name)) {
      env[entry.name] = value;
    }
  }

  return {
    executable: spec.executable,
    args: [...defaultArgs, ...(spec.prefixArgs ?? []), ...forwardedArgs],
    env,
  };
}

/** Where chezmoi installs the plain-name shims that call back into toolkit. */
export function shimDirectory(home: string = os.homedir()): string {
  return path.join(home, ".local", "share", "toolkit", "shims");
}

/**
 * The PATH toolkit searches for a real vendor binary. It drops the shim
 * directory (a shim would call toolkit again), relative entries, and
 * `node_modules` bin directories that `bun run` and turbo prepend: a
 * dependency's same-named bin must never receive brokered credentials.
 */
export function trustedSearchPath(
  pathValue: string,
  home: string = os.homedir(),
): string {
  const shims = shimDirectory(home);
  return pathValue
    .split(path.delimiter)
    .filter(
      (entry) =>
        path.isAbsolute(entry) &&
        path.resolve(entry) !== shims &&
        !entry.split(path.sep).includes("node_modules"),
    )
    .join(path.delimiter);
}

export function lookupExecutable(
  executable: string,
  pathValue: string | undefined,
): string | null {
  const searchPath = trustedSearchPath(pathValue ?? Bun.env["PATH"] ?? "");
  // An empty cwd keeps Bun.which from resolving relative to the caller.
  return Bun.which(executable, { cwd: "/", PATH: searchPath });
}

function resolveExecutable(invocation: PassthroughInvocation): string | null {
  return lookupExecutable(invocation.executable, invocation.env["PATH"]);
}

/**
 * Created in-process: the forwarded PATH belongs to the caller and need not
 * contain coreutils.
 */
function isolatedConfigHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "toolkit-argocd-help-"));
}

async function nativeEnvironment(invocation: PassthroughInvocation) {
  const env = { ...invocation.env };
  if (invocation.executable !== "argocd") return env;
  const options = env["ARGOCD_OPTS"] ?? "";
  // ArgoCD's flag default and API client independently read the token. An
  // empty flag default prevents help/usage disclosure while the API client
  // still reads ARGOCD_AUTH_TOKEN; explicit CLI flags retain precedence.
  env["ARGOCD_OPTS"] = protectArgoTokenDefault(options);
  // Help also prints credentials stored in the user's ArgoCD config. On
  // Darwin that file is under $HOME/Library; elsewhere os.UserConfigDir
  // follows XDG_CONFIG_HOME, and the legacy path is $HOME/.argocd. An empty
  // home hides all three. Operational commands keep the real home and token.
  if (isArgoHelpCommand(invocation.args)) {
    const isolated = await isolatedConfigHome();
    env["HOME"] = isolated;
    env["XDG_CONFIG_HOME"] = isolated;
  }
  return env;
}

export async function runPassthrough(
  invocation: PassthroughInvocation,
): Promise<number> {
  const executable = resolveExecutable(invocation);
  if (executable === null) {
    console.error(
      `toolkit: required executable not found: ${invocation.executable}`,
    );
    return 127;
  }

  // Windows has no execve; inherited console handles deliver console signals
  // to the child, and the CLI exits with the child's status.
  if (process.platform === "win32") {
    return spawnPassthroughInvocation(invocation);
  }

  if (process.execve === undefined) {
    throw new Error(
      "toolkit: process replacement is unavailable on this platform",
    );
  }
  return process.execve(
    executable,
    [invocation.executable, ...invocation.args],
    await nativeEnvironment(invocation),
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
  options: { stdoutToStderr?: boolean } = {},
): Promise<number> {
  const executable = resolveExecutable(invocation);
  if (executable === null) {
    throw new Error(
      `toolkit: required executable not found: ${invocation.executable}`,
    );
  }
  const child = Bun.spawn([executable, ...invocation.args], {
    env: await nativeEnvironment(invocation),
    // A caller that reserves stdout for its own report streams the child's
    // stdout to stderr instead.
    stdio: [
      "inherit",
      options.stdoutToStderr === true ? 2 : "inherit",
      "inherit",
    ],
  });
  return child.exited;
}
