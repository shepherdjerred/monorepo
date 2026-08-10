/// <reference types="vite/client" />

// Augment vite/client's `ImportMetaEnv` with our build-time vars. `vite/client`
// already declares `interface ImportMetaEnv` (MODE/BASE_URL/PROD/DEV/SSR), so
// declaration merging via `interface` is the only way to add keys without a
// "Duplicate identifier" collision — a `type` alias cannot merge into it.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- interface required for vite/client ImportMetaEnv declaration merging
interface ImportMetaEnv {
  // All injected at site-release build time (scripts/scout-site-release.ts);
  // absent in local dev, so every key is optional.
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_GIT_SHA?: string;
  readonly VITE_CONTRACT_HASH?: string;
  readonly VITE_DISCORD_CLIENT_ID?: string;
  // PostHog project/site configuration; absent locally so initialization
  // no-ops. The project token is a public frontend identifier, not a secret.
  readonly VITE_POSTHOG_PROJECT_TOKEN?: string;
  readonly VITE_POSTHOG_API_HOST?: string;
  readonly VITE_POSTHOG_ASSET_HOST?: string;
  readonly VITE_POSTHOG_SITE_KEY?: string;
  readonly VITE_POSTHOG_SITE_DOMAIN?: string;
  readonly VITE_POSTHOG_SESSION_REPLAY?: "true" | "false";
}
