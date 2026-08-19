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
 */

import {
  run,
  runAllowExit,
  requireEnv,
  optionalEnv,
} from "@shepherdjerred/root-scripts/lib/run.ts";
import { runMain } from "@shepherdjerred/root-scripts/lib/transient.ts";

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
  ["CLOUDFLARE_API_TOKENS_JSON", "TF_VAR_cloudflare_api_tokens"],
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
  [
    "TOFU_STATE_ENCRYPTION_PASSPHRASE",
    "TF_VAR_tofu_state_encryption_passphrase",
  ],
  ["OP_CONNECT_TOKEN", "OP_CONNECT_TOKEN"],
  ["OP_CONNECT_URL", "TF_VAR_op_connect_url"],
  ["OPENAI_ADMIN_KEY", "OPENAI_ADMIN_KEY"],
  ["ANTHROPIC_ADMIN_KEY", "ANTHROPIC_ADMIN_KEY"],
  ["OPENROUTER_API_KEY", "OPENROUTER_API_KEY"],
  ["DISCORD_BOTS_JSON", "TF_VAR_discord_bots"],
  ["DISCORD_BOT_TOKENS_JSON", "TF_VAR_discord_bot_tokens"],
  ["DISCORD_PROVIDER_NAMES_JSON", "TF_VAR_discord_provider_names"],
  ["OPENAI_PROJECTS_JSON", "TF_VAR_openai_projects"],
  ["OPENAI_SERVICE_ACCOUNTS_JSON", "TF_VAR_openai_service_accounts"],
  ["OPENAI_ORGANIZATION_USERS_JSON", "TF_VAR_openai_organization_users"],
  ["OPENAI_PROJECT_USERS_JSON", "TF_VAR_openai_project_users"],
  ["OPENAI_PROJECT_SPEND_ALERTS_JSON", "TF_VAR_openai_project_spend_alerts"],
  ["OPENAI_GROUPS_JSON", "TF_VAR_openai_groups"],
  ["OPENAI_GROUP_USERS_JSON", "TF_VAR_openai_group_users"],
  ["OPENAI_GROUP_ROLES_JSON", "TF_VAR_openai_group_roles"],
  ["OPENAI_USER_ROLES_JSON", "TF_VAR_openai_user_roles"],
  ["OPENAI_ROLES_JSON", "TF_VAR_openai_roles"],
  ["OPENAI_CERTIFICATES_JSON", "TF_VAR_openai_certificates"],
  ["OPENAI_CERTIFICATE_VALUES_JSON", "TF_VAR_openai_certificate_values"],
  [
    "OPENAI_ORGANIZATION_SPEND_ALERTS_JSON",
    "TF_VAR_openai_organization_spend_alerts",
  ],
  [
    "OPENAI_ORGANIZATION_SPEND_LIMITS_JSON",
    "TF_VAR_openai_organization_spend_limits",
  ],
  ["OPENAI_PROJECT_GROUPS_JSON", "TF_VAR_openai_project_groups"],
  ["OPENAI_PROJECT_GROUP_ROLES_JSON", "TF_VAR_openai_project_group_roles"],
  [
    "OPENAI_PROJECT_DATA_RETENTION_JSON",
    "TF_VAR_openai_project_data_retention",
  ],
  [
    "OPENAI_PROJECT_MODEL_PERMISSIONS_JSON",
    "TF_VAR_openai_project_model_permissions",
  ],
  [
    "OPENAI_PROJECT_HOSTED_TOOL_PERMISSIONS_JSON",
    "TF_VAR_openai_project_hosted_tool_permissions",
  ],
  ["OPENAI_PROJECT_SPEND_LIMITS_JSON", "TF_VAR_openai_project_spend_limits"],
  ["OPENAI_PROJECT_RATE_LIMITS_JSON", "TF_VAR_openai_project_rate_limits"],
  ["ANTHROPIC_WORKSPACES_JSON", "TF_VAR_anthropic_workspaces"],
  ["ANTHROPIC_API_KEYS_JSON", "TF_VAR_anthropic_api_keys"],
  ["ANTHROPIC_WORKSPACE_MEMBERS_JSON", "TF_VAR_anthropic_workspace_members"],
  ["ANTHROPIC_INVITES_JSON", "TF_VAR_anthropic_invites"],
  ["OPENROUTER_WORKSPACES_JSON", "TF_VAR_openrouter_workspaces"],
  ["OPENROUTER_GUARDRAILS_JSON", "TF_VAR_openrouter_guardrails"],
  ["OPENROUTER_API_KEYS_JSON", "TF_VAR_openrouter_api_keys"],
  ["OPENROUTER_BYOK_CREDENTIALS_JSON", "TF_VAR_openrouter_byok_credentials"],
  ["OPENROUTER_BYOK_KEYS_JSON", "TF_VAR_openrouter_byok_keys"],
];

