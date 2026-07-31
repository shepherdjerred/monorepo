import { patched, proxyActivities } from "@temporalio/workflow";
import type {
  DataDragonActivities,
  DataDragonWorkflowInput,
  DataDragonUpdateMode,
  DataDragonUpdateResult,
} from "#activities/data-dragon.ts";
// Value (not type-only) imports: UPDATE_DATA_DRAGON_MAX_ATTEMPTS keeps the
// retry policy below in sync with the activity, and resolveTerminalFailureReason
// walks the failed-activity cause chain to label the terminal-failure metric.
// data-dragon-util.ts is a pure module with no I/O/Sentry imports, so pulling
// it into the workflow bundle is safe (see packages/temporal/CLAUDE.md on the
// workflow-bundle smoke test).
import {
  resolveTerminalFailureReason,
  UPDATE_DATA_DRAGON_MAX_ATTEMPTS,
} from "#activities/data-dragon-util.ts";

const {
  getDataDragonVersionState,
  recordDataDragonSkipped,
  recordDataDragonFailure,
} = proxyActivities<DataDragonActivities>({
  // Quick HTTP fetch + Zod parse, or a quick `gh pr list` — finishes in seconds.
  startToCloseTimeout: "1 minute",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

const { updateDataDragon } = proxyActivities<DataDragonActivities>({
  // Long: clones the monorepo, runs `bun install --frozen-lockfile`,
  // downloads ~3500 image assets in batches, refreshes the workspace
  // install, runs snapshot tests, commits + pushes + opens a PR.
  // Heartbeats fire every 10s (see data-dragon.ts) so worker death
  // surfaces in <60s.
  startToCloseTimeout: "90 minutes",
  heartbeatTimeout: "60 seconds",
  retry: {
    maximumAttempts: UPDATE_DATA_DRAGON_MAX_ATTEMPTS,
    initialInterval: "5 minutes",
    backoffCoefficient: 2,
    maximumInterval: "15 minutes",
  },
});

export async function runScoutDataDragonUpdate(
  mode: DataDragonUpdateMode,
  input: DataDragonWorkflowInput,
): Promise<DataDragonUpdateResult | undefined> {
  const state = await getDataDragonVersionState();

  if (mode === "version-check" && !state.updateRequired) {
    await recordDataDragonSkipped({
      ...state,
      mode,
      reason: "version-current",
    });
    return undefined;
  }

  // The "a PR for this exact version is already open" dedup guard (the
  // mechanical cause behind duplicate PRs #1827/#1856) lives INSIDE
  // updateDataDragon, not here, on purpose:
  //   - Retry safety: Temporal retries the *activity*, not this workflow, so a
  //     check here would be skipped on a retry that follows a prior attempt
  //     which already opened the PR — the activity must recheck immediately
  //     before it creates one.
  //   - Determinism: keeping the happy-path command sequence unchanged
  //     (getState → updateDataDragon) means a run started on an earlier
  //     deploy replays cleanly. (The failure path below adds one command,
  //     guarded by its own `patched()` gate.)
  try {
    return await updateDataDragon({
      ...state,
      mode,
      lanePriors: input.lanePriors,
    });
  } catch (error) {
    // Record the terminal outcome="failed" metric here, at the workflow level,
    // rather than inside updateDataDragon's catch. An attempt killed by OOM /
    // heartbeat timeout / worker death never runs activity code, so recording
    // in the activity would silently miss exactly those outages — yet Temporal
    // always surfaces the retries-exhausted failure to this catch as an
    // ActivityFailure, however the final attempt died. resolveTerminalFailureReason
    // walks the failure's `.cause` chain for the granular command message so the
    // reason label (git-push-failed / pr-create-failed / …) and the
    // ScoutDataDragonPrAutomationFailed reason filter keep working; a no-message
    // OOM/timeout kill falls through to "exception".
    //
    // patched() guards this new command so an in-flight history started on the
    // pre-patch deploy — which failed without recording here — still replays
    // deterministically.
    if (patched("data-dragon-workflow-record-terminal-failure")) {
      await recordDataDragonFailure({
        ...state,
        mode,
        reason: resolveTerminalFailureReason(error),
      });
    }
    throw error;
  }
}
