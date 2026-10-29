import type { Prisma } from "#generated/prisma/client.ts";
import type { NotificationContext } from "#automation/notifications/types.ts";
import type { MovieNoticeDelivery } from "./authority.ts";
import {
  readMovieRemovalNoticeV4,
  type MovieRemovalNoticeV4,
} from "#shared/movie-editions/removal-v4.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRemovalSourceV4 } from "./removal-source.ts";
import { currentMovieRemovalV4 } from "./removal-current.ts";
import { MediaError } from "#application/errors.ts";

export type PreparedMovieRemovalNoticeV4 = Awaited<
  ReturnType<typeof prepareMovieRemovalNoticeV4>
>;

export async function prepareMovieRemovalNoticeV4(
  context: Pick<NotificationContext, "db">,
  input: {
    delivery: MovieNoticeDelivery;
    execution: PlexBindingExecution;
    access: MovieChoiceAccess | undefined;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const payload = readMovieRemovalNoticeV4(input.delivery.event.payload);
  if (payload === null) return;
  const access = requireMovieChoiceAccess(input.access ?? {});
  const source = await readMovieRemovalSourceV4(
    context.db,
    payload.source,
    input.budget,
  );
  const current = await readRemovalNoticeAuthority(
    context.db,
    { delivery: input.delivery, payload, access, source },
    input.budget,
  );
  const freshness = plexBindingFreshness({
    observed: input.execution.observed,
    expiresAtMs: Math.min(
      input.execution.expiresAtMs,
      current.writerExpiresAtMs,
      current.choice.freshness.expiresAtMs,
    ),
    guards: [input.execution, current.choice.freshness],
  });
  return { payload, source, access, budget: input.budget, freshness };
}

export async function assertMovieRemovalNoticeConfiguration(
  context: NotificationContext,
  prepared: PreparedMovieRemovalNoticeV4,
) {
  if (prepared === undefined) return;
  prepared.freshness.assertActive();
  const access = await networkMovieAccess(context, [
    prepared.payload.source.scope.mediaId,
  ]).catch((error: unknown) => {
    prepared.freshness.assertActive();
    if (error instanceof MediaError && error.code === "plex_scope_unconfigured")
      throw new PlexBindingProtection("wrong_section");
    throw error;
  });
  prepared.freshness.assertActive();
  if (identityHash(access) !== identityHash(prepared.access))
    throw new PlexBindingProtection("wrong_section");
}

export async function assertPreparedMovieRemovalNoticeV4(
  tx: Prisma.TransactionClient,
  delivery: MovieNoticeDelivery,
  prepared: NonNullable<PreparedMovieRemovalNoticeV4>,
) {
  prepared.freshness.assertActive();
  const payload = readMovieRemovalNoticeV4(delivery.event.payload);
  if (
    payload === null ||
    identityHash(payload) !== identityHash(prepared.payload)
  )
    throw new Error("Movie removal notification selected payload changed");
  const current = await readRemovalNoticeAuthority(
    tx,
    { delivery, payload, access: prepared.access, source: prepared.source },
    prepared.budget,
  );
  prepared.freshness.assertActive();
  current.choice.freshness.assertActive();
  return current.choice.freshness;
}

async function readRemovalNoticeAuthority(
  tx: Prisma.TransactionClient,
  input: {
    delivery: MovieNoticeDelivery;
    payload: MovieRemovalNoticeV4;
    access: MovieChoiceAccess;
    source: Awaited<ReturnType<typeof readMovieRemovalSourceV4>>;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { delivery, payload, source, access } = input;
  assertRemovalNoticeSource(delivery, payload, source);
  const runtime = await runtimeAuthority(tx);
  if (
    !runtime.active ||
    runtime.epoch !== payload.recoveryEpoch ||
    !(await currentMovieRemovalV4(
      tx,
      { completion: payload.source, source },
      budget,
    ))
  )
    throw new PlexBindingProtection("scope_changed");
  // Personal consent survives removal; requesting a fresh download is not a prerequisite to receiving this notice.
  const choice = await readMovieChoice(tx, {
    requestId: payload.request.id,
    expectedScope: payload.source.scope,
    access,
    budget,
  });
  if (choice.status !== "authorized")
    throw new PlexBindingProtection("scope_changed");
  if (
    choice.request.userId !== delivery.userId ||
    choice.choice.id !== payload.request.choiceId ||
    choice.choice.choiceRevision !== payload.request.choiceRevision ||
    choice.target.generation !== payload.generation ||
    choice.target.automationEpoch !== payload.recoveryEpoch
  )
    throw new PlexBindingProtection("scope_changed");
  if (delivery.event.actorId !== choice.choice.actorId)
    throw new Error("Movie removal notification actor attribution changed");
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  return { choice, writerExpiresAtMs: lease.expiresAt.getTime() };
}

export function assertRemovalNoticeSource(
  delivery: MovieNoticeDelivery,
  payload: MovieRemovalNoticeV4,
  source: Awaited<ReturnType<typeof readMovieRemovalSourceV4>>,
) {
  if (
    delivery.event.kind !== payload.eventKind ||
    source.eventKind !== payload.eventKind ||
    delivery.event.mediaId !== payload.source.scope.mediaId ||
    delivery.recoveryEpoch !== payload.recoveryEpoch ||
    source.sourceHash !== payload.sourceHash ||
    source.generation !== payload.generation ||
    source.recoveryEpoch !== payload.recoveryEpoch ||
    identityHash(source.asset) !== identityHash(payload.asset)
  )
    throw new Error(
      "Movie removal notification lost its exact source or edition scope",
    );
}
