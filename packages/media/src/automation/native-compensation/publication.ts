import { MediaError } from "#application/errors.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { publishCoverage } from "#automation/publication.ts";
import {
  loadCompensationPublicationPhase,
  compensationPublicationAuthorityHash,
} from "#infrastructure/native-compensation/publication/phase.ts";
import { commitCompensatedPublicationPhase } from "#infrastructure/native-compensation/publication/commit.ts";
import { readVerifiedCompensationPublication } from "#infrastructure/native-compensation/publication-receipt.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import {
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import {
  NativeCompensationActivityInputSchema,
  NativeCompensationVerifiedPublicationSchema,
  type NativeCompensationActivityInput,
  type NativeCompensationExecutionContext,
} from "#shared/native-recovery/compensation-runtime.ts";
import {
  compensationAwait,
  assertCompensationActive,
} from "#migration/native-compensation/execution.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export async function publishCompensatedMedia(
  context: MediaAutomationContext,
  raw: NativeCompensationActivityInput,
  execution: NativeCompensationExecutionContext,
  bindingExecution: PlexBindingExecution = context.plexBindingExecution(),
): Promise<{
  status: "available" | "waiting" | "blocked";
  reason: string | null;
}> {
  assertCompensationActive(execution);
  if (
    !Number.isSafeInteger(execution.expiresAtMs) ||
    execution.expiresAtMs <= 0
  )
    throw new TypeError("Compensation invocation deadline is invalid");
  bindingExecution.assertActive();
  const input = NativeCompensationActivityInputSchema.parse(raw);
  const budget = new PublicationAuthorityReadBudget();
  try {
    const authority = await compensationAwait(execution, () =>
      context.db.$transaction(async (tx) => {
        const committed = await readVerifiedCompensationPublication(
          tx,
          input,
          budget,
        );
        if (committed !== null) return null;
        // Historical ACK above needs only the actual invocation guard. Fresh
        // authority retains the clock captured before lazy runtime/config IO.
        const originalFreshness = plexBindingFreshness({
          observed: bindingExecution.observed,
          expiresAtMs: Math.min(
            bindingExecution.expiresAtMs,
            execution.expiresAtMs,
          ),
          guards: [bindingExecution, execution],
        });
        const phase = await loadCompensationPublicationPhase(
          tx,
          input,
          {
            observed: bindingExecution.observed,
            originalFreshness,
          },
          budget,
        );
        return phase.authority;
      }),
    );
    if (authority === null) return { status: "available", reason: null };
    const binding = {
      ...bindingExecution,
      expiresAtMs: Math.min(
        bindingExecution.expiresAtMs,
        authority.freshness.expiresAtMs,
      ),
    };
    const expected = compensationPublicationAuthorityHash(authority);
    let freshness = authority.freshness;
    const publicationExecution = {
      ...execution,
      assertActive: () => {
        assertCompensationActive(execution);
        freshness.assertActive();
      },
    };
    return await compensationAwait(publicationExecution, () =>
      publishCoverage(context, authority.mediaIds, input.operationId, {
        epoch: authority.recoveryEpoch,
        receipt: { mediaIds: authority.mediaIds, assets: authority.assets },
        requiredGenerations: authority.generations,
        binding: {
          execution: binding,
          budget,
          compensation: {
            continuationId: input.continuationId,
            execution: publicationExecution,
            beforeNetwork: async () => {
              if (
                (await compensationAwait(publicationExecution, () =>
                  context.plex.machineIdentifier(execution.signal),
                )) !== context.serverMachineId
              )
                throw new NativeCompensationProtection(
                  "compensation_plex_server_changed",
                );
              // Capture/preflight immediately following identity IO each load a
              // fresh full phase; no live phase crosses this network await.
            },
            loadPhase: async (tx, readBudget) => {
              if (readBudget !== budget)
                throw new Error(
                  "Compensated publication changed its invocation budget",
                );
              const phase = await compensationAwait(publicationExecution, () =>
                loadCompensationPublicationPhase(
                  tx,
                  input,
                  {
                    observed: bindingExecution.observed,
                    originalFreshness: freshness,
                    expectedAuthorityHash: expected,
                  },
                  budget,
                ),
              );
              freshness = plexBindingFreshness({
                observed: bindingExecution.observed,
                expiresAtMs: Math.min(
                  freshness.expiresAtMs,
                  phase.freshness.expiresAtMs,
                ),
                guards: [freshness, phase.freshness],
              });
              publicationExecution.assertActive();
              return phase;
            },
            commitVerified: async (
              tx,
              {
                items,
                phase,
                freshness: verifiedFreshness,
                budget: readBudget,
              },
            ) => {
              if (readBudget !== budget)
                throw new Error(
                  "Compensated publication changed its invocation budget",
                );
              assertCompensationActive(publicationExecution);
              const publication =
                NativeCompensationVerifiedPublicationSchema.parse({
                  schemaVersion: 1,
                  continuationId: input.continuationId,
                  operationId: input.operationId,
                  recoveryEpoch: input.recoveryEpoch,
                  completionHash: authority.completionHash,
                  commandHash: authority.commandHash,
                  bindingsHash: authority.bindingsHash,
                  generations: authority.generations,
                  serverMachineId: context.serverMachineId,
                  items,
                  verifiedAt: new Date().toISOString(),
                });
              await compensationAwait(publicationExecution, () =>
                commitCompensatedPublicationPhase(tx, phase, publication, {
                  freshness: verifiedFreshness,
                  budget,
                }),
              );
              assertCompensationActive(publicationExecution);
            },
          },
        },
      }),
    );
  } catch (error) {
    assertCompensationActive(execution);
    if (error instanceof PendingLegacyClaimsError) {
      await compensationAwait(execution, () =>
        reopenLegacyClaimProtection(context.db, error.mediaIds),
      );
      return {
        status: "blocked",
        reason: "legacy_claim_reconciliation_required",
      };
    }
    if (error instanceof NativeCompensationProtection)
      return { status: "blocked", reason: error.reason };
    if (error instanceof MediaError)
      return { status: "blocked", reason: error.code };
    throw error;
  }
}
