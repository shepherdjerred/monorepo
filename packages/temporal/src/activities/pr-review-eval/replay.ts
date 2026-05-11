/**
 * Replay the pr-review bot against a single fixture (read-only).
 *
 * Part 2 stub: calls only the correctness specialist with a synthesized
 * `PrReviewContext` derived from the fixture's `pr.diff`. Phase 3
 * (specialists × consensus) lands the full pipeline; once it merges,
 * this activity gets swapped for one that runs the parent workflow's
 * activity graph end-to-end against the fixture diff.
 *
 * Why the stub: Phase 3 is in flight and may change `runSpecialists`
 * signature. Keeping the stub here means the nightly eval can produce
 * useful precision/recall numbers against the correctness specialist
 * alone today, and the swap-in for the full pipeline is a localized
 * change.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Context } from "@temporalio/activity";
import { withSpan } from "#observability/tracing.ts";
import { correctnessReviewer } from "#activities/pr-review/specialists/correctness.ts";
import type { Fixture } from "#shared/pr-review/eval-fixture.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import type { PrFileDiff, PrReviewContext } from "#shared/pr-review/context.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";

const COMPONENT = "pr-review-eval";

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "replayBotAgainstFixture",
      ...fields,
    }),
  );
}

/**
 * Parse a unified diff into PrFileDiff entries. Minimal — we only need
 * `path`, `status`, and `patch` for the specialist to consume; line
 * count totals are computed from the `+`/`-` lines in each hunk.
 *
 * The diff produced by `git diff <postFix> <parent>` (Option A inverted-
 * fix) is a regular unified diff with `diff --git a/X b/X` headers and
 * `@@` hunks. We split on `^diff --git` and process each file
 * independently.
 */
function parseUnifiedDiff(diff: string): PrFileDiff[] {
  const files: PrFileDiff[] = [];
  const chunks = diff.split(/^diff --git /m).filter((c) => c.length > 0);
  for (const chunk of chunks) {
    // First line is `a/<path> b/<path>` (without the leading `diff --git`).
    const firstLineEnd = chunk.indexOf("\n");
    if (firstLineEnd === -1) continue;
    const header = chunk.slice(0, firstLineEnd);
    const match = /^a\/(\S+) b\/(\S+)/.exec(header);
    if (match === null) continue;
    const filePath = match[2] ?? match[1];
    if (filePath === undefined) continue;
    const body = chunk.slice(firstLineEnd + 1);

    // Status: detect new/deleted/renamed from the header lines that
    // follow the path. We look at the first few hunk-header lines for
    // markers. Default to "modified".
    let status: PrFileDiff["status"] = "modified";
    if (body.includes("new file mode")) {
      status = "added";
    } else if (body.includes("deleted file mode")) {
      status = "removed";
    } else if (body.includes("rename from")) {
      status = "renamed";
    }

    // Count `+`/`-` lines that are NOT diff-header `+++`/`---`.
    let additions = 0;
    let deletions = 0;
    for (const line of body.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }

    // The "patch" the bot sees is just the body of the diff for this
    // file (everything after `diff --git a/X b/X`). Keep it raw.
    files.push({ path: filePath, status, additions, deletions, patch: body });
  }
  return files;
}

export type ReplayInput = {
  fixture: Fixture;
  /**
   * Absolute path to the local checkout of the fixtures repo (returned
   * by `loadFixtureCorpus`). The replay reads
   * `<scratchDir>/fixtures/<fixture.id>/<fixture.diffPath>`.
   */
  scratchDir: string;
};

export type ReplayResult = {
  postedFindings: Finding[];
  costUsd: number;
  latencySec: number;
};

async function replayImpl(input: ReplayInput): Promise<ReplayResult> {
  return await withSpan(
    "prReviewEval.replay",
    {
      "fixture.id": input.fixture.id,
      "fixture.category": input.fixture.category,
    },
    async () => {
      Context.current().heartbeat({ phase: "load-diff" });
      const diffPath = path.join(
        input.scratchDir,
        "fixtures",
        input.fixture.id,
        input.fixture.diffPath,
      );
      const diff = await readFile(diffPath, "utf8");
      const changedFiles = parseUnifiedDiff(diff);
      if (changedFiles.length === 0) {
        jsonLog("warning", "Fixture diff parsed to zero files — skipping", {
          fixtureId: input.fixture.id,
          diffPath,
          diffBytes: diff.length,
        });
        return { postedFindings: [], costUsd: 0, latencySec: 0 };
      }

      // Synthesize the PrReviewContext + PrReviewPipelineInput the
      // specialist expects. workdir is empty (Phase 5 retrieval would
      // populate it from a clone of the snapshot ref; for now the
      // specialist sees diff text only). CLAUDE.md hierarchy is also
      // empty — fixtures don't exercise CLAUDE.md-aware reviewers in
      // this Phase. Future Phase 5 work can extend the fixture schema
      // with a `repoSnapshotRef` that includes the CLAUDE.md tree.
      const context: PrReviewContext = {
        workdir: "",
        changedFiles,
        claudeMdHierarchy: [],
      };
      const pipeline: PrReviewPipelineInput = {
        owner: "shepherdjerred",
        repo: "monorepo",
        prNumber: input.fixture.source.prNumber ?? 0,
        commitSha: input.fixture.source.commitSha,
        baseRef: "fixture-base",
        headRef: "fixture-head",
        prTitle: input.fixture.source.subject ?? input.fixture.id,
        prAuthor: "fixture-replay",
      };

      Context.current().heartbeat({ phase: "run-specialist" });
      const start = Date.now();
      const result = await correctnessReviewer({ pipeline, context });
      const latencySec = (Date.now() - start) / 1000;
      jsonLog("info", "Replay complete", {
        fixtureId: input.fixture.id,
        findingsCount: result.findings.length,
        costUsd: result.costUsd,
        latencySec,
      });
      return {
        postedFindings: result.findings,
        costUsd: result.costUsd ?? 0,
        latencySec,
      };
    },
  );
}

export type EvalReplayActivities = typeof evalReplayActivities;

export const evalReplayActivities = {
  async prReviewEvalReplay(input: ReplayInput): Promise<ReplayResult> {
    return replayImpl(input);
  },
};

// Exported for tests
export { parseUnifiedDiff };
