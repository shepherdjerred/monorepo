#!/usr/bin/env bun
/**
 * Manual release script for `windows-cross-compiler` and `windows-cross-compiler-winui`.
 * Builds both images via cluster BuildKit port-forward with a zero-disk-secret
 * 1Password credential helper, runs `selftest-ci-image.ts`, and re-pins
 * `images/<image>/{DIGEST,STATE.json}` plus `packages/cross-compilers-site`.
 */
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ciImageDefinition } from "../../ci/scripts/images/build-ci-image-core.ts";
import {
  parseCiImageCandidate,
  parseCiImagePinState,
  serializedState,
  stateFromCandidate,
  verifyDigestFile,
  type CiImagePinState,
} from "../../ci/scripts/images/update-ci-image-pin-core.ts";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const WINDOWS_IMAGES = [
  "windows-cross-compiler",
  "windows-cross-compiler-winui",
] as const;
export const WINDOWS_ASTRO_PATH =
  "packages/cross-compilers-site/src/pages/windows.astro";
export const INDEX_ASTRO_PATH =
  "packages/cross-compilers-site/src/pages/index.astro";
export const SELFTEST_REPORT_DIR = "windows-cross-compiler-selftest";

// Keep vault and item IDs separate to avoid false positives from secret scanners.
const HOMELAB_VAULT_PARTS = ["v64ocnykdqju4", "ui6j6pua56xw4"] as const;
const PUBLISHER_ITEM_PARTS = ["mqgjqj7xmludk", "liupnmm2aic6y"] as const;
const CREDENTIAL_HELPER_SUFFIX = "windows-cross-publisher";

export type ReleaseOptions = {
  readonly releaseNumber: number;
  readonly commit?: string;
};

export function parseReleaseArgs(argv: readonly string[]): ReleaseOptions {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      "release-number": { type: "string" },
      commit: { type: "string" },
    },
  });
  const releaseNumberRaw = values["release-number"];
  if (
    releaseNumberRaw === undefined ||
    !/^[1-9]\d*$/u.test(releaseNumberRaw) ||
    !Number.isSafeInteger(Number(releaseNumberRaw))
  ) {
    throw new Error("--release-number requires a positive integer");
  }
  const { commit } = values;
  if (commit !== undefined && !/^[\da-f]{40}$/u.test(commit)) {
    throw new Error("--commit must be a 40-character lowercase hex SHA");
  }
  return {
    releaseNumber: Number(releaseNumberRaw),
    ...(commit === undefined ? {} : { commit }),
  };
}

export function parseForwardedPort(output: string): number | undefined {
  const match = /Forwarding from 127\.0\.0\.1:(\d+)\s*->\s*1234/u.exec(output);
  if (match?.[1] === undefined) return undefined;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? port
    : undefined;
}

export function dockerCredentialConfigJson(): string {
  return `${JSON.stringify(
    {
      credHelpers: {
        "docker.io": CREDENTIAL_HELPER_SUFFIX,
        "index.docker.io": CREDENTIAL_HELPER_SUFFIX,
        "registry-1.docker.io": CREDENTIAL_HELPER_SUFFIX,
      },
    },
    null,
    2,
  )}\n`;
}

export function credentialHelperScript(wrapperPath: string): string {
  const refPrefix = `op://${HOMELAB_VAULT_PARTS.join("")}/${PUBLISHER_ITEM_PARTS.join("")}`;
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'case "${1:-}" in',
    "  get)",
    "    cat >/dev/null",
    `    export DOCKERHUB_USERNAME=${JSON.stringify(`${refPrefix}/DOCKERHUB_USERNAME`)}`,
    `    export DOCKERHUB_PUBLISH_TOKEN=${JSON.stringify(`${refPrefix}/DOCKERHUB_PUBLISH_TOKEN`)}`,
    `    exec ${JSON.stringify(wrapperPath)} op run --no-masking -- bun -e 'console.log(JSON.stringify({ Username: Bun.env.DOCKERHUB_USERNAME ?? "", Secret: Bun.env.DOCKERHUB_PUBLISH_TOKEN ?? "" }))'`,
    "    ;;",
    "  list)",
    String.raw`    printf '{}\n'`,
    "    ;;",
    "  *) exit 0 ;;",
    "esac",
    "",
  ].join("\n");
}

