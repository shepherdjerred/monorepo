import os from "node:os";
import { z } from "zod";
import { defaultToolkitConfigPath } from "#lib/toolkit-config.ts";

/**
 * Credential broker: resolves service secrets into `Bun.env` just in time.
 *
 * Order per variable: non-empty ambient env wins (CI/k8s), then the
 * `[credentials]` table in `~/.toolkit/config.toml` (`op://…` for the
 * 1Password service account, `keychain:<service>` for the macOS Keychain),
 * then the registry backend below. Values are only ever injected into child
 * process environments; the resolver logs names and backends, never values.
 */

export type CredentialSource =
  | { readonly kind: "keychain"; readonly service: string }
  | { readonly kind: "op"; readonly ref: string };

export type CredentialSpec = {
  readonly description: string;
  readonly source: CredentialSource;
};

const PRIVATE_VAULT_REF = "op://63lcesgoblzbpkdr4koye66rei";

export const CREDENTIAL_REGISTRY: Record<string, CredentialSpec> = {
  GRAFANA_API_KEY: {
    description: "Grafana API key",
    source: {
      kind: "op",
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/w5y6wldczvojkh3yxe5zadkpvi/password",
    },
  },
  LINEAR_API_KEY: {
    description: "Linear API key",
    source: {
      kind: "op",
      // eslint-disable-next-line no-secrets/no-secrets -- op:// vault/item locator, not a secret value
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/iixelnobjabehkgxhl3ekacdy4/Section_2asirbjrrxc5apqr4s7qqfm4f4/puqwftbxah4ys746ahp6jjrxpq",
    },
  },
  POSTHOG_CLI_API_KEY: {
    description: "PostHog CLI API key",
    source: {
      kind: "op",
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/yh3xvqemmr4ic2up5zluo2rkcq/m7vvkd6ymu6pqk32zm7kqfynve",
    },
  },
  CF_API_TOKEN: {
    description: "Cloudflare API token",
    source: {
      kind: "op",
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/vp4l6tpe2cly6q4w5aremgvnbe/credential",
    },
  },
  ARGOCD_AUTH_TOKEN: {
    description: "ArgoCD auth token",
    source: {
      kind: "op",
      // eslint-disable-next-line no-secrets/no-secrets -- op:// vault/item locator, not a secret value
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/yikdwue26c7gdbk5ftbvaclkli/ARGOCD_AUTH_TOKEN",
    },
  },
  DISCORD_USER_TOKEN: {
    description: "Discord user token",
    source: {
      kind: "keychain",
      service: "monorepo-workstation-discord-user-token",
    },
  },
  DISCORD_BOT_TOKEN: {
    description: "Discord bot token",
    source: {
      kind: "keychain",
      service: "monorepo-workstation-discord-bot-token",
    },
  },
  BUGSINK_TOKEN: {
    description: "Bugsink API token",
    source: {
      kind: "keychain",
      service: "monorepo-workstation-bugsink-token",
    },
  },
  WOODPECKER_TOKEN: {
    description: "Woodpecker CI API token",
    source: {
      kind: "op",
      // eslint-disable-next-line no-secrets/no-secrets -- op:// vault/item locator, not a secret value
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/covttsojandjk7fx62a3dbk7em/WOODPECKER_API_TOKEN",
    },
  },
  TEMPORAL_API_KEY: {
    description: "Temporal external API key",
    source: {
      kind: "op",
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/2x4fpii5zq4jbw3l2p2qkvjtiy/api-token",
    },
  },
};

export const TEMPORAL_IN_CLUSTER_ADDRESS =
  "temporal-temporal-server-service:7233";

/** Desktop-auth refs used only to spell the Keychain enrollment command. */
const KEYCHAIN_ENROLL_REFS: Record<string, string> = {
  "monorepo-workstation-discord-user-token": `${PRIVATE_VAULT_REF}/sskm6skq3mwnyqnhrmqwji6dne/TOKEN`,
  "monorepo-workstation-discord-bot-token": `${PRIVATE_VAULT_REF}/ytv272dyktkeipt347f2yf5kue/BOT_TOKEN`,
  "monorepo-workstation-bugsink-token":
    // eslint-disable-next-line no-secrets/no-secrets -- op:// vault/item locator, not a secret value
    "op://v64ocnykdqju4ui6j6pua56xw4/jeuqmwh3r4nwu2ivo4pa3gr7om/BUGSINK_TOKEN",
};

const SERVICE_ACCOUNT_KEYCHAIN_SERVICE =
  "monorepo-homelab-1password-service-account";

/** Subprocess seam: argv in, exit plus captured streams out. */
export type CredentialRun = (
  argv: string[],
) => Promise<{ exit: number; stdout: string; stderr: string }>;

