/**
 * Types for `toolkit screenshot` — booting a package's dev server and
 * capturing what it renders via PinchTab.
 */

/** Named auth flows a package's routes may require before navigating. */
export type AuthFlow = "scout-dev-login";

/** A screenshot-able package and how to boot/reach it. */
export type PackageEntry = {
  /** CLI selector, e.g. "sjer-red", "scout-app". */
  alias: string;
  /** Repo-root-relative directory to spawn `devCommand` in. */
  cwd: string;
  /** Command + args to boot the dev server, e.g. ["bun", "run", "dev"]. */
  devCommand: string[];
  /**
   * Default bound port, used only as a fast reuse-detection probe — Astro
   * and Vite both auto-bump to the next free port if this one is taken, so
   * the actual bound URL is always discovered from the spawned process's
   * own stdout banner, never assumed from this field.
   */
  expectedPort: number;
  /** Path navigated to when no route is given on the CLI. */
  defaultRoute: string;
  /** HTTP path polled for readiness; defaults to `defaultRoute` when unset. */
  readyPath?: string;
  /** Auth flow required before the target route is reachable, if any. */
  requiresAuth?: AuthFlow;
};
