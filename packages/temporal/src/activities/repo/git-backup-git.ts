import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { log } from "#observability/log.ts";

const HEARTBEAT_INTERVAL_MS = 15_000;
const CANCELLATION_GRACE_MS = 1000;
const INHERITED_ENV_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "TMPDIR",
] as const;

export type GitSubprocessHooks = {
  readonly heartbeat: (detail: Record<string, unknown>) => void;
  readonly cancellationSignal?: AbortSignal | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
};

export type GitAuthContext = {
  readonly env: Readonly<Record<string, string>>;
  readonly secrets: readonly string[];
};

export function encodeGitHubBasicCredential(token: string): string {
  return Buffer.from(`x-access-token:${token.trim()}`, "utf8").toString(
    "base64",
  );
}

export function buildSecretRedactionSet(token: string): readonly string[] {
  const trimmed = token.trim();
  if (trimmed === "") {
    return [];
  }
  const basicPayload = encodeGitHubBasicCredential(trimmed);
  const encoded = encodeURIComponent(trimmed);
  return [...new Set([trimmed, basicPayload, encoded])].filter(
    (entry) => entry !== "",
  );
}

export function redactGitSecrets(
  text: string,
  secrets: readonly string[],
): string {
  return secrets.reduce(
    (acc, secret) =>
      secret === "" ? acc : acc.replaceAll(secret, "<redacted>"),
    text,
  );
}

function assertArgsContainNoSecrets(
  args: readonly string[],
  secrets: readonly string[],
): void {
  for (const arg of args) {
    if (/^https?:\/\/[^/\s]+@/iu.test(arg)) {
      throw new Error(
        "Refusing to invoke git with embedded URL credentials in command arguments",
      );
    }
    for (const secret of secrets) {
      if (secret !== "" && arg.includes(secret)) {
        throw new Error(
          "Refusing to pass secret material in git command arguments",
        );
      }
    }
  }
}

