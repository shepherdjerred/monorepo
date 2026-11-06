import { MediaError } from "#application/errors.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { publishCoverage } from "#automation/publication.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { PendingLegacyClaimsError } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { z } from "zod";
import { SeriesPackNativeDescriptorV2Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import {
  SeriesPackNativeCompletionV2Schema,
  SeriesPackNativeVerifiedPublicationV2Schema,
  type SeriesPackNativeActivityV1,
} from "#shared/native-recovery/series-pack/runtime.ts";
import { NativeCompensationActivityInputSchema } from "#shared/native-recovery/compensation-runtime.ts";
import {
  readSeriesPackNativePublicationV1,
  SeriesPackNativePublicationEnvelopeV2Schema,
} from "#infrastructure/native-compensation/series-pack/publication/record.ts";
import {
  loadSeriesPackNativePublicationPhaseV1,
  seriesPackNativePublicationAuthorityHashV1,
} from "#infrastructure/native-compensation/series-pack/publication/phase.ts";
import { commitSeriesPackNativePublicationV1 } from "#infrastructure/native-compensation/series-pack/publication/commit.ts";

/** Explicit new Network Activity producer. The facet captures BOTH this exact
 * execution and the original one100 budget before any lazy/runtime await. */
export async function publishSeriesPackNativeCompensationV1(
  context: MediaAutomationContext,
  raw: SeriesPackNativeActivityV1,
  execution: PlexBindingExecution,
  budget: PublicationAuthorityReadBudget,
): Promise<{
  status: "available" | "waiting" | "blocked";
  reason: string | null;
}> {
  execution.assertActive();
  const input = NativeCompensationActivityInputSchema.parse(raw);
  try {
    const acknowledged = await context.db.$transaction((tx) =>
      readSeriesPackNativePublicationV1(tx, input, budget),
    );
    if (acknowledged !== null) return { status: "available", reason: null };
    // Data discovery only. No Files, refresh, binding or availability mutation
    // precedes the actual complete phase loaded by publishCoverage below.
    const locator =
      await context.db.nativePublicationCompensationContinuation.findUniqueOrThrow(
        { where: { id: input.continuationId } },
      );
    budget.consume(1);
    const operation = await context.db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    budget.consume(1);
    const descriptor = SeriesPackNativeDescriptorV2Schema.parse(
      locator.descriptor,
    );
    const completion = SeriesPackNativeCompletionV2Schema.parse(
      locator.completion,
    );
    const { kind, operationId, ...command } =
      SeriesPackNativePublicationEnvelopeV2Schema.parse(operation.payload);
    if (
      identityHash(locator.descriptor) !== locator.descriptorHash ||
      locator.recoveryEpoch !== input.recoveryEpoch ||
      locator.publicationCoordinatorOperationId !== input.operationId ||
      locator.fenceRelease !== null ||
      operation.id !== operationId ||
      operation.id !== input.operationId ||
      operation.kind !== kind ||
      operation.targetId !== locator.id ||
      command.continuationId !== locator.id ||
      command.recoveryEpoch !== locator.recoveryEpoch ||
      command.completionHash !== identityHash(completion) ||
      command.bindingsHash !== identityHash(completion.predecessorBindings)
    )
      throw new Error(
        "Native pack publication discovery changed its actual literal command or completion",
      );
    const mediaIds = [...descriptor.scope.publication.intent.mediaIds];
    const assets = completion.predecessorBindings.map(({ after }) => ({
      assetId: after.id,
      assetVersion: after.version,
      checksum: after.checksum,
      mediaIds: after.coverage
        .filter((row) => row.current)
        .map((row) => row.mediaId),
    }));
    let freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: execution.expiresAtMs,
      guards: [execution],
    });
    let expectedAuthorityHash: string | undefined;
    const publicationExecution = {
      ...execution,
      assertActive() {
        execution.assertActive();
        freshness.assertActive();
      },
      checkpoint: (_phase: string) => execution.checkpoint(),
    };
    return await publishCoverage(context, mediaIds, input.operationId, {
      epoch: input.recoveryEpoch,
      receipt: { mediaIds, assets },
      requiredGenerations: command.generations,
      binding: {
        execution,
        budget,
        compensation: {
          continuationId: input.continuationId,
          execution: publicationExecution,
          beforeNetwork: async () => {
            publicationExecution.assertActive();
            if (
              (await context.plex.machineIdentifier(execution.signal)) !==
              context.serverMachineId
            )
              throw new NativeCompensationProtection(
                "compensation_plex_server_changed",
              );
            publicationExecution.assertActive();
          },
          loadPhase: async (tx, readBudget) => {
            if (readBudget !== budget)
              throw new Error(
                "Native pack publisher changed its original Activity allowance",
              );
            const phase = await loadSeriesPackNativePublicationPhaseV1(
              tx,
              input,
              {
                observed: execution.observed,
                originalFreshness: freshness,
                ...(expectedAuthorityHash === undefined
                  ? {}
                  : { expectedAuthorityHash }),
              },
              budget,
            );
            expectedAuthorityHash ??=
              seriesPackNativePublicationAuthorityHashV1(phase.authority);
            freshness = plexBindingFreshness({
              observed: execution.observed,
              expiresAtMs: Math.min(
                freshness.expiresAtMs,
                phase.freshness.expiresAtMs,
              ),
              guards: [freshness, phase.freshness],
            });
            return phase;
          },
          commitVerified: async (tx, verified) => {
            if (verified.budget !== budget || !("protocol" in verified.phase))
              throw new Error(
                "Native pack publisher received another protocol or Activity allowance",
              );
            const authority = verified.phase.authority;
            const proof = SeriesPackNativeVerifiedPublicationV2Schema.parse({
              schemaVersion: 2,
              protocol: "series_pack_publication_v3",
              continuationId: input.continuationId,
              operationId: input.operationId,
              recoveryEpoch: input.recoveryEpoch,
              completionHash: authority.completionHash,
              bindingsHash: authority.bindingsHash,
              commandHash: authority.commandHash,
              commandRaw: canonicalJson(z.json().parse(command)),
              generations: authority.generations,
              serverMachineId: context.serverMachineId,
              items: verified.items,
              verifiedAt: new Date().toISOString(),
            });
            await commitSeriesPackNativePublicationV1(
              tx,
              verified.phase,
              proof,
              { budget, freshness: verified.freshness },
            );
            publicationExecution.assertActive();
          },
        },
      },
    });
  } catch (error) {
    execution.assertActive();
    if (error instanceof PendingLegacyClaimsError)
      return {
        status: "blocked",
        reason: "legacy_claim_reconciliation_required",
      };
    if (error instanceof NativeCompensationProtection)
      return { status: "blocked", reason: error.reason };
    if (error instanceof MediaError)
      return { status: "blocked", reason: error.code };
    throw error;
  }
}
