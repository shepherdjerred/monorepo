import { z } from "zod";
import { defineVersionedCodec } from "#src/codec/versioned.ts";
import { IsoInstantSchema, RiotMatchIdSchema } from "#src/identity/brands.ts";
import { DiscordGuildIdSchema } from "#src/identity/discord.ts";
import { AccountIdSchema } from "#src/identity/database-ids.ts";

/**
 * How a match is processed. ARCHIVE_ONLY captures raw payloads without
 * downstream effects; FULL runs the complete pipeline. A FULL match never
 * downgrades: no transition produces ARCHIVE_ONLY from FULL.
 */
export type MatchProcessingPolicy = z.infer<typeof MatchProcessingPolicySchema>;
export const MatchProcessingPolicySchema = z.enum(["ARCHIVE_ONLY", "FULL"]);

const UnownedPipelineOwnerSchema = z.strictObject({
  kind: z.literal("unowned"),
});
const LegacyV1PipelineOwnerSchema = z.strictObject({
  kind: z.literal("legacy-v1"),
});
const TemporalV2PipelineOwnerSchema = z.strictObject({
  kind: z.literal("temporal-v2"),
});

/**
 * A pipeline that can hold ownership of a match — every owner except
 * `unowned`. Claims take this type so claiming "unowned" is unrepresentable.
 */
export type AssignedPipelineOwner = z.infer<typeof AssignedPipelineOwnerSchema>;
export const AssignedPipelineOwnerSchema = z.discriminatedUnion("kind", [
  LegacyV1PipelineOwnerSchema,
  TemporalV2PipelineOwnerSchema,
]);

export type PipelineOwner = z.infer<typeof PipelineOwnerSchema>;
export const PipelineOwnerSchema = z.discriminatedUnion("kind", [
  UnownedPipelineOwnerSchema,
  LegacyV1PipelineOwnerSchema,
  TemporalV2PipelineOwnerSchema,
]);

/**
 * The audience a processing receipt applies to: everything, one guild, or one
 * tracked account.
 */
export type ReceiptScope = z.infer<typeof ReceiptScopeSchema>;
export const ReceiptScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("global") }),
  z.strictObject({ kind: z.literal("guild"), guildId: DiscordGuildIdSchema }),
  z.strictObject({
    kind: z.literal("account"),
    accountId: AccountIdSchema,
  }),
]);

/**
 * Canonical identity of a receipt scope. Two receipts with the same scope key
 * are the same receipt; `recordReceipt` is idempotent over this key.
 */
export function receiptScopeKey(scope: ReceiptScope): string {
  switch (scope.kind) {
    case "global":
      return "global";
    case "guild":
      return `guild:${scope.guildId}`;
    case "account":
      return `account:${String(scope.accountId)}`;
  }
}

export type MatchProcessingReceipt = z.infer<
  typeof MatchProcessingReceiptSchema
>;
export const MatchProcessingReceiptSchema = z.strictObject({
  scope: ReceiptScopeSchema,
  recordedAt: IsoInstantSchema,
});

/**
 * Processing state for one match. Invariants beyond field shapes:
 *
 * - a promotion record exists only on a FULL state (ARCHIVE_ONLY never
 *   carries one; a FULL state without one was born FULL);
 * - receipt scopes are unique — one receipt per scope identity.
 */
export type MatchProcessingState = z.infer<typeof MatchProcessingStateSchema>;
export const MatchProcessingStateSchema = z
  .strictObject({
    matchId: RiotMatchIdSchema,
    owner: PipelineOwnerSchema,
    policy: MatchProcessingPolicySchema,
    promotion: z.strictObject({ promotedAt: IsoInstantSchema }).nullable(),
    receipts: z.array(MatchProcessingReceiptSchema).readonly(),
  })
  .superRefine((state, ctx) => {
    if (state.policy === "ARCHIVE_ONLY" && state.promotion !== null) {
      ctx.addIssue({
        code: "custom",
        message: "an ARCHIVE_ONLY state cannot carry a promotion record",
        path: ["promotion"],
      });
    }
    const seenScopeKeys = new Set<string>();
    for (const [index, receipt] of state.receipts.entries()) {
      const scopeKey = receiptScopeKey(receipt.scope);
      if (seenScopeKeys.has(scopeKey)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate receipt scope: ${scopeKey}`,
          path: ["receipts", index],
        });
      }
      seenScopeKeys.add(scopeKey);
    }
  });

export const matchProcessingStateCodec = defineVersionedCodec({
  kind: "match-processing-state",
  version: 1,
  schema: MatchProcessingStateSchema,
});
