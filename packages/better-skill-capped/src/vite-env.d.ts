/// <reference types="vite/client" />

// Augment vite/client's `ImportMetaEnv` with our build-time vars. `vite/client`
// already declares `interface ImportMetaEnv` (MODE/BASE_URL/PROD/DEV/SSR), so
// declaration merging via `interface` is the only way to add keys without a
// "Duplicate identifier" collision — a `type` alias cannot merge into it.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- interface required for vite/client ImportMetaEnv declaration merging
interface ImportMetaEnv {
  // Injected at build time by the CI site-deploy step (2.0.0-<build>).
  readonly VITE_SENTRY_RELEASE?: string;
}
