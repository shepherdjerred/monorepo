import { readMaintenancePr, assertDraftUnchanged } from "./maintenance-pr.ts";
import { run } from "./run.ts";

const branch = "release-please--branches--main";
const repository = "shepherdjerred/monorepo";

/** The publisher owns fresh draft checks and an exact Git lease. */
export async function publishReleaseRefinement(
  input: {
    clone: string;
    body: string;
    expectedHead: string;
    env: Record<string, string>;
  },
  execute: typeof run = run,
): Promise<"published" | "deferred"> {
  if (!/^[a-f0-9]{40}$/u.test(input.expectedHead))
    throw new Error("Expected an exact release PR head");
  const current = await readMaintenancePr(branch, input.env, execute);
  if (current === undefined)
    throw new Error("Release PR closed before publication");
  if (!current.isDraft) return "deferred";
  assertDraftUnchanged(current, input.expectedHead);
  const options = { cwd: input.clone, env: input.env, capture: true };
  const head = await execute(["git", "rev-parse", "HEAD"], options);
  const sha = head.stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(sha))
    throw new Error("Invalid local refiner head");
  await execute(
    [
      "git",
      "push",
      `--force-with-lease=refs/heads/${branch}:${input.expectedHead}`,
      "origin",
      `HEAD:refs/heads/${branch}`,
    ],
    options,
  );
  const after = await readMaintenancePr(branch, input.env, execute);
  if (after?.number !== current.number)
    throw new Error("Release PR identity changed during publication");
  if (!after.isDraft) return "deferred";
  assertDraftUnchanged(after, sha);
  await execute(
    [
      "gh",
      "pr",
      "edit",
      current.number.toString(),
      "--repo",
      repository,
      "--body-file",
      input.body,
    ],
    options,
  );
  return "published";
}
