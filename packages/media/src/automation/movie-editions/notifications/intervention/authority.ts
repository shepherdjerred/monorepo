import type { Prisma } from "#generated/prisma/client.ts";
import type { NotificationContext } from "#automation/notifications/types.ts";
import type { MovieNoticeDelivery } from "#automation/movie-editions/notifications/authority.ts";
import {
  readMovieInterventionNoticeV4,
  type MovieInterventionNoticeV4,
} from "#shared/movie-editions/intervention/v4.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import {
  movieChoiceSubject,
  movieSourceSection,
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertMovieInterventionSourceV4 } from "./source.ts";
import { MediaError } from "#application/errors.ts";
import { assertCurrentMovieFailureV4 } from "./current-failure.ts";

type Input = {
  delivery: MovieNoticeDelivery;
  execution: PlexBindingExecution;
  access: MovieChoiceAccess | undefined;
  budget: PublicationAuthorityReadBudget;
};
export type PreparedMovieInterventionV4 = Awaited<
  ReturnType<typeof prepareMovieInterventionV4>
>;

export async function prepareMovieInterventionV4(
  context: Pick<NotificationContext, "db">,
  input: Input,
) {
  const payload = readMovieInterventionNoticeV4(input.delivery.event.payload);
  if (payload === null) return;
  const access = requireMovieChoiceAccess(input.access ?? {});
  await assertMovieInterventionSourceV4(
    context.db,
    input.delivery,
    payload,
    input.budget,
  );
  const current = await currentIntervention(context.db, {
    delivery: input.delivery,
    payload,
    access,
    budget: input.budget,
  });
  const freshness = plexBindingFreshness({
    observed: input.execution.observed,
    expiresAtMs: Math.min(
      input.execution.expiresAtMs,
      current.identity.expiresAtMs,
      current.writerExpiresAtMs,
    ),
    guards: [input.execution, current.identity],
  });
  return { payload, access, budget: input.budget, freshness };
}

export async function assertMovieInterventionConfiguration(
  context: NotificationContext,
  prepared: PreparedMovieInterventionV4,
) {
  if (prepared === undefined) return;
  prepared.freshness.assertActive();
  const access = await networkMovieAccess(context, [
    prepared.payload.source.mediaId,
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

export async function assertPreparedMovieInterventionV4(
  tx: Prisma.TransactionClient,
  delivery: MovieNoticeDelivery,
  prepared: NonNullable<PreparedMovieInterventionV4>,
) {
  prepared.freshness.assertActive();
  const payload = readMovieInterventionNoticeV4(delivery.event.payload);
  if (
    payload === null ||
    identityHash(payload) !== identityHash(prepared.payload)
  )
    throw new Error("Movie intervention selected notification changed");
  await assertMovieInterventionSourceV4(tx, delivery, payload, prepared.budget);
  const current = await currentIntervention(tx, {
    delivery,
    payload,
    access: prepared.access,
    budget: prepared.budget,
  });
  current.identity.assertActive();
  prepared.freshness.assertActive();
  return current.identity;
}

async function currentIntervention(
  tx: Prisma.TransactionClient,
  input: {
    delivery: MovieNoticeDelivery;
    payload: MovieInterventionNoticeV4;
    access: MovieChoiceAccess;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { payload } = input;
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: payload.source.mediaId,
        edition: payload.source.scope.edition,
      },
    },
  });
  const runtime = await runtimeAuthority(tx);
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: payload.source.operationId },
  });
  input.budget.consume(1);
  if (
    target.editionRootId !== payload.source.scope.rootMediaId ||
    target.generation !== payload.source.generation ||
    target.automationEpoch !== payload.recoveryEpoch ||
    !runtime.active ||
    runtime.epoch !== payload.recoveryEpoch ||
    !["failed", "reconciling"].includes(command.status)
  )
    throw new PlexBindingProtection("scope_changed");
  await assertCurrentMovieFailureV4(tx, payload, command, input.budget);
  const identity = await currentRecipient(tx, input);
  const writer = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  return { identity, writerExpiresAtMs: writer.expiresAt.getTime() };
}

async function currentRecipient(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof currentIntervention>[1],
) {
  const { payload, delivery, access, budget } = input;
  const recipient = payload.recipient;
  if (recipient.kind === "personal") {
    const choice = await readMovieChoice(tx, {
      requestId: recipient.requestId,
      expectedScope: payload.source.scope,
      access,
      budget,
    });
    if (
      choice.status !== "authorized" ||
      choice.request.userId !== delivery.userId ||
      choice.choice.id !== recipient.choiceId ||
      choice.choice.choiceRevision !== recipient.choiceRevision ||
      choice.choice.actorId !== delivery.event.actorId ||
      !choice.target.desiredPresence ||
      choice.target.intentionallyRemovedAt !== null
    )
      throw new PlexBindingProtection("scope_changed");
    return choice.freshness;
  }
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: payload.source.mediaId },
  });
  try {
    const owner = await movieChoiceSubject(tx, {
      actorId: delivery.userId,
      subjectUserId: delivery.userId,
      purpose: "choose",
      access,
      mediaSectionId: movieSourceSection(media.externalIds),
    });
    if (owner.actor.role !== "owner" || owner.freshness === null)
      throw new PlexBindingProtection("scope_changed");
    return owner.freshness;
  } catch (error) {
    if (error instanceof MediaError)
      throw new PlexBindingProtection("scope_changed");
    throw error;
  }
}
