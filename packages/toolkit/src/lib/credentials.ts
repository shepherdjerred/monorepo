import os from "node:os";
import {
  CREDENTIAL_REGISTRY,
  PRIVATE_VAULT_REF,
} from "#lib/credential-registry.ts";
import type { CredentialSpec } from "#lib/credential-registry.ts";
import { liveCredentialCache } from "#lib/credential-cache.ts";
import type { CredentialCache } from "#lib/credential-cache.ts";
import {
  exhaustedBudget,
  liveDelegate,
  liveReadLog,
  liveReferenceLock,
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

const SERVICE_ACCOUNT_KEYCHAIN_SERVICE =
  "monorepo-homelab-1password-service-account";

const SERVICE_ACCOUNT_ENROLLMENT =
  "swift scripts/onepassword/enroll-service-account.swift";

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
  /** Per-reference read lock; defaults to a directory lock with the cache. */
  readonly lock?: ReferenceLock | null;
  /** Attribution log; defaults to `~/.toolkit/logs/credential-reads.jsonl`. */
  readonly readLog?: ReadLog | null;
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

/**
 * The error for a Keychain item that could not be read. A process outside the
 * user's login session, such as one left behind by an SSH login that has since
 * ended, resolves only the System keychain, so every lookup fails although the
 * item is enrolled; name that instead of sending the operator to re-enroll.
 * Falls back to `enrollmentError` when the login keychain is on the search
 * list or the search list cannot be read.
 */
async function missingKeychainItemError(
  ctx: ResolutionContext,
  enrollmentError: Error,
): Promise<Error> {
  const list = await ctx.run(["security", "list-keychains"]);
  if (list.exit !== 0 || list.stdout.includes("login.keychain")) {
    return enrollmentError;
  }
  const searchList = list.stdout
    .split("\n")
    .map((line) => line.trim().replaceAll('"', ""))
    .filter((line) => line.length > 0)
    .join(", ");
  const session = await ctx.run(["launchctl", "managername"]);
  const sessionName = session.exit === 0 ? session.stdout.trim() : "unknown";
  return new Error(
    `toolkit: this process cannot see the login Keychain (launchd session: ${sessionName}; search list: ${searchList.length > 0 ? searchList : "empty"}), so enrolled credentials look missing; do not re-enroll. Run the command from a process in the GUI login session. A process started by an SSH login that has since ended, such as an SSH-started herdr holder, stays this way until it is replaced.`,
  );
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
  const enrollmentError = new Error(
    `toolkit: no homelab 1Password service account token is available in Keychain. Enroll it with: ${SERVICE_ACCOUNT_ENROLLMENT}`,
  );
  if (token === null) {
    throw await missingKeychainItemError(ctx, enrollmentError);
  }
  if (token.length <= 128 || !token.startsWith("ops_")) {
    throw enrollmentError;
  }
  cachedServiceAccountToken = token;
  return token;
}

/**
 * The first line of an `op` error without its log prefix: the reference and
 * reason (rate limit, missing item, denied vault), never a value.
 */
function opFailureDetail(stderr: string): string | null {
  const line = stderr
    .split("\n")
    .map((entry) => entry.replace(/^\[ERROR\]\s+\S+\s+\S+\s+/, "").trim())
    .find((entry) => entry.length > 0);
  return line === undefined ? null : line.slice(0, 300);
}

/** Where a service-account value came from; only "read" spent budget here. */
type ReadSource = "cache" | "delegated" | "read";

/** `op`'s reason, plus which budget is exhausted when it is a rate limit. */
async function opFailureReason(
  stderr: string,
  token: string,
  ctx: ResolutionContext,
): Promise<string | null> {
  const detail = opFailureDetail(stderr);
  if (detail?.includes("Too many requests") !== true) return detail;
  const table = await ctx.run(["op", "service-account", "ratelimit"], {
    OP_SERVICE_ACCOUNT_TOKEN: token,
  });
  const budget = table.exit === 0 ? exhaustedBudget(table.stdout) : null;
  return budget === null ? detail : `${detail} ${budget}`;
}

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
        : await opFailureReason(result.stderr, token, ctx);
    throw reason === null
      ? credentialError(name, description, SERVICE_ACCOUNT_ENROLLMENT)
      : new Error(
          `toolkit: ${name} (${description}) could not be read from 1Password: ${reason}`,
        );
  }
  await ctx.cache?.set(ref, value);
  return { value, source: "read" };
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
    const value = await readDelegated(name, ref, ctx.delegate, ctx.run);
    if (value !== null) return { value, source: "delegated" };
  }
  if (ctx.cache === null && ctx.liveSubprocesses) {
    console.error(
      `toolkit: ${name} read without the credential cache; this spends the shared 1Password daily budget. Run \`bun run --cwd packages/toolkit install:local\` so source runs borrow the installed cache.`,
    );
  }
  const lock = ctx.lock;
  if (lock === null) return readFromOnePassword(name, description, ref, ctx);
  return lock(ref, async () => {
    // Another caller may have filled the entry while this one waited.
    const filled = await ctx.cache?.get(ref);
    return filled !== undefined && filled !== null
      ? { value: filled, source: "cache" }
      : readFromOnePassword(name, description, ref, ctx);
  });
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
  readonly configPath: string;
  readonly overrides: Record<string, string>;
  readonly cache: CredentialCache | null;
  readonly delegate: string | null;
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
      throw await missingKeychainItemError(
        ctx,
        credentialError(
          name,
          description,
          `swift scripts/onepassword/enroll-workstation-secret.swift --service ${service} --ref op://<vault>/<item>/<field>`,
        ),
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
      throw await missingKeychainItemError(
        ctx,
        credentialError(
          name,
          spec.description,
          `swift scripts/onepassword/enroll-workstation-secret.swift --service ${spec.source.service} --ref ${KEYCHAIN_ENROLL_REFS[spec.source.service] ?? "op://<vault>/<item>/<field>"}`,
        ),
      );
    }
    return { value, backend: "keychain" };
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
  const delegate =
    deps?.installedToolkit === undefined
      ? liveSubprocesses && cache === null
        ? await liveDelegate()
        : null
      : deps.installedToolkit;
  const lock =
    deps?.lock === undefined
      ? liveSubprocesses && cache !== null
        ? liveReferenceLock()
        : null
      : deps.lock;
  return {
    run: deps?.run ?? defaultRun,
    liveSubprocesses,
    configPath,
    overrides: await loadCredentialOverrides(configPath),
    cache,
    delegate,
    lock,
    readLog:
      deps?.readLog === undefined
        ? liveSubprocesses
          ? liveReadLog()
          : null
        : deps.readLog,
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
