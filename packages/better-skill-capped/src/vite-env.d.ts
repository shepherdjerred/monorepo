/// <reference types="vite/client" />

// Fallback declarations for environments where vite/client types may not resolve.
type ImportMetaEnv = {
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly SSR: boolean;
  // Injected at build time by the CI site-deploy step (2.0.0-<build>).
  readonly VITE_SENTRY_RELEASE?: string;
  [key: string]: string | boolean | undefined;
};

type ImportMeta = {
  readonly env: ImportMetaEnv;
};