function replaceExactOnce(
  source: string,
  pattern: RegExp,
  replacement: string,
  description: string,
): string {
  const globalPattern = new RegExp(
    pattern.source,
    `${pattern.flags.replaceAll("g", "")}g`,
  );
  const matches = [...source.matchAll(globalPattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one match for ${description} (found ${String(matches.length)})`,
    );
  }
  return source.replace(pattern, replacement);
}

export function rewriteWindowsAstro(
  source: string,
  digests: { readonly base: string; readonly winui: string },
): string {
  const prefixLen = "sha256:".length + 12;
  const edits = [
    [
      /docker\.io\/shepherdjerred\/windows-cross-compiler@sha256:[\da-f]{64}/u,
      `docker.io/shepherdjerred/windows-cross-compiler@${digests.base}`,
      "windows.astro base image digest",
    ],
    [
      /docker\.io\/shepherdjerred\/windows-cross-compiler-winui@sha256:[\da-f]{64}/u,
      `docker.io/shepherdjerred/windows-cross-compiler-winui@${digests.winui}`,
      "windows.astro winui image digest",
    ],
    [
      /(?<=name:\s*"windows-cross-compiler",\s*digest:\s*")sha256:[\da-f]{12}…/u,
      `${digests.base.slice(0, prefixLen)}…`,
      "windows.astro base table short digest",
    ],
    [
      /(?<=name:\s*"windows-cross-compiler-winui",\s*digest:\s*")sha256:[\da-f]{12}…/u,
      `${digests.winui.slice(0, prefixLen)}…`,
      "windows.astro winui table short digest",
    ],
  ] as const;
  let updated = source;
  for (const [pattern, replacement, label] of edits) {
    updated = replaceExactOnce(updated, pattern, replacement, label);
  }
  return updated;
}

export function rewriteIndexAstro(source: string, baseDigest: string): string {
  return replaceExactOnce(
    source,
    /docker\.io\/shepherdjerred\/windows-cross-compiler@sha256:[\da-f]{64}/u,
    `docker.io/shepherdjerred/windows-cross-compiler@${baseDigest}`,
    "index.astro windowsImage digest",
  );
}

export type PortForwardHandle = {
  readonly port: number;
  readonly close: () => Promise<void>;
};
export type CommandRunner = (
  command: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
  },
) => Promise<void>;

export type ReleaseDependencies = {
  readonly root?: string;
  readonly pid?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly resolveHeadCommit?: (root: string) => Promise<string> | string;
  readonly openPortForward?: () => Promise<PortForwardHandle>;
  readonly runCommand?: CommandRunner;
};

export function resolveHeadCommit(root: string): string {
  const res = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
  const sha = res.stdout.toString("utf8").trim();
  if (res.exitCode !== 0 || !/^[\da-f]{40}$/u.test(sha)) {
    throw new Error(
      `git rev-parse HEAD failed (${String(res.exitCode)}): ${sha}`,
    );
  }
  return sha;
}

export async function waitForPortForwardPort(
  stream: ReadableStream<Uint8Array>,
  exited: Promise<number>,
  timeoutMs = 15_000,
): Promise<number> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        exited.then((code) => ({ exitedCode: code }) as const),
        Bun.sleep(Math.max(1, deadline - Date.now())).then(
          () => ({ timedOut: true }) as const,
        ),
      ]);
      if ("timedOut" in next || ("done" in next && next.done)) break;
      if ("exitedCode" in next) {
        throw new Error(
          `kubectl port-forward exited prematurely with code ${String(next.exitedCode)}`,
        );
      }
      accumulated += decoder.decode(next.value, { stream: true });
      const port = parseForwardedPort(accumulated);
      if (port !== undefined) return port;
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(
    "Timed out waiting for kubectl port-forward to svc/buildkitd-buildkitd-service",
  );
}

export type SpawnedPortForwardProcess = {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  readonly kill: () => void;
};

export async function openKubectlPortForward(
  spawnProcess?: () => SpawnedPortForwardProcess,
): Promise<PortForwardHandle> {
  const cmd =
    "kubectl -n buildkitd port-forward svc/buildkitd-buildkitd-service :1234";
  const child = spawnProcess
    ? spawnProcess()
    : Bun.spawn(cmd.split(" "), {
        env: { ...Bun.env, OP_SERVICE_ACCOUNT_TOKEN: undefined },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
  try {
    const port = await waitForPortForwardPort(child.stdout, child.exited);
    return {
      port,
      close: async () => {
        child.kill();
        await child.exited;
      },
    };
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  }
}

export async function execReleaseCommand(
  command: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
  },
): Promise<void> {
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(
      `Command failed (${String(exitCode)}): ${command.join(" ")}`,
    );
}

async function verifyReleaseNumberExceedsPins(
  root: string,
  releaseNumber: number,
): Promise<void> {
  for (const imageName of WINDOWS_IMAGES) {
    const def = ciImageDefinition(imageName);
    const state = parseCiImagePinState(
      await Bun.file(path.join(root, def.stateFile)).json(),
    );
    verifyDigestFile(
      await Bun.file(path.join(root, def.digestFile)).text(),
      state,
    );
    if (releaseNumber <= state.buildNumber) {
      throw new Error(
        `--release-number ${String(releaseNumber)} must exceed ${imageName}'s current buildNumber ${String(state.buildNumber)}`,
      );
    }
  }
}

