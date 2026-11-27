/**
 * Types for `toolkit screenshot` — booting a package's dev server and
 * capturing what it renders via PinchTab.
 */

/** Named auth flows a package's routes may require before navigating. */
export type AuthFlow = "scout-dev-login" | "streambot-preview-login";

/** How `ensureDevServer` passes an isolated bound port to `devCommand`. */
export type DevRunner =
  "astro" | "vite" | "port-env" | "hub-dev-fixture" | "scout-dev-web";

/** A screenshot-able package and how to boot/reach it. */
export type PackageEntry = {
  /** CLI selector, e.g. "sjer-red", "scout-app". */
  alias: string;
  /** Repo-root-relative directory to spawn `devCommand` in. */
  cwd: string;
  /** Command + args to boot the dev server, e.g. ["bun", "run", "dev"]. */
  devCommand: string[];
  /** How `ensureDevServer` injects the allocated port into the child process. */
  devRunner: DevRunner;
  /**
   * Preferred default port hint. `ensureDevServer` binds this port when free
   * and falls back automatically to an unused loopback port when busy so
   * concurrent worktrees never collide or reuse an unrelated server.
   */
  expectedPort: number;
  /** Path navigated to when no route is given on the CLI. */
  defaultRoute: string;
  /** HTTP path polled for readiness; defaults to `defaultRoute` when unset. */
  readyPath?: string;
  /** Auth flow required before the target route is reachable, if any. */
  requiresAuth?: AuthFlow;
  /** Environment needed only by the isolated server process. */
  serverEnv?: Record<string, string>;
};
