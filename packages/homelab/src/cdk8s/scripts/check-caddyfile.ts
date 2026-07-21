#!/usr/bin/env bun
/**
 * Generate the production S3-static-sites Caddyfile without materializing a
 * Docker image in the root verification job. The image lane owns parser-level
 * validation: `smoke-images.ts` streams this exact generated artifact into the
 * freshly built custom caddy-s3proxy image and runs `caddy validate`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
  try {
    console.error(`[check:caddyfile] generating Caddyfile → ${caddyfilePath}`);
    await run(
      ["bun", "--no-install", "run", GENERATOR, caddyfilePath],
      "generate-caddyfile",
    );

    const generated = await Bun.file(caddyfilePath).text();
    if (generated.trim() === "") {
      throw new Error("generated Caddyfile is empty");
    }
    if (
      !generated.includes("order s3proxy last") ||
      !generated.includes("s3proxy {")
    ) {
      throw new Error(
        "generated Caddyfile is missing the custom s3proxy directive",
      );
    }

    console.error(
      "[check:caddyfile] generation passed; the image smoke lane owns caddy validate",
    );
  } finally {
    await rm(workDir, { force: true, recursive: true });
  }
}

await main();
