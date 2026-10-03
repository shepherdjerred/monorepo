import {
  abandonExpiredDareProposals,
  expireDareAcceptWindows,
} from "#src/betting/dares/settlement/dare-sweep.ts";
import { deliverDareSummaries } from "#src/betting/dares/presentation/notify/dare-delivery.ts";
import { expireDareV2AcceptWindows } from "#src/betting/dares/settlement/dare-sweep-v2.ts";
import { refreshPendingDareV2Callouts } from "#src/betting/dares/presentation/dare-callout-v2.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settlement-types.ts";
import { closeExpiredBettingWindows } from "#src/betting/settlement/sweep.ts";
import { closeExpiredParlayWindows } from "#src/betting/parlays/runtime/parlay-sweep.ts";
import { activatePendingParlayMarkets } from "#src/betting/parlays/runtime/parlay-publish.ts";
import { refreshClosedParlayMessages } from "#src/betting/parlays/runtime/parlay-refresh.ts";
import { refreshClosedBucksMessages } from "#src/betting/notify/message-refresh.ts";
import {
  runMaintenanceSteps,
  type MaintenanceStep,
} from "#src/league/tasks/maintenance-steps.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";

/**
 * The prematch maintenance sweeps: every clock the prematch poll drives that
 * is not live-game detection.
 *
 * They ran inside v1's `checkPreMatch`, which only `pollRealtime` called, so
 * a prematch poll that no longer runs v1 would stop closing betting windows
 * and expiring Dare accept windows. `scoutPrematchDiscoveryV2Workflow` runs
 * them now through `runPrematchMaintenance`, once per poll, after detection.
 * `checkPreMatch` builds its pass from the same list until v1 goes, so the
 * two paths cannot drift.
 *
 * Dare v2 recovery sits outside every feature flag so a rollout revocation
 * cannot strand funded contracts; the rest is betting and skipped while
 * betting is hard-disabled. `dareSummaries` collects what the Dare sweeps
 * resolved, for the summary delivery step at the end and for a caller that
 * reports them.
 */
export function prematchMaintenanceSteps(
  dareSummaries: DareSettlementSummary[],
): MaintenanceStep[] {
  const steps: MaintenanceStep[] = [
    {
      name: "dare v2 accept-window expiry",
      run: async () => {
        await expireDareV2AcceptWindows();
        await refreshPendingDareV2Callouts();
      },
    },
  ];
  if (isFeatureHardDisabled("betting_enabled")) return steps;
  steps.push(
    {
      // Durable publishing rows are a small outbox: retry Discord activation
      // before processing clocks, including after a restart between
      // persistence and the message edit that exposes buttons.
      name: "parlay market activation",
      run: async () => {
        await activatePendingParlayMarkets();
      },
    },
    {
      // Grey out the buttons on windows that have just expired. Purely
      // cosmetic: a click on a live-looking button is still refused by
      // placeBet, which re-checks closesAt inside its transaction.
      name: "betting window close",
      run: async () => {
        await refreshClosedBucksMessages(await closeExpiredBettingWindows());
      },
    },
    {
      name: "parlay window close",
      run: async () => {
        await refreshClosedParlayMessages(await closeExpiredParlayWindows());
      },
    },
    {
      // Unconfirmed proposals past their TTL. Swallows per-record errors.
      name: "dare proposal TTL",
      run: async () => {
        dareSummaries.push(...(await abandonExpiredDareProposals()));
      },
    },
    {
      // Accept windows nobody answered — a refund path, kept in its own step
      // so the proposal sweep above can never starve it.
      name: "dare accept-window expiry",
      run: async () => {
        dareSummaries.push(...(await expireDareAcceptWindows()));
      },
    },
    {
      // Delivery runs after the refunds committed and swallows per-summary,
      // so a dead channel can never re-run or block a refund.
      name: "dare summary delivery",
      run: async () => {
        await deliverDareSummaries(dareSummaries);
      },
    },
  );
  return steps;
}

/**
 * Run one prematch maintenance pass.
 *
 * Every step runs even when an earlier one throws, and the collected failures
 * are re-thrown at the end, so the Activity still fails and retries while no
 * broken sweep starves the refunds behind it.
 */
export async function runPrematchMaintenance(): Promise<void> {
  await runMaintenanceSteps(
    "prematch maintenance",
    prematchMaintenanceSteps([]),
  );
}
