import {
  CREDENTIAL_REGISTRY,
  PRIVATE_VAULT_REF,
} from "#lib/credential-registry.ts";
import type { CredentialSpec } from "#lib/credential-registry.ts";
import { liveCredentialCache } from "#lib/credential-cache.ts";
import type { CredentialCache, SecretStore } from "#lib/credential-cache.ts";
import {
  credentialError,
  readStoredSecret,
  resolveWindowsSecretStore,
  SERVICE_ACCOUNT_ENROLLMENT_MACOS,
  SERVICE_ACCOUNT_ENROLLMENT_WINDOWS,
  SERVICE_ACCOUNT_KEYCHAIN_SERVICE,
  serviceAccountEnrollment,
  workstationSecretEnrollment,
} from "#lib/windows-secret-store.ts";
import {
  createGuiReader,
  isUnreachableLoginKeychainError,
  missingKeychainItemError,
  resolveGuiBridge,
  withGuiFallback,
} from "#lib/credential-gui-bridge.ts";
import type { GuiReader } from "#lib/credential-gui-bridge.ts";
import {
  defaultCredentialRun,
  liveDelegate,
  liveReadLog,
  liveReferenceLock,
  opFailureReason,
  readDelegated,
} from "#lib/credential-reads.ts";
import type { ReadLog, ReferenceLock } from "#lib/credential-reads.ts";
import {
  defaultToolkitConfigPath,
  loadToolkitConfig,
} from "#lib/toolkit-config.ts";
import { loadCredentialOverrides } from "#lib/credential-overrides.ts";

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
 * toolkit binary; other processes borrow that binary's cache, and every
 * resolution is logged without its value (see credential-reads.ts).
 */

/** Desktop-auth refs used only to spell the Keychain enrollment command. */
const KEYCHAIN_ENROLL_REFS: Record<string, string> = {
  "monorepo-workstation-discord-user-token": `${PRIVATE_VAULT_REF}/sskm6skq3mwnyqnhrmqwji6dne/TOKEN`,
  "monorepo-workstation-discord-bot-token": `${PRIVATE_VAULT_REF}/ytv272dyktkeipt347f2yf5kue/BOT_TOKEN`,
};

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
  /**
   * Installed toolkit whose cache an uncached process borrows. Defaults to
   * `~/.local/bin/toolkit` for live source runs and to none when `run` is
   * injected.
   */
  readonly installedToolkit?: string | null;
  /**
   * Local Herdr core (`~/.local/bin/herdr-core`) used to cross from a
   * Background launchd session (such as Tailscale SSH) into the GUI login
   * session. Defaults to the live pair when `run` is not injected.
   */
  readonly herdrCore?: string | null;
  /** Per-reference read lock; defaults to a directory lock with the cache. */
  readonly lock?: ReferenceLock | null;
  /** Attribution log; defaults to `~/.toolkit/logs/credential-reads.jsonl`. */
  readonly readLog?: ReadLog | null;
  /** Platform override for cross-platform tests; defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Windows DPAPI secret store override for tests; defaults on live `win32`. */
  readonly secretStore?: SecretStore | null;
};

/** The environment every non-`op` child gets: never the service-account token. */
export function withoutServiceAccountToken(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const copy = { ...environment };
  delete copy["OP_SERVICE_ACCOUNT_TOKEN"];
  return copy;
}

/** Vars already resolved in this process; each resolves at most once. */
const resolvedCredentials = new Set<string>();

/** Service-account token once obtained; held in memory, never exported. */
let cachedServiceAccountToken: string | undefined;

function readKeychainValue(
  service: string,
  ctx: ResolutionContext,
): Promise<string | null> {
  return readStoredSecret({
    service,
    platform: ctx.platform,
    liveSubprocesses: ctx.liveSubprocesses,
    secretStore: ctx.secretStore,
    run: ctx.run,
  });
}

async function serviceAccountToken(ctx: ResolutionContext): Promise<string> {
  const ambient = Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
  if (ambient !== undefined && ambient.length > 0) {
    return ambient;
  }
  const useModuleCache = ctx.secretStore === null || ctx.liveSubprocesses;
  if (useModuleCache && cachedServiceAccountToken !== undefined) {
    return cachedServiceAccountToken;
  }
  if (
    ctx.liveSubprocesses &&
    ctx.platform !== "darwin" &&
    ctx.platform !== "win32"
  ) {
    throw new Error(
      "toolkit: OP_SERVICE_ACCOUNT_TOKEN is required outside macOS and Windows; export it before running this command.",
    );
  }
  const token = await readKeychainValue(SERVICE_ACCOUNT_KEYCHAIN_SERVICE, ctx);
  const enrollmentError =
    ctx.secretStore === null
      ? new Error(
          `toolkit: no homelab 1Password service account token is available in Keychain. Enroll it with: ${SERVICE_ACCOUNT_ENROLLMENT_MACOS}`,
        )
      : new Error(
          `toolkit: no homelab 1Password service account token is available in the Windows DPAPI store. Enroll it with: ${SERVICE_ACCOUNT_ENROLLMENT_WINDOWS}`,
        );
  if (token === null) {
    throw ctx.secretStore === null
      ? await missingKeychainItemError(ctx.run, enrollmentError)
      : enrollmentError;
  }
  if (token.length <= 128 || !token.startsWith("ops_")) {
    throw enrollmentError;
  }
  if (useModuleCache) {
    cachedServiceAccountToken = token;
  }
  return token;
}

