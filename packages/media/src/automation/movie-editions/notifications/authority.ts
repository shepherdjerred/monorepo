import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import {
  readMovieNoticeV4,
  movieNoticeSourceHash,
  type MovieNoticeV4,
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
import { readMovieNoticeProof } from "./source.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import { subtitleTargetsReady } from "#automation/subtitles/authority.ts";

export type MovieNoticeDelivery = Prisma.NotificationDeliveryGetPayload<{
  include: { event: true; user: { include: { notificationPreference: true } } };
}>;
export type PreparedMovieNoticeV4 = {
  payload: MovieNoticeV4;
  source: Awaited<ReturnType<typeof readMovieNoticeProof>>;
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
  const payload = readMovieNoticeV4(input.delivery.event.payload);
  if (payload === null) return;
  const access = requireMovieChoiceAccess(input.access ?? {});
  const budget = new PublicationAuthorityReadBudget();
  const source = await readMovieNoticeProof(context.db, payload, budget);
  const current = await readMovieNoticeAuthorityV4(
    context.db,
    { delivery: input.delivery, payload, access, source },
    budget,
  );
  const freshness = plexBindingFreshness({
    observed: input.execution.observed,
    expiresAtMs: Math.min(
      input.execution.expiresAtMs,
      current.writerExpiresAtMs,
      current.freshness.expiresAtMs,
    ),
    guards: [input.execution, current.freshness],
  });
  return {
    payload,
    source,
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
  const payload = readMovieNoticeV4(delivery.event.payload);
  if (
    payload === null ||
    identityHash(payload) !== identityHash(prepared.payload)
  )
    throw new Error("Movie notification selected payload changed");
  const current = await readMovieNoticeAuthorityV4(
    tx,
    { delivery, payload, access: prepared.access, source: prepared.source },
    prepared.budget,
  );
  if (identityHash(current.binding.snapshot) !== identityHash(prepared.binding))
    throw new PlexBindingProtection("binding_changed");
  prepared.freshness.assertActive();
  current.freshness.assertActive();
  return current;
}

async function readMovieNoticeAuthorityV4(
  tx: Prisma.TransactionClient,
  input: {
    delivery: MovieNoticeDelivery;
    payload: MovieNoticeV4;
    access: MovieChoiceAccess;
    source: PreparedMovieNoticeV4["source"];
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { payload, delivery, access, source } = input;
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
  let freshness = choice.freshness;
  if (payload.kind === "movie_subtitles") {
    const work = await currentMovieSubtitleWorkV4(
      tx,
      {
        scope: payload.source.scope,
        assetId: payload.asset.id,
        epoch: payload.recoveryEpoch,
        access,
      },
      budget,
    );
    if (
      work.authority !== payload.targetAuthority ||
      work.targets.length === 0 ||
      !subtitleTargetsReady(work, payload.recoveryEpoch)
    )
      throw new PlexBindingProtection("scope_changed");
    work.freshness.assertActive();
    freshness = {
      expiresAtMs: Math.min(
        choice.freshness.expiresAtMs,
        work.freshness.expiresAtMs,
      ),
      assertActive: () => {
        choice.freshness.assertActive();
        work.freshness.assertActive();
      },
    };
  }
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  return {
    choice,
    binding,
    freshness,
    writerExpiresAtMs: lease.expiresAt.getTime(),
  };
}

function assertNoticeSource(
  delivery: MovieNoticeDelivery,
  payload: MovieNoticeV4,
  source: PreparedMovieNoticeV4["source"],
) {
  if (
    delivery.event.kind !== payload.eventKind ||
    source.eventKind !== payload.eventKind ||
    delivery.event.mediaId !== payload.source.scope.mediaId ||
    delivery.recoveryEpoch !== payload.recoveryEpoch ||
    source.group.ownershipEpoch !== payload.recoveryEpoch ||
    source.publicationHash !== movieNoticeSourceHash(payload) ||
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