/**
 * Registry inputs whose stack drives `for_each` from them. Their OpenTofu
 * variables default to `{}`, so an absent env var does not plan "no changes" —
 * it plans the deletion of every project, credential, and bot the stack
 * manages. Each stack therefore requires its own registries rather than
 * treating them as optional.
 */
const REQUIRED_STACK_ENV: Readonly<Record<string, readonly string[]>> = {
  openai: [
    "OPENAI_PROJECTS_JSON",
    "OPENAI_SERVICE_ACCOUNTS_JSON",
    "OPENAI_ORGANIZATION_USERS_JSON",
    "OPENAI_PROJECT_USERS_JSON",
    "OPENAI_PROJECT_SPEND_ALERTS_JSON",
    "OPENAI_GROUPS_JSON",
    "OPENAI_GROUP_USERS_JSON",
    "OPENAI_GROUP_ROLES_JSON",
    "OPENAI_USER_ROLES_JSON",
    "OPENAI_ROLES_JSON",
    "OPENAI_CERTIFICATES_JSON",
    "OPENAI_CERTIFICATE_VALUES_JSON",
    "OPENAI_ORGANIZATION_SPEND_ALERTS_JSON",
    "OPENAI_ORGANIZATION_SPEND_LIMITS_JSON",
    "OPENAI_PROJECT_GROUPS_JSON",
    "OPENAI_PROJECT_GROUP_ROLES_JSON",
    "OPENAI_PROJECT_DATA_RETENTION_JSON",
    "OPENAI_PROJECT_MODEL_PERMISSIONS_JSON",
    "OPENAI_PROJECT_HOSTED_TOOL_PERMISSIONS_JSON",
    "OPENAI_PROJECT_SPEND_LIMITS_JSON",
    "OPENAI_PROJECT_RATE_LIMITS_JSON",
  ],
  anthropic: [
    "ANTHROPIC_WORKSPACES_JSON",
    "ANTHROPIC_API_KEYS_JSON",
    "ANTHROPIC_WORKSPACE_MEMBERS_JSON",
    "ANTHROPIC_INVITES_JSON",
  ],
  discord: [
    "DISCORD_BOTS_JSON",
    "DISCORD_BOT_TOKENS_JSON",
    "DISCORD_PROVIDER_NAMES_JSON",
  ],
  openrouter: [
    "OPENROUTER_WORKSPACES_JSON",
    "OPENROUTER_GUARDRAILS_JSON",
    "OPENROUTER_API_KEYS_JSON",
    "OPENROUTER_BYOK_CREDENTIALS_JSON",
    "OPENROUTER_BYOK_KEYS_JSON",
  ],
};

/**
 * Build the local filesystem mirror needed by the in-repository BYOK provider.
 * Returns the temporary root so the caller can remove it once tofu has exited.
 */
