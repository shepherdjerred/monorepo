import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { publishCoverage } from "#automation/publication.ts";
import {
  assertCompensatedPublication,
  commitCompensatedPublication,
  type CompensationPublicationAuthority,
} from "#infrastructure/native-compensation/publication.ts";
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
import { snapshotHash } from "#migration/profile-import.ts";

function authorityHash(authority: CompensationPublicationAuthority) {
  const { freshness: _freshness, ...identity } = authority;
  return snapshotHash(z.json().parse(identity));
}

export async function publishCompensatedMedia(
  context: MediaAutomationContext,
  raw: NativeCompensationActivityInput,
  execution: NativeCompensationExecutionContext,
): Promise<{
  status: "available" | "waiting" | "blocked";
  reason: string | null;
}> {
  assertCompensationActive(execution);
  const input = NativeCompensationActivityInputSchema.parse(raw);
  try {
    const authority = await compensationAwait(execution, () =>
      context.db.$transaction((tx) => assertCompensatedPublication(tx, input)),
    );
    if (authority.verifiedPublication !== null)
      return { status: "available", reason: null };
    if (authority.freshness === null)
      throw new Error("Unverified publication lacks a live freshness fence");
    const expected = authorityHash(authority);
    let freshness = authority.freshness;
    const publicationExecution = {
      ...execution,
      assertActive: () => {
        assertCompensationActive(execution);
        freshness.assertActive();
      },
    };
    const acceptCurrent = (current: CompensationPublicationAuthority) => {
      if (authorityHash(current) !== expected)
        throw new NativeCompensationProtection(
          "compensation_publication_changed",
        );
      if (current.freshness === null)
        throw new Error("Unverified publication lacks a live freshness fence");
      freshness = current.freshness;
      publicationExecution.assertActive();
    };
    return await compensationAwait(publicationExecution, () =>
      publishCoverage(context, authority.mediaIds, input.operationId, {
        epoch: authority.recoveryEpoch,
        receipt: { mediaIds: authority.mediaIds, assets: authority.assets },
        requiredGenerations: authority.generations,
        compensation: {
          execution: publicationExecution,
          beforeNetwork: async () => {
            const current = await compensationAwait(execution, () =>
              context.db.$transaction((tx) =>
                assertCompensatedPublication(tx, input),
              ),
            );
            acceptCurrent(current);
            if (
              (await compensationAwait(publicationExecution, () =>
                context.plex.machineIdentifier(execution.signal),
              )) !== context.serverMachineId
            )
              throw new NativeCompensationProtection(
                "compensation_plex_server_changed",
              );
            // Identity IO holds no PG locks; reacquire the complete authority
            // after that last external await before any refresh can dispatch.
            acceptCurrent(
              await compensationAwait(execution, () =>
                context.db.$transaction((tx) =>
                  assertCompensatedPublication(tx, input),
                ),
              ),
            );
          },
          lockAndAssert: async (tx) => {
            const current = await compensationAwait(execution, () =>
              assertCompensatedPublication(tx, input),
            );
            acceptCurrent(current);
          },
          commitVerified: async (tx, items) => {
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
              commitCompensatedPublication(tx, {
                activity: input,
                publication,
              }),
            );
            assertCompensationActive(publicationExecution);
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
