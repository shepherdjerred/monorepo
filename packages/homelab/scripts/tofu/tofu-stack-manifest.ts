import type { PlatformStack } from "#scripts/platform-desired-state.ts";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import type { TofuStack } from "@shepherdjerred/ops-model/platform-policy.ts";

export type CredentialMapping = {
  source: string;
  target: string;
};

export type StackDefinition = {
  credentials: readonly CredentialMapping[];
  /**
   * Repository files outside the stack directory that its configuration reads
   * at plan time through `file()` and friends. The archive producer freezes
   * exactly these next to the stack, and the external-file lint fails on any
   * other reference that escapes the directory.
   */
  externalFiles: readonly string[];
  secretObject?: {
    target: string;
    entries: Readonly<Record<string, string>>;
  };
  platform?: PlatformStack;
  encrypted?: true;
  validationPassphraseVariable?: "state_passphrase";
  localProvider?: "asuswrt";
  operatorOnly?: true;
};

export const STATE_CREDENTIALS: readonly CredentialMapping[] = [
  {
    source: "SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID",
    target: "AWS_ACCESS_KEY_ID",
  },
  {
    source: "SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY",
    target: "AWS_SECRET_ACCESS_KEY",
  },
];

export const STACK_MANIFEST: Readonly<Record<TofuStack, StackDefinition>> = {
  "application-secrets": {
    externalFiles: [],
    encrypted: true,
    credentials: [
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
  },
  anthropic: {
    externalFiles: [],
    platform: "anthropic",
    encrypted: true,
    credentials: [
      {
        source: "ANTHROPIC_ADMIN_API_KEY",
        target: "ANTHROPIC_ADMIN_API_KEY",
      },
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
  },
  // Operator-applied only. Federation endpoints accept nothing but a
  // short-lived `org:admin` OAuth token minted with `ant auth login`, so there is
  // no credential CI could hold; workspaces still take the Admin API key.
  "anthropic-federation": {
    externalFiles: [],
    platform: "anthropic-federation",
    encrypted: true,
    credentials: [
      {
        source: "ANTHROPIC_ADMIN_API_KEY",
        target: "ANTHROPIC_ADMIN_API_KEY",
      },
      { source: "ANTHROPIC_AUTH_TOKEN", target: "ANTHROPIC_AUTH_TOKEN" },
      // Names the 1Password account whose desktop app authorizes the item writes.
      { source: "OP_ACCOUNT", target: "OP_ACCOUNT" },
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
  },
  // The tofu-argocd account's token, never the operator's own ARGOCD_AUTH_TOKEN:
  // that account can only read and issue tokens for the accounts this stack
  // mints. Operator-run until Delivery Jobs have a 1Password write path.
  argocd: {
    externalFiles: [],
    credentials: [
      { source: "TOFU_ARGOCD_AUTH_TOKEN", target: "TF_VAR_argocd_auth_token" },
      {
        source: "OP_SERVICE_ACCOUNT_TOKEN",
        target: "OP_SERVICE_ACCOUNT_TOKEN",
      },
    ],
  },
  arr: {
    externalFiles: [],
    credentials: [
      { source: "RADARR_API_KEY", target: "TF_VAR_radarr_api_key" },
      { source: "SONARR_API_KEY", target: "TF_VAR_sonarr_api_key" },
      { source: "PROWLARR_API_KEY", target: "TF_VAR_prowlarr_api_key" },
      {
        source: "QBITTORRENT_PASSWORD",
        target: "TF_VAR_qbittorrent_password",
      },
      { source: "PRIVATEHD_PASSWORD", target: "TF_VAR_privatehd_password" },
      { source: "PRIVATEHD_PID", target: "TF_VAR_privatehd_pid" },
      { source: "AVISTAZ_PASSWORD", target: "TF_VAR_avistaz_password" },
      { source: "AVISTAZ_PID", target: "TF_VAR_avistaz_pid" },
      { source: "ANIMEZ_PASSWORD", target: "TF_VAR_animez_password" },
      { source: "ANIMEZ_PID", target: "TF_VAR_animez_pid" },
    ],
  },
  backblaze: {
    externalFiles: [],
    operatorOnly: true,
    encrypted: true,
    credentials: [
      { source: "B2_APPLICATION_KEY_ID", target: "B2_APPLICATION_KEY_ID" },
      { source: "B2_APPLICATION_KEY", target: "B2_APPLICATION_KEY" },
      { source: "OP_ACCOUNT", target: "OP_ACCOUNT" },
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
  },
  asuswrt: {
    externalFiles: [],
    localProvider: "asuswrt",
    credentials: [
      { source: "ASUSWRT_USERNAME", target: "TF_VAR_asuswrt_username" },
      { source: "ASUSWRT_PASSWORD", target: "TF_VAR_asuswrt_password" },
    ],
  },
  cloudflare: {
    externalFiles: ["packages/homelab/src/domain-registry.json"],
    credentials: [
      {
        source: "CLOUDFLARE_ACCOUNT_ID",
        target: "TF_VAR_cloudflare_account_id",
      },
      { source: "CLOUDFLARE_API_TOKEN", target: "CLOUDFLARE_API_TOKEN" },
    ],
  },
  "cloudflare-tokens": {
    externalFiles: [],
    platform: "cloudflare-tokens",
    encrypted: true,
    credentials: [
      { source: "CLOUDFLARE_API_TOKEN", target: "CLOUDFLARE_API_TOKEN" },
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
  },
  discord: {
    externalFiles: [],
    platform: "discord",
    encrypted: true,
    credentials: [
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
    secretObject: {
      target: "TF_VAR_discord_bot_tokens",
      entries: {
        birmel: "DISCORD_BIRMEL_BOT_TOKEN",
        "starlight-beta": "DISCORD_STARLIGHT_BETA_BOT_TOKEN",
        "starlight-prod": "DISCORD_STARLIGHT_PROD_BOT_TOKEN",
        "scout-beta": "DISCORD_SCOUT_BETA_BOT_TOKEN",
        "scout-prod": "DISCORD_SCOUT_PROD_BOT_TOKEN",
        minecraft: "DISCORD_MINECRAFT_BOT_TOKEN",
      },
    },
  },
  github: {
    externalFiles: [],
    credentials: [
      { source: "TOFU_GITHUB_TOKEN", target: "TF_VAR_github_token" },
    ],
  },
  dockerhub: {
    externalFiles: ["packages/version-catalog/src/image-registry.json"],
    encrypted: true,
    credentials: [
      { source: "DOCKERHUB_USERNAME", target: "DOCKER_USERNAME" },
      { source: "DOCKERHUB_MANAGEMENT_TOKEN", target: "DOCKER_PASSWORD" },
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
  },
  "dockerhub-tokens": {
    externalFiles: [],
    encrypted: true,
    operatorOnly: true,
    credentials: [
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
  },
  // Operator-applied only, authenticated by the operator's own Application
  // Default Credentials (found through HOME). Without a Google Cloud
  // organization only a user account can create projects, so there is no
  // bootstrap key CI could hold that would do this stack's job.
  google: {
    externalFiles: [],
    platform: "google",
    encrypted: true,
    credentials: [
      // Names the 1Password account whose desktop app authorizes the item writes.
      { source: "OP_ACCOUNT", target: "OP_ACCOUNT" },
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
  },
  openai: {
    externalFiles: [],
    platform: "openai",
    encrypted: true,
    credentials: [
      { source: "OPENAI_ADMIN_KEY", target: "OPENAI_ADMIN_KEY" },
      { source: "OPENAI_ADMIN_KEY", target: "OPENAI_API_KEY" },
      {
        source: "OPENAI_CERTIFICATE_VALUES_JSON",
        target: "TF_VAR_openai_certificate_values",
      },
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
  },
  posthog: {
    externalFiles: ["config/analytics-sites.json"],
    validationPassphraseVariable: "state_passphrase",
    credentials: [
      { source: "POSTHOG_CLI_API_KEY", target: "POSTHOG_API_KEY" },
      {
        source: "POSTHOG_TOFU_STATE_PASSPHRASE",
        target: "TF_VAR_state_passphrase",
      },
    ],
  },
  seaweedfs: {
    externalFiles: [],
    credentials: [
      {
        source: "SEAWEEDFS_TOFU_ADMIN_ACCESS_KEY_ID",
        target: "TF_VAR_seaweedfs_access_key_id",
      },
      {
        source: "SEAWEEDFS_TOFU_ADMIN_SECRET_ACCESS_KEY",
        target: "TF_VAR_seaweedfs_secret_access_key",
      },
    ],
  },
  tailscale: {
    externalFiles: [],
    credentials: [
      {
        source: "TAILSCALE_OAUTH_CLIENT_ID",
        target: "TAILSCALE_OAUTH_CLIENT_ID",
      },
      {
        source: "TAILSCALE_OAUTH_CLIENT_SECRET",
        target: "TAILSCALE_OAUTH_CLIENT_SECRET",
      },
    ],
  },
};

export function parseTofuStack(value: string): TofuStack {
  const stack = TofuStackSchema.safeParse(value);
  if (!stack.success) throw new Error(`Unknown OpenTofu stack: ${value}`);
  return stack.data;
}
