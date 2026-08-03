import { run } from "../../scripts/lib/run.ts";
import type { CiImageDefinition } from "./build-ci-image-core.ts";
import type { CiImagePinState } from "./update-ci-image-pin-core.ts";

export const MONOREPO_REPO = "shepherdjerred/monorepo";

export async function openOrUpdatePullRequest(options: {
  readonly cloneDir: string;
  readonly definition: CiImageDefinition;
  readonly state: CiImagePinState;
  readonly env: Record<string, string>;
  readonly expectedRemoteSha: string | undefined;
}): Promise<void> {
  const { cloneDir, definition, state, env, expectedRemoteSha } = options;
  await run(
    [
      "git",
      "-C",
      cloneDir,
      "push",
      `--force-with-lease=refs/heads/${definition.branch}:${expectedRemoteSha ?? ""}`,
      "-u",
      "origin",
      definition.branch,
    ],
    { env },
  );
  const listed = await run(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      MONOREPO_REPO,
      "--head",
      definition.branch,
      "--state",
      "open",
      "--json",
      "number",
      "-q",
      ".[0].number // empty",
    ],
    { env, capture: true },
  );
  let prNumber = listed.stdout.trim();
  if (prNumber === "") {
    await run(
      [
        "gh",
        "pr",
        "create",
        "--repo",
        MONOREPO_REPO,
        "--base",
        "main",
        "--head",
        definition.branch,
        "--title",
        `chore(ci): promote ${definition.name} candidate`,
        "--body",
        [
          `Promotes ${definition.name} build ${state.buildNumber.toString()} by immutable digest.`,
          "",
          "The PR CI lanes consume this candidate digest before auto-merge.",
        ].join("\n"),
      ],
      { env },
    );
    const viewed = await run(
      [
        "gh",
        "pr",
        "view",
        "--repo",
        MONOREPO_REPO,
        definition.branch,
        "--json",
        "number",
        "-q",
        ".number",
      ],
      { env, capture: true },
    );
    prNumber = viewed.stdout.trim();
  }
  if (!/^\d+$/.test(prNumber)) {
    throw new Error("CI image pin PR number is invalid");
  }
  await run(
    [
      "gh",
      "pr",
      "merge",
      "--repo",
      MONOREPO_REPO,
      prNumber,
      "--auto",
      "--squash",
    ],
    { env },
  );
}

/**
 * Neutralize a still-open pin promotion before skipping a build. When the
 * latest candidate restores runtime content to the current pin, any open
 * promotion PR on the pending branch is stale: it proposes an older or
 * superseded digest and, with auto-merge already enabled, would otherwise
 * merge it despite this build deciding no promotion is warranted. Closing the
 * PR cancels its auto-merge; deleting its branch leaves the next promotion a
 * clean slate.
 */
export async function retireStalePromotion(options: {
  readonly cloneDir: string;
  readonly definition: CiImageDefinition;
  readonly env: Record<string, string>;
}): Promise<void> {
  const { cloneDir, definition, env } = options;
  const listed = await run(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      MONOREPO_REPO,
      "--head",
      definition.branch,
      "--state",
      "open",
      "--json",
      "number",
      "-q",
      ".[0].number // empty",
    ],
    { env, capture: true },
  );
  const prNumber = listed.stdout.trim();
  if (!/^\d+$/.test(prNumber)) {
    return;
  }
  await run(
    [
      "gh",
      "pr",
      "close",
      "--repo",
      MONOREPO_REPO,
      prNumber,
      "--comment",
      `Superseded: the latest ${definition.name} build restored runtime content to the current pin, so this pending promotion is stale.`,
    ],
    { env },
  );
  await run(
    ["git", "-C", cloneDir, "push", "origin", "--delete", definition.branch],
    { env },
  );
}
