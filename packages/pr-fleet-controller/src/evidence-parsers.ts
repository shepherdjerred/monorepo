import { z } from "zod";
import {
  isProviderAuthor,
  type ReviewProvider,
} from "@shepherdjerred/code-review";
import {
  CheckEvidenceSchema,
  PrIdentitySchema,
  type CheckEvidence,
  type PrIdentity,
  type ReviewFinding,
} from "./schemas.ts";

const GhPrSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.url(),
  isDraft: z.boolean(),
  author: z.object({ login: z.string(), is_bot: z.boolean() }),
  labels: z.array(z.object({ name: z.string() })),
  headRefName: z.string(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  isCrossRepository: z.boolean(),
  maintainerCanModify: z.boolean(),
});

const GhCheckSchema = z.object({
  name: z.string(),
  state: z.string(),
  bucket: z.string(),
  // `gh pr checks` emits `link: ""` (not a valid URL) for checks that carry no
  // details URL — e.g. a queued/pending status — so an empty string is
  // accepted here and normalized to null in `parseChecks`.
  link: z.union([z.url(), z.literal("")]).optional(),
});

const ReviewPageSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          pageInfo: z.object({
            hasNextPage: z.boolean(),
            endCursor: z.string().nullable(),
          }),
          nodes: z.array(
            z.object({
              id: z.string(),
              isResolved: z.boolean(),
              isOutdated: z.boolean(),
              comments: z.object({
                nodes: z.array(
                  z.object({
                    body: z.string(),
                    author: z.object({ login: z.string() }).nullable(),
                  }),
                ),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});

const BuildkiteBuildSchema = z.object({
  commit: z.string(),
  jobs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      state: z.string(),
      web_url: z.url(),
      started_at: z.string().nullable().optional(),
      soft_failed: z.boolean().optional(),
    }),
  ),
});

const HeadSchema = z.object({ headRefOid: z.string() });

/** A GitHub check run before its Buildkite soft-failure status is resolved. */
export type RawCheck = {
  name: string;
  state: string;
  bucket: string;
  link: string | null;
};

export function parseJson(text: string): unknown {
  return Bun.JSONC.parse(text);
}

export function parsePrList(text: string): PrIdentity[] {
  return z
    .array(GhPrSchema)
    .parse(parseJson(text))
    .map((pr) =>
      PrIdentitySchema.parse({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        draft: pr.isDraft,
        author: pr.author.login,
        authorType: pr.author.is_bot ? "Bot" : "User",
        labels: pr.labels.map((label) => label.name),
        headRefName: pr.headRefName,
        headSha: pr.headRefOid,
        baseRefName: pr.baseRefName,
        crossRepository: pr.isCrossRepository,
        maintainerCanModify: pr.maintainerCanModify,
      }),
    );
}

export function parseChecks(text: string): RawCheck[] {
  return z
    .array(GhCheckSchema)
    .parse(parseJson(text))
    .map((check) => ({
      name: check.name,
      state: check.state,
      bucket: check.bucket,
      link: check.link === undefined || check.link === "" ? null : check.link,
    }));
}

// Extract the Buildkite job id from a per-step check's target URL
// (`https://buildkite.com/<org>/<pipeline>/builds/<n>#<job-uuid>`). The
// aggregate `buildkite/monorepo/pr` check and non-Buildkite checks carry no
// fragment and return null.
function buildkiteJobId(link: string | null): string | null {
  if (link === null) {
    return null;
  }
  const hashIndex = link.indexOf("#");
  if (hashIndex === -1) {
    return null;
  }
  const fragment = link.slice(hashIndex + 1);
  return fragment.length > 0 ? fragment : null;
}

/**
 * Resolve each check's soft-failure status from the AUTHORITATIVE Buildkite
 * `soft_failed` job metadata (correlated by the job id embedded in the check's
 * target URL), not by matching check NAMES. The pipeline encodes softness by
 * exit status — Trivy findings are soft only for exit 7 while a scanner/runtime
 * failure is hard, and Semgrep findings are soft for exit 1 — which a name match
 * cannot capture: it would treat every Trivy failure (including a hard infra
 * failure) as soft and every Semgrep finding as hard, producing an incorrect
 * fleet readiness state. A check with no correlated Buildkite job (the aggregate
 * check, `ci/merge-conflict`) is never soft.
 */
export function checksWithBuildkiteSoftFailure(
  checks: RawCheck[],
  jobs: { id: string; soft_failed?: boolean | undefined }[],
): CheckEvidence[] {
  const softByJobId = new Map(
    jobs.map((job) => [job.id, job.soft_failed === true]),
  );
  return checks.map((check) => {
    const jobId = buildkiteJobId(check.link);
    const softFail = jobId !== null && softByJobId.get(jobId) === true;
    return CheckEvidenceSchema.parse({ ...check, softFail });
  });
}

export function parseReviewPage(text: string) {
  return ReviewPageSchema.parse(parseJson(text)).data.repository.pullRequest;
}

export function parseBuildkiteBuild(text: string) {
  return BuildkiteBuildSchema.parse(parseJson(text));
}

export function parseHeadSha(text: string): string {
  return HeadSchema.parse(parseJson(text)).headRefOid;
}

export function splitRepo(repo: string): { owner: string; name: string } {
  const separator = repo.indexOf("/");
  if (separator <= 0 || separator === repo.length - 1) {
    throw new Error(`Invalid repository name: ${repo}`);
  }
  return { owner: repo.slice(0, separator), name: repo.slice(separator + 1) };
}

/** One review thread's first comment, as fetched from the reviewThreads query. */
export type RawReviewThread = {
  id: string;
  author: string;
  body: string;
  resolved: boolean;
  outdated: boolean;
};

function reviewSeverity(level: number): ReviewFinding["severity"] {
  if (level === 0) return "P0";
  if (level === 1) return "P1";
  if (level === 2) return "P2";
  if (level === 3) return "P3";
  return "unknown";
}

/**
 * Convert raw review threads into blocking-eligible findings, applying the same
 * policy the canonical review gate enforces: only threads authored by the
 * configured provider (exact identity, not a substring) whose body carries a
 * parsed severity badge become findings. Human discussion threads and unbadged
 * bot comments are ignored so they can never dispatch a repair worker.
 */
export function reviewFindingsFromThreads(
  threads: RawReviewThread[],
  provider: ReviewProvider,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const thread of threads) {
    if (!isProviderAuthor(provider, thread.author)) {
      continue;
    }
    const priority = provider.parseSeverity(thread.body);
    if (priority === null) {
      continue;
    }
    findings.push({
      id: thread.id,
      author: thread.author,
      body: thread.body,
      severity: reviewSeverity(priority),
      resolved: thread.resolved,
      outdated: thread.outdated,
    });
  }
  return findings;
}

export function fingerprint(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  return new Bun.CryptoHasher("sha256")
    .update([...values].sort().join("\n"))
    .digest("hex");
}
