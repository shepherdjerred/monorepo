import { MediaError } from "#application/errors.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { publishCompensatedMedia } from "#automation/native-compensation/publication.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { readNativeCompensationState } from "#infrastructure/native-compensation/state.ts";
import { PendingLegacyClaimsError } from "#infrastructure/recovery/legacy-claims/protection.ts";
import {
  NativeCompensationActivityInputSchema,
  type NativeCompensationNetworkActivities,
  type NativeCompensationExecutionContext,
} from "#shared/native-recovery/compensation-runtime.ts";
import type { NativeCompensationObserverContext } from "./evidence.ts";
import { observeNativeCompensation } from "./producer.ts";
import { observeCompensationContinuation } from "./continuation.ts";
import { compensationAwait, assertCompensationActive } from "./execution.ts";

export function createNativeCompensationNetworkActivities(
  context: NativeCompensationObserverContext & MediaAutomationContext,
  createExecution: () => NativeCompensationExecutionContext,
): NativeCompensationNetworkActivities {
  return {
    async observeNativeCompensation(input) {
      const execution = createExecution();
      assertCompensationActive(execution);
      await compensationAwait(execution, () =>
        context.qbittorrent.login(execution.signal),
      );
      await compensationAwait(execution, () =>
        observeNativeCompensation(context, input, execution),
      );
    },
    async nativeCompensationState(raw) {
      const execution = createExecution();
      assertCompensationActive(execution);
      return compensationAwait(execution, () =>
        context.db.$transaction((tx) =>
          readNativeCompensationState(
            tx,
            NativeCompensationActivityInputSchema.parse(raw),
          ),
        ),
      );
    },
    async observeNativeCompensationExecution(raw) {
      const execution = createExecution();
      assertCompensationActive(execution);
      const input = NativeCompensationActivityInputSchema.parse(raw);
      try {
        const state = await compensationAwait(execution, () =>
          context.db.$transaction((tx) =>
            readNativeCompensationState(tx, input),
          ),
        );
        if (state.state === "compensated")
          return { status: "compensated", reason: null };
        await compensationAwait(execution, () =>
          context.qbittorrent.login(execution.signal),
        );
        await compensationAwait(execution, () =>
          observeCompensationContinuation(context, input, execution),
        );
        return { status: "ready", reason: null };
      } catch (error) {
        assertCompensationActive(execution);
        const reason = protectionReason(error);
        if (reason === null) throw error;
        await compensationAwait(execution, () =>
          context.db.nativePublicationCompensationContinuation.updateMany({
            where: {
              id: input.continuationId,
              coordinatorOperationId: input.operationId,
              recoveryEpoch: input.recoveryEpoch,
              state: { in: ["pending", "compensating", "protected"] },
            },
            data: { state: "protected", version: { increment: 1 } },
          }),
        );
        return { status: "protected", reason };
      }
    },
    publishCompensatedMedia(input) {
      const execution = createExecution();
      assertCompensationActive(execution);
      return publishCompensatedMedia(context, input, execution);
    },
  };
}

function protectionReason(error: unknown) {
  if (error instanceof NativeCompensationProtection) return error.reason;
  if (error instanceof PendingLegacyClaimsError)
    return "legacy_claim_reconciliation_required";
  return error instanceof MediaError ? error.code : null;
}
