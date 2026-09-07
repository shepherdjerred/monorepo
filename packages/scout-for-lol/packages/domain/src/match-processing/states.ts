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
 * Canonical identity of a receipt scope: an injective string encoding used as
 * one component of a receipt's identity.
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

/**
 * What a receipt attests to (e.g. a delivered report, a settled market).
 * Deliberately a branded string rather than a closed set: receipt kinds are
 * defined by the workflows of later waves, so the domain must not enumerate
 * them yet. The shape is still constrained to kebab-case so the composite
 * identity key encoding stays injective (no `:` inside a kind).
 */
export type ReceiptKind = z.infer<typeof ReceiptKindSchema>;
export const ReceiptKindSchema = z
  .string()
  .regex(/^[a-z\d][a-z\d-]*$/)
  .brand<"ReceiptKind">();

export type MatchProcessingReceipt = z.infer<
  typeof MatchProcessingReceiptSchema
>;
export const MatchProcessingReceiptSchema = z.strictObject({
  kind: ReceiptKindSchema,
  version: z.number().int().min(1),
  scope: ReceiptScopeSchema,
  recordedAt: IsoInstantSchema,
});

/**
 * Full identity of a receipt: `(kind, version, scope)`. Two receipts sharing
 * this key are the same receipt — a state holds at most one, and
 * `recordReceipt` is idempotent over it. `recordedAt` is evidence, not
 * identity. The encoding is injective: kinds cannot contain `:`, the version
 * is an integer, and the scope key is itself injective.
 */
export function matchProcessingReceiptIdentityKey(args: {
  kind: ReceiptKind;
  version: number;
  scope: ReceiptScope;
}): string {
  return `${args.kind}:${String(args.version)}:${receiptScopeKey(args.scope)}`;
}

/**
 * Processing state for one match. Invariants beyond field shapes:
 *
 * - a promotion record exists only on a FULL state (ARCHIVE_ONLY never
 *   carries one; a FULL state without one was born FULL);
 * - receipt identities `(kind, version, scope)` are unique — one receipt per
 *   identity, so one state can carry receipts spanning many kinds.
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
    const seenIdentityKeys = new Set<string>();
    for (const [index, receipt] of state.receipts.entries()) {
      const identityKey = matchProcessingReceiptIdentityKey(receipt);
      if (seenIdentityKeys.has(identityKey)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate receipt identity: ${identityKey}`,
          path: ["receipts", index],
        });
      }
      seenIdentityKeys.add(identityKey);
    }
  });

export const matchProcessingStateCodec = defineVersionedCodec({
  kind: "match-processing-state",
  version: 1,
  schema: MatchProcessingStateSchema,
});
