import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import {
  readMoviePublicationNoticeV4,
  type MoviePublicationNoticeV4,
} from "#shared/movie-editions/notifications-v4.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type {
  PlexBindingFreshness,
  PlexBindingSnapshot,
} from "#shared/plex-binding/contract.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieNoticeSource } from "./source.ts";

export type MovieNoticeDelivery = Prisma.NotificationDeliveryGetPayload<{
  include: { event: true; user: { include: { notificationPreference: true } } };
}>;
export type PreparedMovieNoticeV4 = {
  payload: MoviePublicationNoticeV4;
  access: MovieChoiceAccess;
  binding: PlexBindingSnapshot;
  freshness: PlexBindingFreshness;
  budget: PublicationAuthorityReadBudget;
};

export async function prepareMovieNoticeV4(
  context: Pick<MediaAutomationContext, "db">,
  input: {
    delivery: MovieNoticeDelivery;
    execution: PlexBindingExecution;
    access: MovieChoiceAccess | undefined;
  },
): Promise<PreparedMovieNoticeV4 | undefined> {
  const payload = readMoviePublicationNoticeV4(input.delivery.event.payload);
  if (payload === null) return;
  const access = requireMovieChoiceAccess(input.access ?? {});
  const budget = new PublicationAuthorityReadBudget();
  const current = await readMovieNoticeAuthorityV4(
    context.db,
    { delivery: input.delivery, payload, access },
    budget,
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
  return {
    payload,
    access,
    budget,
    freshness,
    binding: current.binding.snapshot,
  };
}

export async function assertMovieNoticeConfiguration(
  context: Pick<
    MediaAutomationContext,
    "db" | "serverMachineId" | "permittedSections"
  >,
  prepared: PreparedMovieNoticeV4 | undefined,
) {
  if (prepared === undefined) return;
  prepared.freshness.assertActive();
  const access = await networkMovieAccess(context, [
    prepared.payload.source.scope.mediaId,
  ]);
  prepared.freshness.assertActive();
  if (identityHash(access) !== identityHash(prepared.access))
    throw new PlexBindingProtection("wrong_section");
}

/** The same invocation allowance and original SDK/writer/mapping deadline span claim and send. */
export async function assertPreparedMovieNoticeV4(
  tx: Prisma.TransactionClient,
  delivery: MovieNoticeDelivery,
  prepared: PreparedMovieNoticeV4,
) {
  prepared.freshness.assertActive();
  const payload = readMoviePublicationNoticeV4(delivery.event.payload);
  if (
    payload === null ||
    identityHash(payload) !== identityHash(prepared.payload)
  )
    throw new Error("Movie notification selected payload changed");
  const current = await readMovieNoticeAuthorityV4(
    tx,
    { delivery, payload, access: prepared.access },
    prepared.budget,
  );
  if (identityHash(current.binding.snapshot) !== identityHash(prepared.binding))
    throw new PlexBindingProtection("binding_changed");
  prepared.freshness.assertActive();
  current.choice.freshness.assertActive();
  return current;
}

async function readMovieNoticeAuthorityV4(
  tx: Prisma.TransactionClient,
  input: {
    delivery: MovieNoticeDelivery;
    payload: MoviePublicationNoticeV4;
    access: MovieChoiceAccess;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { payload, delivery, access } = input;
  const source = await readMovieNoticeSource(tx, payload.source, budget);
  assertNoticeSource(delivery, payload, source);
  const runtime = await runtimeAuthority(tx);
  if (!runtime.active || runtime.epoch !== payload.recoveryEpoch)
    throw new PlexBindingProtection("ownership_changed");
  const choice = await readMovieChoice(tx, {
    requestId: payload.request.id,
    expectedScope: payload.source.scope,
    access,
    budget,
  });
  if (choice.status !== "authorized")
    throw new PlexBindingProtection("scope_changed");
  if (delivery.event.actorId !== choice.choice.actorId)
    throw new Error("Movie notification actor attribution changed");
  if (
    choice.request.userId !== delivery.userId ||
    choice.choice.id !== payload.request.choiceId ||
    choice.choice.choiceRevision !== payload.request.choiceRevision ||
    choice.target.generation !== payload.generation ||
    choice.target.automationEpoch !== payload.recoveryEpoch ||
    choice.target.availability !== "available" ||
    !choice.target.desiredPresence ||
    choice.target.intentionallyRemovedAt !== null
  )
    throw new PlexBindingProtection("scope_changed");
  budget.consume(2);
  const binding = await readCurrentPlexBinding(tx, {
    scope: {
      mediaId: payload.source.scope.mediaId,
      edition: payload.source.scope.edition,
    },
    assetId: payload.asset.id,
    access: {
      serverMachineId: access.serverMachineId,
      sectionId: access.movieSectionId,
      sectionType: "movie",
    },
  });
  if (binding.status !== "current")
    throw new PlexBindingProtection(binding.reason);
  if (identityHash(binding.association.group) !== identityHash(source.group))
    throw new PlexBindingProtection("binding_changed");
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  return { choice, binding, writerExpiresAtMs: lease.expiresAt.getTime() };
}

function assertNoticeSource(
  delivery: MovieNoticeDelivery,
  payload: MoviePublicationNoticeV4,
  source: Awaited<ReturnType<typeof readMovieNoticeSource>>,
) {
  if (
    delivery.event.kind !== payload.eventKind ||
    source.eventKind !== payload.eventKind ||
    delivery.event.mediaId !== payload.source.scope.mediaId ||
    delivery.recoveryEpoch !== payload.recoveryEpoch ||
    source.group.ownershipEpoch !== payload.recoveryEpoch ||
    source.publicationHash !== payload.publicationHash ||
    identityHash(payload.asset) !==
      identityHash({
        id: source.group.assetId,
        version: source.group.assetVersion,
        checksum: source.group.checksum,
      })
  )
    throw new Error(
      "Movie notification lost its exact source, physical owner or edition scope",
    );
}
