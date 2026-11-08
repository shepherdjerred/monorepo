import os from "node:os";
import { z } from "zod";
import {
  CREDENTIAL_REGISTRY,
  PRIVATE_VAULT_REF,
} from "#lib/credential-registry.ts";
import type { CredentialSpec } from "#lib/credential-registry.ts";
import { liveCredentialCache } from "#lib/credential-cache.ts";
import type { CredentialCache } from "#lib/credential-cache.ts";
import {
  defaultToolkitConfigPath,
  loadToolkitConfig,
} from "#lib/toolkit-config.ts";

/**
 * Credential broker: resolves service secrets into `Bun.env` just in time.
 *
 * Order per variable: non-empty ambient env wins (CI/k8s), then the
 * `[credentials]` table in `~/.toolkit/config.toml` (`op://…` for the
 * 1Password service account, `keychain:<service>` for the macOS Keychain),
 * then the registry backend below. Values are only ever injected into child
 * process environments; the resolver logs names and backends, never values.
 *
 * The 1Password service-account token is handed only to the `op` child that
 * reads a reference; it is never exported into this process's environment, so
 * passthrough children never inherit it. Service-account reads go through the
 * Keychain read cache (see credential-cache.ts) when this is the installed
 * toolkit binary.
 */

export const TEMPORAL_IN_CLUSTER_ADDRESS =
  "temporal-temporal-server-service:7233";

/** Desktop-auth refs used only to spell the Keychain enrollment command. */
const KEYCHAIN_ENROLL_REFS: Record<string, string> = {
  "monorepo-workstation-discord-user-token": `${PRIVATE_VAULT_REF}/sskm6skq3mwnyqnhrmqwji6dne/TOKEN`,
  "monorepo-workstation-discord-bot-token": `${PRIVATE_VAULT_REF}/ytv272dyktkeipt347f2yf5kue/BOT_TOKEN`,
};

const SERVICE_ACCOUNT_KEYCHAIN_SERVICE =
  "monorepo-homelab-1password-service-account";

/**
 * Subprocess seam: argv and extra environment in, exit plus captured streams
 * out. `extraEnvironment` carries the service-account token to `op` only.
 */
export type CredentialRun = (
  argv: string[],
  extraEnvironment?: Readonly<Record<string, string>>,
) => Promise<{ exit: number; stdout: string; stderr: string }>;

export type CredentialDeps = {
  /** Subprocess seam; defaults to a Bun.spawn runner. */
  readonly run?: CredentialRun;
  /** Defaults to `~/.toolkit/config.toml`; test hook for a tmpdir file. */
  readonly configPath?: string;
  /**
   * Read cache for service-account references. Defaults to the Keychain
   * cache for the installed binary and to none when `run` is injected.
   */
  readonly cache?: CredentialCache | null;
};

/** The environment every non-`op` child gets: never the service-account token. */
export function withoutServiceAccountToken(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const copy = { ...environment };
  delete copy["OP_SERVICE_ACCOUNT_TOKEN"];
  return copy;
}

