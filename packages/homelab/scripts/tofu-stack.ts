#!/usr/bin/env bun
/**
 * Run `tofu plan` or `tofu apply` on a named OpenTofu stack.
 *
 * Ported from the old CI's `tofuApplyHelper` / `tofuPlanHelper` /
 * `withTofuOptionalSecrets` (.dagger/src/release.ts). Runs locally as a plain
 * Bun script; every credential is a plain env var.
 *
 * Usage:
 *   bun packages/homelab/scripts/tofu-stack.ts <stack> validate|plan|apply [--dry-run]
 *
 * Every stack requires the SeaweedFS state identity and only its own provider
 * identity. `buildTofuEnvironment` is the executable credential contract.
 */

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  run,
  runAllowExit,
  requireEnv,
  optionalEnv,
} from "../../../scripts/lib/run.ts";
import { isTransientError, runMain } from "../../../scripts/lib/transient.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";

/** homelab package root = two levels up from this script (packages/homelab). */
function homelabRoot(): string {
  return new URL("..", import.meta.url).pathname;
}

const STACKS_REL = "src/tofu";

export type TofuStack =
  | "seaweedfs"
  | "tailscale"
  | "buildkite"
  | "arr"
  | "github"
  | "cloudflare"
  | "posthog";

function parseTofuStack(value: string): TofuStack {
  switch (value) {
    case "seaweedfs":
    case "tailscale":
    case "buildkite":
    case "arr":
    case "github":
    case "cloudflare":
    case "posthog":
      return value;
    default:
      throw new Error(`Unknown OpenTofu stack: ${value}`);
  }
}

type CredentialMapping = {
  source: string;
  target: string;
};

const STATE_CREDENTIALS: readonly CredentialMapping[] = [
  {
    source: "SEAWEEDFS_STATE_ACCESS_KEY_ID",
    target: "AWS_ACCESS_KEY_ID",
  },
  {
    source: "SEAWEEDFS_STATE_SECRET_ACCESS_KEY",
    target: "AWS_SECRET_ACCESS_KEY",
  },
];

export const STACK_CREDENTIALS = {
  seaweedfs: [
    {
      source: "SEAWEEDFS_DEPLOY_ACCESS_KEY_ID",
      target: "TF_VAR_seaweedfs_access_key_id",
    },
    {
      source: "SEAWEEDFS_DEPLOY_SECRET_ACCESS_KEY",
      target: "TF_VAR_seaweedfs_secret_access_key",
    },
  ],
  tailscale: [
    {
      source: "TAILSCALE_OAUTH_CLIENT_ID",
      target: "TAILSCALE_OAUTH_CLIENT_ID",
    },
    {
      source: "TAILSCALE_OAUTH_CLIENT_SECRET",
      target: "TAILSCALE_OAUTH_CLIENT_SECRET",
    },
  ],
  buildkite: [
    {
      source: "BUILDKITE_ADMIN_TOKEN",
      target: "TF_VAR_buildkite_api_token",
    },
  ],
  arr: [
    { source: "RADARR_API_KEY", target: "TF_VAR_radarr_api_key" },
    { source: "SONARR_API_KEY", target: "TF_VAR_sonarr_api_key" },
    { source: "PROWLARR_API_KEY", target: "TF_VAR_prowlarr_api_key" },
    {
      source: "QBITTORRENT_PASSWORD",
      target: "TF_VAR_qbittorrent_password",
    },
    {
      source: "PRIVATEHD_PASSWORD",
      target: "TF_VAR_privatehd_password",
    },
    { source: "PRIVATEHD_PID", target: "TF_VAR_privatehd_pid" },
    { source: "AVISTAZ_PASSWORD", target: "TF_VAR_avistaz_password" },
    { source: "AVISTAZ_PID", target: "TF_VAR_avistaz_pid" },
    { source: "ANIMEZ_PASSWORD", target: "TF_VAR_animez_password" },
    { source: "ANIMEZ_PID", target: "TF_VAR_animez_pid" },
  ],
  github: [{ source: "TOFU_GITHUB_TOKEN", target: "TF_VAR_github_token" }],
  cloudflare: [
    {
      source: "CLOUDFLARE_ACCOUNT_ID",
      target: "TF_VAR_cloudflare_account_id",
    },
    { source: "CLOUDFLARE_API_TOKEN", target: "CLOUDFLARE_API_TOKEN" },
  ],
  posthog: [
    { source: "POSTHOG_CLI_API_KEY", target: "POSTHOG_API_KEY" },
    {
      source: "POSTHOG_TOFU_STATE_PASSPHRASE",
      target: "TF_VAR_state_passphrase",
    },
  ],
} satisfies Readonly<Record<TofuStack, readonly CredentialMapping[]>>;

const ALL_CREDENTIAL_ENV_NAMES = new Set(
  [...STATE_CREDENTIALS, ...Object.values(STACK_CREDENTIALS).flat()].flatMap(
    ({ source, target }) => [source, target],
  ),
);

