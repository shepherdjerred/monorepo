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
  // Matomo site identity for product analytics; per-flavor (prod
  // scout-for-lol.com, beta beta.scout-for-lol.com). Absent locally → no-op.
  readonly VITE_MATOMO_SITE_ID?: string;
  readonly VITE_MATOMO_SITE_DOMAIN?: string;
  readonly VITE_MATOMO_SRC?: string;
}
