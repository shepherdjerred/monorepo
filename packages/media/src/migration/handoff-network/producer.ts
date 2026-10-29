import { z } from "zod";
import {
  HandoffNetworkProtocolSchema,
  handoffProtocolVersion,
} from "#shared/handoff/protocol.ts";
import { observeLibraryPlexV3 } from "./plex-v3.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { readHandoffPlan } from "./plan.ts";
import { observeHandoffMounts } from "./mounts.ts";
import { observePlex } from "./plex.ts";
import { observeClaims, assertClaimsCurrent } from "./claims.ts";
import { observeTorrents } from "./torrents.ts";
import { protectedEvidence, type HandoffNetworkContext } from "./context.ts";

/** GET-only external observations; the only write is an immutable evidence row. */
export function createHandoffNetworkProducer(context: HandoffNetworkContext) {
  return async (planId: string) => {
    const capturedAt = new Date();
    const signal = AbortSignal.timeout(60_000);
    const input = await readHandoffPlan(context.db, planId);
    const quiescence = await context.observer.observe(signal);
    if (!quiescence.quiescent)
      throw protectedEvidence("handoff_legacy_writers_running");
    const mounts = await observeHandoffMounts(
      context,
      input,
      quiescence,
      signal,
    );
    const [plex, claims, torrents] = await Promise.all([
      "schemaVersion" in input.scope && input.scope.schemaVersion === 3
        ? observeLibraryPlexV3(context, input, signal)
        : observePlex(context, input, signal),
      "schemaVersion" in input.scope
        ? Promise.resolve([])
        : observeClaims(context, input, signal),
      "schemaVersion" in input.scope
        ? Promise.resolve([])
        : observeTorrents(context, input, signal),
    ]);
    signal.throwIfAborted();
    const expiresAt = new Date(
      Math.min(
        Date.parse(quiescence.expiresAt),
        Date.parse(mounts.expiresAt),
        capturedAt.getTime() + 90_000,
      ),
    );
    const evidence = HandoffNetworkProtocolSchema.parse({
      schemaVersion: handoffProtocolVersion(input.scope),
      planId,
      recoveryEpoch: input.plan.recoveryEpoch,
      quiescence,
      mounts,
      capturedAt: capturedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      plex,
      claims,
      torrents,
    });
    const wire = JSON.stringify(evidence);
    const serialized = z.record(z.string(), z.json()).parse(JSON.parse(wire));
    const evidenceHash = snapshotHash(serialized);
    return context.db.$transaction(async (tx) => {
      for (const mediaId of input.scope.media
        .map((media) => media.mediaId)
        .sort())
        await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${mediaId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "MigrationBundleReview" WHERE id = ${input.plan.bundleReviewId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "MediaHandoffPlan" WHERE id = ${planId} FOR SHARE`;
      const current = await readHandoffPlan(tx, planId);
      if (
        snapshotHash(z.json().parse(current.scope)) !==
          snapshotHash(z.json().parse(input.scope)) ||
        expiresAt.getTime() <= Date.now()
      )
        throw protectedEvidence("handoff_observation_expired_or_changed");
      await assertClaimsCurrent(tx, claims);
      const observation = await tx.mediaHandoffObservation.create({
        data: {
          planId,
          kind: "network",
          evidenceHash,
          evidence: serialized,
          observedAt: capturedAt,
          expiresAt,
        },
      });
      return {
        observationId: observation.id,
        evidenceHash,
        expiresAt: expiresAt.toISOString(),
      };
    });
  };
}