export function buildTofuEnvironment(
  stack: TofuStack,
  read: (name: string) => string = requireEnv,
): { env: Record<string, string>; unsetEnv: string[] } {
  const mappings = [...STATE_CREDENTIALS, ...STACK_CREDENTIALS[stack]];
  const env = Object.fromEntries(
    mappings.map(({ source, target }) => [target, read(source)]),
  );

  // The seaweedfs stack shells out to the AWS CLI via local-exec provisioners
  // against SeaweedFS's S3 gateway, which needs s3v4 signing and the
  // WHEN_REQUIRED checksum settings (matches deploy-site.ts). Harmless on other
  // stacks, but only wired for seaweedfs to keep the env minimal.
  if (stack === "seaweedfs") {
    env["AWS_DEFAULT_REGION"] = "us-east-1";
    env["AWS_REQUEST_CHECKSUM_CALCULATION"] = "WHEN_REQUIRED";
    env["AWS_RESPONSE_CHECKSUM_VALIDATION"] = "WHEN_REQUIRED";
  }
  return {
    env,
    unsetEnv: [...ALL_CREDENTIAL_ENV_NAMES].filter(
      (name) => env[name] === undefined,
    ),
  };
}

function usage(): never {
  console.error(
    "Usage: bun packages/homelab/scripts/tofu-stack.ts <stack> " +
      "validate|plan|apply " +
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
  const stackRaw = positional[0];
  const action = positional[1];
  if (stackRaw === undefined) {
    console.error("A stack name is required.");
    usage();
  }
  const stack = parseTofuStack(stackRaw);
  if (action !== "validate" && action !== "plan" && action !== "apply") {
    console.error(
      `Action must be "validate", "plan", or "apply", got: ${String(action)}`,
    );
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
        `\`tofu ${action}\` with state access and only the ${stack} provider identity`,
    );
    return;
  }

  // `tofu init` — NOTE: the old code wrapped init in a bounded retry loop to
  // survive slow provider-registry / GitHub release CDN responses. That retry
  // is intentionally OMITTED here: this runs locally under an operator who can
  // simply re-run on a transient network blip, and there is no unattended CI
  // pod to keep alive. The `github` stack in particular must NOT be retried
  // blindly — a failed apply there can leave GitHub repo/ruleset state
  // half-written, and a naive retry could compound the drift; the operator
  // should inspect and re-run deliberately.
  if (action === "validate") {
    // PR validation runs untrusted branch code. It must not receive the
    // encrypted state passphrase, provider API key, backend credentials, or
    // any other runtime secret. The placeholder only satisfies the required
    // encryption variable while backend-free validation checks the HCL and
    // provider schemas without contacting PostHog.
    const env: Record<string, string> = {
      TF_VAR_state_passphrase: "ci-validation-only-placeholder",
      TF_DATA_DIR: mkdtempSync(`${tmpdir()}/posthog-tofu-validation-`),
    };
    const pluginCacheDir = optionalEnv("TF_PLUGIN_CACHE_DIR");
    if (pluginCacheDir !== null) {
      env["TF_PLUGIN_CACHE_DIR"] = pluginCacheDir;
    }
    await run(
      [
        "tofu",
        `-chdir=${STACKS_REL}/${stack}`,
        "init",
        "-backend=false",
        "-reconfigure",
        "-input=false",
      ],
      { cwd: root, env },
    );
    await run(["tofu", `-chdir=${STACKS_REL}/${stack}`, "validate"], {
      cwd: root,
      env,
    });
    console.log("Validation passed.");
    return;
  }

  const environment = buildTofuEnvironment(stack);

  await run(["tofu", `-chdir=${STACKS_REL}/${stack}`, "init", "-input=false"], {
    cwd: root,
    env: environment.env,
    unsetEnv: environment.unsetEnv,
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
      {
        cwd: root,
        env: environment.env,
        unsetEnv: environment.unsetEnv,
      },
    );
    if (result.exitCode === 0) {
      console.log("No changes.");
      return;
    }
    if (result.exitCode === 2) {
      console.log("Changes detected.");
      return;
    }
    const stderr = result.stderr.trim();
    const message =
      `tofu plan failed (exit ${result.exitCode.toString()})` +
      (stderr === "" ? "" : `\n--- stderr (tail) ---\n${stderr}`);
    if (isTransientError(stderr)) {
      throw new TransientError(message);
    }
    throw new Error(message);
  }

  await run(
    [
      "tofu",
      `-chdir=${STACKS_REL}/${stack}`,
      "apply",
      "-auto-approve",
      "-input=false",
    ],
    {
      cwd: root,
      env: environment.env,
      unsetEnv: environment.unsetEnv,
    },
  );
  console.log(`--- applied: ${stack}`);
}

if (import.meta.main) await runMain(main);
