import { z } from "zod";
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
        reviews: z.object({
          nodes: z.array(
            z.object({
              id: z.string(),
              body: z.string(),
              submittedAt: z.string().nullable(),
              author: z.object({ login: z.string() }).nullable(),
              commit: z.object({ oid: z.string() }).nullable(),
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
const REVIEW_SEVERITY_PATTERN = /\b(P[0-3])\b/i;

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

export function severityFromBody(
  body: string,
): "P0" | "P1" | "P2" | "P3" | "unknown" {
  const match = REVIEW_SEVERITY_PATTERN.exec(body);
  const severity = match?.[1]?.toUpperCase();
  if (
    severity === "P0" ||
    severity === "P1" ||
    severity === "P2" ||
    severity === "P3"
  ) {
    return severity;
  }
  return "unknown";
}

type AutomatedReviewInput = {
  id: string;
  author: string;
  body: string;
  commit: string | null;
  headSha: string;
};

export function automatedReviewFinding(
  input: AutomatedReviewInput,
): ReviewFinding | null {
  const { id, author, body, commit, headSha } = input;
  const automated = /codex|greptile/i.test(author);
  const clean = /no findings|no issues|looks good/i.test(body);
  if (!automated || body.trim().length === 0 || clean) {
    return null;
  }
  return {
    id,
    author,
    body,
    severity: severityFromBody(body),
    resolved: false,
    outdated: commit !== headSha,
  };
}

export function isCurrentHostedReview(
  author: string,
  commit: string | null,
  headSha: string,
): boolean {
  return author.toLowerCase().includes("codex") && commit === headSha;
}

export function fingerprint(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  return new Bun.CryptoHasher("sha256")
    .update([...values].sort().join("\n"))
    .digest("hex");
}