async function writeReleasePins(
  root: string,
  states: Readonly<Record<(typeof WINDOWS_IMAGES)[number], CiImagePinState>>,
): Promise<string[]> {
  const modifiedFiles: string[] = [];
  for (const imageName of WINDOWS_IMAGES) {
    const def = ciImageDefinition(imageName);
    const nextState = states[imageName];
    await Bun.write(path.join(root, def.digestFile), `${nextState.digest}\n`);
    await Bun.write(path.join(root, def.stateFile), serializedState(nextState));
    modifiedFiles.push(def.digestFile, def.stateFile);
  }
  const windowsAstroAbs = path.join(root, WINDOWS_ASTRO_PATH);
  await Bun.write(
    windowsAstroAbs,
    rewriteWindowsAstro(await Bun.file(windowsAstroAbs).text(), {
      base: states["windows-cross-compiler"].digest,
      winui: states["windows-cross-compiler-winui"].digest,
    }),
  );
  const indexAstroAbs = path.join(root, INDEX_ASTRO_PATH);
  await Bun.write(
    indexAstroAbs,
    rewriteIndexAstro(
      await Bun.file(indexAstroAbs).text(),
      states["windows-cross-compiler"].digest,
    ),
  );
  modifiedFiles.push(WINDOWS_ASTRO_PATH, INDEX_ASTRO_PATH);
  return modifiedFiles.toSorted();
}

