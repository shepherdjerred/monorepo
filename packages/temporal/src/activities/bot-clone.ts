import { runCommand } from "./data-dragon-shell.ts";

// Environment preparation for the ephemeral bot clones the deterministic
// PR-creating activities (data-dragon, scout-season-refresh, readme-refresh)
// make under /tmp. Every activity that clones the monorepo MUST prepare the
// clone through these helpers — the `temporal-schedule-rehearsal` CI step
// drives these exact functions against the PR's tree, so environment logic
// added here is what gets validated at PR time. Hand-rolling install steps in
// an activity puts them outside that safety net (which is how the weekly
// refreshes silently broke for a month — see
// packages/docs/plans/2026-07-11_fix-temporal-weekly-refreshes.md).

/**
 * Root `bun install` for an ephemeral bot clone, with lifecycle scripts
 * suppressed. Bot clones are not dev checkouts: the root `prepare` script
 * runs `lefthook install`, which would arm the full dev pre-commit suite for
 * the bot's later `git commit` — inside the worker pod, where the hook
 * environment (gitleaks binary, per-package toolchains) doesn't exist.
 * Buildkite CI on the PR the bot opens is the real quality gate. Root
 * devDependencies (prettier, prettier-plugin-astro, lefthook, knip,
 * markdownlint) have no lifecycle scripts of their own, so `--ignore-scripts`
 * loses nothing else.
 */
export async function rootInstallWithoutHooks(repoDir: string): Promise<void> {
  await runCommand(
    ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
    { cwd: repoDir },
  );
}

/**
 * Build the `@shepherdjerred/llm-models` `file:` producer inside a bot clone.
 * Its `dist/` entrypoint is gitignored, so a fresh clone ships it unbuilt and
 * any later `bun install` in a consumer workspace copies a broken package
 * (`Cannot find module '@shepherdjerred/llm-models'`). Must run BEFORE the
 * consumer's install so the copy picks up `dist/`. Mirrors
 * `withBuiltLlmModels` in `.dagger/src/image.ts` and the Phase 3 build in
 * `scripts/setup.ts`.
 */
export async function buildLlmModels(repoDir: string): Promise<void> {
  const pkgDir = `${repoDir}/packages/llm-models`;
  await runCommand(["bun", "install", "--frozen-lockfile"], { cwd: pkgDir });
  await runCommand(["bun", "run", "build"], { cwd: pkgDir });
}

/**
 * Install the scout-for-lol workspace in a bot clone: build the llm-models
 * producer first, then install at the workspace root so the built `file:`
 * dep is copied in.
 */
export async function installScoutWorkspace(repoDir: string): Promise<void> {
  await buildLlmModels(repoDir);
  await runCommand(["bun", "install", "--frozen-lockfile"], {
    cwd: `${repoDir}/packages/scout-for-lol`,
  });
}

/**
 * Forcibly disarm any git hooks armed in this ephemeral clone, regardless of
 * how they got armed. `rootInstallWithoutHooks`'s `--ignore-scripts` only
 * prevents ITS OWN call from arming hooks — it can't un-arm hooks a prior,
 * uncontrolled subprocess already installed (e.g. an agentic `claude -p` /
 * `codex exec` session with Bash access running a plain `bun install` on its
 * own initiative before this point, which is what broke
 * `scout-season-refresh-weekly` on 2026-07-12: Claude has Bash access and
 * `packages/scout-for-lol/CLAUDE.md` documents "run `bun install` to re-copy
 * stale deps" — correct advice for a human dev checkout, but it arms lefthook
 * when followed inside a bot clone). Call this immediately before any
 * bot-style `git commit` in a bot clone, as a mechanism-agnostic safety net —
 * it doesn't matter what armed the hooks, only that they're gone before the
 * commit that must not trigger them.
 */
export async function disarmGitHooks(repoDir: string): Promise<void> {
  await runCommand(
    ["find", ".git/hooks", "-type", "f", "!", "-name", "*.sample", "-delete"],
    { cwd: repoDir },
  );
}
