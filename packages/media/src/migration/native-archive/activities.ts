import { z } from "zod";
import type { QbittorrentClient } from "#integrations/qbittorrent.ts";
import { MediaError } from "#application/errors.ts";
import { PendingLegacyClaimsError } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { NativeArchiveProtection } from "#infrastructure/native-archive/continuation.ts";
import {
  NativeArchiveContinuationSchema,
  CleanupNativeArchiveInputSchema,
  type NativeArchiveNetworkActivities,
} from "#shared/native-recovery/archive.ts";
import {
  archiveAwait,
  assertArchiveActive,
} from "#automation/native-archive/execution.ts";
import type { NativeArchiveObserverContext } from "./evidence.ts";
import { createNativeArchiveObserver } from "./producer.ts";
import { createNativeArchiveCleanupObserver } from "./cleanup.ts";

type Context = NativeArchiveObserverContext & {
  qbittorrent: Pick<QbittorrentClient, "login" | "listAll">;
};
export function createNativeArchiveNetworkActivities(
  context: Context,
): NativeArchiveNetworkActivities {
  const observe = createNativeArchiveObserver(context);
  const cleanup = createNativeArchiveCleanupObserver(context);
  return {
    async observeNativeArchive(input) {
      const execution = context.archiveExecution();
      assertArchiveActive(execution);
      const operation = await archiveAwait(
        execution,
        context.db.operation.findUniqueOrThrow({
          where: { id: input.operationId },
        }),
      );
      const payload = z
        .object({ planId: z.uuid(), operationId: z.uuid() })
        .parse(operation.payload);
      if (
        !["prepare_native_archive", "apply_native_archive"].includes(
          operation.kind,
        ) ||
        operation.targetId !== input.planId ||
        payload.planId !== input.planId ||
        payload.operationId !== input.operationId
      )
        throw new Error("Archive observation coordinator changed");
      await archiveAwait(
        execution,
        context.qbittorrent.login(execution.signal),
      );
      await archiveAwait(execution, observe(input.planId));
    },
    async nativeArchiveCleanupState(raw) {
      const execution = context.archiveExecution();
      assertArchiveActive(execution);
      const input = CleanupNativeArchiveInputSchema.parse(raw);
      const row = await archiveAwait(
        execution,
        context.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
          where: { id: input.continuationId },
        }),
      );
      if (
        row.recoveryEpoch !== input.recoveryEpoch ||
        row.coordinatorOperationId !== input.operationId
      )
        throw new Error("Archive cleanup coordinator changed");
      const descriptor = NativeArchiveContinuationSchema.parse(row.descriptor);
      const edge = descriptor.scope.edges.find(
        (entry) => entry.id === descriptor.selectedCleanupId && entry.selected,
      );
      if (edge === undefined)
        throw new Error("Archive cleanup deadline missing");
      return { state: row.state, expiresAt: edge.expiresAt };
    },
    async observeNativeArchiveCleanup(input) {
      const execution = context.archiveExecution();
      assertArchiveActive(execution);
      try {
        await archiveAwait(
          execution,
          context.qbittorrent.login(execution.signal),
        );
        await archiveAwait(execution, cleanup(input));
        return { status: "ready" };
      } catch (error) {
        assertArchiveActive(execution);
        const reason = protectionReason(error);
        if (reason === null) throw error;
        await archiveAwait(
          execution,
          context.db.nativeArchiveCleanupContinuation.updateMany({
            where: {
              id: input.continuationId,
              coordinatorOperationId: input.operationId,
              recoveryEpoch: input.recoveryEpoch,
              state: { in: ["pending", "cleaning", "protected"] },
            },
            data: { state: "protected", version: { increment: 1 } },
          }),
        );
        return { status: "protected", reason };
      }
    },
  };
}

function protectionReason(error: unknown) {
  if (error instanceof NativeArchiveProtection) return error.reason;
  if (error instanceof PendingLegacyClaimsError)
    return "archive_legacy_claims_unresolved";
  return error instanceof MediaError ? error.code : null;
}