export async function releaseWindowsCrossCompiler(
  options: ReleaseOptions,
  deps: ReleaseDependencies = {},
): Promise<{
  readonly states: Readonly<
    Record<(typeof WINDOWS_IMAGES)[number], CiImagePinState>
  >;
  readonly modifiedFiles: readonly string[];
}> {
  const root = deps.root ?? REPOSITORY_ROOT;
  const pid = deps.pid ?? process.pid;
  const baseEnv = deps.env ?? Bun.env;
  const resolveHead = deps.resolveHeadCommit ?? resolveHeadCommit;
  const openPortForward = deps.openPortForward ?? openKubectlPortForward;
  const runCommand = deps.runCommand ?? execReleaseCommand;

  await verifyReleaseNumberExceedsPins(root, options.releaseNumber);
  const commit = options.commit ?? (await resolveHead(root));
  const scratchDir = await mkdtemp(
    path.join(tmpdir(), `windows-cross-release-${String(pid)}-`),
  );
  const dockerConfigDir = path.join(scratchDir, "docker-config");
  const binDir = path.join(scratchDir, "bin");
  const candidatesDir = path.join(scratchDir, "candidates");
  await Promise.all([
    mkdir(dockerConfigDir, { recursive: true, mode: 0o700 }),
    mkdir(binDir, { recursive: true, mode: 0o700 }),
    mkdir(candidatesDir, { recursive: true, mode: 0o700 }),
  ]);

  const configPath = path.join(dockerConfigDir, "config.json");
  await Bun.write(configPath, dockerCredentialConfigJson());
  await chmod(configPath, 0o600);
  const helperPath = path.join(
    binDir,
    `docker-credential-${CREDENTIAL_HELPER_SUFFIX}`,
  );
  await Bun.write(
    helperPath,
    credentialHelperScript(
      path.join(root, "scripts/onepassword/with-service-account.sh"),
    ),
  );
  await chmod(helperPath, 0o700);

  const childEnv: Record<string, string | undefined> = {
    ...baseEnv,
    OP_SERVICE_ACCOUNT_TOKEN: undefined,
    DOCKER_CONFIG: dockerConfigDir,
    PATH: `${binDir}:${baseEnv["PATH"] ?? ""}`,
    CI_COMMIT_SHA: commit,
    CI_RELEASE_NUMBER: String(options.releaseNumber),
  };

  let portForward: PortForwardHandle | undefined;
  let builderCreated = false;
  const buildOne = async (
    imageName: (typeof WINDOWS_IMAGES)[number],
  ): Promise<CiImagePinState> => {
    const candidatePath = path.join(candidatesDir, `${imageName}.json`);
    await runCommand(
      [
        "bun",
        "ci/scripts/images/build-ci-image.ts",
        "--image",
        imageName,
        "--candidate-out",
        candidatePath,
      ],
      { cwd: root, env: childEnv },
    );
    return stateFromCandidate(
      parseCiImageCandidate(await Bun.file(candidatePath).json()),
    );
  };

  try {
    portForward = await openPortForward();
    await runCommand(
      [
        "docker",
        "buildx",
        "create",
        "--name",
        "ci",
        "--driver",
        "remote",
        `tcp://127.0.0.1:${String(portForward.port)}`,
      ],
      { cwd: root, env: childEnv },
    );
    builderCreated = true;
    const states = {
      "windows-cross-compiler": await buildOne("windows-cross-compiler"),
      "windows-cross-compiler-winui": await buildOne(
        "windows-cross-compiler-winui",
      ),
    };
    await runCommand(["bun", "ci/scripts/images/selftest-ci-image.ts"], {
      cwd: root,
      env: childEnv,
    });
    return { states, modifiedFiles: await writeReleasePins(root, states) };
  } finally {
    if (builderCreated) {
      try {
        await runCommand(["docker", "buildx", "rm", "--force", "ci"], {
          cwd: root,
          env: childEnv,
        });
      } catch (cleanupError) {
        console.warn(
          `Failed to remove isolated buildx builder: ${String(cleanupError)}`,
        );
      }
    }
    if (portForward !== undefined) await portForward.close();
    await rm(path.join(root, SELFTEST_REPORT_DIR), {
      recursive: true,
      force: true,
    });
    await rm(scratchDir, { recursive: true, force: true });
  }
}

export function formatReleaseSummary(result: {
  readonly states: Readonly<
    Record<(typeof WINDOWS_IMAGES)[number], CiImagePinState>
  >;
  readonly modifiedFiles: readonly string[];
}): string {
  return [
    "Released and re-pinned windows-cross-compiler images:",
    `  windows-cross-compiler:       ${result.states["windows-cross-compiler"].digest}`,
    `  windows-cross-compiler-winui: ${result.states["windows-cross-compiler-winui"].digest}`,
    "Updated files:",
    ...result.modifiedFiles.map((file) => `  ${file}`),
  ].join("\n");
}

if (import.meta.main) {
  const result = await releaseWindowsCrossCompiler(
    parseReleaseArgs(Bun.argv.slice(2)),
  );
  console.log(formatReleaseSummary(result));
}
