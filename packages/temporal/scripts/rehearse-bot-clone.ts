/**
 * Rehearse the scheduled PR-creating workflows' environment preparation
 * against a repo checkout — "will the weekly Temporal jobs still run after
 * this change merges?"
 *
 * Driven by the `temporal-schedule-rehearsal` CI step, which runs this script
 * inside the PR's temporal-worker image against the PR's repo tree. It calls
 * the SAME `bot-clone.ts` helpers the activities call (never a transcription
 * of them), so the rehearsal cannot drift from what production executes.
 *
 * Canaries (each maps to a real weekly failure from June/July 2026):
 *  1. scout  — llm-models `file:` producer builds and resolves from
 *              scout's data package, and the snapshot test that died in the
 *              scout-data-dragon-weekly-refresh runs passes.
 *  2. hooks  — the hook-free root install leaves no lefthook hooks, a
 *              simulated agentic step (a plain `bun install`, standing in for
 *              a `claude -p`/`codex exec` session that might run one on its
 *              own) re-arms them, `disarmGitHooks` removes them again,
 *              prettier (with plugins) formats the season changelog
 *              byte-stably, and a bot-style `git commit` of a scout file
 *              succeeds without any pre-commit hook running
 *              (scout-season-refresh-weekly, and the 2026-07-12 recurrence
 *              where Claude's own `bun install` armed hooks that
 *              `rootInstallWithoutHooks` alone couldn't undo).
 *  3. cog    — the readme-refresh COG_TARGETS exist, still contain `[[[cog`
 *              blocks, and the `cog` binary is present (readme-refresh-weekly).
 *
 * Deliberately NOT rehearsed: asset downloads, Claude/Codex calls, and the
 * full `cog -r` regeneration (needs blobless git history + Codex for new
 * packages) — those never broke; the environment around them did.
 *
 * Usage: bun run scripts/rehearse-bot-clone.ts --repo=/abs/path/to/monorepo
 * The target may be a plain directory (no .git) — a scratch repo is
 * initialized so the commit canary can run.
 */
import {
  disarmGitHooks,
  installScoutWorkspace,
  rootInstallWithoutHooks,
} from "#activities/bot-clone.ts";
import { runCommand } from "#activities/data-dragon-shell.ts";
import { COG_TARGETS } from "#activities/readme-refresh.ts";
import {
  CHANGELOG_FILE,
  SEASONS_FILE,
} from "#activities/scout-season-refresh.ts";

// The exact test that failed in the scout-data-dragon-weekly-refresh runs of
// 2026-06-20 → 2026-07-11 (via `update-data-dragon.ts`'s snapshot refresh).
const REPORT_PACKAGE = "packages/scout-for-lol/packages/report";
const REALDATA_TEST = "src/html/arena/realdata.integration.test.ts";
// The import that broke: packages/data → @shepherdjerred/llm-models.
const DATA_PACKAGE = "packages/scout-for-lol/packages/data";

function parseRepoArg(argv: readonly string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--repo=")) return arg.slice("--repo=".length);
  }
  throw new Error("usage: rehearse-bot-clone.ts --repo=/abs/path/to/monorepo");
}

async function ensureScratchGitRepo(repoDir: string): Promise<void> {
  const hasGit = await Bun.file(`${repoDir}/.git/HEAD`).exists();
  if (!hasGit) {
    // CI mounts the repo tree without .git; the commit canary needs one.
    await runCommand(["git", "init", "--initial-branch", "rehearsal"], {
      cwd: repoDir,
    });
  }
  // Repo-local identity (mirrors openSeasonRefreshPr) — never --global, so a
  // local run of this script can't touch the developer's gitconfig.
  await runCommand(["git", "config", "user.email", "ci@sjer.red"], {
    cwd: repoDir,
  });
  await runCommand(["git", "config", "user.name", "CI Bot"], {
    cwd: repoDir,
  });
  if (hasGit) return;
  await runCommand(["git", "add", "."], { cwd: repoDir });
  await runCommand(["git", "commit", "-m", "rehearsal baseline", "--quiet"], {
    cwd: repoDir,
  });
}

async function rehearseScoutWorkspace(repoDir: string): Promise<void> {
  console.error("[rehearsal] scout: installScoutWorkspace (builds llm-models)");
  await installScoutWorkspace(repoDir);
  console.error("[rehearsal] scout: resolving @shepherdjerred/llm-models");
  await runCommand(
    ["bun", "-e", "await import('@shepherdjerred/llm-models')"],
    { cwd: `${repoDir}/${DATA_PACKAGE}` },
  );
  console.error(`[rehearsal] scout: bun test ${REALDATA_TEST}`);
  // Clear ENVIRONMENT like data-dragon.ts does: scout's env-var validation
  // rejects the worker pod's ENVIRONMENT=production.
  await runCommand(["bun", "test", REALDATA_TEST], {
    cwd: `${repoDir}/${REPORT_PACKAGE}`,
    env: { ENVIRONMENT: undefined },
  });
}

