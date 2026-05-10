import { Context } from "@temporalio/activity";
import { withSpan } from "#observability/tracing.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";

const COMPONENT = "pr-review-pipeline";

/**
 * Snapshot of the bootstrap step: clone metadata, list of changed files,
 * resolved package roots, CLAUDE.md hierarchy. Phase 1 stub returns empty
 * arrays so the workflow can wire the contract end-to-end without doing
 * any real cloning yet.
 */
export type BootstrapResult = {
  workdir: string;
  changedFiles: string[];
  packageRoots: string[];
};

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
      activity: "bootstrapContext",
      ...fields,
    }),
  );
}

async function bootstrapContextImpl(
  input: PrReviewPipelineInput,
): Promise<BootstrapResult> {
  return await withSpan(
    "prReview.bootstrapContext",
    {
      "pr.owner": input.owner,
      "pr.repo": input.repo,
      "pr.number": input.prNumber,
      "pr.commitSha": input.commitSha,
    },
    () => {
      // Phase 1: stub. Real implementation will clone PR head into a ZFS
      // scratch volume, run `bun run scripts/setup.ts --no-codegen`, build
      // the tree-sitter symbol index, and compute the BlockDiff. Tracked in
      // Phases 5–6 of packages/docs/plans/2026-05-10_sota-pr-review-bot.md.
      Context.current().heartbeat({ phase: "bootstrap-stub" });
      jsonLog("info", "bootstrapContext stub invoked", {
        prNumber: input.prNumber,
        commitSha: input.commitSha,
      });
      return Promise.resolve({
        workdir: "",
        changedFiles: [],
        packageRoots: [],
      });
    },
  );
}

export type BootstrapActivities = typeof bootstrapActivities;

export const bootstrapActivities = {
  async prReviewBootstrap(
    input: PrReviewPipelineInput,
  ): Promise<BootstrapResult> {
    return bootstrapContextImpl(input);
  },
};
