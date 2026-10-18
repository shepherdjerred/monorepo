import type { MediaHandoffFileActivities } from "#shared/automation.ts";
import { prepareHandoffFiles, type HandoffFileContext } from "./files.ts";
import { finishHandoffPreparation } from "./plan.ts";
import { applyPreparedHandoff } from "./apply.ts";

export function createHandoffFileActivities(
  context: HandoffFileContext,
): MediaHandoffFileActivities {
  return {
    async prepareMediaHandoffFiles({ planId }) {
      const plan = await context.files.db.mediaHandoffPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      if (plan.state === "awaiting_review" || plan.state === "applied") return;
      const prepared = await prepareHandoffFiles(context, planId);
      await finishHandoffPreparation(context.files.db, planId, prepared);
    },
    async applyMediaHandoffFiles(input) {
      const { planId } = input;
      const receipt = await context.files.db.mediaHandoffReceipt.findUnique({
        where: { planId },
      });
      if (receipt !== null) return;
      const prepared = await prepareHandoffFiles(context, planId);
      await applyPreparedHandoff(context, input, prepared);
    },
  };
}
