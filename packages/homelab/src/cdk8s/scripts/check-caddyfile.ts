#!/usr/bin/env bun
/**
 * Generate the S3-static-sites Caddyfile and validate it with the CUSTOM
 * caddy-s3proxy binary. Stock caddy cannot validate this config — it uses the
 * `s3proxy` directive from the shepherdjerred/caddy-s3-proxy module, so we
 * validate inside the same image the cluster runs.
 *
 * Ported from the old Dagger `caddyfileValidateHelper`
 * (`.dagger/src/misc.ts`, removed 2026-07): generate the Caddyfile, then run
 * `caddy validate` against it with the module compiled in.
 *
 * Steps:
 *  1. Generate the Caddyfile to a temp path via `scripts/generate-caddyfile.ts`.
 *  2. Ensure the `caddy-s3proxy:dev` image exists — build it if `docker image
 *     inspect` fails.
 *  3. `docker run` the image, mounting the generated Caddyfile, and invoke
 *     `caddy validate`. A non-zero exit fails this script.
 *
 * Fail-fast: any step that errors throws; there are no silent fallbacks.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const IMAGE = "caddy-s3proxy:dev";
// Relative to this package (packages/homelab/src/cdk8s): the image build
// context lives at packages/homelab/images/caddy-s3proxy.
const IMAGE_CONTEXT = path.resolve(
  import.meta.dir,
  "../../../images/caddy-s3proxy",
);
const GENERATOR = path.resolve(import.meta.dir, "generate-caddyfile.ts");

async function run(cmd: string[], label: string): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      `${label} failed with exit code ${String(exitCode)}: ${cmd.join(" ")}`,
    );
  }
}

async function imageExists(image: string): Promise<boolean> {
  const proc = Bun.spawn(["docker", "image", "inspect", image], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

async function main(): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "caddyfile-check-"));
  const caddyfilePath = path.join(workDir, "Caddyfile");

  console.error(`[check:caddyfile] generating Caddyfile → ${caddyfilePath}`);
  await run(["bun", "run", GENERATOR, caddyfilePath], "generate-caddyfile");

  if (await imageExists(IMAGE)) {
    console.error(`[check:caddyfile] using existing image ${IMAGE}`);
  } else {
    console.error(
      `[check:caddyfile] ${IMAGE} not found — building from ${IMAGE_CONTEXT}`,
    );
    await run(
      ["docker", "buildx", "build", "--load", "-t", IMAGE, IMAGE_CONTEXT],
      "docker buildx build",
    );
  }

  console.error(
    `[check:caddyfile] validating with ${IMAGE} (custom s3proxy module)`,
  );
  await run(
    [
      "docker",
      "run",
      "--rm",
      "-v",
      `${caddyfilePath}:/etc/caddy-check/Caddyfile`,
      IMAGE,
      "caddy",
      "validate",
      "--config",
      "/etc/caddy-check/Caddyfile",
      "--adapter",
      "caddyfile",
    ],
    "caddy validate",
  );

  console.error("[check:caddyfile] Caddyfile is valid");
}

await main();
