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
   * The port the dev server must bind. It is authoritative, not a hint: every
   * run spawns a fresh server that must bind exactly this port (we never reuse
   * an already-running one — a probe can't verify it's the right app — and we
   * don't parse an auto-bumped port back from stdout, since dev commands print
   * inconsistent/hard-coded banners). If the port is already in use,
   * `ensureDevServer` fails fast rather than guessing.
   */
  expectedPort: number;
  /** Path navigated to when no route is given on the CLI. */
  defaultRoute: string;
  /** HTTP path polled for readiness; defaults to `defaultRoute` when unset. */
  readyPath?: string;
  /** Auth flow required before the target route is reachable, if any. */
  requiresAuth?: AuthFlow;
};
