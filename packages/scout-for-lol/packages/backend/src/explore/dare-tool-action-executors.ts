import { createDareV2ConfirmationIntent } from "#src/betting/dare-intent-v2.ts";
import { inspectVisibleDareV2 } from "#src/betting/dare-view-v2.ts";
import { deleteDareDraftV2 } from "#src/betting/dare-draft-v2.ts";
import { prisma } from "#src/database/index.ts";
import {
  DareActionToolInputSchema,
  DareDeleteToolInputSchema,
} from "#src/explore/dare-tool-schemas.ts";
import type { DareExploreToolsInput } from "#src/explore/dare-tool-context.ts";
import {
  dareDomainResult,
  dareToolResult,
} from "#src/explore/dare-tool-result.ts";

const result = dareToolResult;
const safeDomainResult = dareDomainResult;

export function createDareActionExecutors(input: DareExploreToolsInput) {
  return {
    prepareAction: (raw: unknown) =>
      input.track("prepare_dare_action", async () => {
        const parsed = DareActionToolInputSchema.parse(raw);
        const intent = await createDareV2ConfirmationIntent({
          dareId: parsed.dareId,
          serverId: input.capability.serverId,
          actorDiscordId: input.requesterId,
          expectedRevision: parsed.expectedRevision,
          payload: parsed.payload,
          idempotencyKey: globalThis.crypto.randomUUID(),
        });
        const dare =
          intent.kind === "intent_created"
            ? await inspectVisibleDareV2(
                {
                  dareId: parsed.dareId,
                  serverId: input.capability.serverId,
                  viewerDiscordId: input.requesterId,
                  revision: parsed.expectedRevision,
                },
                prisma,
              )
            : null;
        return intent.kind === "intent_created"
          ? result(
              "confirmation_required",
              "The action is ready for explicit confirmation and expires in ten minutes.",
              {
                intentId: intent.intentId,
                action: intent.action,
                expiresAt: intent.expiresAt.toISOString(),
                dareId: parsed.dareId,
                revision: parsed.expectedRevision,
                ...(dare === null
                  ? {}
                  : {
                      originalText: dare.originalText,
                      plainLanguage: dare.plainLanguage,
                      canonicalScoutQl: dare.canonicalScoutQl,
                      sqlIsBinding: dare.contractVersion === 3,
                    }),
              },
            )
          : safeDomainResult(intent, "The action could not be prepared.");
      }),
    deleteDraft: (raw: unknown) =>
      input.track("delete_dare_draft", async () => {
        const parsed = DareDeleteToolInputSchema.parse(raw);
        const deleted = await deleteDareDraftV2({
          dareId: parsed.dareId,
          serverId: input.capability.serverId,
          challengerDiscordId: input.requesterId,
          expectedRevision: parsed.expectedRevision,
        });
        return safeDomainResult(
          deleted,
          deleted.kind === "deleted"
            ? "The private draft was deleted."
            : "That draft cannot be deleted.",
        );
      }),
  };
}
