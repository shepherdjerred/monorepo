import type { Finding } from "#shared/pr-review/finding.ts";
import type { PrFileDiff } from "#shared/pr-review/context.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import { clusterKey } from "#shared/pr-review/cluster-key.ts";

/**
 * Body emitted when the pipeline runs but produces zero findings. We still
 * post so reviewers can see the bot ran and reached a verdict.
 */
const EMPTY_FINDINGS_BODY =
  "_pr-review-bot: the configured deterministic checks, specialist review, consensus, verification, and dedupe stages produced no findings for this commit._";

/** Stable PR-level marker for the visible review status comment. */
export const STATUS_COMMENT_MARKER = "<!-- pr-review-bot-status -->";

/** Prefix used inside inline review comments for per-finding idempotency. */
const INLINE_FINDING_MARKER_PREFIX = "<!-- pr-review-inline-finding";

const DEFAULT_INLINE_SUMMARY: InlinePostSummary = {
  posted: 0,
  skippedUnanchored: 0,
  skippedDuplicate: 0,
  skippedWithoutSuggestion: 0,
  failed: false,
};

/**
 * Display labels for severity sections, ordered worst-first so reviewers see
 * the critical issues at the top of the comment.
 */
const SEVERITY_SECTIONS: { severity: Finding["severity"]; heading: string }[] =
  [
    { severity: "critical", heading: "Critical" },
    { severity: "warning", heading: "Warning" },
    { severity: "nit", heading: "Nit" },
  ];

export type PostReviewInput = {
  pipeline: PrReviewPipelineInput;
  findings: Finding[];
  changedFiles: PrFileDiff[];
};

export type PostReviewStatusState = "draft_skipped" | "running" | "failed";

export type PostReviewStatusInput = {
  pipeline: PrReviewPipelineInput;
  state: PostReviewStatusState;
  reason?: string;
  workflowId?: string;
};

export type InlinePostSummary = {
  posted: number;
  skippedUnanchored: number;
  skippedDuplicate: number;
  skippedWithoutSuggestion: number;
  failed: boolean;
  failureMessage?: string;
};

export type InlineReviewComment = {
  path: string;
  body: string;
  side: "RIGHT";
  line: number;
  start_side?: "RIGHT";
  start_line?: number;
};

type DiffLineIndex = {
  rightLines: ReadonlySet<number>;
  addedLines: ReadonlySet<number>;
};

type InlineReviewBuildResult = {
  comments: InlineReviewComment[];
  summary: InlinePostSummary;
};

export function markerFor(workflowId: string): string {
  if (workflowId.length === 0) {
    return STATUS_COMMENT_MARKER;
  }
  return STATUS_COMMENT_MARKER;
}

const MARKER_CLAIM_MAX = 80;

/**
 * HTML-comment marker prepended to each finding's bullet so the Phase 9
 * dismissed-comments listener can recover the dedupe triple.
 */
export function findingMarker(finding: Finding): string {
  const truncatedClaim = finding.claim.slice(0, MARKER_CLAIM_MAX);
  const cluster = clusterKey(finding.file, finding.lineStart);
  return [
    "<!-- pr-review-finding",
    `cluster="${encodeURIComponent(cluster)}"`,
    `kind="${encodeURIComponent(finding.kind)}"`,
    `file="${encodeURIComponent(finding.file)}"`,
    `claim="${encodeURIComponent(truncatedClaim)}"`,
    "-->",
  ].join(" ");
}

export function inlineFindingMarker(
  finding: Finding,
  commitSha: string,
): string {
  return [
    INLINE_FINDING_MARKER_PREFIX,
    `id="${encodeURIComponent(finding.id)}"`,
    `commit="${encodeURIComponent(commitSha)}"`,
    "-->",
  ].join(" ");
}

function parseDiffLineIndex(file: PrFileDiff): DiffLineIndex {
  const rightLines = new Set<number>();
  const addedLines = new Set<number>();
  if (file.patch === null) return { rightLines, addedLines };

  let currentNewLine = 1;
  for (const rawLine of file.patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
    if (hunk !== null) {
      const parsed = Number.parseInt(hunk[1] ?? "1", 10);
      currentNewLine = Number.isInteger(parsed) ? parsed : 1;
      continue;
    }

    if (rawLine.startsWith("+++") || rawLine.startsWith("---")) continue;
    if (rawLine.startsWith("-")) continue;

    rightLines.add(currentNewLine);
    if (rawLine.startsWith("+")) {
      addedLines.add(currentNewLine);
    }
    currentNewLine += 1;
  }
  return { rightLines, addedLines };
}

function buildDiffLineIndex(
  files: readonly PrFileDiff[],
): Map<string, DiffLineIndex> {
  const indexes = new Map<string, DiffLineIndex>();
  for (const file of files) {
    indexes.set(file.path, parseDiffLineIndex(file));
  }
  return indexes;
}

