#!/usr/bin/env bun
/**
 * Run `tofu plan` or `tofu apply` on a named OpenTofu stack.
 *
 * Ported from the old CI's `tofuApplyHelper` / `tofuPlanHelper` /
 * `withTofuOptionalSecrets` (.dagger/src/release.ts). Runs locally as a plain
 * Bun script; every credential is a plain env var.
 *
 * Usage:
 *   bun packages/homelab/scripts/tofu-stack.ts <stack> plan|apply [--dry-run]
 *
 * Env (required):
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   — S3 backend + provider creds
 *
 * Env (optional — each is wired to its TF var only when present; a
 * stack-irrelevant secret is simply skipped):
 *   GH_TOKEN, TF_VAR_CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
 *   TAILSCALE_OAUTH_CLIENT_ID, TAILSCALE_OAUTH_CLIENT_SECRET,
 *   TF_VAR_BUILDKITE_API_TOKEN, TF_VAR_RADARR_API_KEY, TF_VAR_SONARR_API_KEY,
 *   TF_VAR_PROWLARR_API_KEY, TF_VAR_QBITTORRENT_PASSWORD,
 *   TF_VAR_PRIVATEHD_PASSWORD, TF_VAR_PRIVATEHD_PID, TF_VAR_AVISTAZ_PASSWORD,
 *   TF_VAR_AVISTAZ_PID, TF_VAR_ANIMEZ_PASSWORD, TF_VAR_ANIMEZ_PID,
 *   TF_VAR_PAGERDUTY_TOKEN
 */

import { existsSync } from "node:fs";
import {
  run,
  runAllowExit,
  requireEnv,
  optionalEnv,
} from "../../../scripts/lib/run.ts";
import { runMain } from "../../../scripts/lib/transient.ts";

/** homelab package root = two levels up from this script (packages/homelab). */
function homelabRoot(): string {
  return new URL("..", import.meta.url).pathname;
}

const STACKS_REL = "src/tofu";

/**
 * The optional secrets a stack may consume, mapped from a plain env var name to
 * the OpenTofu env var name the stack expects. Absent env vars are skipped —
 * stack-irrelevant secrets are simply not passed. Mirrors the old
 * `withTofuOptionalSecrets` mapping exactly (same target env var names); only
 * the source is now an env var instead of a Dagger Secret. The source var name
 * matches the target for TF_VAR_* / CLOUDFLARE_API_TOKEN / TAILSCALE_* since
 * those were already conventional env vars in the old operator flow.
 */
// Source names match the buildkite-ci-secrets keys (and the repo's env-var
// naming convention) exactly; targets are what each stack's variables.tf
// declares.
const OPTIONAL_SECRET_ENV: readonly [source: string, target: string][] = [
  ["GH_TOKEN", "TF_VAR_github_token"],
  ["CLOUDFLARE_ACCOUNT_ID", "TF_VAR_cloudflare_account_id"],
  ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN"],
  ["TAILSCALE_OAUTH_CLIENT_ID", "TAILSCALE_OAUTH_CLIENT_ID"],
  ["TAILSCALE_OAUTH_CLIENT_SECRET", "TAILSCALE_OAUTH_CLIENT_SECRET"],
  ["BUILDKITE_API_TOKEN", "TF_VAR_buildkite_api_token"],
  ["RADARR_API_KEY", "TF_VAR_radarr_api_key"],
  ["SONARR_API_KEY", "TF_VAR_sonarr_api_key"],
  ["PROWLARR_API_KEY", "TF_VAR_prowlarr_api_key"],
  ["QBITTORRENT_PASSWORD", "TF_VAR_qbittorrent_password"],
  ["PRIVATEHD_PASSWORD", "TF_VAR_privatehd_password"],
  ["PRIVATEHD_PID", "TF_VAR_privatehd_pid"],
  ["AVISTAZ_PASSWORD", "TF_VAR_avistaz_password"],
  ["AVISTAZ_PID", "TF_VAR_avistaz_pid"],
  ["ANIMEZ_PASSWORD", "TF_VAR_animez_password"],
  ["ANIMEZ_PID", "TF_VAR_animez_pid"],
  ["PAGERDUTY_TOKEN", "TF_VAR_pagerduty_token"],
];

