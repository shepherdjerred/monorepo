import { proxyActivities } from "@temporalio/workflow";
import type {
  DataDragonActivities,
  DataDragonWorkflowInput,
  DataDragonUpdateMode,
  DataDragonUpdateResult,
} from "#activities/data-dragon.ts";
// Value (not type-only) import: this constant keeps the retry policy below
// and the activity's final-attempt check (data-dragon.ts's catch block, via
// isFinalAttempt) from drifting apart. data-dragon-util.ts is a pure module
// with no I/O/Sentry imports, so pulling it into the workflow bundle is safe
// (see packages/temporal/CLAUDE.md on the workflow-bundle smoke test).
import { UPDATE_DATA_DRAGON_MAX_ATTEMPTS } from "#activities/data-dragon-util.ts";

const {
  getDataDragonVersionState,
  recordDataDragonSkipped,
  hasOpenDataDragonPr,
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

  // Both modes skip if a PR bumping to this exact version is already open —
  // opening a second one just duplicates work already captured in the
  // pending PR (the mechanical cause behind duplicate PRs #1827/#1856).
  if (await hasOpenDataDragonPr(state.latestVersion)) {
    await recordDataDragonSkipped({
      ...state,
      mode,
      reason: "pr-already-open",
    });
    return undefined;
  }

  return await updateDataDragon({
    ...state,
    mode,
    lanePriors: input.lanePriors,
  });
}