function everyLineInRange(
  lines: ReadonlySet<number>,
  start: number,
  end: number,
): boolean {
  for (let line = start; line <= end; line += 1) {
    if (!lines.has(line)) return false;
  }
  return true;
}

function canRenderSuggestion(finding: Finding, index: DiffLineIndex): boolean {
  const suggestion = finding.suggestion;
  if (suggestion === undefined) return false;
  if (suggestion.replacement.includes("```")) return false;
  const start = suggestion.lineStart ?? finding.lineStart;
  const end = suggestion.lineEnd ?? finding.lineEnd;
  return everyLineInRange(index.addedLines, start, end);
}

function renderInlineFindingBody(
  finding: Finding,
  commitSha: string,
  index: DiffLineIndex,
): { body: string; suggestionRendered: boolean } {
  const lines: string[] = [];
  lines.push(inlineFindingMarker(finding, commitSha));
  lines.push("");
  lines.push(`**${finding.severity} ${finding.kind}**: ${finding.claim}`);
  lines.push("");
  lines.push(finding.evidence);
  if (finding.verification !== undefined) {
    lines.push("");
    lines.push(
      `_verification_: ${finding.verification.status} via \`${finding.verification.verifier}\``,
    );
  }

  const suggestionRendered = canRenderSuggestion(finding, index);
  if (suggestionRendered && finding.suggestion !== undefined) {
    if (finding.suggestion.rationale !== undefined) {
      lines.push("");
      lines.push(finding.suggestion.rationale);
    }
    lines.push("");
    lines.push("```suggestion");
    lines.push(finding.suggestion.replacement);
    lines.push("```");
  }

  return { body: lines.join("\n"), suggestionRendered };
}

export function buildExistingInlineMarkerSet(
  comments: readonly { body?: string | null }[],
): Set<string> {
  const markers = new Set<string>();
  for (const comment of comments) {
    if (typeof comment.body !== "string") continue;
    for (const line of comment.body.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith(INLINE_FINDING_MARKER_PREFIX)) {
        markers.add(trimmed);
      }
    }
  }
  return markers;
}

export function buildInlineReviewComments(input: {
  pipeline: PrReviewPipelineInput;
  findings: readonly Finding[];
  changedFiles: readonly PrFileDiff[];
  existingMarkers: ReadonlySet<string>;
}): InlineReviewBuildResult {
  const diffIndexes = buildDiffLineIndex(input.changedFiles);
  const comments: InlineReviewComment[] = [];
  let skippedUnanchored = 0;
  let skippedDuplicate = 0;
  let skippedWithoutSuggestion = 0;

  for (const finding of input.findings) {
    const marker = inlineFindingMarker(finding, input.pipeline.commitSha);
    if (input.existingMarkers.has(marker)) {
      skippedDuplicate += 1;
      continue;
    }

    const index = diffIndexes.get(finding.file);
    if (
      index === undefined ||
      !everyLineInRange(index.rightLines, finding.lineStart, finding.lineEnd)
    ) {
      skippedUnanchored += 1;
      continue;
    }

    const rendered = renderInlineFindingBody(
      finding,
      input.pipeline.commitSha,
      index,
    );
    if (finding.suggestion !== undefined && !rendered.suggestionRendered) {
      skippedWithoutSuggestion += 1;
    }

    comments.push({
      path: finding.file,
      body: rendered.body,
      side: "RIGHT",
      line: finding.lineEnd,
      ...(finding.lineStart === finding.lineEnd
        ? {}
        : { start_side: "RIGHT", start_line: finding.lineStart }),
    });
  }

  return {
    comments,
    summary: {
      posted: comments.length,
      skippedUnanchored,
      skippedDuplicate,
      skippedWithoutSuggestion,
      failed: false,
    },
  };
}

function renderFinding(finding: Finding): string {
  const lineRange =
    finding.lineStart === finding.lineEnd
      ? `L${String(finding.lineStart)}`
      : `L${String(finding.lineStart)}-L${String(finding.lineEnd)}`;
  const lines: string[] = [];
  lines.push(findingMarker(finding));
  lines.push(`- **\`${finding.file}\`** ${lineRange} - ${finding.claim}`);
  lines.push(
    `  - _kind_: ${finding.kind}; _verifier_: \`${finding.verifier}\`; _verification_: ${finding.verification?.status ?? "not-run"}; _confidence_: ${finding.confidence.toFixed(2)}`,
  );
  lines.push(`  - _evidence_: ${finding.evidence}`);
  if (finding.verification?.outputExcerpt !== undefined) {
    lines.push(`  - _verifier output_: ${finding.verification.outputExcerpt}`);
  }
  return lines.join("\n");
}