/** Build the env the tofu subprocess runs with. */
function buildTofuEnv(stack: string): Record<string, string> {
  const env: Record<string, string> = {
    AWS_ACCESS_KEY_ID: requireEnv("AWS_ACCESS_KEY_ID"),
    AWS_SECRET_ACCESS_KEY: requireEnv("AWS_SECRET_ACCESS_KEY"),
  };

  // The seaweedfs stack shells out to the AWS CLI via local-exec provisioners
  // against SeaweedFS's S3 gateway, which needs s3v4 signing and the
  // WHEN_REQUIRED checksum settings (matches deploy-site.ts). Harmless on other
  // stacks, but only wired for seaweedfs to keep the env minimal.
  if (stack === "seaweedfs") {
    env["AWS_DEFAULT_REGION"] = "us-east-1";
    env["AWS_REQUEST_CHECKSUM_CALCULATION"] = "WHEN_REQUIRED";
    env["AWS_RESPONSE_CHECKSUM_VALIDATION"] = "WHEN_REQUIRED";
  }

  for (const [source, target] of OPTIONAL_SECRET_ENV) {
    const value = optionalEnv(source);
    if (value !== null) {
      env[target] = value;
    }
  }
  return env;
}

function usage(): never {
  console.error(
    "Usage: bun packages/homelab/scripts/tofu-stack.ts <stack> plan|apply " +
      "[--dry-run]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
  }
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => !a.startsWith("--"));
  const stack = positional[0];
  const action = positional[1];
  if (stack === undefined) {
    console.error("A stack name is required.");
    usage();
  }
  if (action !== "plan" && action !== "apply") {
    console.error(`Action must be "plan" or "apply", got: ${String(action)}`);
    usage();
  }

  const root = homelabRoot();
  const stackDir = `${root}/${STACKS_REL}/${stack}`;
  if (!existsSync(stackDir)) {
    throw new Error(`Unknown stack: ${stack} (no dir at ${stackDir})`);
  }

  console.log(`--- tofu ${action}: ${stack}${dryRun ? " (dry run)" : ""}`);

  if (dryRun) {
    console.log(
      `DRYRUN: would run \`tofu -chdir=${STACKS_REL}/${stack} init\` then ` +
        `\`tofu ${action}\` with AWS creds + any present optional TF vars`,
    );
    return;
  }

  const env = buildTofuEnv(stack);

  // `tofu init` — NOTE: the old code wrapped init in a bounded retry loop to
  // survive slow provider-registry / GitHub release CDN responses. That retry
  // is intentionally OMITTED here: this runs locally under an operator who can
  // simply re-run on a transient network blip, and there is no unattended CI
  // pod to keep alive. The `github` stack in particular must NOT be retried
  // blindly — a failed apply there can leave GitHub repo/ruleset state
  // half-written, and a naive retry could compound the drift; the operator
  // should inspect and re-run deliberately.
  await run(["tofu", `-chdir=${STACKS_REL}/${stack}`, "init", "-input=false"], {
    cwd: root,
    env,
  });

  if (action === "plan") {
    // -detailed-exitcode: 0 = no changes, 2 = changes detected (not an error),
    // anything else = real failure.
    const result = await runAllowExit(
      [
        "tofu",
        `-chdir=${STACKS_REL}/${stack}`,
        "plan",
        "-input=false",
        "-detailed-exitcode",
      ],
      { cwd: root, env },
    );
    if (result.exitCode === 0) {
      console.log("No changes.");
      return;
    }
    if (result.exitCode === 2) {
      console.log("Changes detected.");
      return;
    }
    throw new Error(`tofu plan failed (exit ${result.exitCode.toString()})`);
  }

  await run(
    [
      "tofu",
      `-chdir=${STACKS_REL}/${stack}`,
      "apply",
      "-auto-approve",
      "-input=false",
    ],
    { cwd: root, env },
  );
  console.log(`--- applied: ${stack}`);
}

await runMain(main);
