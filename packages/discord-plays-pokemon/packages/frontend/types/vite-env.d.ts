/// <reference types="vite/client" />

// Fallback declarations for environments where vite/client types may not resolve
// (e.g. Bazel sandbox where Vite is not a direct dependency)
type ImportMetaEnv = {
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly SSR: boolean;
  [key: string]: string | boolean | undefined;
};

type ImportMeta = {
  readonly env: ImportMetaEnv;
};