async function armedHookNames(repoDir: string): Promise<string[]> {
  const hooksDir = `${repoDir}/.git/hooks`;
  const hookList = await runCommand(["ls", hooksDir], { cwd: repoDir });
  return hookList
    .split("\n")
    .filter((name) => name !== "" && !name.endsWith(".sample"));
}

async function rehearseHookFreeCommit(repoDir: string): Promise<void> {
  console.error("[rehearsal] hooks: rootInstallWithoutHooks");
  await rootInstallWithoutHooks(repoDir);

  const armedAfterInstall = await armedHookNames(repoDir);
  if (armedAfterInstall.length > 0) {
    throw new Error(
      `hook-free install still armed git hooks: ${armedAfterInstall.join(", ")} — ` +
        "did the root `prepare` script run? Bot commits would hit lefthook.",
    );
  }
  console.error("[rehearsal] hooks: no git hooks armed");

  // Simulate an agentic Claude/Codex step (which runs between the pre-install
  // and the final commit in scout-season-refresh.ts / readme-refresh.ts)
  // deciding on its own to run a plain `bun install` — exactly what armed
  // lefthook in the 2026-07-12 scout-season-refresh-weekly failure.
  console.error(
    "[rehearsal] hooks: simulating an agentic step's plain `bun install`",
  );
  await runCommand(["bun", "install", "--frozen-lockfile"], { cwd: repoDir });
  const armedAfterPlainInstall = await armedHookNames(repoDir);
  if (armedAfterPlainInstall.length === 0) {
    throw new Error(
      "expected the simulated plain `bun install` to arm git hooks (it should " +
        "run the root `prepare` script) — if this no longer arms hooks, the " +
        "canary's premise is stale and needs re-deriving from the real bug.",
    );
  }
  console.error(
    `[rehearsal] hooks: confirmed armed (${armedAfterPlainInstall.join(", ")}) — now disarming`,
  );

  await disarmGitHooks(repoDir);
  const armedAfterDisarm = await armedHookNames(repoDir);
  if (armedAfterDisarm.length > 0) {
    throw new Error(
      `disarmGitHooks left hooks armed: ${armedAfterDisarm.join(", ")}`,
    );
  }
  console.error("[rehearsal] hooks: disarmGitHooks removed the armed hooks");

  console.error("[rehearsal] hooks: prettier --write on the season changelog");
  await runCommand(["bunx", "prettier", "--write", CHANGELOG_FILE], {
    cwd: repoDir,
  });
  const changelogStatus = await runCommand(
    ["git", "status", "--porcelain", "--", CHANGELOG_FILE],
    { cwd: repoDir },
  );
  if (changelogStatus !== "") {
    throw new Error(
      `prettier is not byte-stable on ${CHANGELOG_FILE}: ${changelogStatus}`,
    );
  }

  console.error("[rehearsal] hooks: bot-style commit of a scout file");
  const seasonsPath = `${repoDir}/${SEASONS_FILE}`;
  const original = await Bun.file(seasonsPath).text();
  await Bun.write(seasonsPath, `${original}// rehearsal canary\n`);
  await runCommand(["git", "add", "--", SEASONS_FILE], { cwd: repoDir });
  const commitOutput = await runCommand(
    ["git", "commit", "-m", "rehearsal: bot commit canary"],
    { cwd: repoDir },
  );
  if (/lefthook/i.test(commitOutput)) {
    throw new Error(`lefthook ran during the bot commit:\n${commitOutput}`);
  }
  console.error("[rehearsal] hooks: commit succeeded without pre-commit hooks");
}

async function rehearseCogTargets(repoDir: string): Promise<void> {
  console.error("[rehearsal] cog: verifying binary + targets");
  // cogapp has no --version long flag; -v prints the version.
  await runCommand(["cog", "-v"], { cwd: repoDir });
  for (const target of COG_TARGETS) {
    const file = Bun.file(`${repoDir}/${target}`);
    if (!(await file.exists())) {
      throw new Error(
        `COG_TARGETS entry does not exist in the tree: ${target} — ` +
          "readme-refresh-weekly would fail with FileNotFoundError " +
          "(this is exactly how the June 2026 sandbox/ move broke it).",
      );
    }
    const content = await file.text();
    if (!content.includes("[[[cog")) {
      throw new Error(`COG_TARGETS entry has no [[[cog block: ${target}`);
    }
  }
  console.error(`[rehearsal] cog: ${String(COG_TARGETS.length)} targets OK`);
}

async function main(): Promise<void> {
  const repoDir = parseRepoArg(process.argv.slice(2));
  await ensureScratchGitRepo(repoDir);
  await rehearseScoutWorkspace(repoDir);
  await rehearseHookFreeCommit(repoDir);
  await rehearseCogTargets(repoDir);
  console.error("[rehearsal] all canaries passed");
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
