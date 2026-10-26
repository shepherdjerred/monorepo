import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import type { ObservePlexHintInput } from "#shared/plex-events/contract.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { watchDeadline } from "./deadline.ts";
import {
  lockWatchAuthority,
  watchScope,
  type WatchAuthority,
  type WatchParticipant,
} from "./authority.ts";
import { watchAwait } from "./execution.ts";

const CredentialSchema = z.object({ serverToken: z.string().min(1) });
export type PreparedWatchBatch = {
  mediaId: string;
  revision: bigint;
  startedAt: Date;
  authority: WatchAuthority;
  freshness: PlexBindingFreshness;
  readers: {
    userId: string;
    serverToken: string | null;
    verifyAccess: boolean;
    mappingExpiresAtMs: number | null;
  }[];
  expectedHint?: ObservePlexHintInput;
};

function reader(
  context: MediaAutomationContext,
  user: WatchParticipant,
  authority: WatchAuthority,
  input: { sections: { movie: string; series: string }; now: Date },
) {
  const { sections, now } = input;
  const mapping = user.plexIdentity;
  const verifiedAt = mapping?.verifiedAt;
  const credential = user.credentials[0];
  const expectedSection =
    authority.media.kind === "movie" ? sections.movie : sections.series;
  const permitted =
    mapping !== null &&
    mapping.serverMachineId === context.serverMachineId &&
    (mapping.kind === "account" || mapping.kind === "managed") &&
    (mapping.kind !== "managed" || mapping.homeUserId === user.plexAccountId) &&
    mapping.verifiedAt !== null &&
    mapping.verifiedAt <= now &&
    mapping.permittedSectionIds.includes(expectedSection) &&
    authority.identity.plexSectionId === expectedSection &&
    mapping.permittedMediaKinds.includes(
      authority.media.kind === "movie" ? "movie" : "series",
    ) &&
    authority.identity.plexRatingKey !== undefined;
  if (
    !permitted ||
    credential === undefined ||
    verifiedAt === null ||
    verifiedAt === undefined
  )
    return {
      userId: user.id,
      serverToken: null,
      verifyAccess: false,
      mappingExpiresAtMs: null,
    };
  const token = CredentialSchema.parse(
    JSON.parse(
      context.cipher.decrypt(
        credential.ciphertext,
        `plex:${user.plexAccountId}`,
      ),
    ),
  );
  return {
    userId: user.id,
    serverToken: token.serverToken,
    verifyAccess: now.getTime() - verifiedAt.getTime() > 300_000,
    mappingExpiresAtMs: verifiedAt.getTime() + 300_000,
  };
}

export async function prepareWatchBatch(
  context: MediaAutomationContext,
  mediaId: string,
  options: { expectedHint?: ObservePlexHintInput },
  execution: PlexBindingExecution,
): Promise<PreparedWatchBatch | null> {
  const startedAt = new Date(execution.observed.wall);
  const initialFreshness = plexBindingFreshness({
    ...execution,
    guards: [execution],
  });
  const active = {
    ...execution,
    assertActive: () => {
      initialFreshness.assertActive();
    },
  };
  const scope = await watchScope(context, mediaId, options, active);
  return await serializable(context.db, async (tx) => {
    const authority = await lockWatchAuthority(tx, scope, active);
    if (authority?.binding == null || !authority.hintCurrent) return null;
    const freshness = await watchDeadline(tx, authority, execution);
    await bindPlexTransactionDeadline(tx, freshness);
    const fence = await watchAwait(
      execution,
      tx.watchObservationFence.upsert({
        where: { mediaId_edition: defaultScope(mediaId) },
        create: { ...defaultScope(mediaId), issuedRevision: 1n },
        update: { issuedRevision: { increment: 1 } },
      }),
    );
    const readers = authority.participants.map((user) =>
      reader(context, user, authority, {
        sections: scope.sections,
        now: new Date(),
      }),
    );
    freshness.assertActive();
    return {
      mediaId,
      revision: fence.issuedRevision,
      startedAt,
      authority,
      freshness,
      readers,
      ...options,
    };
  });
}