const MARKER_RE =
  /^<!-- pr-review-finding cluster="([^"]*)" kind="([^"]*)" file="([^"]*)" claim="([^"]*)" -->$/;

export type ParsedFindingMarker = {
  cluster: string;
  kind: string;
  file: string;
  claim: string;
};

export function parseFindingMarker(line: string): ParsedFindingMarker | null {
  const match = MARKER_RE.exec(line.trim());
  if (match === null) return null;
  const [, cluster, kind, file, claim] = match;
  if (
    cluster === undefined ||
    kind === undefined ||
    file === undefined ||
    claim === undefined
  ) {
    return null;
  }
  return {
    cluster: decodeURIComponent(cluster),
    kind: decodeURIComponent(kind),
    file: decodeURIComponent(file),
    claim: decodeURIComponent(claim),
  };
}

export function renderCommentBody(
  input: PostReviewInput,
  marker: string,
  inlineSummary?: InlinePostSummary,
): string {
  const summary = inlineSummary ?? DEFAULT_INLINE_SUMMARY;
  const lines: string[] = [];
  lines.push(marker);
  lines.push("");
  lines.push(
    "**pr-review-bot** (deterministic checks + multi-specialist review)",
  );
  lines.push("");
  lines.push(`Commit: \`${input.pipeline.commitSha}\``);
  lines.push("");

  if (input.findings.length === 0) {
    lines.push(EMPTY_FINDINGS_BODY);
    lines.push("");
    lines.push(renderInlineSummary(summary));
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `Found ${String(input.findings.length)} issue${input.findings.length === 1 ? "" : "s"}. Posted ${String(summary.posted)} inline comment${summary.posted === 1 ? "" : "s"}.`,
  );
  if (summary.failed) {
    lines.push("");
    lines.push(
      `Inline review posting failed: ${summary.failureMessage ?? "unknown error"}. Findings are still listed below.`,
    );
  }
  if (summary.skippedUnanchored > 0) {
    lines.push("");
    lines.push(
      `${String(summary.skippedUnanchored)} finding${summary.skippedUnanchored === 1 ? "" : "s"} could not be anchored to the current PR diff and is listed here only.`,
    );
  }
  if (summary.skippedWithoutSuggestion > 0) {
    lines.push("");
    lines.push(
      `${String(summary.skippedWithoutSuggestion)} suggested fix${summary.skippedWithoutSuggestion === 1 ? "" : "es"} could not be safely rendered as a GitHub suggestion block.`,
    );
  }
  lines.push("");

  const bySeverity = new Map<Finding["severity"], Finding[]>();
  for (const finding of input.findings) {
    const bucket = bySeverity.get(finding.severity);
    if (bucket === undefined) {
      bySeverity.set(finding.severity, [finding]);
    } else {
      bucket.push(finding);
    }
  }

  for (const section of SEVERITY_SECTIONS) {
    const bucket = bySeverity.get(section.severity);
    if (bucket === undefined || bucket.length === 0) continue;
    lines.push(`## ${section.heading} (${String(bucket.length)})`);
    lines.push("");
    for (const finding of bucket) {
      lines.push(renderFinding(finding));
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderInlineSummary(summary: InlinePostSummary): string {
  if (summary.failed) {
    return `Inline comments: failed (${summary.failureMessage ?? "unknown error"}).`;
  }
  return [
    `Inline comments: ${String(summary.posted)} posted`,
    `${String(summary.skippedUnanchored)} unanchored`,
    `${String(summary.skippedDuplicate)} duplicate`,
    `${String(summary.skippedWithoutSuggestion)} suggestions skipped`,
  ].join("; ");
}

export function renderStatusCommentBody(
  input: PostReviewStatusInput,
  marker: string,
): string {
  const lines: string[] = [];
  lines.push(marker);
  lines.push("");
  lines.push(
    "**pr-review-bot** (deterministic checks + multi-specialist review)",
  );
  lines.push("");
  lines.push(`PR: #${String(input.pipeline.prNumber)}`);
  lines.push(`Commit: \`${input.pipeline.commitSha}\``);
  lines.push("");

  if (input.state === "draft_skipped") {
    lines.push(
      "Review skipped: draft PR detected. I will run and post inline comments once the PR is marked ready for review.",
    );
  } else if (input.state === "running") {
    lines.push(
      "Review running: deterministic checks, specialist review, consensus, verification, and dedupe are in progress.",
    );
  } else {
    lines.push("Review failed before completion.");
    if (input.reason !== undefined) {
      lines.push("");
      lines.push(`Failure: ${input.reason}`);
    }
  }

  if (input.workflowId !== undefined) {
    lines.push("");
    lines.push(`Workflow: \`${input.workflowId}\``);
  }
  lines.push("");
  return lines.join("\n");
}
