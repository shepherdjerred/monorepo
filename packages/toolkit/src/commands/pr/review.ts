/**
 * `toolkit pr review` — see and clear a code-review provider's findings.
 *
 * The gate reports a count; this reports the findings behind it, deduplicated
 * across the surfaces the provider posted them on, with the handles needed to
 * act on each one.
 */

import {
  listFindings,
  resolveFinding,
  reviewStateFor,
  type Finding,
} from "#lib/review/findings.ts";
import { gateStatusFor, harvestVerdict } from "#lib/review/harvest.ts";

export type ReviewOptions = {
  repo?: string | undefined;
  json?: boolean | undefined;
  finding?: string | undefined;
  evidence?: string | undefined;
  all?: boolean | undefined;
};

const DEFAULT_REPO = "shepherdjerred/monorepo";

/**
 * A GitHub token for the `code-review` library.
 *
 * This package's convention is that GitHub access costs the caller no token
 * setup, so the token is borrowed from an authenticated `gh` when the
 * environment does not already supply one. The library needs a token rather
 * than the CLI because it speaks GraphQL and paginates itself.
 */
function requireToken(): string {
  const fromEnvironment = Bun.env["GH_TOKEN"];
  if (fromEnvironment !== undefined && fromEnvironment.trim() !== "") {
    return fromEnvironment.trim();
  }
  const result = Bun.spawnSync(["gh", "auth", "token"]);
  const token = result.stdout.toString().trim();
  if (token === "" || result.exitCode !== 0) {
    throw new Error("No GitHub token: run `gh auth login`, or set GH_TOKEN.");
  }
  return token;
}

function requirePr(prNumber: string | undefined): number {
  const parsed = Number.parseInt(prNumber ?? "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("A pull request number is required");
  }
  return parsed;
}

function describe(finding: Finding): string {
  const severity =
    finding.priority === null ? "P?" : `P${String(finding.priority)}`;
  const where =
    finding.path === null
      ? "(general)"
      : finding.line === null
        ? finding.path
        : `${finding.path}:${String(finding.line)}`;
  const surfaces = [
    finding.commentId === null ? null : "comment",
    finding.threadId === null ? null : "thread",
  ]
    .filter((surface) => surface !== null)
    .join("+");
  const mark = finding.isResolved ? "resolved" : "OPEN    ";
  return `${mark}  ${severity}  ${finding.title ?? "(untitled)"}\n          ${where}  [${surfaces}]  key=${finding.key}`;
}

export async function reviewListCommand(
  prNumber: string | undefined,
  options: ReviewOptions = {},
): Promise<void> {
  const repo = options.repo ?? DEFAULT_REPO;
  const number = requirePr(prNumber);
  const { head, findings } = await listFindings({
    repo,
    number,
    token: requireToken(),
  });

  if (options.json === true) {
    console.log(JSON.stringify({ repo, pr: number, head, findings }, null, 2));
    return;
  }

  const open = findings.filter((finding) => !finding.isResolved);
  console.log(`${repo}#${String(number)} @ ${head.slice(0, 9)}`);
  console.log(
    `${String(findings.length)} finding(s), ${String(open.length)} unresolved\n`,
  );
  for (const finding of findings) console.log(describe(finding));
}

export async function reviewResolveCommand(
  prNumber: string | undefined,
  options: ReviewOptions = {},
): Promise<void> {
  const repo = options.repo ?? DEFAULT_REPO;
  const number = requirePr(prNumber);
  const key = options.finding;
  const evidence = options.evidence;
  if (key === undefined || key.trim() === "") {
    throw new Error(
      "--finding <key> is required (see: toolkit pr review list)",
    );
  }
  // A dismissal without a reason is indistinguishable from silencing the
  // finding, so the reason is not optional.
  if (evidence === undefined || evidence.trim() === "") {
    throw new Error(
      "--evidence <text> is required: say what makes this finding resolved",
    );
  }

  const token = requireToken();
  const { findings } = await listFindings({ repo, number, token });
  const matches = findings.filter(
    (finding) => finding.key === key || finding.title === key,
  );
  if (matches.length === 0) {
    throw new Error(
      `No finding matching "${key}" on ${repo}#${String(number)}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `"${key}" matches ${String(matches.length)} findings; use the exact key`,
    );
  }
  const finding = matches[0];
  if (finding === undefined) throw new Error("unreachable: no finding");

  const outcome = await resolveFinding({
    repo,
    number,
    token,
    finding,
    evidence,
  });
  console.log(
    `${finding.title ?? finding.key}: ` +
      `${outcome.chippedComment ? "chipped the review comment" : "review comment already marked"}, ` +
      (outcome.resolvedThread
        ? "resolved the review thread"
        : "no review thread"),
  );
}

export async function reviewHarvestCommand(
  prNumbers: string[],
  options: ReviewOptions = {},
): Promise<void> {
  const repo = options.repo ?? DEFAULT_REPO;
  const token = requireToken();
  const numbers = prNumbers.map((value) => requirePr(value));
  if (numbers.length === 0) {
    throw new Error("At least one pull request number is required");
  }

  for (const number of numbers) {
    const { head, findings } = await listFindings({ repo, number, token });
    const state = await reviewStateFor({ repo, number, token, head });
    const gate = await gateStatusFor({ repo, ref: head, token });
    const verdict = harvestVerdict({
      gate,
      reviewedAtHead: state.reviewedAtHead,
      completionSignal: state.completionSignal,
      blockingCount: findings.filter((finding) => !finding.isResolved).length,
    });

    if (!verdict.retryable) {
      console.log(`#${String(number)}: not retryable — ${verdict.reason}`);
      continue;
    }
    // Retrying is a write, so it is opt-in. Printing the command by default
    // makes the read-only run useful rather than merely safe.
    if (options.all !== true) {
      console.log(
        `#${String(number)}: retryable — bk job retry ${verdict.jobId}`,
      );
      continue;
    }
    retryBuildkiteJob(verdict.jobId);
    console.log(`#${String(number)}: retried ${verdict.jobId}`);
  }
}

function retryBuildkiteJob(jobId: string): void {
  const result = Bun.spawnSync([
    "bk",
    "job",
    "retry",
    jobId,
    "-y",
    "--no-input",
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `bk job retry ${jobId} failed: ${result.stderr.toString().trim()}`,
    );
  }
}