/** Where a service-account value came from; only "read" spent budget here. */
type ReadSource = "cache" | "delegated" | "read";

async function readFromOnePassword(
  name: string,
  description: string,
  ref: string,
  ctx: ResolutionContext,
): Promise<{ value: string; source: ReadSource }> {
  const token = await serviceAccountToken(ctx);
  const result = await ctx.run(["op", "read", ref], {
    OP_SERVICE_ACCOUNT_TOKEN: token,
  });
  const value = result.exit === 0 ? result.stdout.trim() : "";
  if (value.length === 0) {
    const reason =
      result.exit === 0
        ? null
        : await opFailureReason(result.stderr, token, ctx.run);
    throw reason === null
      ? credentialError(
          name,
          description,
          serviceAccountEnrollment(ctx.platform),
        )
      : new Error(
          `toolkit: ${name} (${description}) could not be read from 1Password: ${reason}`,
        );
  }
  await ctx.cache?.set(ref, value);
  return { value, source: "read" };
}

async function guiDelegatedSource(
  name: string,
  ref: string,
  ctx: ResolutionContext,
): Promise<{ value: string; source: ReadSource } | null> {
  const guiValue = await ctx.readGui(name, ref);
  return guiValue === null ? null : { value: guiValue, source: "delegated" };
}

async function readLockedOnePassword(
  name: string,
  description: string,
  ref: string,
  ctx: ResolutionContext,
): Promise<{ value: string; source: ReadSource }> {
  const lock = ctx.lock;
  if (lock === null) return readFromOnePassword(name, description, ref, ctx);
  return lock(ref, async () => {
    const filled = await ctx.cache?.get(ref);
    return filled !== undefined && filled !== null
      ? { value: filled, source: "cache" }
      : readFromOnePassword(name, description, ref, ctx);
  });
}

async function readServiceAccountRef(
  name: string,
  description: string,
  ref: string,
  ctx: ResolutionContext,
): Promise<{ value: string; source: ReadSource }> {
  const cached = await ctx.cache?.get(ref);
  if (cached !== undefined && cached !== null) {
    return { value: cached, source: "cache" };
  }
  if (ctx.cache === null && ctx.delegate !== null) {
    const delegated = await withGuiFallback(
      async () => {
        const value = await readDelegated(
          name,
          ref,
          ctx.delegate ?? "",
          ctx.run,
        );
        return value === null ? null : { value, source: "delegated" as const };
      },
      () => guiDelegatedSource(name, ref, ctx),
    );
    if (delegated !== null) return delegated;
  }
  if (ctx.cache === null && ctx.liveSubprocesses) {
    console.error(
      `toolkit: ${name} read without the credential cache; this spends the shared 1Password daily budget. Run \`bun run --cwd packages/toolkit install:local\` so source runs borrow the installed cache.`,
    );
  }
  // Fallback runs outside `lock` so the GUI child can acquire the same ref lock.
  return withGuiFallback(
    () => readLockedOnePassword(name, description, ref, ctx),
    () => guiDelegatedSource(name, ref, ctx),
  );
}

function backendFor(source: ReadSource, readBackend: string): string {
  return source === "read" ? readBackend : source;
}

function logResolved(name: string, backend: string): void {
  console.error(`toolkit: ${name} via ${backend}`);
}

type ResolutionContext = {
  readonly run: CredentialRun;
  /** False when tests inject a subprocess stub; skips host capability gates. */
  readonly liveSubprocesses: boolean;
  readonly platform: NodeJS.Platform;
  readonly secretStore: SecretStore | null;
  readonly configPath: string;
  readonly overrides: Record<string, string>;
  readonly cache: CredentialCache | null;
  readonly delegate: string | null;
  readonly readGui: GuiReader;
  readonly lock: ReferenceLock | null;
  readonly readLog: ReadLog | null;
};

type Resolved = { readonly value: string; readonly backend: string };

async function resolveOverrideValue(
  name: string,
  override: string,
  ctx: ResolutionContext,
): Promise<Resolved> {
  const description = CREDENTIAL_REGISTRY[name]?.description ?? "credential";
  if (override.startsWith("op://")) {
    const read = await readServiceAccountRef(name, description, override, ctx);
    return { value: read.value, backend: backendFor(read.source, "config") };
  }
  const prefix = "keychain:";
  if (override.startsWith(prefix) && override.length > prefix.length) {
    const service = override.slice(prefix.length);
    const value = await readKeychainValue(service, ctx);
    if (value === null) {
      const enrollmentError = credentialError(
        name,
        description,
        workstationSecretEnrollment(
          service,
          "op://<vault>/<item>/<field>",
          ctx.platform,
        ),
      );
      throw ctx.secretStore === null
        ? await missingKeychainItemError(ctx.run, enrollmentError)
        : enrollmentError;
    }
    return { value, backend: "config" };
  }
  throw new Error(
    `toolkit: invalid credential override for ${name} in ${ctx.configPath} (expected op://… or keychain:<service>)`,
  );
}

