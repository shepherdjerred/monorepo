import { expect } from "vitest";
import { z } from "zod";
import type { createPerEpisodeNativeRecoveryFixtureV1 } from "@shepherdjerred/media/testing/per-episode-native-recovery";
import {
  nativeSeriesPackPaidV1,
  nativeSeriesPackNetworkAdapterV1,
  nativeRecoverySdk,
} from "./native-recovery-phases.ts";

type Fixture = Awaited<
  ReturnType<typeof createPerEpisodeNativeRecoveryFixtureV1>
>;

/** Actual owner/requester API calls, independently bounded at their real
 * invocation boundaries. No direct declaration, hold or terminal-state writes. */
export async function reconcileNativeSeriesPackHouseholdV1(
  scenario: Fixture,
  charges: { method: string; paid: number }[],
) {
  await scenario.refreshSourceAuthority();
  const paid = <T>(method: string, work: () => Promise<T>) =>
    nativeSeriesPackPaidV1(method, charges, work);
  await scenario.household.configureAccess();
  const { service, owner, requester } = scenario.household;
  const first = scenario.mediaIds[0];
  if (first === undefined)
    throw new Error("Genuine TV household scope missing");
  const prepared = await paid("household_prepare", () =>
    service.prepare(owner, crypto.randomUUID(), { mediaIds: [first] }),
  );
  const id = z.uuid().parse(prepared.recoveryReviewId);
  const detail = await paid("household_detail", () =>
    service.detail(owner, id),
  );
  expect(detail.scope.blockers).toEqual([]);
  expect(detail.scope.media.map((media) => media.id).toSorted()).toEqual(
    scenario.mediaIds.toSorted(),
  );
  for (const actor of [owner, requester])
    await paid(`household_respond_${actor.role}`, () =>
      service.respond(actor, crypto.randomUUID(), id, {
        scopeHash: detail.scopeHash,
        declarations: scenario.mediaIds.map((mediaId) => ({
          mediaId,
          intent: "request",
        })),
        acknowledgePending: true,
      }),
    );
  const reviewed = await paid("household_reviewed", () =>
    service.detail(owner, id),
  );
  await paid("household_release", () =>
    service.release(owner, crypto.randomUUID(), id, {
      expectedVersion: reviewed.version,
      scopeHash: reviewed.scopeHash,
      responseHash: z.string().parse(reviewed.responseHash),
      confirmHouseholdBaseline: true,
      confirmExistingPins: true,
      acknowledgeMissingHistory: true,
    }),
  );
}

/** Real Network adapter, actual two-pass Plex publication and immutable whole
 * serving/fence pair. The original transition/NULL outcome is never rewritten. */
export async function publishNativeSeriesPackV1(
  scenario: Fixture,
  continuationId: string,
  charges: { method: string; paid: number }[],
) {
  await scenario.refreshSourceAuthority();
  const row =
    await scenario.db.nativePublicationCompensationContinuation.findUniqueOrThrow(
      { where: { id: continuationId } },
    );
  const operationId = z.uuid().parse(row.publicationCoordinatorOperationId);
  const network = nativeSeriesPackNetworkAdapterV1(scenario);
  const result = await nativeSeriesPackPaidV1("network_serving", charges, () =>
    nativeRecoverySdk(operationId, "native-serving").run(
      network.publishSeriesPackNativeCompensationV1,
      {
        schemaVersion: 1,
        continuationId,
        operationId,
        recoveryEpoch: row.recoveryEpoch,
      },
    ),
  );
  expect(result).toEqual({ status: "available", reason: null });
  const detail = await nativeSeriesPackPaidV1("native_detail", charges, () =>
    scenario.nativeDetail(continuationId),
  );
  expect(detail).toMatchObject({
    schemaVersion: 1,
    protocol: "series_pack_native_compensation_v1",
    state: "applied",
    compensationContinuations: [
      {
        state: "compensated",
        publicationState: "available",
        fenceActive: false,
      },
    ],
  });
  const inventory = await nativeSeriesPackPaidV1(
    "native_inventory",
    charges,
    () => scenario.nativeInventory(),
  );
  expect(inventory.items).toHaveLength(1);
  expect(inventory.items[0]).toMatchObject({
    transitionId: row.transitionId,
    selectable: false,
  });
  return { operationId, result };
}
