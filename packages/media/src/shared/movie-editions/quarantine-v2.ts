import { z } from "zod";
import {
  PlexPhysicalGroupSchema,
  PlexBindingSnapshotSchema,
} from "#shared/plex-binding/contract.ts";
import { MovieEditionScopeSchema, MovieEditionHashSchema } from "./registry.ts";

/** A distinct receipt; historical quarantinePlexReceipt remains a literal v1 record. */
export const MovieQuarantinePlexReceiptV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    scope: MovieEditionScopeSchema,
    operationId: z.uuid(),
    decisionId: z.uuid(),
    recoveryEpoch: z.int().nonnegative(),
    manifestHash: MovieEditionHashSchema,
    decisions: z.tuple([
      z.strictObject({
        decisionId: z.uuid(),
        mediaId: z.uuid(),
        beforeVersion: z.int().nonnegative(),
        quarantinedVersion: z.int().nonnegative(),
        projectionHash: MovieEditionHashSchema,
      }),
    ]),
    groups: z.tuple([PlexPhysicalGroupSchema]),
    bindings: z.tuple([PlexBindingSnapshotSchema]),
    committedAt: z.iso.datetime(),
  })
  .refine((receipt) => {
    const decision = receipt.decisions[0];
    const group = receipt.groups[0];
    const binding = receipt.bindings[0];
    const member = group.coverage[0];
    return (
      decision.decisionId === receipt.decisionId &&
      decision.mediaId === receipt.scope.mediaId &&
      decision.quarantinedVersion === decision.beforeVersion + 1 &&
      group.canonicalRootId === receipt.scope.rootMediaId &&
      group.edition === receipt.scope.edition &&
      group.ownershipEpoch === receipt.recoveryEpoch &&
      group.coverage.length === 1 &&
      member?.mediaId === receipt.scope.mediaId &&
      member.edition === receipt.scope.edition &&
      binding.scope.mediaId === receipt.scope.mediaId &&
      binding.scope.edition === receipt.scope.edition
    );
  }, "Movie quarantine requires one exact movie edition, group, decision and binding");

export type MovieQuarantinePlexReceiptV2 = z.infer<
  typeof MovieQuarantinePlexReceiptV2Schema
>;
