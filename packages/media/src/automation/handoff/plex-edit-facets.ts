import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { PlexClient } from "#integrations/plex.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import type {
  MediaHandoffOperation,
  LibraryPlexEditOperation,
  HandoffObservationReference,
} from "#shared/automation.ts";
import {
  FinishedLibraryHandoffV3Schema,
  LibraryHandoffScopeV3Schema,
} from "#shared/handoff/library-v3.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { editLibraryPlexEditionV3 } from "./plex-edit-network.ts";
import { prepareLibraryPlexEditFileV3 } from "./plex-edit-files.ts";
import type { HandoffFileContext } from "./files.ts";

export function createLibraryHandoffFileFacet(context: HandoffFileContext) {
  return {
    prepareEditFile: (
      input: LibraryPlexEditOperation,
      execution: PublicationExecution,
    ) => prepareLibraryPlexEditFileV3(context, input, execution),
  };
}

export function createLibraryHandoffNetworkFacet(context: {
  db: Database;
  plex: PlexClient;
  expectedServerMachineId: string;
}) {
  return {
    edit: (
      input: LibraryPlexEditOperation & {
        filesObservation: HandoffObservationReference;
      },
      execution: PlexBindingExecution,
    ) => editLibraryPlexEditionV3(context, input, execution),
    async plannedEdits(input: MediaHandoffOperation) {
      return context.db.$transaction(async (tx) => {
        const plan = await tx.mediaHandoffPlan.findUniqueOrThrow({
          where: { id: input.planId },
        });
        const command = await tx.operation.findUniqueOrThrow({
          where: { id: input.operationId },
        });
        const payload = z
          .object({
            schemaVersion: z.literal(3),
            planId: z.uuid(),
            planHash: z.string(),
            actorId: z.uuid(),
          })
          .parse(command.payload);
        LibraryHandoffScopeV3Schema.parse(plan.scope);
        if (
          command.kind !== "apply_library_handoff_v3" ||
          command.targetId !== plan.id ||
          payload.planId !== plan.id ||
          command.userId !== payload.actorId ||
          plan.planHash !== payload.planHash ||
          identityHash(plan.plan) !== plan.planHash
        )
          throw new Error(
            "Library edition plan requires its original explicit command",
          );
        return {
          assetIds: FinishedLibraryHandoffV3Schema.parse(
            plan.plan,
          ).plexEdits.map((change) => change.assetId),
        };
      });
    },
    async protect(input: MediaHandoffOperation) {
      await context.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaHandoffPlan" WHERE id=${input.planId} FOR UPDATE`;
        const plan = await tx.mediaHandoffPlan.findUniqueOrThrow({
          where: { id: input.planId },
          include: { receipt: true },
        });
        const operation = await tx.operation.findUniqueOrThrow({
          where: { id: input.operationId },
        });
        if (
          operation.kind !== "apply_library_handoff_v3" ||
          operation.targetId !== plan.id
        )
          throw new Error("Library handoff protection command changed");
        if (plan.receipt !== null) return;
        if (plan.state === "applying")
          await tx.mediaHandoffPlan.update({
            where: { id: plan.id },
            data: { state: "requires_review", version: { increment: 1 } },
          });
      });
    },
  };
}
