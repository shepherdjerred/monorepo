import {
  PrIdentitySchema,
  ReadinessEvidenceSchema,
  type PrIdentity,
  type ReadinessEvidence,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";

export function identity(
  number: number,
  overrides: Partial<PrIdentity> = {},
): PrIdentity {
  return PrIdentitySchema.parse({
    number,
    title: `PR ${String(number)}`,
    url: `https://github.com/shepherdjerred/monorepo/pull/${String(number)}`,
    draft: false,
    author: "author",
    labels: [],
    headRefName: `feature/pr-${String(number)}`,
    headSha: String(number).padStart(40, "a").slice(-40),
    baseRefName: "main",
    crossRepository: false,
    maintainerCanModify: true,
    ...overrides,
  });
}

export function evidence(
  pr: PrIdentity,
  overrides: Partial<ReadinessEvidence> = {},
): ReadinessEvidence {
  return ReadinessEvidenceSchema.parse({
    headSha: pr.headSha,
    checks: [
      {
        name: "buildkite",
        state: "SUCCESS",
        bucket: "pass",
        link: "https://buildkite.com/sjerred/monorepo/builds/1",
        softFail: false,
      },
    ],
    buildkiteCurrentHead: true,
    buildkiteFailure: null,
    conflict: false,
    reviewFindings: [],
    hostedReviewComplete: true,
    hardFailureFingerprint: null,
    reviewFingerprint: null,
    ...overrides,
  });
}
