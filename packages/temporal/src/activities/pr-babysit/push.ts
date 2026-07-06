/**
 * `pushBabysitBranch` — push the iteration's commits to the PR branch.
 *
 * Because each iteration starts from `reset --hard origin/<headRef>` and only
 * ADDS commits, the push is a fast-forward in the normal case. We deliberately
 * use a PLAIN push (no force): if a human pushed to the branch during the
 * iteration, the remote advanced and the push is rejected as non-fast-forward —
 * which is exactly the safe outcome (the caller re-assesses against the new
 * head instead of clobbering the human's work). A fresh installation token is
 * minted by the caller and passed in `env`, so the push never races the ~1h
 * token TTL even when the agent run was long.
 */
import { capture, run } from "./exec.ts";

export type PushBabysitBranchInput = {
  workdir: string;
  headRef: string;
  env?: Record<string, string>;
};

export type PushBabysitBranchResult =
  | { pushed: true; headSha: string; changedPaths: string[] }
  | {
      pushed: false;
      reason: "nothing-to-push" | "remote-moved";
      headSha: string;
    };

function isNonFastForward(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("non-fast-forward") ||
    lower.includes("fetch first") ||
    lower.includes("rejected")
  );
}

export async function pushBabysitBranch(
  input: PushBabysitBranchInput,
): Promise<PushBabysitBranchResult> {
  const opts = {
    cwd: input.workdir,
    ...(input.env === undefined ? {} : { env: input.env }),
  };
  const headSha = await run(["git", "rev-parse", "HEAD"], opts);
  const remoteSha = await run(
    ["git", "rev-parse", `origin/${input.headRef}`],
    opts,
  );
  if (headSha === remoteSha) {
    return { pushed: false, reason: "nothing-to-push", headSha };
  }

  const diffOutput = await run(
    ["git", "diff", "--name-only", `origin/${input.headRef}`, "HEAD"],
    opts,
  );
  const changedPaths = diffOutput
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const push = await capture(
    ["git", "push", "origin", `HEAD:${input.headRef}`],
    opts,
  );
  if (push.exitCode === 0) {
    return { pushed: true, headSha, changedPaths };
  }
  if (isNonFastForward(push.stderr)) {
    return { pushed: false, reason: "remote-moved", headSha };
  }
  throw new Error(
    `git push to ${input.headRef} failed (exit ${String(push.exitCode)}): ${push.stderr.trim()}`,
  );
}
