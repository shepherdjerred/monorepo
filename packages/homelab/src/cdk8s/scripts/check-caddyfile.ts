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
 *  2. `docker run` the exact image pinned for deployment and invoke
 *     `caddy validate`. Docker pulls it when it is not already local.
 *
 * Fail-fast: any step that errors throws; there are no silent fallbacks.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const IMAGE = `ghcr.io/shepherdjerred/caddy-s3proxy:${versions["shepherdjerred/caddy-s3proxy"]}`;
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

async function main(): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "caddyfile-check-"));
  const caddyfilePath = path.join(workDir, "Caddyfile");

  console.error(`[check:caddyfile] generating Caddyfile → ${caddyfilePath}`);
  await run(["bun", "run", GENERATOR, caddyfilePath], "generate-caddyfile");

  console.error(
    `[check:caddyfile] validating with deployed image ${IMAGE} (custom s3proxy module)`,
  );
  // Stream the Caddyfile via stdin rather than a -v bind mount: in CI the
  // docker daemon is a dind sidecar that cannot see this container's /tmp,
  // so host-path mounts silently mount nothing.
  const validate = Bun.spawn(
    [
      "docker",
      "run",
      "--rm",
      "-i",
      "--entrypoint",
      "sh",
      IMAGE,
      "-c",
      "cat > /tmp/Caddyfile && caddy validate --config /tmp/Caddyfile --adapter caddyfile",
    ],
    { stdin: Bun.file(caddyfilePath), stdout: "inherit", stderr: "inherit" },
  );
  const validateExit = await validate.exited;
  if (validateExit !== 0) {
    throw new Error(
      `caddy validate failed with exit code ${String(validateExit)}`,
    );
  }

  console.error("[check:caddyfile] Caddyfile is valid");
}

await main();
