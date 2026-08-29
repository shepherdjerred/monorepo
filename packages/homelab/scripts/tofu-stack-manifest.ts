import type { PlatformStack } from "./platform-desired-state.ts";

export type CredentialMapping = {
  source: string;
  target: string;
};

export type StackDefinition = {
  credentials: readonly CredentialMapping[];
  secretObject?: {
    target: string;
    entries: Readonly<Record<string, string>>;
  };
  platform?: PlatformStack;
  encrypted?: true;
  localProvider?: "asuswrt";
};

export type TofuStack =
  | "anthropic"
  | "argocd"
  | "arr"
  | "asuswrt"
  | "buildkite"
  | "cloudflare"
  | "cloudflare-tokens"
  | "discord"
  | "github"
  | "openai"
  | "openrouter"
  | "posthog"
  | "seaweedfs"
  | "tailscale";

export const STATE_CREDENTIALS: readonly CredentialMapping[] = [
  {
    source: "SEAWEEDFS_STATE_ACCESS_KEY_ID",
    target: "AWS_ACCESS_KEY_ID",
  },
  {
    source: "SEAWEEDFS_STATE_SECRET_ACCESS_KEY",
    target: "AWS_SECRET_ACCESS_KEY",
  },
];

export const STACK_MANIFEST: Readonly<Record<TofuStack, StackDefinition>> = {
  anthropic: {
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
  argocd: {
    credentials: [
      { source: "ARGOCD_AUTH_TOKEN", target: "TF_VAR_argocd_auth_token" },
      { source: "OP_CONNECT_TOKEN", target: "OP_CONNECT_TOKEN" },
    ],
  },
  arr: {
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
  asuswrt: {
    localProvider: "asuswrt",
    credentials: [
      { source: "ASUSWRT_USERNAME", target: "TF_VAR_asuswrt_username" },
      { source: "ASUSWRT_PASSWORD", target: "TF_VAR_asuswrt_password" },
    ],
  },
  buildkite: {
    credentials: [
      { source: "BUILDKITE_ADMIN_TOKEN", target: "TF_VAR_buildkite_api_token" },
    ],
  },
  cloudflare: {
    credentials: [
      {
        source: "CLOUDFLARE_ACCOUNT_ID",
        target: "TF_VAR_cloudflare_account_id",
      },
      { source: "CLOUDFLARE_API_TOKEN", target: "CLOUDFLARE_API_TOKEN" },
    ],
  },
  "cloudflare-tokens": {
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
    credentials: [
      { source: "TOFU_GITHUB_TOKEN", target: "TF_VAR_github_token" },
    ],
  },
  openai: {
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
  openrouter: {
    platform: "openrouter",
    encrypted: true,
    credentials: [
      {
        source: "OPENROUTER_MANAGEMENT_KEY",
        target: "OPENROUTER_MANAGEMENT_KEY",
      },
      {
        source: "OPENROUTER_BYOK_KEYS_JSON",
        target: "TF_VAR_openrouter_byok_keys",
      },
      {
        source: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
        target: "TF_VAR_tofu_state_encryption_passphrase",
      },
    ],
  },
  posthog: {
    credentials: [
      { source: "POSTHOG_CLI_API_KEY", target: "POSTHOG_API_KEY" },
      {
        source: "POSTHOG_TOFU_STATE_PASSPHRASE",
        target: "TF_VAR_state_passphrase",
      },
    ],
  },
  seaweedfs: {
    credentials: [
      {
        source: "SEAWEEDFS_DEPLOY_ACCESS_KEY_ID",
        target: "TF_VAR_seaweedfs_access_key_id",
      },
      {
        source: "SEAWEEDFS_DEPLOY_SECRET_ACCESS_KEY",
        target: "TF_VAR_seaweedfs_secret_access_key",
      },
    ],
  },
  tailscale: {
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

const TOFU_STACKS: readonly TofuStack[] = [
  "anthropic",
  "argocd",
  "arr",
  "asuswrt",
  "buildkite",
  "cloudflare",
  "cloudflare-tokens",
  "discord",
  "github",
  "openai",
  "openrouter",
  "posthog",
  "seaweedfs",
  "tailscale",
];

export function parseTofuStack(value: string): TofuStack {
  const stack = TOFU_STACKS.find((candidate) => candidate === value);
  if (stack === undefined) throw new Error(`Unknown OpenTofu stack: ${value}`);
  return stack;
}
