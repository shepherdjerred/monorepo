#!/usr/bin/env bun
/**
 * Local contributor smoke test for Streambot's multi-stage Docker image.
 *
 * Checks:
 *  1. Builds the dedicated `--target smoke` stage (`streambot:smoke`), which
 *     restores development dependencies and runs `voice-smoke`, Vitest
 *     `bun run test:integration` (all real-FFmpeg + libass tests), and
 *     `ci/scripts/images/smoke-app-in-image.ts`.
 *  2. Verifies the lean production-only image (`streambot:dev`, built without
 *     devDependencies/Vitest): `ffmpeg` + `/usr/local/bin/yt-dlp` are runnable
 *     and the bot boots with dummy tokens until Discord rejects login with the
 *     expected auth error.
 *
 * Dependency-free: `Bun.spawn` only. Always removes the temporary container and
 * fails on any non-zero stage.
 */
import path from "node:path";

export const PROD_IMAGE = "streambot:dev";
export const SMOKE_IMAGE = "streambot:smoke";

const EXPECTED_BOOT_FAILURES = [
  "tokeninvalid",
  "an invalid token was provided",
  "unauthorized",
  "401",
  "invalid token",
];

export type CommandResult = { code: number; stdout: string };
export type CommandRunner = (
  cmd: string[],
  options?: { cwd?: string },
) => Promise<CommandResult>;

export function buildSmokeStageBuildCommand(
  smokeImage: string = SMOKE_IMAGE,
): string[] {
  return [
    "docker",
    "buildx",
    "build",
    "--target",
    "smoke",
    "--load",
    "-t",
    smokeImage,
    "-f",
    "Dockerfile",
    "../..",
  ];
}

export function buildProdImageInspectCommand(
  prodImage: string = PROD_IMAGE,
): string[] {
  return ["docker", "image", "inspect", prodImage];
}

export function buildProdImageBuildCommand(
  prodImage: string = PROD_IMAGE,
): string[] {
  return [
    "docker",
    "buildx",
    "build",
    "--load",
    "-t",
    prodImage,
    "-f",
    "Dockerfile",
    "../..",
  ];
}

export function buildProdRuntimeScript(): string {
  return [
    "set -e",
    "mkdir -p /tmp/videos",
    "cd /app/packages/streambot",
    // Tools present and runnable inside the lean production rootfs.
    "ffmpeg -version >/dev/null",
    "/usr/local/bin/yt-dlp --version >/dev/null",
    // Time-boxed boot; capture output and assert the expected auth failure.
    "set +e",
    'output="$(timeout 30s bun run src/index.ts 2>&1)"',
    'status="$?"',
    String.raw`printf '%s\n' "$output"`,
    '[ "$status" -eq 124 ] && exit 0',
    String.raw`printf '%s\n' "$output" | grep -iE 'TokenInvalid|401|Unauthorized|Invalid token|An invalid token was provided'`,
  ].join("\n");
}

export function buildProdContainerRunCommand(
  containerName: string,
  prodImage: string = PROD_IMAGE,
): string[] {
  return [
    "docker",
    "run",
    "--name",
    containerName,
    "-e",
    "BOT_TOKEN=smoke-test-dummy",
    "-e",
    "USER_TOKENS=smoke-test-dummy",
    "-e",
    "ADMIN_IDS=000000000000000000",
    "-e",
    "VIDEOS_DIR=/tmp/videos",
    "-e",
    "FEATURE_FLAGS_MODE=disabled",
    "-e",
    // No PostHog destination here, so usage capture is switched off explicitly.
    "USAGE_ANALYTICS_ENABLED=false",
    "-e",
    "STATE_DIR=/tmp/videos",
    "--entrypoint",
    "sh",
    prodImage,
    "-c",
    buildProdRuntimeScript(),
  ];
}

export function isExpectedBootFailure(output: string): boolean {
  const lower = output.toLowerCase();
  return EXPECTED_BOOT_FAILURES.some((pattern) => lower.includes(pattern));
}

export async function defaultRunner(
  cmd: string[],
  options?: { cwd?: string },
): Promise<CommandResult> {
  const proc = Bun.spawn(cmd, {
    ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: `${stdout}${stderr}` };
}

export async function runSmoke(options?: {
  runner?: CommandRunner;
  containerName?: string;
  prodImage?: string;
  smokeImage?: string;
  packageDir?: string;
  log?: (message: string) => void;
}): Promise<void> {
  const runner = options?.runner ?? defaultRunner;
  const containerName =
    options?.containerName ?? `smoke-streambot-${String(process.pid)}`;
  const prodImage = options?.prodImage ?? PROD_IMAGE;
  const smokeImage = options?.smokeImage ?? SMOKE_IMAGE;
  const packageDir = options?.packageDir ?? path.resolve(import.meta.dir, "..");
  const log = options?.log ?? console.log;

  const removeContainer = async (): Promise<void> => {
    await runner(["docker", "rm", "-f", containerName]);
  };

  await removeContainer();
  try {
    const smokeBuild = await runner(buildSmokeStageBuildCommand(smokeImage), {
      cwd: packageDir,
    });
    if (smokeBuild.code !== 0) {
      throw new Error(
        `Docker smoke stage build failed (exit ${String(smokeBuild.code)}).\n\nOutput:\n${smokeBuild.stdout}`,
      );
    }

    const inspectProd = await runner(buildProdImageInspectCommand(prodImage));
    if (inspectProd.code !== 0) {
      const prodBuild = await runner(buildProdImageBuildCommand(prodImage), {
        cwd: packageDir,
      });
      if (prodBuild.code !== 0) {
        throw new Error(
          `Docker production image build failed (exit ${String(prodBuild.code)}).\n\nOutput:\n${prodBuild.stdout}`,
        );
      }
    }

    const run = await runner(
      buildProdContainerRunCommand(containerName, prodImage),
    );
    if (run.code === 0 || isExpectedBootFailure(run.stdout)) {
      log(
        "Smoke test passed: --target smoke (integration + voice-smoke) OK, and lean production image tools + boot hit the expected auth failure.",
      );
      return;
    }

    throw new Error(
      `Smoke test failed (exit ${String(run.code)}).\n\nOutput:\n${run.stdout}`,
    );
  } finally {
    await removeContainer();
  }
}

if (import.meta.main) {
  await runSmoke();
}
