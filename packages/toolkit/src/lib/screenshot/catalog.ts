/**
 * Registry for `toolkit screenshot` — a runtime-local table on purpose (same
 * rationale as `lib/deployed/catalog.ts`): which packages have a
 * screenshot-able dev server, and how to boot each one.
 *
 * Deliberately excluded, not silently guessed at:
 * - `astro-opengraph-images` has no `dev` script (build-time codegen only).
 * - `scout-for-lol/packages/desktop` (Tauri/Rust) has no browser-drivable
 *   dev server.
 * - `tasks-for-obsidian` (React Native/Metro) needs a simulator/device, not
 *   a browser.
 */
import type { PackageEntry } from "./types.ts";

export const PACKAGES: PackageEntry[] = [
  {
    alias: "sjer-red",
    cwd: "packages/sjer.red",
    devCommand: ["bun", "run", "dev"],
    expectedPort: 4321,
    defaultRoute: "/",
  },
  {
    alias: "stocks-sjer-red",
    cwd: "packages/stocks-sjer-red",
    devCommand: ["bun", "run", "dev"],
    expectedPort: 4321,
    defaultRoute: "/",
  },
  {
    alias: "cooklang-rich-preview",
    cwd: "packages/cooklang-rich-preview",
    devCommand: ["bun", "run", "dev"],
    expectedPort: 4321,
    defaultRoute: "/",
  },
  {
    alias: "better-skill-capped",
    cwd: "packages/better-skill-capped",
    devCommand: ["bun", "run", "start"],
    expectedPort: 5173,
    defaultRoute: "/",
  },
  {
    alias: "docs-board",
    cwd: "packages/docs-board",
    devCommand: ["bun", "run", "dev"],
    expectedPort: 7332,
    defaultRoute: "/",
  },
  {
    alias: "scout-marketing",
    cwd: "packages/scout-for-lol/packages/frontend",
    devCommand: ["bun", "run", "dev"],
    expectedPort: 4321,
    defaultRoute: "/",
  },
  {
    alias: "mario-kart-frontend",
    cwd: "packages/discord-plays-mario-kart/packages/frontend",
    devCommand: ["bun", "run", "dev"],
    expectedPort: 5173,
    defaultRoute: "/",
  },
  {
    alias: "pokemon-frontend",
    cwd: "packages/discord-plays-pokemon/packages/frontend",
    devCommand: ["bun", "run", "dev"],
    expectedPort: 5173,
    defaultRoute: "/",
  },
  {
    alias: "scout-app",
    cwd: "packages/scout-for-lol",
    devCommand: ["bun", "run", "dev:web"],
    // dev:web boots the backend (:3000) AND the Vite dev server; the Vite
    // port is what a browser actually navigates to (it proxies /trpc +
    // /api to the backend), so that's the port this entry probes/waits on.
    expectedPort: 5180,
    defaultRoute: "/app/",
    // Wait on a backend-backed path (Vite proxies /api → :3000), not just the
    // SPA shell. The backend takes ~5s to open its listener after Vite is up;
    // probing /app/ alone would let the auth flow navigate to the proxied
    // /api/dev/login before the backend exists, yielding a proxy error.
    readyPath: "/api/version",
    requiresAuth: "scout-dev-login",
  },
];

export function resolvePackage(alias: string): PackageEntry {
  const entry = PACKAGES.find((p) => p.alias === alias);
  if (entry === undefined) {
    const known = PACKAGES.map((p) => p.alias).join(", ");
    throw new Error(`Unknown package "${alias}". Known aliases: ${known}`);
  }
  return entry;
}