async function defaultRun(
  argv: string[],
  extraEnvironment: Readonly<Record<string, string>> = {},
): Promise<{ exit: number; stdout: string; stderr: string }> {
  // Snapshot env explicitly: Bun.spawn resolves PATH from the given env, not
  // from later Bun.env mutations. Only `op` receives the token, via extras.
  const child = Bun.spawn(argv, {
    env: { ...withoutServiceAccountToken(Bun.env), ...extraEnvironment },
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

/** Service-account token once obtained; held in memory, never exported. */
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
  cachedServiceAccountToken = token;
  return token;
}

async function readServiceAccountRef(
  ref: string,
  ctx: ResolutionContext,
): Promise<{ value: string; cached: boolean } | null> {
  const cached = await ctx.cache?.get(ref);
  if (cached !== undefined && cached !== null) {
    return { value: cached, cached: true };
  }
  const token = await serviceAccountToken(ctx);
  const result = await ctx.run(["op", "read", ref], {
    OP_SERVICE_ACCOUNT_TOKEN: token,
  });
  if (result.exit !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  if (value.length === 0) {
    return null;
  }
  await ctx.cache?.set(ref, value);
  return { value, cached: false };
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
  } catch {
    throw new Error(
      `toolkit: failed to parse config file ${configPath}; private diagnostics withheld`,
    );
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
  readonly cache: CredentialCache | null;
};

type Resolved = { readonly value: string; readonly backend: string };

async function resolveOverrideValue(
  name: string,
  override: string,
  ctx: ResolutionContext,
): Promise<Resolved> {
  const description = CREDENTIAL_REGISTRY[name]?.description ?? "credential";
  if (override.startsWith("op://")) {
    const read = await readServiceAccountRef(override, ctx);
    if (read === null) {
      throw credentialError(
        name,
        description,
        "swift scripts/onepassword/enroll-service-account.swift",
      );
    }
    return { value: read.value, backend: read.cached ? "cache" : "config" };
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
    return { value, backend: "config" };
  }
  throw new Error(
    `toolkit: invalid credential override for ${name} in ${ctx.configPath} (expected op://… or keychain:<service>)`,
  );
}

async function resolveRegistryValue(
  name: string,
  spec: CredentialSpec,
  ctx: ResolutionContext,
): Promise<Resolved> {
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
  const read = await readServiceAccountRef(spec.source.ref, ctx);
  if (read === null) {
    throw credentialError(
      name,
      spec.description,
      "swift scripts/onepassword/enroll-service-account.swift",
    );
  }
  return {
    value: read.value,
    backend: read.cached ? "cache" : "service-account",
  };
}

async function resolveOneCredential(
  name: string,
  ctx: ResolutionContext,
): Promise<Resolved> {
  const ambient = Bun.env[name];
  if (ambient !== undefined && ambient.length > 0) {
    // Ambient wins for CI/k8s; skip silently, nothing was brokered.
    return { value: ambient, backend: "env" };
  }
  const override = ctx.overrides[name];
  if (override !== undefined) {
    return resolveOverrideValue(name, override, ctx);
  }
  const spec = CREDENTIAL_REGISTRY[name];
  if (spec === undefined) {
    throw new Error(
      `toolkit: unknown credential ${name}; no registry entry and no [credentials] override in ${ctx.configPath}.`,
    );
  }
  return resolveRegistryValue(name, spec, ctx);
}

async function defaultCache(
  configPath: string,
): Promise<CredentialCache | null> {
  const config = await loadToolkitConfig({ configPath });
  const ttl = await config.get("credentialCacheTtlSeconds");
  return liveCredentialCache(ttl.value);
}

async function resolutionContext(
  deps: CredentialDeps | undefined,
): Promise<ResolutionContext> {
  const configPath = deps?.configPath ?? defaultToolkitConfigPath();
  const liveSubprocesses = deps?.run === undefined;
  let cache: CredentialCache | null = null;
  if (deps?.cache !== undefined) {
    cache = deps.cache;
  } else if (liveSubprocesses) {
    cache = await defaultCache(configPath);
  }
  return {
    run: deps?.run ?? defaultRun,
    liveSubprocesses,
    configPath,
    overrides: await loadCredentialOverrides(configPath),
    cache,
  };
}

/**
 * Resolve credentials to values without exporting them into this process's
 * environment. Use for file-shaped secrets handed to one child (kubeconfig
 * material, talosconfig, AWS credential_process output).
 */
export async function resolveCredentialValues(
  names: readonly string[],
  deps?: CredentialDeps,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  if (names.length === 0) {
    return values;
  }
  const ctx = await resolutionContext(deps);
  for (const name of names) {
    const resolved = await resolveOneCredential(name, ctx);
    // Cache hits are silent: a stderr line per kubectl call is noise.
    if (resolved.backend !== "env" && resolved.backend !== "cache") {
      logResolved(name, resolved.backend);
    }
    values[name] = resolved.value;
  }
  return values;
}

export async function resolveCredentials(
  names: readonly string[],
  deps?: CredentialDeps,
): Promise<void> {
  const pending = names.filter((name) => !resolvedCredentials.has(name));
  const values = await resolveCredentialValues(pending, deps);
  for (const [name, value] of Object.entries(values)) {
    Bun.env[name] = value;
    resolvedCredentials.add(name);
  }
}

/** The `op://` reference a credential would be read from, if any. */
async function credentialRef(
  name: string,
  configPath: string,
): Promise<string | null> {
  const overrides = await loadCredentialOverrides(configPath);
  const override = overrides[name];
  if (override !== undefined) {
    return override.startsWith("op://") ? override : null;
  }
  const spec = CREDENTIAL_REGISTRY[name];
  return spec?.source.kind === "op" ? spec.source.ref : null;
}

/** Effective locators only; never reads credentials, caches, or ambient values. */
export async function credentialReferences(
  configPath = defaultToolkitConfigPath(),
) {
  const overrides = await loadCredentialOverrides(configPath);
  const names = [
    ...new Set([
      ...Object.keys(CREDENTIAL_REGISTRY),
      ...Object.keys(overrides),
    ]),
  ].toSorted();
  return names.flatMap((name) => {
    const override = overrides[name];
    const spec = CREDENTIAL_REGISTRY[name];
    const ref =
      override ?? (spec?.source.kind === "op" ? spec.source.ref : null);
    return ref?.startsWith("op://") === true
      ? [
          {
            name,
            ref,
            source: override === undefined ? "registry" : "override",
          },
        ]
      : [];
  });
}

/**
 * Drop cached service-account reads so the next use fetches from 1Password.
 * Without names, every registered credential is flushed. Returns the names
 * whose entries were removed.
 */
export async function flushCredentialCache(
  names: readonly string[],
  deps: { readonly cache: CredentialCache; readonly configPath?: string },
): Promise<string[]> {
  const configPath = deps.configPath ?? defaultToolkitConfigPath();
  const targets = names.length > 0 ? names : Object.keys(CREDENTIAL_REGISTRY);
  const flushed: string[] = [];
  for (const name of targets) {
    if (names.length > 0 && CREDENTIAL_REGISTRY[name] === undefined) {
      const overrides = await loadCredentialOverrides(configPath);
      if (overrides[name] === undefined) {
        throw new Error(`toolkit: unknown credential ${name}`);
      }
    }
    const ref = await credentialRef(name, configPath);
    if (ref !== null && (await deps.cache.delete(ref))) {
      flushed.push(name);
    }
  }
  return flushed;
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
