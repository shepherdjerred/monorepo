import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import type { MediaIntent, Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { movieChoiceSubject } from "#infrastructure/movie-editions/access.ts";
import { eligibleAcquisitionSponsors } from "#infrastructure/movie-editions/authority.ts";
import { readLibraryHandoffReceipt } from "#infrastructure/handoff/library-receipt.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Admission queues ordinary scoped work only; its Network/Files consumers retain their full SDK authority. */
export async function readMovieActionDemandV4(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    target: MediaIntent;
    epoch: number;
    access: MovieChoiceAccess;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { target } = input;
  if (
    target.editionRootId !== input.scope.rootMediaId ||
    !target.desiredPresence ||
    !target.monitoring ||
    target.intentionallyRemovedAt !== null ||
    target.automationEpoch !== input.epoch
  )
    return null;
  const sponsors = await eligibleAcquisitionSponsors(tx, {
    scope: input.scope,
    access: input.access,
    protocol: "movie-v4",
    budget,
  });
  if (sponsors.length > 0) return combinedSponsorFreshness(sponsors);
  return target.libraryMonitoring ? libraryDemandV4(tx, input, budget) : null;
}

function combinedSponsorFreshness(
  sponsors: Awaited<ReturnType<typeof eligibleAcquisitionSponsors>>,
) {
  return {
    expiresAtMs: Math.min(
      ...sponsors.map((sponsor) => sponsor.freshness.expiresAtMs),
    ),
    assertActive: () => {
      for (const sponsor of sponsors) sponsor.freshness.assertActive();
    },
  };
}

async function libraryDemandV4(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof readMovieActionDemandV4>[1],
  budget: PublicationAuthorityReadBudget,
) {
  const receipts = await tx.mediaHandoffReceipt.findMany({
    where: {
      recoveryEpoch: input.epoch,
      selection: {
        path: ["scope", "targets"],
        array_contains: [
          { mediaId: input.scope.mediaId, edition: input.scope.edition },
        ],
      },
    },
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  budget.consume(receipts.length);
  const candidate = receipts[0];
  if (candidate === undefined || receipts.length !== 1) return null;
  const { receipt, selection } = await readLibraryHandoffReceipt(
    tx,
    candidate.id,
    budget,
  );
  const policies = selection.scope.media.filter(
    (row) => row.mediaId === input.scope.mediaId,
  );
  const policy = policies[0];
  const sections = z
    .object({
      plex: z.array(
        z.object({
          mediaId: z.string(),
          edition: z.string(),
          sectionId: z.string(),
        }),
      ),
    })
    .parse(selection.networkEvidence)
    .plex.filter(
      (row) =>
        row.mediaId === input.scope.mediaId &&
        row.edition === input.scope.edition,
    );
  if (
    policies.length !== 1 ||
    policy?.profileId == null ||
    !policy.monitored ||
    policy.profileId !== input.target.profileId ||
    sections.length !== 1 ||
    sections[0]?.sectionId !== input.access.movieSectionId ||
    !selection.scope.files.some(
      (file) =>
        file.libraryKind === "movies" &&
        file.edition === input.scope.edition &&
        file.mediaIds.length === 1 &&
        file.mediaIds[0] === input.scope.mediaId,
    )
  )
    return null;
  const owner = await currentLibraryOwnerV4(tx, receipt.actorId, input.access);
  if (owner === null) return null;
  budget.consume(owner.mapping === null ? 2 : 3);
  if (owner.actor.role !== "owner" || owner.actor.restricted) return null;
  owner.freshness?.assertActive();
  return owner.freshness;
}

async function currentLibraryOwnerV4(
  tx: Prisma.TransactionClient,
  actorId: string,
  access: MovieChoiceAccess,
) {
  try {
    return await movieChoiceSubject(tx, {
      actorId,
      subjectUserId: actorId,
      purpose: "choose",
      access,
    });
  } catch (error) {
    if (
      error instanceof MediaError &&
      [
        "owner_required",
        "requests_restricted",
        "plex_library_access_required",
      ].includes(error.code)
    )
      return null;
    throw error;
  }
}