export async function withGitAuthEnvironment<T>(
  token: string,
  fn: (auth: GitAuthContext) => Promise<T>,
): Promise<T> {
  const secrets = buildSecretRedactionSet(token);
  const basicHeader = encodeGitHubBasicCredential(token);
  const configDir = await mkdtemp(path.join(tmpdir(), "temporal-git-auth-"));
  await chmod(configDir, 0o700);
  const configPath = path.join(configDir, "gitconfig");
  const gitConfigContent = [
    '[http "https://github.com/"]',
    `\textraheader = Authorization: Basic ${basicHeader}`,
    "[terminal]",
    "\tprompts = false",
    "",
  ].join("\n");
  await writeFile(configPath, gitConfigContent, { mode: 0o600 });
  await chmod(configPath, 0o600);

  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = Bun.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env["GIT_CONFIG_GLOBAL"] = configPath;
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GCM_INTERACTIVE"] = "never";

  try {
    return await fn({ env, secrets });
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

async function readRedactedStream(
  stream: ReadableStream<Uint8Array>,
  secrets: readonly string[],
): Promise<string> {
  const raw = await new Response(stream).text();
  return redactGitSecrets(raw, secrets);
}

export async function runGitSubprocess(input: {
  readonly args: readonly string[];
  readonly cwd?: string | undefined;
  readonly auth: GitAuthContext;
  readonly hooks: GitSubprocessHooks;
  readonly stepLabel: string;
  readonly allowNonZero?: boolean | undefined;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  assertArgsContainNoSecrets(input.args, input.auth.secrets);

  const subprocess = Bun.spawn(["git", ...input.args], {
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    env: { ...input.auth.env },
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });

  const startedAt = Date.now();
  const heartbeatTimer = setInterval(() => {
    input.hooks.heartbeat({
      step: input.stepLabel,
      elapsedMs: Date.now() - startedAt,
    });
  }, input.hooks.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);

  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const signalProcessGroup = (signal: "SIGTERM" | "SIGKILL"): void => {
    try {
      globalThis.process.kill(-subprocess.pid, signal);
    } catch {
      subprocess.kill(signal);
    }
  };
  const onAbort = (): void => {
    signalProcessGroup("SIGTERM");
    killTimer = setTimeout(() => {
      signalProcessGroup("SIGKILL");
    }, CANCELLATION_GRACE_MS);
  };

  input.hooks.cancellationSignal?.addEventListener("abort", onAbort, {
    once: true,
  });
  if (input.hooks.cancellationSignal?.aborted === true) {
    onAbort();
  }

  let outcome: [string, string, number];
  try {
    outcome = await Promise.all([
      readRedactedStream(subprocess.stdout, input.auth.secrets),
      readRedactedStream(subprocess.stderr, input.auth.secrets),
      subprocess.exited,
    ]);
  } finally {
    if (killTimer !== undefined) {
      clearTimeout(killTimer);
    }
    clearInterval(heartbeatTimer);
    input.hooks.cancellationSignal?.removeEventListener("abort", onAbort);
  }

  const [stdout, stderr, exitCode] = outcome;

  if (input.hooks.cancellationSignal?.aborted === true) {
    input.hooks.cancellationSignal.throwIfAborted();
  }

  if (exitCode !== 0 && input.allowNonZero !== true) {
    const detail = [stderr.trim(), stdout.trim()]
      .filter((part) => part !== "")
      .join(" | ")
      .slice(0, 1000);
    throw new Error(
      `git ${input.stepLabel} exited ${String(exitCode)}${detail === "" ? "" : `: ${detail}`}`,
    );
  }

  return { exitCode, stdout, stderr };
}

async function isInitializedBareRepo(mirrorPath: string): Promise<boolean> {
  try {
    const headStat = await stat(path.join(mirrorPath, "HEAD"));
    return headStat.isFile();
  } catch {
    return false;
  }
}

async function mirrorUsesLfs(
  mirrorPath: string,
  auth: GitAuthContext,
  hooks: GitSubprocessHooks,
): Promise<boolean> {
  const check = await runGitSubprocess({
    args: ["-C", mirrorPath, " show", "HEAD:.gitattributes"].map((s) =>
      s.trim(),
    ),
    auth,
    hooks,
    stepLabel: "inspect-gitattributes",
    allowNonZero: true,
  });
  if (check.exitCode === 0 && check.stdout.includes("filter=lfs")) {
    return true;
  }
  const lfsConfig = await runGitSubprocess({
    args: ["-C", mirrorPath, "show", "HEAD:.lfsconfig"],
    auth,
    hooks,
    stepLabel: "inspect-lfsconfig",
    allowNonZero: true,
  });
  return lfsConfig.exitCode === 0;
}

export async function syncBareMirror(input: {
  readonly mirrorPath: string;
  readonly cloneUrl: string;
  readonly repoLabel: string;
  readonly includeLfs: boolean;
  readonly auth: GitAuthContext;
  readonly hooks: GitSubprocessHooks;
  readonly resolveLfsBinary?: (() => string | null) | undefined;
}): Promise<void> {
  const initialized = await isInitializedBareRepo(input.mirrorPath);
  if (initialized) {
    await runGitSubprocess({
      args: [
        "-C",
        input.mirrorPath,
        "remote",
        "set-url",
        "origin",
        input.cloneUrl,
      ],
      auth: input.auth,
      hooks: input.hooks,
      stepLabel: `set-url:${input.repoLabel}`,
    });
    await runGitSubprocess({
      args: ["-C", input.mirrorPath, "remote", "update", "--prune"],
      auth: input.auth,
      hooks: input.hooks,
      stepLabel: `remote-update:${input.repoLabel}`,
    });
  } else {
    await rm(input.mirrorPath, { recursive: true, force: true });
    await mkdir(path.dirname(input.mirrorPath), { recursive: true });
    await runGitSubprocess({
      args: ["clone", "--mirror", "--", input.cloneUrl, input.mirrorPath],
      auth: input.auth,
      hooks: input.hooks,
      stepLabel: `clone-mirror:${input.repoLabel}`,
    });
  }

  if (
    input.includeLfs &&
    (await mirrorUsesLfs(input.mirrorPath, input.auth, input.hooks))
  ) {
    const lfsBin = (input.resolveLfsBinary ?? (() => Bun.which("git-lfs")))();
    if (lfsBin === null) {
      log(
        "info",
        "Repository references Git LFS but git-lfs is not installed; skipping LFS fetch",
        {
          module: "git-backup",
          repository: input.repoLabel,
        },
      );
      return;
    }
    await runGitSubprocess({
      args: ["-C", input.mirrorPath, "lfs", "fetch", "--all"],
      auth: input.auth,
      hooks: input.hooks,
      stepLabel: `lfs-fetch:${input.repoLabel}`,
    });
  }
}

function isUninitializedWikiOutput(stderr: string, stdout: string): boolean {
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  return (
    combined.includes("repository not found") ||
    (combined.includes("repository") &&
      (combined.includes("not found") ||
        combined.includes("does not exist"))) ||
    combined.includes("does not appear to be a git repository")
  );
}

export async function syncWikiMirror(input: {
  readonly wikiMirrorPath: string;
  readonly wikiCloneUrl: string;
  readonly repoLabel: string;
  readonly auth: GitAuthContext;
  readonly hooks: GitSubprocessHooks;
}): Promise<"mirrored" | "uninitialized"> {
  const initialized = await isInitializedBareRepo(input.wikiMirrorPath);
  if (!initialized) {
    await rm(input.wikiMirrorPath, { recursive: true, force: true });
    await mkdir(path.dirname(input.wikiMirrorPath), { recursive: true });
    const outcome = await runGitSubprocess({
      args: [
        "clone",
        "--mirror",
        "--",
        input.wikiCloneUrl,
        input.wikiMirrorPath,
      ],
      auth: input.auth,
      hooks: input.hooks,
      stepLabel: `clone-wiki:${input.repoLabel}`,
      allowNonZero: true,
    });
    if (outcome.exitCode !== 0) {
      await rm(input.wikiMirrorPath, { recursive: true, force: true });
      if (isUninitializedWikiOutput(outcome.stderr, outcome.stdout)) {
        return "uninitialized";
      }
      throw new Error(
        `git clone-wiki:${input.repoLabel} exited ${String(outcome.exitCode)}: ${outcome.stderr.trim().slice(0, 500)}`,
      );
    }
    return "mirrored";
  }

  await runGitSubprocess({
    args: [
      "-C",
      input.wikiMirrorPath,
      "remote",
      "set-url",
      "origin",
      input.wikiCloneUrl,
    ],
    auth: input.auth,
    hooks: input.hooks,
    stepLabel: `set-wiki-url:${input.repoLabel}`,
  });
  const updateOutcome = await runGitSubprocess({
    args: ["-C", input.wikiMirrorPath, "remote", "update", "--prune"],
    auth: input.auth,
    hooks: input.hooks,
    stepLabel: `update-wiki:${input.repoLabel}`,
    allowNonZero: true,
  });
  if (updateOutcome.exitCode !== 0) {
    if (isUninitializedWikiOutput(updateOutcome.stderr, updateOutcome.stdout)) {
      return "uninitialized";
    }
    throw new Error(
      `git update-wiki:${input.repoLabel} exited ${String(updateOutcome.exitCode)}: ${updateOutcome.stderr.trim().slice(0, 500)}`,
    );
  }
  return "mirrored";
}

export async function computeMirrorRefDigest(input: {
  readonly mirrorPath: string;
  readonly repoLabel: string;
  readonly auth: GitAuthContext;
  readonly hooks: GitSubprocessHooks;
}): Promise<{ refCount: number; refDigest: string }> {
  const { stdout } = await runGitSubprocess({
    args: [
      "-C",
      input.mirrorPath,
      "for-each-ref",
      "--format=%(objectname) %(refname)",
    ],
    auth: input.auth,
    hooks: input.hooks,
    stepLabel: `for-each-ref:${input.repoLabel}`,
  });

  const sortedLines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const refDigest = createHash("sha256")
    .update(sortedLines.join("\n"), "utf8")
    .digest("hex");
  return { refCount: sortedLines.length, refDigest };
}

export async function createZstdGitBundle(input: {
  readonly mirrorPath: string;
  readonly outputZstPath: string;
  readonly repoLabel: string;
  readonly auth: GitAuthContext;
  readonly hooks: GitSubprocessHooks;
}): Promise<void> {
  const rawBundlePath = `${input.outputZstPath}.raw.bundle`;
  try {
    await runGitSubprocess({
      args: [
        "-C",
        input.mirrorPath,
        "bundle",
        "create",
        rawBundlePath,
        "--all",
      ],
      auth: input.auth,
      hooks: input.hooks,
      stepLabel: `bundle-create:${input.repoLabel}`,
    });
    await runGitSubprocess({
      args: ["-C", input.mirrorPath, "bundle", "verify", rawBundlePath],
      auth: input.auth,
      hooks: input.hooks,
      stepLabel: `bundle-verify:${input.repoLabel}`,
    });
    const rawBytes = await Bun.file(rawBundlePath).bytes();
    const compressedBytes = zstdCompressSync(rawBytes);
    await Bun.write(input.outputZstPath, compressedBytes);
  } finally {
    await rm(rawBundlePath, { force: true });
  }
}
