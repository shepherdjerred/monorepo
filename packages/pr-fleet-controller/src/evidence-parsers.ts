import { z } from "zod";
import {
  isProviderAuthor,
  type ReviewProvider,
} from "@shepherdjerred/code-review";
import {
  CheckEvidenceSchema,
  PrIdentitySchema,
  type PrIdentity,
  type ReviewFinding,
} from "./schemas.ts";

const GhPrSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.url(),
  isDraft: z.boolean(),
  author: z.object({ login: z.string() }),
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
  link: z.url().optional(),
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

const BuildkiteSummarySchema = z.object({
  commit: z.string(),
  state: z.string(),
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
const SOFT_FAILURE_PATTERN = /trivy|knip/i;

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
        labels: pr.labels.map((label) => label.name),
        headRefName: pr.headRefName,
        headSha: pr.headRefOid,
        baseRefName: pr.baseRefName,
        crossRepository: pr.isCrossRepository,
        maintainerCanModify: pr.maintainerCanModify,
      }),
    );
}

export function parseChecks(text: string) {
  return z
    .array(GhCheckSchema)
    .parse(parseJson(text))
    .map((check) =>
      CheckEvidenceSchema.parse({
        ...check,
        link: check.link ?? null,
        softFail: SOFT_FAILURE_PATTERN.test(check.name),
      }),
    );
}

export function parseReviewPage(text: string) {
  return ReviewPageSchema.parse(parseJson(text)).data.repository.pullRequest;
}

export function parseBuildkiteCommit(text: string): string {
  return BuildkiteSummarySchema.parse(parseJson(text)).commit;
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