async function resolveKeychainRegistryValue(
  name: string,
  description: string,
  service: string,
  ctx: ResolutionContext,
): Promise<Resolved> {
  const value = await readKeychainValue(service, ctx);
  if (value !== null) {
    return { value, backend: ctx.secretStore === null ? "keychain" : "dpapi" };
  }
  const enrollmentError = credentialError(
    name,
    description,
    workstationSecretEnrollment(
      service,
      KEYCHAIN_ENROLL_REFS[service] ?? "op://<vault>/<item>/<field>",
      ctx.platform,
    ),
  );
  if (ctx.secretStore !== null) throw enrollmentError;
  const error = await missingKeychainItemError(ctx.run, enrollmentError);
  if (
    isUnreachableLoginKeychainError(error) &&
    ctx.configPath === defaultToolkitConfigPath()
  ) {
    const guiValue = await ctx.readGui(name, null);
    if (guiValue !== null) return { value: guiValue, backend: "delegated" };
  }
  throw error;
}

async function resolveRegistryValue(
  name: string,
  spec: CredentialSpec,
  ctx: ResolutionContext,
): Promise<Resolved> {
  if (spec.source.kind === "keychain") {
    return resolveKeychainRegistryValue(
      name,
      spec.description,
      spec.source.service,
      ctx,
    );
  }
  const read = await readServiceAccountRef(
    name,
    spec.description,
    spec.source.ref,
    ctx,
  );
  return {
    value: read.value,
    backend: backendFor(read.source, "service-account"),
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

async function resolveCache(
  deps: CredentialDeps | undefined,
  configPath: string,
  live: boolean,
): Promise<CredentialCache | null> {
  return deps?.cache === undefined
    ? live
      ? defaultCache(configPath)
      : null
    : deps.cache;
}

async function resolveDelegate(
  deps: CredentialDeps | undefined,
  cache: CredentialCache | null,
  live: boolean,
): Promise<string | null> {
  return deps?.installedToolkit === undefined
    ? live && cache === null
      ? liveDelegate()
      : null
    : deps.installedToolkit;
}

function resolveLock(
  deps: CredentialDeps | undefined,
  cache: CredentialCache | null,
  live: boolean,
  platform: NodeJS.Platform,
): ReferenceLock | null {
  if (deps?.lock !== undefined) return deps.lock;
  return live && cache !== null ? liveReferenceLock(platform) : null;
}

function resolveReadLog(
  deps: CredentialDeps | undefined,
  live: boolean,
): ReadLog | null {
  if (deps?.readLog !== undefined) return deps.readLog;
  return live ? liveReadLog() : null;
}

async function resolutionContext(
  deps: CredentialDeps | undefined,
): Promise<ResolutionContext> {
  const configPath = deps?.configPath ?? defaultToolkitConfigPath();
  const liveSubprocesses = deps?.run === undefined;
  const platform = deps?.platform ?? process.platform;
  const secretStore = resolveWindowsSecretStore({
    explicitStore: deps?.secretStore,
    explicitPlatform: deps?.platform,
    platform,
    liveSubprocesses,
  });
  const cache = await resolveCache(deps, configPath, liveSubprocesses);
  const delegate = await resolveDelegate(deps, cache, liveSubprocesses);
  const guiBridge = await resolveGuiBridge({
    herdrCore: deps?.herdrCore,
    installedToolkit: deps?.installedToolkit,
    liveSubprocesses,
  });
  const run = deps?.run ?? defaultCredentialRun;
  return {
    run,
    liveSubprocesses,
    platform,
    secretStore,
    configPath,
    overrides: await loadCredentialOverrides(configPath),
    cache,
    delegate,
    readGui: createGuiReader(guiBridge, run),
    lock: resolveLock(deps, cache, liveSubprocesses, platform),
    readLog: resolveReadLog(deps, liveSubprocesses),
  };
}

/** Resolve one credential and record the outcome in the read log. */
async function resolveLogged(
  name: string,
  ctx: ResolutionContext,
): Promise<Resolved> {
  try {
    const resolved = await resolveOneCredential(name, ctx);
    if (resolved.backend !== "env") {
      await ctx.readLog?.({ name, backend: resolved.backend, outcome: "ok" });
    }
    return resolved;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.readLog?.({
      name,
      backend: null,
      outcome: message.includes("Too many requests") ? "rate-limited" : "error",
    });
    throw error;
  }
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
    const resolved = await resolveLogged(name, ctx);
    // Cache hits are silent: a stderr line per kubectl call is noise. A
    // delegated child already printed its own line if it read 1Password.
    if (!["env", "cache", "delegated"].includes(resolved.backend)) {
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
