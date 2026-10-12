import { waitForReview } from "./wait-for-review.ts";
import { ReviewGateFailure } from "../lib/review/review-gate-poll.ts";
import { REVIEW_GATE_BLOCKED_EXIT_CODE } from "@shepherdjerred/code-review";

/** The deployed image owns this entrypoint and the bundled review policy. */
export async function runBundledReviewGate(
  environment: Record<string, string | undefined> = Bun.env,
  run: () => Promise<void> = waitForReview,
): Promise<number> {
  if (!/^[1-9]\d*$/u.test(environment["CI_COMMIT_PULL_REQUEST"] ?? "")) {
    throw new Error("Bundled review requires a pull request number");
  }
  if (!/^[a-f\d]{40}$/u.test(environment["CI_COMMIT_SHA"] ?? "")) {
    throw new Error("Bundled review requires the exact PR head");
  }
  const revision = environment["GIT_SHA"];
  if (revision === undefined || !/^[a-f\d]{40}$/u.test(revision)) {
    throw new Error("Bundled review requires its image policy revision");
  }
  const token = environment["GITHUB_REVIEW_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("Bundled review requires GITHUB_REVIEW_TOKEN");
  }
  environment["GH_TOKEN"] = token;
  environment["REVIEW_GATE_PARSER_COMMIT"] = revision;
  console.log(`Review gate policy revision: ${revision}`);
  try {
    await run();
    return 0;
  } catch (error) {
    if (
      error instanceof ReviewGateFailure &&
      error.exitCode === REVIEW_GATE_BLOCKED_EXIT_CODE
    ) {
      console.error(
        "Review quota exception: every enabled provider explicitly reported exhausted quota; no review ran for this head.",
      );
      return 0;
    }
    throw error;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runBundledReviewGate();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof ReviewGateFailure ? error.exitCode : 1;
  }
}