async function configureLocalOpenRouterProvider(
  env: Record<string, string>,
): Promise<string> {
  const providerRoot = new URL(
    "../../terraform-provider-openrouter-byok/",
    import.meta.url,
  ).pathname;
  const lockfile = await Bun.file(
    `${homelabRoot()}/${STACKS_REL}/openrouter/.terraform.lock.hcl`,
  ).text();
  const providerBlock =
    /provider "registry\.opentofu\.org\/shepherdjerred\/openrouter-byok"\s*\{([\s\S]*?)\n\}/.exec(
      lockfile,
    );
  const providerContents = providerBlock?.[1];
  const version =
    providerContents === undefined
      ? undefined
      : /^\s*version\s*=\s*"([^"]+)"/m.exec(providerContents)?.[1];
  if (version === undefined) {
    throw new Error(
      "OpenRouter BYOK provider version is missing from src/tofu/openrouter/.terraform.lock.hcl",
    );
  }
  const tempRoot = `${Bun.env["TMPDIR"] ?? "/tmp"}/monorepo-openrouter-byok-${process.pid.toString()}`;
  const goosResult = await run(["go", "env", "GOOS"], { capture: true });
  const goarchResult = await run(["go", "env", "GOARCH"], { capture: true });
  const goos = goosResult.stdout.trim();
  const goarch = goarchResult.stdout.trim();
  const mirrorRoot =
    `${tempRoot}/mirror/registry.opentofu.org/shepherdjerred/openrouter-byok/` +
    `${version}/${goos}_${goarch}`;
  await run(["mkdir", "-p", mirrorRoot]);
  const binaryPath = `${mirrorRoot}/terraform-provider-openrouter-byok_v${version}`;
  await run(
    ["go", "build", "-trimpath", "-buildvcs=false", "-o", binaryPath, "."],
    { cwd: providerRoot, env },
  );
  const cliConfigPath = `${tempRoot}/tofu.tfrc`;
  await Bun.write(
    cliConfigPath,
    `provider_installation {\n  filesystem_mirror {\n    path = "${tempRoot}/mirror"\n    include = ["registry.opentofu.org/shepherdjerred/openrouter-byok"]\n  }\n  direct {}\n}\n`,
  );
  env["TF_CLI_CONFIG_FILE"] = cliConfigPath;
  return tempRoot;
}

/**
 * Build the env the tofu subprocess runs with. `encryptsState` comes from the
 * stack declaring a state-encryption.tf, whose passphrase variable has no
 * default — so a missing passphrase must fail here rather than midway through
 * `tofu init`.
 */
function buildTofuEnv(
  stack: string,
  encryptsState: boolean,
): Record<string, string> {
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

  // Deliberately not `requireEnv`: check-ci-env unions every requireEnv in a
  // script's import graph, so literal calls here would demand every platform
  // registry of every step that runs this script, including the infra stacks.
  const missingRegistries = (REQUIRED_STACK_ENV[stack] ?? []).filter(
    (source) => optionalEnv(source) === null,
  );
  if (missingRegistries.length > 0) {
    throw new Error(
      `Stack "${stack}" drives resources from registries that are missing from the ` +
        `environment: ${missingRegistries.join(", ")}. These default to an empty map, so ` +
        `running without them plans a destroy of everything the stack manages.`,
    );
  }
  if (
    encryptsState &&
    optionalEnv("TOFU_STATE_ENCRYPTION_PASSPHRASE") === null
  ) {
    throw new Error(
      `Stack "${stack}" encrypts its state and plan, so it requires ` +
        `TOFU_STATE_ENCRYPTION_PASSPHRASE. Without it OpenTofu fails later, ` +
        `inside init or plan, with a less actionable error.`,
    );
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
  if (!(await Bun.file(`${stackDir}/providers.tf`).exists())) {
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

  const env = buildTofuEnv(
    stack,
    await Bun.file(`${stackDir}/state-encryption.tf`).exists(),
  );

  const localProviderRoot =
    stack === "openrouter" ? await configureLocalOpenRouterProvider(env) : null;
  let tofuError: unknown;
  try {
    await runTofu(stack, action, root, env);
  } catch (error) {
    tofuError = error;
  }

  let cleanupError: unknown;
  // The mirror holds a freshly built provider binary and a CLI config that
  // only this run uses, so it is removed after tofu exits.
  if (localProviderRoot !== null) {
    try {
      await run(["rm", "-rf", localProviderRoot]);
    } catch (error) {
      cleanupError = error;
      console.error(
        `Failed to clean up OpenRouter provider mirror at ${localProviderRoot}:`,
        error,
      );
    }
  }

  if (tofuError !== undefined) {
    throw toError(tofuError);
  }
  if (cleanupError !== undefined) {
    throw toError(cleanupError);
  }
}

async function runTofu(
  stack: string,
  action: "plan" | "apply",
  root: string,
  env: Record<string, string>,
): Promise<void> {
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
