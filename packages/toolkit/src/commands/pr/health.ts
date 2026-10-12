import { getPullRequest } from "#lib/github/pr.ts";
import { checkMergeConflicts } from "#lib/git/conflicts.ts";
import { formatHealthReport, formatJson } from "#lib/output/formatter.ts";
import { loadWoodpeckerConfig } from "#lib/woodpecker/ci.ts";
import { githubToken } from "#lib/ci/process.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import {
  GitHubClient,
  REPOSITORY,
  resolvePrNumber,
  isHumanReview,
} from "#lib/ci/github.ts";
import { buildPrHealthReport } from "#lib/ci/health.ts";
import { sanitizeText } from "#lib/ci/redaction.ts";
import { requiredChecks } from "#lib/ci/readiness.ts";

export type HealthOptions = { json?: boolean | undefined };

export async function healthCommand(
  prNumber?: string,
  options: HealthOptions = {},
): Promise<void> {
  const number = await resolvePrNumber(prNumber);
  const [token, config, pr] = await Promise.all([
    githubToken(),
    loadWoodpeckerConfig(),
    getPullRequest(number, REPOSITORY),
  ]);
  if (pr === null) throw new Error(`PR #${String(number)} could not be read`);
  const snapshot = await new CiObserver(
    new GitHubClient(token),
    config,
  ).snapshot(number, undefined, true);
  const merge = await checkMergeConflicts(
    number,
    snapshot.pr.base.ref,
    snapshot.pr.head.sha,
  );
  const humanReviews = snapshot.reviews.filter(isHumanReview);
  const report = buildPrHealthReport({
    pr: {
      ...pr,
      headRefOid: snapshot.pr.head.sha,
      baseRefName: snapshot.pr.base.ref,
      reviewDecision:
        snapshot.rules.approvals > 0 ? snapshot.reviewDecision : null,
    },
    merge,
    ciPipeline: snapshot.pipeline,
    snapshot,
    githubChecks: requiredChecks(snapshot).map((check) => ({
      name: check.name,
      state: check.state,
      bucket: check.state === "human_action" ? "fail" : check.state,
      link: check.url ?? "",
    })),
    reviews: humanReviews.map((review) => ({
      author: review.user?.login ?? "deleted author",
      state: review.state,
    })),
  });
  console.log(
    sanitizeText(
      options.json === true ? formatJson(report) : formatHealthReport(report),
      [token, config.token],
    ),
  );
  if (report.overallStatus === "UNHEALTHY") process.exitCode = 1;
}