export type CredentialDeps = {
  /** Subprocess seam; defaults to a Bun.spawn runner. */
  readonly run?: CredentialRun;
  /** Defaults to `~/.toolkit/config.toml`; test hook for a tmpdir file. */
  readonly configPath?: string;
};

async function defaultRun(
  argv: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  // Snapshot env explicitly: Bun.spawn resolves PATH from the given env, not
  // from later Bun.env mutations, and this also carries OP_SERVICE_ACCOUNT_TOKEN.
  const child = Bun.spawn(argv, {
    env: { ...Bun.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exit, stdout, stderr };
}

/** Vars already resolved in this process; each resolves at most once. */
const resolvedCredentials = new Set<string>();

/** Service-account token once obtained; mirrors the wrapper's export. */
let cachedServiceAccountToken: string | undefined;

function credentialError(
  name: string,
  description: string,
  enrollment: string,
): Error {
  return new Error(
    `toolkit: ${name} (${description}) is not set and could not be resolved. Enroll it with: ${enrollment}`,
  );
}

async function readKeychainValue(
  service: string,
  ctx: ResolutionContext,
): Promise<string | null> {
  // Injected subprocess stubs stand in for `security` (hermetic tests on any
  // host); only the live runner needs a real macOS Keychain.
  if (ctx.liveSubprocesses && process.platform !== "darwin") {
    throw new Error(
      `toolkit: Keychain credential ${service} requires macOS; on other hosts set the variable or use a config op:// override.`,
    );
  }
  const result = await ctx.run([
    "security",
    "find-generic-password",
    "-a",
    os.userInfo().username,
    "-s",
    service,
    "-w",
  ]);
  if (result.exit !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

async function serviceAccountToken(ctx: ResolutionContext): Promise<string> {
  const ambient = Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
  if (ambient !== undefined && ambient.length > 0) {
    return ambient;
  }
  if (cachedServiceAccountToken !== undefined) {
    return cachedServiceAccountToken;
  }
  if (ctx.liveSubprocesses && process.platform !== "darwin") {
    throw new Error(
      "toolkit: OP_SERVICE_ACCOUNT_TOKEN is required outside macOS; export it before running this command.",
    );
  }
  const token = await readKeychainValue(SERVICE_ACCOUNT_KEYCHAIN_SERVICE, ctx);
  if (token === null || token.length <= 128 || !token.startsWith("ops_")) {
    throw new Error(
      "toolkit: no homelab 1Password service account token is available in Keychain. Enroll it with: swift scripts/onepassword/enroll-service-account.swift",
    );
  }
  // Inherit into spawned children exactly like with-service-account.sh exports it.
  Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = token;
  cachedServiceAccountToken = token;
  return token;
}

async function readServiceAccountRef(
  ref: string,
  ctx: ResolutionContext,
): Promise<string | null> {
  await serviceAccountToken(ctx);
  const result = await ctx.run(["op", "read", ref]);
  if (result.exit !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function logResolved(name: string, backend: string): void {
  console.error(`toolkit: ${name} via ${backend}`);
}

const CredentialOverridesFileSchema = z.looseObject({
  credentials: z.record(z.string(), z.unknown()).optional(),
});

async function loadCredentialOverrides(
  configPath: string,
): Promise<Record<string, string>> {
  if (!(await Bun.file(configPath).exists())) {
    return {};
  }
  let document: unknown;
  try {
    document = Bun.TOML.parse(await Bun.file(configPath).text());
  } catch (error) {
    throw new Error(`toolkit: failed to parse config file ${configPath}`, {
      cause: error,
    });
  }
  const table = CredentialOverridesFileSchema.parse(document).credentials ?? {};
  const overrides: Record<string, string> = {};
  for (const [key, entry] of Object.entries(table)) {
    if (typeof entry === "string" && entry.length > 0) {
      overrides[key] = entry;
    }
  }
  return overrides;
}

type ResolutionContext = {
  readonly run: CredentialRun;
  /** False when tests inject a subprocess stub; skips host capability gates. */
  readonly liveSubprocesses: boolean;
  readonly configPath: string;
  readonly overrides: Record<string, string>;
};

async function resolveOverrideValue(
  name: string,
  override: string,
  ctx: ResolutionContext,
): Promise<string> {
  const description = CREDENTIAL_REGISTRY[name]?.description ?? "credential";
  if (override.startsWith("op://")) {
    const value = await readServiceAccountRef(override, ctx);
    if (value === null) {
      throw credentialError(
        name,
        description,
        "swift scripts/onepassword/enroll-service-account.swift",
      );
    }
    return value;
  }
  const prefix = "keychain:";
  if (override.startsWith(prefix) && override.length > prefix.length) {
    const service = override.slice(prefix.length);
    const value = await readKeychainValue(service, ctx);
    if (value === null) {
      throw credentialError(
        name,
        description,
        `swift scripts/onepassword/enroll-workstation-secret.swift --service ${service} --ref op://<vault>/<item>/<field>`,
      );
    }
    return value;
  }
  throw new Error(
    `toolkit: invalid credential override for ${name} in ${ctx.configPath} (expected op://… or keychain:<service>)`,
  );
}

async function resolveRegistryValue(
  name: string,
  spec: CredentialSpec,
  ctx: ResolutionContext,
): Promise<{ value: string; backend: string }> {
  if (spec.source.kind === "keychain") {
    const value = await readKeychainValue(spec.source.service, ctx);
    if (value === null) {
      throw credentialError(
        name,
        spec.description,
        `swift scripts/onepassword/enroll-workstation-secret.swift --service ${spec.source.service} --ref ${KEYCHAIN_ENROLL_REFS[spec.source.service] ?? "op://<vault>/<item>/<field>"}`,
      );
    }
    return { value, backend: "keychain" };
  }
  const value = await readServiceAccountRef(spec.source.ref, ctx);
  if (value === null) {
    throw credentialError(
      name,
      spec.description,
      "swift scripts/onepassword/enroll-service-account.swift",
    );
  }
  return { value, backend: "service-account" };
}

async function resolveOneCredential(
  name: string,
  ctx: ResolutionContext,
): Promise<{ value: string; backend: string }> {
  const ambient = Bun.env[name];
  if (ambient !== undefined && ambient.length > 0) {
    // Ambient wins for CI/k8s; skip silently, nothing was brokered.
    return { value: ambient, backend: "env" };
  }
  const override = ctx.overrides[name];
  if (override !== undefined) {
    return {
      value: await resolveOverrideValue(name, override, ctx),
      backend: "config",
    };
  }
  const spec = CREDENTIAL_REGISTRY[name];
  if (spec === undefined) {
    throw new Error(
      `toolkit: unknown credential ${name}; no registry entry and no [credentials] override in ${ctx.configPath}.`,
    );
  }
  return resolveRegistryValue(name, spec, ctx);
}

export async function resolveCredentials(
  names: readonly string[],
  deps?: CredentialDeps,
): Promise<void> {
  if (names.length === 0) {
    return;
  }
  const configPath = deps?.configPath ?? defaultToolkitConfigPath();
  const ctx: ResolutionContext = {
    run: deps?.run ?? defaultRun,
    liveSubprocesses: deps?.run === undefined,
    configPath,
    overrides: await loadCredentialOverrides(configPath),
  };
  for (const name of names) {
    if (resolvedCredentials.has(name)) {
      continue;
    }
    const resolved = await resolveOneCredential(name, ctx);
    Bun.env[name] = resolved.value;
    if (resolved.backend !== "env") {
      logResolved(name, resolved.backend);
    }
    resolvedCredentials.add(name);
  }
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const boundary = args.indexOf("--");
  const candidates = boundary === -1 ? args : args.slice(0, boundary);
  let value: string | undefined;
  for (const [index, argument] of candidates.entries()) {
    if (argument === flag) value = candidates[index + 1];
    if (argument.startsWith(`${flag}=`)) {
      value = argument.slice(flag.length + 1);
    }
  }
  return value;
}

function temporalCredentialsFor(
  environment: Readonly<Record<string, string | undefined>>,
  args: readonly string[],
): readonly string[] {
  const address =
    flagValue(args, "--address") ?? environment["TEMPORAL_ADDRESS"];
  if (
    address !== TEMPORAL_IN_CLUSTER_ADDRESS &&
    flagValue(args, "--tls") === "false"
  ) {
    throw new Error(
      "toolkit: refusing to resolve TEMPORAL_API_KEY with --tls=false",
    );
  }
  return address === TEMPORAL_IN_CLUSTER_ADDRESS ? [] : ["TEMPORAL_API_KEY"];
}

export function requiredCredentialsFor(
  command: string,
  _subcommand: string | undefined,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  args: readonly string[] = [],
): readonly string[] {
  switch (command) {
    case "ci":
    case "woodpecker":
      return ["WOODPECKER_TOKEN"];
    case "temporal":
      return temporalCredentialsFor(environment, args);
    case "linear":
      return ["LINEAR_API_KEY"];
    case "posthog":
      return ["POSTHOG_CLI_API_KEY"];
    case "argocd":
      return ["ARGOCD_AUTH_TOKEN"];
    case "grafana":
    case "prom":
    case "loki":
    case "tempo":
      return ["GRAFANA_API_KEY"];
    case "cf":
      return ["CF_API_TOKEN"];
    case "bugsink":
      return ["BUGSINK_TOKEN"];
    case "discord":
      return ["DISCORD_BOT_TOKEN", "DISCORD_USER_TOKEN"];
    case "pr":
      return ["WOODPECKER_TOKEN"];
    default:
      return [];
  }
}
