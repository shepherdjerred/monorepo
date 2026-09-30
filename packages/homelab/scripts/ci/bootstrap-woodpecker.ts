#!/usr/bin/env bun

/** One-time exact-main chart release that creates Woodpecker's CI queue. */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";

const ExpectedSchema = z.array(
  z.object({ name: z.string(), revision: z.string() }),
);

async function captured(command: string[]): Promise<string> {
  const result = await run(command, {
    capture: true,
    echoCapturedStdout: false,
  });
  return result.stdout.trim();
}

async function assertExactMain(commit: string): Promise<void> {
  const head = await captured(["git", "rev-parse", "HEAD"]);
  const remote = await captured([
    "git",
    "ls-remote",
    "origin",
    "refs/heads/main",
  ]);
  if (head !== commit || remote.split(/\s+/u)[0] !== commit) {
    throw new Error(
      "bootstrap checkout is not the exact current main revision",
    );
  }
  const status = await captured(["git", "status", "--porcelain"]);
  if (status.length > 0) {
    throw new Error("bootstrap checkout must be clean");
  }
}

async function main(): Promise<void> {
  const [commit, number, ...flags] = Bun.argv.slice(2);
  if (
    number === undefined ||
    commit === undefined ||
    !/^[a-f0-9]{40}$/u.test(commit) ||
    !/^[1-9]\d{0,11}$/u.test(number) ||
    flags.some((flag) => flag !== "--dry-run")
  ) {
    throw new Error(
      "Usage: bootstrap-woodpecker.ts <exact-main-sha> <reserved-woodpecker-build-number> [--dry-run]",
    );
  }
  const dryRun = flags.includes("--dry-run");
  if (!dryRun) {
    for (const name of [
      "ARGOCD_TOKEN",
      "CHARTMUSEUM_USERNAME",
      "CHARTMUSEUM_PASSWORD",
    ]) {
      const value = Bun.env[name];
      if (value === undefined || value === "") {
        throw new Error(`${name} is required`);
      }
    }
  }
  await assertExactMain(commit);
  const artifacts = await mkdtemp(
    path.join(tmpdir(), `woodpecker-bootstrap-${number}-`),
  );
  const releaseNumber = (1_000_000 + Number(number)).toString();
  const version = `2.0.0-${releaseNumber}`;
  const requestId = `00000000-0000-4000-8000-${number.padStart(12, "0")}`;
  const argocd = path.resolve("packages/homelab/scripts/argocd/argocd.ts");
  const helm = path.resolve("packages/homelab/scripts/helm/helm-push.ts");
  const expectedPath = path.join(artifacts, "argocd-release-expected.json");
  console.log(`Bootstrap artifacts: ${artifacts}`);

  if (!dryRun) {
    await run([
      "bun",
      "--no-install",
      argocd,
      "suspend-auto-sync",
      "apps",
      "--timeout",
      "300",
    ]);
    await assertExactMain(commit);
  }
  await run(
    [
      "bun",
      "--no-install",
      helm,
      releaseNumber,
      ...(dryRun ? ["--dry-run"] : []),
    ],
    {
      cwd: artifacts,
      env: { HOMELAB_RELEASE_VERSION: version },
      unsetEnv: ["HOMELAB_IMAGE_DIGESTS_JSON", "HOMELAB_VERSION_CATALOG_JSON"],
    },
  );
  const expected = ExpectedSchema.parse(await Bun.file(expectedPath).json());
  if (
    expected.filter((item) => item.name === "apps").length !== 1 ||
    expected.find((item) => item.name === "apps")?.revision !== version
  ) {
    throw new Error(`release inventory does not declare apps at ${version}`);
  }
  await assertExactMain(commit);
  await run([
    "bun",
    "--no-install",
    argocd,
    "release-root",
    "apps",
    expectedPath,
    "--revision",
    version,
    "--request-id",
    requestId,
    ...(dryRun ? ["--dry-run"] : []),
  ]);
}

if (import.meta.main) await main();
