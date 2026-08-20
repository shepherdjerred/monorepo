/**
 * `toolkit pr review` — see and clear a code-review provider's findings.
 *
 * The gate reports a count; this reports the findings behind it, deduplicated
 * across the surfaces the provider posted them on, with the handles needed to
 * act on each one.
 */

import {
  fetchHeadSha,
  listFindings,
  resolveFinding,
  type Finding,
} from "#lib/review/findings.ts";
import {
  gateStatusFor,
  harvestVerdict,
  REQUIRED_REVIEW_GATES,
} from "#lib/review/harvest.ts";
import {
  resolveProvider,
  type ReviewProvider,
} from "@shepherdjerred/code-review";

export type ReviewOptions = {
  repo?: string | undefined;
  provider?: string | undefined;
  json?: boolean | undefined;
  finding?: string | undefined;
  evidence?: string | undefined;
  all?: boolean | undefined;
};

const DEFAULT_REPO = "shepherdjerred/monorepo";
const DEFAULT_MAX_BLOCKING_PRIORITY = 3;

export function parseMaxBlockingPriority(raw: string | undefined): number {
  const value = raw?.trim();
  if (value === undefined || value === "") {
    return DEFAULT_MAX_BLOCKING_PRIORITY;
  }
  if (!/^[0-3]$/.test(value)) {
    throw new Error(
      `REVIEW_MAX_BLOCKING_PRIORITY must be an integer in [0,3], got ${raw ?? ""}`,
    );
  }
  return Number.parseInt(value, 10);
}

function maxBlockingPriority(): number {
  return parseMaxBlockingPriority(Bun.env["REVIEW_MAX_BLOCKING_PRIORITY"]);
}

function selectedProvider(options: ReviewOptions): ReviewProvider | undefined {
  return options.provider === undefined
    ? undefined
    : resolveProvider(options.provider);
}

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
  const provider = selectedProvider(options);
  const { head, findings } = await listFindings({
    repo,
    number,
    token: requireToken(),
    provider,
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
  const provider = selectedProvider(options);
  const { findings } = await listFindings({
    repo,
    number,
    token,
    provider,
  });
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
  // Report each surface by what actually happened to it. `chippedComment` is
  // false both when the finding has no comment to chip and when the chip was
  // already there, and reporting those the same way tells a reader the command
  // skipped work it never had to do.
  const comment =
    finding.commentId === null
      ? "no review comment"
      : outcome.chippedComment
        ? "chipped the review comment"
        : "review comment already marked";
  const thread =
    finding.threadId === null
      ? "no review thread"
      : outcome.resolvedThread
        ? "resolved the review thread"
        : "review thread already resolved";
  console.log(`${finding.title ?? finding.key}: ${comment}, ${thread}`);
}

export async function reviewHarvestCommand(
  prNumbers: string[],
  options: ReviewOptions = {},
): Promise<void> {
  const repo = options.repo ?? DEFAULT_REPO;
  const token = requireToken();
  const numbers = prNumbers.map((value) => requirePr(value));
  const blockingPriority = maxBlockingPriority();
  if (numbers.length === 0) {
    throw new Error("At least one pull request number is required");
  }

  for (const number of numbers) {
    const prHead = await fetchHeadSha({ repo, number, token });
    for (const gateDefinition of REQUIRED_REVIEW_GATES) {
      const provider = resolveProvider(gateDefinition.providerId);
      const gate = await gateStatusFor({
        repo,
        ref: prHead,
        token,
        context: gateDefinition.context,
      });
      if (gate?.state !== "failure") {
        const reason =
          gate === null ? "no gate status" : `gate is ${gate.state}`;
        console.log(
          `#${String(number)} ${provider.displayName}: not retryable — ${reason}`,
        );
        continue;
      }

      const {
        head: reviewedHead,
        findings,
        reviewState,
      } = await listFindings({
        repo,
        number,
        token,
        provider,
        head: prHead,
      });
      const verdict = harvestVerdict({
        gate,
        reviewedAtHead: reviewState.reviewedCommit === prHead,
        completionSignal: reviewState.completionSignal,
        blockingCount: findings.filter(
          (finding) =>
            !finding.isResolved &&
            finding.priority !== null &&
            finding.priority <= blockingPriority,
        ).length,
      });

      if (!verdict.retryable) {
        console.log(
          `#${String(number)} ${provider.displayName}: not retryable — ${verdict.reason}`,
        );
        continue;
      }
      const latestHead = await fetchHeadSha({ repo, number, token });
      if (reviewedHead !== prHead || latestHead !== prHead) {
        console.log(
          `#${String(number)} ${provider.displayName}: not retryable — PR head changed during harvest; run harvest again`,
        );
        continue;
      }
      // Retrying is a write, so it is opt-in. Printing the command by default
      // makes the read-only run useful rather than merely safe.
      if (options.all !== true) {
        console.log(
          `#${String(number)} ${provider.displayName}: retryable — toolkit bk job retry ${verdict.jobId}`,
        );
        continue;
      }
      retryBuildkiteJob(verdict.jobId);
      console.log(
        `#${String(number)} ${provider.displayName}: retried ${verdict.jobId}`,
      );
    }
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
