import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import type { ObservePlexHintInput } from "#shared/plex-events/contract.ts";
import {
  lockWatchAuthority,
  watchScope,
  type WatchAuthority,
  type WatchParticipant,
} from "./authority.ts";
import {
  assertWatchActive,
  watchAwait,
  type WatchExecution,
} from "./execution.ts";

const CredentialSchema = z.object({ serverToken: z.string().min(1) });
export type PreparedWatchBatch = {
  mediaId: string;
  revision: bigint;
  startedAt: Date;
  authority: WatchAuthority;
  readers: {
    userId: string;
    serverToken: string | null;
    verifyAccess: boolean;
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
    return { userId: user.id, serverToken: null, verifyAccess: false };
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
  };
}

export async function prepareWatchBatch(
  context: MediaAutomationContext,
  mediaId: string,
  options: { expectedHint?: ObservePlexHintInput },
  execution: WatchExecution,
): Promise<PreparedWatchBatch | null> {
  const startedAt = new Date();
  const scope = await watchScope(context, mediaId, options, execution);
  return await serializable(context.db, async (tx) => {
    const authority = await lockWatchAuthority(tx, scope, execution);
    if (authority === null) return null;
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
    assertWatchActive(execution);
    return {
      mediaId,
      revision: fence.issuedRevision,
      startedAt,
      authority,
      readers,
      ...options,
    };
  });
}
