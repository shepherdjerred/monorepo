import { activatePendingDares } from "#src/dares/lifecycle/dare-activation.ts";
import { refreshPendingDareCallouts } from "#src/dares/presentation/dare-callout.ts";
import { settleMatureDareSqlRaces } from "#src/dares/settlement/dare-settle-contract.ts";
import { DarePartialSettlementError } from "#src/dares/settlement/dare-settle-types.ts";
import { settleEndedDareWindows } from "#src/dares/settlement/dare-sweep.ts";
import { prisma } from "#src/database/index.ts";
import { runMaintenanceSteps } from "#src/league/tasks/maintenance-steps.ts";
import {
  markPostMatchPollCompleted,
  markPostMatchPollFailed,
  type PostMatchPollOwner,
} from "#src/league/tasks/recovery/app-state.ts";

/**
 * Run the post-match clocks and close the poll.
 *
 * `pollOwner` is the poll this pass may close: post-match discovery claims it
 * durably for the whole Workflow. The close is guarded on that identity, so a
 * run whose claim was taken over closes nothing and fails loudly, rather than
 * marking a LATER run's poll complete underneath it.
 */
export async function runPostMatchMaintenance(options: {
  settleDareV2Deadlines: boolean;
  dareEvidenceWatermark?: Date | undefined;
  pollOwner: PostMatchPollOwner;
}): Promise<void> {
  const settleDareV2Deadlines = options.settleDareV2Deadlines;
  // Published contracts keep resolving after authoring is switched off.
  const steps = [
    {
      name: "dare activation",
      run: async () => {
        await activatePendingDares();
      },
    },
    {
      name: "dare race finality",
      run: async () => {
        if (
          settleDareV2Deadlines &&
          options.dareEvidenceWatermark !== undefined
        ) {
          await settleMatureDareSqlRaces(prisma, options.dareEvidenceWatermark);
        }
      },
    },
    {
      name: "dare deadline settle",
      run: async () => {
        try {
          if (settleDareV2Deadlines) {
            await settleEndedDareWindows(
              undefined,
              options.dareEvidenceWatermark,
            );
          }
          await refreshPendingDareCallouts();
        } catch (error) {
          if (error instanceof DarePartialSettlementError) {
            await refreshPendingDareCallouts();
          }
          throw error;
        }
      },
    },
  ];
  const close = { owner: options.pollOwner };
  // Isolated per step, then re-thrown: a persistently failing recovery path
  // cannot starve the remaining clocks while money stays escrowed.
  try {
    await runMaintenanceSteps("post-match maintenance", steps);
    await markPostMatchPollCompleted({
      completedAt: new Date(),
      evidenceComplete: settleDareV2Deadlines,
      evidenceWatermark: options.dareEvidenceWatermark,
      ...close,
    });
  } catch (error) {
    try {
      await markPostMatchPollFailed(error, new Date(), close);
    } catch (closeError) {
      // Both facts matter and neither may hide the other: the clocks failed,
      // AND the poll this run meant to close was no longer its own. Reporting
      // only the first would lose a durable-write conflict; reporting only the
      // second would lose why maintenance failed at all.
      throw new AggregateError(
        [error, closeError],
        "Post-match maintenance failed and its poll was no longer this run's to close",
        { cause: closeError },
      );
    }
    throw error;
  }
}
