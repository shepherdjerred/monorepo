import { z } from "zod/v4";

/**
 * Xcode Cloud webhook payload — the subset we consume, modelled loosely.
 *
 * Two sources of truth disagree on nesting: Apple's payload reference
 * (developer.apple.com/documentation/xcode/webhook-payload) lists build fields
 * directly on each object, while real-world deliveries (e.g. polpiella.dev)
 * show them under an `attributes` sub-object. Xcode Cloud webhooks are also
 * unauthenticated and versionless, so we treat the body as an external-boundary
 * input: accept BOTH shapes and normalize in code, and never hard-fail on extra
 * or missing display fields. Only the two decision fields (`executionProgress`,
 * `completionStatus`) drive behavior, and a missing one is treated as
 * "not a terminal failure" (ignore) rather than defaulted — so an unexpected
 * shape can never manufacture a false alert.
 */

const NumberOrString = z.union([z.number(), z.string()]);

const CommitSchema = z.looseObject({
  commitSha: z.string().optional(),
  htmlUrl: z.string().optional(),
});

const buildShape = {
  number: NumberOrString.optional(),
  executionProgress: z.string().optional(),
  completionStatus: z.string().optional(),
  sourceCommit: CommitSchema.optional(),
};
const CiBuildRunSchema = z.looseObject({
  ...buildShape,
  attributes: z.looseObject(buildShape).optional(),
});

const workflowShape = { name: z.string().optional() };
const CiWorkflowSchema = z.looseObject({
  ...workflowShape,
  attributes: z.looseObject(workflowShape).optional(),
});

const productShape = {
  name: z.string().optional(),
  productType: z.string().optional(),
};
const CiProductSchema = z.looseObject({
  ...productShape,
  attributes: z.looseObject(productShape).optional(),
});

const gitRefShape = {
  name: z.string().optional(),
  canonicalName: z.string().optional(),
  kind: z.string().optional(),
};
const ScmGitReferenceSchema = z.looseObject({
  ...gitRefShape,
  attributes: z.looseObject(gitRefShape).optional(),
});

const repoShape = {
  repositoryName: z.string().optional(),
  ownerName: z.string().optional(),
};
const ScmRepositorySchema = z.looseObject({
  ...repoShape,
  attributes: z.looseObject(repoShape).optional(),
});

const metadataShape = {
  // BUILD_CREATED | BUILD_STARTED | BUILD_COMPLETED | UNRECOGNIZED
  eventType: z.string().optional(),
  createdDate: z.string().optional(),
};
const WebhookMetadataSchema = z.looseObject({
  ...metadataShape,
  attributes: z.looseObject(metadataShape).optional(),
});

export const XcodeCloudPayloadSchema = z.looseObject({
  metadata: WebhookMetadataSchema.optional(),
  ciBuildRun: CiBuildRunSchema.optional(),
  ciWorkflow: CiWorkflowSchema.optional(),
  ciProduct: CiProductSchema.optional(),
  scmGitReference: ScmGitReferenceSchema.optional(),
  scmRepository: ScmRepositorySchema.optional(),
});
export type XcodeCloudPayload = z.infer<typeof XcodeCloudPayloadSchema>;

/** Normalized, nesting-agnostic view of the fields we act on. */
export type XcodeCloudBuildEvent = {
  eventType: string | undefined;
  executionProgress: string | undefined;
  completionStatus: string | undefined;
  buildNumber: string | undefined;
  workflowName: string;
  productName: string;
  branch: string;
  commitSha: string | undefined;
  buildUrl: string | undefined;
};

/** Read a `name` that may live flat or under `attributes`, else a fallback. */
function nameOf(
  section:
    | {
        name?: string | undefined;
        attributes?: { name?: string | undefined } | undefined;
      }
    | undefined,
  fallback: string,
): string {
  return section?.name ?? section?.attributes?.name ?? fallback;
}

/** Merge the flat/`attributes` build fields into one view (flat wins if both set). */
function pickBuildFields(p: XcodeCloudPayload) {
  const b = p.ciBuildRun;
  const a = b?.attributes;
  return {
    executionProgress: b?.executionProgress ?? a?.executionProgress,
    completionStatus: b?.completionStatus ?? a?.completionStatus,
    number: b?.number ?? a?.number,
    sourceCommit: b?.sourceCommit ?? a?.sourceCommit,
  };
}

/**
 * Flatten the `attributes`-wrapped vs flat ambiguity into one typed view.
 * Decision fields stay `undefined` when absent (never defaulted); only
 * human-facing label/annotation fields fall back to a placeholder so a partial
 * payload still produces a legible incident instead of dropping the signal.
 */
export function normalizeXcodeCloudPayload(
  p: XcodeCloudPayload,
): XcodeCloudBuildEvent {
  const build = pickBuildFields(p);
  return {
    eventType: p.metadata?.eventType ?? p.metadata?.attributes?.eventType,
    executionProgress: build.executionProgress,
    completionStatus: build.completionStatus,
    buildNumber: build.number === undefined ? undefined : String(build.number),
    workflowName: nameOf(p.ciWorkflow, "unknown-workflow"),
    productName: nameOf(p.ciProduct, "unknown-product"),
    branch: nameOf(p.scmGitReference, "unknown-ref"),
    commitSha: build.sourceCommit?.commitSha,
    buildUrl: build.sourceCommit?.htmlUrl,
  };
}

export type BuildOutcome = "firing" | "resolved" | "ignore";

const FAILURE_STATUSES = new Set(["FAILED", "ERRORED"]);

/**
 * Decide what (if anything) to send to Alertmanager for a delivery.
 * - A build is "terminal" only on the BUILD_COMPLETED event (or COMPLETE
 *   progress); BUILD_CREATED / BUILD_STARTED are ignored.
 * - FAILED / ERRORED → fire; SUCCEEDED → resolve (clears a prior red incident
 *   for the same workflow+branch); CANCELED / SKIPPED / unknown → ignore.
 */
export function classifyBuild(e: XcodeCloudBuildEvent): BuildOutcome {
  const terminal =
    e.eventType === "BUILD_COMPLETED" || e.executionProgress === "COMPLETE";
  if (!terminal) return "ignore";
  if (e.completionStatus === undefined) return "ignore";
  if (FAILURE_STATUSES.has(e.completionStatus)) return "firing";
  if (e.completionStatus === "SUCCEEDED") return "resolved";
  return "ignore";
}
